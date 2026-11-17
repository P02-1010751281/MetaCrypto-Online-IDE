/**
 * 推导式（`ListComp`）→ IR：展开成定长列表。
 *
 * 块模型没有 list append（`lists_setIndex` 被覆盖成只做按下标赋值），所以推导式只有一种
 * 忠实表示：生成器全是**字面量 range**、元素按每个取值代换后写成 `lists_create_with`。
 * 多个生成器是笛卡尔积（外层的 for 在前，与 Python 的遍历顺序一致）；带 `if`、迭代器不是
 * range、区间不是字面量都落不了地，报诊断而不是近似——文案与模板路径
 * `core/containers.ts` 共用 `../diagnostics.ts`。
 *
 * 拆出来只为守住单文件 ≤ 500 行；`convert` 由调用方传入（表达式层反向依赖这边会成环）。
 */

import type { AstNode } from './dump';
import type { Ctx, IrExpr } from './ir-shared';
import { COMP_IF, COMP_RANGE, compTooLong } from '../diagnostics';
import { MAX_LIST_ITEMS, child, children, lineOf, nameOf, report } from './ir-shared';

/** 一个生成器的静态区间：`for v in range(start, stop)`，步长只能是 1。 */
interface Bounds {
  variable: string;
  start: number;
  stop: number;
}

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

/** 把表达式树里对 `name` 的引用换成字面量：推导式展开时代换循环变量。 */
function replaceName(expr: IrExpr, name: string, value: string): IrExpr {
  switch (expr.kind) {
    case 'name':
      return expr.name === name ? { kind: 'num', value, line: expr.line } : expr;
    case 'num':
    case 'str':
    case 'bool':
    case 'none':
      return expr;
    case 'binop':
      return { ...expr, left: replaceName(expr.left, name, value), right: replaceName(expr.right, name, value) };
    case 'neg':
    case 'not':
      return { ...expr, operand: replaceName(expr.operand, name, value) };
    case 'length':
      return { ...expr, value: replaceName(expr.value, name, value) };
    case 'compare':
    case 'boolop':
      return { ...expr, left: replaceName(expr.left, name, value), right: replaceName(expr.right, name, value) };
    case 'call':
    case 'primitive':
      return { ...expr, args: expr.args.map((arg) => replaceName(arg, name, value)) };
    case 'list':
      return { ...expr, items: expr.items.map((item) => replaceName(item, name, value)) };
    case 'index':
      return { ...expr, value: replaceName(expr.value, name, value), at: replaceName(expr.at, name, value) };
    case 'ifexp':
      return {
        ...expr,
        test: replaceName(expr.test, name, value),
        then: replaceName(expr.then, name, value),
        otherwise: replaceName(expr.otherwise, name, value),
      };
    default:
      return expr;
  }
}

/** 读一个生成器：目标必须是单个变量，迭代器必须是字面量 range。 */
function readGenerator(generator: AstNode): Bounds | null {
  const target = child(generator, 'target');
  const iter = child(generator, 'iter');
  if (!target || target._ !== 'Name') return null;
  if (!iter || iter._ !== 'Call' || nameOf(child(iter, 'func')) !== 'range') return null;
  const literal = literalRange(iter);
  if (!literal) return null;
  return { variable: nameOf(target), start: literal.start, stop: literal.stop };
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

/**
 * `ListComp` → `{ kind: 'list' }`。
 *
 * `convert` 是表达式层的 `exprToIr`：元素可能与生成器无关地复杂，交给它递归。
 */
export function listCompToIr(node: AstNode, ctx: Ctx, convert: (node: AstNode | null, ctx: Ctx) => IrExpr | null): IrExpr | null {
  const generators = children(node, 'generators');
  if (!generators.length) return report(ctx, node, COMP_RANGE);
  if (generators.some((generator) => children(generator, 'ifs').length)) return report(ctx, node, COMP_IF);

  const bounds: Bounds[] = [];
  for (const generator of generators) {
    const read = readGenerator(generator);
    if (!read) return report(ctx, node, COMP_RANGE);
    bounds.push(read);
  }

  let count = 1;
  for (const bound of bounds) count *= Math.max(0, bound.stop - bound.start);
  if (count > MAX_LIST_ITEMS) return report(ctx, node, compTooLong(count));

  const element = convert(child(node, 'elt'), ctx);
  if (!element) return null;
  const items: IrExpr[] = [];
  expand(bounds, 0, element, items);
  return { kind: 'list', items, line: lineOf(node) };
}
