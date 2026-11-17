/**
 * 代码 → 工作区：生成文件里的块代码区定位（用户侧 AI Helper · A/B 线 P1.2）
 *
 * 生成文件 = 内嵌实现前缀 + 块代码后缀，这一层负责找后缀起点，再把用户 procedure
 * 与顶层块语句分开。没有 fs / Blockly 依赖。
 */

import { matchStatementSpan, splitStatementUnits } from './parser';
import type { StatementUnit } from './parser';
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

/** 生成器给 procedure 题头写的固定第二行；内嵌实现不会带它。 */
const GENERATED_DOCSTRING = 'Crypto function:';

/**
 * 文档串的两种三重引号。生成器写双引号，但用户（尤其 LLM）会写单引号；两种都算题头，
 * 否则「双引号改单引号」这一类形变会让所有 procedure 判不出来（RESULTS §37：4/60）。
 */
const DOC_QUOTES = ['"""', "'''"];

function docOpener(line: string): string | null {
  return DOC_QUOTES.find((quote) => line.startsWith(quote)) ?? null;
}

export interface ProcedureParam {
  name: string;
  /** Python 类型提示（`int` / `list[int]` / `bytes` …）；生成器总会写，缺省时为空。 */
  type: string;
}

export interface ProcedureSignature {
  name: string;
  params: ProcedureParam[];
}

/**
 * 从 `def name(a: int, b: list[int]) -> bytes:` 抓形参名与类型。
 *
 * 类型提示是生成器写的（`generateDefreturnPy` 里 `name + ': ' + pyType`），所以反解析
 * 能拿回类型；但提示是**有损**的：`key`/`seed`/`message` 都写 `bytes`，
 * `poly` 与 `int_list` 都写 `list[int]`。生成代码不读类型，因此这一层按
 * `bytes` / `list[int]` / `int` 回填即可，树级类型标签的还原留给有真值的一侧。
 */
export function parseSignature(line: string): ProcedureSignature | null {
  const match = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:\s*$/.exec(line);
  if (!match) return null;
  const params: ProcedureParam[] = [];
  for (const raw of match[2].split(',')) {
    const piece = raw.trim();
    if (!piece) continue;
    const param = /^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$/.exec(piece);
    if (!param) continue;
    params.push({ name: param[1], type: (param[2] ?? '').trim() });
  }
  return { name: match[1], params };
}

/**
 * 生成文件里的 procedure 与内嵌实现都长成 `def`，区别只有生成器统一写的那段 docstring：
 * 块 procedure 的题头第二行是 `Crypto function: <name>`，内嵌实现没有。用生成器自己的
 * 痕迹判别，比「像不像块」猜得准——这是同一份真值（生成器）导出的第二条对偶信息。
 */
export function isGeneratedProcedure(bodyLines: string[]): boolean {
  const text = bodyLines.map((line) => line.trim()).filter(Boolean);
  return docOpener(text[0] ?? '') !== null && Boolean(text[1]?.startsWith(GENERATED_DOCSTRING));
}

export interface CodeLayout {
  topLevel: string[];
  bodies: Map<string, string[]>;
  signatures: Map<string, ProcedureSignature>;
  closureDefs: number;
}

/** 在块代码区里再分一次：用户写的 procedure 是块结构，其余顶层行才是块语句。 */
export function splitCode(lines: string[], blockStart: number, names: Set<string>): CodeLayout {
  const topLevel: string[] = [];
  const bodies = new Map<string, string[]>();
  const signatures = new Map<string, ProcedureSignature>();
  for (let index = blockStart; index < lines.length; ) {
    const def = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[index]);
    if (def && names.has(def[1])) {
      const body: string[] = [];
      const signature = parseSignature(lines[index]);
      if (signature) signatures.set(signature.name, signature);
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
  return {
    topLevel,
    bodies,
    signatures,
    closureDefs: lines.slice(0, blockStart).filter((line) => /^def\s/.test(line)).length,
  };
}

/**
 * procedure 体 → 语句单元 + return 表达式。
 *
 * 生成器的题头是「两行 docstring + 4 空格缩进体 + `return X`」，所以这里先按最小缩进
 * 去缩进、剔掉 docstring，再切语句；最后一条 `return` 是 defreturn 的 RETURN 槽，
 * 不是体内语句（留在体内会生成 `return` 语句块，语义重复）。
 */
/**
 * 函数体 → 去缩进、剔掉文档串的行。
 *
 * 两处都要用：老的 `procedureUnits`（脚本侧按语句单元比对）与新的核心语法层（按缩进递归
 * 解析 if/while/for）。抽出来只为准绳唯一——缩进与文档串的判法改一次就两边同时生效。
 */
export function prepareProcedureBody(bodyLines: string[]): string[] {
  const indents = bodyLines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const lines: string[] = [];
  let docEnd: string | null = null;
  for (const raw of bodyLines) {
    const line = raw.slice(indent);
    const trimmed = line.trim();
    if (docEnd === null) {
      const opener = docOpener(trimmed);
      if (opener) {
        // 单行文档串（`"""说明"""`）整行跳过，否则会一直吃到闭合那行、把函数体也吞掉。
        if (!(trimmed.endsWith(opener) && trimmed.length > opener.length)) docEnd = opener;
        continue;
      }
    } else {
      if (trimmed.endsWith(docEnd)) docEnd = null;
      continue;
    }
    lines.push(line);
  }
  return lines;
}

export function procedureUnits(
  bodyLines: string[],
  matchers: Matcher[],
): { units: StatementUnit[]; returnExpr: string | null } {
  const lines = prepareProcedureBody(bodyLines);
  const units = splitStatementUnits(lines.join('\n'), matchers);
  const last = units[units.length - 1];
  const returnMatch = last ? /^return\s+([\s\S]+)$/.exec(last.text) : null;
  if (returnMatch) units.pop();
  return { units, returnExpr: returnMatch ? returnMatch[1] : null };
}

export interface TopLevelDef {
  signature: ProcedureSignature;
  body: string[];
  /** 顶格 `def` 所在行号（0 基），诊断用。 */
  start: number;
}

/**
 * 扫出文件里所有**顶格** `def` 及其体。生成文件里 procedure 与内嵌实现都是顶格 def，
 * 所以「哪个是 procedure」只能由调用方拿 `isGeneratedProcedure` 之类判据再筛。
 */
export function scanTopLevelDefs(lines: string[]): TopLevelDef[] {
  const defs: TopLevelDef[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s/.test(lines[index])) continue;
    const signature = parseSignature(lines[index]);
    if (!signature) continue;
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor].trim() === '' || /^\s/.test(lines[cursor]))) {
      body.push(lines[cursor]);
      cursor += 1;
    }
    defs.push({ signature, body, start: index });
    index = cursor - 1;
  }
  return defs;
}
