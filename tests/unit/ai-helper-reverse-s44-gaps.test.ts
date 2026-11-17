// @vitest-environment jsdom
/**
 * §44.6 四条缺口收口后的判据（S44 收口）：`range(a, b)` 与省略终点切片。
 *
 * 1. **两/三参数 `range(a, b)` → `ctrl_range`**：TO 是**独占**终点，与 Python 逐字对应；
 *    常量空区间（`range(5, 2)`）也精确（一次不执行），空区间/端点两条漂移诊断消失。步长不是 1 仍报 `RANGE_STEP`，参数越界仍报 `RANGE_ARITY`，
 *    一参数 `range(n)` 仍是 `ctrl_iterate`（不动）。
 * 2. **省略终点切片 `a[i:]` → `arr_slice` + `math_constrain(len(源) - i, 0, len(源))`**：
 *    `i < 0`、`0 <= i <= len`、`i > len` 三种情况都与 Python 一致，0 诊断；两参非常量切片
 *    `a[i:j]` 的长度是 `math_constrain(j - i, 0, len(源))`，但两端符号运行时才知道，出块 +
 *    `SLICE_DYNAMIC_SIGN` 语义漂移诊断（`a[-2:j]` 的差分把这条诊断钉住）。
 *
 * 两条路径（模板 `core/`、AST `ast/`）必须同形，且共用 `diagnostics.ts` 的同一句文案。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';
import { pythonGenerator } from 'blockly/python';
import { describe, expect, it } from 'vitest';

import '@/blocks';
import '@/generators/python';
import { buildMatchers, parseClosureNames, parseFieldPayload } from '@/services/ai-helper/reverse';
import type { ParsedNode, SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { buildPrimitiveIndex } from '@/services/ai-helper/reverse/primitive-calls';
import { parsePythonBody, parseValue } from '@/services/ai-helper/reverse/core-syntax';
import type { CoreContext } from '@/services/ai-helper/reverse/core-syntax';
import { RANGE_ARITY, RANGE_STEP, SLICE_DYNAMIC_SIGN } from '@/services/ai-helper/reverse/diagnostics';

setLocale(enMessages as unknown as Record<string, string>);

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'import ast'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);

function context(): CoreContext {
  return { matchers: buildMatchers(payload), procedures: new Map(), diagnostics: [] };
}

function shape(node: ParsedNode): string {
  const tags = Object.entries(node.fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',');
  const children = node.children.map((item) => `${item.input}:${shape(item.node)}`).join(' ');
  return `${node.type}${tags ? `(${tags})` : ''}${children ? `{${children}}` : ''}`;
}

function flatten(state: SerializedWorkspace): SerializedBlock[] {
  const out: SerializedBlock[] = [];
  const walk = (block: SerializedBlock): void => {
    out.push(block);
    for (const input of Object.values(block.inputs ?? {})) walk(input.block);
    if (block.next) walk(block.next.block);
  };
  state.blocks.blocks.forEach(walk);
  return out;
}

function astState(code: string): SerializedWorkspace {
  const raw = execFileSync('python3', ['-c', buildAstDumpScript(code)], { encoding: 'utf8' }).trim();
  const dump = readAstDump(raw);
  if (!dump.ok) throw new Error(dump.error.message);
  return irToWorkspace(astToIr(dump.module, code, buildPrimitiveIndex(payload)));
}

function regenerate(state: SerializedWorkspace): string {
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

/** 原文与再生成代码用同一组输入各跑一遍（差分执行）。 */
function runCalls(code: string, calls: Array<[string, unknown[]]>): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  const driver = [
    'import base64, json',
    `src = base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8')`,
    `calls = json.loads(${JSON.stringify(JSON.stringify(calls))})`,
    'ns = {}',
    "exec(compile(src, '<sample>', 'exec'), ns)",
    'print(json.dumps([ns[name](*args) for name, args in calls]))',
  ].join('\n');
  return execFileSync('python3', ['-c', driver], { encoding: 'utf8', timeout: 10000 }).trim();
}

describe('缺口 4：range(a, b) → ctrl_range（TO 独占，空区间精确）', () => {
  it('模板路径：两参数字面量落 ctrl_range，FROM=a / TO=b，不再减 1', () => {
    const parsed = parsePythonBody(['for i in range(2, 5):', '    x = i'], context());
    const loop = parsed.statements[0].node;
    expect(loop.type).toBe('ctrl_range');
    expect(loop.fields.VAR).toBe('i');
    expect(shape(loop)).toContain('FROM:data_value(NUM=2)');
    expect(shape(loop)).toContain('TO:data_value(NUM=5)');
  });

  it('模板路径：非常量端点同样是 ctrl_range，0 诊断', () => {
    const ctx = context();
    const loop = parsePythonBody(['for i in range(0, len(xs)):', '    x = i'], ctx).statements[0].node;
    expect(loop.type).toBe('ctrl_range');
    expect(shape(loop)).toContain('FROM:data_value(NUM=0)');
    expect(shape(loop)).toContain('TO:lists_length{VALUE:variables_get(VAR=xs)}');
    expect(ctx.diagnostics).toEqual([]);
  });

  it('模板路径：常量空区间 range(5, 2) 仍是 ctrl_range（生成代码一次也不执行）', () => {
    const ctx = context();
    const loop = parsePythonBody(['for i in range(5, 2):', '    x = i'], ctx).statements[0].node;
    expect(loop.type).toBe('ctrl_range');
    expect(ctx.diagnostics).toEqual([]);
  });

  it('三参数且步长为 1 同样落 ctrl_range（TO 独占）；两条路径一致', () => {
    const ctx = context();
    const loop = parsePythonBody(['for i in range(0, n, 1):', '    x = i'], ctx).statements[0].node;
    expect(loop.type).toBe('ctrl_range');
    expect(shape(loop)).toContain('TO:variables_get(VAR=n)');
    expect(ctx.diagnostics).toEqual([]);
    const ast = astState(['def f(n):', '    acc = 0', '    for i in range(0, n, 1):', '        acc = acc + i', '    return acc', ''].join('\n'));
    expect(ast.diagnostics).toEqual([]);
    expect(flatten(ast).some((block) => block.type === 'ctrl_range')).toBe(true);
  });

  it('一参数 range(n) 仍是 ctrl_iterate，不受影响', () => {
    const parsed = parsePythonBody(['for i in range(n):', '    x = i'], context());
    expect(parsed.statements[0].node.type).toBe('ctrl_iterate');
  });

  it('步长不是 1：两条路径都报同一条 RANGE_STEP', () => {
    const ctx = context();
    const template = parsePythonBody(['for i in range(0, 8, 2):', '    x = i'], ctx).statements[0].node;
    expect(template.type).toBe('UNRESOLVED');
    expect(template.blocked?.detail).toBe(RANGE_STEP);
    const ast = astState(['def f():', '    for i in range(0, 8, 2):', '        pass', '    return 1', ''].join('\n'));
    expect(ast.diagnostics).toHaveLength(1);
    expect(ast.diagnostics[0].detail).toBe(RANGE_STEP);
  });

  it('参数个数越界：两条路径都报同一条 RANGE_ARITY', () => {
    const ctx = context();
    const template = parsePythonBody(['for i in range(1, 2, 3, 4):', '    x = i'], ctx).statements[0].node;
    expect(template.blocked?.detail).toBe(RANGE_ARITY);
    const ast = astState(['def f():', '    for i in range(1, 2, 3, 4):', '        pass', '    return 1', ''].join('\n'));
    expect(ast.diagnostics[0].detail).toBe(RANGE_ARITY);
  });

  it('AST 路径：range(n, m) 落 ctrl_range，0 漂移诊断', () => {
    const state = astState(['def f(n, m):', '    acc = 0', '    for i in range(n, m):', '        acc = acc + i', '    return acc', ''].join('\n'));
    expect(state.diagnostics).toEqual([]);
    const loop = flatten(state).find((block) => block.type === 'ctrl_range');
    expect(loop?.fields?.VAR).toBe('i');
    expect(loop?.inputs?.FROM?.block.type).toBe('variables_get');
    expect(loop?.inputs?.TO?.block.type).toBe('variables_get');
  });

  it.skipIf(!hasPython)('差分执行：变量端点与常量空区间都与 Python 一致', () => {
    const variable = ['def f(xs):', '    acc = 0', '    for i in range(0, len(xs)):', '        acc = acc + i', '    return acc', ''].join('\n');
    const generated = regenerate(astState(variable));
    expect(generated).toContain('for i in range(0, len(xs)):');
    const calls: Array<[string, unknown[]]> = [['f', [[7, 8]]], ['f', [[]]]];
    expect(runCalls(generated, calls)).toBe(runCalls(variable, calls));

    const empty = ['def g():', '    acc = 0', '    for i in range(5, 2):', '        acc = acc + i', '    return acc', ''].join('\n');
    const emptyGenerated = regenerate(astState(empty));
    expect(emptyGenerated).toContain('for i in range(5, 2):');
    expect(runCalls(emptyGenerated, [['g', []]])).toBe('[0]');
    expect(runCalls(empty, [['g', []]])).toBe('[0]');
  });
});

describe('缺口 3：省略终点切片 → arr_slice + math_constrain', () => {
  it('模板路径：a[i:] 的长度是 constrain(len(源) - i, 0, len(源))，0 诊断', () => {
    const ctx = context();
    expect(shape(parseValue('a[i:]', ctx))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:variables_get(VAR=i) '
        + 'LENGTH:math_constrain{VALUE:math_arithmetic(OP=MINUS){A:lists_length{VALUE:variables_get(VAR=a)} '
        + 'B:variables_get(VAR=i)} LOW:data_value(NUM=0) HIGH:lists_length{VALUE:variables_get(VAR=a)}}}',
    );
    expect(ctx.diagnostics).toEqual([]);
  });

  it('模板路径：a[i:j] 非常量端点的长度是 constrain(j - i, 0, len(源))，并报动态符号漂移', () => {
    const ctx = context();
    const parsed = parseValue('a[i:j]', ctx);
    expect(parsed.type).toBe('arr_slice');
    expect(shape(parsed)).toContain(
      'LENGTH:math_constrain{VALUE:math_arithmetic(OP=MINUS){A:variables_get(VAR=j) B:variables_get(VAR=i)} '
        + 'LOW:data_value(NUM=0) HIGH:lists_length{VALUE:variables_get(VAR=a)}}',
    );
    expect(ctx.diagnostics).toHaveLength(1);
    expect(ctx.diagnostics?.[0].reason).toBe('semantic-drift');
    expect(ctx.diagnostics?.[0].detail).toBe(SLICE_DYNAMIC_SIGN);
  });

  it('两个字面量端点的拒绝规则不变（步长 / 异号 / 终点小于起点）', () => {
    expect(parseValue('a[1:2:3]', context()).blocked?.detail).toContain('步长');
    expect(parseValue('a[-2:2]', context()).blocked?.detail).toContain('一正一负');
    expect(parseValue('a[2:1]', context()).blocked?.detail).toContain('非负');
  });

  it('AST 路径：a[i:] 0 诊断；a[i:j] 也落 math_constrain 并报同一条动态符号漂移', () => {
    const tail = astState(['def f(a, i):', '    return a[i:]', ''].join('\n'));
    expect(tail.diagnostics).toEqual([]);
    const tailSlice = flatten(tail).find((block) => block.type === 'arr_slice');
    const tailLength = tailSlice?.inputs?.LENGTH?.block;
    expect(tailLength?.type).toBe('math_constrain');
    expect(tailLength?.inputs?.LOW?.block.type).toBe('math_number');
    expect(tailLength?.inputs?.HIGH?.block.type).toBe('lists_length');
    expect(tailLength?.inputs?.VALUE?.block.type).toBe('math_arithmetic');

    const mid = astState(['def f(a, i, j):', '    return a[i:j]', ''].join('\n'));
    expect(mid.diagnostics).toHaveLength(1);
    expect(mid.diagnostics[0].reason).toBe('semantic-drift');
    expect(mid.diagnostics[0].detail).toBe(SLICE_DYNAMIC_SIGN);
    expect(flatten(mid).find((block) => block.type === 'arr_slice')?.inputs?.LENGTH?.block.type).toBe('math_constrain');
  });

  it.skipIf(!hasPython)('差分执行：i < 0 / 0 ≤ i ≤ len / i > len 全部与 Python 一致（原漂移已消失）', () => {
    const code = ['def tail(a, i):', '    return a[i:]', ''].join('\n');
    const generated = regenerate(astState(code));
    expect(generated).toContain('min(max(');
    const calls: Array<[string, unknown[]]> = [
      ['tail', [[1, 2, 3, 4], -9]],
      ['tail', [[1, 2, 3, 4], -2]],
      ['tail', [[1, 2, 3, 4], 0]],
      ['tail', [[1, 2, 3, 4], 2]],
      ['tail', [[1, 2, 3, 4], 4]],
      ['tail', [[1, 2, 3, 4], 9]],
      ['tail', [[], 0]],
    ];
    expect(runCalls(generated, calls)).toBe(runCalls(code, calls));
  });

  it.skipIf(!hasPython)('已记录的漂移是真的：a[-2:j]（j = 3）块取到 [3,4]，Python 取 [3]', () => {
    const code = ['def mid(a, i, j):', '    return a[i:j]', ''].join('\n');
    const state = astState(code);
    // 诊断就是为这一段存在的：两端符号运行时才知道，块把负起点归一后的长度算多了。
    expect(state.diagnostics[0]?.detail).toBe(SLICE_DYNAMIC_SIGN);
    const generated = regenerate(state);
    const call: Array<[string, unknown[]]> = [['mid', [[1, 2, 3, 4], -2, 3]]];
    expect(runCalls(generated, call)).toBe('[[3, 4]]');
    expect(runCalls(code, call)).toBe('[[3]]');
  });

  it.skipIf(!hasPython)('差分执行：a[i:j] 同号端点（j ≥ i / j < i）时都与 Python 一致', () => {
    const code = ['def mid(a, i, j):', '    return a[i:j]', ''].join('\n');
    const generated = regenerate(astState(code));
    const calls: Array<[string, unknown[]]> = [
      ['mid', [[1, 2, 3, 4], 1, 3]],
      ['mid', [[1, 2, 3, 4], 3, 1]],
      ['mid', [[1, 2, 3, 4], -3, -1]],
      ['mid', [[1, 2, 3, 4], 0, 9]],
    ];
    expect(runCalls(generated, calls)).toBe(runCalls(code, calls));
  });
});
