/**
 * 模板路径 · 文本切分（只有文本，没有块语义）。
 *
 * 三层（表达式 / 容器 / 语句）共用同一套「深度 0、且不在字符串里」的判据：运算符拆分、
 * 生成器分句、切片端点、调用实参全走这里，避免各处各写一份括号计数（曾经写错过一次，
 * 嵌套调用被整段切成 UNRESOLVED）。
 */

export const OPENERS = '([{';
export const CLOSERS = ')]}';

/**
 * 顶层扫描：返回所有「深度 0、且不在字符串里」的 token 位置。
 *
 * token 按长度降序尝试，保证 `<=` 不会被拆成 `<`，`**` 不会被拆成 `*`。
 */
export function topLevelTokens(text: string, tokens: string[]): Array<{ index: number; token: string }> {
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
    // 词形运算符（and/or/not/for/if）必须整词命中：`android` 不是 `and`。
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
export function isBinaryAt(text: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (char === ' ' || char === '\t') continue;
    return /[A-Za-z0-9_)\]}"']/.test(char);
  }
  return false;
}

/** 在给定 token 里挑最后一个可用位置（左结合）；`binaryOnly` 时跳过一元位置。 */
export function lastUseful(
  text: string,
  tokens: string[],
  binaryOnly = true,
): { index: number; token: string } | null {
  const all = topLevelTokens(text, tokens).filter((item) => !binaryOnly || isBinaryAt(text, item.index));
  return all.length ? all[all.length - 1] : null;
}

/** `name(...)` 的右括号是否正好在末尾：避免把 `f(a) + g(b)` 当成一个调用。 */
export function matchParens(source: string, openAt: number): boolean {
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

/** 顶层逗号切分（列表项、调用实参、range 参数）。 */
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
