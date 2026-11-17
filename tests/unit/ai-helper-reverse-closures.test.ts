// @vitest-environment jsdom
/**
 * 闭包名单分流（B1d）：没有生成器 docstring 时，靠「名字是不是内嵌闭包」判 procedure。
 *
 * 三轮判据：
 *   1. 名单覆盖：60 个 demo 生成代码里所有**无题头** def 都必须在内嵌名单里（漏一个，
 *      用户粘代码时那个闭包会被当成 procedure，整段解析歪掉）；
 *   2. 分流可用：删掉 docstring 后，只靠名单就能把 procedure 认回来（AES-Round 单例 + 全量见
 *      ai-helper-reverse-perturb.test.ts）；
 *   3. 外来代码要大声失败：LLM 风格的一段 Python（有 for、有助手函数）必须识别成
 *      foreign-code、零块、一条诊断，且给出函数名清单，而不是拼出一个半成品工作区。
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
import {
  isGeneratedProcedure,
  parseClosureNames,
  parseFieldPayload,
  reverseCode,
  scanTopLevelDefs,
} from '@/services/ai-helper/reverse';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);
const closures = new Set(payload.closures);

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

function demoFiles(): string[] {
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

describe('闭包名单', () => {
  it('覆盖 60 个 demo 里所有无题头的 def（漏一个就会把内嵌实现当成 procedure）', () => {
    const missing: string[] = [];
    for (const file of demoFiles()) {
      const code = generate(JSON.parse(readFileSync(file, 'utf8')));
      for (const def of scanTopLevelDefs(code.split('\n'))) {
        if (isGeneratedProcedure(def.body)) continue;
        if (!closures.has(def.signature.name)) missing.push(`${file}: ${def.signature.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('名单与 procedure 名不重叠（同名会让分流二义）', () => {
    const overlap: string[] = [];
    for (const file of demoFiles()) {
      const code = generate(JSON.parse(readFileSync(file, 'utf8')));
      for (const def of scanTopLevelDefs(code.split('\n'))) {
        if (isGeneratedProcedure(def.body) && closures.has(def.signature.name)) overlap.push(def.signature.name);
      }
    }
    expect(overlap).toEqual([]);
  });

  it('删掉 docstring 后，只靠名单就能把 procedure 认回来（AES-Round）', () => {
    const original = generate(JSON.parse(readFileSync('demos/procedures/AES-Round.json', 'utf8')));
    const stripped = original.replace(/^[ \t]*"""[\s\S]*?"""\n/gm, '');
    const result = reverseCode(stripped, payload);
    expect(result.stats.procedures).toBe(1);
    expect(result.state.diagnostics).toEqual([]);
    expect(result.stats.foreignDefs).toBeUndefined();
    // 再生成的代码块集合与原文一致（顺序不是证据）
    const lines = (text: string): string[] =>
      text
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() && !/^\s*#/.test(line) && !/^[A-Za-z_]\w*\s*=\s*None$/.test(line))
        .sort();
    expect(lines(generate(result.state))).toEqual(lines(original));
  });
});

describe('外来代码', () => {
  const foreign = [
    'SBOX = [0x63, 0x7c, 0x77, 0x7b]',
    '',
    'def sub_byte(value):',
    '    return SBOX[value]',
    '',
    'def aes_round(state, key):',
    '    out = []',
    '    for i in range(4):',
    '        out.append(sub_byte(state[i] ^ key[i]))',
    '    return out',
  ].join('\n');

  it('识别到函数却拼不出块时，明确拒绝并且不产出工作区', () => {
    const result = reverseCode(foreign, payload);
    expect(result.state.blocks.blocks).toEqual([]);
    expect(result.state.diagnostics).toEqual([{ text: '', reason: 'foreign-code' }]);
    expect(result.stats.foreignDefs).toEqual(['sub_byte', 'aes_round']);
    expect(result.stats.procedures).toBe(0);
  });

  it('外来代码不会被误判成 procedural 长名单而静默产出碎块', () => {
    const result = reverseCode(foreign, payload);
    const blocks = JSON.stringify(result.state.blocks);
    expect(blocks).not.toContain('procedures_defreturn');
  });
});

describe('parseClosureNames', () => {
  it('接受字符串数组', () => {
    expect(parseClosureNames('{"closures":["a","b"]}')).toEqual(['a', 'b']);
  });

  it('结构不对时抛错（半份名单会把内嵌实现认成用户函数）', () => {
    expect(() => parseClosureNames('{"closures":"aes_sbox"}')).toThrow();
    expect(() => parseClosureNames('{"names":[]}')).toThrow();
  });
});
