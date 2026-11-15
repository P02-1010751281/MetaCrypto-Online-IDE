/**
 * 文档检索内核：纯函数 + 预建倒排索引，运行时零 IO、零模型。
 *
 * 口径：
 * - 检索单元是「标题切出的段落」（`secs`），排序用 BM25（k1=1.2, b=0.75）；
 * - 命中理由可解释：返回命中的查询词与所属文档、标题、行号、摘录；
 * - 默认按文档去重（同一篇只留最高分段落），界面点一条就是一篇文档的一个锚点。
 *
 * 索引由 `scripts/ai-helper-docindex.ts` 在构建期生成；`corpus.hash` 是全部语料
 * 加路径的 FNV-1a 64 摘要，单测用它挡「改了语料没重建索引」。
 */

import { expandQuery } from './doc-glossary';
import { queryPlan, queryTerms } from './doc-tokenize';

export interface DocIndex {
  v: 1;
  /** 语料类型：Markdown 正文 / PDF 页 / 合并索引。 */
  kind?: 'md' | 'pdf' | 'mixed';
  corpus: { files: number; sections: number; tokens: number; hash: string };
  /** [路径, 标题] */
  docs: Array<[string, string]>;
  /** [文档下标, 行号, 标题级别, 标题, 摘录, 词数] */
  secs: Array<[number, number, number, string, string, number]>;
  /** 词 -> 扁平 [段落下标, 词频, 段落下标, 词频, …]（扁平比 [id,tf] 数组省约 1MB）。 */
  post: Record<string, number[]>;
}

export interface DocHit {
  path: string;
  title: string;
  heading: string;
  /** 段落起始行（1 基），可直接拼成 `path#Lline`。 */
  line: number;
  score: number;
  excerpt: string;
  /** 命中来源：`.pdf` 路径为 pdf（`line` 是页码），其余为 md（`line` 是行号）。 */
  kind: 'md' | 'pdf';
  /** 命中的查询词（按首次出现顺序，最多 6 个）。 */
  terms: string[];
}

export interface DocSearchOptions {
  limit?: number;
  /** 路径前缀过滤，如 `docs/standards/`。 */
  prefix?: string;
  /** 语种过滤：`.en.md` 为 en，其余为 zh。 */
  lang?: 'zh' | 'en';
  /** 默认按文档去重；`section` 保留同文档的多个段落。 */
  dedupe?: 'doc' | 'section';
}

const K1 = 1.2;
const B = 0.75;
/** 文档级查询词覆盖度权重（相对于段落的最高分）。 */
const COVERAGE_WEIGHT = 0.35;
/** 术语扩展的相对权重：只做补充信号，不与原查询词平权。 */
const EXPANSION_SCALE = 0.55;
/** PDF 页的固定折扣：原始标准整页信息密度低，作为补充证据，不压过拆分好的章节页。 */
const PDF_WEIGHT = 0.6;
/** 认定「用户已点名具体对象」的拉丁词 df 上限。 */
const NAMED_DF = 150;
/** 扩展词允许的最大 df：再常见就没有区分度。 */
const EXPANSION_DF_MAX = 400;
const LATIN = /[a-z]/;

/** FNV-1a 64：与索引脚本共用，保证「语料没变」可复算。 */
export function corpusDigest(entries: Array<[path: string, text: string]>): string {
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  const push = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= BigInt(text.charCodeAt(index));
      hash = (hash * 0x100000001b3n) & mask;
    }
  };
  for (const [path, text] of entries) {
    push(path);
    push('\u0000');
    push(text);
    push('\u0001');
  }
  return hash.toString(16).padStart(16, '0');
}

export function parseDocIndex(raw: string): DocIndex {
  return JSON.parse(raw) as DocIndex;
}

/** 把 Markdown 索引与 PDF 页索引合并成一份可检索索引（运行期按需合并）。 */
export function mergeIndexes(...indexes: DocIndex[]): DocIndex {
  if (indexes.length === 1) return indexes[0];
  const docs: Array<[string, string]> = [];
  const secs: Array<[number, number, number, string, string, number]> = [];
  const post: Record<string, number[]> = {};
  let files = 0;
  let sections = 0;
  let tokens = 0;
  for (const index of indexes) {
    const docOffset = docs.length;
    const secOffset = secs.length;
    for (const entry of index.docs) docs.push(entry);
    for (const section of index.secs) {
      secs.push([section[0] + docOffset, section[1], section[2], section[3], section[4], section[5]]);
    }
    for (const [term, list] of Object.entries(index.post)) {
      const target = post[term] ?? [];
      for (let cursor = 0; cursor < list.length; cursor += 2) target.push(list[cursor] + secOffset, list[cursor + 1]);
      post[term] = target;
    }
    files += index.corpus.files;
    sections += index.corpus.sections;
    tokens += index.corpus.tokens;
  }
  return {
    v: 1,
    kind: 'mixed',
    corpus: { files, sections, tokens, hash: indexes.map((index) => index.corpus.hash).join('+') },
    docs,
    secs,
    post,
  };
}

/** 去掉 Markdown 标记、压缩空白的摘录（评分用同一口径做短语加成）。 */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/[#>*`|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function docLang(path: string): 'zh' | 'en' {
  return path.endsWith('.en.md') ? 'en' : 'zh';
}

function idfTable(index: DocIndex, terms: string[]): Map<string, number> {
  const total = index.secs.length;
  const table = new Map<string, number>();
  for (const term of terms) {
    const df = (index.post[term]?.length ?? 0) / 2;
    table.set(term, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
  }
  return table;
}

export function searchDocs(index: DocIndex, query: string, options: DocSearchOptions = {}): DocHit[] {
  const text = query.trim();
  if (!text) return [];
  const limit = options.limit ?? 10;
  const dfOf = (term: string): number => (index.post[term]?.length ?? 0) / 2;
  const termWeights = new Map<string, number>();
  for (const item of queryPlan(text)) {
    // 交叉二元组（密钥协商 的 钥协）比两侧真实词更稀有 ⇒ 是切词噪音，不作为查询词。
    if (item.bridging && item.left && item.right) {
      const df = dfOf(item.term);
      if (df > 0 && (df < dfOf(item.left) || df < dfOf(item.right))) continue;
    }
    termWeights.set(item.term, 1);
  }
  // 条件扩展：用户已经点名了稀有拉丁标识符（argon2 / ecdsa / drbg / base64）时，
  // 同义扩展只会把兄弟标准页拉进来稀释信号，干脆不扩。
  const namedIdentifier = [...termWeights.keys()].some((term) => LATIN.test(term) && dfOf(term) > 0 && dfOf(term) <= NAMED_DF);
  if (!namedIdentifier) {
    // 同义词/中英术语扩展：只扩查询，不改索引（「带认证的加密」→ aead/ccm/gcm，round function → 轮函数）。
    // 权重再乘 0.55：扩展词是补充信号，不与用户原话平权。
    for (const [term, weight] of expandQuery(text)) {
      const df = dfOf(term);
      // 只收索引里存在、且不算太常见的词：别名拆出来的「随/机/输/入」这类单字是噪音。
      if (df === 0 || df > EXPANSION_DF_MAX) continue;
      const scaled = weight * EXPANSION_SCALE;
      if ((termWeights.get(term) ?? 0) < scaled) termWeights.set(term, scaled);
    }
  }
  const terms = [...termWeights.keys()];
  if (!terms.length) return [];

  const idf = idfTable(index, terms);
  const avgLen = index.corpus.tokens / Math.max(index.secs.length, 1);
  const scores = new Float64Array(index.secs.length);
  const matched: Array<Set<string>> = Array.from({ length: index.secs.length }, () => new Set<string>());
  const headingTerms = new Map<number, Set<string>>();
  const docTerms = new Map<number, { title: Set<string>; path: Set<string> }>();

  const headingSet = (section: number): Set<string> => {
    const cached = headingTerms.get(section);
    if (cached) return cached;
    const set = new Set(queryTerms(index.secs[section][3]));
    headingTerms.set(section, set);
    return set;
  };

  // 元数据加成：路径与文档标题里的词比正文命中更可信（`rfc8032-eddsa` 里的 eddsa）。
  const docSet = (doc: number): { title: Set<string>; path: Set<string> } => {
    const cached = docTerms.get(doc);
    if (cached) return cached;
    const entry = index.docs[doc];
    const value = { title: new Set(queryTerms(entry[1])), path: new Set(queryTerms(entry[0])) };
    docTerms.set(doc, value);
    return value;
  };

  for (const term of terms) {
    const postings = index.post[term];
    if (!postings) continue;
    // 稀有词（整词只出现在少数段落，如 ed25519 / x25519）通常是提问的主语：加权后
    // 不再被「签名 / 密钥 / 填充」这类共用词的高词频盖过。
    const df = postings.length / 2;
    const anchor = df <= 20 ? 2.2 : df <= 60 ? 1.35 : 1;
    const weight = (idf.get(term) ?? 0) * anchor * (termWeights.get(term) ?? 1);
    for (let cursor = 0; cursor < postings.length; cursor += 2) {
      const section = postings[cursor];
      const tf = postings[cursor + 1];
      const length = index.secs[section][5];
      const norm = 1 - B + (B * length) / Math.max(avgLen, 1);
      let gained = (weight * (tf * (K1 + 1))) / (tf + K1 * norm);
      if (headingSet(section).has(term)) gained *= 1.8;
      const meta = docSet(index.secs[section][0]);
      if (meta.path.has(term)) gained *= 2.2;
      else if (meta.title.has(term)) gained *= 1.25;
      scores[section] += gained;
      matched[section].add(term);
    }
  }

  // 短语加成：整句出现在标题里几乎就是目标段；出现在摘录里给小幅加成。
  const phrase = plain(text).toLowerCase();
  if (phrase.length >= 2) {
    for (let section = 0; section < index.secs.length; section += 1) {
      if (scores[section] === 0) continue;
      if (index.secs[section][3].toLowerCase().includes(phrase)) scores[section] += 4;
      else if (index.secs[section][4].toLowerCase().includes(phrase)) scores[section] += 0.8;
    }
  }

  const hits: DocHit[] = [];
  for (let section = 0; section < index.secs.length; section += 1) {
    if (scores[section] <= 0) continue;
    const [docIdx, line, , heading, excerpt] = index.secs[section];
    const [path, title] = index.docs[docIdx];
    if (options.prefix && !path.startsWith(options.prefix)) continue;
    if (options.lang && docLang(path) !== options.lang) continue;
    const isPdf = path.toLowerCase().endsWith('.pdf');
    if (isPdf) scores[section] *= PDF_WEIGHT;
    hits.push({
      path,
      title,
      heading,
      line,
      score: Number(scores[section].toFixed(4)),
      excerpt,
      kind: path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'md',
      terms: [...matched[section]].slice(0, 6),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  if (options.dedupe === 'section') return hits.slice(0, limit);

  // 文档级汇总：取最高分段 + 查询词覆盖度加成。
  // 单段落排序会把「只在自己一节里反复念叨『密钥/协商』的长段落」顶到最前；
  // 覆盖度奖励的是「这篇文档整体在讲这个主题」，与用户点进哪一篇更接近。
  const covered = new Map<number, number>();
  let idfSum = 0;
  for (const term of terms) {
    const postings = index.post[term];
    if (!postings) continue;
    const weight = (idf.get(term) ?? 0) * (termWeights.get(term) ?? 1);
    idfSum += weight;
    const docs = new Set<number>();
    for (let cursor = 0; cursor < postings.length; cursor += 2) {
      docs.add(index.secs[postings[cursor]][0]);
    }
    for (const doc of docs) covered.set(doc, (covered.get(doc) ?? 0) + weight);
  }

  const docIndexOf = new Map<string, number>();
  index.docs.forEach((entry, position) => docIndexOf.set(entry[0], position));

  const best = new Map<string, DocHit & { docScore: number }>();
  for (const hit of hits) {
    const docIndex = docIndexOf.get(hit.path) ?? -1;
    const coverage = (covered.get(docIndex) ?? 0) / Math.max(idfSum, 1e-9);
    const docScore = hit.score + COVERAGE_WEIGHT * idfSum * coverage;
    const existing = best.get(hit.path);
    if (!existing || docScore > existing.docScore) best.set(hit.path, { ...hit, docScore, score: Number(docScore.toFixed(4)) });
  }
  return [...best.values()]
    .sort((a, b) => b.docScore - a.docScore || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map(({ docScore: _docScore, ...hit }) => hit);
}
