/**
 * 代码 → 工作区：宽容字面量比较（用户侧 AI Helper · B 线 B1c）
 *
 * 模板是生成器逐字吐出来的，用户手上（尤其从 LLM 拿到的）代码却会在不改变语义的地方
 * 变形：`0x1F` 写成 `31`、双引号写成单引号、`rate_bytes=168` 写成 `rate_bytes = 168`。
 * RESULTS §37 的实测里这三项分别让 26/60、4/60、57/60 的 demo 反解析失败。
 *
 * 这里**不改文本**，只改比较方式：抓到什么就回填什么，字段取值仍是源码原文，所以
 * 「反解析再生成」依旧可能逐字等于原文（改文本会把取值一起改掉，往返判据立刻红）。
 *
 * 三条宽容规则都是有边界的：
 *   - 数字按**值**比较，写法各自保留；
 *   - 字符串按**内容**比较，引号种类与引号转义不计；
 *   - 空格/制表符可省，但两个标识符之间的空白不能省（否则 `a b` 与 `ab` 等价）。
 */

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)(?:\.\d+)?/;

const isWord = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isBlank = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * 整数字面量按值归一成十进制字符串；浮点按 Number。
 *
 * 用 BigInt 而不是 parseInt：SM2 的曲线参数是 256 位十六进制（`0xFFFFFFFE...FFFC`），
 * parseInt 落到 double 会丢精度，两个不同的大整数可能被判成相等。
 */
function numberKey(raw: string): string | null {
  if (raw.includes('.')) return `f:${Number(raw)}`;
  try {
    return `i:${BigInt(raw).toString()}`;
  } catch {
    return null;
  }
}

/** 读一个字符串字面量（含三重引号），返回内容与结束位置；内容里的引号转义已还原。 */
export function readStringLiteral(text: string, start: number): { body: string; end: number } | null {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return null;
  const triple = text.startsWith(quote.repeat(3), start);
  const closer = triple ? quote.repeat(3) : quote;
  let index = start + closer.length;
  let body = '';
  while (index < text.length) {
    if (text.startsWith(closer, index)) return { body, end: index + closer.length };
    const ch = text[index];
    if (ch === '\\') {
      const next = text[index + 1] ?? '';
      // 引号类转义按内容比较：`\'` 与 `'` 是同一个字符；其余转义（\n、\x1f）原样保留，
      // 两边写法不同就判不等，避免把真不同的字符串认成同一个。
      if (next === '\\' || next === '"' || next === "'") {
        body += next;
        index += 2;
        continue;
      }
      body += ch + next;
      index += 2;
      continue;
    }
    body += ch;
    index += 1;
  }
  return null;
}

/**
 * 模板字面量 `literal` 能否在 `source[pos]` 处（按上述宽容规则）匹配上；返回 source 的新位置。
 * 返回 -1 表示不匹配。
 */
export function matchLiteralAt(source: string, pos: number, literal: string): number {
  // 快路径：逐字相同是绝大多数情况（生成器原文与 demo 往返都走这里）。
  if (source.startsWith(literal, pos)) return pos + literal.length;

  let s = pos;
  let t = 0;
  while (t < literal.length) {
    const tc = literal[t];
    if (isBlank(tc)) {
      const runStart = t;
      while (t < literal.length && isBlank(literal[t])) t += 1;
      const before = runStart === 0 ? '' : literal[runStart - 1];
      const after = t < literal.length ? literal[t] : '';
      const start = s;
      while (s < source.length && isBlank(source[s])) s += 1;
      // 模板里两个标识符之间的空白不能省：`from x import y` 不是 `fromximporty`。
      if (isWord(before) && isWord(after) && s === start) return -1;
      continue;
    }
    if (s >= source.length) return -1;
    if (source[s] === tc) {
      s += 1;
      t += 1;
      continue;
    }
    if ((tc === '"' || tc === "'") && (source[s] === '"' || source[s] === "'")) {
      const left = readStringLiteral(source, s);
      const right = readStringLiteral(literal, t);
      if (left && right && left.body === right.body) {
        s = left.end;
        t = right.end;
        continue;
      }
      return -1;
    }
    if (isDigit(tc) && isDigit(source[s])) {
      const left = NUMBER_RE.exec(source.slice(s));
      const right = NUMBER_RE.exec(literal.slice(t));
      const leftKey = left ? numberKey(left[0]) : null;
      const rightKey = right ? numberKey(right[0]) : null;
      if (left && right && leftKey !== null && leftKey === rightKey) {
        s += left[0].length;
        t += right[0].length;
        continue;
      }
      return -1;
    }
    // 源码多出的空白：只在标点旁边允许（`rate_bytes = 168` ↔ `rate_bytes=168`）。
    if (isBlank(source[s])) {
      const before = t === 0 ? '' : literal[t - 1];
      if (isWord(before) && isWord(tc)) return -1;
      s += 1;
      continue;
    }
    return -1;
  }
  return s;
}
