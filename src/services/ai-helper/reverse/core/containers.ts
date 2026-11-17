/**
 * 模板路径 · 容器语法：切片（`arr_slice`）。
 *
 * 判据与 AST 路径（`ast/ir-expr.ts` 的 `sliceToIr`）逐字对齐，两边必须产出同一套块：
 *
 * 1. **长度必须是非负的整数**，所以所有动态长度都套一层 `math_constrain`（Blockly 原生
 *    Math 类目，Python 生成 `min(max(v, low), high)`）：
 *      - `a[i:]` ⇔ `crypto_array_slice(a, i, constrain(len(a) - i, 0, len(a)))`；
 *      - `a[i:j]`（至少一端不是字面量）⇔ `constrain(j - i, 0, len(a))`。
 *    这样 `i < 0`（长度被钳到 len，负起点归一后正好取到尾部）、`0 <= i <= len`（长度恰好
 *    补到尾部）、`i > len`（长度钳到 0）三种情况都与 Python 一致，不再需要「负长度会抛错」
 *    的漂移诊断。
 * 2. **长度用原生 `lists_length`**（Python 生成就是 `len(...)`，逐字对应 Python 的长度原语），
 *    **不用** `data_byte_length` / `data_bit_length`：它们对 list 输入确实返回 `len(list)`
 *    （`generators/python/data/measurement.ts`），但按类型分档——str 走 UTF-8 字节数、
 *    bytes 走 `len * 8`——拿它当切片长度会在 str/bytes 源上静默切错。
 * 3. **两个字面量端点的切片仍按 `j - i` 折叠**：起终点同号且 `j >= i` 时逐字等价；一正一负、
 *    终点小于起点要在反向解析时就拒绝（块上没法补）。
 *
 * 推导式的解析在 `core/comprehension.ts`（静态展开与「空列表 + 循环 + append」两条路）。
 */

import type { ParsedNode } from '../parser';
import { SLICE_DYNAMIC_SIGN, SLICE_LENGTH, SLICE_SIGN, SLICE_STEP } from '../diagnostics';
import { blocked, child, node } from './nodes';
import type { CoreContext } from './types';

/** 切片端点只认十进制整数（负号也算字面量的一部分）。 */
const INTEGER_LITERAL = /^-?\d+$/;

/** 表达式回调：容器层不反向依赖表达式层，解析交给调用方带着当前 depth 传进来。 */
export type ParseExpr = (text: string) => ParsedNode;

/** 按顶层冒号切切片端点：`a[1:2]` → ['1','2']，`a[1:2:3]` → 3 段（步长不进块）。 */
export function splitSlice(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ':' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/** `len(x)`：原生列表长度块（Python 生成 `len(x)`）。 */
function lengthOf(value: ParsedNode): ParsedNode {
  return node('lists_length', {}, [child('VALUE', value)]);
}

function minus(left: ParsedNode, right: ParsedNode): ParsedNode {
  return node('math_arithmetic', { OP: 'MINUS' }, [child('A', left), child('B', right)]);
}

/** `math_constrain(value, low, high)`：Blockly 原生钳位块，Python 生成 `min(max(v, low), high)`。 */
function constrain(value: ParsedNode, low: ParsedNode, high: ParsedNode): ParsedNode {
  return node('math_constrain', {}, [
    child('VALUE', value),
    child('LOW', low),
    child('HIGH', high),
  ]);
}

/** `a[i:j]` / `a[i:]` / `a[:]` → `arr_slice`；拆不动就返回带说明的 UNRESOLVED。 */
export function sliceNode(base: string, parts: string[], ctx: CoreContext, parse: ParseExpr): ParsedNode | null {
  let segments = parts;
  // `a[1:2:]` 的第三段是空串，等于没写步长；有内容就是真步长。
  if (segments.length > 2) {
    if (segments.slice(2).some((part) => part !== '')) return blocked(SLICE_STEP);
    segments = segments.slice(0, 2);
  }
  const startText = segments[0] || '0';
  const endText = segments[1] ?? '';
  const source = parse(base);

  // 省略终点（`a[i:]` / `a[:]`）：长度 = len(源) - 起点，再钳到 [0, len(源)]。
  // 起点为 0 或负数时 `len - 起点` 会超过 len，钳回 len 后负起点归一正好取到尾部；
  // 起点为正且源比它还短时长度钳到 0，与 Python 返回空列表一致。
  if (endText === '') {
    return node('arr_slice', {}, [
      child('LIST', source),
      child('START', parse(startText)),
      child('LENGTH', constrain(minus(lengthOf(source), parse(startText)), parse('0'), lengthOf(source))),
    ]);
  }

  let length: ParsedNode;
  if (INTEGER_LITERAL.test(startText) && INTEGER_LITERAL.test(endText)) {
    const start = Number(startText);
    const end = Number(endText);
    if ((start < 0) !== (end < 0)) return blocked(SLICE_SIGN);
    if (end < start) return blocked(SLICE_LENGTH);
    length = parse(String(end - start));
  } else {
    // 至少一端不是字面量：长度 = j - i，钳到 [0, len(源)]。同号且 j ≥ i 时精确；
    // `j < i` 时钳成 0（Python 返回空列表）。但两端异号时负起点会先按长度归一，`j - i`
    // 不再是元素个数（`a[-2:j]`、运行期 j=3 时 Python 取 [3]、块取 [3,4]）——反向解析没有
    // 运行期符号判定，所以出块 + 一条语义漂移诊断，不静默放行。
    ctx.diagnostics?.push({
      text: `[${startText}:${endText}]`,
      detail: SLICE_DYNAMIC_SIGN,
      reason: 'semantic-drift',
    });
    length = constrain(minus(parse(endText), parse(startText)), parse('0'), lengthOf(source));
  }
  return node('arr_slice', {}, [
    child('LIST', source),
    child('START', parse(startText)),
    child('LENGTH', length),
  ]);
}
