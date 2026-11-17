/**
 * 模板路径 · 容器语法：切片（`arr_slice`）与推导式（展开成 `lists_create_with`）。
 *
 * 三条判据与 AST 路径（`ast/ir-expr.ts` 的 `sliceToIr` / `ast/ir-comprehension.ts`）逐字
 * 对齐，两边必须产出同一套块：
 *
 * 1. **省略终点的切片要长度**：`a[i:]` ⇔ `crypto_array_slice(a, i, len(a) - i)`（起点为正且
 *    源比它还短时块会抛错、Python 返回空列表，那一种记漂移；起点为 0/负数时逐字等价）。
 *    长度用原生
 *    `lists_length`（Python 生成就是 `len(...)`，逐字对应 Python 的长度原语），**不用**
 *    `data_byte_length` / `data_bit_length`：它们对 list 输入确实返回 `len(list)`
 *    （`generators/python/data/measurement.ts`），但按类型分档——str 走 UTF-8 字节数、
 *    bytes 走 `len * 8`——名字叫「字节长度」、语义是「按类型换算的度量」，拿它当切片长度
 *    会在 str/bytes 源上静默切错，而这两类恰好是切片最常出现的源。
 *    `lists_getSublist` 也不能用：它的 Python 生成器按 1-based 取值（实测
 *    `a[int(i - 1) : ]`），本项目只把 `lists_getIndex` / `lists_setIndex` 覆盖成 0-based，
 *    没覆盖 getSublist，生成的代码本身就与 Python 切片不同。
 *    `lists_length` 的输出标签是原生列表标签（不是 Number），所以长度一定是
 *    `len(源) - 起点` 这个减法块的结果，而不是把 `lists_length` 直接接进 `LENGTH`。
 * 2. **起终点都要能换成非负长度**：同号、终点 ≥ 起点，否则长度会变负或按长度归一后失真。
 * 3. **推导式只有「展开成定长列表」一种表示**：块模型没有 append，所以生成器必须是字面量
 *    range；带 `if` 的要先收集再筛选，同样落不了地，一律报诊断而不是近似。
 */

import type { ParsedNode } from '../parser';
import {
  COMP_IF,
  COMP_RANGE,
  SLICE_DRIFT,
  SLICE_LENGTH,
  SLICE_SIGN,
  SLICE_STEP,
  SLICE_TAIL_DRIFT,
  compTooLong,
} from '../diagnostics';
import type { CoreContext } from './types';
import { blocked, child, node } from './nodes';
import { matchParens, splitTopLevel, topLevelTokens } from './text';

/** 推导式展开上限：与 AST 路径的 `MAX_LIST_ITEMS` 同一个数。 */
export const MAX_LIST_ITEMS = 64;
/** 切片端点与 range 参数只认十进制整数（负号也算字面量的一部分）。 */
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

  // 省略终点（`a[i:]` / `a[:]`）：长度 = len(源) - 起点，起点省略时减 0 保持同一个形状。
  // 起点为 0 或负数时长度必然非负（`a[:]`、`a[-2:]` 逐字等价）；起点为正时源可能比它还短，
  // 块会算出负长度并抛错——那一步没有 min/钳位原语可用，必须报出来。
  if (endText === '') {
    const start = parse(startText);
    const safeStart = INTEGER_LITERAL.test(startText) && Number(startText) <= 0;
    if (!safeStart) {
      ctx.diagnostics?.push({ text: `[${startText}:]`, detail: SLICE_TAIL_DRIFT, reason: 'semantic-drift' });
    }
    return node('arr_slice', {}, [
      child('LIST', parse(base)),
      child('START', start),
      child('LENGTH', minus(lengthOf(parse(base)), start)),
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
    ctx.diagnostics?.push({ text: `[${startText}:${endText}]`, detail: SLICE_DRIFT, reason: 'semantic-drift' });
    length = minus(parse(endText), parse(startText));
  }
  return node('arr_slice', {}, [
    child('LIST', parse(base)),
    child('START', parse(startText)),
    child('LENGTH', length),
  ]);
}

/** 一个生成器分句：`v in range(字面量, ...)`。 */
function readGenerator(clause: string): { variable: string; start: number; stop: number } | null {
  const match = /^([A-Za-z_]\w*)\s+in\s+range\(([\s\S]*)\)$/.exec(clause);
  if (!match || !matchParens(clause, clause.indexOf('('))) return null;
  const args = splitTopLevel(match[2]);
  if (!args.length || args.length > 3) return null;
  if (!args.every((arg) => INTEGER_LITERAL.test(arg))) return null;
  if (args.length === 3 && Number(args[2]) !== 1) return null;
  const start = args.length >= 2 ? Number(args[0]) : 0;
  const stop = args.length >= 2 ? Number(args[1]) : Number(args[0]);
  return { variable: match[1], start, stop };
}

/** 把节点树里对 `name` 的引用换成字面量（推导式展开时代换循环变量）。 */
function replaceVariable(value: ParsedNode, name: string, literal: string, parse: ParseExpr): ParsedNode {
  if (value.type === 'variables_get' && value.fields.VAR === name) return parse(literal);
  return {
    ...value,
    children: value.children.map((item) => ({
      input: item.input,
      node: replaceVariable(item.node, name, literal, parse),
    })),
  };
}

/**
 * 推导式 → 列表块。
 *
 * 只认「生成器全是字面量 range」的形态：块模型没有 append，元素只能按静态确定的次数
 * 逐项展开成 `lists_create_with`。多个生成器是笛卡尔积（外层的 for 在前，与 Python 的
 * 遍历顺序一致）；带 `if`、迭代器不是 range、区间不是字面量都落不了地，报诊断。
 */
export function listCompNode(body: string, forTokens: Array<{ index: number }>, parse: ParseExpr): ParsedNode {
  const element = body.slice(0, forTokens[0].index).trim();
  if (!element) return blocked(COMP_RANGE);
  const elt = parse(element);
  if (elt.type.startsWith('UNRESOLVED')) return elt;

  const clauses: string[] = [];
  for (let index = 0; index < forTokens.length; index += 1) {
    const from = forTokens[index].index + 3;
    const to = index + 1 < forTokens.length ? forTokens[index + 1].index : body.length;
    clauses.push(body.slice(from, to).trim());
  }
  // `for v in range(2) if v`：filter 分句先被认出来，报「缺 append + 过滤”。
  if (clauses.some((clause) => topLevelTokens(clause, ['if']).length)) return blocked(COMP_IF);

  const generators = clauses.map(readGenerator);
  if (generators.some((generator) => !generator)) return blocked(COMP_RANGE);
  const bounds = generators as Array<{ variable: string; start: number; stop: number }>;
  let count = 1;
  for (const bound of bounds) count *= Math.max(0, bound.stop - bound.start);
  if (count > MAX_LIST_ITEMS) return blocked(compTooLong(count));

  // 笛卡尔积：外层生成器变化最慢，与 Python 的遍历顺序一致。
  let combos: Array<Array<[string, string]>> = [[]];
  for (const bound of bounds) {
    const values: string[] = [];
    for (let value = bound.start; value < bound.stop; value += 1) values.push(String(value));
    const next: Array<Array<[string, string]>> = [];
    for (const combo of combos) for (const value of values) next.push([...combo, [bound.variable, value]]);
    combos = next;
  }
  if (!combos.length) return node('lists_create_empty');
  const children = combos.map((combo, index) =>
    child(
      `ADD${index}`,
      combo.reduce((accumulated, [name, literal]) => replaceVariable(accumulated, name, literal, parse), elt),
    ),
  );
  return { type: 'lists_create_with', fields: {}, children, extraState: { itemCount: combos.length } };
}
