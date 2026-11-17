/**
 * 模板路径 · 推导式：静态展开，或展开成「空列表 + 循环 + append」。
 *
 * 两条判据与 AST 路径（`ast/ir-comprehension.ts`）逐字对齐：
 *
 * 1. **静态展开（既有行为，不改语义）**：所有生成器都是「字面量 range、没有 if」时，元素按
 *    每个取值代换后写成 `lists_create_with`（多生成器是笛卡尔积，外层 for 变化最慢）。空区间
 *    落 `lists_create_empty`，超过 64 项报 `compTooLong`。
 * 2. **动态展开**：只有一个生成器且它带 `if` 或区间不是字面量时，`target = [...]` 改写成
 *    三条语句——`target = []` → 循环（一参 range 用 `ctrl_iterate`，两/三参步长 1 用
 *    `ctrl_range`，其余列表表达式用原生 `controls_forEach`）→ 循环体里 `arr_append(target,
 *    表达式)`；有 `if` 时循环体是 `controls_if` 包住 append。
 *
 * 落点只认「简单变量赋值」的右侧：展开后没有值，放进 return、函数实参或任何表达式里都没有
 * 对应块，报 `COMP_ASSIGN_ONLY` 而不是产出半成品。多个生成器 / 多个 if 的嵌套展开还没实现，
 * 报 `COMP_NESTED`。
 *
 * **变量遮蔽**：Python 3 的推导式有独立作用域，`v = 1; arr = [v for v in range(3)]` 之后 `v`
 * 仍是 1。展开会把 `v` 变成循环变量，所以循环变量名与目标函数参数 / 同作用域已出现过的变量
 * 重名时，按已有名字集合改名为确定性的 `v_1`、`v_2`…，并同步改写表达式里的引用。
 *
 * 拆成独立文件只为守住单文件 ≤ 500 行；表达式层不反向依赖这里。
 */

import type { ParsedNode } from '../parser';
import {
  COMP_ASSIGN_ONLY,
  COMP_GENERATOR,
  COMP_NESTED,
  RANGE_ARITY,
  RANGE_STEP,
  compTooLong,
} from '../diagnostics';
import { blocked, child, node } from './nodes';
import { matchParens, splitTopLevel, topLevelTokens } from './text';

/** 推导式静态展开上限：与 AST 路径的 `MAX_LIST_ITEMS` 同一个数。 */
export const MAX_LIST_ITEMS = 64;
/** 切片端点与 range 参数只认十进制整数（负号也算字面量的一部分）。 */
const INTEGER_LITERAL = /^-?\d+$/;

export type ParseExpr = (text: string) => ParsedNode;

/** 一个生成器分句：`v in range(字面量, ...)`，可选若干 `if cond`。 */
interface Clause {
  variable: string;
  iter: string;
  conditions: string[];
}

/** 静态展开用的区间：`for v in range(start, stop)`，步长只能是 1。 */
interface Bounds {
  variable: string;
  start: number;
  stop: number;
}

/** `range(...)` 的参数；不是 range 调用时返回 null。 */
function rangeParts(iter: string): string[] | null {
  const match = /^range\s*\(([\s\S]*)\)$/.exec(iter);
  if (!match || !matchParens(iter, iter.indexOf('('))) return null;
  return splitTopLevel(match[1]);
}

/** 把 `for ...` 分句切成「变量 in 迭代器 + if 条件」。 */
function readClause(text: string): Clause | null {
  const ifTokens = topLevelTokens(text, ['if']);
  const iter = (ifTokens.length ? text.slice(0, ifTokens[0].index) : text).trim();
  const match = /^([A-Za-z_]\w*)\s+in\s+([\s\S]+)$/.exec(iter);
  if (!match) return null;
  const conditions = ifTokens.map((token, index) => {
    const end = index + 1 < ifTokens.length ? ifTokens[index + 1].index : text.length;
    return text.slice(token.index + 2, end).trim();
  });
  if (conditions.some((condition) => !condition)) return null;
  return { variable: match[1], iter: match[2].trim(), conditions };
}

/** 拆推导式的元素与生成器分句；结构认不出返回 null。 */
export function analyzeListComp(
  body: string,
  forTokens: Array<{ index: number }>,
): { element: string; clauses: Clause[] } | null {
  const element = body.slice(0, forTokens[0].index).trim();
  if (!element) return null;
  const clauses: Clause[] = [];
  for (let index = 0; index < forTokens.length; index += 1) {
    const from = forTokens[index].index + 3;
    const to = index + 1 < forTokens.length ? forTokens[index + 1].index : body.length;
    const clause = readClause(body.slice(from, to).trim());
    if (!clause) return null;
    clauses.push(clause);
  }
  return clauses.length ? { element, clauses } : null;
}

/** 全部生成器都是「字面量 range、没有 if」时返回区间表（静态展开的前提）。 */
function staticBounds(clauses: Clause[]): Bounds[] | null {
  if (clauses.some((clause) => clause.conditions.length)) return null;
  const bounds: Bounds[] = [];
  for (const clause of clauses) {
    const args = rangeParts(clause.iter);
    if (!args || !args.length || args.length > 3) return null;
    if (!args.every((arg) => INTEGER_LITERAL.test(arg))) return null;
    if (args.length === 3 && Number(args[2]) !== 1) return null;
    const start = args.length >= 2 ? Number(args[0]) : 0;
    const stop = args.length >= 2 ? Number(args[1]) : Number(args[0]);
    bounds.push({ variable: clause.variable, start, stop });
  }
  return bounds;
}

/** 把节点树里对 `name` 的引用换成字面量（静态展开时代换循环变量）。 */
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

/** 把节点树里对 `from` 的变量引用改名（动态展开时的遮蔽处理）。 */
function renameVariable(value: ParsedNode, from: string, to: string): ParsedNode {
  if (value.type === 'variables_get' && value.fields.VAR === from) {
    return { ...value, fields: { ...value.fields, VAR: to } };
  }
  return {
    ...value,
    children: value.children.map((item) => ({ input: item.input, node: renameVariable(item.node, from, to) })),
  };
}

/** 节点树里出现过的变量名（改名时要把它们算进「已占用」）。 */
function collectVariables(value: ParsedNode, out = new Set<string>()): Set<string> {
  if (value.type === 'variables_get' && value.fields.VAR) out.add(value.fields.VAR);
  for (const item of value.children) collectVariables(item.node, out);
  return out;
}

/** 确定性新名：`v_1`、`v_2`…，按已有名字集合递增。 */
function freshName(base: string, taken: Set<string>): string {
  let index = 1;
  while (taken.has(`${base}_${index}`)) index += 1;
  const name = `${base}_${index}`;
  taken.add(name);
  return name;
}

/** 循环体的包法：一条语句用链节点包住（与语句层同类复合语句同形）。 */
function wrapBody(value: ParsedNode): ParsedNode {
  return { type: 'chain', fields: {}, children: [{ input: 'STATEMENT0', node: value }] };
}

/**
 * 推导式 → 列表块（静态展开）。
 *
 * 只认「生成器全是字面量 range、没有 if」的形态；其余形态在表达式位置报诊断（赋值右侧由
 * `desugarAssignment` 接手）。多个生成器是笛卡尔积（外层 for 变化最慢）。
 */
export function listCompNode(body: string, forTokens: Array<{ index: number }>, parse: ParseExpr): ParsedNode {
  const analyzed = analyzeListComp(body, forTokens);
  if (!analyzed) return blocked(COMP_GENERATOR);
  const { element, clauses } = analyzed;
  const bounds = staticBounds(clauses);
  if (!bounds) return blocked(clauses.length > 1 ? COMP_NESTED : COMP_ASSIGN_ONLY);

  const elt = parse(element);
  if (elt.type.startsWith('UNRESOLVED')) return elt;

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

/** 迭代器的落块：一参 range → ctrl_iterate；两/三参步长 1 → ctrl_range；其余 → controls_forEach。 */
function loopFor(name: string, clause: Clause, body: ParsedNode, parse: ParseExpr): ParsedNode {
  const args = rangeParts(clause.iter);
  if (args) {
    if (args.length < 1 || args.length > 3) return blocked(RANGE_ARITY);
    if (args.length === 3 && args[2] !== '1') return blocked(RANGE_STEP);
    if (args.length === 1) {
      return node('ctrl_iterate', { VAR: name }, [child('TIMES', parse(args[0])), child('DO', body)]);
    }
    return node('ctrl_range', { VAR: name }, [
      child('FROM', parse(args[0])),
      child('TO', parse(args[1])),
      child('DO', body),
    ]);
  }
  const list = parse(clause.iter);
  if (list.type.startsWith('UNRESOLVED')) {
    return blocked(list.blocked?.detail ?? COMP_GENERATOR, list.blocked?.reason ?? 'unsupported');
  }
  return node('controls_forEach', { VAR: name }, [child('LIST', list), child('DO', body)]);
}

/**
 * `target = [...]` 的展开。
 *
 * 返回 null 表示「右侧不是需要动态展开的推导式」（普通列表 / 字面量推导式交给 `parseValue`）；
 * 返回链节点表示展开成功；返回带 `blocked` 的 UNRESOLVED 表示该语句整体落不了地（一条诊断）。
 */
export function desugarAssignment(
  target: string,
  right: string,
  parse: ParseExpr,
  seen: Set<string>,
): ParsedNode | null {
  const source = right.trim();
  if (!source.startsWith('[') || !source.endsWith(']')) return null;
  const body = source.slice(1, -1);
  const forTokens = topLevelTokens(body, ['for']);
  if (!forTokens.length) return null;

  const analyzed = analyzeListComp(body, forTokens);
  if (!analyzed) return blocked(COMP_GENERATOR);
  const { element, clauses } = analyzed;
  // 静态可展开的形态保持既有语义：交给表达式层。
  if (staticBounds(clauses)) return null;
  if (clauses.length > 1) return blocked(COMP_NESTED);
  const clause = clauses[0];
  if (clause.conditions.length > 1) return blocked(COMP_NESTED);

  const elt = parse(element);
  if (elt.type.startsWith('UNRESOLVED')) {
    return blocked(elt.blocked?.detail ?? COMP_GENERATOR, elt.blocked?.reason ?? 'unsupported');
  }
  const conditions = clause.conditions.map((text) => parse(text));
  const failedCondition = conditions.find((condition) => condition.type.startsWith('UNRESOLVED'));
  if (failedCondition) {
    return blocked(failedCondition.blocked?.detail ?? COMP_GENERATOR, failedCondition.blocked?.reason ?? 'unsupported');
  }

  // 变量遮蔽：循环变量与已出现过的名字（含目标本身、参数、表达式里引用的外层变量）重名时改名。
  // 元素/条件里对循环变量自身的引用是**绑定**引用，不算外层占用；只有外层已有同名变量
  // （或目标变量本身同名）才需要改名。
  const taken = new Set(seen);
  taken.add(target);
  for (const name of collectVariables(elt)) if (name !== clause.variable) taken.add(name);
  for (const condition of conditions) {
    for (const name of collectVariables(condition)) if (name !== clause.variable) taken.add(name);
  }
  const loopName = taken.has(clause.variable) ? freshName(clause.variable, taken) : clause.variable;
  const renamedElement = loopName === clause.variable ? elt : renameVariable(elt, clause.variable, loopName);
  const renamedConditions = conditions.map((condition) =>
    (loopName === clause.variable ? condition : renameVariable(condition, clause.variable, loopName)),
  );

  const append = node('arr_append', {}, [
    child('LIST', node('variables_get', { VAR: target })),
    child('VALUE', renamedElement),
  ]);
  let loopBody = wrapBody(append);
  if (renamedConditions.length) {
    loopBody = wrapBody({
      type: 'controls_if',
      fields: {},
      extraState: { elseIfCount: 0, hasElse: false },
      children: [child('IF0', renamedConditions[0]), child('DO0', loopBody)],
    });
  }
  const loop = loopFor(loopName, clause, loopBody, parse);
  if (loop.type.startsWith('UNRESOLVED')) return loop;
  const assign = node('variables_set', { VAR: target }, [child('VALUE', node('lists_create_empty'))]);
  return {
    type: 'chain',
    fields: {},
    children: [
      { input: 'STATEMENT0', node: assign },
      { input: 'STATEMENT1', node: loop },
    ],
  };
}
