// @vitest-environment jsdom
/**
 * AST 路径的**判据**（B2 / S3 P2.3b-2）：补上「结构对了 ≠ 还是同一段程序」这一层。
 *
 * 三条判据，各自能独立开火：
 *
 * 1. **再生有效**：AST 产物必须能载入 Blockly，再生成的 Python 必须能被 CPython 编译。
 *    这条最弱，但它是「能出块」的下限：块状态非法或生成器吐坏码，这里是第一道红灯。
 * 2. **结构保真**：把原文的语法树与工作区按**构造计数**对照（函数 / 分支 / 循环 / return /
 *    二元运算逐算子 / 调用 / 列表 / 下标 / 条件表达式 / 比较）。这条不看格式，只看「少没少」：
 *    静默丢一个分支或一个取反，计数立刻对不上。
 * 3. **差分执行**：原文与再生成的代码用同一组输入各跑一遍（本机 CPython），输出必须相同。
 *    §40.5 说的「语义未验证」在这里第一次有判据——它已经抓到一个真问题（见 range 样本）。
 *
 * 样本只取 §40.2 白名单内的写法（LLM 风格外部 Python），`drift` 是预期要报出的
 * `semantic-drift` 条数：块出来了、但块模型的语义与原文不同。
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
import { parseClosureNames, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import type { AstNode } from '@/services/ai-helper/reverse/ast/dump';
import type { SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';

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

/** 一段外部 Python 样本。`calls` 存在时才有差分执行：每项是 `[函数名, 位置参数列表]`。 */
interface Sample {
  name: string;
  code: string;
  /** 预期报出的 semantic-drift 条数（块出来了但语义与原文不同）。 */
  drift: number;
  calls?: Array<[string, unknown[]]>;
}

const SAMPLES: Sample[] = [
  {
    name: '算术 + if + 顶层常量',
    drift: 0,
    code: [
      '# 一轮混淆里常见的加法取模',
      'def step(a, b, limit):',
      '    total = a + b',
      '    if total > limit:',
      '        total = total - limit',
      '    return total',
      '',
      'MASK = [1, 2, 3]',
      '',
    ].join('\n'),
    calls: [
      ['step', [3, 5, 10]],
      ['step', [8, 9, 10]],
    ],
  },
  {
    name: 'for range(4) 循环',
    drift: 0,
    code: [
      'def accumulate():',
      '    acc = 0',
      '    for i in range(4):',
      '        acc = acc + i',
      '    return acc',
      '',
    ].join('\n'),
    calls: [['accumulate', []]],
  },
  {
    name: 'while 循环 + if-elif-else',
    drift: 0,
    code: [
      'def classify(x, limit):',
      '    steps = 0',
      '    while x > limit:',
      '        x = x - 2',
      '        steps = steps + 1',
      '    if x > 0:',
      '        steps = steps + 1',
      '    elif x == 0:',
      '        steps = steps + 2',
      '    else:',
      '        steps = steps + 3',
      '    return steps',
      '',
    ].join('\n'),
    calls: [
      ['classify', [7, 3]],
      ['classify', [0, 10]],
      ['classify', [-4, 10]],
    ],
  },
  {
    name: '助手函数互调',
    drift: 0,
    code: [
      'def inc(x):',
      '    return x + 1',
      '',
      'def twice(x):',
      '    y = inc(x)',
      '    return inc(y)',
      '',
    ].join('\n'),
    calls: [['twice', [4]]],
  },
  {
    name: '列表下标与条件表达式',
    drift: 0,
    code: [
      'def pick(xs, flag):',
      '    first = xs[0]',
      '    return first if flag else xs[1]',
      '',
    ].join('\n'),
    calls: [
      ['pick', [[7, 9], 1]],
      ['pick', [[7, 9], 0]],
    ],
  },
  {
    // 按位异或：结构能翻，语义会被 bit_operation 的 uint32 强制改掉。
    name: '按位运算（语义漂移样本）',
    drift: 1,
    code: ['def mix(state, round_key):', '    return state ^ round_key', ''].join('\n'),
  },
  {
    // 变量终点：ctrl_iterate 的 TIMES 是值输入，生成代码就是 `range(n)`，与 Python 逐字对应。
    name: 'for range(n)（变量次数样本）',
    drift: 0,
    code: [
      'def accumulate(n):',
      '    acc = 0',
      '    for i in range(n):',
      '        acc = acc + i',
      '    return acc',
      '',
    ].join('\n'),
  },
];

function dumpOf(code: string) {
  const dump = readAstDump(
    execFileSync('python3', ['-c', buildAstDumpScript(code)], { encoding: 'utf8' }).trim(),
  );
  if (!dump.ok) throw new Error(`AST 转储失败：${dump.error.message}`);
  return dump;
}

function astWorkspace(code: string): SerializedWorkspace {
  return irToWorkspace(astToIr(dumpOf(code).module, code));
}

/** 工作区状态 → 生成器代码（与用户点「生成」走同一条路）。 */
function regenerate(state: SerializedWorkspace): string {
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(
      state as Parameters<typeof Blockly.serialization.workspaces.load>[0],
      ws,
    );
    return pythonGenerator.workspaceToCode(ws);
  } finally {
    ws.dispose();
  }
}

/** 原文与生成代码都用 CPython 编译一遍：生成器吐坏码在这里红，而不是等用户点运行。 */
function compileOk(code: string): void {
  const encoded = Buffer.from(code, 'utf8').toString('base64');
  const driver = [
    'import base64',
    `compile(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'), '<generated>', 'exec')`,
  ].join('\n');
  expect(() => execFileSync('python3', ['-c', driver], { encoding: 'utf8' })).not.toThrow();
}

/** 原文与再生成代码用同一组输入各跑一遍，比较输出（本机 CPython 子进程）。 */
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

interface Counts {
  FunctionDef: number;
  Return: number;
  If: number;
  For: number;
  While: number;
  Compare: number;
  IfExp: number;
  Subscript: number;
  List: number;
  Call: number;
  BinOp: number;
}

const ZERO: Counts = {
  FunctionDef: 0,
  Return: 0,
  If: 0,
  For: 0,
  While: 0,
  Compare: 0,
  IfExp: 0,
  Subscript: 0,
  List: 0,
  Call: 0,
  BinOp: 0,
};

/** 原文语法树 → 构造计数。`range(...)` 是 for 的迭代器而不是调用块，单独剔除。 */
function sourceCounts(module: AstNode): Counts {
  const counts: Counts = { ...ZERO };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode & { func?: { id?: string } };
    if (node._ && node._ in counts) counts[node._ as keyof Counts] += 1;
    if (node._ === 'Call' && node.func?.id === 'range') counts.Call -= 1;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'ctx' || key === 'op') continue;
      walk(child);
    }
  };
  walk(module);
  return counts;
}

const AST_OP: Record<string, string> = {
  ADD: 'Add', MINUS: 'Sub', MULTIPLY: 'Mult', DIVIDE: 'Div', POWER: 'Pow', MOD: 'Mod',
  AND: 'BitAnd', OR: 'BitOr', XOR: 'BitXor', LEFT_SHIFT: 'LShift', RIGHT_SHIFT: 'RShift',
};

/**
 * 子块遍历。`controls_for` 的 TO 有一个例外：`range(n)` 的块编码是 `TO = n - 1`
 * （闭区间），这个 `- 1` 是块模型自己的换算、不是用户写的运算，所以要跳过这层包装，
 * 否则「逐算子比对」会把每个非常量循环都算成多了一个减法。
 */
function childrenOf(block: SerializedBlock): SerializedBlock[] {
  const out: SerializedBlock[] = [];
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    if (block.type === 'controls_for' && name === 'TO') {
      const to = input.block;
      const folded = to.type === 'math_arithmetic' && to.fields?.OP === 'MINUS' ? to.inputs?.A?.block : null;
      out.push(folded ?? to);
      continue;
    }
    out.push(input.block);
  }
  if (block.next) out.push(block.next.block);
  return out;
}

/** 工作区 → 构造计数：与 `sourceCounts` 同一口径，用来判「有没有静默丢构造」。 */
function blockCounts(state: SerializedWorkspace): Counts {
  const counts: Counts = { ...ZERO };
  const walk = (block: SerializedBlock): void => {
    const extra = (block.extraState ?? {}) as { elseIfCount?: number };
    switch (block.type) {
      case 'procedures_defreturn':
        counts.FunctionDef += 1;
        counts.Return += 1;
        break;
      case 'procedures_defnoreturn':
        counts.FunctionDef += 1;
        break;
      case 'controls_if':
        counts.If += 1 + Math.max(0, extra.elseIfCount ?? 0);
        break;
      case 'controls_for':
        counts.For += 1;
        break;
      case 'ctrl_iterate':
        // 一参数 range(n) 的块；结构上同样是「一个循环」。
        counts.For += 1;
        break;
      case 'controls_whileUntil':
        counts.While += 1;
        break;
      case 'logic_compare':
        counts.Compare += 1;
        break;
      case 'logic_ternary':
        counts.IfExp += 1;
        break;
      case 'lists_getIndex':
        counts.Subscript += 1;
        break;
      case 'lists_create_with':
        counts.List += 1;
        break;
      case 'procedures_callreturn':
      case 'procedures_callnoreturn':
        counts.Call += 1;
        break;
      case 'math_arithmetic':
      case 'math_modulo':
      case 'bit_operation':
        counts.BinOp += 1;
        break;
      default:
        break;
    }
    childrenOf(block).forEach(walk);
  };
  state.blocks.blocks.forEach(walk);
  return counts;
}

/**
 * 逐算子计数：`a + b` 被翻成 `a ^ b` 时二元运算总数不变，只有分算子能看出来。
 * 单独一列而不是塞进 `Counts`，是为了让「总数」与「分算子」两种判据都能独立读。
 */
function binOpCounts(
  module: AstNode,
  state: SerializedWorkspace,
): { source: Map<string, number>; blocks: Map<string, number> } {
  const source = new Map<string, number>();
  const walkSource = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walkSource);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode & { op?: { _?: string } };
    if (node._ === 'BinOp' && node.op?._) {
      source.set(node.op._, (source.get(node.op._) ?? 0) + 1);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'ctx' || key === 'op') continue;
      walkSource(child);
    }
  };
  walkSource(module);

  const blocks = new Map<string, number>();
  const walkBlock = (block: SerializedBlock): void => {
    const op = typeof block.fields?.OP === 'string' ? block.fields.OP : '';
    const astOp = AST_OP[op];
    if (astOp) blocks.set(astOp, (blocks.get(astOp) ?? 0) + 1);
    childrenOf(block).forEach(walkBlock);
  };
  state.blocks.blocks.forEach(walkBlock);
  return { source, blocks };
}

describe.skipIf(!hasPython)('AST 路径：再生有效 + 结构保真', () => {
  for (const sample of SAMPLES) {
    it(sample.name, () => {
      const state = astWorkspace(sample.code);
      const generated = regenerate(state);
      // 1. 生成器吐出的必须是合法 Python（块状态非法会在这里先炸）。
      compileOk(sample.code);
      compileOk(generated);

      // 2. 结构计数逐项对得上；drift 与预期一致。
      const dump = dumpOf(sample.code);
      expect(blockCounts(state)).toEqual(sourceCounts(dump.module));
      const ops = binOpCounts(dump.module, state);
      expect([...ops.blocks.entries()].sort()).toEqual([...ops.source.entries()].sort());
      const drift = state.diagnostics.filter((diag) => diag.reason === 'semantic-drift');
      expect(drift).toHaveLength(sample.drift);
    });
  }
});

/**
 * 闭链（P2.3c 的验收判据）：AST 产物 → 生成器出代码 → **模板路径**读回来。
 *
 * 判据取 §31 的同一把尺子：两条路径最终落到「再生成的代码逐字相同」。闭合不上的含义是
 * 用户从外部代码拿到的工作区，导出后再导入会被平台读成另一个东西（或干脆读不回来）。
 *
 * 比较前剔除生成器补的 `X = None` 前导行（两侧都有，顺序随变量表，不是结构证据）。
 */
function stripDeclarations(code: string): string {
  return code
    .split('\n')
    .filter((line) => !/^[A-Za-z_]\w*\s*=\s*None\s*$/.test(line))
    .join('\n')
    .trim();
}

describe.skipIf(!hasPython)('闭链：AST 产物 → 生成 → 模板路径读回同一段代码', () => {
  for (const sample of SAMPLES) {
    it(sample.name, () => {
      const first = astWorkspace(sample.code);
      const generated = regenerate(first);
      const template = reverseCode(generated, payload);
      expect(template.stats.diagnostics).toBe(0);
      expect(stripDeclarations(regenerate(template.state))).toBe(stripDeclarations(generated));
    });
  }

  it('range(n) 现在闭合：ctrl_iterate 的 TIMES 是值输入，生成的 `range(n)` 能读回同一个块', () => {
    const sample = SAMPLES.find((item) => item.name.includes('range(n)'))!;
    const generated = regenerate(astWorkspace(sample.code));
    expect(generated).toContain('range(n)');
    expect(generated).not.toContain('upRange');
    expect(reverseCode(generated, payload).stats.diagnostics).toBe(0);
  });
});

describe.skipIf(!hasPython)('AST 路径差分执行：原文与再生成的代码跑出同一组结果', () => {
  for (const sample of SAMPLES.filter((item) => item.calls)) {
    it(sample.name, () => {
      const generated = regenerate(astWorkspace(sample.code));
      expect(runCalls(generated, sample.calls!)).toBe(runCalls(sample.code, sample.calls!));
    });
  }

  it('range(n) 的空区间与 Python 一致：n=0 时一次也不执行', () => {
    const sample = SAMPLES.find((item) => item.name.includes('range(n)'))!;
    const generated = regenerate(astWorkspace(sample.code));
    expect(runCalls(generated, [['accumulate', [5]]])).toBe(runCalls(sample.code, [['accumulate', [5]]]));
    // ctrl_iterate 生成 `for i in range(n):`，n=0 时与 Python 一样跳过循环体。
    expect(runCalls(generated, [['accumulate', [0]]])).toBe('[0]');
    expect(runCalls(sample.code, [['accumulate', [0]]])).toBe('[0]');
  });
});
