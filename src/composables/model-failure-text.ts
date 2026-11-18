/**
 * 模型失败原因 → 界面人话（纯函数：不碰 DOM、不读全局语言、不 import 文案表）。
 *
 * 「失败」不是一个原因，而是十来种：调用层的超时/鉴权/额度/网络，加上校验层可把
 * **答案句**打回的三类越界（`unknown-id` / `duplicate-id` / `too-many`）。
 * 2026-11-18 的真浏览器验收抓到一个真错：假 provider 回「带说明却没给 support」时，
 * 界面说「模型选中的句子不在候选里」——那是另一类越界，用户照这句话去检查候选句只会越查越远。
 * 文案必须逐类对准，不能共用一个笼统句。
 *
 * 「说明没依据」不再走这里：自述不是证据，挂不上候选 id 的句子由 `planNotes` 逐句丢弃并计数，
 * 界面上是本地的「N 句被丢弃」，而不是一次调用失败。
 *
 * 依赖以参数注入（`text` / `status` 由调用方从 locale 取），因此这里可以直接被单测断言：
 * 「哪一类越界出哪一句」不需要挂组件、也不需要切全局语言。
 */

import type { ModelFailure } from './useModelAnswer';
import type { RewriteViolationCode } from '@/services/ai-helper/model/verify';

/**
 * 调用失败码 → locale key。
 *
 * 故意是 `Partial`：`http-error` 没有专属文案，按状态码说话（`modelErrorStatus`），
 * 未知码也走同一条兜底——宁可在界面上暴露状态码，也不要显示一个空串。
 */
const CALL_ERROR_KEYS: Partial<Record<Exclude<ModelFailure['code'], 'verify'>, string>> = {
  timeout: 'modelErrorTimeout',
  unauthorized: 'modelErrorUnauthorized',
  forbidden: 'modelErrorForbidden',
  'rate-limited': 'modelErrorRateLimited',
  format: 'modelErrorFormat',
  empty: 'modelErrorEmpty',
  network: 'modelErrorNetwork',
  'not-configured': 'modelErrorNotConfigured',
};

/** 三类越界 → 各自的 locale key（一条越界一句话，不合并成「校验失败」）。 */
export const VERIFY_VIOLATION_KEYS: Record<RewriteViolationCode, string> = {
  'unknown-id': 'modelVerifyUnknownId',
  'duplicate-id': 'modelVerifyDuplicateId',
  'too-many': 'modelVerifyTooMany',
};

/** 文案来源：`ui` 与 `uiFormat('modelErrorStatus', …)` 由调用方注入。 */
export interface FailureTextContext {
  readonly text: (key: string) => string;
  readonly status: (status: number) => string;
}

/**
 * 把一次失败摊成一到多条人话（按出现顺序，已去重）。
 *
 * 返回数组而不是拼好的句子：多条原因之间的分隔符中英不同（`；` / `; `），
 * 那是调用方（知道当前语言）的事，不是这个纯函数该猜的。
 * `verify` 但没带分类时退回 `modelErrorVerify` 那句兜底，不返回空数组。
 */
export function modelFailureTexts(failure: ModelFailure, context: FailureTextContext): string[] {
  if (failure.code === 'verify') {
    const codes = [...new Set(failure.violations ?? [])];
    const lines = codes
      .map((code) => VERIFY_VIOLATION_KEYS[code])
      .filter((key): key is string => typeof key === 'string')
      .map((key) => context.text(key));
    return lines.length ? lines : [context.text('modelErrorVerify')];
  }
  const key = CALL_ERROR_KEYS[failure.code];
  return [key ? context.text(key) : context.status(failure.status ?? 0)];
}
