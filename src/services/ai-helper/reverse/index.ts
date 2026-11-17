/**
 * 代码 → 工作区 反解析器（用户侧 AI Helper · B 线 B1b）的公共入口。
 *
 * 从 scripts/ai-helper-reverse.ts 抽出来的浏览器纯函数模块，按职责分层：
 *   - matchers.ts：FieldPayload → 段序列 → 匹配器（含括号深度扫描）
 *   - parser.ts：表达式 / 语句 / 语句单元
 *   - layout.ts：生成文件里块代码区的定位、procedure 签名与体
 *   - serialize.ts：ParsedNode → Blockly 序列化状态（不依赖 Blockly）
 *   - code-to-workspace.ts：以上一条龙入口
 *   - language.ts：输入语言判别（JS 形态明确不支持，先判别再决定是否走 Python 路径）
 *   - payload.ts：运行时模板载荷的加载与解析
 * 导出面与原 scripts 文件完全一致，脚本侧仍从 scripts/ai-helper-reverse.ts 取同名符号。
 */
export { buildMatchers } from './matchers';
// Segment 是 matchers.ts 内部结构，不进桶：脚本侧可见的导出面必须与抽模块之前一字不差。
export type { BlockFieldTemplate, FieldPayload, Matcher } from './matchers';

export { matchStatementSpan, parseExpression, parseStatement, splitStatementUnits } from './parser';
export type { ParsedNode, StatementUnit } from './parser';

export {
  isGeneratedProcedure,
  locateBlockCode,
  parseSignature,
  procedureUnits,
  scanTopLevelDefs,
  splitCode,
} from './layout';
export type { CodeLayout, ProcedureParam, ProcedureSignature, TopLevelDef } from './layout';

export { countStateBlocks, toWorkspaceState } from './serialize';
export type {
  ProcedureNode,
  SerializeDiagnostic,
  SerializeOptions,
  SerializedBlock,
  SerializedWorkspace,
  StatementNode,
} from './serialize';

export { reverseCode } from './code-to-workspace';
export type { ReverseCodeOptions, ReverseCodeResult } from './code-to-workspace';

export { detectInputLanguage } from './language';
export type { ReverseInputLanguage } from './language';

export { loadFieldPayload, parseFieldPayload } from './payload';
