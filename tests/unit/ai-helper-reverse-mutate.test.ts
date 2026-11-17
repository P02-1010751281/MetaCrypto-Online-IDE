// @vitest-environment jsdom
/**
 * 代码 → 工作区（B1b）字段变异回归：demo 里的字段取值只是「一种取值」，不是形态本身。
 *
 * 60 个 demo 往返全等（ai-helper-reverse-sweep）证明的是「demo 里那些字段值能还原」；
 * 用户真正会遇到的是同一批块、不同取值的工作区。这里把每个 demo 的字段按类型改掉，
 * 再走同一条链（生成 Python → 反解析 → 再生成），代码块必须逐块相等、诊断必须为 0。
 *
 * 变异面：
 *   - 下拉：除 `VAR` 外每个下拉字段一律换到下一个有效选项，四轮不同位移（RATE 这类
 *     有 5 档的字段能取遍全部选项）；
 *   - 文本：`data_value.NUM` 与各文本字段换成数字/十六进制/单词等不同形态；
 *   - 数字：`math_number.NUM` 换成 0 / 7 / 255 / 1234。
 *
 * 这条用例抓到过真缺陷（RESULTS §36）：两个可见下拉**同时**取非默认值时，采集器原本只有
 * 「单字段翻值、其余取默认」的模板，`sponge_pad` 的 RATE=1344 × SUFFIX=0x1F 因此判不出，
 * ML-KEM-Encaps 整条语句连带炸出 54 条诊断。修法是采集器补组合探测（combos）。
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

/** 代码块：一个 def（含体）或一条顶层语句；顺序不是证据，排序后比较。 */
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

const TEXT_POOL = ['7', '0x1f', '1011', 'abc'];
const NUMBER_POOL = ['0', '7', '255', '1234'];

type Mutation = (workspace: Blockly.Workspace, shift: number) => number;

const MUTATIONS: Record<'dropdown' | 'text' | 'number', Mutation> = {
  dropdown: (workspace, shift) => {
    let changed = 0;
    for (const block of workspace.getAllBlocks(false)) {
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          if (!(field instanceof Blockly.FieldDropdown) || field.name === 'VAR') continue;
          const options = field.getOptions(false) as unknown[];
          if (options.length < 2) continue;
          const values = options.map((option) => (Array.isArray(option) ? String((option as string[])[1]) : String(option)));
          const current = values.indexOf(String(field.getValue()));
          const next = values[(((current < 0 ? 0 : current) + shift) % values.length + values.length) % values.length];
          try {
            field.setValue(next);
            changed += 1;
          } catch {
            // 带 onchange 校验的下拉拒绝该取值：跳过，不影响其余字段。
          }
        }
      }
    }
    return changed;
  },
  text: (workspace, shift) => {
    let changed = 0;
    for (const block of workspace.getAllBlocks(false)) {
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          if (!(field instanceof Blockly.FieldTextInput) || field.name === 'NAME') continue;
          const value = TEXT_POOL[(shift + changed) % TEXT_POOL.length];
          try {
            field.setValue(value);
            if (String(field.getValue()) === value) changed += 1;
          } catch {
            // 字段校验拒绝该取值：跳过（该字段不参与本轮变异）。
          }
        }
      }
    }
    return changed;
  },
  number: (workspace, shift) => {
    let changed = 0;
    for (const block of workspace.getAllBlocks(false)) {
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          if (!(field instanceof Blockly.FieldNumber)) continue;
          try {
            field.setValue(NUMBER_POOL[(shift + changed) % NUMBER_POOL.length]);
            changed += 1;
          } catch {
            // 数字范围校验拒绝该取值：跳过。
          }
        }
      }
    }
    return changed;
  },
};

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

/** 变异 → 生成 → 反解析 → 再生成；返回失败说明（空数组即通过）。 */
function roundTrip(raw: unknown, mutate: Mutation, shift: number): { changed: number; failures: string[] } {
  const workspace = new Blockly.Workspace();
  let original: string;
  let changed: number;
  try {
    Blockly.serialization.workspaces.load(raw as Parameters<typeof Blockly.serialization.workspaces.load>[0], workspace);
    changed = mutate(workspace, shift);
    if (!changed) return { changed: 0, failures: [] };
    original = pythonGenerator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
  const result = reverseCode(original, payload);
  if (result.stats.diagnostics > 0) {
    return { changed, failures: [`diag=${result.stats.diagnostics} ${String(result.state.diagnostics[0]?.reason ?? '')}`] };
  }
  let regenerated: string;
  try {
    regenerated = generate(result.state);
  } catch (error) {
    return { changed, failures: [`LOAD ${(error as Error).message}`] };
  }
  if (JSON.stringify(chunks(original)) !== JSON.stringify(chunks(regenerated))) {
    return { changed, failures: ['DIFF'] };
  }
  return { changed, failures: [] };
}

describe('反解析字段变异回归（60 个 demo）', () => {
  it('下拉四轮 / 文本 / 数字变异后往返全等且零诊断', () => {
    const files = workspaceFiles();
    expect(files).toHaveLength(60);
    const failures: string[] = [];
    let dropdownRuns = 0;
    let textRuns = 0;
    let numberRuns = 0;

    for (const file of files) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      // RATE 这类有 5 档的字段要取遍全部选项，四轮位移足够覆盖当前最大选项数。
      for (const shift of [1, 2, 3, 4]) {
        const outcome = roundTrip(raw, MUTATIONS.dropdown, shift);
        if (!outcome.changed) continue;
        dropdownRuns += 1;
        for (const failure of outcome.failures) failures.push(`${file}: dropdown/${shift} ${failure}`);
      }
      const textOutcome = roundTrip(raw, MUTATIONS.text, 0);
      if (textOutcome.changed) {
        textRuns += 1;
        for (const failure of textOutcome.failures) failures.push(`${file}: text ${failure}`);
      }
      const numberOutcome = roundTrip(raw, MUTATIONS.number, 0);
      if (numberOutcome.changed) {
        numberRuns += 1;
        for (const failure of numberOutcome.failures) failures.push(`${file}: number ${failure}`);
      }
    }

    expect(failures).toEqual([]);
    // 覆盖量钉子：demo 或块定义变动导致变异面缩水时直接红。
    expect({ dropdownRuns, textRuns, numberRuns }).toEqual({ dropdownRuns: 76, textRuns: 35, numberRuns: 2 });
  });
});
