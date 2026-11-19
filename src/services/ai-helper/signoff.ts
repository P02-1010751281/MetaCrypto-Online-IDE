/**
 * A 线「标准 → 工作区」的人签核记录。
 *
 * 为什么需要它：三档判据是**构建期机器候选**，只回答「条款的步骤能不能用现有块搭出来」，
 * 语义等价一律 unverified。规范要求「末段人签核」，在此之前界面只能写「未签核」；
 * 这个模块把「谁、什么时候、对哪一条、签了什么、当时绑的是哪份数据」记下来。
 *
 * 两条设计约束：
 *   1. **签核绑数据指纹**：产物重生成后条款内容可能变，旧的签核不能继续算数——
 *      一律显示为「数据已变，需复核」，而不是静默保留或静默删除。
 *   2. **只存本地、可导出**：没有后端，记录进 localStorage，导出的 JSON 自带制品指纹，
 *      别人拿到导出件能核对它绑的是哪一版数据。
 */

import type { ClauseVerdict, StandardVerdict, VerdictsIndex } from './verdicts';

export type SignoffDecision = 'signed' | 'rejected';

export interface SignoffRecord {
  standardId: string;
  clauseId: string;
  decision: SignoffDecision;
  /** 签核人：自由文本（姓名或工号），必填——没有人的签核记录没有意义。 */
  operator: string;
  /** ISO 8601 时间戳。 */
  at: string;
  note?: string;
  /** 记录时该条款的数据指纹；与当前指纹不一致即视为过期。 */
  fingerprint: string;
}

export interface SignoffBook {
  schemaVersion: 1;
  /** 记录时整份裁决索引的指纹（generatedFrom 的 path:sha256 集合），用于整体漂移提示。 */
  indexFingerprint: string;
  records: SignoffRecord[];
}

export const SIGNOFF_STORAGE_KEY = 'ciphercat:standards-signoff:v1';
export const SIGNOFF_OPERATOR_KEY = 'ciphercat:standards-signoff:operator';

const EMPTY_BOOK: SignoffBook = { schemaVersion: 1, indexFingerprint: '', records: [] };

/**
 * 条款指纹：把「这条判据看起来是什么」压成可比较的串。
 *
 * 只比条数不够——把一句缺口改写、把一步的块换掉，条数不变但判据已经不同了。所以正文
 * 全部参与：步骤（id/可见性/文本/块）、缺口文本、口径边界、锚点行区间。
 * 用 FNV-1a 而不是加密散列：用途是发现漂移、便于排查，不是防篡改。
 */
export function clauseFingerprint(clause: ClauseVerdict): string {
  const canonical = [
    clause.clauseId,
    clause.tier,
    clause.tierReason ?? '',
    clause.steps.map((step) => `${step.id}:${step.visibility}:${step.text}:${step.blocks.join(',')}`).join(';'),
    (clause.gaps ?? []).join(';'),
    (clause.claimBoundaries ?? []).join(';'),
    clause.anchors.map((anchor) => `${anchor.section}@${anchor.click.line_start}-${anchor.click.line_end ?? anchor.click.line_start}`).join(';'),
  ].join('|');
  return [
    clause.clauseId,
    clause.tier,
    String(clause.steps.length),
    String(clause.gaps?.length ?? 0),
    String(clause.anchors.length),
    fnv1a(canonical),
  ].join('|');
}

/** FNV-1a 32 位：同步、确定、跨环境一致；不用于安全用途。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 索引指纹：各源文件 sha256 的有序集合。重生成后源文件变了，这里就变。 */
export function indexFingerprint(index: VerdictsIndex): string {
  return index.generatedFrom
    .map((source) => `${source.path}:${source.sha256}`)
    .sort()
    .join(',');
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式/被策略禁用时 localStorage 访问会抛错；调用方按「没有记录」处理。
    return null;
  }
};

export interface LoadResult {
  book: SignoffBook;
  /** 存储里那份数据不可用时的原因；界面必须显示出来，不能装作没有记录。 */
  error?: string;
}

export function loadSignoffBook(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { book: { ...EMPTY_BOOK, records: [] } };
  const raw = storage.getItem(SIGNOFF_STORAGE_KEY);
  if (!raw) return { book: { ...EMPTY_BOOK, records: [] } };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
      return { book: { ...EMPTY_BOOK, records: [] }, error: '签核记录的 schema 不可识别' };
    }
    const records: SignoffRecord[] = [];
    for (const item of parsed.records) {
      if (!isObject(item)) continue;
      if (typeof item.standardId !== 'string' || typeof item.clauseId !== 'string') continue;
      if (item.decision !== 'signed' && item.decision !== 'rejected') continue;
      if (typeof item.operator !== 'string' || typeof item.at !== 'string' || typeof item.fingerprint !== 'string') continue;
      records.push({
        standardId: item.standardId,
        clauseId: item.clauseId,
        decision: item.decision,
        operator: item.operator,
        at: item.at,
        note: typeof item.note === 'string' ? item.note : undefined,
        fingerprint: item.fingerprint,
      });
    }
    return { book: { schemaVersion: 1, indexFingerprint: typeof parsed.indexFingerprint === 'string' ? parsed.indexFingerprint : '', records } };
  } catch (error) {
    return { book: { ...EMPTY_BOOK, records: [] }, error: `签核记录不是合法 JSON：${(error as Error).message}` };
  }
}

export function saveSignoffBook(book: SignoffBook, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  storage.setItem(SIGNOFF_STORAGE_KEY, JSON.stringify(book));
}

export function loadOperator(storage: StorageLike | null = defaultStorage()): string {
  if (!storage) return '';
  return storage.getItem(SIGNOFF_OPERATOR_KEY) ?? '';
}

export function saveOperator(operator: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  storage.setItem(SIGNOFF_OPERATOR_KEY, operator);
}

export interface ClauseSignoffState {
  /** none = 没有记录；stale = 有记录但绑定的数据已变。 */
  status: 'none' | 'signed' | 'rejected' | 'stale';
  record?: SignoffRecord;
}

export function clauseSignoffState(book: SignoffBook, standardId: string, clause: ClauseVerdict): ClauseSignoffState {
  const record = book.records.find((item) => item.standardId === standardId && item.clauseId === clause.clauseId);
  if (!record) return { status: 'none' };
  if (record.fingerprint !== clauseFingerprint(clause)) return { status: 'stale', record };
  return { status: record.decision, record };
}

export interface DecideInput {
  standardId: string;
  clause: ClauseVerdict;
  decision: SignoffDecision;
  operator: string;
  note?: string;
  /** 注入时间便于测试；默认取当前时刻。 */
  at?: string;
  indexFingerprint: string;
}

/** 记录一次签核/拒签：同一条款只保留最新一条（签核是对当前状态的决定，不是流水账）。 */
export function recordDecision(book: SignoffBook, input: DecideInput): SignoffBook {
  const operator = input.operator.trim();
  if (!operator) throw new Error('签核人不能为空');
  const record: SignoffRecord = {
    standardId: input.standardId,
    clauseId: input.clause.clauseId,
    decision: input.decision,
    operator,
    at: input.at ?? new Date().toISOString(),
    note: input.note?.trim() || undefined,
    fingerprint: clauseFingerprint(input.clause),
  };
  const rest = book.records.filter(
    (item) => !(item.standardId === input.standardId && item.clauseId === input.clause.clauseId),
  );
  return { schemaVersion: 1, indexFingerprint: input.indexFingerprint, records: [...rest, record] };
}

export function revokeDecision(book: SignoffBook, standardId: string, clauseId: string): SignoffBook {
  return {
    schemaVersion: 1,
    indexFingerprint: book.indexFingerprint,
    records: book.records.filter((item) => !(item.standardId === standardId && item.clauseId === clauseId)),
  };
}

export interface SignoffSummary {
  signed: number;
  rejected: number;
  stale: number;
  pending: number;
}

export function summarizeSignoff(book: SignoffBook, standard: StandardVerdict): SignoffSummary {
  const summary: SignoffSummary = { signed: 0, rejected: 0, stale: 0, pending: 0 };
  for (const clause of standard.clauses) {
    const state = clauseSignoffState(book, standard.standard.id, clause);
    if (state.status === 'signed') summary.signed += 1;
    else if (state.status === 'rejected') summary.rejected += 1;
    else if (state.status === 'stale') summary.stale += 1;
    else summary.pending += 1;
  }
  return summary;
}

export interface ExportRecord extends SignoffRecord {
  standardName: string;
  clauseTitle: string;
  /** 导出时该条款的当前指纹；与 fingerprint 不同即说明导出时数据已经变了。 */
  currentFingerprint: string;
  fingerprintMatches: boolean;
}

export interface SignoffExport {
  schemaVersion: 1;
  exportedAt: string;
  indexFingerprint: string;
  /** 记录当时的索引指纹：与 indexFingerprint 不同说明中间重生成过产物。 */
  recordedIndexFingerprint: string;
  records: ExportRecord[];
}

export function buildSignoffExport(book: SignoffBook, index: VerdictsIndex, exportedAt = new Date().toISOString()): SignoffExport {
  const lookup = new Map<string, { standard: StandardVerdict; clause: ClauseVerdict }>();
  for (const standard of index.standards) {
    for (const clause of standard.clauses) {
      lookup.set(`${standard.standard.id}/${clause.clauseId}`, { standard, clause });
    }
  }
  const records: ExportRecord[] = [];
  for (const record of book.records) {
    const found = lookup.get(`${record.standardId}/${record.clauseId}`);
    if (!found) continue;
    const currentFingerprint = clauseFingerprint(found.clause);
    records.push({
      ...record,
      standardName: found.standard.standard.name,
      clauseTitle: found.clause.title,
      currentFingerprint,
      fingerprintMatches: currentFingerprint === record.fingerprint,
    });
  }
  return {
    schemaVersion: 1,
    exportedAt,
    indexFingerprint: indexFingerprint(index),
    recordedIndexFingerprint: book.indexFingerprint,
    records,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
