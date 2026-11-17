/**
 * 外部 Python 源码 → 工作区（B 线 B2 / S3 第一段的总装）
 *
 * 链路固定四步，每一步都能单独测：
 *   `buildAstDumpScript`（dump.ts）→ 宿主执行 → `readAstDump` → `astToIr`（ir.ts）
 *   → `irToWorkspace`（blocks.ts）。
 *
 * **不执行用户代码**：宿主（浏览器里是 Pyodide worker）只跑转储脚本，脚本里只有
 * `ast.parse`，没有任何 exec/eval。这一点与「试运行」严格分开：试运行才是真的执行。
 *
 * 宿主由调用方注入（`PyAstRunner`）：服务层不 import 浏览器 runtime，单测可以直接
 * 把本机 `python3` 包成 runner，不必在 vitest 里加载 12MB 的 Pyodide。
 */

import { buildAstDumpScript, readAstDump } from './dump';
import { astToIr } from './ir';
import type { IrModule, IrStmt } from './ir';
import { irToWorkspace } from './blocks';
import type { PrimitiveIndex } from '../primitive-calls';
import type { SerializedWorkspace } from '../serialize';

/** 执行一段 Python 源码并拿到它的返回值（字符串）。浏览器里由 Pyodide worker 实现。 */
export type PyAstRunner = (script: string) => Promise<string>;

export interface AstReverseStats {
  functions: number;
  statements: number;
  /** 翻不出来、已记诊断的节点数。 */
  unsupported: number;
}

export interface AstReverseResult {
  state: SerializedWorkspace;
  /** 只在这段源码根本不是合法 Python、或宿主执行失败时给。 */
  error?: string;
  stats: AstReverseStats;
}

function countStatements(stmts: IrStmt[]): number {
  let total = 0;
  for (const stmt of stmts) {
    total += 1;
    if (stmt.kind === 'if') {
      for (const branch of stmt.branches) total += countStatements(branch.body);
      total += countStatements(stmt.orelse);
    } else if (stmt.kind === 'for' || stmt.kind === 'while' || stmt.kind === 'iterate') {
      total += countStatements(stmt.body);
    }
  }
  return total;
}

function countModule(ir: IrModule): number {
  let total = countStatements(ir.topLevel);
  for (const procedure of ir.procedures) total += countStatements(procedure.body);
  return total;
}

function emptyState(): SerializedWorkspace {
  return { blocks: { languageVersion: 0, blocks: [] }, variables: [], diagnostics: [] };
}

export async function reverseForeignCode(
  code: string,
  run: PyAstRunner,
  primitives?: PrimitiveIndex,
): Promise<AstReverseResult> {
  let raw: string;
  try {
    raw = await run(buildAstDumpScript(code));
  } catch (error) {
    return {
      state: emptyState(),
      error: `Python 语法树解析没能跑起来：${error instanceof Error ? error.message : String(error)}`,
      stats: { functions: 0, statements: 0, unsupported: 0 },
    };
  }

  const dump = readAstDump(raw);
  if (!dump.ok) {
    const where = dump.error.line ? `第 ${dump.error.line} 行` : '未知行';
    return {
      state: emptyState(),
      error: `${where}：${dump.error.message}`,
      stats: { functions: 0, statements: 0, unsupported: 0 },
    };
  }

  const ir = astToIr(dump.module, code, primitives);
  const state = irToWorkspace(ir);
  return {
    state,
    stats: {
      functions: ir.procedures.length,
      statements: countModule(ir),
      unsupported: state.diagnostics.length,
    },
  };
}
