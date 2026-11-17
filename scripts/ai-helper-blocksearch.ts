/**
 * D 线「查块」内核（用户侧 AI Helper · 独立检索助手）
 *
 * 两段式：构建期建索引，运行时纯本地查询（不联网、不接模型）。
 *   index：读 BLOCK-IO-CONTRACT.json + code-signatures.json，再用 jsdom+Blockly 起活工作区，
 *          按 en / zh-hans 各取一遍块的真实显示文本；取不到的留空并计入覆盖率。
 *   query：结构化过滤（--in 值输入 check 含该类型，--out outputCheck 含该类型）+ 文本打分
 *          （块类型、中英标签、python 模板、definitions、输入槽名/类型）；每条结果带 matched。
 *   eval：跑 blocksearch-queries.json 的 30 条真实意图查询，算 recall@5 并写 track 报告。
 *
 * 排序确定性：分数降序 → blockType 字典序（逐字符比较）。type=5 是语句输入（check 为 null），
 * 不参与 --in 过滤；--in 只认 type=1 的值输入。
 *
 * 复跑（隔离构建，勿用 verify:build / verify:all）：
 *   AIVERIFY_ENTRY=scripts/ai-helper-blocksearch.ts AIVERIFY_OUTDIR=dist-verify/track-blocksearch \
 *     npx vite build --config vite.verify.config.ts
 *   node dist-verify/track-blocksearch/ai-helper-blocksearch.js index
 *   node dist-verify/track-blocksearch/ai-helper-blocksearch.js eval
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  compareCodePoint,
  search,
  type BlockIndex,
  type IndexEntry,
  type SearchHit,
  type SearchOptions,
} from '@/services/ai-helper/block-search';

import { bootBlockly } from './ai-helper-workspace-boot';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out');
const CONTRACT_PATH = 'docs/blocks/BLOCK-IO-CONTRACT.json';
const SIGNATURES_PATH = 'experiments/ai-helper-2026-11-14/out/code-signatures.json';
const INDEX_PATH = resolve(OUT_DIR, 'block-index.json');
/** 运行时副本：浏览器侧检索直接读它（`src/services/ai-helper/block-search.ts` 的口径）。 */
const PRODUCT_INDEX_PATH = resolve(process.cwd(), 'src/services/ai-helper/block-index.json');
const QUERIES_PATH = resolve(OUT_DIR, 'blocksearch-queries.json');
const REPORT_PATH = resolve(OUT_DIR, 'track-blocksearch.json');
const HARD_QUERIES_PATH = resolve(OUT_DIR, 'blocksearch-queries-hard.json');
const HARD_REPORT_PATH = resolve(OUT_DIR, 'track-blocksearch-hard.json');
const TARGET_RECALL = 0.8;

// ---------------------------------------------------------------- 类型

interface RawInput { name?: unknown; type?: unknown; check?: unknown }
interface RawContractEntry { inputs?: RawInput[]; outputCheck?: unknown; previousStatement?: unknown; nextStatement?: unknown }
interface RawSignature { type?: unknown; python?: { template?: unknown; definitions?: unknown } }
interface FieldLike { getText?: () => unknown; getValue?: () => unknown; getOptions?: (useCache?: boolean) => unknown }
interface LiveLabelBlock { inputList: Array<{ fieldRow?: FieldLike[] }>; dispose: () => void; getTooltip?: () => unknown }
interface LiveWorkspace { newBlock: (type: string) => LiveLabelBlock; dispose: () => void }
interface Runtime { Workspace: new () => LiveWorkspace }
// ---------------------------------------------------------------- 小工具

function asStringArray(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === 'string');
  return out.length ? out : null;
}
/** FNV-1a 64 位：只用于来源内容变更检测，不是密码学摘要（构建脚本不引 node:crypto）。 */
function contentHash(text: string): string {
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
function meaningfulLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------- 索引

async function applyLocale(locale: 'en' | 'zh-hans'): Promise<void> {
  const core = await import('blockly/core');
  if (locale === 'en') core.setLocale(await import('blockly/msg/en'));
  else core.setLocale(await import('blockly/msg/zh-hans'));
  // 块自定义消息（CRYPTO_* / PROC_* 等）在 MetaCrypto Online IDE 的 locale 模块里，不属于 Blockly 上游词表。
  const custom = await import('@/composables/locale');
  const messages = locale === 'en' ? custom.MESSAGES_EN : custom.MESSAGES_ZH_HANS;
  Object.assign(core.Msg as Record<string, string>, messages);
}
function fieldText(field: FieldLike): string | null {
  if (typeof field.getText === 'function') {
    const text = field.getText();
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  if (typeof field.getValue === 'function') {
    const value = field.getValue();
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function fieldOptions(field: FieldLike): string[] {
  if (typeof field.getOptions !== 'function') return [];
  try {
    const raw = field.getOptions(false);
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      // FieldDropdown 的选项是 [显示文本, 语言无关值]；也容忍纯字符串/对象形式。
      const label = Array.isArray(item) ? item[0] : typeof item === 'string' ? item : (item as { text?: unknown })?.text;
      if (typeof label === 'string') out.push(label);
    }
    return meaningfulLabels(out);
  } catch {
    return [];
  }
}

function collectLabels(runtime: Runtime, blockType: string): { labels: string[]; options: string[]; tooltip: string; error: string | null } {
  const workspace = new runtime.Workspace();
  try {
    const block = workspace.newBlock(blockType);
    const labels: string[] = [];
    const options: string[] = [];
    for (const input of block.inputList) {
      for (const field of input.fieldRow ?? []) {
        const text = fieldText(field);
        if (text) labels.push(text);
        options.push(...fieldOptions(field));
      }
    }
    const rawTooltip = typeof block.getTooltip === 'function' ? block.getTooltip() : null;
    const tooltip = typeof rawTooltip === 'string' ? rawTooltip.trim() : '';
    block.dispose();
    return { labels: meaningfulLabels(labels), options: meaningfulLabels(options), tooltip, error: null };
  } catch (caught) {
    return { labels: [], options: [], tooltip: '', error: errorText(caught) };
  } finally {
    workspace.dispose();
  }
}
const asInputs = (raw: RawInput[] | undefined): IndexInput[] => (raw ?? []).map((input) => ({
  name: typeof input.name === 'string' ? input.name : '',
  type: typeof input.type === 'number' ? input.type : 1,
  check: asStringArray(input.check),
}));
async function runIndex(): Promise<void> {
  const contractText = readFileSync(resolve(ROOT, CONTRACT_PATH), 'utf8');
  const signaturesText = readFileSync(resolve(ROOT, SIGNATURES_PATH), 'utf8');
  const contract = JSON.parse(contractText) as Record<string, RawContractEntry>;
  const signatureFile = JSON.parse(signaturesText) as { signatures?: RawSignature[] };
  const signatures = new Map<string, RawSignature>();
  for (const signature of signatureFile.signatures ?? []) {
    if (typeof signature.type === 'string') signatures.set(signature.type, signature);
  }
  const blockTypes = Object.keys(contract).sort(compareCodePoint);
  const runtime = (await bootBlockly()) as unknown as Runtime;
  const labelsByType = new Map<string, { en: string[]; zh: string[] }>();
  const optionsByType = new Map<string, string[]>();
  const tooltipByType = new Map<string, { en: string; zh: string }>();
  const creationErrors: Array<{ blockType: string; locale: string; error: string }> = [];
  for (const locale of ['en', 'zh-hans'] as const) {
    await applyLocale(locale);
    for (const blockType of blockTypes) {
      const { labels, options, tooltip, error } = collectLabels(runtime, blockType);
      const slot = labelsByType.get(blockType) ?? { en: [], zh: [] };
      if (locale === 'en') slot.en = labels;
      else slot.zh = labels;
      labelsByType.set(blockType, slot);
      if (options.length) {
        const merged = new Set(optionsByType.get(blockType) ?? []);
        for (const option of options) merged.add(option);
        optionsByType.set(blockType, [...merged].sort(compareCodePoint));
      }
      if (tooltip) {
        const slot = tooltipByType.get(blockType) ?? { en: '', zh: '' };
        if (locale === 'en') slot.en = tooltip;
        else slot.zh = tooltip;
        tooltipByType.set(blockType, slot);
      }
      if (error) creationErrors.push({ blockType, locale, error });
    }
  }
  const blocks: IndexEntry[] = blockTypes.map((blockType) => {
    const raw = contract[blockType] ?? {};
    const signature = signatures.get(blockType);
    const labels = labelsByType.get(blockType) ?? { en: [], zh: [] };
    return {
      blockType, inputs: asInputs(raw.inputs), outputCheck: asStringArray(raw.outputCheck),
      previousStatement: asStringArray(raw.previousStatement), nextStatement: asStringArray(raw.nextStatement),
      pythonTemplate: typeof signature?.python?.template === 'string' ? signature.python.template : '',
      pythonDefinitions: asStringArray(signature?.python?.definitions) ?? [],
      labels: { en: labels.en, zh: labels.zh },
      options: optionsByType.get(blockType) ?? [],
      tooltips: tooltipByType.get(blockType) ?? { en: '', zh: '' },
    };
  });
  const coverage = (locale: 'en' | 'zh') => {
    const unlabeled = blocks.filter((block) => block.labels[locale].length === 0).map((block) => block.blockType);
    return { labeled: blocks.length - unlabeled.length, total: blocks.length, unlabeled };
  };
  const en = coverage('en');
  const zh = coverage('zh');
  const localizedZh = blocks.filter((block) => block.labels.zh.join('|') !== block.labels.en.join('|')).length;
  const withOptions = blocks.filter((block) => block.options.length > 0);
  const optionTextCount = withOptions.reduce((sum, block) => sum + block.options.length, 0);
  const withTooltip = blocks.filter((block) => block.tooltips.zh || block.tooltips.en).length;
  const index: BlockIndex = {
    schemaVersion: 1,
    sources: {
      contract: { path: CONTRACT_PATH, contentFnv1a64: contentHash(contractText) },
      signatures: { path: SIGNATURES_PATH, contentFnv1a64: contentHash(signaturesText) },
    },
    stats: {
      blockTypes: blocks.length, localizedZh, creationErrors,
      labelCoverage: { en: { labeled: en.labeled, total: en.total }, zh: { labeled: zh.labeled, total: zh.total } },
      unlabeled: { en: en.unlabeled, zh: zh.unlabeled },
    },
    blocks,
  };
  const serialized = `${JSON.stringify(index, null, 2)}\n`;
  writeFileSync(INDEX_PATH, serialized);
  writeFileSync(PRODUCT_INDEX_PATH, serialized);
  console.log(`已写 ${INDEX_PATH}`);
  console.log(`块类型 ${blocks.length}；有显示文本 en ${en.labeled}/${en.total}，zh ${zh.labeled}/${zh.total}；中英标签不同 ${localizedZh}`);
  console.log(`带下拉选项的块 ${withOptions.length} 个，选项文本共 ${optionTextCount} 条；带 tooltip 的块 ${withTooltip} 个`);
  if (creationErrors.length) console.log(`块实例化失败 ${creationErrors.length} 次（已计入未覆盖）`);
}
function loadIndex(): BlockIndex {
  const index = readJson(INDEX_PATH) as BlockIndex;
  if (!Array.isArray(index.blocks) || index.blocks.length === 0) {
    throw new Error(`索引为空或不可读：${INDEX_PATH}，先跑 index`);
  }
  return index;
}

// ---------------------------------------------------------------- 查询子命令

function parseQueryArgs(argv: string[]): SearchOptions {
  const options: SearchOptions = { inTypes: [], outTypes: [], text: null, limit: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextValue = (): string => {
      i += 1;
      const value = argv[i];
      if (value == null) throw new Error(`缺少 ${arg} 的值`);
      return value;
    };
    if (arg === '--in') options.inTypes.push(nextValue());
    else if (arg === '--out') options.outTypes.push(nextValue());
    else if (arg === '--text') options.text = nextValue();
    else if (arg === '--allow-textless') options.allowTextless = true;
    else if (arg === '--json') continue;
    else if (arg === '--limit') {
      const limit = Number(nextValue());
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须为正整数');
      options.limit = limit;
    } else {
      throw new Error(`未知参数 ${arg}`);
    }
  }
  if (!options.inTypes.length && !options.outTypes.length && !options.text) {
    throw new Error('至少要给 --in / --out / --text 之一');
  }
  return options;
}

function printHits(hits: SearchHit[], asJson: boolean, options: SearchOptions): void {
  if (asJson) {
    console.log(JSON.stringify({ query: options, results: hits }, null, 2));
    return;
  }
  if (!hits.length) {
    console.log('没有匹配的块。');
    return;
  }
  hits.forEach((hit, position) => {
    const labels = [...new Set([...hit.labels.zh, ...hit.labels.en])];
    console.log(`${position + 1}. ${hit.blockType}  score=${hit.score.toFixed(2)}`);
    if (labels.length) console.log(`   标签: ${labels.join(' | ')}`);
    const reasons = hit.matched.slice(0, 5).map((reason) => `${reason.source}:"${reason.term}" (${reason.evidence})`);
    console.log(`   命中: ${reasons.join('; ') || '仅结构过滤'}`);
  });
}

function runQuery(argv: string[]): void {
  const options = parseQueryArgs(argv);
  printHits(search(loadIndex(), options), argv.includes('--json'), options);
}

// ---------------------------------------------------------------- eval 子命令

interface EvalQuery { id: string; query?: string; in?: string[] | string; out?: string[] | string; text: string; expect: string[]; note?: string }
interface EvalRow {
  id: string; query: string; in: string[]; out: string[]; expected: string[];
  top5: Array<{ blockType: string; score: number; matched: MatchedReason[] }>;
  hit: boolean; covered: string[]; missingExpected: string[];
}

const asTypes = (value: string[] | string | undefined): string[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
async function runEval(queryPath = QUERIES_PATH, reportPath = REPORT_PATH): Promise<void> {
  const index = loadIndex();
  const queryFile = readJson(queryPath) as { queries?: EvalQuery[] };
  const queries = queryFile.queries ?? [];
  if (!queries.length) throw new Error(`没有可评测的查询：${queryPath}`);
  const rows: EvalRow[] = queries.map((entry) => {
    const options: SearchOptions = { inTypes: asTypes(entry.in), outTypes: asTypes(entry.out), text: entry.text, limit: 5 };
    const hits = search(index, options);
    const top5 = hits.map((hit) => ({ blockType: hit.blockType, score: hit.score, matched: hit.matched }));
    const topTypes = top5.map((hit) => hit.blockType);
    const covered = entry.expect.filter((type) => topTypes.includes(type));
    return {
      id: entry.id,
      query: entry.query ?? entry.text,
      in: options.inTypes,
      out: options.outTypes,
      expected: entry.expect,
      top5,
      hit: covered.length > 0,
      covered,
      missingExpected: entry.expect.filter((type) => !topTypes.includes(type)),
    };
  });
  const hits = rows.filter((row) => row.hit).length;
  const recallAt5 = rows.length ? hits / rows.length : 0;
  const meanExpectedRecall = rows.length
    ? rows.reduce((sum, row) => sum + row.covered.length / Math.max(row.expected.length, 1), 0) / rows.length
    : 0;
  const report = {
    schemaVersion: 1,
    index: { path: 'experiments/ai-helper-2026-11-14/out/block-index.json', blockTypes: index.stats.blockTypes, labelCoverage: index.stats.labelCoverage, localizedZh: index.stats.localizedZh },
    target: TARGET_RECALL, pass: recallAt5 >= TARGET_RECALL, recallAt5, meanExpectedRecall, queries: rows,
    misses: rows.filter((row) => !row.hit).map((row) => ({ id: row.id, query: row.query, expected: row.expected, top5: row.top5.map((hit) => hit.blockType) })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`recall@5 = ${(recallAt5 * 100).toFixed(1)}% (${hits}/${rows.length})，期望集合平均召回 ${(meanExpectedRecall * 100).toFixed(1)}%`);
  for (const row of rows.filter((item) => !item.hit)) {
    console.log(`未命中 ${row.id} 「${row.query}」期望 ${row.expected.join(', ')}；前5 ${row.top5.map((hit) => hit.blockType).join(', ')}`);
  }
  for (const row of rows.filter((item) => item.hit && item.missingExpected.length)) {
    console.log(`部分命中 ${row.id} 「${row.query}」缺 ${row.missingExpected.join(', ')}；前5 ${row.top5.map((hit) => hit.blockType).join(', ')}`);
  }
  console.log(`已写 ${reportPath}`);
}

// ---------------------------------------------------------------- 入口
function usage(): void {
  console.log('用法: ai-helper-blocksearch <index|query|eval|eval-hard> [选项]');
  console.log('  query --in <Type> --out <Type> --text <词> --limit N [--json]');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'index') {
    await runIndex();
    return;
  }
  if (command === 'query') {
    runQuery(rest);
    return;
  }
  if (command === 'eval') {
    // eval [查询文件] [报告文件]：不给参数就跑常规集，便于跑一次性留出集。
    await runEval(rest[0] ? resolve(ROOT, rest[0]) : QUERIES_PATH, rest[1] ? resolve(ROOT, rest[1]) : REPORT_PATH);
    return;
  }
  if (command === 'eval-hard') {
    await runEval(HARD_QUERIES_PATH, HARD_REPORT_PATH);
    return;
  }
  usage();
  process.exitCode = 1;
}
main().catch((caught: unknown) => {
  console.error(errorText(caught));
  process.exitCode = 1;
});
