/**
 * 契约读取（Node 实验脚本侧）——**委托给 src 下的单一实现**。
 *
 * 契约真值只有一份：docs/blocks/BLOCK-IO-CONTRACT.json。
 * 判定语义（inputCheck / outputCheck / compatibility / 三值口径）也只有一份：
 * src/services/ai-helper/contract.ts（产品侧浏览器内核）。
 * 本文件不再复制那套逻辑，只在这里补「已解析节点树」的遍历工具（checkTree / mergeResults），
 * 因为反解析器产出的 TreeLike 是脚本侧的数据形状，产品侧不需要它。
 */

import { compatibility, inputCheck, outputCheck } from '@/services/ai-helper/contract';
import type { Contract } from '@/services/ai-helper/contract';

export { loadContract, inputCheck, outputCheck, compatibility } from '@/services/ai-helper/contract';
export type { Contract, ContractEntry, ContractInput } from '@/services/ai-helper/contract';

/** 反解析器产出的节点树形状（与 Blockly 无关，纯数据）。 */
export interface TreeLike {
  type: string;
  fields: Record<string, string>;
  children: Array<{ input: string; node: TreeLike }>;
}

export interface TypeCheckResult {
  checked: number;
  ok: number;
  mismatch: number;
  unknown: number;
  findings: Array<{ path: string; parent: string; input: string; child: string; expected: string[]; actual: string[] }>;
}

export function checkTree(root: TreeLike, contract: Contract, path = '#'): TypeCheckResult {
  const result: TypeCheckResult = { checked: 0, ok: 0, mismatch: 0, unknown: 0, findings: [] };
  walk(root, contract, path, result);
  return result;
}

function walk(node: TreeLike, contract: Contract, path: string, result: TypeCheckResult): void {
  for (const child of node.children) {
    const expected = inputCheck(contract, node.type, child.input);
    const actual = outputCheck(contract, child.node.type);
    const verdict = compatibility(expected, actual);
    if (verdict === 'unknown') result.unknown += 1;
    else {
      result.checked += 1;
      if (verdict === 'ok') result.ok += 1;
      else {
        result.mismatch += 1;
        result.findings.push({
          path: `${path}.${node.type}[${child.input}]`,
          parent: node.type,
          input: child.input,
          child: child.node.type,
          expected: expected ?? [],
          actual: actual ?? [],
        });
      }
    }
    walk(child.node, contract, `${path}.${node.type}[${child.input}]`, result);
  }
}

export function mergeResults(results: TypeCheckResult[]): TypeCheckResult {
  const merged: TypeCheckResult = { checked: 0, ok: 0, mismatch: 0, unknown: 0, findings: [] };
  for (const item of results) {
    merged.checked += item.checked;
    merged.ok += item.ok;
    merged.mismatch += item.mismatch;
    merged.unknown += item.unknown;
    merged.findings.push(...item.findings);
  }
  return merged;
}
