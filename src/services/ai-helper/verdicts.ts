/**
 * A 线「标准 → 工作区」的只读视图数据：加载构建期制品 `verdicts-index.json`。
 *
 * 三档判据（`build` / `partial` / `missing`）是**机器候选**，不是「已覆盖」：
 * 它们只回答「条款的步骤能不能用现有画布块搭出来」，语义等价（`semantic_equivalence`）
 * 一律是 `unverified`，签核在人。界面文案必须带着这层限定，不能把 tier 说成结论。
 *
 * 制品由 `scripts/build-verdicts-index.mjs` 从 p4 裁决 JSON 重算生成：
 * 计数、缺口数、源文件 sha256 都在脚本里重算过，`totals` 与 `generatedFrom` 不是抄来的。
 * 每份标准还可以带一份 `pilot`（同一份切片用现有块搭出来的工程），打开逻辑见
 * `./pilotProjects.ts`——它与「三档判据」是两份证据，不能互相顶替。
 */
import type { PilotProjectSummary } from './pilotProjects';

export type CoverageTier = 'build' | 'partial' | 'missing';
export type StepVisibility = 'canvas' | 'internal' | 'none';
export type EvidenceLayer = 'L1' | 'L2' | 'L3' | 'none';

export interface VerdictStep {
  id: string;
  section?: string;
  text: string;
  blocks: string[];
  visibility: StepVisibility;
  note?: string;
}

export interface VerdictAnchor {
  section: string;
  heading?: string;
  click: { doc: string; line_start: number; line_end?: number };
  anchorLevel?: string;
  matchesDeclared?: boolean;
  slice_sha256?: string;
}

export interface ClauseVerdict {
  clauseId: string;
  entryPath: string;
  title: string;
  standardPosition?: string;
  tier: CoverageTier;
  tierReason?: string;
  evidenceLayer?: EvidenceLayer;
  anchors: VerdictAnchor[];
  /** L1/L2/L3 证据原文：界面暂不渲染，保留在制品里供以后复查。 */
  evidence?: Record<string, unknown>;
  steps: VerdictStep[];
  stepCounts?: { total: number; canvas: number; internal: number; none: number };
  gaps?: string[];
  claimBoundaries?: string[];
  semantic_equivalence?: string;
}

export interface StandardVerdict {
  schemaVersion: number;
  generatedBy?: string;
  standard: { id: string; name: string; version?: string; source_checked_at?: string };
  inputs: {
    anchors?: string;
    anchorsSource?: { path: string; sha256: string; lines?: number };
    blockIndex?: string;
    blockTypes?: number;
  };
  rules?: Record<string, string | boolean>;
  counts: {
    clauses: number;
    build: number;
    partial: number;
    missing: number;
    evidenceLayers?: Record<string, number>;
    gaps: number;
  };
  clauses: ClauseVerdict[];
  /** 同一份切片的试点工程（构建期制品）；没有登记就缺省，界面不给打开按钮。 */
  pilot?: PilotProjectSummary;
}

export interface VerdictsIndex {
  schemaVersion: number;
  generatedBy: string;
  note?: string;
  generatedFrom: Array<{
    path: string;
    sha256: string;
    standardId: string;
    counts: { clauses: number; build: number; partial: number; missing: number; gaps: number };
  }>;
  totals: {
    standards: number;
    clauses: number;
    build: number;
    partial: number;
    missing: number;
    gaps: number;
  };
  standards: StandardVerdict[];
}

const TIERS: readonly CoverageTier[] = ['build', 'partial', 'missing'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 制品是构建期产物，运行时仍做一次结构校验：字段缺失时宁可让面板显示
 * 「数据不可用」，也不要把半份数据画成一张看起来正常的表。
 */
export function parseVerdictsIndex(raw: string): VerdictsIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`裁决索引不是合法 JSON：${(error as Error).message}`, { cause: error });
  }
  if (!isObject(parsed)) throw new Error('裁决索引顶层不是对象');
  if (parsed.schemaVersion !== 1) throw new Error(`裁决索引 schemaVersion=${String(parsed.schemaVersion)}，本界面只认 1`);
  if (!Array.isArray(parsed.standards) || parsed.standards.length === 0) {
    throw new Error('裁决索引没有任何标准切片');
  }
  for (const standard of parsed.standards) {
    if (!isObject(standard) || !isObject(standard.standard) || typeof standard.standard.id !== 'string') {
      throw new Error('裁决索引里有标准切片缺少 standard.id');
    }
    if (!Array.isArray(standard.clauses) || standard.clauses.length === 0) {
      throw new Error(`${standard.standard.id} 没有条款`);
    }
    for (const clause of standard.clauses) {
      if (!isObject(clause) || typeof clause.clauseId !== 'string' || typeof clause.title !== 'string') {
        throw new Error(`${standard.standard.id} 有条款缺少 clauseId/title`);
      }
      if (!TIERS.includes(clause.tier as CoverageTier)) {
        throw new Error(`${standard.standard.id}/${clause.clauseId} 的 tier=${String(clause.tier)} 非法`);
      }
      if (!Array.isArray(clause.steps)) {
        throw new Error(`${standard.standard.id}/${clause.clauseId} 缺 steps`);
      }
    }
    if (standard.pilot !== undefined) {
      const pilot = standard.pilot;
      if (!isObject(pilot) || typeof pilot.artifact !== 'string' || typeof pilot.standardId !== 'string') {
        throw new Error(`${standard.standard.id} 的 pilot 缺 artifact/standardId`);
      }
      if (pilot.standardId !== standard.standard.id) {
        throw new Error(`pilot.standardId=${pilot.standardId} 与 ${standard.standard.id} 不是同一份标准`);
      }
      if (!Array.isArray(pilot.files) || pilot.files.length === 0 || typeof pilot.blocks !== 'number') {
        throw new Error(`${standard.standard.id} 的 pilot 缺 files/blocks`);
      }
    }
  }
  return parsed as unknown as VerdictsIndex;
}

/** 懒加载：制品 52 KB，只有面板真正打开时才进内存。 */
export async function loadVerdictsIndex(): Promise<VerdictsIndex> {
  const module = (await import('@/services/ai-helper/verdicts-index.json?raw')) as { default: string };
  return parseVerdictsIndex(module.default);
}

/** 从 clauses 重算一份标准的汇总：界面上的数字与制品里的计数不一致时以 clauses 为准。 */
export function summarizeStandard(standard: StandardVerdict): {
  clauses: number;
  build: number;
  partial: number;
  missing: number;
  gaps: number;
} {
  const summary = { clauses: standard.clauses.length, build: 0, partial: 0, missing: 0, gaps: 0 };
  for (const clause of standard.clauses) {
    summary[clause.tier] += 1;
    summary.gaps += clause.gaps?.length ?? 0;
  }
  return summary;
}

/** 锚点的行区间文案：只有一段、两端一致时不写成区间。 */
export function anchorLineLabel(anchor: VerdictAnchor): string {
  const { line_start: start, line_end: end } = anchor.click;
  if (!end || end === start) return `L${start}`;
  return `L${start}–L${end}`;
}
