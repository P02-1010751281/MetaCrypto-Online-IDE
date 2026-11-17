// @vitest-environment jsdom
/**
 * 代码 → 工作区一条龙（`reverse/code-to-workspace.ts`）的验收。
 *
 * 判据不是「树长得像」而是**代码回到原样**：拿真 demo 生成 Python，反解析成工作区状态，
 * 载入 Blockly 再生成一次，两边的代码块（每个 def + 每条顶层语句）按内容逐块相等。
 * 只在「块的先后」上放宽（工作区坐标顺序不是证据），函数体内顺序仍然逐行比。
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
import { parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';

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

function loadDemo(file: string): { code: string; ws: Blockly.Workspace } {
  const json = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(json, ws);
  return { code: pythonGenerator.workspaceToCode(ws), ws };
}

function regenerate(state: unknown): string {
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      state as Parameters<typeof Blockly.serialization.workspaces.load>[0],
      ws,
    );
    return pythonGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
  }
}

describe('代码 → 工作区（B1b 一条龙）', () => {
  it('原子块 demo：顶层语句逐块回到原样', () => {
    const { code, ws } = loadDemo('demos/AES-Atomic-Round.json');
    ws.dispose();
    const result = reverseCode(code, payload);
    expect(result.stats.diagnostics).toBe(0);
    expect(chunks(regenerate(result.state))).toEqual(chunks(code));
  });

  it('procedure demo：def 签名、体内语句与 return 一起回到原样', () => {
    const { code, ws } = loadDemo('demos/procedures/SM4-Round.json');
    ws.dispose();
    const result = reverseCode(code, payload);
    expect(result.stats.procedures).toBe(1);
    expect(result.stats.diagnostics).toBe(0);
    expect(chunks(regenerate(result.state))).toEqual(chunks(code));
  });

  it('整块都在 def 体里的 demo（CCM）：不因顶层为空而假绿', () => {
    const { code, ws } = loadDemo('demos/procedures/CCM-Encrypt.json');
    ws.dispose();
    const result = reverseCode(code, payload);
    expect(result.stats.procedures).toBeGreaterThan(0);
    expect(result.stats.topLevel).toBe(0);
    expect(result.stats.diagnostics).toBe(0);
    expect(chunks(regenerate(result.state))).toEqual(chunks(code));
  });

  it('未识别的语句只进诊断，不会变成块', () => {
    const result = reverseCode('some_unknown_call(a, b)\n', payload);
    expect(result.state.blocks.blocks).toEqual([]);
    expect(result.state.diagnostics).toHaveLength(1);
  });

  it('同一条语句只出诊断一次：子块失败不再由父块重复记一次', () => {
    // 真实浏览器里曾把这两行各报两次（子块失败 + 父块 withheld 各记一条），用户会以为有四处错误。
    const code = [
      'def f(state):',
      '    """',
      '    Crypto function: f',
      '    """',
      '    return sbox_transform(state)',
      '',
      'x = bytes([0x00, 0x11])',
    ].join('\n');
    const result = reverseCode(code, payload);
    const texts = result.state.diagnostics.map((diagnostic) => diagnostic.text);
    expect(texts).toEqual(['sbox_transform(state)', 'x = bytes([0x00, 0x11])']);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
