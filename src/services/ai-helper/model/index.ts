/**
 * D 线模型适配层的公共入口（M0 骨架）。
 *
 * 只导出契约、确定性 mock、引用完整性校验与「选择 → 原句」投影；
 * 不含任何 provider、网络、密钥或环境变量读取。真实 provider 接入前，
 * 上层只依赖这里的类型，因此替换适配器不需要改调用方。
 *
 * 证据规则见 `./types` 文件头：模型只能选择/重排候选句，解释文本不进答案证据。
 */

export type {
  CandidateSentence,
  ModelAdapter,
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

export { mockAdapter, type MockAdapterOptions } from './mock';
