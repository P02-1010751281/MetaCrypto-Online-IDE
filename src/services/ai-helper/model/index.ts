/**
 * D 线模型适配层的公共入口。
 *
 * 导出契约、确定性 mock、答案句的引用完整性校验（`verifyRewrite`）、
 * 「选择 → 原句」投影（`applySelection`）与自述的逐句核对（`planNotes`）。
 * 网络与密钥只在 `./provider`，本入口不重新导出它，避免上层顺手拿到调用实现。
 *
 * 证据规则见 `./types` 文件头：答案句只能是候选句；自述每句必须有依据，否则整句丢弃。
 */

export type {
  CandidateSentence,
  ModelAdapter,
  NoteSentence,
  RewriteRequest,
  RewriteResult,
  RewriteSelection,
} from './types';

export {
  DEFAULT_MAX_SELECTIONS,
  DEFAULT_MOCK_SELECTIONS,
  selectionLimit,
} from './limits';

export {
  verifyRewrite,
  type RewriteViolation,
  type RewriteViolationCode,
  type VerifyOptions,
  type VerifyResult,
} from './verify';

export { applySelection, type ApplyResult } from './apply';

export {
  MAX_NOTE_SENTENCES,
  planNotes,
  type AuditedNote,
  type NoteDrop,
  type NoteDropCode,
  type NotePlan,
  type NotePlanOptions,
} from './notes';

export { mockAdapter, type MockAdapterOptions } from './mock';
