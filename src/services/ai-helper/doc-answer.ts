/**
 * D 线（用户问题 → 答案 + 出处）的「答案」层：抽取式作答，不接生成模型。
 *
 * 定名与边界见 `experiments/ai-helper-2026-11-14/PLAN.md` §0：
 *   D = 用户问题 → 答案 + 出处（文献段 / 文档章节 / 块类型），“生成式回答属可选增强”。
 * 所以这里的「答案」必须能在**没有模型**的前提下给出，并且每句都能回链：
 *
 *   1. 检索层（`doc-search.ts`）先给出命中段落（文档 + 段落起始行）；
 *   2. 本模块按命中段落的真实 Markdown 正文切句、挑句，**逐句带 1 基行号**；
 *   3. 覆盖度低于阈值就明说「语料里没有能直接回答这句的依据」，并列出缺的词，
 *      不把「最近的一段」包装成答案。
 *
 * 为什么不直接引用索引里的 `excerpt`：索引摘录被截到 140 字（实测 p50 = p90 = max = 140），
 * 经常只是页首的说明段，撑不起「答案」；正文按需用 docs 通配的懒加载器（`import.meta.glob` 的 `/docs` 全量 Markdown 规则）
 * 的懒加载器取单篇，代价只有一篇文档。
 *
 * 纯函数：不读 fs、不碰 DOM、不知道 Vue。异步只在「取正文」这一层（由调用方注入 loader）。
 */

import type { DocHit } from './doc-search';
import { queryTerms, stripMarkdown } from './doc-tokenize';

export interface AnswerSentence {
  /** 原文句子（已去 Markdown 标记；不改写、不改写序）。 */
  text: string;
  /** 1 基行号：该句在源文件里的起始行。 */
  line: number;
}

export interface AnswerEvidence {
  path: string;
  title: string;
  heading: string;
  kind: 'md' | 'pdf';
  /** 段落起始行（PDF 为页码）。 */
  sectionLine: number;
}

export interface AnswerDraft {
  sentences: AnswerSentence[];
  evidence: AnswerEvidence;
  /** 问题词在选中句子里出现的比例（0–1）。 */
  coverage: number;
  /** 没被任何选中句子覆盖到的问题词（解释「为什么答得浅」）。 */
  missing: string[];
  /** PDF 命中没有正文可切句，只能给页摘录——界面必须标明这是摘录。 */
  excerptOnly: boolean;
}

export interface AnswerResult {
  /** 最佳答案；`null` 表示证据不足（此时看 `others` 与 `missing`）。 */
  best: AnswerDraft | null;
  /** 其它候选段落（按覆盖度降序），供「更多依据」。 */
  others: AnswerDraft[];
  /** 参与评分的问题词。 */
  terms: string[];
  /** 证据不足时缺的词（取最佳候选的缺失集合）。 */
  missing: string[];
}

/** 词统计：答案层要用 IDF 加权与「点名标识符」判定，不能按字面覆盖度平权。 */
export interface TermStats {
  /** 逆文档频率（越大越具体）。 */
  idf: (term: string) => number;
  /** 文档频率（出现该词的段落数）。 */
  df: (term: string) => number;
}

/** 句子是模板/导航/元信息时的降权系数：它们常含查询词，但不是答案。 */
const BOILERPLATE_PENALTY = 0.35;
const BOILERPLATE = /本页|本卡片|该定位|概览\/组合页|可搜索证据层|重新整理的结构化参考|不替代|请回看|同目录 PDF|返回顶部|导航/;
/**
 * 问句类型 → 答案句式的偏好系数。
 *
 * 抽取式作答的死穴是「覆盖度高的句子其实没回答问题」：问「子密钥怎么派生」时，
 * 「可与任何 NIST 批准的分组密码配合使用」同样含 cmac/分组密码，覆盖度不低却答非所问。
 * 这里按问句里的疑问词给「像答案的句式」加权——纯词面规则，可复算、不接模型：
 *   怎么/如何 → 过程句（步骤、先…再、调用、执行）
 *   多少/几   → 数字句
 *   区别/不同 → 对比句
 *   是什么/定义 → 定义句（是/指/称为）
 *   有哪些    → 列举句（、/以及/包括）
 */
const QUESTION_PATTERNS: Array<{ test: RegExp; sentence: RegExp }> = [
  { test: /怎么|如何|怎样|步骤|流程/, sentence: /步骤|流程|首先|然后|再|先|调用|执行|使用|通过|构造|计算/ },
  { test: /多少|几个|几轮|长度|大小|位数/, sentence: /\d/ },
  { test: /区别|不同|差异|对比/, sentence: /相比|区别|不同|差异|而|但/ },
  { test: /是什么|什么是|定义|含义|指什么/, sentence: /是|指|称为|定义为|即/ },
  { test: /有哪些|哪些|列表|清单/, sentence: /、|以及|包括|有|共/ },
];

function questionPatternBoost(question: string, sentence: string): number {
  for (const rule of QUESTION_PATTERNS) {
    if (rule.test.test(question) && rule.sentence.test(sentence)) return 1.25;
  }
  return 1;
}

/** 英文问句里的功能词：它们不是实体，不能当「点名对象」。 */
const ANCHOR_STOPWORDS = new Set([
  'the', 'and', 'how', 'what', 'why', 'when', 'which', 'this', 'that', 'these', 'those',
  'are', 'is', 'was', 'were', 'does', 'did', 'for', 'with', 'from', 'into', 'you', 'can',
  'defined', 'define', 'used', 'use', 'using', 'two', 'three', 'step', 'steps', 'one',
]);
/** 单句长度上限：再长就不是「一句答案」，而是原始提取稿的整段 dump 或大表格。 */
const MAX_ANSWER_SENTENCE = 260;

export interface AnswerOptions {
  /** 最多选几句（默认 3）。 */
  maxSentences?: number;
  /** 覆盖度阈值（默认 0.5，实测见 tests/unit/doc-answer.test.ts 与 RESULTS §24）。 */
  minCoverage?: number;
  /** 词统计（缺省平权，仅用于测试夹具；产品路径必传，见 `answerHits` 调用方）。 */
  stats?: TermStats;
  /** 看前几个命中段落（默认 4）。 */
  maxSections?: number;
  /** 单篇最多扫描多少行（默认 400，挡住整篇超长文档）。 */
  maxSectionLines?: number;
}

const DEFAULTS = { maxSentences: 3, minCoverage: 0.5, maxSections: 4, maxSectionLines: 400 };

/** 句末标点：中文用全角，英文用「. + 空白 + 大写/行尾」。 */
const SENTENCE_END = /[。！？；]/;

function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/** 单行切句：中文按全角句末，英文按「. 」断且要求下一词大写（避开 FIPS 197 §5.1.4 这类）。 */
export function splitSentences(line: string): string[] {
  const text = stripMarkdown(line).trim();
  if (!text) return [];
  const parts: string[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    buffer += char;
    if (SENTENCE_END.test(char)) {
      // 中文句末标点后面不需要空格（标准页里「…生成。轮函数…」是常态）。
      parts.push(buffer);
      buffer = '';
      continue;
    }
    if (char === '.' && /\s/.test(text[i + 1] ?? '')) {
      const rest = text.slice(i + 2);
      if (/^[A-Z]/.test(rest) || rest.trim() === '') {
        parts.push(buffer);
        buffer = '';
      }
    }
  }
  if (buffer.trim()) parts.push(buffer);
  return parts.map((part) => part.trim()).filter((part) => part.length >= 6);
}

/**
 * 从一篇 Markdown 里取句作答。
 *
 * 为什么扫**整篇**而不是命中段落：索引的段落是按标题切的，命中段落常常只是页首说明
 * （实测 HKDF 的命中段就是 README 前两行，覆盖度只有 0.14），真正的答案在下一节。
 * 检索负责「哪篇文档」，本函数负责「这篇里哪几句」，两件事分开才有救。
 * 每句都带真实行号，界面点出处能直接落到那一行。
 */
export function answerFromDocument(
  markdown: string,
  hit: DocHit,
  question: string,
  terms: string[],
  options: AnswerOptions = {},
): AnswerDraft | null {
  const config = { ...DEFAULTS, ...options };
  const lines = markdown.split('\n');
  const start = 0;
  const end = Math.min(lines.length, config.maxSectionLines);

  /**
   * 先把「段落」拼起来再切句：Markdown 里一句话常横跨多行（一行是 `- 密钥扩展使用不同的`
   * 下一行继续），按行切句会切出 `密钥扩展使用不同的` 这种残片，读起来像断掉的话。
   * 段落边界 = 空行 / 标题 / 表格行 / 列表项起始 / 句子已以句末标点收尾。
   * 引用的行号取该段第一行的行号（点开就落在这一段）。
   */
  const paragraphs: Array<{ text: string; line: number }> = [];
  let buffer = '';
  let bufferLine = 0;
  const flush = (): void => {
    if (buffer.trim()) paragraphs.push({ text: buffer.trim(), line: bufferLine });
    buffer = '';
  };
  for (let index = start; index < end; index += 1) {
    const raw = lines[index] ?? '';
    if (isHeading(raw) || /^\s*\|/.test(raw) || /^\s*$/.test(raw)) {
      flush();
      continue;
    }
    if (/^\s*([-*+]|\d+[.)]|>)\s/.test(raw)) flush(); // 列表项/引用各自成段
    if (!buffer) bufferLine = index + 1;
    buffer += (buffer ? ' ' : '') + raw.trim();
    if (/[。！？；.!?]\s*$/.test(raw.trim())) flush();
  }
  flush();

  const candidates: AnswerSentence[] = [];
  for (const paragraph of paragraphs) {
    if (BOILERPLATE.test(paragraph.text)) continue; // 模板/元信息段不是答案
    for (const piece of splitSentences(paragraph.text)) {
      // 超过 260 字的「句子」多半是 pdftotext 整段 dump 或大表格，不能当答案句。
      if (piece.length > MAX_ANSWER_SENTENCE) continue;
      candidates.push({ text: piece, line: paragraph.line });
    }
  }
  if (!candidates.length) return null;

  // 贪心选句：每轮取「能补上最多未覆盖权重」的那句；同权重取行号小的（原文顺序更自然）。
  // 权重按 IDF：「sm4」这类稀有标识符压过「加密」这类到处都有的词。
  const weightOf = (term: string): number => options.stats?.idf(term) ?? 1;
  const totalWeight = terms.reduce((sum, term) => sum + weightOf(term), 0);
  const covered = new Set<string>();
  const picked: AnswerSentence[] = [];
  for (let round = 0; round < config.maxSentences; round += 1) {
    let best: AnswerSentence | null = null;
    let bestGain = 0;
    for (const candidate of candidates) {
      const haystack = candidate.text.toLowerCase();
      let gain = 0;
      for (const term of terms) {
        if (covered.has(term)) continue;
        if (haystack.includes(term.toLowerCase())) gain += weightOf(term);
      }
      // 模板/导航句常含查询词却不是答案：降权，不禁止（有时确实是唯一出处）。
      if (gain > 0 && BOILERPLATE.test(candidate.text)) gain *= BOILERPLATE_PENALTY;
      // 问句类型与句式匹配的句子更像答案（见 QUESTION_PATTERNS）。
      if (gain > 0) gain *= questionPatternBoost(question, candidate.text);
      if (gain > bestGain) {
        bestGain = gain;
        best = candidate;
      }
    }
    if (!best || bestGain === 0) break;
    picked.push(best);
    for (const term of terms) {
      if (best.text.toLowerCase().includes(term.toLowerCase())) covered.add(term);
    }
  }
  if (!picked.length) return null;

  picked.sort((a, b) => a.line - b.line);
  const missing = terms.filter((term) => !covered.has(term));
  const coveredWeight = terms
    .filter((term) => covered.has(term))
    .reduce((sum, term) => sum + weightOf(term), 0);
  return {
    sentences: picked,
    evidence: { path: hit.path, title: hit.title, heading: hit.heading, kind: hit.kind, sectionLine: hit.line },
    coverage: totalWeight > 0 ? coveredWeight / totalWeight : 0,
    missing,
    excerptOnly: false,
  };
}

/** PDF 命中没有正文：只能给页摘录，并且必须标成摘录（不能冒充逐字答案）。 */
export function answerFromExcerpt(hit: DocHit, terms: string[]): AnswerDraft | null {
  const text = stripMarkdown(hit.excerpt ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const covered = terms.filter((term) => lower.includes(term.toLowerCase()));
  if (!covered.length) return null;
  return {
    sentences: [{ text, line: hit.line }],
    evidence: { path: hit.path, title: hit.title, heading: hit.heading, kind: hit.kind, sectionLine: hit.line },
    coverage: terms.length ? covered.length / terms.length : 0,
    missing: terms.filter((term) => !covered.includes(term)),
    excerptOnly: true,
  };
}

/**
 * 对一组已排序的命中段落做「答案 + 出处」。
 *
 * `loadText` 由调用方注入（浏览器用 `import.meta.glob` 懒加载；Node 测试直接读盘），
 * 这里只保证：命中顺序、覆盖度择优、PDF 摘录降级、证据不足返回 null。
 */
export async function answerHits(
  question: string,
  hits: DocHit[],
  loadText: (path: string) => Promise<string | null>,
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const config = { ...DEFAULTS, ...options };
  const terms = queryTerms(question);
  const stats = config.stats;
  /**
   * 「点名标识符」：问题里出现 df ≤ 150 的拉丁标识符（sm4 / zuc / ml-kem / hmac），
   * 答案句必须含它——否则会出现「问 ML-KEM 三步、答到能力总览」这种看似有覆盖度、
   * 实际换了话题的答案。这是负例拒答的主要闸门。
   */
  /**
   * 反换话题的闸门放在**文档级**而不是句子级：答案所在文档的路径或标题里必须出现
   * 问题点名的拉丁实体（问 ML-KEM，出处就得是 `fips203-ML-KEM` 这种页）。
   *
   * 为什么用「问题里的拉丁串」而不是分词结果：分词会把 `ML-KEM` 拆成 ml / kem，
   * `ml` 这种短词在能力总览页里也出现，闸门就形同虚设；保留连字符的整串才是实体。
   * 代价是 `Ed25519`/`SHA-256` 这类「文档标识换了写法」的问题会拒答——宁可少答，
   * 不可答错（拒答给「找不到依据」，答错是错误答案）。
   */
  const anchorPhrases = (question.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [])
    .map((phrase) => phrase.toLowerCase())
    .filter((phrase) => !ANCHOR_STOPWORDS.has(phrase) && (!stats || stats.df(phrase) > 0));
  const identityOf = (draft: AnswerDraft): string =>
    `${draft.evidence.path} ${draft.evidence.title}`.toLowerCase();
  const aboutAnchor = (draft: AnswerDraft): boolean => {
    if (!anchorPhrases.length) return true;
    const identity = identityOf(draft);
    return anchorPhrases.some((phrase) => identity.includes(phrase));
  };

  const drafts: AnswerDraft[] = [];
  for (const hit of hits.slice(0, config.maxSections)) {
    if (hit.kind === 'pdf') {
      const excerptDraft = answerFromExcerpt(hit, terms);
      if (excerptDraft) drafts.push(excerptDraft);
      continue;
    }
    const markdown = await loadText(hit.path);
    if (!markdown) continue;
    const draft = answerFromDocument(markdown, hit, question, terms, config);
    if (draft) drafts.push(draft);
  }
  if (!drafts.length) return { best: null, others: [], terms, missing: terms };

  // 降序：覆盖度 → 点名标识符覆盖数 → 命中顺序（稳定排序保留检索名次）。
  drafts.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    const anchorHit = (draft: AnswerDraft): number => (aboutAnchor(draft) ? 1 : 0);
    return anchorHit(b) - anchorHit(a);
  });
  const [head, ...rest] = drafts;
  const namedMissed = aboutAnchor(head) ? [] : anchorPhrases;
  const acceptable = head.coverage >= config.minCoverage && namedMissed.length === 0;
  const missing = namedMissed.length ? namedMissed : head.missing;
  return {
    best: acceptable ? head : null,
    others: acceptable ? rest : drafts,
    terms,
    missing,
  };
}

/**
 * 从文档索引的倒排表构造词统计（IDF/DF），供答案层加权。
 *
 * 与 `doc-search.ts` 的 BM25 同一口径（同一个 post 表、同一个 idf 公式），
 * 保证「检索觉得这个词稀有」与「答案觉得这句更具体」是同一种稀有。
 */
export function indexTermStats(index: { secs: unknown[]; post: Record<string, number[]> }): TermStats {
  const total = index.secs.length;
  const df = (term: string): number => (index.post[term]?.length ?? 0) / 2;
  return {
    df,
    idf: (term: string): number => Math.log(1 + (total - df(term) + 0.5) / (df(term) + 0.5)),
  };
}
