/**
 * 核心语法层 · 表达式：按 Python 运算符优先级把一段文本拆成块节点。
 *
 * 与语句层（`statements.ts`）一起构成模板路径的核心语法层；公共类型在 `types.ts`。
 * 纪律：拆不动就返回 null（调用方保留 UNRESOLVED），绝不换成相近的块。
 */

import { parseExpression } from '../parser';
import type { ParsedNode } from '../parser';
import type { CoreContext } from './types';

const IDENTIFIER = /^[A-Za-z_]\w*$/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)$/;
/** 切片端点与 range 参数只认十进制整数（负号也算字面量的一部分）。 */
const INTEGER_LITERAL = /^-?\d+$/;
/** 推导式展开上限：与 AST 路径的 `MAX_LIST_ITEMS` 同一个数。 */
const MAX_LIST_ITEMS = 64;
const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * 顶层扫描：返回所有「深度 0、且不在字符串里」的 token 位置。
 *
 * 运算符拆分全靠它：括号里的 `+` 属于子表达式，字符串里的 `+` 是字符。token 按长度降序
 * 尝试，保证 `<=` 不会被拆成 `<`，`**` 不会被拆成 `*`。
 */
function topLevelTokens(text: string, tokens: string[]): Array<{ index: number; token: string }> {
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const found: Array<{ index: number; token: string }> = [];
  let depth = 0;
  let quote = '';
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
    if (OPENERS.includes(char)) {
      depth += 1;
      continue;
    }
    if (CLOSERS.includes(char)) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    const token = ordered.find((candidate) => text.startsWith(candidate, index));
    if (!token) continue;
    // 词形运算符（and/or/not）必须整词命中：`android` 不是 `and`。
    if (/^[a-z]+$/.test(token)) {
      const before = text[index - 1] ?? ' ';
      const after = text[index + token.length] ?? ' ';
      if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue;
    }
    found.push({ index, token });
    index += token.length - 1;
  }
  return found;
}

/** 该位置是不是二元运算符：前一个非空字符是操作数结尾（变量、字面量、右括号）。 */
function isBinaryAt(text: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (char === ' ' || char === '\t') continue;
    return /[A-Za-z0-9_)\]}"']/.test(char);
  }
  return false;
}

/** 在给定 token 里挑最后一个可用位置（左结合）；`binaryOnly` 时跳过一元位置。 */
function lastUseful(
  text: string,
  tokens: string[],
  binaryOnly = true,
): { index: number; token: string } | null {
  const all = topLevelTokens(text, tokens).filter((item) => !binaryOnly || isBinaryAt(text, item.index));
  return all.length ? all[all.length - 1] : null;
}

export function node(type: string, fields: Record<string, string> = {}, children: ParsedNode['children'] = []): ParsedNode {
  return { type, fields, children };
}

export function child(input: string, value: ParsedNode): ParsedNode['children'][number] {
  return { input, node: value };
}

export function unresolved(): ParsedNode {
  return node('UNRESOLVED');
}

/** 模板层优先：密码块的代码形态、字面量与变量名都由它认。 */
export function parseValue(text: string, ctx: CoreContext, depth = 0): ParsedNode {
  const source = text.trim();
  const templated = parseExpression(source, ctx.matchers);
  if (!templated.type.startsWith('UNRESOLVED')) return templated;
  const core = parseCoreExpression(source, ctx, depth);
  return core ?? templated;
}

/** 二元运算符 → 块。`%` 走 `math_modulo`（无 OP 字段），其余走 `math_arithmetic`。 */
function arithmeticNode(token: string, left: ParsedNode, right: ParsedNode): ParsedNode | null {
  if (token === '%') return node('math_modulo', {}, [child('DIVIDEND', left), child('DIVISOR', right)]);
  const op: Record<string, string> = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE', '**': 'POWER' };
  const value = op[token];
  return value ? node('math_arithmetic', { OP: value }, [child('A', left), child('B', right)]) : null;
}

const COMPARE: Record<string, string> = { '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' };
const BITWISE: Record<string, string> = { '&': 'AND', '|': 'OR', '^': 'XOR', '<<': 'LEFT_SHIFT', '>>': 'RIGHT_SHIFT' };

/**
 * 表达式 → 块。返回 null 表示「拆不动」，调用方保留 UNRESOLVED（不猜）。
 *
 * 分层顺序就是 Python 的优先级：从最低的结合处切开，再各自递归——先把最低优先级的运算符
 * 定位出来，左右两边各自由下一层继续拆。
 */
export function parseCoreExpression(text: string, ctx: CoreContext, depth = 0): ParsedNode | null {
  if (depth > 32) return null;
  const source = text.trim();
  if (!source) return null;
  const inner = (value: string): ParsedNode => parseValue(value, ctx, depth + 1);

  // 1. 条件表达式 `A if C else B`（右结合：else 之后整体递归）。
  const ifToken = topLevelTokens(source, ['if']);
  if (ifToken.length === 1) {
    const head = source.slice(0, ifToken[0].index).trim();
    const rest = source.slice(ifToken[0].index + 2);
    const elseToken = topLevelTokens(rest, ['else']);
    if (elseToken.length === 1 && head) {
      const test = rest.slice(0, elseToken[0].index).trim();
      const otherwise = rest.slice(elseToken[0].index + 4).trim();
      if (test && otherwise) {
        return node('logic_ternary', {}, [child('IF', inner(test)), child('THEN', inner(head)), child('ELSE', inner(otherwise))]);
      }
    }
  }

  // 2. or / and：块只有两输入，`a and b and c` 左折叠（与 AST 路径一致）。
  for (const [token, op] of [['or', 'OR'], ['and', 'AND']] as const) {
    const hit = lastUseful(source, [token], false);
    if (hit) {
      const left = source.slice(0, hit.index).trim();
      const right = source.slice(hit.index + token.length).trim();
      if (left && right) return node('logic_operation', { OP: op }, [child('A', inner(left)), child('B', inner(right))]);
      return null;
    }
  }

  // 3. not（低于比较、高于 and）。
  if (/^not\s+/.test(source)) {
    return node('logic_negate', {}, [child('BOOL', inner(source.slice(4)))]);
  }

  // 4. 比较：只认单个；链式比较与 AST 路径一样报不支持。
  const comparisons = topLevelTokens(source, ['==', '!=', '<=', '>=', '<', '>']).filter(
    (item) => isBinaryAt(source, item.index),
  );
  if (comparisons.length > 1) return null;
  if (comparisons.length === 1) {
    const hit = comparisons[0];
    const left = source.slice(0, hit.index).trim();
    const right = source.slice(hit.index + hit.token.length).trim();
    if (!left || !right) return null;
    return node('logic_compare', { OP: COMPARE[hit.token] }, [child('A', inner(left)), child('B', inner(right))]);
  }

  // 5. 按位与移位：AST 路径一律落 `bit_operation`（bit_expr_infix 与它生成的代码逐字相同，
  //    见 §41.3 的 FIELD_COLLISIONS；这里选前者，保证两条路径产出同一个块）。
  for (const tokens of [['<<', '>>'], ['&'], ['^'], ['|']] as string[][]) {
    const hit = lastUseful(source, tokens);
    if (!hit) continue;
    const left = source.slice(0, hit.index).trim();
    const right = source.slice(hit.index + hit.token.length).trim();
    if (!left || !right) return null;
    ctx.diagnostics?.push({
      text: source,
      detail: '按位运算映射到 bit_operation 块：该块会把操作数强制成 uint32，语义与原文不同',
      reason: 'semantic-drift',
    });
    return node('bit_operation', { OP: BITWISE[hit.token] }, [child('A', inner(left)), child('B', inner(right))]);
  }

  // 6. 加减。
  const additive = lastUseful(source, ['+', '-']);
  if (additive) {
    const left = source.slice(0, additive.index).trim();
    const right = source.slice(additive.index + 1).trim();
    if (!left || !right) return null;
    return arithmeticNode(additive.token, inner(left), inner(right));
  }

  // 7. 乘除模（`//` 没有对应块，遇到就整条不认；`**` 属于下一层，不能在这里被拆成两个 `*`）。
  if (topLevelTokens(source, ['//']).length) return null;
  const multiplicative = lastUseful(source, ['**', '*', '/', '%'])?.token === '**'
    ? null
    : lastUseful(source, ['*', '/', '%']);
  if (multiplicative) {
    const left = source.slice(0, multiplicative.index).trim();
    const right = source.slice(multiplicative.index + multiplicative.token.length).trim();
    if (!left || !right) return null;
    return arithmeticNode(multiplicative.token, inner(left), inner(right));
  }

  // 8. 一元负号（比 ** 松、比 * 紧）。
  if (/^-\s*/.test(source) && !/^->/.test(source)) {
    const operand = parseCoreExpression(source.slice(1), ctx, depth + 1);
    if (!operand) return null;
    return node('math_single', { OP: 'NEG' }, [child('NUM', operand)]);
  }
  if (/^\+\s*/.test(source)) return parseCoreExpression(source.slice(1), ctx, depth + 1);

  // 9. 幂（右结合）。
  // `**` 已经在乘除层被排除，这里按「第一个」位置拆（右结合）。
  const power = topLevelTokens(source, ['**']).filter((item) => isBinaryAt(source, item.index))[0] ?? null;
  if (power) {
    const left = source.slice(0, power.index).trim();
    const right = source.slice(power.index + 2).trim();
    if (!left || !right) return null;
    return node('math_arithmetic', { OP: 'POWER' }, [child('A', inner(left)), child('B', inner(right))]);
  }

  return atomNode(source, ctx, depth);
}

/** 原子：括号、列表、下标、调用（只认本模块 procedure）、变量与数字。 */
function atomNode(source: string, ctx: CoreContext, depth: number): ParsedNode | null {
  const inner = (value: string): ParsedNode => parseValue(value, ctx, depth + 1);

  // 外层括号整段包住：交给内层重新分优先级。
  if (source.startsWith('(') && source.endsWith(')')) {
    const innerText = source.slice(1, -1);
    const wrapped = parseValue(innerText, ctx, depth + 1);
    if (!wrapped.type.startsWith('UNRESOLVED')) return wrapped;
  }

  // 列表字面量：AST 路径用 lists_create_with + itemCount。
  if (source.startsWith('[') && source.endsWith(']')) {
    const body = source.slice(1, -1).trim();
    // 推导式优先：`[f(v) for v in range(3)]` 里也有逗号与方括号，先按 `for` 拆。
    const forTokens = topLevelTokens(body, ['for']);
    if (forTokens.length) return listCompNode(body, forTokens, ctx, depth);
    const items = body ? splitTopLevel(body) : [];
    const children: ParsedNode['children'] = [];
    for (let index = 0; index < items.length; index += 1) {
      children.push(child(`ADD${index}`, inner(items[index])));
    }
    return { type: 'lists_create_with', fields: {}, children, extraState: { itemCount: items.length } };
  }

  // 下标 / 切片：`a[i]` 与 `a[i:j]` 分开处理（AST 路径同口径）。
  const subscript = matchBracketTail(source);
  if (subscript) {
    const indexText = subscript.indexText.trim();
    const parts = splitSlice(indexText);
    if (parts.length > 1) return sliceNode(subscript.base, parts, ctx, depth);
    if (!NUMBER.test(indexText)) return null;
    return node('lists_getIndex', { MODE: 'GET', WHERE: 'FROM_START' }, [
      child('VALUE', inner(subscript.base)),
      child('AT', inner(indexText)),
    ]);
  }

  // 调用：只认本模块 procedure——密码块由模板层先接走，走到这里说明模板没命中。
  const call = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(source);
  if (call && matchParens(source, call[1].length)) {
    const params = ctx.procedures.get(call[1]);
    if (!params) return null;
    const args = call[2].trim() ? splitTopLevel(call[2]) : [];
    const children: ParsedNode['children'] = args.map((arg, index) => child(`ARG${index}`, inner(arg)));
    return { type: 'procedures_callreturn', fields: {}, children, extraState: { name: call[1], params } };
  }

  // 数字/True/False/None 由模板层（parseExpression 的字面量分支）先认，走到这里只剩变量名。
  if (IDENTIFIER.test(source)) return node('variables_get', { VAR: source });
  return null;
}

/** 按顶层冒号切切片端点：`a[1:2]` → ['1','2']，`a[1:2:3]` → 3 段（步长不支持）。 */
function splitSlice(text: string): string[] {
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
    if (OPENERS.includes(char)) depth += 1;
    else if (CLOSERS.includes(char)) depth -= 1;
    else if (char === ':' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/**
 * 切片 → `arr_slice`。与 AST 路径同一套等价判据（见 `ast/ir-expr.ts` 的 `sliceToIr`）：
 * 省略终点、带步长、起终点一正一负、终点小于起点都不出块；起终点不是字面量时出块但记漂移。
 */
function sliceNode(base: string, parts: string[], ctx: CoreContext, depth: number): ParsedNode | null {
  if (parts.length > 2) return null;
  const endText = parts[1];
  if (!endText) return null;
  const startText = parts[0] || '0';
  const inner = (value: string): ParsedNode => parseValue(value, ctx, depth + 1);
  let length: ParsedNode;
  if (INTEGER_LITERAL.test(startText) && INTEGER_LITERAL.test(endText)) {
    const start = Number(startText);
    const end = Number(endText);
    if ((start < 0) !== (end < 0)) return null;
    if (end < start) return null;
    length = inner(String(end - start));
  } else {
    ctx.diagnostics?.push({
      text: `[${startText}:${endText}]`,
      detail: '切片起终点不是字面量：终点小于起点时块会因负长度报错，Python 返回空列表',
      reason: 'semantic-drift',
    });
    length = node('math_arithmetic', { OP: 'MINUS' }, [child('A', inner(endText)), child('B', inner(startText))]);
  }
  return node('arr_slice', {}, [
    child('LIST', inner(base)),
    child('START', inner(startText)),
    child('LENGTH', length),
  ]);
}

/** 把节点树里对 `name` 的引用换成字面量（推导式展开用，与 AST 路径的 replaceName 同口径）。 */
function replaceVariable(nodeValue: ParsedNode, name: string, value: string, ctx: CoreContext, depth: number): ParsedNode {
  if (nodeValue.type === 'variables_get' && nodeValue.fields.VAR === name) {
    return parseValue(value, ctx, depth + 1);
  }
  return {
    ...nodeValue,
    children: nodeValue.children.map((item) => ({
      input: item.input,
      node: replaceVariable(item.node, name, value, ctx, depth),
    })),
  };
}

/** 推导式 → 列表块：只认字面量 range，把循环变量代换成每个取值后展开。 */
function listCompNode(body: string, forTokens: Array<{ index: number }>, ctx: CoreContext, depth: number): ParsedNode | null {
  if (forTokens.length !== 1) return null;
  const head = body.slice(0, forTokens[0].index).trim();
  const rest = body.slice(forTokens[0].index + 3).trim();
  const match = /^([A-Za-z_]\w*)\s+in\s+range\(([\s\S]*)\)$/.exec(rest);
  if (!match || !matchParens(rest, rest.indexOf('('))) return null;
  const args = splitTopLevel(match[2]);
  if (!args.length || args.length > 3 || !args.every((arg) => INTEGER_LITERAL.test(arg))) return null;
  if (args.length === 3 && Number(args[2]) !== 1) return null;
  const start = args.length >= 2 ? Number(args[0]) : 0;
  const stop = args.length >= 2 ? Number(args[1]) : Number(args[0]);
  const count = Math.max(0, stop - start);
  if (count > MAX_LIST_ITEMS) return null;
  const element = parseValue(head, ctx, depth + 1);
  if (element.type.startsWith('UNRESOLVED')) return null;
  if (!count) return node('lists_create_empty');
  const children: ParsedNode['children'] = [];
  for (let index = 0; index < count; index += 1) {
    children.push(child(`ADD${index}`, replaceVariable(element, match[1], String(start + index), ctx, depth)));
  }
  return { type: 'lists_create_with', fields: {}, children, extraState: { itemCount: count } };
}

/** `base[index]` 的最外层方括号：base 与 indexText 分开返回。 */
function matchBracketTail(source: string): { base: string; indexText: string } | null {
  if (!source.endsWith(']')) return null;
  let depth = 0;
  let quote = '';
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ']') depth += 1;
    else if (char === '[') {
      depth -= 1;
      if (depth === 0) {
        const base = source.slice(0, index).trim();
        return base ? { base, indexText: source.slice(index + 1, -1) } : null;
      }
    }
  }
  return null;
}

/** `name(...)` 的右括号是否正好在末尾：避免把 `f(a) + g(b)` 当成一个调用。 */
function matchParens(source: string, openAt: number): boolean {
  let depth = 0;
  let quote = '';
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index === source.length - 1;
    }
  }
  return false;
}

/** 顶层逗号切分（列表项、调用实参；语句层拆 range 参数也用它）。 */
export function splitTopLevel(text: string): string[] {
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
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (OPENERS.includes(char)) depth += 1;
    else if (CLOSERS.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}
