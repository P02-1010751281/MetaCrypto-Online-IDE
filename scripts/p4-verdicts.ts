/**
 * P4 A 线纵向切片 · 第 2 段：三档判定器（能搭 / 部分 / 不能）
 *
 * 输入：experiments/ai-helper-2026-11-14/p4/anchors.json（第 1 段的条款锚点）+ 五个条目页
 *      + src/services/ai-helper/block-index.json（222 块的产品索引）+ 契约里的块类型集合。
 * 输出：experiments/ai-helper-2026-11-14/p4/verdicts.json
 *
 * 纪律（P4-SCOPE.md §3.2/§3.3/§2.3）：
 *   1. **不读「项目状态」字段**——语料里 39 处状态与映射互相矛盾，状态只作人工备注，不进判据。
 *   2. 三级证据：L1 = 条目「项目映射」点名的真实块（条款→块）；L2 = 块 tooltip 引标准号（块→条款，
 *      须与同条款的检索候选相交，避免把全库提到标准的块都算进来）；L3 = block-search BM25 候选。
 *      L3 只作候选，永不单独升级为「能搭」。
 *   3. 档位由**步骤表**算：每一步标 canvas（画布上可见的块/块组合）、internal（只在生成器闭包里）
 *      或 none（没有块）。全 canvas → build；全 none 或不可执行 → missing；其余 → partial。
 *      步骤表是人工语义分解（依据条目页的「公式或伪代码」与「标准定义」），档位是机器按规则算的。
 *   4. 语义等价永远 `unverified`：本脚本不判断块与标准逐行等价。
 *
 * 复跑（隔离构建，不碰 verify:build / verify:all）：
 *   AIVERIFY_ENTRY=scripts/p4-verdicts.ts AIVERIFY_OUTDIR=dist-verify/p4 \
 *     npx vite build --config vite.verify.config.ts && node dist-verify/p4/p4-verdicts.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { search, type BlockIndex, type SearchHit } from '@/services/ai-helper/block-search';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'experiments/ai-helper-2026-11-14/p4');
const ANCHORS = resolve(OUT_DIR, 'anchors.json');
const VERDICTS = resolve(OUT_DIR, 'verdicts.json');
const INDEX = resolve(ROOT, 'src/services/ai-helper/block-index.json');
const MANIFEST = resolve(ROOT, 'docs/standards/standards-manifest.json');
const STANDARD_ID = 'fips180-4-SHA2';
const STANDARD_NUMBER_RE = /FIPS\s*180-4|180-4/i;

type Tier = 'build' | 'partial' | 'missing';
type Visibility = 'canvas' | 'internal' | 'none';
type Layer = 'L1' | 'L2' | 'L3' | 'none';

interface ClauseStep {
  id: string;
  section: string;
  text: string;
  blocks: string[];
  visibility: Visibility;
  note?: string;
}

interface ClauseModel {
  entryId: string;
  nonExecutable?: string;
  steps: ClauseStep[];
  /** 标准要求但块模型不表达的约束：单列，不参与档位计算。 */
  claimBoundaries: string[];
  extraGaps: string[];
}

interface AnchorFile {
  counts: Record<string, number>;
  standard: { id: string; name: string; version: string; source_checked_at: string; artifacts: Array<{ path: string; sha256: string }> };
  source: { path: string; lines: number; sha256: string };
  entries: Array<{ clauseId: string; entryPath: string; standardPosition: string | null; declaredPosition: string | null }>;
  clauseUnits: Array<{ clauseId: string; entryId: string; section: string; anchorLevel: string; click: unknown; source: { line_start: number; line_end: number; heading: string; slice_sha256: string }; matchesDeclared: boolean }>;
}

/**
 * 步骤表（人工语义分解，依据条目页的「标准定义」与「公式或伪代码」）。
 * blocks 里的核心块（variables_set / math_* / ctrl_iterate）只有 ctrl_iterate 属 222 项目块，
 * 其余是画布上原生的 Blockly 核心块——它们也算「画布可见」，但不参与 L1/L2 的块名匹配。
 */
const CLAUSE_MODELS: ClauseModel[] = [
  {
    entryId: '01-SHA2',
    nonExecutable: '本页是 SHA-2 算法族导航（参数表 + 算法清单），条目页自己写明「没有独立归属的公式或伪代码规范单元」；没有可执行单元，不能判「能搭」',
    steps: [
      { id: 's1', section: '§6.1–§6.7', text: '算法族导航与参数表（字长/分组/输出长度）', blocks: [], visibility: 'none' },
    ],
    claimBoundaries: ['参数表不是算法步骤；哈希函数的语义由 03/04/05 三页承载'],
    extraGaps: [],
  },
  {
    entryId: '02-Padding',
    steps: [
      { id: 's1', section: '§5.1', text: '追加 1 位（字节 0x80）', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's2', section: '§5.1', text: '追加 k 个 0 位，使长度 ≡ 448 (mod 512)', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's3', section: '§5.1', text: '追加原消息 bit 长度的 64-bit 大端编码', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's4', section: '§5.2', text: '按 512-bit 切分填充后消息（N = bitlen/512 个分组）', blocks: ['data_bit_length', 'math_arithmetic', 'math_round', 'ctrl_iterate', 'pq_bytes_slice'], visibility: 'canvas', note: '试点工程里这一段是 ctrl_iterate + pq_bytes_slice + 两个原生数学块' },
    ],
    claimBoundaries: ['标准要求 0 ≤ λ < 2^64；填充块不强制该上限（块模型没有长度域约束）'],
    extraGaps: [],
  },
  {
    entryId: '03-MessageExpansion',
    steps: [
      { id: 's1', section: '§6.2.2', text: 'W[0..15] ← 分组的 16 个大端 32-bit 字', blocks: ['hash_sha256_compress'], visibility: 'internal', note: '在 compress 生成器闭包内展开' },
      { id: 's2', section: '§6.2.2', text: 'W[16..63] 递推（σ0/σ1）', blocks: ['hash_sha256_compress'], visibility: 'internal' },
    ],
    claimBoundaries: [],
    extraGaps: ['消息扩展没有独立块：语义在 hash_sha256_compress 的生成器闭包里，画布上无法逐步核'],
  },
  {
    entryId: '04-Compression',
    steps: [
      { id: 's1', section: '§6.2.2', text: '每分组初始化 a..h ← H(i−1)', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's2', section: '§6.2.2', text: '64 轮 T1/T2 与工作字轮转', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's3', section: '§6.2.2', text: '工作字加回链状态 H(i)', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's4', section: '§6.2.2', text: 'For i=1 to N 依次处理全部分组', blocks: ['ctrl_iterate', 'pq_bytes_slice', 'hash_sha256_compress'], visibility: 'canvas', note: 'P4-SCOPE 判 partial 的理由是这段迭代缺块；本切片用 ctrl_iterate 组合出来了（B.2 两分组向量通过）' },
    ],
    claimBoundaries: [],
    extraGaps: ['64 轮压缩在生成器闭包里，画布无法逐步核；块边界上的输入/输出契约有单测覆盖'],
  },
  {
    entryId: '05-Digest',
    steps: [
      { id: 's1', section: '§6', text: '选变体初值 H(0)（SHA-256 的 8 个 32-bit IV）', blocks: ['data_value'], visibility: 'canvas', note: '用 data_value 字面量表达，可编辑但不是专门块' },
      { id: 's2', section: '§6', text: '8 个工作字按大端串成 32 字节摘要', blocks: [], visibility: 'none' },
      { id: 's3', section: '§6', text: '按变体截断输出长度（SHA-512/224、SHA-512/256）', blocks: [], visibility: 'none' },
    ],
    claimBoundaries: [],
    extraGaps: ['缺 words→bytes 的大端打包块：8 个 32-bit 字无法在画布上拼成 32 字节（试点由 driver 格式化）'],
  },
];

interface EntryPage {
  entryId: string;
  entryPath: string;
  title: string;
  mappingText: string;
  mappingLine: number;
  definition: string;
  formula: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 取某个 `## ` 二级标题下的正文，直到下一个二级标题。找不到返回空串。 */
function sectionOf(md: string, heading: RegExp): { text: string; line: number } {
  const lines = md.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return { text: '', line: 0 };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }
  return { text: lines.slice(start + 1, end).join('\n').trim(), line: start + 1 };
}

function loadEntryPage(entry: { clauseId: string; entryPath: string }): EntryPage {
  const md = readFileSync(resolve(ROOT, entry.entryPath), 'utf8');
  const mapping = sectionOf(md, /^## .*映射/);
  const definition = sectionOf(md, /^## 标准定义/);
  const formula = sectionOf(md, /^## 公式或伪代码/);
  const title = (md.split('\n').find((line) => line.startsWith('# ')) || '').replace(/^#\s*/, '');
  return {
    entryId: entry.clauseId,
    entryPath: entry.entryPath,
    title,
    mappingText: mapping.text,
    mappingLine: mapping.line,
    definition: definition.text,
    formula: formula.text,
  };
}

/** 映射小节里反引号点名的块，只保留产品索引里真有的块类型。 */
function mappingBlocks(text: string, index: BlockIndex): Array<{ blockType: string; quote: string }> {
  const known = new Set(index.blocks.map((block) => block.blockType));
  const found = new Map<string, string>();
  // 两种写法都认：裸块名 `` `hash_sha256_pad` `` 与带调用签名的 `` `hash_sha256_compress(V, W)` ``
  for (const match of text.matchAll(/`([a-z][a-z0-9_]*)(\([^`]*\))?`/g)) {
    const name = match[1];
    if (!known.has(name) || found.has(name)) continue;
    const at = text.indexOf(match[0]);
    const quote = text.slice(Math.max(0, at - 40), Math.min(text.length, at + match[0].length + 40)).replace(/\s+/g, ' ');
    found.set(name, quote);
  }
  return [...found.entries()].map(([blockType, quote]) => ({ blockType, quote }));
}

/** 块 tooltip 里引了标准号的块（L2 的候选池）。 */
function tooltipStandardBlocks(index: BlockIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of index.blocks) {
    const tooltip = `${block.tooltips.en}\n${block.tooltips.zh}`;
    if (!STANDARD_NUMBER_RE.test(tooltip)) continue;
    out.set(block.blockType, tooltip.replace(/\s+/g, ' ').slice(0, 160));
  }
  return out;
}

/** L3 查询：页面标题 + 标准定义首句（不含映射小节的块名，避免把 L1 信息灌进候选）。 */
function queryFor(page: EntryPage, standardName: string): string {
  const firstSentence = page.definition.split(/[。\n]/).find((part) => part.trim().length > 4) || page.definition;
  return `${standardName} ${page.title} ${firstSentence.trim()}`;
}

function tierOf(model: ClauseModel, layer: Layer): { tier: Tier; reason: string } {
  if (model.nonExecutable) return { tier: 'missing', reason: 'non-executable' };
  const canvas = model.steps.filter((step) => step.visibility === 'canvas').length;
  const none = model.steps.filter((step) => step.visibility === 'none').length;
  if (none === model.steps.length) return { tier: 'missing', reason: 'no-block' };
  if (canvas === model.steps.length && layer !== 'none') return { tier: 'build', reason: 'all-steps-canvas' };
  return { tier: 'partial', reason: canvas > 0 ? 'mixed-steps' : 'internal-only' };
}

function main(): void {
  const anchors = readJson<AnchorFile>(ANCHORS);
  const index = readJson<BlockIndex>(INDEX);
  const manifest = readJson<{ entries: Array<{ id: string; standard: string; version: string }> }>(MANIFEST);
  const standard = manifest.entries.find((entry) => entry.id === STANDARD_ID);
  if (!standard) throw new Error(`manifest 缺 ${STANDARD_ID}`);
  if (anchors.standard.id !== standard.id) throw new Error('anchors.json 与 manifest 的标准 id 不一致，先重跑第 1 段');

  const standardBlocks = tooltipStandardBlocks(index);
  const clauses = CLAUSE_MODELS.map((model) => {
    const anchorEntry = anchors.entries.find((entry) => entry.clauseId === model.entryId);
    if (!anchorEntry) throw new Error(`anchors.json 缺条目 ${model.entryId}`);
    const page = loadEntryPage(anchorEntry);
    const l1Blocks = mappingBlocks(page.mappingText, index);
    const hits: SearchHit[] = search(index, {
      inTypes: [],
      outTypes: [],
      text: queryFor(page, standard.standard),
      limit: 10,
    });
    const top5 = hits.slice(0, 5).map((hit) => ({ blockType: hit.blockType, score: Math.round(hit.score * 100) / 100 }));
    const l2Blocks = hits.slice(0, 5)
      .filter((hit) => standardBlocks.has(hit.blockType))
      .map((hit) => ({
        blockType: hit.blockType,
        tooltip: standardBlocks.get(hit.blockType) || '',
        /** 是否就是本条路径的变体（SHA-256 条款只认 256 的块；224/512 的块不能算命中）。 */
        sameVariant: /256/.test(hit.blockType) && !/224|512/.test(hit.blockType),
      }));
    const layer: Layer = l1Blocks.length > 0 ? 'L1' : l2Blocks.length > 0 ? 'L2' : top5.length > 0 ? 'L3' : 'none';
    const { tier, reason } = tierOf(model, layer);
    const sectionUnits = anchors.clauseUnits
      .filter((unit) => unit.entryId === model.entryId)
      .map((unit) => ({
        section: unit.section,
        click: unit.click,
        anchorLevel: unit.anchorLevel,
        matchesDeclared: unit.matchesDeclared,
        slice_sha256: unit.source.slice_sha256,
        heading: unit.source.heading,
      }));
    // 不可执行条款只报一条原因：导航页不该被拆成「某步没有块」的噪音。
    const gaps = model.nonExecutable ? [model.nonExecutable] : [
      ...model.extraGaps,
      ...model.steps
        .filter((step) => step.visibility !== 'canvas')
        .map((step) => `${step.section} 步骤「${step.text}」${step.visibility === 'internal' ? '只在生成器闭包里，画布无法逐步核' : '没有对应块'}`),
    ];
    return {
      clauseId: page.entryId,
      entryPath: page.entryPath,
      title: page.title,
      standardPosition: anchorEntry.standardPosition,
      tier,
      tierReason: reason,
      evidenceLayer: layer,
      anchors: sectionUnits,
      evidence: {
        l1: {
          hit: l1Blocks.length > 0,
          blocks: l1Blocks,
          source: { path: page.entryPath, line: page.mappingLine, heading: '项目映射' },
        },
        l2: {
          hit: l2Blocks.length > 0,
          blocks: l2Blocks,
          note: '标准号取自块 tooltip，且该块须出现在同一查询的前 5 个 BM25 候选里；sameVariant 标出是否就是本条路径的变体',
        },
        l3: {
          hit: top5.length > 0,
          query: queryFor(page, standard.standard),
          top5,
          note: 'L3 只作候选，不单独升级档位',
        },
      },
      steps: model.steps,
      stepCounts: {
        total: model.steps.length,
        canvas: model.steps.filter((step) => step.visibility === 'canvas').length,
        internal: model.steps.filter((step) => step.visibility === 'internal').length,
        none: model.steps.filter((step) => step.visibility === 'none').length,
      },
      gaps,
      claimBoundaries: model.claimBoundaries,
      semantic_equivalence: 'unverified',
    };
  });

  const count = (tier: Tier): number => clauses.filter((clause) => clause.tier === tier).length;
  const layers = { L1: 0, L2: 0, L3: 0, none: 0 };
  for (const clause of clauses) layers[clause.evidenceLayer] += 1;

  const payload = {
    schemaVersion: 1,
    generatedBy: 'scripts/p4-verdicts.ts',
    standard: { id: standard.id, name: standard.standard, version: standard.version, source_checked_at: anchors.standard.source_checked_at },
    inputs: {
      anchors: 'experiments/ai-helper-2026-11-14/p4/anchors.json',
      anchorsSource: anchors.source,
      blockIndex: 'src/services/ai-helper/block-index.json',
      blockTypes: index.blocks.length,
      tooltipStandardPool: { size: standardBlocks.size, blocks: [...standardBlocks.keys()] },
    },
    rules: {
      noProjectStatusField: true,
      tiers: 'build = 全部步骤 canvas 且有 L1/L2；partial = 混合或仅内部；missing = 无可执行单元 / 全无块',
      evidence: 'L1 映射块名 > L2 tooltip 标准号 ∩ BM25 候选 > L3 BM25 候选（只作候选）',
      semanticEquivalence: 'unverified',
    },
    counts: {
      clauses: clauses.length,
      build: count('build'),
      partial: count('partial'),
      missing: count('missing'),
      evidenceLayers: layers,
      clausesWithSameVariantL2: clauses.filter((clause) => clause.evidence.l2.blocks.some((block) => block.sameVariant)).length,
      gaps: clauses.reduce((sum, clause) => sum + clause.gaps.length, 0),
    },
    clauses,
  };
  writeFileSync(VERDICTS, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  for (const clause of clauses) {
    console.log(`VERDICT ${clause.clauseId.padEnd(22)} ${clause.tier.padEnd(8)} layer=${clause.evidenceLayer} ` +
      `steps=${clause.stepCounts.canvas}/${clause.stepCounts.total} canvas, L1=${clause.evidence.l1.blocks.length} ` +
      `L2=${clause.evidence.l2.blocks.length} L3top5=${clause.evidence.l3.top5.slice(0, 3).map((hit) => hit.blockType).join(',')}`);
  }
  console.log(`VERDICTS build=${count('build')} partial=${count('partial')} missing=${count('missing')} ` +
    `layers=${JSON.stringify(layers)} gaps=${payload.counts.gaps}`);
  console.log(`VERDICTS out=${VERDICTS.replace(`${ROOT}/`, '')}`);
}

main();
