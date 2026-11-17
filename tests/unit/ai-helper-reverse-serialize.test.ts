// @vitest-environment jsdom
/**
 * 反解析结果 → Blockly 工作区状态的回归（`reverse/serialize.ts`）。
 *
 * 钉住三件事：
 *   1. 树能变成**真能加载**的工作区状态：`workspaces.load` 之后生成器能吐出可读代码；
 *   2. 变量按名建 id 且引用一致（`variables_set` 写、`variables_get` 读同一个变量）；
 *   3. 认不出的语句**不写成任何块**，只出诊断；同一输入两次序列化逐字相同。
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
import { buildMatchers, parseFieldPayload, parseStatement } from '@/services/ai-helper/reverse';
import { toWorkspaceState } from '@/services/ai-helper/reverse/serialize';
import type { StatementNode } from '@/services/ai-helper/reverse/serialize';

setLocale(enMessages as unknown as Record<string, string>);

/** 运行时载荷：反解析要用的模板表，构建期采集、随 src 交付（新鲜度由 reverse:templates:check 守）。 */
const fieldTemplates = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);

function generate(units: StatementNode[]): { code: string; diagnostics: string[] } {
  const state = toWorkspaceState(units);
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      state as unknown as Parameters<typeof Blockly.serialization.workspaces.load>[0],
      workspace,
    );
    return {
      code: pythonGenerator.workspaceToCode(workspace),
      diagnostics: state.diagnostics.map((item) => item.text),
    };
  } finally {
    workspace.dispose();
  }
}

describe('反解析 → 工作区状态', () => {
  it('语句链与子块写入后，Blockly 能加载并生成同一句代码', () => {
    const units: StatementNode[] = [
      {
        text: 'state = [0x00,0x11]',
        node: {
          type: 'variables_set',
          fields: { VAR: 'state' },
          children: [
            { input: 'VALUE', node: { type: 'data_value', fields: { NUM: '[0x00,0x11]' }, children: [] } },
          ],
        },
      },
      {
        text: 'aes_sub_bytes(state)',
        node: {
          type: 'aes_sub_bytes',
          fields: {},
          children: [
            { input: 'STATE', node: { type: 'variables_get', fields: { VAR: 'state' }, children: [] } },
          ],
        },
      },
    ];

    const { code, diagnostics } = generate(units);
    expect(diagnostics).toEqual([]);
    expect(code).toContain('state = [0x00,0x11]');
    expect(code).toContain('aes_sub_bytes(state)');
  });

  it('变量只建一次、读写共用同一个 id', () => {
    const state = toWorkspaceState([
      {
        text: 'state = [0x00,0x11]',
        node: {
          type: 'variables_set',
          fields: { VAR: 'state' },
          children: [
            { input: 'VALUE', node: { type: 'data_value', fields: { NUM: '[0x00,0x11]' }, children: [] } },
          ],
        },
      },
      {
        text: 'aes_sub_bytes(state)',
        node: {
          type: 'aes_sub_bytes',
          fields: {},
          children: [
            { input: 'STATE', node: { type: 'variables_get', fields: { VAR: 'state' }, children: [] } },
          ],
        },
      },
    ]);

    expect(state.variables).toEqual([{ name: 'state', id: 'ai-var-1' }]);
    const first = state.blocks.blocks[0];
    const second = state.blocks.blocks[1];
    expect((first?.fields?.VAR as { id: string }).id).toBe('ai-var-1');
    const readVar = second?.inputs?.STATE.block.inputs?.STATE ?? second?.inputs?.STATE;
    expect(readVar).toBeTruthy();
    expect(
      ((second?.inputs?.STATE.block as { fields?: { VAR?: { id: string } } }).fields?.VAR as { id: string }).id,
    ).toBe('ai-var-1');
  });

  it('认不出的语句不写成块，只出诊断', () => {
    const state = toWorkspaceState([
      { text: 'some_unknown_call(a, b)', node: { type: 'UNRESOLVED', fields: {}, children: [] } },
      {
        text: 'aes_sub_bytes(state)',
        node: {
          type: 'aes_sub_bytes',
          fields: {},
          children: [
            { input: 'STATE', node: { type: 'variables_get', fields: { VAR: 'state' }, children: [] } },
          ],
        },
      },
    ]);

    expect(state.blocks.blocks).toHaveLength(1);
    expect(state.blocks.blocks[0]?.type).toBe('aes_sub_bytes');
    expect(state.diagnostics).toEqual([{ text: 'some_unknown_call(a, b)', reason: 'unresolved' }]);
  });

  it('子块认不出时整块不写（不留缺输入的空壳）', () => {
    const state = toWorkspaceState([
      {
        text: 'aes_sub_bytes(??? )',
        node: {
          type: 'aes_sub_bytes',
          fields: {},
          children: [{ input: 'STATE', node: { type: 'UNRESOLVED', fields: {}, children: [] } }],
        },
      },
    ]);

    expect(state.blocks.blocks).toEqual([]);
    // 一条诊断：子层已为认不出的子块记过一次，父层不再用同一段原文重复记
    // （真实浏览器里曾因此把同一行报两次，见 RESULTS §33.2）。
    expect(state.diagnostics).toEqual([{ text: 'aes_sub_bytes(??? )', reason: 'unresolved' }]);
  });

  it('同一输入两次序列化逐字相同（可用作快照）', () => {
    const units: StatementNode[] = [
      {
        text: 'aes_sub_bytes(state)',
        node: {
          type: 'aes_sub_bytes',
          fields: {},
          children: [
            { input: 'STATE', node: { type: 'variables_get', fields: { VAR: 'state' }, children: [] } },
          ],
        },
      },
    ];
    expect(JSON.stringify(toWorkspaceState(units))).toBe(JSON.stringify(toWorkspaceState(units)));
  });

  it('真代码走一遍：解析 → 序列化 → 生成，代码回到原样', () => {
    const matchers = buildMatchers(fieldTemplates);
    const text = 'aes_sub_bytes(state)';
    const node = parseStatement(text, matchers);
    expect(node.type).toBe('aes_sub_bytes');
    const { code, diagnostics } = generate([{ text, node }]);
    expect(diagnostics).toEqual([]);
    // 生成文件 = 内嵌实现前缀（aes_sbox 闭包）+ 块代码后缀；块代码是最后那一段非空行。
    expect(code.trim().split('\n').filter(Boolean).pop()).toBe(text);
  });
});
