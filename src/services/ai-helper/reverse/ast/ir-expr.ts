/**
 * IR 表达式层：把 Python 表达式 AST 翻成白名单 IR。
 *
 * 所有「不支持」都在这里就地记诊断（带行号与原文片段），不返回替代值——调用方拿到 null
 * 就必须让整条语句一起失败，避免半个表达式被搭出来。
 */

import type { AstNode } from './dump';
import type { IrExpr, IrStmt } from './ir-shared';
import type { PrimitiveCall } from '../primitive-calls';
import { SLICE_DYNAMIC_SIGN, SLICE_LENGTH, SLICE_SIGN, SLICE_STEP } from '../diagnostics';
import { listCompToIr } from './ir-comprehension';
import {
  ARITHMETIC_OPS,
  COMPARE_OPS,
  MAX_LIST_ITEMS,
  child,
  children,
  integerValue,
  lineOf,
  nameOf,
  report,
  reportDrift,
} from './ir-shared';
import type { Ctx } from './ir-shared';

export function exprToIr(node: AstNode | null, ctx: Ctx): IrExpr | null {
  if (!node) return null;
  const line = lineOf(node);
  switch (node._) {
    case 'Constant': {
      const value = node.value;
      if (typeof value === 'boolean') return { kind: 'bool', value, line };
      if (typeof value === 'number') return { kind: 'num', value: String(value), line };
      if (typeof value === 'string') return { kind: 'str', value, line };
      if (value === null) return { kind: 'none', line };
      // bytes / complex / Ellipsis：块里没有对应表示，宁可报出来。
      return report(ctx, node, '不支持这种常量（只认数字、字符串、True/False/None）');
    }
    case 'Name': {
      const name = nameOf(node);
      if (!name) return report(ctx, node, '空标识符');
      if (name === 'True' || name === 'False') return { kind: 'bool', value: name === 'True', line };
      if (name === 'None') return { kind: 'none', line };
      return { kind: 'name', name, line };
    }
    case 'BinOp': {
      const opNode = child(node, 'op');
      const op = opNode ? ARITHMETIC_OPS[opNode._] : undefined;
      if (!op) return report(ctx, node, '不支持的运算符（只认 + - * / ** % 与按位运算）');
      const left = exprToIr(child(node, 'left'), ctx);
      const right = left ? exprToIr(child(node, 'right'), ctx) : null;
      if (!left || !right) return null;
      // 按位运算只有 `bit_operation` 一块可选，而那块会把操作数强制成 uint32
      // （生成器会带出 crypto_to_uint32 闭包）。对字符串/字节序列做 `^` 时语义会变，
      // 所以照样出块（结构保住了）但必须标成「不完整」，不能让人以为原样还原了。
      if (op.startsWith('BIT_') || op === 'SHL' || op === 'SHR') {
        reportDrift(ctx, node, '按位运算映射到 bit_operation 块：该块会把操作数强制成 uint32，语义与原文不同');
      }
      return { kind: 'binop', op, left, right, line };
    }
    case 'UnaryOp': {
      const opNode = child(node, 'op');
      const operand = exprToIr(child(node, 'operand'), ctx);
      if (!operand) return null;
      if (opNode?._ === 'USub') return { kind: 'neg', operand, line };
      if (opNode?._ === 'Not') return { kind: 'not', operand, line };
      if (opNode?._ === 'UAdd') return operand;
      return report(ctx, node, '不支持的一元运算符（只认 -x 与 not x）');
    }
    case 'BoolOp': {
      const opNode = child(node, 'op');
      if (opNode?._ !== 'And' && opNode?._ !== 'Or') {
        return report(ctx, node, '不支持的布尔运算');
      }
      // 块模型只有两输入，`a and b and c` 要左折叠成一串。
      const values = children(node, 'values');
      let acc: IrExpr | null = null;
      for (const item of values) {
        const current = exprToIr(item, ctx);
        if (!current) return null;
        acc = acc ? { kind: 'boolop', op: opNode._ === 'And' ? 'AND' : 'OR', left: acc, right: current, line } : current;
      }
      return acc ?? report(ctx, node, '空布尔表达式');
    }
    case 'Compare': {
      const ops = children(node, 'ops');
      const comparators = children(node, 'comparators');
      const left = exprToIr(child(node, 'left'), ctx);
      if (!left || ops.length !== 1 || comparators.length !== 1) {
        return report(ctx, node, '只支持单个比较（a < b 这类），链式比较翻不了');
      }
      const op = COMPARE_OPS[ops[0]._];
      if (!op) return report(ctx, node, '不支持的比较运算符（只认 == != < <= > >=）');
      const right = exprToIr(comparators[0], ctx);
      if (!right) return null;
      return { kind: 'compare', op, left, right, line };
    }
    case 'Call':
      return callToIr(node, ctx, 'value') as IrExpr | null;
    case 'List':
    case 'Tuple': {
      const items = children(node, 'elts');
      if (items.length > MAX_LIST_ITEMS) {
        return report(ctx, node, `列表过长（${items.length} 项，上限 ${MAX_LIST_ITEMS}）`);
      }
      const converted: IrExpr[] = [];
      for (const item of items) {
        const value = exprToIr(item, ctx);
        if (!value) return null;
        converted.push(value);
      }
      return { kind: 'list', items: converted, line };
    }
    case 'Subscript': {
      const slice = child(node, 'slice');
      if (slice?._ === 'Slice') return sliceToIr(node, slice, ctx);
      const value = exprToIr(child(node, 'value'), ctx);
      if (!value) return null;
      if (!slice || slice._ !== 'Constant') {
        return report(ctx, node, '只支持下标的常量索引（切片 a[1:2] 没有对应块）');
      }
      const at = exprToIr(slice, ctx);
      if (!at) return null;
      return { kind: 'index', value, at, line };
    }
    case 'ListComp':
      return listCompToIr(node, ctx, exprToIr);
    case 'IfExp': {
      const test = exprToIr(child(node, 'test'), ctx);
      const then = test ? exprToIr(child(node, 'body'), ctx) : null;
      const otherwise = then ? exprToIr(child(node, 'orelse'), ctx) : null;
      if (!test || !then || !otherwise) return null;
      return { kind: 'ifexp', test, then, otherwise, line };
    }
    default:
      return report(ctx, node, `不支持的表达式：${node._}`);
  }
}

function convertArgs(nodes: AstNode[], ctx: Ctx): IrExpr[] | null {
  const args: IrExpr[] = [];
  for (const arg of nodes) {
    const converted = exprToIr(arg, ctx);
    if (!converted) return null;
    args.push(converted);
  }
  return args;
}

/**
 * 调用 → IR，按位置分档。
 *
 * 三个来源按可信度排序：本模块 procedure（名字由代码自己定义）、已知原语（块生成代码
 * 时的函数名，见 `primitive-calls.ts`）、其余一律拒绝。原语分支不复刻模板路径的字段
 * 回填逻辑：模板里 `rate_bytes=136` 这类字面量关键字参数对应块的默认字段，调用方若另
 * 给了关键字，说明要改字段值，而 v1 没有这个通道，认下来会悄悄用默认值——必须报出来。
 */
export function callToIr(node: AstNode, ctx: Ctx, mode: 'value' | 'statement'): IrExpr | IrStmt | null {
  const line = lineOf(node);
  const func = child(node, 'func');
  if (!func || func._ !== 'Name') {
    return report(ctx, node, '只支持直接调用本工作区里的函数（obj.method() 没有对应块）');
  }
  const name = nameOf(func);
  const argNodes = children(node, 'args');
  const keywords = children(node, 'keywords');
  const hasSpill = (node.args as unknown[] | undefined)?.length !== argNodes.length;

  if (ctx.procedures.has(name)) {
    if (keywords.length || hasSpill) return report(ctx, node, '不支持关键字参数或 *args');
    const args = convertArgs(argNodes, ctx);
    if (!args) return null;
    return { kind: 'call', name, args, line };
  }

  // `len(x)`：Python 的长度原语，落原生列表长度块（生成代码就是 `len(...)`，逐字对应）。
  // 本模块真定义了 `len` 的话上面那条分支已经接走；判据与模板路径的原子层一致。
  if (name === 'len') {
    if (keywords.length || hasSpill || argNodes.length !== 1) {
      return report(ctx, node, 'len() 只接一个位置参数：它对应的是列表长度块（lists_length）');
    }
    if (mode === 'statement') return report(ctx, node, 'len() 是值块，不能单独作语句');
    const value = exprToIr(argNodes[0], ctx);
    if (!value) return null;
    return { kind: 'length', value, line };
  }

  const primitive = ctx.primitives?.lookup(name, argNodes.length) ?? null;
  if (primitive) {
    if (keywords.length || hasSpill) {
      return report(ctx, node, `已知原语 ${name}() 不接受关键字参数（字段回填还没做，认下来会静默用默认值）`);
    }
    if (mode === 'value' && !primitive.output) {
      return report(ctx, node, `${name}() 对应的块只能当语句用，没有返回值`);
    }
    if (mode === 'statement' && !primitive.statement) {
      return report(ctx, node, `${name}() 对应的块是值块，不能单独作语句`);
    }
    const args = convertArgs(argNodes, ctx);
    if (!args) return null;
    return { kind: 'primitive', primitive, args, line };
  }

  const knownArities = ctx.primitives?.arities(name) ?? [];
  if (knownArities.length) {
    return report(ctx, node, `已知原语 ${name}() 只认 ${knownArities.join(' 或 ')} 个参数，这里给了 ${argNodes.length} 个`);
  }
  return report(ctx, node, `调用了工作区里没有的函数 ${name}()，没有对应的块`);
}

/** 数组切片块：`crypto_array_slice(list, start, length)`。两条路径必须产出同一个块。 */
const ARR_SLICE: PrimitiveCall = {
  type: 'arr_slice',
  call: 'crypto_array_slice',
  inputs: ['LIST', 'START', 'LENGTH'],
  output: true,
  statement: false,
};

/** `len(x)`：原生列表长度块（`blocks.ts` 落 `lists_length`，Python 生成就是 `len(...)`）。 */
function lengthOf(value: IrExpr, line?: number): IrExpr {
  return { kind: 'length', value, line };
}

function minus(left: IrExpr, right: IrExpr, line?: number): IrExpr {
  return { kind: 'binop', op: 'MINUS', left, right, line };
}

/**
 * `min(max(value, low), high)`：Blockly 原生 `math_constrain`（Python 生成
 * `min(max(v, low), high)`）。切片长度一律钳到 `[0, len(源)]`。
 */
function constrain(value: IrExpr, low: IrExpr, high: IrExpr, line?: number): IrExpr {
  return { kind: 'constrain', value, low, high, line };
}

function zero(line?: number): IrExpr {
  return { kind: 'num', value: '0', line };
}

/**
 * 切片 → `arr_slice`。
 *
 * 块的语义是 `crypto_array_slice(list, start, length)`（起点可从末尾负计、长度须非负）。
 * 动态长度一律套 `math_constrain` 钳到 `[0, len(源)]`：
 *   - `a[i:]` ⇔ `arr_slice(a, i, constrain(len(a) - i, 0, len(a)))`，`i < 0` / `0 ≤ i ≤ len` /
 *     `i > len` 三种情况都与 Python 一致（负长度不再存在，所以没有漂移诊断）；
 *   - `a[i:j]`（至少一端不是字面量）⇔ `constrain(j - i, 0, len(a))`，`j < i` 时钳成 0；
 *     但两端异号时负起点会先按长度归一，`j - i` 不再是元素个数（没有运行期符号判定），
 *     所以出块 + 一条 `SLICE_DYNAMIC_SIGN` 语义漂移诊断。
 * 两个字面量端点仍按 `j - i` 折叠：一正一负（`a[-2:2]`）与 `j < i` 在反向解析时拒绝。
 * `len` 是 Python 的长度原语，`lists_length` 的生成代码就是 `len(...)`。
 * 不用 `data_byte_length`：它对 list 返回 `len(list)`，但对 str/bytes 按字节数换算
 * （`generators/python/data/measurement.ts`），拿它当切片长度会在 str/bytes 源上静默切错。
 */
function sliceToIr(node: AstNode, slice: AstNode, ctx: Ctx): IrExpr | null {
  if (child(slice, 'step')) return report(ctx, node, SLICE_STEP);
  const source = exprToIr(child(node, 'value'), ctx);
  if (!source) return null;
  const lower = child(slice, 'lower');
  const upper = child(slice, 'upper');
  let start: IrExpr = { kind: 'num', value: '0' };
  if (lower) {
    const converted = exprToIr(lower, ctx);
    if (!converted) return null;
    start = converted;
  }

  // `a[i:]` / `a[:]`：长度 = len(源) - 起点，钳到 [0, len(源)]。起点省略时写成
  // `len(源) - 0`，与模板路径同形。
  if (!upper) {
    const length = constrain(
      minus(lengthOf(source, lineOf(node)), start, lineOf(node)),
      zero(lineOf(node)),
      lengthOf(source, lineOf(node)),
      lineOf(node),
    );
    return { kind: 'primitive', primitive: ARR_SLICE, args: [source, start, length], line: lineOf(node) };
  }

  const end = exprToIr(upper, ctx);
  if (!end) return null;
  const startValue = integerValue(start);
  const endValue = integerValue(end);
  let length: IrExpr;
  if (startValue !== null && endValue !== null) {
    if ((startValue < BigInt(0)) !== (endValue < BigInt(0))) return report(ctx, node, SLICE_SIGN);
    if (endValue < startValue) return report(ctx, node, SLICE_LENGTH);
    length = { kind: 'num', value: (endValue - startValue).toString(), line: lineOf(node) };
  } else {
    // 至少一端不是字面量：长度 = j - i，钳到 [0, len(源)]。同号且 j ≥ i 时精确；
    // `j < i` 时钳成 0（Python 返回空列表）。两端异号时负起点先按长度归一，`j - i` 不再是
    // 元素个数——没有运行期符号判定，出块 + 语义漂移诊断。
    reportDrift(ctx, node, SLICE_DYNAMIC_SIGN);
    length = constrain(
      minus(end, start, lineOf(node)),
      zero(lineOf(node)),
      lengthOf(source, lineOf(node)),
      lineOf(node),
    );
  }
  return { kind: 'primitive', primitive: ARR_SLICE, args: [source, start, length], line: lineOf(node) };
}


