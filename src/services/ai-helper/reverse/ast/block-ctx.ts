/**
 * AST 序列化共用的块上下文：块 id、变量 id、变量字段与数字块。
 *
 * 拆出来只为守住单文件 ≤ 500 行：表达式序列化（`expr-blocks.ts`）与语句序列化（`blocks.ts`）
 * 共用这几个派生规则，派生顺序就是块/变量的出现顺序（确定性）。
 */

import type { SerializeDiagnostic, SerializedBlock } from '../serialize';

export interface Ctx {
  variables: Map<string, string>;
  /** 函数名 → 形参名：call 块的 ARG0.. 输入个数与名字由它决定。 */
  signatures: Map<string, string[]>;
  diagnostics: SerializeDiagnostic[];
  nextId: number;
}

export function newId(ctx: Ctx): string {
  ctx.nextId += 1;
  return `ai-ast-${ctx.nextId.toString(36)}`;
}

export function variableId(ctx: Ctx, name: string): string {
  const existing = ctx.variables.get(name);
  if (existing) return existing;
  const id = `ai-var-${ctx.variables.size + 1}`;
  ctx.variables.set(name, id);
  return id;
}

export function varField(ctx: Ctx, name: string): { VAR: { id: string } } {
  return { VAR: { id: variableId(ctx, name) } };
}

export function numBlock(ctx: Ctx, value: string): SerializedBlock {
  return { type: 'math_number', id: newId(ctx), fields: { NUM: value } };
}
