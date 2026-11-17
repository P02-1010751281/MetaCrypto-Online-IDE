/**
 * 函数封装的参数名：进生成代码前必须过 NameDB
 *
 * 签名里的参数名不能直接抄工作区变量名。Blockly 的 NameDB（`getVariableName`）会把
 * Python/JS 保留字、内置名（`input`、`bytes`）和不合法标识符改写成合法名字
 * （`in` → `in2`、`input` → `input2`、`my param` → `my_param`），而函数体里的
 * `variables_get` 一直走的就是这张表。签名若直接写原名，两头就对不上：
 *
 *   def f(in: bytes):      # 语法错，而且
 *       return in2         # 体内引用的是 NameDB 改过的名字
 *
 * 这类参数名来自用户给变量起名（`in`、`class` 是 C 参考实现里最常见的形参名），
 * 不是我们能拦住的输入。所以签名侧也走同一张表。
 *
 * 关键点是**按名字查表**，不按变量 id 查：NameDB 的 id 查询依赖 `setVariableMap`
 * （只有 `workspaceToCode` 的常规路径才装好），离屏直接调块生成器时会退化成把 id
 * 当名字用。名字查询在两种调用方式下结果一致，也与体内 `variables_get` 的取名收敛到
 * 同一条 `getDistinctName` 记录。
 */

import type { Workspace } from 'blockly/core';

/** 只用到 NameDB 的取名接口：PythonGenerator / JavascriptGenerator 都满足，且不必互相兼容。 */
export interface NameDbGenerator {
  getVariableName(nameOrId: string): string;
}

export function paramCodeName(
  generator: NameDbGenerator,
  workspace: Workspace,
  rawName: string,
  varId?: string | null,
): string {
  const variable = varId
    ? workspace.getVariableMap().getVariableById(varId)
    : workspace.getVariableMap().getVariable(rawName, '');
  try {
    return generator.getVariableName(variable ? variable.getName() : rawName);
  } catch {
    // NameDB 未初始化（生成器被当作纯函数调用）时保持原样，调用方仍拿到可用代码。
    return rawName;
  }
}
