// @vitest-environment jsdom
/**
 * 扁平 IR 的往返验收（研究文档 P0 的验收口径：IR 往返后生成代码与原始一致）。
 *
 * 做法与 `npm run ir:check` 互补：
 *   - 门禁脚本只比较语义结构（块类型/字段/连接），不依赖 Blockly；
 *   - 本测试把组装后的 workspace 真正交给 Blockly 加载并跑双生成器，
 *     逐份 Demo 断言 JS / Python 代码与原始完全一致——证明 IR 没有被组装器「吃掉」语义。
 *
 * 边界：只覆盖登记的 60 份 Demo 里出现过的 137 个块类型；不证明 IR 能表达这 137 个之外的
 * 组合（例如 shadow 块、注释），v0 对这些是显式拒绝而不是静默丢弃。
 */
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import '@/blocks';
import '@/generators/javascript';
import '@/generators/python';

import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';
import { assembleIr, flattenWorkspace } from '../../scripts/lib/block-ir.mjs';

setLocale(enMessages as unknown as Record<string, string>);

const registry = Object.keys(
  JSON.parse(readFileSync(resolve(process.cwd(), 'demos/tests.json'), 'utf8')) as Record<string, unknown>,
).sort();

function readDemo(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'demos', name), 'utf8'));
}

function generate(doc: unknown, language: 'javascript' | 'python'): string {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(doc as Record<string, unknown>, workspace);
    return language === 'javascript'
      ? javascriptGenerator.workspaceToCode(workspace)
      : pythonGenerator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

describe('flat block IR round-trip against real Blockly generators', () => {
  it('loads 60 registered demos and regenerates identical code', () => {
    expect(registry.length).toBe(60);
    const mismatches: string[] = [];
    for (const name of registry) {
      const original = readDemo(name);
      const assembled = assembleIr(flattenWorkspace(original, name) as never);
      for (const language of ['javascript', 'python'] as const) {
        const before = generate(original, language);
        const after = generate(assembled, language);
        if (before !== after) mismatches.push(`${name} (${language})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('keeps procedure mutation state (params/hasStatements) across the round-trip', () => {
    const name = 'procedures/CCM-Encrypt.json';
    const original = readDemo(name) as { blocks: { blocks: Array<{ type: string; extraState?: unknown }> } };
    const assembled = assembleIr(flattenWorkspace(original, name) as never) as unknown as {
      blocks: { blocks: Array<{ type: string; extraState?: unknown }> };
    };
    const before = original.blocks.blocks.filter((block) => block.type === 'procedures_defreturn').map((block) => block.extraState);
    const after = assembled.blocks.blocks.filter((block) => block.type === 'procedures_defreturn').map((block) => block.extraState);
    expect(after).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });
});
