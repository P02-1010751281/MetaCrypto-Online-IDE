// @vitest-environment jsdom
/**
 * 代码 → 工作区（B1b）全量回归：把 60 个 demo 工作区生成 Python，再反解析回工作区，
 * 第二次生成的代码必须与第一次**逐块相等**（每个 def + 每条顶层语句；块的先后放宽，
 * 因为工作区坐标顺序不是证据）。
 *
 * 分母是 60 = demos/ 下 6 个工作区 + demos/procedures/ 54 个；tests.json 与 evidence.json
 * 是数据文件不是工作区，按 `blocks` 键判别排除。诊断必须为 0——有诊断就说明有语句没认出来，
 * 「部分成功」不能用这条判据掩盖。
 */

import { readFileSync, readdirSync } from 'node:fs';
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
    if (/^def\s/.test(line) || (!/^\s/.test(line) && current.length > 0)) flush();
    current.push(line);
  }
  flush();
  return out.sort();
}

function workspaceFiles(): string[] {
  const files = [
    ...readdirSync('demos').filter((name) => name.endsWith('.json')).map((name) => `demos/${name}`),
    ...readdirSync('demos/procedures')
      .filter((name) => name.endsWith('.json'))
      .map((name) => `demos/procedures/${name}`),
  ];
  return files.filter((file) => {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { blocks?: unknown };
    return json.blocks !== undefined;
  });
}

function generate(state: unknown): string {
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

describe('反解析全量回归（60 个 demo）', () => {
  it('每个 demo 生成 → 反解析 → 再生成，代码块逐块相等且零诊断', () => {
    const files = workspaceFiles();
    expect(files).toHaveLength(60);
    const failures: string[] = [];
    for (const file of files) {
      const original = generate(JSON.parse(readFileSync(file, 'utf8')));
      const result = reverseCode(original, payload);
      let regenerated: string;
      try {
        regenerated = generate(result.state);
      } catch (error) {
        failures.push(`${file}: LOAD ${(error as Error).message}`);
        continue;
      }
      if (result.stats.diagnostics > 0) failures.push(`${file}: diag=${result.stats.diagnostics}`);
      if (JSON.stringify(chunks(original)) !== JSON.stringify(chunks(regenerated))) failures.push(file);
    }
    expect(failures).toEqual([]);
  });
});
