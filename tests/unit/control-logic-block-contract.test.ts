// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import '@/blocks/ctrl/iterate';
import '@/blocks/data/number';
import '@/blocks/logic/compound';
import '@/blocks/logic/not';
import '@/blocks/logic/operation';
import '@/generators/javascript';
import '@/generators/javascript/ctrl/iterate';
import '@/generators/javascript/logic/operation';
import '@/generators/python';
import '@/generators/python/ctrl/iterate';
import '@/generators/python/logic/operation';
import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';

const pythonCommand = process.env.CIPHER_CAT_PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

Blockly.Blocks['test_loop_collect'] = {
  init() {
    this.appendDummyInput().appendField('collect loop index');
    this.setPreviousStatement(true);
  },
};
javascriptGenerator.forBlock['test_loop_collect'] = () => 'observed.push(i);\n';
pythonGenerator.forBlock['test_loop_collect'] = () => 'observed.append(i)\n';

/**
 * 次数来源：输出一个裸标识符（测试用），避免依赖 variables_get 的变量下拉——那一套在
 * headless 下需要先灌 locale 消息，本文件其余用例并不需要。
 */
Blockly.Blocks['test_number_ref'] = {
  init() {
    this.appendDummyInput().appendField(new Blockly.FieldTextInput('times'), 'EXPR');
    this.setOutput(true, 'Number');
  },
};
javascriptGenerator.forBlock['test_number_ref'] = (block) =>
  [block.getFieldValue('EXPR') || 'times', 0];
pythonGenerator.forBlock['test_number_ref'] = (block) =>
  [block.getFieldValue('EXPR') || 'times', 0];

/**
 * 循环体：记录下标后把次数变量 +1。
 *
 * 验证「次数只求值一次」：Python 的 `range(TIMES)` 进循环前定格，JS 的 `for` 条件每轮
 * 重算——修复前这条用例在 JS 侧会无限循环，所以生成里带一条 64 轮守卫，让回归抛异常
 * 而不是挂死。
 */
Blockly.Blocks['test_loop_bump'] = {
  init() {
    this.appendDummyInput().appendField('collect and bump the bound');
    this.setPreviousStatement(true);
  },
};
javascriptGenerator.forBlock['test_loop_bump'] = () =>
  'observed.push(i);\ntimes = times + 1;\nif (observed.length > 64) throw new Error("loop bound re-evaluated");\n';
pythonGenerator.forBlock['test_loop_bump'] = () => 'observed.append(i)\ntimes = times + 1\n';

function generateLoop(language: 'javascript' | 'python', times: number): string {
  const workspace = new Blockly.Workspace();
  try {
    const loop = workspace.newBlock('ctrl_iterate');
    loop.setFieldValue('i', 'VAR');
    // TIMES 是值输入（可接变量/表达式），次数用 math_number 接进去。
    const timesBlock = workspace.newBlock('math_number');
    timesBlock.setFieldValue(String(times), 'NUM');
    loop.getInput('TIMES')!.connection!.connect(timesBlock.outputConnection!);

    const collect = workspace.newBlock('test_loop_collect');
    loop.getInput('DO')!.connection!.connect(collect.previousConnection!);

    const generator = language === 'javascript' ? javascriptGenerator : pythonGenerator;
    return generator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

function generateOperation(
  language: 'javascript' | 'python',
  type: 'lgc_operation' | 'lgc_compound' | 'lgc_not',
  operation: string,
  a: string,
  b = '0',
): string {
  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock(type);
    if (type !== 'lgc_not') block.setFieldValue(operation, 'instr');
    for (const [name, expression] of Object.entries({ A: a, B: b, C: 'result', VALUE1: a, VALUE2: 'result' })) {
      if (!block.getInput(name)) continue;
      const value = workspace.newBlock('data_value');
      value.setFieldValue(expression, 'NUM');
      block.getInput(name)!.connection!.connect(value.outputConnection!);
    }
    const generator = language === 'javascript' ? javascriptGenerator : pythonGenerator;
    return generator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

function runJavaScript(program: string, resultName = 'result'): number {
  return new Function(`${program}\nreturn ${resultName};`)() as number;
}

function runPython(program: string): number {
  return Number(execFileSync(pythonCommand, ['-c', `${program}\nprint(result)`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim());
}

function runJavaScriptLoop(program: string): number[] {
  const observed: number[] = [];
  new Function('observed', program)(observed);
  return observed;
}

function runPythonLoop(program: string): number[] {
  const output = execFileSync(pythonCommand, ['-c', [
    'import json',
    'observed = []',
    program,
    'print(json.dumps(observed))',
  ].join('\n')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(output) as number[];
}

/** 用变量当次数（`range(times)` / `i < times`），循环体再把 `times` 加一。 */
function generateVariableLoop(language: 'javascript' | 'python'): string {
  const workspace = new Blockly.Workspace();
  try {
    const loop = workspace.newBlock('ctrl_iterate');
    loop.setFieldValue('i', 'VAR');
    const timesBlock = workspace.newBlock('test_number_ref');
    timesBlock.setFieldValue('times', 'EXPR');
    loop.getInput('TIMES')!.connection!.connect(timesBlock.outputConnection!);
    const body = workspace.newBlock('test_loop_bump');
    loop.getInput('DO')!.connection!.connect(body.previousConnection!);
    const generator = language === 'javascript' ? javascriptGenerator : pythonGenerator;
    return generator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

function runJavaScriptLoopBumped(times: number): number[] {
  const observed: number[] = [];
  new Function('observed', 'times', generateVariableLoop('javascript'))(observed, times);
  return observed;
}

function runPythonLoopBumped(times: number): number[] {
  const program = generateVariableLoop('python');
  const output = execFileSync(pythonCommand, ['-c', [
    'import json',
    'observed = []',
    `times = ${times}`,
    program,
    'print(json.dumps(observed))',
  ].join('\n')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(output) as number[];
}

describe('control-flow and 32-bit logic Blockly contracts', () => {
  it.each([1, 5])('executes exactly %i iterations in both languages', (times) => {
    const expected = Array.from({ length: times }, (_, index) => index);
    expect(runJavaScriptLoop(generateLoop('javascript', times))).toEqual(expected);
    expect(runPythonLoop(generateLoop('python', times))).toEqual(expected);
  });

  it('ctrl_iterate: 循环体修改次数变量时两种语言跑同样次数（次数只求值一次）', () => {
    // 原文形如 `for i in range(times): times = times + 1`：Python 进循环前定格，跑 times0 次。
    expect(runPythonLoopBumped(3)).toEqual([0, 1, 2]);
    expect(runJavaScriptLoopBumped(3)).toEqual([0, 1, 2]);
  });

  it.each([
    ['XOR', '0xa5a55a5a', '0x0f0ff0f0', 0xaaaa_aaaa],
    ['OR', '0xa5a55a5a', '0x0f0ff0f0', 0xafaf_fafa],
    ['AND', '0xa5a55a5a', '0x0f0ff0f0', 0x0505_5050],
  ])('matches unsigned 32-bit %s in both languages', (operation, a, b, expected) => {
    expect(runJavaScript(generateOperation('javascript', 'lgc_operation', operation, a, b))).toBe(expected);
    expect(runPython(generateOperation('python', 'lgc_operation', operation, a, b))).toBe(expected);
  });

  it.each([
    ['XOR_XOR', 0xa5a5_5a5a],
    ['OR_XOR', 0xa0a0_0a0a],
    ['AND_XOR', 0x0a0a_a0a0],
    ['XOR_OR', 0xafaf_fafa],
    ['OR_OR', 0xafaf_fafa],
    ['AND_OR', 0x0f0f_f0f0],
    ['XOR_AND', 0x0a0a_a0a0],
    ['OR_AND', 0x0f0f_f0f0],
    ['AND_AND', 0x0505_5050],
  ])('matches compound logic %s in both languages', (operation, expected) => {
    const a = '0xa5a55a5a';
    const b = '0x0f0ff0f0';
    expect(runJavaScript(generateOperation('javascript', 'lgc_compound', operation, a, b))).toBe(expected);
    expect(runPython(generateOperation('python', 'lgc_compound', operation, a, b))).toBe(expected);
  });

  it('complements values within the unsigned 32-bit domain in both languages', () => {
    for (const [input, expected] of [['0x80000000', 0x7fff_ffff], ['0', 0xffff_ffff]] as const) {
      expect(runJavaScript(generateOperation('javascript', 'lgc_not', '', input))).toBe(expected);
      expect(runPython(generateOperation('python', 'lgc_not', '', input))).toBe(expected);
    }
  });
});
