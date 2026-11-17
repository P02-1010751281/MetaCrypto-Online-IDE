/**
 * 代码 → 工作区：模板路径的**核心语法层**（B2 / S3 P2.3c 第一刀）
 *
 * 模板路径原本只认「222 个密码块的代码字体」+ 赋值兜底，控制流（if/while/for）、算术与比较
 * 一律认不出——用户用「控制流编排 / 基础数学」搭出来的工作区，导出代码后再「从代码生成工作区」
 * 会整段失败（RESULTS §41.3 实测：算术+if 样本 3 条诊断、while+if-elif-else 9 条）。
 *
 * 按职责拆三个文件（守住单文件 ≤ 500 行）：
 *   - `core/types.ts`：公共类型（`ParsedStatement` / `CoreContext`）；
 *   - `core/expressions.ts`：按运算符优先级拆表达式；
 *   - `core/statements.ts`：按缩进拆语句（if/elif/else、while、for-range、return）。
 *
 * 三条纪律：
 *   - **不猜**：拆不动就返回 null / `UNRESOLVED*`，绝不换成相近的块；
 *   - **与 AST 路径同形**：字段名、输入名、`extraState` 必须与 `ast/blocks.ts` 逐字一致，
 *     否则「载入 → 生成 → 再载入」的固定点判据会把两边判成不同工作区；
 *   - **模板优先**：每个表达式先问模板层（密码块），模板认不出才按运算符拆。
 */

export { parseCoreExpression, parseValue } from './core/expressions';
export { parsePythonBody } from './core/statements';
export type { CoreContext, ParsedStatement } from './core/types';
