// @vitest-environment jsdom
/**
 * 推导式展开的**串联**回归（浏览器 e2e 先抓到、单测原先漏掉的那一类）。
 *
 * 推导式脱糖后一条语句单元不再是一个块（`chain` 虚拟节点 = 空列表 + 循环 + append）。
 * `serialize` 之前把链头当游标接下一句，于是后面只要再有一条语句，就会把链头与循环之间
 * 的 `next` 覆盖掉：`table = []` 直接接上 `acc = 0`，循环与 append 被静默吞掉，
 * 再生成的代码里只剩空列表赋值，且**一条诊断都没有**。
 *
 * 这里钉住的是「推导式后面还有别的语句」这个形态（前面的用例都是推导式在函数体末尾，
 * 所以覆盖不到）。断言走真实入口 `reverseCode`，并比较再生成代码。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';
import { pythonGenerator } from 'blockly/python';
import { describe, expect, it } from 'vitest';

import '@/blocks';
import '@/generators/python';
import { parseClosureNames, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import type { SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);

const SAMPLE = [
  'def expand(state, i, n):',
  '    head = state[0:4]',
  '    tail = state[i:]',
  '    table = [v * 2 for v in range(n)]',
  '    odds = [v for v in range(n) if v > 2]',
  '    acc = 0',
  '    for k in range(0, len(state)):',
  '        acc = acc + k',
  '    return acc',
  '',
].join('\n');

function flatten(state: SerializedWorkspace): SerializedBlock[] {
  const out: SerializedBlock[] = [];
  const walk = (block: SerializedBlock): void => {
    out.push(block);
    for (const input of Object.values(block.inputs ?? {})) walk(input.block);
    if (block.next) walk(block.next.block);
  };
  state.blocks.blocks.forEach(walk);
  return out;
}

function regenerate(state: SerializedWorkspace): string {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      state as Parameters<typeof Blockly.serialization.workspaces.load>[0],
      workspace,
    );
    return pythonGenerator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

describe('推导式展开后的语句串联', () => {
  it('推导式后面还有语句时，循环与 append 不会被覆盖掉', () => {
    const result = reverseCode(SAMPLE, payload, {});
    const types = flatten(result.state).map((block) => block.type);

    // 两条推导式各一条循环 + 一条 append；带 if 的那条还多一个 controls_if。
    expect(types.filter((type) => type === 'ctrl_iterate')).toHaveLength(2);
    expect(types.filter((type) => type === 'arr_append')).toHaveLength(2);
    expect(types.filter((type) => type === 'controls_if')).toHaveLength(1);
    expect(types.filter((type) => type === 'ctrl_range')).toHaveLength(1);

    const code = regenerate(result.state);
    expect(code).toContain('table = []');
    expect(code).toContain('table.append(v * 2)');
    expect(code).toContain('odds = []');
    expect(code).toContain('if v > 2:');
    expect(code).toContain('odds.append(v)');
    // 切片钳位与两参 range 也一并钉住（同一条样本上的另外两件事）。
    expect(code).toContain('min(max(');
    expect(code).toContain('range(0, len(state))');
    // 这些构造都能忠实表达：不许有诊断，更不许有「未识别」。
    expect(result.state.diagnostics).toEqual([]);
  });
});
