/**
 * 代码 → 工作区：源码归一化（用户侧 AI Helper · B 线 B1c）
 *
 * 模板匹配的前提是「代码文字与生成器逐字一致」，而用户从 LLM 拿到的代码会在不影响语义
 * 的地方变形：注释、空行、行尾空白。RESULTS §37 的形变实测里，插一行 `# 步骤说明` 让
 * 60/60 全灭（0/60），行尾空格与空行各坏 1 例——都在这一层。
 *
 * 只做**既不改变语义、也不改变字段取值**的清理：
 *   - 剥离 `#` 行注释（字符串内的 `#` 不动，三重引号文档串内的也不动）；
 *   - 去掉每行行尾空白，删掉空行（多行块的边界按行数算，空行会把边界算错）。
 *
 * 引号与进制**不在这里改**：改文本会把字段取值一起改掉，再生成的代码就不等于原文了，
 * 逐块相等判据立刻红。那两项交给 matchers 的宽容比较（数字按值、字符串按内容）。
 */

type QuoteState = { ch: string; triple: boolean };

/** 行尾空白（含制表符）与空行在这里收掉；字符串内部的行尾空白同样收（模板侧一致）。 */
export function normalizePythonSource(text: string): string {
  const lines: string[] = [];
  let current = '';
  let quote: QuoteState | null = null;
  let index = 0;

  const flush = (): void => {
    const trimmed = current.replace(/[ \t]+$/gm, '');
    if (trimmed.trim() !== '') lines.push(trimmed);
    current = '';
  };

  while (index < text.length) {
    const ch = text[index];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (ch === quote.ch) {
        // 三重引号串只有连续三个同样引号才算结尾；单引号串里不可能出现三重引号。
        const triple = text.startsWith(quote.ch.repeat(3), index);
        if (quote.triple && !triple) {
          index += 1;
          continue;
        }
        if (quote.triple) {
          current += quote.ch.repeat(2);
          index += 3;
        } else {
          index += 1;
        }
        quote = null;
        continue;
      }
      index += 1;
      continue;
    }
    if (ch === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = text.startsWith(ch.repeat(3), index);
      quote = { ch, triple };
      if (triple) {
        current += ch.repeat(3);
        index += 3;
      } else {
        current += ch;
        index += 1;
      }
      continue;
    }
    if (ch === '\n') {
      flush();
      index += 1;
      continue;
    }
    current += ch;
    index += 1;
  }
  flush();
  return lines.join('\n');
}
