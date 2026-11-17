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
import {
  isGeneratedProcedure,
  locateBlockCode,
  procedureUnits,
  scanTopLevelDefs,
  splitCode,
} from './layout';
import type { Matcher } from './matchers';
import { buildMatchers } from './matchers';
import type { FieldPayload } from './matchers';
import { parseExpression, parseStatement, splitStatementUnits } from './parser';
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
}

export interface ReverseCodeResult {
  state: SerializedWorkspace;
  matchers: Matcher[];
  /** 实际走（或被判别为）哪条路径；面板据此区分「形态不支持」与「语句认不出」。 */
  language: ReverseInputLanguage;
  stats: {
    /** 块代码区起始行（0 基）；之前是生成器内嵌实现。 */
    blockStart: number;
    closureDefs: number;
    procedures: number;
    topLevel: number;
    diagnostics: number;
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
  const lines = code.split(/\r?\n/).filter((line) => !NONE_DECLARATION.test(line));

  const defs = scanTopLevelDefs(lines);
  const names = options.procedureNames ?? new Set(
    defs.filter((def) => isGeneratedProcedure(def.body)).map((def) => def.signature.name),
  );

  const blockStart = locateBlockCode(lines, matchers, names);
  const layout = splitCode(lines, blockStart, names);

  const topLevel: StatementNode[] = splitStatementUnits(layout.topLevel.join('\n'), matchers)
    .map((unit) => ({ text: unit.text, node: parseStatement(unit.text, matchers) }));

  const procedures: ProcedureNode[] = [];
  for (const [name, body] of layout.bodies) {
    const signature = layout.signatures.get(name);
    if (!signature) continue;
    const parsed = procedureUnits(body, matchers);
    const bodyUnits: StatementNode[] = parsed.units.map((unit) => ({
      text: unit.text,
      node: parseStatement(unit.text, matchers),
    }));
    const returnNode = parsed.returnExpr
      ? { text: parsed.returnExpr, node: parseExpression(parsed.returnExpr, matchers) }
      : null;
    procedures.push({ signature, body: bodyUnits, returnNode });
  }

  const state = toWorkspaceState(topLevel, { procedures });

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
