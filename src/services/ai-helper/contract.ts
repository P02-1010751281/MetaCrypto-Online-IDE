/**
 * 积木输入输出契约（用户侧 AI Helper · 浏览器端内核）
 *
 * 单一真值：docs/blocks/BLOCK-IO-CONTRACT.json——由 `npm run block-io:write` 从活块定义生成、
 * 由 `contract:check` 校验漂移。这里直接 import 该 JSON，不在 src/ 下留第二份副本。
 *
 * 判定三值：ok（可证相容）/ mismatch（可证不符）/ unknown（有一侧没声明类型）。
 * unknown 必须单列并计数——「对一切返回 unknown」的检查器也是零误报。
 */

import CONTRACT_JSON from '../../../docs/blocks/BLOCK-IO-CONTRACT.json';

export interface ContractInput {
  name: string;
  type: number;
  check: string[] | null;
}

export interface ContractField {
  name: string;
  [key: string]: unknown;
}

export interface ContractEntry {
  inputs: ContractInput[];
  fields: ContractField[];
  outputCheck: string[] | null;
  previousStatement: unknown;
  nextStatement: unknown;
}

export type Contract = Record<string, ContractEntry>;

/** Blockly 的 input 类型枚举：1=value, 3=dummy, 5=statement。 */
const INPUT_TYPE_VALUE = 1;

/** 契约常量。浏览器里直接用它；测试或调用方也可注入自己的契约副本做变异实验。 */
export const CONTRACT = CONTRACT_JSON as unknown as Contract;

/** 兼容 Node 脚本的读取入口；浏览器里返回同一份 import 进来的常量。 */
export function loadContract(): Contract {
  return CONTRACT;
}

/** 父块某个值输入的 check（未声明或空数组都视为无类型约束）。 */
export function inputCheck(contract: Contract, blockType: string, inputName: string): string[] | null {
  const entry = contract[blockType];
  if (!entry) return null;
  const input = entry.inputs.find((item) => item.type === INPUT_TYPE_VALUE && item.name === inputName);
  if (!input) return null;
  return input.check && input.check.length ? input.check : null;
}

/** 块输出侧的 check。 */
export function outputCheck(contract: Contract, blockType: string): string[] | null {
  const entry = contract[blockType];
  if (!entry) return null;
  return entry.outputCheck && entry.outputCheck.length ? entry.outputCheck : null;
}

/** 类型集合是否相容：任一侧为空视为未知；两侧有交集即相容。 */
export function compatibility(expected: string[] | null, actual: string[] | null): 'ok' | 'mismatch' | 'unknown' {
  if (!expected || !actual) return 'unknown';
  return expected.some((type) => actual.includes(type)) ? 'ok' : 'mismatch';
}
