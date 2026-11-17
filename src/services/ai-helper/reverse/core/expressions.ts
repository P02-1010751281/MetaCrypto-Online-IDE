/**
 * 核心语法层 · 表达式：按 Python 运算符优先级把一段文本拆成块节点。
 *
 * 与语句层（`statements.ts`）一起构成模板路径的核心语法层。按职责拆开（守住单文件 ≤ 500 行）：
 * `types.ts` 公共类型、`nodes.ts` 节点构造、`text.ts` 文本切分、`containers.ts` 切片与
 * 推导式、本文件按优先级拆表达式。
 *
 * 纪律：拆不动就返回 `blocked(...)`（带原因与说明）或 null（调用方保留 UNRESOLVED），
 * 绝不换成相近的块。
 */

import { parseExpression } from '../parser';
import type { ParsedNode } from '../parser';
import type { CoreContext } from './types';
import { child, node } from './nodes';
import { isBinaryAt, lastUseful, matchParens, splitTopLevel, topLevelTokens } from './text';
import { listCompNode, sliceNode, splitSlice } from './containers';

const IDENTIFIER = /^[A-Za-z_]\w*$/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)$/;

/** 模板层优先：密码块的代码形态、字面量与变量名都由它认。 */
export function parseValue(text: string, ctx: CoreContext, depth = 0): ParsedNode {
  const source = text.trim();
  const templated = parseExpression(source, ctx.matchers);
  if (!templated.type.startsWith('UNRESOLVED')) return upgradeCaptured(templated, ctx, depth);
  const core = parseCoreExpression(source, ctx, depth);
  return core ? upgradeCaptured(core, ctx, depth) : templated;
}

/**
 * 模板命中后，槽位里的子表达式还没拆：模板层只认密码块的代码形态，槽位里若是普通算术
 * （`crypto_array_slice(a, i, (len(a) - i))` 的长度就是这样），它会原样留成 UNRESOLVED。
 * 这里拿捕获时留下的原文（`raw`）交回本层补拆，块本身不动——否则「导出再导入」会在
 * 切片这类块上断链（模板层认得出块、认不出块里的算术）。
 */
function upgradeCaptured(value: ParsedNode, ctx: CoreContext, depth: number): ParsedNode {
  if (!value.children.length) return value;
  return {
    ...value,
    children: value.children.map((item) => {
      const current = item.node.type.startsWith('UNRESOLVED') && item.node.raw
        ? parseValue(item.node.raw, ctx, depth + 1)
        : item.node;
      return { input: item.input, node: upgradeCaptured(current, ctx, depth + 1) };
    }),
  };
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

/** 原子：括号、列表、下标/切片、len()、调用（只认本模块 procedure）、变量与数字。 */
function atomNode(source: string, ctx: CoreContext, depth: number): ParsedNode | null {
  const inner = (value: string): ParsedNode => parseValue(value, ctx, depth + 1);

  // 外层括号整段包住：交给内层重新分优先级。
  if (source.startsWith('(') && source.endsWith(')')) {
    const innerText = source.slice(1, -1);
    const wrapped = parseValue(innerText, ctx, depth + 1);
    if (!wrapped.type.startsWith('UNRESOLVED')) return wrapped;
  }

  // 列表字面量 / 推导式：AST 路径用 lists_create_with + itemCount。
  if (source.startsWith('[') && source.endsWith(']')) {
    const body = source.slice(1, -1).trim();
    // 推导式优先：`[f(v) for v in range(3)]` 里也有逗号与方括号，先按 `for` 拆。
    const forTokens = topLevelTokens(body, ['for']);
    if (forTokens.length) return listCompNode(body, forTokens, inner);
    const items = body ? splitTopLevel(body) : [];
    const children: ParsedNode['children'] = [];
    for (let index = 0; index < items.length; index += 1) {
      children.push(child(`ADD${index}`, inner(items[index])));
    }
    return { type: 'lists_create_with', fields: {}, children, extraState: { itemCount: items.length } };
  }

  // 下标 / 切片：`a[i]` 与 `a[i:j]` / `a[i:]` / `a[:]` 分开处理（AST 路径同口径）。
  const subscript = matchBracketTail(source);
  if (subscript) {
    const indexText = subscript.indexText.trim();
    const parts = splitSlice(indexText);
    if (indexText === '' || parts.length > 1) {
      return sliceNode(subscript.base, indexText === '' ? ['', ''] : parts, ctx, inner);
    }
    if (!NUMBER.test(indexText)) return null;
    return node('lists_getIndex', { MODE: 'GET', WHERE: 'FROM_START' }, [
      child('VALUE', inner(subscript.base)),
      child('AT', inner(indexText)),
    ]);
  }

  // `len(x)` → 原生列表长度块（它的 Python 生成就是 `len(...)`，逐字对应 Python 的长度原语）。
  // 与 AST 路径同一判据：本模块真定义了 `len` 时优先当 procedure 调用。
  if (!ctx.procedures.has('len')) {
    const lengthCall = /^len\s*\(([\s\S]*)\)$/.exec(source);
    if (lengthCall && matchParens(source, source.indexOf('('))) {
      const argument = lengthCall[1].trim();
      if (argument) return node('lists_length', {}, [child('VALUE', inner(argument))]);
    }
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
