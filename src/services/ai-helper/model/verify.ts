/**
 * 模型输出 → 可采用的证据：**答案句**的引用完整性校验。
 *
 * 校验器只回答一个问题：这个结果能不能被当成「对候选句的选择」。它**不抛异常**——
 * 拒答与被拒绝都是正常路径（界面要显示原因），所以失败以结构化 `errors` 返回。
 *
 * 三类拒绝，全部是「模型越界」，与证据强弱无关：
 *   - `unknown-id`：选了请求之外的东西（模型编了 id，或把别处的句子当候选）；
 *   - `duplicate-id`：同一句被选多次（重复计入会让「说两遍」冒充两条证据）；
 *   - `too-many`：超过上限（答案只该给几句，多出来的会稀释出处）。
 *
 * 空选择是**合法**结果：候选为空或模型认为没有依据时，拒答就是正确答案，
 * 不能因为「没选出句子」就判失败。
 *
 * 模型自述（`notes`）不在本文件校验：它不进证据，越界的后果也不同（逐句丢弃而不是
 * 整体作废），规则见 `./notes` 的 `planNotes`。曾经这两件事混在一起，导致「模型写了
 * 一句没标依据的解释」会把整次选择判死——解释是附注，不该有这个权力。
 */

import { DEFAULT_MAX_SELECTIONS, selectionLimit } from './limits';
import type { CandidateSentence, RewriteRequest, RewriteResult } from './types';

/** 可把**答案句**打回的三类越界。码值稳定，界面与测试按它分支，不要改成自由文本。 */
export type RewriteViolationCode = 'unknown-id' | 'duplicate-id' | 'too-many';

/** 一条结构化拒绝原因：`code` 供分支，`message` 供人读，`id` 指出涉及的候选句。 */
export interface RewriteViolation {
  readonly code: RewriteViolationCode;
  readonly message: string;
  readonly id?: string;
}

/** 校验结论：`ok` 为 true 时 `errors` 一定为空。 */
export interface VerifyResult {
  readonly ok: boolean;
  readonly errors: readonly RewriteViolation[];
}

export interface VerifyOptions {
  /** 答案最多允许几句（默认 `DEFAULT_MAX_SELECTIONS`）。 */
  readonly maxSelections?: number;
}

/** 请求里的候选 id 集合；重复 id 以最后一次出现为准（检索层负责保证唯一）。 */
function indexCandidates(candidates: readonly CandidateSentence[]): Map<string, CandidateSentence> {
  const index = new Map<string, CandidateSentence>();
  for (const candidate of candidates) index.set(candidate.id, candidate);
  return index;
}

/**
 * 校验模型选中的句是否只引用了本次请求的候选句。
 *
 * @param request 原始的请求（候选 id 是唯一的事实来源）
 * @param result 模型返回的选择
 * @param options 上限覆盖（默认 5）
 */
export function verifyRewrite(
  request: RewriteRequest,
  result: RewriteResult,
  options: VerifyOptions = {},
): VerifyResult {
  const known = indexCandidates(request.candidates);
  const maxSelections = selectionLimit(options.maxSelections, DEFAULT_MAX_SELECTIONS);
  const errors: RewriteViolation[] = [];
  const seen = new Set<string>();

  for (const selection of result.selections) {
    if (!known.has(selection.id)) {
      errors.push({
        code: 'unknown-id',
        id: selection.id,
        message: `候选句里没有 id「${selection.id}」：模型只能引用本次请求给出的句子。`,
      });
      continue;
    }
    if (seen.has(selection.id)) {
      errors.push({
        code: 'duplicate-id',
        id: selection.id,
        message: `id「${selection.id}」被选了多次：同一句不能重复计入答案。`,
      });
      continue;
    }
    seen.add(selection.id);
  }

  if (result.selections.length > maxSelections) {
    errors.push({
      code: 'too-many',
      message: `选了 ${result.selections.length} 句，超过上限 ${maxSelections} 句。`,
    });
  }

  return { ok: errors.length === 0, errors };
}
