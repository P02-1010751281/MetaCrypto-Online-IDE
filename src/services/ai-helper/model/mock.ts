/**
 * 确定性的模型适配器替身（离线 demo 与单测基线）。
 *
 * 不接 provider、不读环境变量与 key、不发网络请求，**不用随机数与时间**：
 * 同一输入连续调用两次，结果逐字段相等。行为故意做得最笨——按候选顺序取前 N 句
 * （N 可配，默认 3）——这样校验器、自述核对与界面都能在「没有模型」的前提下跑通：
 * 引用完整性、拒答、逐句 support 契约都有真实数据可测。
 *
 * 拒答规则：候选为空或 N ≤ 0 时返回空选择；此时**不给 notes**——没有句子支撑的
 * 自述在校核里本来就会被整句丢弃，mock 不制造自己的反例。
 */

import { DEFAULT_MOCK_SELECTIONS, selectionLimit } from './limits';
import type { ModelAdapter, RewriteRequest, RewriteResult } from './types';

export interface MockAdapterOptions {
  /** 最多取几句（默认 `DEFAULT_MOCK_SELECTIONS`；≤0 或非数值一律当拒答）。 */
  readonly maxSelections?: number;
  /** 是否附带自述（默认 true，用来固定「自述每句都要依据、且不进答案证据」的契约）。 */
  readonly withNote?: boolean;
}

/** 造一个确定性适配器；同一份 options 产出的适配器行为完全一致。 */
export function mockAdapter(options: MockAdapterOptions = {}): ModelAdapter {
  const limit = selectionLimit(options.maxSelections, DEFAULT_MOCK_SELECTIONS);
  const withNote = options.withNote ?? true;

  return {
    async rewrite(request: RewriteRequest): Promise<RewriteResult> {
      const picked = request.candidates.slice(0, limit);
      if (picked.length === 0) return { selections: [] };

      const selections = picked.map((candidate) => ({ id: candidate.id }));
      if (!withNote) return { selections };
      const support = selections.map((selection) => selection.id);
      return {
        selections,
        // 自述只陈述「取了几句」，是可复算的确定性文本，不含任何语料里没有的说法；
        // support 就是它实际选的 id，所以这句自述永远能过 `planNotes` 的核对。
        notes: [{ text: `mock：按候选顺序取前 ${selections.length} 句（候选共 ${request.candidates.length} 句）`, support }],
      };
    },
  };
}
