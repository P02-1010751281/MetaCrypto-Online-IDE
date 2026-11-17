/**
 * 代码 → 工作区：表达式与语句解析（用户侧 AI Helper · A/B 线 P1.2）
 *
 * 拿 matchers.ts 排好的匹配器把一段代码认成 ParsedNode：字面量/标识符先认原子，
 * 再按模板匹配，最后按行与多行块模板切语句单元。没有 fs / Blockly 依赖。
 */

import { CLOSERS, OPENERS, matchSegments } from './matchers';
import type { Matcher } from './matchers';

export interface ParsedNode {
  type: string;
  fields: Record<string, string>;
  children: Array<{ input: string; node: ParsedNode }>;
  /**
   * 块自带的序列化附加状态（`controls_if` 的 elseIfCount/hasElse、`lists_create_with` 的
   * itemCount、调用块的 name/params）。核心语法层要按 AST 路径的同一套格式产出，序列化层
   * 原样带进工作区状态。
   */
  extraState?: Record<string, unknown>;
  /** 这一段的原文：诊断要指回用户看到的那一行（复合语句尤其需要）。 */
  text?: string;
}

const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;
const NUMBER_LITERAL = '(?:0[xX][0-9a-fA-F]+|-?\\d+(?:\\.\\d+)?)';
/**
 * 字面量只认「真的没有结构」的形态。这里曾经写成 `\[[\s\S]*\]`，把任何中括号包起来的
 * 表达式都当成 data_value 列表字面量，`[a[0] ^ b[0]]`（gf2m_add 的块代码）因此直接被
 * 当字面量吞掉，模板匹配永远轮不到它。列表只允许「里面全是数字/字符串字面量」。
 */
const LITERAL_RE = new RegExp(
  `^(?:${NUMBER_LITERAL}|\\[\\s*(?:${NUMBER_LITERAL}\\s*,\\s*)*${NUMBER_LITERAL}?\\s*\\]|"[^"]*"|'[^']*'|True|False|None)$`,
);

/**
 * Python 的 `(expr)` 与原表达式同义。生成器在优先级需要时会替子块补一层括号
 * （GOPPA_SYN 里的 `(crypto_array_slice(...))` 就是这么来的），解析前必须剥掉，
 * 否则整段子表达式认不出块。
 */
function stripOuterParens(text: string): string {
  let source = text.replace(/\s+$/, '');
  for (;;) {
    const trimmed = source.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return source;
    let depth = 0;
    let quote = '';
    let wraps = true;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (OPENERS.includes(char)) depth += 1;
      else if (CLOSERS.includes(char)) {
        depth -= 1;
        // 第一层括号在中途就闭合，说明外面这层不包住整个表达式（如 `(a) + (b)`）。
        if (depth === 0 && index !== trimmed.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps || depth !== 0) return source;
    source = trimmed.slice(1, -1);
  }
}

export function parseExpression(text: string, matchers: Matcher[], depth = 0): ParsedNode {
  if (depth > 32) return { type: 'UNRESOLVED_DEPTH', fields: {}, children: [] };
  // 前后空白一起收：模板槽位捕获的是「逗号后面那段原文」，常带一个前导空格；只收尾部会让
  // ` 192` 这种字面量匹配不上（以前是靠 data_value 的通配槽兜住的，见 RESULTS §41）。
  const source = text.trim();
  // 先按原样匹配：有的块模板自己就带外层括号（pq_rej_sample 的 `((x) if ...)`），
  // 剥掉括号反而认不出。原样匹不上再试去括号的形态（生成器给子块补的括号）。
  const direct = atomNode(source, matchers, depth);
  if (direct) return direct;
  const stripped = stripOuterParens(source);
  const inner = stripped === source ? null : atomNode(stripped, matchers, depth);
  if (inner) return inner;
  return { type: 'UNRESOLVED', fields: {}, children: [] };
}

function atomNode(source: string, matchers: Matcher[], depth: number): ParsedNode | null {
  // 顺序重要：None/True/False 也满足标识符正则，必须先判字面量。
  if (LITERAL_RE.test(source)) return { type: 'data_value', fields: { NUM: source }, children: [] };
  if (IDENTIFIER_RE.test(source)) return { type: 'variables_get', fields: { VAR: source }, children: [] };
  return matchNode(source, matchers, depth, false) ?? matchNode(source, matchers, depth, true);
}

function matchNode(source: string, matchers: Matcher[], depth: number, relaxed: boolean): ParsedNode | null {
  for (const matcher of matchers) {
    if (matcher.relaxed !== relaxed) continue;
    const captures = matchSegments(source, matcher.segments);
    if (!captures) continue;
    const fields: Record<string, string> = { ...(matcher.fields ?? {}) };
    const children: Array<{ input: string; node: ParsedNode }> = [];
    const seen = new Map<string, string>();
    let captureIndex = 0;
    for (const segment of matcher.segments) {
      if (segment.kind === 'literal') continue;
      const captured = captures[captureIndex] ?? '';
      captureIndex += 1;
      if (segment.kind === 'field') {
        if (fields[segment.name] === undefined) fields[segment.name] = captured;
        continue;
      }
      // 生成器会在同一份代码里多次取同一个输入（ecc_load_point 的 point 出现两次），
      // 树里却只有一个输入槽：同名的同一段代码只算一个子块。
      const previous = seen.get(segment.input);
      if (previous !== undefined && previous === captured) continue;
      seen.set(segment.input, captured);
      children.push({ input: segment.input, node: parseExpression(captured, matchers, depth + 1) });
    }
    return { type: matcher.type, fields, children };
  }
  return null;
}

/** 语句：先试块模板（含赋值型块），再退回 `X = Y`（variables_set），最后当表达式。 */
export function parseStatement(text: string, matchers: Matcher[]): ParsedNode {
  const source = text.trim();
  if (!source.trim()) return { type: 'EMPTY', fields: {}, children: [] };
  // 赋值型块的模板里也含 `=`，必须由模板先行命中，不能被下面的通用赋值抢走。
  const templated = parseExpression(source, matchers);
  if (templated.type !== 'UNRESOLVED') return templated;
  const assignment = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(source);
  if (assignment) {
    return {
      type: 'variables_set',
      fields: { VAR: assignment[1] },
      children: [{ input: 'VALUE', node: parseExpression(assignment[2], matchers) }],
    };
  }
  return templated;
}

export interface StatementUnit {
  text: string;
  lines: number;
}

/**
 * 一个块可能一次吐出多行代码（生成器把整套闭包实现内嵌在个别块里，ecc_multiply 一次 50 行），
 * 所以语句边界不能按行切：模板就是块的确切代码，能整段对上的最长行数就是块的边界。
 * 单行块不在这里试，交给 parseStatement（模板匹配只做一次）。
 */
export function matchStatementSpan(lines: string[], start: number, matchers: Matcher[]): StatementUnit | null {
  const spans = new Set<number>();
  for (const matcher of matchers) if (matcher.lineSpan > 1) spans.add(matcher.lineSpan);
  const available = lines.length - start;
  const candidates = [...spans].filter((span) => span <= available).sort((a, b) => b - a);
  for (const span of candidates) {
    const text = lines.slice(start, start + span).join('\n');
    for (const relaxed of [false, true]) {
      for (const matcher of matchers) {
        if (matcher.relaxed !== relaxed || matcher.lineSpan !== span) continue;
        if (matchSegments(text, matcher.segments)) return { text, lines: span };
      }
    }
  }
  return null;
}

/** 把一段（已去缩进）代码切成语句单元：多行块整段吃下，其余按行。 */
export function splitStatementUnits(text: string, matchers: Matcher[]): StatementUnit[] {
  const lines = text.split('\n');
  const units: StatementUnit[] = [];
  for (let index = 0; index < lines.length; ) {
    const span = matchStatementSpan(lines, index, matchers);
    if (span) {
      units.push(span);
      index += span.lines;
      continue;
    }
    if (lines[index].trim() === '') {
      index += 1;
      continue;
    }
    units.push({ text: lines[index], lines: 1 });
    index += 1;
  }
  return units;
}
