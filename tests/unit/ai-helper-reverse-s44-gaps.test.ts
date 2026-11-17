// @vitest-environment jsdom
/**
 * §44.6「仍然缺什么」的四条缺口（P2.3d-2）
 *
 * 每条缺口先判「在现有块类型内能不能忠实表达」，再按结论落判据：
 *
 * 1. **非字面量区间的推导式**（`[f(v) for v in range(n)]`）：块模型没有 list append
 *    （`lists_setIndex` 被覆盖成只做按下标赋值，`lists_create_with` 的项数必须静态确定），
 *    落不了地 → 一条点名原语的 `unsupported` 诊断，不出块。
 * 2. **带 `if` 的推导式**（同上，要先收集再筛选）：诊断；**多个生成器**在字面量区间上是
 *    笛卡尔积，可以忠实展开 → 两条路径都实现（外层的 for 变化最慢）。
 * 3. **省略终点的切片**（`a[i:]`）：`arr_slice` + `len(源) - 起点`（`lists_length` 的
 *    Python 生成就是 `len(...)`）→ 两条路径都实现，闭链可读回。仍有一处已记录的漂移：
 *    起点为正且源比它还短时，块算出负长度会抛错，Python 返回空列表（没有 min/钳位原语）；
 *    `a[:]` / `a[-2:]` 的长度必然非负，逐字等价、不出诊断。
 * 4. **两/三参数 `range(a, b)` 的非常量端点**：块能出但空区间会倒序执行，缺的是「起点 +
 *    次数」的计数循环原语 → 出块 + `semantic-drift`；常量空区间直接不产出。
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
import { buildMatchers, parseClosureNames, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import type { ParsedNode, SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { buildPrimitiveIndex } from '@/services/ai-helper/reverse/primitive-calls';
import { parsePythonBody, parseValue } from '@/services/ai-helper/reverse/core-syntax';
import type { CoreContext } from '@/services/ai-helper/reverse/core-syntax';
import { toWorkspaceState } from '@/services/ai-helper/reverse/serialize';

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
function runCalls(code: string, calls: Array<[string, unknown[]]>, quiet = false): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  const driver = [
    'import base64, json',
    `src = base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8')`,
    `calls = json.loads(${JSON.stringify(JSON.stringify(calls))})`,
    'ns = {}',
    "exec(compile(src, '<sample>', 'exec'), ns)",
    'print(json.dumps([ns[name](*args) for name, args in calls]))',
  ].join('\n');
  return execFileSync('python3', ['-c', driver], {
    encoding: 'utf8',
    timeout: 10000,
    // 预期会抛错的用例不该把 CPython 的 traceback 打到测试输出里。
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'pipe'],
  }).trim();
}

describe('缺口 1/2：推导式里的非字面量区间与 if —— 诊断代替', () => {
  it('模板路径：诊断点名缺 list append，且序列化后只有一条诊断、不出块', () => {
    for (const source of ['[v for v in range(n)]', '[v for v in range(2) if v]']) {
      const parsed = parseValue(source, context());
      expect(parsed.type).toBe('UNRESOLVED');
      expect(parsed.blocked?.reason).toBe('unsupported');
      expect(parsed.blocked?.detail).toContain('append');

      // 语句层：同一条语句只报一次（不会「子块 + 父块」各记一条）。
      const statement = parsePythonBody([`SBOX = ${source}`], context()).statements[0];
      const state = toWorkspaceState([statement]);
      expect(state.blocks.blocks).toEqual([]);
      expect(state.diagnostics).toHaveLength(1);
      expect(state.diagnostics[0].reason).toBe('unsupported');
      expect(state.diagnostics[0].detail).toContain('append');
    }
  });

  it('AST 路径：同一条诊断，不出列表块', () => {
    for (const source of ['return [v for v in range(n)]', 'return [v for v in range(2) if v]']) {
      const state = astState(['def f(n):', `    ${source}`, ''].join('\n'));
      expect(state.diagnostics).toHaveLength(1);
      expect(state.diagnostics[0].reason).toBe('unsupported');
      expect(state.diagnostics[0].detail).toContain('append');
      expect(flatten(state).some((block) => block.type === 'lists_create_with')).toBe(false);
    }
  });
});

describe('缺口 2：多个生成器 —— 两条路径都按笛卡尔积展开', () => {
  it('模板路径：项数与顺序（外层 for 变化最慢）', () => {
    expect(shape(parseValue('[v for v in range(2) for w in range(2)]', context()))).toBe(
      'lists_create_with{ADD0:data_value(NUM=0) ADD1:data_value(NUM=0) '
        + 'ADD2:data_value(NUM=1) ADD3:data_value(NUM=1)}',
    );
    expect(shape(parseValue('[v * 10 + w for v in range(2) for w in range(3)]', context())))
      .toContain('math_arithmetic(OP=ADD)');
  });

  it('AST 路径：同一段代码得到同一组项（6 项），0 诊断', () => {
    const template = parseValue('[v * 10 + w for v in range(2) for w in range(3)]', context());
    expect(template.extraState).toEqual({ itemCount: 6 });
    const state = astState(['def f():', '    return [v * 10 + w for v in range(2) for w in range(3)]', ''].join('\n'));
    const list = flatten(state).find((block) => block.type === 'lists_create_with');
    expect(list?.extraState).toEqual({ itemCount: 6 });
    expect(state.diagnostics).toEqual([]);
  });

  it.skipIf(!hasPython)('差分执行：展开后的列表与原文一致', () => {
    const code = ['def f():', '    return [v * 10 + w for v in range(2) for w in range(3)]', ''].join('\n');
    const generated = regenerate(astState(code));
    expect(runCalls(generated, [['f', []]])).toBe(runCalls(code, [['f', []]]));
  });

  it('展开超过上限（128 项 > 64）时诊断，不静默截断', () => {
    const parsed = parseValue('[v for v in range(8) for w in range(8) for u in range(2)]', context());
    expect(parsed.type).toBe('UNRESOLVED');
    expect(parsed.blocked?.detail).toContain('128');
  });
});

describe('缺口 3：省略终点的切片 —— 两条路径都实现（arr_slice + len）', () => {
  it('模板路径：a[i:] / a[:] 的长度是 len(源) - 起点', () => {
    const tailCtx = context();
    expect(shape(parseValue('a[i:]', tailCtx))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:variables_get(VAR=i) '
        + 'LENGTH:math_arithmetic(OP=MINUS){A:lists_length{VALUE:variables_get(VAR=a)} B:variables_get(VAR=i)}}',
    );
    // 起点为正时源可能比它还短，块会算出负长度（Python 返回空列表）——必须报漂移。
    expect(tailCtx.diagnostics).toHaveLength(1);
    expect(tailCtx.diagnostics?.[0].reason).toBe('semantic-drift');
    expect(tailCtx.diagnostics?.[0].detail).toContain('负长度');

    // `a[:]` 与 `a[-2:]` 的长度必然非负，是逐字等价的，不该有诊断。
    const headCtx = context();
    expect(shape(parseValue('a[:]', headCtx))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:data_value(NUM=0) '
        + 'LENGTH:math_arithmetic(OP=MINUS){A:lists_length{VALUE:variables_get(VAR=a)} B:data_value(NUM=0)}}',
    );
    expect(parseValue('a[-2:]', headCtx).type).toBe('arr_slice');
    expect(headCtx.diagnostics).toEqual([]);
  });

  it('AST 路径：同一个块（输入名与字段逐字一致），并报同一条漂移', () => {
    const state = astState(['def f(a, i):', '    return a[i:]', ''].join('\n'));
    const slice = flatten(state).find((block) => block.type === 'arr_slice');
    expect(Object.keys(slice?.inputs ?? {}).sort()).toEqual(['LENGTH', 'LIST', 'START']);
    expect(slice?.inputs?.LENGTH?.block.type).toBe('math_arithmetic');
    expect(slice?.inputs?.LENGTH?.block.fields?.OP).toBe('MINUS');
    expect(slice?.inputs?.LENGTH?.block.inputs?.A?.block.type).toBe('lists_length');
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0].reason).toBe('semantic-drift');
    expect(state.diagnostics[0].detail).toContain('负长度');

    // `a[:]` 逐字等价：0 诊断。
    expect(astState(['def f(a):', '    return a[:]', ''].join('\n')).diagnostics).toEqual([]);
  });

  it.skipIf(!hasPython)('闭链：AST 产物 → 生成 → 模板路径读回同一段代码', () => {
    const code = ['def tail(a, i):', '    return a[i:]', ''].join('\n');
    const generated = regenerate(astState(code));
    const reversed = reverseCode(generated, payload);
    expect(reversed.stats.diagnostics).toBe(0);
    expect(regenerate(reversed.state)).toBe(generated);
  });

  it.skipIf(!hasPython)('闭链顺带覆盖：a[i:j] 非常量端点的长度表达式也能读回（槽位补拆）', () => {
    const code = ['def mid(a, i, j):', '    return a[i:j]', ''].join('\n');
    const generated = regenerate(astState(code));
    expect(generated).toContain('(j - i)');
    const reversed = reverseCode(generated, payload);
    expect(reversed.stats.diagnostics).toBe(0);
    expect(regenerate(reversed.state)).toBe(generated);
  });

  it.skipIf(!hasPython)('差分执行：0 ≤ 起点 ≤ 长度与负起点都与 Python 一致', () => {
    const code = ['def tail(a, i):', '    return a[i:]', ''].join('\n');
    const generated = regenerate(astState(code));
    const calls: Array<[string, unknown[]]> = [
      ['tail', [[1, 2, 3, 4], 1]],
      ['tail', [[1, 2, 3, 4], 4]],
      ['tail', [[1, 2, 3, 4], -2]],
      ['tail', [[1, 2, 3, 4], -9]],
      ['tail', [[], 0]],
    ];
    expect(runCalls(generated, calls)).toBe(runCalls(code, calls));
  });

  it.skipIf(!hasPython)('已记录的漂移是真的：起点越界时块抛错、Python 返回空列表', () => {
    const code = ['def tail(a, i):', '    return a[i:]', ''].join('\n');
    const generated = regenerate(astState(code));
    // 漂移诊断说的就是这个分支：没有 min/钳位原语，负长度会被 arr_slice 拒绝。
    expect(() => runCalls(generated, [['tail', [[1, 2, 3, 4], 9]]], true)).toThrow();
    expect(runCalls(code, [['tail', [[1, 2, 3, 4], 9]]])).toBe('[[]]');
  });
});

describe('缺口 4：range 的非常量端点 —— 出块 + semantic-drift（常量空区间不产出）', () => {
  it('模板路径：controls_for + 一条漂移诊断，点名缺的计数循环原语', () => {
    const ctx = context();
    const parsed = parsePythonBody(['for i in range(n, m):', '    x = i'], ctx);
    expect(parsed.statements[0].node.type).toBe('controls_for');
    expect(ctx.diagnostics).toHaveLength(1);
    expect(ctx.diagnostics?.[0].reason).toBe('semantic-drift');
    expect(ctx.diagnostics?.[0].detail).toContain('ctrl_iterate');
    expect(ctx.diagnostics?.[0].detail).toContain('倒序');
  });

  it('AST 路径：同一个块、同一条漂移诊断', () => {
    const state = astState(['def f(n, m):', '    acc = 0', '    for i in range(n, m):', '        acc = acc + i', '    return acc', ''].join('\n'));
    expect(flatten(state).some((block) => block.type === 'controls_for')).toBe(true);
    const drift = state.diagnostics.filter((diag) => diag.reason === 'semantic-drift');
    expect(drift).toHaveLength(1);
    expect(drift[0].detail).toContain('ctrl_iterate');
  });

  it('常量空区间两条路径都不产出块（unsupported）', () => {
    const ctx = context();
    const parsed = parsePythonBody(['for i in range(4, 2):', '    x = i'], ctx);
    expect(parsed.statements[0].node.type).toBe('UNRESOLVED');
    expect(parsed.statements[0].node.blocked?.reason).toBe('unsupported');
    expect(parsed.statements[0].node.blocked?.detail).toContain('空区间');

    const state = astState(['def f():', '    for i in range(4, 2):', '        pass', '    return 1', ''].join('\n'));
    expect(flatten(state).some((block) => block.type === 'controls_for')).toBe(false);
    expect(state.diagnostics[0].reason).toBe('unsupported');
    expect(state.diagnostics[0].detail).toContain('空区间');
  });

  it('步长不是 1：两条路径都报缺计数循环/步长换算，不硬套闭区间', () => {
    const ctx = context();
    expect(parsePythonBody(['for i in range(0, 8, 2):', '    x = i'], ctx).statements[0].node.blocked?.detail).toContain('步长');

    const state = astState(['def f():', '    for i in range(0, 8, 2):', '        pass', '    return 1', ''].join('\n'));
    expect(state.diagnostics[0].detail).toContain('步长');
  });
});
