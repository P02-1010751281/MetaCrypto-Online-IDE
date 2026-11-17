// @vitest-environment jsdom
/**
 * `sponge_pad` 的组合取值回归：RATE=1344（rate_bytes=168）× SUFFIX=0x1F。
 *
 * 这一对取值是平台自己会生成的形态，但两个下拉同时离开默认值时，采集器原本没有对应模板
 * （单字段变体只覆盖「其余字段取默认值」），反解析整条语句判不出、连带 54 条诊断
 * （RESULTS §36）。这里把那一对钉住：
 *   1. 生成器必须仍吐出 `rate_bytes=168, suffix=0x1F`——否则说明复现前提变了；
 *   2. 反解析必须零诊断、块数 > 0，且再生成后代码块逐块相等。
 *
 * 真实浏览器里的同一路径由 `experiments/ai-helper-2026-11-14/c2w-combo-fixed-e2e.mjs` 走；
 * 它读的输入就是本用例改出来的那段代码，设 `AI_HELPER_FIXTURE_WRITE=1` 时本用例顺带重写它。
 */

import { readFileSync, writeFileSync } from 'node:fs';
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
const DEMO = 'demos/procedures/ML-KEM-Encaps.json';
const FIXTURE = 'experiments/ai-helper-2026-11-14/out/c2w-mutated-mlkem.py';

/** 代码块：一个 def（含体）或一条顶层语句；顺序不是证据，排序后比较。 */
function chunks(code: string): string[] {
  return code
    .split('\n')
    .filter((line) => !/^[A-Za-z_]\w*\s*=\s*None\s*$/.test(line))
    .filter((line) => line.trim() !== '')
    .reduce<string[]>((out, line) => {
      const index = !/^\s/.test(line) && out.length ? out.length - 1 : -1;
      if (index >= 0) out[index] = `${out[index]}\n${line}`;
      else out.push(line);
      return out;
    }, [])
    .map((chunk) => chunk.trim())
    .sort();
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

describe('sponge_pad 组合取值（RATE=1344 × SUFFIX=0x1F）', () => {
  it('生成器吐出该组合，反解析零诊断且再生成逐块相等', () => {
    const raw = JSON.parse(readFileSync(DEMO, 'utf8')) as Parameters<typeof Blockly.serialization.workspaces.load>[0];
    const workspace = new Blockly.Workspace();
    let source: string;
    try {
      Blockly.serialization.workspaces.load(raw, workspace);
      let pads = 0;
      for (const block of workspace.getAllBlocks(false)) {
        if (block.type !== 'sponge_pad') continue;
        block.setFieldValue('1344', 'RATE');
        block.setFieldValue('0x1F', 'SUFFIX');
        pads += 1;
      }
      expect(pads).toBeGreaterThan(0);
      source = pythonGenerator.workspaceToCode(workspace);
    } finally {
      workspace.dispose();
    }
    // 复现前提：这段代码里必须真的存在「rate 168 + suffix 0x1F」这一对。
    expect(source).toContain('rate_bytes=168, suffix=0x1F');
    if (process.env.AI_HELPER_FIXTURE_WRITE) writeFileSync(FIXTURE, source);

    const result = reverseCode(source, payload);
    expect(result.stats.diagnostics).toBe(0);
    expect(result.stats.procedures).toBe(1);

    const regenerated = generate(result.state);
    expect(JSON.stringify(chunks(regenerated))).toBe(JSON.stringify(chunks(source)));
  });
});
