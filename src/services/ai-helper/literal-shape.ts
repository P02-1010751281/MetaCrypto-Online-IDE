/**
 * 字面量形状 → 可表示它的类型标签。
 *
 * 只承诺「该形状能被这些类型表示」，不做语义判断，因此可以安全地用于配对检查：
 *
 * - 整数 / 十六进制 → `Number`（`0xF12186F9` 在 Python 与 JS 里都是整数）。
 * - 一维整数数组 / 空数组 → `IntList` 与 `Bytes`。两种类型在语言层的表示分别是
 *   `list[int]` 与 `bytes`，同一个数组字面量对两者都是合法来源，所以**都产出**，
 *   由 `compatibility()` 与父槽的期望取交集决定最终判定。
 * - 引号字符串 → `String` 与 `Bytes`。demo 实测把 `'sample'` 直接喂给 `Bytes` 槽位
 *   （ecdsa/rsa 的 MSG）可跑通官方向量，说明 `Bytes` 在这里是语义标签而非严格容器类型。
 * - 多维嵌套数组与任意表达式**不猜**：当前类型词汇表里没有嵌套类型，
 *   矩阵由块的 `shape` 元数据承载（见 docs 的数组形态口径），返回 null 保持 unknown。
 */

import {
  TYPE_BYTES,
  TYPE_INT_LIST,
  TYPE_NUMBER,
  TYPE_STRING,
} from '@/constants/block-types';

const INT_RE = /^-?\d+$/;
const HEX_RE = /^0[xX][0-9a-fA-F]+$/;
const TEXT_RE = /^(['"])(?:[^\\]|\\.)*\1$/s;

const ARRAY_TYPES = [TYPE_INT_LIST, TYPE_BYTES];
const TEXT_TYPES = [TYPE_STRING, TYPE_BYTES];

/** 返回可表示该字面量形状的类型标签；形状不可归类时返回 null（不猜）。 */
export function literalShapeType(raw: string): string[] | null {
  const text = raw.trim();
  if (!text) return null;
  if (INT_RE.test(text) || HEX_RE.test(text)) return [TYPE_NUMBER];
  if (TEXT_RE.test(text)) return TEXT_TYPES;
  if (!text.startsWith('[') || !text.endsWith(']')) return null;

  const inner = text.slice(1, -1).trim();
  if (!inner) return ARRAY_TYPES;
  const items = inner
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) return ARRAY_TYPES;
  const allInts = items.every((item) => INT_RE.test(item) || HEX_RE.test(item));
  return allInts ? ARRAY_TYPES : null;
}
