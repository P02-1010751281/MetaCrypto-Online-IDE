/**
 * 跨域联动：把一条检索结果翻成另一个检索框的查询词。
 *
 * 为什么单独成模块：派生规则是**量出来的**，不是拍的（2026-11-16 在真实索引上实测，
 * 见 `experiments/ai-helper-2026-11-14/RESULTS.md` §23）：
 *
 *   - 文档 → 积木：取路径与标题里的拉丁标识符，只看与块索引词表（blockType 段 + 标签拉丁词）
 *     相交的那些，长词优先、最多 2 个。实测 437 篇里 254 篇可派生，`docsearch-eval` 的
 *     30 条期望文档里 28 条派生出的查询词让 top1 落在同名算法块上。
 *     纯中文标题（审计页、指南页）没有交集，退回标题原文当查询词：宁可给用户一个可见、
 *     可编辑的查询词，也不做「点了没反应」的按钮。
 *   - 积木 → 文档：块的中文标签（无则英文标签，再无则 blockType 拆词），去掉标签占位用的
 *     括号/冒号/逗号。实测 222 个块里 200 个能查到 ≥1 篇文档，且首条多是它对应的标准页
 *     （`AES AddRoundKey(` → `docs/standards/fips197-AES/03-MixColumns-AddRoundKey.md`）。
 *
 * 两条规则都只产查询词、不发请求：真正检索仍由 `doc-search` / `block-search` 各跑各的，
 * 联动不会改动两边已有的 recall 判据。
 */

export interface DocLinkSource {
  path: string;
  title: string;
}

export interface BlockLinkSource {
  blockType: string;
  labels: { en: string[]; zh: string[] };
}

/** 目录名/文件名里的通用词：它们出现在几乎每个块或每篇文档里，没有区分度。 */
const GENERIC_TOKENS = new Set([
  'readme', 'docs', 'doc', 'en', 'md', 'index', 'guide', 'guides', 'demo', 'demos',
  'standard', 'standards', 'paper', 'api', 'spec', 'src', 'tests', 'test', 'build',
  'audit', 'audits', 'report', 'reports', 'lib', 'utils', 'core', 'main',
]);

const TOKEN_SPLIT = /[^A-Za-z0-9]+/;

/** 块索引里出现过的标识符词表（blockType 段 + 标签里的拉丁词），小写。 */
export function blockVocabulary(index: { blocks: BlockLinkSource[] }): Set<string> {
  const vocabulary = new Set<string>();
  for (const block of index.blocks) {
    for (const part of block.blockType.split('_')) {
      if (part) vocabulary.add(part.toLowerCase());
    }
    for (const label of [...block.labels.en, ...block.labels.zh]) {
      for (const token of label.split(TOKEN_SPLIT)) {
        if (token) vocabulary.add(token.toLowerCase());
      }
    }
  }
  return vocabulary;
}

export interface BlockLink {
  query: string;
  /**
   * 查询词是否真的来自块词表交集。
   *
   * 界面据此决定按钮显不显示：实测 383 篇有交集的文档**全部**能查到 ≥1 个块，
   * 而 54 篇纯中文标题（审计页/指南页）回退成标题原文后只有 19 篇有命中——
   * 给一个点了必然落空的按钮，比不给按钮更糟。
   */
  linked: boolean;
}

/**
 * 文档命中 → 块检索查询词（带「是否可联动」标记）。
 *
 * 先按词表交集取（长词优先：`sha256` 比 `sha` 具体），交集为空时退回标题原文，
 * 两种情况都不返回「半个词」。
 */
export function docToBlockLink(doc: DocLinkSource, vocabulary: ReadonlySet<string>, limit = 2): BlockLink {
  const tokens = `${doc.path} ${doc.title}`
    .split(TOKEN_SPLIT)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token));
  const usable = [...new Set(tokens.filter((token) => vocabulary.has(token)))];
  // 长度降序 + 字典序兜底：同一条文档每次派生出同一个查询词，判据才可复现。
  usable.sort((a, b) => (b.length !== a.length ? b.length - a.length : a < b ? -1 : a > b ? 1 : 0));
  const picked = usable.slice(0, limit);
  if (picked.length) return { query: picked.join(' '), linked: true };
  return { query: doc.title.trim(), linked: false };
}

/** 只要查询词（脚本/测试用）；界面要区分「可联动」时用 `docToBlockLink`。 */
export function docToBlockQuery(doc: DocLinkSource, vocabulary: ReadonlySet<string>, limit = 2): string {
  return docToBlockLink(doc, vocabulary, limit).query;
}

/** 标签里的占位标点不是词：`AES AddRoundKey( , rk:` 只该留下 `AES AddRoundKey rk`。 */
function normalizeLabelQuery(text: string): string {
  return text
    .replace(/[()[\]{}:：,，;；、|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 块命中 → 文档检索查询词：中文标签优先，其次英文标签，去掉标点后为空再退回 blockType。 */
export function blockToDocQuery(block: BlockLinkSource): string {
  const zh = block.labels.zh.filter(Boolean).join(' ').trim();
  const en = block.labels.en.filter(Boolean).join(' ').trim();
  const fromLabels = normalizeLabelQuery(zh || en);
  if (fromLabels) return fromLabels;
  return normalizeLabelQuery(block.blockType.replace(/_/g, ' '));
}
