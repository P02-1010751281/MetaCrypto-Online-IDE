// @vitest-environment jsdom
/**
 * 输入语言判别 + JS 形态短路（`reverse/language.ts`、`reverse/code-to-workspace.ts`）。
 *
 * 判据来自实测（RESULTS §34）：同一批 60 个 demo 的 **JavaScript** 形态喂给反解析器，
 * 0/60 能还原，而且只剩一条 `}` 诊断——用户看不出是「形态不支持」还是「代码写错了」。
 * 所以这里钉两件事：
 *   1. 生成器的 JS 痕迹能被识别，且不误判 Python；
 *   2. 判成 JS 时明确短路：零块、恰好一条 `unsupported` 诊断、不产生逐行噪音。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';
import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';
import { describe, expect, it } from 'vitest';

import '@/blocks';
import '@/generators/javascript';
import '@/generators/python';
import { detectInputLanguage, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);

type Generator = { workspaceToCode: (workspace: Blockly.Workspace) => string };

/** 拿真 demo 走一遍生成器：判别的对象必须是生成器的真实产物，不是手写样本。 */
function generate(file: string, generator: Generator): string {
  const json = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(json, workspace);
    return generator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

describe('输入语言判别', () => {
  it('生成器产出的 Python 判成 python', () => {
    const code = generate('demos/AES-Atomic-Round.json', pythonGenerator);
    expect(code).toContain('def ');
    expect(detectInputLanguage(code)).toBe('python');
  });

  it('同一个 demo 的 JavaScript 产物判成 javascript', () => {
    const code = generate('demos/AES-Atomic-Round.json', javascriptGenerator);
    expect(code).toMatch(/function\s+\w+\s*\(/);
    expect(detectInputLanguage(code)).toBe('javascript');
  });

  it('procedure demo 的 JS 形态（JSDoc 题头 + function）也判成 javascript', () => {
    const code = generate('demos/procedures/AES-Round.json', javascriptGenerator);
    expect(code).toContain('Crypto function:');
    expect(detectInputLanguage(code)).toBe('javascript');
  });

  it('手写 JS 函数（无生成器题头）同样判成 javascript', () => {
    expect(detectInputLanguage('function add(a, b) {\n  return a + b;\n}\n')).toBe('javascript');
  });

  it('Python 片段不误判：没有 def 的短语句、以及以 var 命名的变量', () => {
    expect(detectInputLanguage('some_unknown_call(a, b)\n')).toBe('python');
    expect(detectInputLanguage('var = 1\nprint(var)\n')).toBe('python');
    expect(detectInputLanguage('x = bytes([0x00, 0x11])\n')).toBe('python');
  });
});

describe('JS 形态：明确短路，不做逐行匹配', () => {
  it('零块 + 恰好一条 unsupported 诊断，stats 不虚报', () => {
    const js = generate('demos/procedures/AES-Round.json', javascriptGenerator);
    const result = reverseCode(js, payload);
    expect(result.language).toBe('javascript');
    expect(result.state.blocks.blocks).toEqual([]);
    expect(result.state.variables).toEqual([]);
    expect(result.state.diagnostics).toEqual([{ text: '', reason: 'unsupported' }]);
    expect(result.stats).toMatchObject({ procedures: 0, topLevel: 0, diagnostics: 1 });
  });

  it('同一 demo 的 Python 形态仍走正常路径（判别不改变原有行为）', () => {
    const py = generate('demos/procedures/AES-Round.json', pythonGenerator);
    const result = reverseCode(py, payload);
    expect(result.language).toBe('python');
    expect(result.stats.procedures).toBe(1);
    expect(result.state.diagnostics).toEqual([]);
  });

  it('显式 `language` 选项优先于自动判别（给上层留强制入口）', () => {
    const result = reverseCode('aes_sub_bytes(state)\n', payload, { language: 'javascript' });
    expect(result.language).toBe('javascript');
    expect(result.state.blocks.blocks).toEqual([]);
  });
});
