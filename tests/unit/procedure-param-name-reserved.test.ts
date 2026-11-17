// @vitest-environment jsdom
/**
 * 函数封装参数名：保留字 / 非标识符必须与体内引用同名（签名侧回归）
 *
 * 曾经的缺陷：签名直接抄工作区变量名，体内 `variables_get` 却走 NameDB，于是
 * `param = in` 生成
 *
 *     def f(in: bytes):     # 语法错
 *         return in2        # 体内引用被改过名
 *
 * 本文件钉住三件事：
 *   1. 保留字（`in` / `class`）与 Python 内建名（`bytes`）在两种语言的签名里都走
 *      NameDB（`in2` / `class2` / `bytes2`），且与体内引用逐字相同；
 *   2. 非法标识符（`my param`）同样被合法化（`my_param`），不会留下空格；
 *   3. 模板块（`crypto_hash_func`）的纯文本 PARAM_NAME 走同一条规则。
 *
 * 生成结果除了文本断言，还真的执行：Python 用 python3 调一次、JavaScript 用
 * `new Function` 调一次——签名与引用不一致时两边都会直接抛错。
 */

import { execFileSync } from 'node:child_process';
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import '@/blocks/procedure/blocks';
import '@/generators/python/procedure/blocks';
import '@/generators/javascript/procedure/blocks';
import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';

const require = createRequire(resolve(process.cwd(), 'package.json'));
setLocale(require('blockly/msg/en'));

const pythonCommand = process.env.CIPHER_CAT_PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

interface Built {
  workspace: Blockly.Workspace;
  python: string;
  javascript: string;
}

/** 建一个 `procedures_defreturn`：参数接成 `return 参数`，两种语言各出一份代码。 */
function buildProcedure(paramName: string, paramId = ''): Built {
  const workspace = new Blockly.Workspace();
  const def = workspace.newBlock('procedures_defreturn');
  def.setFieldValue('f', 'NAME');
  def.loadExtraState!({ params: [{ name: paramName, id: paramId, type: 'bytes' }] });
  const variable = workspace.getVariableMap().getVariable(paramName, '')!;
  const getter = workspace.newBlock('variables_get');
  getter.setFieldValue(variable.getId(), 'VAR');
  def.getInput('RETURN')!.connection!.connect(getter.outputConnection!);
  const python = pythonGenerator.workspaceToCode(workspace);
  const javascript = javascriptGenerator.workspaceToCode(workspace);
  return { workspace, python, javascript };
}

function runPython(code: string): string {
  return execFileSync(pythonCommand, ['-c', `${code}\nprint(f(b"ab").hex())`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runJavaScript(code: string): string {
  const result = new Function(`${code}\nreturn f(new Uint8Array([97, 98]));`)() as Uint8Array;
  return Buffer.from(result).toString('hex');
}

describe('procedure parameter names go through NameDB', () => {
  it.each([
    ['in', 'in2'],
    ['class', 'class2'],
  ])('保留字 %s 在两种语言的签名里写成 %s，且与体内引用同名', (raw, legal) => {
    const { workspace, python, javascript } = buildProcedure(raw);
    try {
      expect(python).toContain(`def f(${legal}: bytes)`);
      expect(python).toMatch(new RegExp(`return ${legal}\\b`));
      expect(python).not.toMatch(new RegExp(`def f\\(${raw}:`));
      expect(javascript).toContain(`function f(${legal})`);
      expect(javascript).toMatch(new RegExp(`return ${legal};`));
      // 真跑：签名与引用不一致时这里直接抛 SyntaxError / ReferenceError
      expect(runPython(python)).toBe('6162');
      expect(runJavaScript(javascript)).toBe('6162');
    } finally {
      workspace.dispose();
    }
  });

  it('Python 内建名 bytes 在 Python 侧写成 bytes2；JS 侧本来就合法，保持 bytes', () => {
    // 保留字表是逐语言的：Blockly 的 Python NameDB 把内建名也算保留字，JS 侧 bytes 是合法标识符。
    const { workspace, python, javascript } = buildProcedure('bytes');
    try {
      expect(python).toContain('def f(bytes2: bytes)');
      expect(python).toMatch(/return bytes2\b/);
      expect(javascript).toContain('function f(bytes)');
      expect(javascript).toMatch(/return bytes;/);
      expect(runPython(python)).toBe('6162');
      expect(runJavaScript(javascript)).toBe('6162');
    } finally {
      workspace.dispose();
    }
  });

  it('非法标识符 `my param` 被合法化成 my_param（签名与引用同名）', () => {
    const { workspace, python, javascript } = buildProcedure('my param');
    try {
      expect(python).toContain('def f(my_param: bytes)');
      expect(python).toMatch(/return my_param\b/);
      expect(javascript).toContain('function f(my_param)');
      expect(runPython(python)).toBe('6162');
      expect(runJavaScript(javascript)).toBe('6162');
    } finally {
      workspace.dispose();
    }
  });

  it('已经是合法名字（key）不改造，出码逐字保留', () => {
    const { workspace, python } = buildProcedure('key');
    try {
      expect(python).toContain('def f(key: bytes)');
      expect(python).toMatch(/return key\b/);
    } finally {
      workspace.dispose();
    }
  });

  it('模板块（crypto_hash_func）的文本参数名同样走 NameDB', () => {
    const workspace = new Blockly.Workspace();
    try {
      const variable = workspace.getVariableMap().createVariable('in');
      const template = workspace.newBlock('crypto_hash_func');
      template.setFieldValue('in', 'PARAM_NAME');
      const getter = workspace.newBlock('variables_get');
      getter.setFieldValue(variable.getId(), 'VAR');
      template.getInput('RETURN')!.connection!.connect(getter.outputConnection!);
      const python = pythonGenerator.workspaceToCode(workspace);
      const javascript = javascriptGenerator.workspaceToCode(workspace);
      expect(python).toContain('def crypto_hash_func(in2: bytes)');
      expect(python).toMatch(/return in2\b/);
      expect(javascript).toContain('function crypto_hash_func(in2)');
      expect(javascript).toMatch(/return in2;/);
    } finally {
      workspace.dispose();
    }
  });
});
