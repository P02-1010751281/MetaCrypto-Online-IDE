/**
 * 文档检索的分词口径（构建期建索引与运行时查询共用同一份实现）。
 *
 * 语料是中文为主、夹杂英文术语与积木 ID 的 Markdown，所以：
 * - 拉丁词保留整词（`aes_add_round_key`）**并**拆出长度 ≥3 的片段（`aes` / `round` / `key`），
 *   否则用户只记得「aes」时整词匹配不到；
 * - 中文按「单字 + 二元组」出词：二元组承担精度，单字兜住「S 盒」「模加」这类短词；
 * - 代码围栏与行内代码里的标识符是有效语料，不能整段丢弃，只剥掉标记符号。
 *
 * 这里刻意不做停用词表：中文停用词会牵动 BM25 的 idf 分布，先让 idf 自己压低高频词。
 */

/** CJK 统一表意文字 + 日文假名 + 谚文：按字切词即可。 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/** 去掉 Markdown 标记但保留文字内容（链接留文字、代码留内容）。 */
export function stripMarkdown(input: string): string {
  let text = input;
  // YAML frontmatter
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ' ');
  // 图片整块丢弃（alt 通常是文件名噪音）
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // 链接与引用式链接：只留文字
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ');
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, ' $1 ');
  // HTML 标签（含 <br>、<details> 等）
  text = text.replace(/<[^>]+>/g, ' ');
  // 标题井号、强调、行内代码反引号、表格竖线
  text = text.replace(/[#>*`|~]/g, ' ');
  return text;
}

export interface RawTerm {
  term: string;
  /** 中文连续串里「左右都还有二元组」的中间词（`密钥协商` 的 `钥协`）。 */
  bridging: boolean;
  /** 相邻的二元组（仅对 CJK 二元组有意义），用于判断交叉词是不是噪音。 */
  left?: string;
  right?: string;
}

export function rawTerms(input: string): RawTerm[] {
  const text = stripMarkdown(input).toLowerCase();
  const out: RawTerm[] = [];

  const latin = /[a-z0-9][a-z0-9._-]*/g;
  let match: RegExpExecArray | null;
  while ((match = latin.exec(text)) !== null) {
    const raw = match[0].replace(/[._-]+$/, '');
    if (raw.length < 2) continue;
    out.push({ term: raw, bridging: false });
    for (const part of raw.split(/[._-]+/)) {
      if (part.length >= 3 && part !== raw) out.push({ term: part, bridging: false });
    }
  }

  // 「S 盒」「k 值」这类「单字母 + 中文字」的混写：单字母本身进不了倒排（单词长度 1），
  // 但合成一个词（s盒）精度很高，所以只在字母与中文相邻时补一个合成词。
  const adjacent = /([a-z0-9])\s*([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff])/g;
  while ((match = adjacent.exec(text)) !== null) {
    out.push({ term: match[1] + match[2], bridging: false });
  }

  // 按 CJK 连续串处理：串内二元组有位置，才能判断中间词。
  const chars = Array.from(text);
  let index = 0;
  while (index < chars.length) {
    if (!CJK.test(chars[index])) {
      index += 1;
      continue;
    }
    const run: number[] = [];
    while (index < chars.length && CJK.test(chars[index])) {
      run.push(index);
      index += 1;
    }
    for (let offset = 0; offset < run.length; offset += 1) {
      out.push({ term: chars[run[offset]], bridging: false });
      if (offset + 1 < run.length) {
        const left = offset > 0;
        const right = offset + 2 < run.length;
        out.push({
          term: chars[run[offset]] + chars[run[offset + 1]],
          bridging: left && right,
          left: left ? chars[run[offset - 1]] + chars[run[offset]] : undefined,
          right: right ? chars[run[offset + 1]] + chars[run[offset + 2]] : undefined,
        });
      }
    }
  }
  return out;
}

/** 把一个 Markdown 片段切成检索词（拉丁整词 + 片段、中文单字 + 二元组）。 */
export function tokenize(input: string): string[] {
  return rawTerms(input).map((entry) => entry.term);
}

/** 词频表：同一个词在片段里出现几次。 */
export function termFreq(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const term of tokenize(text)) freq.set(term, (freq.get(term) ?? 0) + 1);
  return freq;
}

/** 查询侧停用词：只影响「用户这句话里哪些词算检索意图」，索引里仍保留全部词。 */
const STOPWORDS = new Set([
  // 中文功能词（单字）
  '的', '了', '是', '在', '和', '与', '及', '或', '中', '对', '把', '被', '让', '用', '做', '有', '无',
  '个', '种', '里', '时', '后', '前', '上', '下', '吗', '呢', '吧', '就', '也', '都', '很', '更', '最',
  '这', '那', '些', '其', '为', '以', '于', '从', '到', '向', '给', '并', '而', '但', '如', '若', '则',
  '之', '着', '过', '得', '地', '你', '我', '他', '她', '它', '们',
  // 中文功能词（二元组）
  '如何', '怎么', '怎样', '什么', '哪些', '哪个', '为何', '是否', '可以', '需要', '应该', '分别',
  '我们', '你们', '他们', '一下', '请问', '这个', '那个', '这样', '那样', '因此', '所以', '但是',
  '如果', '就是', '不是', '没有', '一个', '一种', '以及', '进行', '通过', '使用', '用于', '怎么',
  '多少', '几个', '时候', '地方', '东西',
  // 英文功能词
  'how', 'what', 'which', 'who', 'when', 'where', 'why', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'the', 'an', 'of', 'to', 'in', 'into', 'on', 'at', 'by', 'for', 'with', 'without', 'and',
  'or', 'not', 'no', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may',
  'might', 'must', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'from', 'about', 'defined',
]);

/** 查询侧去重（保留首次出现顺序），同一个词只贡献一次 idf。 */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of rawTerms(query)) {
    const term = entry.term;
    if (STOPWORDS.has(term)) continue;
    if (seen.has(term)) continue;
    // 二元组里只要有停用字（的签 / 商怎 / 么共），就不算检索意图。
    // 交叉二元组（密钥协商 的 钥协）由检索层按语料 df 判掉，这里不动。
    if (term.length === 2 && CJK.test(term[0]) && CJK.test(term[1])) {
      if (STOPWORDS.has(term[0]) || STOPWORDS.has(term[1])) continue;
    }
    seen.add(term);
    out.push(term);
  }
  return out;
}


/** 查询计划：保留 bridging/left/right 信息，供检索层按 df 剔除交叉词噪音。 */
export function queryPlan(query: string): RawTerm[] {
  const seen = new Set<string>();
  const out: RawTerm[] = [];
  for (const entry of rawTerms(query)) {
    if (STOPWORDS.has(entry.term)) continue;
    if (seen.has(entry.term)) continue;
    if (entry.term.length === 2 && CJK.test(entry.term[0]) && CJK.test(entry.term[1])) {
      if (STOPWORDS.has(entry.term[0]) || STOPWORDS.has(entry.term[1])) continue;
    }
    seen.add(entry.term);
    out.push(entry);
  }
  return out;
}
