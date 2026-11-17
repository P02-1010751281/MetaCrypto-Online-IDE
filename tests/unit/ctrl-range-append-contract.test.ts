// @vitest-environment jsdom
/**
 * `ctrl_range` / `arr_append` 契约回归。
 *
 * 钉住四件事：
 *   1. 两个块的双语言生成逐字形态（含空循环体的 `pass` / 注释补位）；
 *   2. `ctrl_range` 的 FROM/TO 是**值输入**：接变量时生成 `range(n, m)`，不是常量；
 *      并且逐字对齐 Python `range(FROM, TO)` 的半开区间语义（FROM ≥ TO 一次也不执行）；
 *   3. `arr_append` 是语句块（无输出、有 previous/next），生成的 `append`/`push` 真正原地修改列表；
 *   4. `docs/blocks/BLOCK-IO-CONTRACT.json` 里存在这两个键及其端口签名（契约由 `npm run block-io:write` 生成）。
 */
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import 'blockly/blocks';
import * as enMessages from 'blockly/msg/en';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import '@/blocks/array/append';
import '@/blocks/ctrl/range';
import '@/blocks/data/number';
import '@/generators/javascript';
import '@/generators/python';
import { TYPE_INT_LIST } from '@/constants/block-types';
import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';

/** 循环体：把当前循环变量写进预置的 `result` 列表，用于双语言执行对拍。 */
Blockly.Blocks['test_range_collect'] = {
  init: function () {
    this.appendDummyInput().appendField(new Blockly.FieldTextInput('i'), 'EXPR');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};
javascriptGenerator.forBlock['test_range_collect'] = (block) =>
  `result.push(${block.getFieldValue('EXPR') || 'i'});\n`;
pythonGenerator.forBlock['test_range_collect'] = (block) =>
  `result.append(${block.getFieldValue('EXPR') || 'i'})\n`;

/** 列表表达式来源：测试用固定标识符，避免依赖原生列表块的标签形态。 */
Blockly.Blocks['test_list_ref'] = {
  init: function () {
    this.appendDummyInput().appendField(new Blockly.FieldTextInput('items'), 'EXPR');
    this.setOutput(true, TYPE_INT_LIST);
  },
};
javascriptGenerator.forBlock['test_list_ref'] = (block) => [block.getFieldValue('EXPR') || 'items', 0];
pythonGenerator.forBlock['test_list_ref'] = (block) => [block.getFieldValue('EXPR') || 'items', 0];

/**
 * 循环体：记录当前下标后把端点变量 +1。
 *
 * 用来验证「端点只求值一次」：Python 的 `range(FROM, TO)` 进循环前求值一次，JS 的 `for`
 * 条件每轮重算——修复前这条用例在 JS 侧会无限循环，所以 JS 生成里带一条 64 轮的守卫，
 * 让回归变成「异常」而不是「挂死」。
 */
Blockly.Blocks['test_range_bump'] = {
  init: function () {
    this.appendDummyInput().appendField(new Blockly.FieldTextInput('m'), 'EXPR');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};
javascriptGenerator.forBlock['test_range_bump'] = (block) => {
  const name = block.getFieldValue('EXPR') || 'm';
  return `result.push(i);\n${name} = ${name} + 1;\n`
    + 'if (result.length > 64) throw new Error("loop bound re-evaluated");\n';
};
pythonGenerator.forBlock['test_range_bump'] = (block) => {
  const name = block.getFieldValue('EXPR') || 'm';
  return `result.append(i)\n${name} = ${name} + 1\n`;
};

// headless 环境必须显式灌入官方英文消息：v13 的 msg/*.mjs 只导出常量，不会自动设置 Msg，
// 缺了它 variables_get 的变量下拉会在建块时抛错（与 aes-cavp 单测同一处理）。
setLocale(enMessages as unknown as Record<string, string>);

const pythonCommand = process.env.CIPHER_CAT_PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

type Language = 'javascript' | 'python';

function generatorOf(language: Language) {
  return language === 'javascript' ? javascriptGenerator : pythonGenerator;
}

/** 在给定块上接一个数字值输入（`data_value`，Number 输出）。 */
function connectNumber(workspace: Blockly.Workspace, block: Blockly.Block, input: string, num: string): void {
  const value = workspace.newBlock('data_value');
  value.setFieldValue(num, 'NUM');
  block.getInput(input)!.connection!.connect(value.outputConnection!);
}

/** 接一个变量引用（`variables_get`）。变量须先在同一个工作区创建。 */
function connectVariable(
  workspace: Blockly.Workspace,
  block: Blockly.Block,
  input: string,
  variableId: string,
): void {
  const getter = workspace.newBlock('variables_get');
  getter.setFieldValue(variableId, 'VAR');
  block.getInput(input)!.connection!.connect(getter.outputConnection!);
}

interface RangeOptions {
  from?: string;
  to?: string;
  /** 用 variables_get 代替数字值；值为 worker 里预置的变量名。 */
  useVariables?: boolean;
  /** 是否接一个循环体：`collect` 只记录下标，`bump` 记录后把端点变量 +1。 */
  body?: boolean;
  bodyBlock?: 'collect' | 'bump';
  variable?: string;
}

function buildRange(language: Language, options: RangeOptions = {}): { workspace: Blockly.Workspace; code: string } {
  const workspace = new Blockly.Workspace();
  const loop = workspace.newBlock('ctrl_range');
  loop.setFieldValue(options.variable ?? 'i', 'VAR');
  const from = options.from ?? '0';
  const to = options.to ?? '5';
  if (options.useVariables) {
    const fromId = workspace.getVariableMap().createVariable(from).getId();
    const toId = workspace.getVariableMap().createVariable(to).getId();
    connectVariable(workspace, loop, 'FROM', fromId);
    connectVariable(workspace, loop, 'TO', toId);
  } else {
    connectNumber(workspace, loop, 'FROM', from);
    connectNumber(workspace, loop, 'TO', to);
  }
  if (options.body) {
    const bump = options.bodyBlock === 'bump';
    const body = workspace.newBlock(bump ? 'test_range_bump' : 'test_range_collect');
    body.setFieldValue(bump ? (options.to ?? 'm') : (options.variable ?? 'i'), 'EXPR');
    loop.getInput('DO')!.connection!.connect(body.previousConnection!);
  }
  return { workspace, code: generatorOf(language).workspaceToCode(workspace) };
}

function generateRange(language: Language, options: RangeOptions = {}): string {
  const { workspace, code } = buildRange(language, options);
  workspace.dispose();
  return code;
}

function buildAppend(language: Language, listExpression = 'items', value = '7'): string {
  const workspace = new Blockly.Workspace();
  try {
    const append = workspace.newBlock('arr_append');
    const list = workspace.newBlock('test_list_ref');
    list.setFieldValue(listExpression, 'EXPR');
    append.getInput('LIST')!.connection!.connect(list.outputConnection!);
    connectNumber(workspace, append, 'VALUE', value);
    return generatorOf(language).workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

function runJavaScript(code: string, prelude: string, args: Record<string, number> = {}): unknown {
  const names = Object.keys(args);
  const values = names.map((name) => args[name]);
  return new Function(...names, `${prelude}\n${code}\nreturn result;`)(...values) as unknown;
}

/** Blockly 会给工作区变量生成 `n = None` 声明头；执行期按需去掉，避免覆盖注入值。 */
function stripPythonVariableDeclarations(code: string, names: string[]): string {
  return code.replace(new RegExp(`^(?:${names.join('|')}) = None\\n`, 'gm'), '');
}

function runPython(code: string, prelude: string): unknown {
  const output = execFileSync(pythonCommand, ['-c', [
    'import json',
    prelude,
    code,
    'print(json.dumps(result))',
  ].filter(Boolean).join('\n')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return JSON.parse(output) as unknown;
}

describe('ctrl_range 生成形态', () => {
  it('Python：空循环体补 pass，逐字等价 range(FROM, TO)', () => {
    expect(generateRange('python', { from: '0', to: '5' })).toBe('for i in range(0, 5):\n    pass\n');
  });

  it('JavaScript：空循环体补注释，FOR 头按 VAR < TO 递增', () => {
    expect(generateRange('javascript', { from: '0', to: '5' })).toBe(
      '// 范围循环（TO 独占）\nfor (let i = 0; i < 5; i++) {\n  // 空操作\n}\n',
    );
  });

  it('循环体语句按缩进嵌入两种语言', () => {
    // 缩进沿用 ctrl_iterate 的写法：statementToCode 自带 2 空格 + prefixLines 再 4 空格。
    expect(generateRange('python', { from: '1', to: '4', body: true })).toBe(
      'for i in range(1, 4):\n      result.append(i)\n',
    );
    expect(generateRange('javascript', { from: '1', to: '4', body: true })).toBe(
      '// 范围循环（TO 独占）\nfor (let i = 1; i < 4; i++) {\n  result.push(i);\n}\n',
    );
  });

  it('FROM/TO 是值输入，接变量时生成 range(n, m) 而不是常量', () => {
    // 两种语言都会在题头声明工作区变量（`n = None` / `var n, m;`），循环行本身按变量取码。
    const pyLines = generateRange('python', { from: 'n', to: 'm', useVariables: true }).trimEnd().split('\n');
    expect(pyLines).toContain('for i in range(n, m):');
    expect(pyLines.some((line) => line.includes('range(0'))).toBe(false);
    const jsLines = generateRange('javascript', { from: 'n', to: 'm', useVariables: true }).trimEnd().split('\n');
    // TO 非常量 → 先绑临时变量（Python 的 range 只求值一次终点，JS 的 for 条件每轮重算）。
    expect(jsLines).toContain('for (let i = n, __ctrl_range_to__ = m; i < __ctrl_range_to__; i++) {');
    expect(jsLines.some((line) => line.includes('i < 0'))).toBe(false);
  });

  it('常量终点不插临时变量（出码保持 `for (let i = 0; i < 5; i++)` 的可读形态）', () => {
    const jsCode = generateRange('javascript', { from: '0', to: '5' });
    expect(jsCode).toContain('for (let i = 0; i < 5; i++) {');
    expect(jsCode).not.toContain('__ctrl_range_to__');
  });

  it('FROM/TO/DO 的端口形状与 tooltip 契约', () => {
    const workspace = new Blockly.Workspace();
    try {
      const loop = workspace.newBlock('ctrl_range');
      expect(loop.getInput('FROM')!.type).toBe(Blockly.inputs.inputTypes.VALUE);
      expect(loop.getInput('TO')!.type).toBe(Blockly.inputs.inputTypes.VALUE);
      expect(loop.getInput('DO')!.type).toBe(Blockly.inputs.inputTypes.STATEMENT);
      expect(loop.getInput('FROM')!.connection!.getCheck()).toEqual(['Number']);
      expect(loop.getInput('TO')!.connection!.getCheck()).toEqual(['Number']);
      expect(loop.getField('VAR')!.getValue()).toBe('i');
      expect(loop.outputConnection).toBeNull();
      expect(loop.previousConnection).not.toBeNull();
      expect(loop.nextConnection).not.toBeNull();
      // tooltip 必须说明「TO 独占」以及「FROM ≥ TO 不执行」，这是与 controls_for 的分界。
      expect(loop.getTooltip()).toContain('exclusive');
      expect(loop.getTooltip()).toContain('never runs');
    } finally {
      workspace.dispose();
    }
  });
});

describe('ctrl_range 运行语义', () => {
  it('TO 独占、FROM ≥ TO 一次也不执行（双语言一致）', () => {
    const pyPrelude = 'result = []';
    const jsPrelude = 'let result = [];';
    expect(runPython(generateRange('python', { from: '1', to: '4', body: true }), pyPrelude)).toEqual([1, 2, 3]);
    expect(runJavaScript(generateRange('javascript', { from: '1', to: '4', body: true }), jsPrelude)).toEqual([1, 2, 3]);
    expect(runPython(generateRange('python', { from: '3', to: '3', body: true }), pyPrelude)).toEqual([]);
    expect(runJavaScript(generateRange('javascript', { from: '3', to: '3', body: true }), jsPrelude)).toEqual([]);
    expect(runPython(generateRange('python', { from: '9', to: '2', body: true }), pyPrelude)).toEqual([]);
    expect(runJavaScript(generateRange('javascript', { from: '9', to: '2', body: true }), jsPrelude)).toEqual([]);
  });

  it('接变量时按变量当前值循环', () => {
    const pyCode = stripPythonVariableDeclarations(
      generateRange('python', { from: 'n', to: 'm', useVariables: true, body: true }),
      ['n', 'm'],
    );
    expect(runPython(pyCode, 'n = 2\nm = 5\nresult = []')).toEqual([2, 3, 4]);
    // JS 侧的 `var n, m;` 与函数参数同名，不重置取值，可直接按参数注入。
    const jsCode = generateRange('javascript', { from: 'n', to: 'm', useVariables: true, body: true });
    expect(runJavaScript(jsCode, 'let result = [];', { n: 2, m: 5 })).toEqual([2, 3, 4]);
  });

  it('循环体修改终点变量时两种语言跑同样次数（终点只求值一次）', () => {
    // 原文形如 `for i in range(0, m): m = m + 1`：Python 进循环前就把 m 定格，跑 m0 次。
    // 修复前 JS 的 `for` 条件每轮重算 m，会一直追着自己的尾巴跑（守卫生效时抛异常）。
    const pyCode = stripPythonVariableDeclarations(
      generateRange('python', { from: 'n', to: 'm', useVariables: true, body: true, bodyBlock: 'bump' }),
      ['n', 'm'],
    );
    expect(runPython(pyCode, 'n = 0\nm = 3\nresult = []')).toEqual([0, 1, 2]);
    const jsCode = generateRange('javascript', {
      from: 'n', to: 'm', useVariables: true, body: true, bodyBlock: 'bump',
    });
    expect(runJavaScript(jsCode, 'let result = [];', { n: 0, m: 3 })).toEqual([0, 1, 2]);
  });
});

describe('arr_append 生成形态与语义', () => {
  it('Python 生成 LIST.append(VALUE)', () => {
    expect(buildAppend('python')).toBe('items.append(7)\n');
  });

  it('JavaScript 生成 LIST.push(VALUE);', () => {
    expect(buildAppend('javascript')).toBe('items.push(7);\n');
  });

  it('是语句块：无输出连接、有 previous/next；工具提示写明原地修改', () => {
    const workspace = new Blockly.Workspace();
    try {
      const append = workspace.newBlock('arr_append');
      expect(append.outputConnection).toBeNull();
      expect(append.previousConnection).not.toBeNull();
      expect(append.nextConnection).not.toBeNull();
      expect(append.getInput('LIST')!.connection!.getCheck()).toEqual([TYPE_INT_LIST]);
      expect(append.getInput('VALUE')!.connection!.getCheck()).toEqual(['Number']);
      expect(append.getTooltip()).toContain('mutat');
      expect(append.getTooltip()).toContain('temporary literal');
      // 值槽位用 Number 而不是 null 的取舍要两面都钉住：未标注类型的变量引用按通配放行，
      // 明确输出 IntList 的容器块被拒绝（否则会把一个列表当成元素追加）。
      const itemsVariable = workspace.getVariableMap().createVariable('items');
      const getter = workspace.newBlock('variables_get');
      getter.setFieldValue(itemsVariable.getId(), 'VAR');
      expect(workspace.connectionChecker.canConnect(
        getter.outputConnection!,
        append.getInput('VALUE')!.connection!,
        false,
      )).toBe(true);
      const listContainer = workspace.newBlock('test_list_ref');
      expect(workspace.connectionChecker.canConnect(
        listContainer.outputConnection!,
        append.getInput('VALUE')!.connection!,
        false,
      )).toBe(false);
    } finally {
      workspace.dispose();
    }
  });

  it('追加是原地修改：双语言执行后列表都多出同一元素', () => {
    const pyCode = buildAppend('python');
    expect(runPython(pyCode, 'items = [1, 2]\nresult = items')).toEqual([1, 2, 7]);
    const jsCode = buildAppend('javascript');
    expect(runJavaScript(jsCode, 'const items = [1, 2];\nlet result = items;')).toEqual([1, 2, 7]);
  });
});

describe('BLOCK-IO-CONTRACT.json', () => {
  const contract = JSON.parse(
    readFileSync(resolve(process.cwd(), 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'),
  ) as Record<string, {
    inputs: Array<{ name: string; type: number; check: string[] | null }>;
    fields: Array<{ name: string }>;
    outputCheck: string[] | null;
  }>;

  it('两个新键都在契约里', () => {
    expect(Object.keys(contract)).toContain('ctrl_range');
    expect(Object.keys(contract)).toContain('arr_append');
  });

  it('ctrl_range 的 FROM/TO 是值输入（type=1）、DO 是语句输入（type=3）', () => {
    const entry = contract.ctrl_range;
    const byName = new Map(entry.inputs.map((input) => [input.name, input]));
    expect(byName.get('FROM')).toEqual({ name: 'FROM', type: 1, check: ['Number'] });
    expect(byName.get('TO')).toEqual({ name: 'TO', type: 1, check: ['Number'] });
    expect(byName.get('DO')).toEqual({ name: 'DO', type: 3, check: null });
    expect(entry.fields.map((field) => field.name)).toContain('VAR');
    expect(entry.outputCheck).toBeNull();
  });

  it('arr_append 是语句块：LIST 检查 IntList、VALUE 检查 Number、无输出', () => {
    const entry = contract.arr_append;
    const byName = new Map(entry.inputs.map((input) => [input.name, input]));
    expect(byName.get('LIST')).toEqual({ name: 'LIST', type: 1, check: ['IntList'] });
    expect(byName.get('VALUE')).toEqual({ name: 'VALUE', type: 1, check: ['Number'] });
    expect(entry.outputCheck).toBeNull();
  });
});
