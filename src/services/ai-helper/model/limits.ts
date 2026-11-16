/**
 * 选择数量上限的统一口径。
 *
 * 上限只写一处，`mockAdapter`（它选几句）与 `verifyRewrite`（结果最多允许几句）必须
 * 共用同一个归一化规则，否则两边一旦漂移，mock 生成的合法结果会被自己人的校验器判死。
 *
 * 归一化是 fail closed 的：`NaN`/`Infinity`/负数一律压到 0，不猜调用方「大概想要默认值」——
 * 配置写错时宁可拒答，也不要悄悄用一个大数把整段候选都当成答案。
 */

/** 答案最多引用几句（默认 5）：再多就不是「一句答案」，出处也会被稀释。 */
export const DEFAULT_MAX_SELECTIONS = 5;

/** mock 默认取几句（与 `doc-answer.ts` 的 `maxSentences` 默认值 3 对齐）。 */
export const DEFAULT_MOCK_SELECTIONS = 3;

/** 把外部传入的上限归一化成非负整数；`fallback` 用于 `undefined`。 */
export function selectionLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.floor(limit));
}
