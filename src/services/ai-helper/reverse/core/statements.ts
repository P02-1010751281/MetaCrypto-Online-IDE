/**
 * 核心语法层 · 语句：按缩进切 if/elif/else、while、for-range 与普通语句。
 *
 * 复合语句的体递归解析；体里一条都认不出时整条复合语句不产出（与 AST 路径一致）。
 */

import { matchStatementSpan } from '../parser';
import type { ParsedNode } from '../parser';
import { RANGE_ARITY, RANGE_STEP } from '../diagnostics';
import { blocked, child, node, unresolved } from './nodes';
import { matchParens, splitTopLevel } from './text';
import { parseStatementValue, parseValue } from './expressions';
import { desugarAssignment } from './comprehension';
import type { CoreContext, ParsedStatement } from './types';

// ---------------------------------------------------------------------------
// 语句层：按缩进切块（if/elif/else、while、for-range、break/continue/pass、return）
// ---------------------------------------------------------------------------

interface BlockBody {
  lines: string[];
  next: number;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** 从 `start` 起收集一段更深缩进的块，并按它自己的缩进去缩进（递归层只看相对缩进）。 */
function collectIndented(lines: string[], start: number, baseIndent: number): BlockBody {
  const collected: string[] = [];
  let index = start;
  let bodyIndent = Number.POSITIVE_INFINITY;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= baseIndent) break;
    bodyIndent = Math.min(bodyIndent, indent);
    collected.push(line);
    index += 1;
  }
  const dedented = collected.map((line) => (line.trim() === '' ? '' : line.slice(bodyIndent)));
  return { lines: dedented, next: index };
}

/** 语句串 → 链节点：语句之间用 next 连接（与 AST 路径的 `next` 链同形）。 */
function chainNode(statements: ParsedStatement[]): ParsedNode | null {
  if (!statements.length) return null;
  return {
    type: 'chain',
    fields: {},
    children: statements.map((statement, index) => ({
      input: `STATEMENT${index}`,
      node: { ...statement.node, text: statement.text },
    })),
  };
}

function resolvable(statements: ParsedStatement[]): boolean {
  return statements.some((statement) => !statement.node.type.startsWith('UNRESOLVED'));
}

/**
 * 函数体 / 顶层 → 语句单元。
 *
 * 复合语句（if/while/for）的体递归解析；体里一条都认不出时**整条复合语句不产出**（与 AST
 * 路径「体为空则整块不出」一致，否则工作区里会留下一个没有 DO 输入的空壳块）。
 */
export function parsePythonBody(
  lines: string[],
  ctx: CoreContext,
  options: { trailingReturn?: boolean; params?: string[]; seen?: Set<string> } = {},
): { statements: ParsedStatement[]; returnExpr: string | null } {
  const statements: ParsedStatement[] = [];
  // 同作用域已出现过的名字：推导式展开时循环变量与它们重名要改名（Python 3 推导式有独立
  // 作用域，展开会把循环变量泄漏到外层）。嵌套体共用同一个集合——Python 没有块级作用域。
  const seen = options.seen ?? new Set(options.params ?? []);
  let returnExpr: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (indentOf(line) > 0) {
      // 不该发生：调用方已按块去缩进；真遇到就按未识别处理，不猜它属于上一句。
      index += 1;
      continue;
    }
    const text = line.trimEnd();

    // 1. 文档串：函数体首行的字符串没有语义，跳过（AST 路径同样忽略）。
    const trimmed = text.trim();
    const opener = ['"""', "'''"].find((quote) => trimmed.startsWith(quote));
    if (opener) {
      if (trimmed.endsWith(opener) && trimmed.length > 6) {
        index += 1;
        continue;
      }
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith(opener)) index += 1;
      index += 1;
      continue;
    }

    // 2. if / elif / else。
    const ifMatch = /^if\s+([\s\S]+):\s*$/.exec(text);
    if (ifMatch) {
      const branches: Array<{ test: string; statements: ParsedStatement[] }> = [];
      const first = collectIndented(lines, index + 1, 0);
      branches.push({ test: ifMatch[1], statements: parsePythonBody(first.lines, ctx, { seen }).statements });
      let cursor = first.next;
      let hasElse = false;
      let elseBody: ParsedStatement[] = [];
      while (cursor < lines.length) {
        const next = lines[cursor].trimEnd();
        const elif = /^elif\s+([\s\S]+):\s*$/.exec(next);
        if (elif) {
          const body = collectIndented(lines, cursor + 1, 0);
          branches.push({ test: elif[1], statements: parsePythonBody(body.lines, ctx, { seen }).statements });
          cursor = body.next;
          continue;
        }
        if (/^else\s*:\s*$/.test(next)) {
          const body = collectIndented(lines, cursor + 1, 0);
          hasElse = true;
          elseBody = parsePythonBody(body.lines, ctx, { seen }).statements;
          cursor = body.next;
        }
        break;
      }
      const children: ParsedNode['children'] = [];
      let valid = true;
      branches.forEach((branch, branchIndex) => {
        const body = chainNode(branch.statements);
        if (!body || !resolvable(branch.statements)) valid = false;
        children.push(child(`IF${branchIndex}`, parseValue(branch.test, ctx)));
        if (body) children.push(child(`DO${branchIndex}`, body));
      });
      const otherwise = hasElse ? chainNode(elseBody) : null;
      if (hasElse && (!otherwise || !resolvable(elseBody))) valid = false;
      if (otherwise) children.push(child('ELSE', otherwise));
      statements.push({
        text: text,
        node: valid
          ? {
            type: 'controls_if',
            fields: {},
            extraState: { elseIfCount: branches.length - 1, hasElse },
            children,
          }
          : unresolved(),
      });
      index = cursor;
      continue;
    }

    // 3. while。
    const whileMatch = /^while\s+([\s\S]+):\s*$/.exec(text);
    if (whileMatch) {
      const body = collectIndented(lines, index + 1, 0);
      const parsed = parsePythonBody(body.lines, ctx, { seen }).statements;
      const chain = chainNode(parsed);
      statements.push({
        text,
        node: chain && resolvable(parsed)
          ? node('controls_whileUntil', { MODE: 'WHILE' }, [child('BOOL', parseValue(whileMatch[1], ctx)), child('DO', chain)])
          : unresolved(),
      });
      index = body.next;
      continue;
    }

    // 4. for ... in ...：`range(...)` 按参数个数落 ctrl_iterate / ctrl_range；其余迭代器
    //    落原生 controls_forEach（与 AST 路径同一套判据）。
    const forMatch = /^for\s+([A-Za-z_]\w*)\s+in\s+([\s\S]+?)\s*:\s*$/.exec(text);
    if (forMatch) {
      const body = collectIndented(lines, index + 1, 0);
      const parsed = parsePythonBody(body.lines, ctx, { seen }).statements;
      const chain = chainNode(parsed);
      const iterable = forMatch[2].trim();
      const rangeCall = /^range\s*\(([\s\S]*)\)$/.exec(iterable);
      const built = rangeCall && matchParens(iterable, iterable.indexOf('('))
        ? buildForNode(forMatch[1], splitTopLevel(rangeCall[1]), chain, parsed, ctx)
        : buildForEachNode(forMatch[1], iterable, chain, parsed, ctx);
      statements.push({ text, node: built ?? unresolved() });
      seen.add(forMatch[1]);
      index = body.next;
      continue;
    }

    // 5. 多行密码块（生成器把闭包内嵌成几十行）整段吃下，交给模板层。
    //
    // 放在复合语句之后是有原因的：`ctrl_iterate` 的模板是 `for i in range(32):` + 体，
    // 与结构化解析走的是同一条 `for` 头；先让模板层匹配会把同一段代码读成模板块，
    // 而结构化解析产出的 `ctrl_iterate`/`ctrl_range` 才是与 AST 路径同形的结果（§41.3）。
    const span = matchStatementSpan(lines, index, ctx.matchers);
    if (span) {
      statements.push({ text: span.text, node: parseStatementValue(span.text, ctx) });
      index += span.lines;
      continue;
    }

    // 6. break / continue / pass。
    if (/^break\s*$/.test(text)) {
      statements.push({ text, node: node('controls_flow_statements', { FLOW: 'BREAK' }) });
      index += 1;
      continue;
    }
    if (/^continue\s*$/.test(text)) {
      statements.push({ text, node: node('controls_flow_statements', { FLOW: 'CONTINUE' }) });
      index += 1;
      continue;
    }
    if (/^pass\s*$/.test(text)) {
      index += 1;
      continue;
    }

    // 7. return：只有函数体末尾那一条属于 RETURN 槽，嵌套/多处一律报出来（与 AST 同口径）。
    const returnMatch = /^return(?:\s+([\s\S]+))?$/.exec(text);
    if (returnMatch) {
      const remaining = lines.slice(index + 1).filter((item) => item.trim() !== '');
      if (options.trailingReturn && remaining.length === 0) {
        returnExpr = returnMatch[1] ?? '';
      } else {
        statements.push({ text, node: { type: 'UNRESOLVED_RETURN', fields: {}, children: [] } });
      }
      index += 1;
      continue;
    }

    // 8. 赋值：`name = expr`（`==` 不匹配）。右侧是推导式且需要动态展开时，一条赋值语句
    //    变成「空列表 + 循环 + append」三条语句（链节点），其余情况仍是 variables_set。
    const assignment = /^([A-Za-z_]\w*)\s*=\s*([^=][\s\S]*)$/.exec(text);
    if (assignment) {
      const desugared = desugarAssignment(
        assignment[1],
        assignment[2],
        (value) => parseValue(value, ctx),
        seen,
      );
      statements.push({
        text,
        node: desugared ?? node('variables_set', { VAR: assignment[1] }, [child('VALUE', parseValue(assignment[2], ctx))]),
      });
      seen.add(assignment[1]);
      index += 1;
      continue;
    }

    // 9. 其余交给模板层；认不出就留 UNRESOLVED（诊断由序列化层记录）。
    statements.push({ text, node: parseStatementValue(text, ctx) });
    index += 1;
  }

  return { statements, returnExpr };
}

/**
 * `for` 的装配。
 *
 * - 一参数 `range(expr)` → `ctrl_iterate`（Python「执行 expr 次」，n ≤ 0 时一次也不执行）；
 * - 两参数 / 三参数且步长为 1 → `ctrl_range`（TO 是**独占**终点，与 Python 的 `range(a, b)`
 *   逐字对应，常量空区间也精确）；
 * - 步长不是 1 → `RANGE_STEP`；参数个数越界 → `RANGE_ARITY`。
 */
function buildForNode(
  variable: string,
  args: string[],
  chain: ParsedNode | null,
  parsed: ParsedStatement[],
  ctx: CoreContext,
): ParsedNode | null {
  if (!chain || !resolvable(parsed)) return null;
  if (args.length < 1 || args.length > 3) {
    return blocked(RANGE_ARITY);
  }
  if (args.length === 1) {
    const times = parseValue(args[0], ctx);
    if (times.type.startsWith('UNRESOLVED')) return null;
    return {
      type: 'ctrl_iterate',
      fields: { VAR: variable },
      children: [child('TIMES', times), child('DO', chain)],
    };
  }
  if (args.length === 3 && args[2].trim() !== '1') return blocked(RANGE_STEP);
  return {
    type: 'ctrl_range',
    fields: { VAR: variable },
    children: [child('FROM', parseValue(args[0], ctx)), child('TO', parseValue(args[1], ctx)), child('DO', chain)],
  };
}

/** 非 range 迭代器：`for x in xs:` → 原生 `controls_forEach`（前提是那条表达式能反解析）。 */
function buildForEachNode(
  variable: string,
  iterable: string,
  chain: ParsedNode | null,
  parsed: ParsedStatement[],
  ctx: CoreContext,
): ParsedNode | null {
  if (!chain || !resolvable(parsed)) return null;
  const list = parseValue(iterable, ctx);
  if (list.type.startsWith('UNRESOLVED')) return null;
  return {
    type: 'controls_forEach',
    fields: { VAR: variable },
    children: [child('LIST', list), child('DO', chain)],
  };
}
