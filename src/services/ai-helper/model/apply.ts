/**
 * 校验通过的结果 → 答案句（纯投影，不生成任何文本）。
 *
 * `applySelection` 返回的是 `RewriteRequest.candidates` 里的**原对象**（同一引用）：
 * path/line/text 逐字不变，选择顺序就是答案顺序。返回类型只可能是 `CandidateSentence`，
 * 所以模型在这里没有新增句子的口子——它能影响的只有「选哪些句、按什么顺序」。
 *
 * 失败即发包不出：只要 `verifyRewrite` 报错，就返回空 `sentences`，
 * 不让半份证据漏到界面（宁可这次不给答案，也不给一份掺了越界选择的答案）。
 */

import { verifyRewrite, type RewriteViolation, type VerifyOptions } from './verify';
import type { CandidateSentence, RewriteRequest, RewriteResult } from './types';

/** 投影结果：`ok` 为 false 时 `sentences` 必为空，`errors` 来自校验器。 */
export interface ApplyResult {
  readonly ok: boolean;
  readonly sentences: readonly CandidateSentence[];
  readonly errors: readonly RewriteViolation[];
}

/**
 * 按模型选择的顺序取出候选句原对象。
 *
 * @param request 原始请求（候选是唯一文本来源）
 * @param result 模型返回的选择（必须已通过或在这里通过校验）
 * @param options 上限覆盖，与 `verifyRewrite` 同一口径
 */
export function applySelection(
  request: RewriteRequest,
  result: RewriteResult,
  options: VerifyOptions = {},
): ApplyResult {
  const checked = verifyRewrite(request, result, options);
  if (!checked.ok) return { ok: false, sentences: [], errors: checked.errors };

  const index = new Map<string, CandidateSentence>();
  for (const candidate of request.candidates) index.set(candidate.id, candidate);
  // 校验已保证每个 id 都在候选里（unknown-id 会先被拒），这里的断言不会落空。
  const sentences = result.selections.map((selection) => index.get(selection.id) as CandidateSentence);
  return { ok: true, sentences, errors: [] };
}
