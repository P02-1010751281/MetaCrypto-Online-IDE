/**
 * Python AST → IR 的公共底座（类型、运算表、节点读取小工具）。
 *
 * 拆出来只为守住「单文件 ≤ 500 行」：表达式与语句两块都要用这些工具，放在任何一边都会
 * 让另一边反向依赖。这里不含转换逻辑，改动风险低。
 */

import type { AstNode } from './dump';
import type { PrimitiveCall, PrimitiveIndex } from '../primitive-calls';

/** 一条不支持节点的诊断：`text` 是原文片段，`detail` 是为什么翻不了。 */
export interface IrDiag {
  text: string;
  line?: number;
  detail: string;
  /**
   * `semantic-drift`：块已经出来了，但块模型的语义与原文不同（按位运算被强制 uint32、
   * range 的空区间会倒序执行）。与 `unsupported` 分开，面板才不会把它显示成「未识别」。
   */
  reason?: 'unsupported' | 'semantic-drift';
}

export type IrBinOp =
  | 'ADD'
  | 'MINUS'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'POWER'
  | 'MOD'
  | 'BIT_AND'
  | 'BIT_OR'
  | 'BIT_XOR'
  | 'SHL'
  | 'SHR';

export type IrCompareOp = 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE';

export type IrExpr =
  | { kind: 'num'; value: string; line?: number }
  | { kind: 'str'; value: string; line?: number }
  | { kind: 'bool'; value: boolean; line?: number }
  | { kind: 'none'; line?: number }
  | { kind: 'name'; name: string; line?: number }
  | { kind: 'binop'; op: IrBinOp; left: IrExpr; right: IrExpr; line?: number }
  | { kind: 'neg'; operand: IrExpr; line?: number }
  | { kind: 'not'; operand: IrExpr; line?: number }
  | { kind: 'compare'; op: IrCompareOp; left: IrExpr; right: IrExpr; line?: number }
  | { kind: 'boolop'; op: 'AND' | 'OR'; left: IrExpr; right: IrExpr; line?: number }
  | { kind: 'call'; name: string; args: IrExpr[]; line?: number }
  /** 已知原语调用：块类型与输入槽在 IR 里就固定下来，`blocks.ts` 直接按槽接线。 */
  | { kind: 'primitive'; primitive: PrimitiveCall; args: IrExpr[]; line?: number }
  | { kind: 'list'; items: IrExpr[]; line?: number }
  | { kind: 'index'; value: IrExpr; at: IrExpr; line?: number }
  /** `len(x)`：原生列表长度块（`blocks.ts` 落 `lists_length`，Python 生成就是 `len(...)`）。 */
  | { kind: 'length'; value: IrExpr; line?: number }
  /**
   * `min(max(value, low), high)`：Blockly 原生 `math_constrain`。切片长度用它钳到
   * `[0, len(源)]`，这样 `a[i:]` 的三种起点与 `a[i:j]` 的 `j < i` 都不再会算出负长度；
   * `a[i:j]` 两端异号的残余漂移另报 `SLICE_DYNAMIC_SIGN`。
   */
  | { kind: 'constrain'; value: IrExpr; low: IrExpr; high: IrExpr; line?: number }
  | { kind: 'ifexp'; test: IrExpr; then: IrExpr; otherwise: IrExpr; line?: number };

export type IrStmt =
  | { kind: 'assign'; target: string; value: IrExpr; line?: number }
  | { kind: 'augassign'; target: string; op: IrBinOp; value: IrExpr; line?: number }
  | { kind: 'call'; name: string; args: IrExpr[]; line?: number }
  /** 语句位置的已知原语调用（块需要有前驱/后继连接才能进语句链）。 */
  | { kind: 'primitive'; primitive: PrimitiveCall; args: IrExpr[]; line?: number }
  | { kind: 'return'; value: IrExpr | null; line?: number }
  | {
      kind: 'if';
      branches: Array<{ test: IrExpr; body: IrStmt[] }>;
      orelse: IrStmt[];
      line?: number;
    }
  | { kind: 'for'; variable: string; from: IrExpr; to: IrExpr; body: IrStmt[]; line?: number }
  /** 单参数 `range(expr)`：Python「执行 expr 次」，块模型只有 ctrl_iterate 能逐字表达。 */
  | { kind: 'iterate'; variable: string; times: IrExpr; body: IrStmt[]; line?: number }
  /** 两/三参数 `range(a, b)`（步长 1）：`ctrl_range` 的 TO 是独占终点，与 Python 逐字对应。 */
  | { kind: 'range'; variable: string; from: IrExpr; to: IrExpr; body: IrStmt[]; line?: number }
  /** `for x in <列表表达式>`：原生 `controls_forEach`。 */
  | { kind: 'forEach'; variable: string; list: IrExpr; body: IrStmt[]; line?: number }
  /** `LIST.append(VALUE)`：`arr_append`（推导式展开的循环体就是它）。 */
  | { kind: 'append'; list: IrExpr; value: IrExpr; line?: number }
  | { kind: 'while'; test: IrExpr; body: IrStmt[]; line?: number }
  | { kind: 'flow'; flow: 'BREAK' | 'CONTINUE'; line?: number };

export const ARITHMETIC_OPS: Record<string, IrBinOp> = {
  Add: 'ADD',
  Sub: 'MINUS',
  Mult: 'MULTIPLY',
  Div: 'DIVIDE',
  Pow: 'POWER',
  Mod: 'MOD',
  BitAnd: 'BIT_AND',
  BitOr: 'BIT_OR',
  BitXor: 'BIT_XOR',
  LShift: 'SHL',
  RShift: 'SHR',
};

export const COMPARE_OPS: Record<string, IrCompareOp> = {
  Eq: 'EQ',
  NotEq: 'NEQ',
  Lt: 'LT',
  LtE: 'LTE',
  Gt: 'GT',
  GtE: 'GTE',
};

export const MAX_LIST_ITEMS = 64;

export interface Ctx {
  /** 本模块里定义过的函数名：调用这些才有对应的块。 */
  procedures: Set<string>;
  /** 已知原语调用索引（载荷里的块调用形态）。没有载荷时为空，退回到「只认 procedure」。 */
  primitives?: PrimitiveIndex;
  diagnostics: IrDiag[];
  /** 原文按行切开：诊断要把用户看到的那一行还给他。 */
  lines: string[];
  /**
   * 当前作用域里已出现过的名字（形参 + 已处理的赋值/循环变量）。推导式展开时循环变量与它们
   * 重名就要改名：Python 3 的推导式有独立作用域，展开会把循环变量泄漏到外层。
   */
  scope: Set<string>;
}

export function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { _?: unknown })._ === 'string'
  );
}

export function child(node: AstNode, key: string): AstNode | null {
  const value = node[key];
  return isNode(value) ? value : null;
}

export function children(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isNode);
}

/**
 * 三种节点用三种字段名装名字：`Name.id`、`FunctionDef.name`、`arg.arg`。
 * 只读 `id` 会把所有函数当成匿名（§S3 首跑就是这么红的）。
 */
export function nameOf(node: AstNode | null): string {
  if (!node) return '';
  for (const key of ['id', 'name', 'arg']) {
    const value = node[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

export function lineOf(node: AstNode): number | undefined {
  return typeof node.lineno === 'number' ? node.lineno : undefined;
}

/** 原文片段：诊断里必须给出用户写的那一行，而不是我们转出来的描述。 */
export function snippet(ctx: Ctx, node: AstNode): string {
  const start = lineOf(node);
  if (!start) return node._;
  const endRaw = typeof node.end_lineno === 'number' ? node.end_lineno : start;
  const end = Math.max(start, Math.min(endRaw, start + 3));
  const text = ctx.lines
    .slice(start - 1, end)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const clipped = text.length > 160 ? `${text.slice(0, 157)}...` : text;
  return clipped || node._;
}

export function report(ctx: Ctx, node: AstNode, detail: string): null {
  ctx.diagnostics.push({ text: snippet(ctx, node), line: lineOf(node), detail });
  return null;
}

/** 记一条「块出来了、语义不同」的诊断：不改变返回值，调用方照常产出块。 */
export function reportDrift(ctx: Ctx, node: AstNode, detail: string): void {
  ctx.diagnostics.push({
    text: snippet(ctx, node),
    line: lineOf(node),
    detail,
    reason: 'semantic-drift',
  });
}

/** 整数字面量折叠：`range(n)` 的右端点要减 1，能在字面量上折就别多搭一个块。 */
export function integerValue(expr: IrExpr): bigint | null {
  if (expr.kind !== 'num') return null;
  if (!/^-?\d+$/.test(expr.value)) return null;
  return BigInt(expr.value);
}

export function minusOne(expr: IrExpr): IrExpr {
  const value = integerValue(expr);
  if (value !== null) return { kind: 'num', value: (value - BigInt(1)).toString() };
  return {
    kind: 'binop',
    op: 'MINUS',
    left: expr,
    right: { kind: 'num', value: '1' },
  };
}

/** 表达式 → IR。翻不了就记一条诊断并返回 null（调用方负责让整条语句一起失败）。 */
