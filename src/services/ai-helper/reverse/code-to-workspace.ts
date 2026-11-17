/**
 * 代码 → 工作区：一条龙入口（用户侧 AI Helper · B 线 B1b）
 *
 * 把浏览器里拿到的源码（当前只到「本平台生成的 Python 形态」）走完全程：
 * 定位块代码区 → 切 procedure 与顶层语句 → 模板匹配 → 序列化成工作区状态。
 * 没有 fs / Blockly 依赖：调用方拿到 `state` 自己 `workspaces.load`。
 *
 * 与脚本侧 `scripts/ai-helper-roundtrip.ts` 的分工：脚本知道真值（demo 里的过程名），
 * 浏览器不知道，只能靠生成器留下的痕迹判别 procedure——见 `isGeneratedProcedure`。
 */

import { detectInputLanguage } from './language';
import type { ReverseInputLanguage } from './language';
import { reverseForeignCode } from './ast';
import type { AstReverseStats, PyAstRunner } from './ast';
import { parsePythonBody, parseValue } from './core-syntax';
import type { CoreContext } from './core-syntax';
import {
  isGeneratedProcedure,
  locateBlockCode,
  prepareProcedureBody,
  scanTopLevelDefs,
  splitCode,
} from './layout';
import type { Matcher } from './matchers';
import { buildMatchers } from './matchers';
import { normalizePythonSource } from './normalize';
import type { FieldPayload } from './matchers';
import { buildPrimitiveIndex } from './primitive-calls';
import { toWorkspaceState } from './serialize';
import type { ProcedureNode, SerializedWorkspace, StatementNode } from './serialize';

export interface ReverseCodeOptions {
  /**
   * 显式指定哪些顶格 `def` 是块 procedure。不给就按生成器 docstring 痕迹自动判别；
   * 用户粘贴的是非生成器代码时，这个开关是唯一的兜底入口。
   */
  procedureNames?: Set<string>;
  /**
   * 强制输入语言。不给就按 `detectInputLanguage` 判别；目前只有 Python 一条反解析
   * 路径，判成 JavaScript 时直接返回「形态不支持」，不做逐行匹配。
   */
  language?: ReverseInputLanguage;
  /**
   * 生成器内嵌闭包名单（`closure-names.json`）。不给就用载荷里的那份；两份都没有时
   * 退回「只认生成器题头」，与 B1b 的行为一致。
   */
  closures?: string[];
  /**
   * 外部代码走 AST 路径时用的宿主（浏览器里是 Pyodide worker）。不给就只跑模板路径：
   * 服务层不 import 浏览器 runtime，单测与脚本可以注入本机 python3。
   */
  astRunner?: PyAstRunner;
}

export interface ReverseCodeResult {
  state: SerializedWorkspace;
  matchers: Matcher[];
  /** 实际走（或被判别为）哪条路径；面板据此区分「形态不支持」与「语句认不出」。 */
  language: ReverseInputLanguage;
  /** 这次结果由哪条路径产出：模板匹配、AST，或两条都没走通（外来代码未支持）。 */
  path?: 'template' | 'ast' | 'unsupported';
  /** AST 路径的规模统计（只在 path === 'ast' 时有意义）。 */
  astStats?: AstReverseStats;
  /** AST 路径失败的原因（语法错误、宿主演进失败等），面板照原样显示。 */
  astError?: string;
  stats: {
    /** 块代码区起始行（0 基）；之前是生成器内嵌实现。 */
    blockStart: number;
    closureDefs: number;
    procedures: number;
    topLevel: number;
    diagnostics: number;
    /** 只在判成外来代码时给：识别到的函数名，供面板说明「这些没被支持」。 */
    foreignDefs?: string[];
  };
}

/** 生成器给「已声明未赋值」的变量补的前导行，不是块结构。 */
const NONE_DECLARATION = /^[A-Za-z_]\w*\s*=\s*None\s*$/;

export function reverseCode(
  code: string,
  payload: FieldPayload,
  options: ReverseCodeOptions = {},
): ReverseCodeResult {
  const language = options.language ?? detectInputLanguage(code);
  // 形态不支持时**不要**硬跑 Python 匹配：JS 的 `function` / `}` / 分号会让定位层把大半
  // 内容当生成器前缀剥掉，最后只剩一条 `}` 诊断，用户看不出真正原因（RESULTS §34）。
  // 这里明确短路：零块、一条 `unsupported` 诊断，由调用方换成可读的说明。
  if (language === 'javascript') {
    return {
      state: {
        blocks: { languageVersion: 0, blocks: [] },
        variables: [],
        diagnostics: [{ text: '', reason: 'unsupported' }],
      },
      matchers: [],
      language,
      stats: { blockStart: 0, closureDefs: 0, procedures: 0, topLevel: 0, diagnostics: 1 },
    };
  }

  const matchers = buildMatchers(payload);
  // 归一化先于一切：注释、空行、行尾空白必须在切语句之前收掉，否则多行块的边界会算错
  // （RESULTS §37：插一行注释 = 0/60，空行与行尾空白各坏 1 例）。
  const lines = normalizePythonSource(code)
    .split('\n')
    .filter((line) => !NONE_DECLARATION.test(line));

  const defs = scanTopLevelDefs(lines);
  /**
   * procedure 判别的三个来源，按可信度排序：
   *   1. 调用方显式给的名单（界面确认，最高优先级）；
   *   2. 生成器题头 docstring —— 本平台生成代码自带的痕迹；
   *   3. 闭包名单反选：名单里是内嵌实现，名单外的顶格 def 才算 procedure。
   * 第 3 条是 §38 实测出来的确定性判据（60/60），不是启发式阈值。
   */
  const traced = defs.filter((def) => isGeneratedProcedure(def.body)).map((def) => def.signature.name);
  const closures = new Set(options.closures ?? payload.closures ?? []);
  const names = options.procedureNames ?? (traced.length
    ? new Set(traced)
    : new Set(
      closures.size
        ? defs.filter((def) => !closures.has(def.signature.name)).map((def) => def.signature.name)
        : [],
    ));

  const blockStart = locateBlockCode(lines, matchers, names);
  const layout = splitCode(lines, blockStart, names);

  /**
   * 语句层用核心语法层（`core-syntax.ts`）：模板层只认密码块的代码字体，控制流与算术
   * 要靠它按缩进/运算符拆。两条层共用一个 procedure 名单——调用块只认本模块定义的函数。
   */
  const core: CoreContext = {
    matchers,
    procedures: new Map(
      [...layout.signatures].map(([name, signature]) => [name, signature.params.map((param) => param.name)]),
    ),
    diagnostics: [],
  };

  const topLevel: StatementNode[] = parsePythonBody(layout.topLevel, core).statements;

  const procedures: ProcedureNode[] = [];
  for (const [name, body] of layout.bodies) {
    const signature = layout.signatures.get(name);
    if (!signature) continue;
    const parsed = parsePythonBody(prepareProcedureBody(body), core, { trailingReturn: true });
    const returnNode = parsed.returnExpr
      ? { text: parsed.returnExpr, node: parseValue(parsed.returnExpr, core) }
      : null;
    procedures.push({ signature, body: parsed.statements, returnNode });
  }

  const state = toWorkspaceState(topLevel, { procedures });
  // 核心语法层的漂移诊断（按位 uint32、range 空区间）排在前面：它们是「块出来了但语义变了」，
  // 比逐条「未识别」更需要用户先看到。
  if (core.diagnostics?.length) {
    state.diagnostics.unshift(
      ...core.diagnostics.map((diag) => ({
        text: diag.text,
        detail: diag.detail,
        reason: diag.reason,
      })),
    );
  }

  /**
   * 外来代码：没有任何生成器题头痕迹、却有函数且留下未识别语句。LLM 写的 Python 里
   * for/切片/推导式全都不在模板里，逐条列「未识别」只是噪音；更糟的是 `out = []` 这类行
   * 会零星匹配成块，产出「看着像成功」的半成品工作区。按 §38 的结论明确拒绝。
   *
   * 判据里刻意不要求「零块」：零块是外来代码的常见结果，但不是唯一结果——碎块照样要拒。
   */
  // 只数「结构没搭出来」的诊断：`semantic-drift` 是块已经出来了、只是语义与原文不同，
  // 把它也算成外来代码会把「读完了但有一处按位运算」误判成整份文件不支持。
  const structural = state.diagnostics.filter(
    (diag) => diag.reason === 'unresolved' || diag.reason === 'unsupported',
  ).length;
  if (traced.length === 0 && defs.length > 0 && structural > 0) {
    return {
      state: {
        blocks: { languageVersion: 0, blocks: [] },
        variables: [],
        diagnostics: [{ text: '', reason: 'foreign-code' }],
      },
      matchers,
      language,
      stats: {
        blockStart,
        closureDefs: layout.closureDefs,
        procedures: 0,
        topLevel: 0,
        diagnostics: 1,
        foreignDefs: defs.map((def) => def.signature.name),
      },
    };
  }

  return {
    state,
    matchers,
    language,
    stats: {
      blockStart,
      closureDefs: layout.closureDefs,
      procedures: procedures.length,
      topLevel: topLevel.length,
      diagnostics: state.diagnostics.length,
    },
  };
}

/**
 * 先模板、后 AST 的两段式入口（面板调它，不直接调 `reverseCode`）。
 *
 * 为什么不是「一律走 AST」：模板路径能回填字段取值与模板变体（§36 的组合探测就是为它
 * 打的补丁），往返 60/60 靠的是它；AST 只在模板明确判成外来代码时才接管，两条路各管
 * 各的输入形态，避免把已经能还原的字段值换成结构推断。
 *
 * 没有注入 `astRunner` 时保持旧行为（返回外来代码的明确拒绝），服务层不依赖浏览器。
 */
export async function reverseCodeAuto(
  code: string,
  payload: FieldPayload,
  options: ReverseCodeOptions = {},
): Promise<ReverseCodeResult> {
  const template = reverseCode(code, payload, options);
  const foreignDefs = template.stats.foreignDefs ?? [];
  if (template.language !== 'python' || !foreignDefs.length) {
    return { ...template, path: 'template' };
  }
  if (!options.astRunner) return { ...template, path: 'unsupported' };

  const ast = await reverseForeignCode(code, options.astRunner, buildPrimitiveIndex(payload));
  if (!ast.error && ast.state.blocks.blocks.length > 0) {
    return {
      state: ast.state,
      matchers: template.matchers,
      language: 'python',
      path: 'ast',
      astStats: ast.stats,
      stats: {
        blockStart: 0,
        closureDefs: 0,
        procedures: ast.stats.functions,
        topLevel: ast.stats.statements,
        diagnostics: ast.stats.unsupported,
      },
    };
  }
  return {
    ...template,
    path: 'unsupported',
    astError: ast.error ?? '语法树解析成功，但没有任何语句能翻成块',
  };
}
