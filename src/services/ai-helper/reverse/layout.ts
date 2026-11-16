/**
 * 代码 → 工作区：生成文件里的块代码区定位（用户侧 AI Helper · A/B 线 P1.2）
 *
 * 生成文件 = 内嵌实现前缀 + 块代码后缀，这一层负责找后缀起点，再把用户 procedure
 * 与顶层块语句分开。没有 fs / Blockly 依赖。
 */

import { matchStatementSpan } from './parser';
import type { Matcher } from './matchers';

/**
 * 生成文件里块代码永远是**后缀**：definitions（内嵌实现里的 import、模块级常量、class、
 * helper 函数）整块排在块代码之前，其中既有 def 也有顶格 class 与常量（SM9 的塔域类就
 * 顶格写，只认 def 会让 300 多行闭包漏进块语句）。所以找「最早一个能一路切到结尾的起点」，
 * 而不是猜行数：前缀里的 def/class/import 被排除，块代码里认不出的语句留作 UNRESOLVED。
 */
function parsesToEnd(lines: string[], start: number, matchers: Matcher[], names: Set<string>): boolean {
  for (let index = start; index < lines.length; ) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const def = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (def) {
      if (!names.has(def[1])) return false;
      index += 1;
      while (index < lines.length && (lines[index].trim() === '' || /^\s/.test(lines[index]))) index += 1;
      continue;
    }
    if (/^\s/.test(line) || /^(?:class|import|from|@)\b/.test(line)) return false;
    const span = matchStatementSpan(lines, index, matchers);
    index += span ? span.lines : 1;
  }
  return true;
}

export function locateBlockCode(lines: string[], matchers: Matcher[], names: Set<string>): number {
  for (let start = 0; start < lines.length; start += 1) {
    if (parsesToEnd(lines, start, matchers, names)) return start;
  }
  return 0;
}

export interface CodeLayout {
  topLevel: string[];
  bodies: Map<string, string[]>;
  closureDefs: number;
}

/** 在块代码区里再分一次：用户写的 procedure 是块结构，其余顶层行才是块语句。 */
export function splitCode(lines: string[], blockStart: number, names: Set<string>): CodeLayout {
  const topLevel: string[] = [];
  const bodies = new Map<string, string[]>();
  for (let index = blockStart; index < lines.length; ) {
    const def = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[index]);
    if (def && names.has(def[1])) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index].trim() === '' || /^\s/.test(lines[index]))) {
        body.push(lines[index]);
        index += 1;
      }
      bodies.set(def[1], body);
      continue;
    }
    topLevel.push(lines[index]);
    index += 1;
  }
  return { topLevel, bodies, closureDefs: lines.slice(0, blockStart).filter((line) => /^def\s/.test(line)).length };
}
