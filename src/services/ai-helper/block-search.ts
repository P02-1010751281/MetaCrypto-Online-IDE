/**
 * 块检索内核（纯函数：无 `fs`、无 Blockly、无 DOM）。
 *
 * 为什么放在 `src/`：D 线（查块）的产品形态是浏览器里的检索，而它的判据（recall@5）
 * 一直是 `scripts/ai-helper-blocksearch.ts` 在用 Node 跑的。把打分与过滤抽到这里以后，
 * 脚本只负责「建索引 + 打表」，界面只负责「输入 + 展示」，两边不会各写一套打分。
 *
 * 索引结构见 `block-index.json`：构建期由脚本从 `BLOCK-IO-CONTRACT.json`、代码签名
 * （`code-signatures.json`）以及真实 Blockly 块的显示文本/下拉选项/tooltip 生成。
 *
 * 打分口径的取舍（都是实测结论，改动前先看 `experiments/ai-helper-2026-11-14/RESULTS.md` §12–§13）：
 *   - tooltip 只留在索引里供解释，**不参与打分**：长文本字段的偶然命中会把标签命中压下去；
 *   - 下拉选项参与打分且权重较高（4）：`bit_operation` 一类块的算子只出现在选项里；
 *   - 纯数字词元在 `search-terms.buildTerms` 里已降权（`32`/`64` 这类只是限定词）。
 */

import { buildTerms } from './search-terms';

export interface IndexInput {
  name: string;
  type: number;
  check: string[] | null;
}

export interface IndexEntry {
  blockType: string;
  inputs: IndexInput[];
  outputCheck: string[] | null;
  previousStatement: string[] | null;
  nextStatement: string[] | null;
  pythonTemplate: string;
  pythonDefinitions: string[];
  labels: { en: string[]; zh: string[] };
  /** 块内下拉字段的全部选项文本（含非默认项）；很多块的算子/模式只在这里出现。 */
  options: string[];
  /** 块的工具提示：常写出块名里没有的语义（如 ccm_b0「CCM 首块 B0…CBC-MAC 的起始块」）。 */
  tooltips: { en: string; zh: string };
}

export interface BlockIndex {
  schemaVersion: number;
  sources: Record<string, { path: string; contentFnv1a64: string }>;
  stats: {
    blockTypes: number;
    labelCoverage: { en: { labeled: number; total: number }; zh: { labeled: number; total: number } };
    localizedZh: number;
    unlabeled: { en: string[]; zh: string[] };
    creationErrors: Array<{ blockType: string; locale: string; error: string }>;
  };
  blocks: IndexEntry[];
}

export interface MatchedReason {
  source: string;
  term: string;
  evidence: string;
}

export interface SearchHit {
  blockType: string;
  score: number;
  matched: MatchedReason[];
  labels: IndexEntry['labels'];
  inputs: IndexInput[];
  outputCheck: string[] | null;
}

export interface SearchOptions {
  inTypes: string[];
  outTypes: string[];
  text: string | null;
  limit: number;
  allowTextless?: boolean;
}

export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const TERM_FIELDS: Array<{ source: string; weight: number; text: (entry: IndexEntry) => string }> = [
  { source: 'label.zh', weight: 6, text: (block) => block.labels.zh.join(' ') },
  { source: 'label.en', weight: 5.5, text: (block) => block.labels.en.join(' ') },
  { source: 'option', weight: 4, text: (block) => block.options.join(' ') },
  // tooltip 只留在索引里供解释，不参与打分：实测长文本字段的偶然命中会把标签命中压下去
  // （第二轮留出集 g02 由命中变未命中）。要再启用必须带字段长度归一化。
  { source: 'blockType', weight: 3.5, text: (block) => block.blockType.replace(/_/g, ' ') },
  {
    source: 'input',
    weight: 2.2,
    text: (block) => block.inputs.map((input) => `${input.name} ${(input.check ?? []).join(' ')}`).join(' '),
  },
  { source: 'definition', weight: 1.6, text: (block) => block.pythonDefinitions.join(' ') },
  { source: 'python', weight: 1.2, text: (block) => block.pythonTemplate },
];

export function scoreBlock(
  block: IndexEntry,
  terms: ReturnType<typeof buildTerms>,
): { score: number; matched: MatchedReason[] } {
  const cache = new Map<string, string>();
  const haystackOf = (source: string, resolver: (entry: IndexEntry) => string): string => {
    const cached = cache.get(source);
    if (cached != null) return cached;
    const value = resolver(block).toLowerCase();
    cache.set(source, value);
    return value;
  };
  let score = 0;
  const matched: MatchedReason[] = [];
  for (const field of TERM_FIELDS) {
    const haystack = haystackOf(field.source, field.text);
    if (!haystack) continue;
    for (const { term, weight, via } of terms) {
      if (!haystack.includes(term)) continue;
      let gained = field.weight * weight;
      if (field.source === 'blockType' && ` ${haystack} `.includes(` ${term} `)) gained += 1.5 * weight;
      if ((field.source === 'label.en' || field.source === 'label.zh') && haystack === term) gained += 2 * weight;
      score += gained;
      if (matched.length < 8) {
        const base =
          field.source === 'input'
            ? `输入 ${block.inputs.map((input) => input.name).filter(Boolean).join('/')} 含 ${term}`
            : `${field.source} 含 "${term}"`;
        matched.push({ source: field.source, term, evidence: via ? `${base}（${via}）` : base });
      }
    }
  }
  return { score, matched };
}

const hasInputType = (block: IndexEntry, typeName: string): boolean =>
  block.inputs.some(
    (input) => input.type === 1 && (input.check ?? []).some((check) => check.toLowerCase() === typeName.toLowerCase()),
  );

const hasOutputType = (block: IndexEntry, typeName: string): boolean =>
  (block.outputCheck ?? []).some((check) => check.toLowerCase() === typeName.toLowerCase());

/** 结构化过滤（输入/输出类型）+ 文本打分，按分数降序、同分按块类型字典序。 */
export function search(index: BlockIndex, options: SearchOptions): SearchHit[] {
  const terms = options.text ? buildTerms(options.text) : [];
  const hits: SearchHit[] = [];
  for (const block of index.blocks) {
    if (options.inTypes.length && !options.inTypes.every((typeName) => hasInputType(block, typeName))) continue;
    if (options.outTypes.length && !options.outTypes.every((typeName) => hasOutputType(block, typeName))) continue;
    const { score, matched } = scoreBlock(block, terms);
    for (const typeName of options.inTypes) {
      const names = block.inputs
        .filter((input) => (input.check ?? []).some((check) => check.toLowerCase() === typeName.toLowerCase()))
        .map((input) => input.name)
        .filter(Boolean);
      matched.push({ source: 'input', term: typeName, evidence: `输入 ${names.join('/')} 的 check 含 ${typeName}` });
    }
    for (const typeName of options.outTypes) {
      matched.push({ source: 'output', term: typeName, evidence: `outputCheck 含 ${typeName}` });
    }
    hits.push({
      blockType: block.blockType,
      score,
      matched,
      labels: block.labels,
      inputs: block.inputs,
      outputCheck: block.outputCheck,
    });
  }
  const filtered = options.text && !options.allowTextless ? hits.filter((hit) => hit.score > 0) : hits;
  filtered.sort((a, b) => (b.score !== a.score ? b.score - a.score : compareCodePoint(a.blockType, b.blockType)));
  return filtered.slice(0, options.limit);
}
