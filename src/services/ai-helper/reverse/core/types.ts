/**
 * 核心语法层 · 公共类型。
 */

import type { Matcher } from '../matchers';
import type { ParsedNode } from '../parser';

export interface ParsedStatement {
  text: string;
  node: ParsedNode;
}

export interface CoreContext {
  matchers: Matcher[];
  /** 本模块内定义的 procedure：名 → 形参名。调用块只认这些名字（与 AST 路径同口径）。 */
  procedures: Map<string, string[]>;
  /**
   * 语义漂移诊断的收集器（可选）：块出来了、但与原文语义不同时必须能报出去。
   * 与 AST 路径同一个措辞，面板才不会把两条路径说成两件事。
   */
  diagnostics?: Array<{ text: string; detail: string; reason: 'semantic-drift' | 'unsupported' }>;
}
