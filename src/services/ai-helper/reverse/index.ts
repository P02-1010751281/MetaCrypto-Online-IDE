/**
 * 代码 → 工作区 反解析器（用户侧 AI Helper · A/B 线 P1.2）的公共入口。
 *
 * 从 scripts/ai-helper-reverse.ts 抽出来的浏览器纯函数模块，按职责拆三份：
 *   - matchers.ts：FieldPayload → 段序列 → 匹配器（含括号深度扫描）
 *   - parser.ts：表达式 / 语句 / 语句单元
 *   - layout.ts：生成文件里块代码区的定位与切分
 * 导出面与原 scripts 文件完全一致，脚本侧仍从 scripts/ai-helper-reverse.ts 取同名符号。
 */
export { buildMatchers } from './matchers';
// Segment 是 matchers.ts 内部结构，不进桶：脚本侧可见的导出面必须与抽模块之前一字不差。
export type { BlockFieldTemplate, FieldPayload, Matcher } from './matchers';

export { matchStatementSpan, parseExpression, parseStatement, splitStatementUnits } from './parser';
export type { ParsedNode, StatementUnit } from './parser';

export { locateBlockCode, splitCode } from './layout';
export type { CodeLayout } from './layout';
