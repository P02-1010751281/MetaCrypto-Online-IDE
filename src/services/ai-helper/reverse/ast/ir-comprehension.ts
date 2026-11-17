/**
 * 推导式（`ListComp`）→ IR：静态展开，或展开成「空列表 + 循环 + append」。
 *
 * 判据与模板路径（`core/comprehension.ts`）逐字对齐：
 *
 * 1. **静态展开（既有行为，不改语义）**：生成器全是「字面量 range、没有 if」时，元素按每个
 *    取值代换后写成 `{ kind: 'list' }`（`lists_create_with`）；多生成器是笛卡尔积（外层的 for
 *    在前，与 Python 的遍历顺序一致）；空区间落空列表，超过 64 项报 `compTooLong`。
 * 2. **动态展开**：只有一个生成器且它带 `if` 或区间不是字面量时，`target = [...]` 由
 *    `desugarListComp` 展开成 `target = []` → 循环 → `append(target, 元素)`；循环按迭代器落
 *    `ctrl_iterate`（一参 range）/ `ctrl_range`（两/三参步长 1）/ `controls_forEach`（列表表达式）。
 *    有 `if` 时循环体是 `controls_if` 包住 append。
 * 3. **落点**：动态展开只认赋值右侧；表达式位置（return、实参、嵌套）报 `COMP_ASSIGN_ONLY`。
 *    多个生成器 / 多个 if 的嵌套展开还没实现，报 `COMP_NESTED`。
 *
 * 变量遮蔽：Python 3 的推导式有独立作用域，`v = 1; arr = [v for v in range(3)]` 之后 `v`
 * 仍是 1。循环变量与 `ctx.scope`（形参 + 已出现的名字）重名时改名为 `v_1`、`v_2`…，并同步
 * 改写元素与条件里的引用。
 *
 * 拆出来只为守住单文件 ≤ 500 行；`convert` 由调用方传入（表达式层反向依赖这边会成环）。
 */

import type { AstNode } from './dump';
import type { Ctx, IrExpr, IrStmt } from './ir-shared';
import {
  COMP_ASSIGN_ONLY,
  COMP_GENERATOR,
  COMP_NESTED,
  RANGE_ARITY,
  RANGE_STEP,
  compTooLong,
} from '../diagnostics';
import { MAX_LIST_ITEMS, child, children, integerValue, lineOf, nameOf, report } from './ir-shared';

type Convert = (node: AstNode | null, ctx: Ctx) => IrExpr | null;

/** 一个生成器的静态区间：`for v in range(start, stop)`，步长只能是 1。 */
interface Bounds {
  variable: string;
  start: number;
  stop: number;
}

/** 一个生成器：目标变量、迭代器节点、可选的一个 if 条件。 */
interface Generator {
  variable: string;
  iter: AstNode;
  conditions: AstNode[];
}

/**
 * 推导式的展开计划。
 *
 * - `static`：生成器全是字面量 range、无 if，走既有笛卡尔积；
 * - `desugar`：单生成器，需要「空列表 + 循环 + append」；
 * - `unsupported`：多生成器嵌套 / 多条件还没实现，或生成器形状认不出。
 */
export type CompPlan =
  | { kind: 'static'; bounds: Bounds[] }
  | { kind: 'desugar'; generator: Generator }
  | { kind: 'unsupported'; detail: string };

/** `range(...)` 的字面量区间：返回 [start, stop)；非字面量或步长不是 1 时返回 null。 */
export function literalRange(range: AstNode): { start: number; stop: number } | null {
  const args = children(range, 'args');
  if (children(range, 'keywords').length || args.length < 1 || args.length > 3) return null;
  const values: number[] = [];
  for (const arg of args) {
    if (arg._ !== 'Constant' || typeof arg.value !== 'number') return null;
    values.push(arg.value);
  }
  if (values.length === 3 && values[2] !== 1) return null;
  const start = values.length >= 2 ? values[0] : 0;
  const stop = values.length >= 2 ? values[1] : values[0];
  return { start, stop };
}

/** 读一个生成器：目标必须是单个变量；迭代器与条件原样带走（时机由计划决定）。 */
function readGenerator(generator: AstNode): Generator | null {
  const target = child(generator, 'target');
  const iter = child(generator, 'iter');
  if (!target || target._ !== 'Name' || !iter) return null;
  const variable = nameOf(target);
  if (!variable) return null;
  return { variable, iter, conditions: children(generator, 'ifs') };
}

/** 判定一段推导式该怎么展开。 */
export function planComp(node: AstNode): CompPlan {
  const generators = children(node, 'generators');
  if (!generators.length) return { kind: 'unsupported', detail: COMP_GENERATOR };
  const read: Generator[] = [];
  for (const generator of generators) {
    const parsed = readGenerator(generator);
    if (!parsed) return { kind: 'unsupported', detail: COMP_GENERATOR };
    read.push(parsed);
  }
  if (read.length === 1) {
    const only = read[0];
    const literal = only.iter._ === 'Call' && nameOf(child(only.iter, 'func')) === 'range'
      ? literalRange(only.iter)
      : null;
    // 字面量 range 且没有 if：保持既有静态展开（既有用例的语义不许变）。
    if (literal && !only.conditions.length) {
      return { kind: 'static', bounds: [{ variable: only.variable, start: literal.start, stop: literal.stop }] };
    }
    if (only.conditions.length > 1) return { kind: 'unsupported', detail: COMP_NESTED };
    return { kind: 'desugar', generator: only };
  }
  // 多生成器：只有「全是字面量 range、没有 if」能静态展开（既有行为）。
  const bounds: Bounds[] = [];
  for (const generator of read) {
    if (generator.conditions.length) return { kind: 'unsupported', detail: COMP_NESTED };
    if (generator.iter._ !== 'Call' || nameOf(child(generator.iter, 'func')) !== 'range') {
      return { kind: 'unsupported', detail: COMP_NESTED };
    }
    const literal = literalRange(generator.iter);
    if (!literal) return { kind: 'unsupported', detail: COMP_NESTED };
    bounds.push({ variable: generator.variable, start: literal.start, stop: literal.stop });
  }
  return { kind: 'static', bounds };
}

/** 把表达式树里对 `name` 的引用换成字面量：推导式展开时代换循环变量。 */
function replaceName(expr: IrExpr, name: string, value: string): IrExpr {
  if (expr.kind === 'name') return expr.name === name ? { kind: 'num', value, line: expr.line } : expr;
  return mapChildren(expr, (item) => replaceName(item, name, value));
}

/** 把表达式树里对 `from` 的变量引用改名（动态展开时的遮蔽处理）。 */
function renameName(expr: IrExpr, from: string, to: string): IrExpr {
  if (expr.kind === 'name') return expr.name === from ? { ...expr, name: to } : expr;
  return mapChildren(expr, (item) => renameName(item, from, to));
}

/** 表达式树里出现过的变量名（改名时要把它们算进「已占用」）。 */
function collectNames(expr: IrExpr, out = new Set<string>()): Set<string> {
  if (expr.kind === 'name') out.add(expr.name);
  forEachChild(expr, (item) => collectNames(item, out));
  return out;
}

/** 只遍历不替换：改名的占用集合要用它。 */
function forEachChild(expr: IrExpr, visit: (expr: IrExpr) => void): void {
  mapChildren(expr, (item) => {
    visit(item);
    return item;
  });
}

/** 对表达式树里的子表达式统一做一次映射；只认 IR 里已有的表达式种类。 */
function mapChildren(expr: IrExpr, map: (expr: IrExpr) => IrExpr): IrExpr {
  switch (expr.kind) {
    case 'num':
    case 'str':
    case 'bool':
    case 'none':
    case 'name':
      return expr;
    case 'binop':
      return { ...expr, left: map(expr.left), right: map(expr.right) };
    case 'neg':
    case 'not':
      return { ...expr, operand: map(expr.operand) };
    case 'length':
      return { ...expr, value: map(expr.value) };
    case 'constrain':
      return { ...expr, value: map(expr.value), low: map(expr.low), high: map(expr.high) };
    case 'compare':
    case 'boolop':
      return { ...expr, left: map(expr.left), right: map(expr.right) };
    case 'call':
    case 'primitive':
      return { ...expr, args: expr.args.map(map) };
    case 'list':
      return { ...expr, items: expr.items.map(map) };
    case 'index':
      return { ...expr, value: map(expr.value), at: map(expr.at) };
    case 'ifexp':
      return { ...expr, test: map(expr.test), then: map(expr.then), otherwise: map(expr.otherwise) };
    default:
      return expr;
  }
}

/** 笛卡尔积展开：外层生成器变化最慢，与 Python 的遍历顺序一致。 */
function expand(bounds: Bounds[], index: number, element: IrExpr, out: IrExpr[]): void {
  if (index === bounds.length) {
    out.push(element);
    return;
  }
  const bound = bounds[index];
  for (let value = bound.start; value < bound.stop; value += 1) {
    expand(bounds, index + 1, replaceName(element, bound.variable, String(value)), out);
  }
}

/** 静态展开：区间表 → `{ kind: 'list' }`。 */
function staticList(bounds: Bounds[], element: IrExpr, ctx: Ctx, node: AstNode): IrExpr | null {
  let count = 1;
  for (const bound of bounds) count *= Math.max(0, bound.stop - bound.start);
  if (count > MAX_LIST_ITEMS) return report(ctx, node, compTooLong(count));
  const items: IrExpr[] = [];
  expand(bounds, 0, element, items);
  return { kind: 'list', items, line: lineOf(node) };
}

/**
 * `ListComp` 在**表达式位置** → `{ kind: 'list' }`（只有静态展开一种忠实表示）。
 *
 * 需要动态展开的形态在表达式位置没有值可放，报 `COMP_ASSIGN_ONLY` 而不是近似。
 */
export function listCompToIr(node: AstNode, ctx: Ctx, convert: Convert): IrExpr | null {
  const plan = planComp(node);
  if (plan.kind === 'unsupported') return report(ctx, node, plan.detail);
  if (plan.kind === 'desugar') return report(ctx, node, COMP_ASSIGN_ONLY);
  const element = convert(child(node, 'elt'), ctx);
  if (!element) return null;
  return staticList(plan.bounds, element, ctx, node);
}

/** 确定性新名：`v_1`、`v_2`…，按已有名字集合递增。 */
function freshName(base: string, taken: Set<string>): string {
  let index = 1;
  while (taken.has(`${base}_${index}`)) index += 1;
  const name = `${base}_${index}`;
  taken.add(name);
  return name;
}

/** 把条件与 append 包进循环体：有 if 时是 `controls_if`，否则直接是 append。 */
function appendBody(target: string, element: IrExpr, condition: IrExpr | null): IrStmt[] {
  const append: IrStmt = { kind: 'append', list: { kind: 'name', name: target }, value: element };
  if (!condition) return [append];
  return [{ kind: 'if', branches: [{ test: condition, body: [append] }], orelse: [] }];
}

/** 迭代器落循环：一参 range → iterate；两/三参步长 1 → range；其余 → forEach。 */
function loopFor(
  variable: string,
  iter: AstNode,
  body: IrStmt[],
  ctx: Ctx,
  convert: Convert,
): IrStmt | null {
  const isRange = iter._ === 'Call' && nameOf(child(iter, 'func')) === 'range';
  if (!isRange) {
    const list = convert(iter, ctx);
    if (!list) return null;
    return { kind: 'forEach', variable, list, body };
  }
  if (children(iter, 'keywords').length) return report(ctx, iter, 'range 不接受关键字参数');
  const args = children(iter, 'args').map((arg) => convert(arg, ctx));
  if (args.some((arg) => !arg)) return null;
  const values = args as IrExpr[];
  if (values.length < 1 || values.length > 3) return report(ctx, iter, RANGE_ARITY);
  if (values.length === 1) return { kind: 'iterate', variable, times: values[0], body };
  if (values.length === 3 && integerValue(values[2]) !== BigInt(1)) {
    return report(ctx, iter, RANGE_STEP);
  }
  return { kind: 'range', variable, from: values[0], to: values[1], body };
}

/**
 * `target = [...]` 的动态展开。
 *
 * 返回 `'static'` 表示「保持既有静态展开」（调用方回落到 `exprToIr` → `listCompToIr`）；
 * 返回语句数组表示展开成功；返回 null 表示该语句落不了地（诊断已记录）。
 */
export function desugarListComp(
  target: string,
  node: AstNode,
  ctx: Ctx,
  convert: Convert,
): IrStmt[] | 'static' | null {
  const plan = planComp(node);
  if (plan.kind === 'static') return 'static';
  if (plan.kind === 'unsupported') {
    report(ctx, node, plan.detail);
    return null;
  }
  const generator = plan.generator;
  const element = convert(child(node, 'elt'), ctx);
  if (!element) return null;
  const conditions = generator.conditions.map((condition) => convert(condition, ctx));
  if (conditions.some((condition) => !condition)) return null;
  const condition = (conditions[0] as IrExpr | undefined) ?? null;

  // 变量遮蔽：循环变量与已出现过的名字（含目标本身、表达式引用的外层变量）重名时改名。
  // 元素/条件里对循环变量自身的引用是**绑定**引用，不算外层占用；只有外层已有同名变量
  // （或目标变量本身同名）才需要改名。
  const taken = new Set(ctx.scope);
  taken.add(target);
  for (const name of collectNames(element)) {
    if (name !== generator.variable) taken.add(name);
  }
  if (condition) {
    for (const name of collectNames(condition)) {
      if (name !== generator.variable) taken.add(name);
    }
  }
  const loopName = taken.has(generator.variable)
    ? freshName(generator.variable, taken)
    : generator.variable;
  const renamed = loopName !== generator.variable;
  const value = renamed ? renameName(element, generator.variable, loopName) : element;
  const test = condition && renamed ? renameName(condition, generator.variable, loopName) : condition;

  const loop = loopFor(loopName, generator.iter, appendBody(target, value, test), ctx, convert);
  if (!loop) return null;
  const assign: IrStmt = { kind: 'assign', target, value: { kind: 'list', items: [], line: lineOf(node) } };
  return [assign, loop];
}
