// @vitest-environment jsdom
/**
 * 推导式展开成「空列表 + 循环 + append」的判据（S44 收口主线）。
 *
 * 覆盖五件事里的第 3 条：
 *   - 非字面量区间 / 带一个 if / 列表表达式迭代器的推导式，在**赋值右侧**展开成
 *     `target = []` → 循环 → `append`（AST 与模板两条路径同形）；
 *   - 多个生成器且不全是字面量 range → `COMP_NESTED`；放在 return / 实参等表达式位置 →
 *     `COMP_ASSIGN_ONLY`；两处都不产出半成品；
 *   - 字面量区间的推导式保持既有静态展开（语义不变，既有用例不动）；
 *   - 变量遮蔽：`v = 1; arr = [v for v in range(n)]` 之后 `v` 仍是 1——循环变量改名为
 *     `v_1`（确定性），表达式引用同步改名；
 *   - 闭链：AST 产物 → 生成 Python → 模板路径读回 → **块结构逐项相同**（数字字面量的
 *     `math_number` / `data_value` 是两条路径既有的区别，生成代码相同，指纹里归一成 `num`）。
 *
 * 差分执行表在同文件末尾：六段样本的「块生成代码」与「原文 Python」跑同一组输入。
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
import type {
  ProcedureNode,
  SerializedBlock,
  SerializedWorkspace,
} from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { buildPrimitiveIndex } from '@/services/ai-helper/reverse/primitive-calls';
import { parsePythonBody, parseValue } from '@/services/ai-helper/reverse/core-syntax';
import type { CoreContext } from '@/services/ai-helper/reverse/core-syntax';
import { COMP_ASSIGN_ONLY, COMP_NESTED } from '@/services/ai-helper/reverse/diagnostics';
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

function context(procedures: Array<[string, string[]]> = []): CoreContext {
  return { matchers: buildMatchers(payload), procedures: new Map(procedures), diagnostics: [] };
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

/** 把变量 id 换成变量名（两条路径的 id 派生顺序不同，名字才是语义）。 */
function normalize(value: unknown, names: Map<string, string>): string {
  if (Array.isArray(value)) return `[${value.map((item) => normalize(item, names)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && Object.keys(record).length <= 3) {
      const name = names.get(record.id) ?? record.id;
      return `{#${name}}`;
    }
    return `{${Object.keys(record).sort().map((key) => `${key}:${normalize(record[key], names)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 块结构指纹：类型 + 输入名 + 输入子块 + next 链 + 字段 + extraState。
 *
 * 数字字面量归一成 `num`：AST 路径用原生 `math_number`、模板路径用项目的 `data_value`，
 * 两者生成的代码逐字相同（都是那个数字），是两条路径既有的表示差异，不是本轮引入的。
 */
function fingerprint(state: SerializedWorkspace): string {
  const names = new Map(state.variables.map((variable) => [variable.id, variable.name]));
  const block = (current: SerializedBlock): string => {
    const numeric = current.type === 'math_number'
      || (current.type === 'data_value' && /^-?\d+$/.test(String(current.fields?.NUM)));
    const type = numeric ? 'num' : current.type;
    const fields = Object.entries(current.fields ?? {})
      .map(([key, value]) => {
        if (value && typeof value === 'object' && 'id' in value) {
          const id = (value as { id: string }).id;
          return `${key}=${names.get(id) ?? id}`;
        }
        return `${key}=${String(value)}`;
      })
      .sort()
      .join(',');
    const inputs = Object.entries(current.inputs ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, input]) => `${key}(${block(input.block)})`)
      .join(',');
    const next = current.next ? `next(${block(current.next.block)})` : '';
    const extra = current.extraState ? ` extra=${normalize(current.extraState, names)}` : '';
    return `${type}[${fields}]${extra}{${inputs}}${next}`;
  };
  return state.blocks.blocks.map(block).join('\n');
}

/** 模板路径：把一段函数体（含末尾 return）序列化成带 procedure 的工作区状态。 */
function templateState(
  name: string,
  params: string[],
  lines: string[],
): SerializedWorkspace {
  const ctx = context();
  const parsed = parsePythonBody(lines, ctx, { trailingReturn: true, params });
  const procedure: ProcedureNode = {
    signature: { name, params: params.map((param) => ({ name: param, type: 'bytes' })) },
    body: parsed.statements,
    returnNode: parsed.returnExpr ? { text: parsed.returnExpr, node: parseValue(parsed.returnExpr, ctx) } : null,
  };
  const state = toWorkspaceState([], { procedures: [procedure] });
  if (ctx.diagnostics?.length) {
    throw new Error(`模板路径出现诊断：${JSON.stringify(ctx.diagnostics)}`);
  }
  return state;
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

const COMP_SAMPLE = ['def mk(n):', '    arr = [v * 2 for v in range(n)]', '    return arr', ''].join('\n');
const COMP_IF_SAMPLE = ['def mk(n):', '    arr = [v * 2 for v in range(n) if v > 1]', '    return arr', ''].join('\n');
const FOREACH_SAMPLE = ['def mk(xs):', '    arr = [x * 2 for x in xs]', '    return arr', ''].join('\n');
const SHADOW_SAMPLE = ['def mk(n):', '    v = 1', '    arr = [v for v in range(n)]', '    return v', ''].join('\n');
const RANGE_SAMPLE = ['def f(xs):', '    acc = 0', '    for i in range(0, len(xs)):', '        acc = acc + i', '    return acc', ''].join('\n');
const SLICE_SAMPLE = ['def cut(a, i):', '    return a[i:]', ''].join('\n');
const EMPTY_RANGE_SAMPLE = ['def f():', '    acc = 0', '    for i in range(5, 2):', '        acc = acc + i', '    return acc', ''].join('\n');

describe('推导式：AST 与模板两条路径同形', () => {
  it('非字面量区间：arr = [v * 2 for v in range(n)] → 空列表 + ctrl_iterate + arr_append', () => {
    const template = templateState('mk', ['n'], ['arr = [v * 2 for v in range(n)]', 'return arr']);
    expect(fingerprint(template)).toBe(fingerprint(astState(COMP_SAMPLE)));
    expect(flatten(template).map((block) => block.type)).toEqual(
      expect.arrayContaining(['variables_set', 'lists_create_empty', 'ctrl_iterate', 'arr_append']),
    );
  });

  it('带一个 if：循环体是 controls_if 包住 arr_append', () => {
    const template = templateState('mk', ['n'], ['arr = [v * 2 for v in range(n) if v > 1]', 'return arr']);
    expect(fingerprint(template)).toBe(fingerprint(astState(COMP_IF_SAMPLE)));
    const loop = flatten(template).find((block) => block.type === 'ctrl_iterate');
    expect(loop?.inputs?.DO?.block.type).toBe('controls_if');
    expect(loop?.inputs?.DO?.block.inputs?.DO0?.block.type).toBe('arr_append');
  });

  it('列表表达式迭代器：落原生 controls_forEach', () => {
    const template = templateState('mk', ['xs'], ['arr = [x * 2 for x in xs]', 'return arr']);
    expect(fingerprint(template)).toBe(fingerprint(astState(FOREACH_SAMPLE)));
    const loop = flatten(template).find((block) => block.type === 'controls_forEach');
    expect(loop?.inputs?.LIST?.block.type).toBe('variables_get');
    expect(loop?.inputs?.DO?.block.type).toBe('arr_append');
  });

  it('变量遮蔽：循环变量改名 v_1，两条路径一致且 return 的仍是外层 v', () => {
    const template = templateState('mk', ['n'], ['v = 1', 'arr = [v for v in range(n)]', 'return v']);
    expect(fingerprint(template)).toBe(fingerprint(astState(SHADOW_SAMPLE)));
    const loop = flatten(template).find((block) => block.type === 'ctrl_iterate');
    expect(loop?.fields?.VAR).toBe('v_1');
    // return 的是外层 v（不是循环变量）：生成代码里 `return v`。
    const generated = regenerate(astState(SHADOW_SAMPLE));
    expect(generated).toContain('for v_1 in range(n):');
    expect(generated).toContain('return v');
  });

  it('普通 for x in xs: 也同形（原生 controls_forEach）', () => {
    const ctx = context();
    const parsed = parsePythonBody(['acc = 0', 'for x in xs:', '    acc = acc + x'], ctx);
    const template = toWorkspaceState(parsed.statements);
    const ast = astState(['acc = 0', 'for x in xs:', '    acc = acc + x', ''].join('\n'));
    expect(fingerprint(template)).toBe(fingerprint(ast));
    expect(flatten(template).some((block) => block.type === 'controls_forEach')).toBe(true);
  });

  it('range(a, b) 与省略终点切片也同形（ctrl_range / math_constrain）', () => {
    const rangeTemplate = templateState('f', ['xs'], [
      'acc = 0',
      'for i in range(0, len(xs)):',
      '    acc = acc + i',
      'return acc',
    ]);
    expect(fingerprint(rangeTemplate)).toBe(fingerprint(astState(RANGE_SAMPLE)));

    const sliceTemplate = templateState('cut', ['a', 'i'], ['return a[i:]']);
    expect(fingerprint(sliceTemplate)).toBe(fingerprint(astState(SLICE_SAMPLE)));
  });
});

describe('推导式：闭链（AST 产物 → 生成 → 模板路径读回）', () => {
  const samples: Array<[string, string]> = [
    ['非字面量区间', COMP_SAMPLE],
    ['带 if', COMP_IF_SAMPLE],
    ['列表表达式迭代器', FOREACH_SAMPLE],
    ['变量遮蔽', SHADOW_SAMPLE],
    ['range(a, b)', RANGE_SAMPLE],
    ['常量空区间 range(5, 2)', EMPTY_RANGE_SAMPLE],
    ['省略终点切片', SLICE_SAMPLE],
  ];
  for (const [name, code] of samples) {
    it.skipIf(!hasPython)(name, () => {
      const first = astState(code);
      const generated = regenerate(first);
      const template = reverseCode(generated, payload);
      expect(template.stats.diagnostics).toBe(0);
      expect(fingerprint(template.state)).toBe(fingerprint(first));
      // 再生成一遍也必须逐字相同（结构相同的最强证据）。
      expect(regenerate(template.state)).toBe(generated);
    });
  }
});

describe('推导式：落点与多生成器的诊断（两条路径同一句话）', () => {
  it('表达式位置（return）：两条路径都报 COMP_ASSIGN_ONLY，不产出半成品', () => {
    const code = ['def mk(n):', '    return [v for v in range(n)]', ''].join('\n');
    const ast = astState(code);
    expect(ast.diagnostics).toHaveLength(1);
    expect(ast.diagnostics[0].detail).toBe(COMP_ASSIGN_ONLY);
    expect(flatten(ast).some((block) => block.type === 'lists_create_with')).toBe(false);

    const ctx = context();
    const parsed = parseValue('[v for v in range(n)]', ctx);
    expect(parsed.type).toBe('UNRESOLVED');
    expect(parsed.blocked?.detail).toBe(COMP_ASSIGN_ONLY);
  });

  it('多生成器且不全是字面量 range：两条路径都报 COMP_NESTED', () => {
    const code = ['def mk(n):', '    arr = [v + w for v in range(n) for w in range(2)]', '    return arr', ''].join('\n');
    const ast = astState(code);
    expect(ast.diagnostics).toHaveLength(1);
    expect(ast.diagnostics[0].detail).toBe(COMP_NESTED);

    const ctx = context();
    const parsed = parseValue('[v + w for v in range(n) for w in range(2)]', ctx);
    expect(parsed.blocked?.detail).toBe(COMP_NESTED);
  });

  it('字面量区间的推导式保持静态展开（既有语义不变）', () => {
    const template = parseValue('[v * 2 for v in range(4)]', context());
    expect(template.type).toBe('lists_create_with');
    expect(template.extraState).toEqual({ itemCount: 4 });

    const ast = astState(['def mk():', '    arr = [v * 2 for v in range(4)]', '    return arr', ''].join('\n'));
    const list = flatten(ast).find((block) => block.type === 'lists_create_with');
    expect(list?.extraState).toEqual({ itemCount: 4 });
    expect(ast.diagnostics).toEqual([]);
  });

  it('静态展开超过上限仍报诊断（compTooLong 保留）', () => {
    const parsed = parseValue('[v for v in range(8) for w in range(8) for u in range(2)]', context());
    expect(parsed.type).toBe('UNRESOLVED');
    expect(parsed.blocked?.detail).toContain('128');
  });
});

/** 六段新样本的差分执行：块生成代码 vs 原文 Python。 */
const DIFF_SAMPLES: Array<{ name: string; code: string; calls: Array<[string, unknown[]]> }> = [
  { name: 'range(0, len(x)) 变量端点', code: RANGE_SAMPLE, calls: [['f', [[7, 8, 9]]], ['f', [[]]]] },
  {
    name: 'range(n)',
    code: ['def f(n):', '    acc = 0', '    for i in range(n):', '        acc = acc + i', '    return acc', ''].join('\n'),
    calls: [['f', [5]], ['f', [0]]],
  },
  {
    name: '常量空区间 range(5, 2)',
    code: ['def f():', '    acc = 0', '    for i in range(5, 2):', '        acc = acc + i', '    return acc', ''].join('\n'),
    calls: [['f', []]],
  },
  { name: '[v*2 for v in range(n)]', code: COMP_SAMPLE, calls: [['mk', [4]], ['mk', [0]]] },
  { name: '带 if 的推导式', code: COMP_IF_SAMPLE, calls: [['mk', [5]], ['mk', [1]]] },
  { name: '变量遮蔽 v = 1; arr = [v for v in range(n)]', code: SHADOW_SAMPLE, calls: [['mk', [5]], ['mk', [1]]] },
];

describe.skipIf(!hasPython)('推导式：六段样本的差分执行', () => {
  for (const sample of DIFF_SAMPLES) {
    it(sample.name, () => {
      const generated = regenerate(astState(sample.code));
      expect(runCalls(generated, sample.calls)).toBe(runCalls(sample.code, sample.calls));
    });
  }
});

describe('推导式：遮蔽时必须改名（作用域已出现过同名变量）', () => {
  const cases: Array<[string, string, string]> = [
    ['参数同名', 'def mk(v, n):\n    arr = [v * 2 for v in range(n)]\n    return v\n', 'v_1'],
    ['同作用域已赋值', 'def mk(n):\n    v = 1\n    arr = [v for v in range(n)]\n    return v\n', 'v_1'],
    ['目标变量本身同名', 'def mk(n):\n    v = [v for v in range(n)]\n    return v\n', 'v_1'],
  ];
  for (const [name, code, expected] of cases) {
    it(name, () => {
      const loop = flatten(astState(code)).find((block) => block.type === 'ctrl_iterate');
      expect(loop?.fields?.VAR).toBe(expected);
      // 表达式里的引用同步改名：生成代码里循环体用的是新名。
      expect(regenerate(astState(code))).toContain(`for ${expected} in range(`);
    });
  }
});
