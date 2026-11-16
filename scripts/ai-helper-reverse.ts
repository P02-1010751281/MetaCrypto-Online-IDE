/**
 * 代码 → 工作区：反解析器的脚本侧入口（用户侧 AI Helper · A/B 线 P1.2）
 *
 * 实现已抽到 src/services/ai-helper/reverse/（浏览器可直接 import 的纯函数模块），
 * 这里只保留同名转发，roundtrip / validate 等脚本的导入路径与语义不变。
 */
export {
  buildMatchers,
  locateBlockCode,
  matchStatementSpan,
  parseExpression,
  parseStatement,
  splitCode,
  splitStatementUnits,
} from '@/services/ai-helper/reverse';
export type {
  BlockFieldTemplate,
  CodeLayout,
  FieldPayload,
  Matcher,
  ParsedNode,
  StatementUnit,
} from '@/services/ai-helper/reverse';
