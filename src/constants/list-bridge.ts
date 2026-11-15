/**
 * Blockly 原生列表块 ↔ 密码学类型桥接表（纯数据，不依赖 Blockly）。
 *
 * 原生列表块的输出标签是 `'Array'`，与密码槽位的 `'IntList'` / `'Bytes'` / `'SBox'`
 * 没有交集，Blockly 会直接拒绝连线——toolbox 里那一整族「构造 / 填充」块因此在能力上
 * 不可用（实测 0 次使用）。桥接把原生标签拓宽为 {@link LIST_BRIDGE_CHECKS}，
 * 并把「当前接受 `'Array'` 的输入端口」一并拓宽（只按端口现有 check 识别，不按名字猜）。
 *
 * 边界：原生块**不进** `BLOCK-IO-CONTRACT.json`——该契约只描述 CipherCat 块
 * （见 `scripts/check-block-contract.mjs` 的 NATIVE_BLOCK_TYPES 注释），
 * 所以类型检查器对桥接块仍报 unknown，这是已知且有意保留的边界。
 */

import {
  TYPE_ARRAY,
  TYPE_BYTES,
  TYPE_INT_LIST,
  TYPE_SBOX,
} from './block-types';

/** 桥接后列表类端口可接受的标签集合（保留 `'Array'` 以兼容原生工作区）。 */
export const LIST_BRIDGE_CHECKS: readonly string[] = [
  TYPE_INT_LIST,
  TYPE_BYTES,
  TYPE_SBOX,
  TYPE_ARRAY,
];

/** 输出「列表」的块：输出类型拓宽为 {@link LIST_BRIDGE_CHECKS}。 */
export const LIST_BRIDGE_LIST_OUTPUT: readonly string[] = [
  'lists_create_with',
  'lists_create_empty',
  'lists_repeat',
  'lists_getSublist',
  'lists_split',
  'lists_sort',
];

/**
 * 需要拓宽输入端口的块（含输出不是列表的 `lists_length` / `lists_isEmpty` /
 * `lists_indexOf` / `lists_getIndex` / `lists_setIndex`）。
 * `lists_getIndex` 的输出保持原生 `null`：元素类型由元素决定，桥接层不猜。
 */
export const LIST_BRIDGE_INPUT_WIDEN: readonly string[] = [
  ...LIST_BRIDGE_LIST_OUTPUT,
  'lists_length',
  'lists_isEmpty',
  'lists_indexOf',
  'lists_getIndex',
  'lists_setIndex',
];

/** 原生列表块因为不进契约，检查器判定时按 unknown 处理；此常量供文档与检索使用。 */
export const LIST_BRIDGE_BLOCK_TYPES: readonly string[] = [
  ...LIST_BRIDGE_INPUT_WIDEN,
];
