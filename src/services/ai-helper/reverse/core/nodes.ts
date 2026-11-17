/**
 * 模板路径 · 节点构造器：块节点、子输入，以及「认不出」的两种收尾。
 *
 * `blocked` 与 `unresolved` 的区别只在诊断：前者带原因与说明（序列化层据此出一**条**
 * 说明缺什么原语的诊断），后者退化成通用的「未识别」。核心语法层知道自己为什么放弃，
 * 就该把这个理由带出去，而不是让上层再猜一次。
 */

import type { ParsedNode } from '../parser';

export function node(
  type: string,
  fields: Record<string, string> = {},
  children: ParsedNode['children'] = [],
): ParsedNode {
  return { type, fields, children };
}

export function child(input: string, value: ParsedNode): ParsedNode['children'][number] {
  return { input, node: value };
}

export function unresolved(): ParsedNode {
  return node('UNRESOLVED');
}

/** 认不出、且说得清缺什么：`reason` 决定面板把它显示成「未实现」还是「语义不同」。 */
export function blocked(
  detail: string,
  reason: 'unsupported' | 'semantic-drift' = 'unsupported',
): ParsedNode {
  return { ...unresolved(), blocked: { reason, detail } };
}
