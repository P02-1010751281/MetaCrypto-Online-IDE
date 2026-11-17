// @vitest-environment jsdom
/**
 * 反解析产物走**编辑器真实载入路径**（`loadJson`）的验收。
 *
 * 为什么不能只用 `Blockly.serialization.workspaces.load`：编辑器载入的是
 * `utils/workspace/serialization.ts#loadJson`，它在原生 load 之外还做 JSON 深嵌套检查、
 * `migrateJsonState`（sbox 字段迁移、`variables` 表搬运、`ctrl_assign` → `variables_set`）
 * 与失败回滚。反解析器产出的 `variables` 表若被某道迁移吃掉，用户点「载入」看到的
 * 就是一堆无名变量——这在原生 load 的测试里不会暴露。
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
import { countStateBlocks, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import { loadJson } from '@/utils/workspace/serialization';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);

/** 代码块：一个 def（含体）或一条顶层语句。 */
function chunks(code: string): string[] {
  const lines = code
    .split('\n')
    .filter((line) => !/^[A-Za-z_]\w*\s*=\s*None\s*$/.test(line))
    .filter((line) => line.trim() !== '');
  const out: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const text = current.join('\n').trim();
    if (text) out.push(text);
    current = [];
  };
  for (const line of lines) {
    const startsChunk = /^def\s/.test(line) || (!/^\s/.test(line) && current.length > 0);
    if (startsChunk) flush();
    current.push(line);
  }
  flush();
  return out.sort();
}

function demoCode(file: string): string {
  const json = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(json, ws);
    return pythonGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
  }
}

/** 编辑器把画布句柄当 WorkspaceSvg 用，测试里用无头工作区顶替（与 serialization.test.ts 同法）。 */
function editorWorkspace(): Blockly.WorkspaceSvg {
  return new Blockly.Workspace() as unknown as Blockly.WorkspaceSvg;
}

describe('反解析产物 → 编辑器 loadJson', () => {
  it('带变量的 demo：载入成功，变量名与生成代码都回到原样', () => {
    const code = demoCode('demos/AES-Atomic-Round.json');
    const result = reverseCode(code, payload);
    expect(result.stats.diagnostics).toBe(0);

    const ws = editorWorkspace();
    try {
      expect(loadJson(ws, JSON.stringify(result.state))).toBe(true);
      const regenerated = pythonGenerator.workspaceToCode(ws as unknown as Blockly.Workspace);
      expect(chunks(regenerated)).toEqual(chunks(code));
      // 面板报的块数必须与载入后的画布一致（含嵌套子块），否则用户以为有块被吞了。
      expect(ws.getAllBlocks(false)).toHaveLength(countStateBlocks(result.state));
      // 变量表必须真的落进工作区：`i` / `j` 是 AES demo 的两个循环下标。
      const names = ws.getVariableMap().getAllVariables().map((variable) => variable.getName()).sort();
      expect(names).toEqual(['i', 'j']);
    } finally {
      ws.dispose();
    }
  });

  it('procedure demo：形参以变量身份载入，函数体与 return 回到原样', () => {
    const code = demoCode('demos/procedures/SM4-Round.json');
    const result = reverseCode(code, payload);
    const ws = editorWorkspace();
    try {
      expect(loadJson(ws, JSON.stringify(result.state))).toBe(true);
      const regenerated = pythonGenerator.workspaceToCode(ws as unknown as Blockly.Workspace);
      expect(chunks(regenerated)).toEqual(chunks(code));
      const names = ws.getVariableMap().getAllVariables().map((variable) => variable.getName());
      expect(names).toEqual(expect.arrayContaining(['state_0', 'rk']));
    } finally {
      ws.dispose();
    }
  });

  it('只有诊断、没有块时载入仍是合法状态（空工作区，不是失败）', () => {
    const result = reverseCode('some_unknown_call(a, b)\n', payload);
    const ws = editorWorkspace();
    try {
      expect(loadJson(ws, JSON.stringify(result.state))).toBe(true);
      expect(ws.getAllBlocks(false)).toHaveLength(0);
    } finally {
      ws.dispose();
    }
  });
});
