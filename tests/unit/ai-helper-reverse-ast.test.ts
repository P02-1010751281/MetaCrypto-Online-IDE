/**
 * 代码 → 工作区 · AST 路径（B2 / S3 第一段）
 *
 * 这组用例不加载 Pyodide：宿主抽象成 `PyAstRunner`，测试用本机 python3 跑同一份转储
 * 脚本。这样既验证了脚本本身（真 CPython），又不必在单测里背 12MB 运行时。
 *
 * 判据沿用前几轮的口径：**不猜**——翻不出来的节点必须逐条带行号报出来，不许静默丢；
 * 能翻的部分要保住结构（函数/形参/分支/循环/返回），块类型只用画布上真有的。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseClosureNames,
  parseFieldPayload,
  reverseCodeAuto,
  reverseForeignCode,
} from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import { buildPrimitiveIndex } from '@/services/ai-helper/reverse/primitive-calls';
import type { SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'import ast'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** 本机 python3 当宿主：跑的就是浏览器里同一份转储脚本（`python3 -c` 只给 stdout）。 */
function hostPython(script: string): Promise<string> {
  return Promise.resolve(execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim());
}

function dumpOf(code: string) {
  return readAstDump(hostDump(code));
}

function hostDump(code: string): string {
  return execFileSync('python3', ['-c', buildAstDumpScript(code)], { encoding: 'utf8' }).trim();
}

/** 语法树 → 工作区（测试里同步走完，省掉一层 Promise）。 */
function toWorkspace(code: string): SerializedWorkspace {
  const dump = dumpOf(code);
  if (!dump.ok) throw new Error(`不该失败：${dump.error.message}`);
  return irToWorkspace(astToIr(dump.module, code));
}

/** 同上，但带上原语调用索引：验证「调用名 → 密码块」的接线。 */
function toWorkspaceWithPrimitives(code: string): SerializedWorkspace {
  const dump = dumpOf(code);
  if (!dump.ok) throw new Error(`不该失败：${dump.error.message}`);
  return irToWorkspace(astToIr(dump.module, code, buildPrimitiveIndex(payload)));
}

/** 摊平所有块（含嵌套输入与 next 链），按出现顺序。 */
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

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);

describe.skipIf(!hasPython)('AST 转储（dump.ts + 真 CPython）', () => {
  it('能解析外部函数，并带回行号', () => {
    const dump = dumpOf('def f(a):\n    return a\n');
    expect(dump.ok).toBe(true);
    if (!dump.ok) return;
    expect(dump.module._).toBe('Module');
    const body = dump.module.body as Array<{ _: string; lineno?: number }>;
    expect(body[0]._).toBe('FunctionDef');
    expect(body[0].lineno).toBe(1);
  });

  it('语法错误走正常分支：给出消息与行号，而不是抛异常', () => {
    const dump = dumpOf('def f(:\n    pass\n');
    expect(dump.ok).toBe(false);
    if (dump.ok) return;
    expect(dump.error.message.length).toBeGreaterThan(0);
    expect(dump.error.line).toBe(1);
  });

  it('源码里的引号/换行/中文不会把脚本拼坏（base64 嵌入）', () => {
    const source = 'def 混淆(a):\n    """说 "引号" 与 \\n 换行"""\n    return a\n';
    const dump = dumpOf(source);
    expect(dump.ok).toBe(true);
  });
});

describe.skipIf(!hasPython)('AST → IR → 块：能翻的结构必须保住', () => {
  const source = [
    'def mix(a, b):',
    '    c = a + b',
    '    if c > 255:',
    '        c = c - 256',
    '    return c',
    '',
    'TAG = [1, 2, 3]',
    '',
  ].join('\n');

  it('函数、形参、分支、返回、顶层列表都落到块上，且 0 诊断', () => {
    const state = toWorkspace(source);
    expect(state.diagnostics).toEqual([]);
    const roots = state.blocks.blocks;
    expect(roots.map((root) => root.type)).toEqual(['procedures_defreturn', 'variables_set']);

    const def = roots[0];
    expect(def.fields?.NAME).toBe('mix');
    const extra = def.extraState as { params: Array<{ name: string; type: string }>; hasStatements: boolean };
    expect(extra.params.map((param) => param.name)).toEqual(['a', 'b']);
    // AST 里没有领域类型：只能落到块模型的默认值，面板必须说明这一点。
    expect(extra.params.every((param) => param.type === 'bytes')).toBe(true);
    expect(extra.hasStatements).toBe(true);

    const types = flatten(state).map((block) => block.type);
    expect(types).toContain('variables_set');
    expect(types).toContain('controls_if');
    expect(types).toContain('logic_compare');
    expect(types).toContain('math_arithmetic');
    expect(types).toContain('variables_get');
    expect(types).toContain('lists_create_with');

    // 体内：c = a + b 之后接 if；if 的 DO0 里是 c = c - 256。
    const stack = def.inputs?.STACK?.block;
    expect(stack?.type).toBe('variables_set');
    expect(stack?.next?.block.type).toBe('controls_if');
    expect(stack?.next?.block.inputs?.DO0?.block.type).toBe('variables_set');
    // 返回值是变量 c，并且引用的是同一个变量 id（不能各建一份）。
    const returned = def.inputs?.RETURN?.block;
    expect(returned?.type).toBe('variables_get');
    const returnVarId = (returned?.fields?.VAR as { id: string }).id;
    expect(returnVarId).toBe((stack?.fields?.VAR as { id: string }).id);
    // 变量表里 a/b/c/TAG 各一条。
    expect(state.variables.map((variable) => variable.name)).toEqual(['a', 'b', 'c', 'TAG']);
  });

  it('确定性：同一段输入两次产出逐字相同的 JSON', () => {
    expect(JSON.stringify(toWorkspace(source))).toBe(JSON.stringify(toWorkspace(source)));
  });

  it('按位运算照出块，但必须标成「语义不同」：bit_operation 会强制 uint32', () => {
    const state = toWorkspace(['def f(a, b):', '    return a ^ b', ''].join('\n'));
    // 结构没丢：块还在，函数还是 defreturn。
    expect(state.blocks.blocks[0].type).toBe('procedures_defreturn');
    expect(flatten(state).some((block) => block.type === 'bit_operation')).toBe(true);
    // 但语义变了，必须明说——而且要和「未识别」分开：块已经出来了。
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0].line).toBe(2);
    expect(state.diagnostics[0].reason).toBe('semantic-drift');
    expect(state.diagnostics[0].detail).toContain('uint32');
  });

  it('for range(4) 落成 ctrl_iterate（TIMES 是值输入），0 诊断', () => {
    const state = toWorkspace(['def f():', '    acc = 0', '    for i in range(4):', '        acc = acc + i', '    return acc', ''].join('\n'));
    expect(state.diagnostics).toEqual([]);
    const loop = flatten(state).find((block) => block.type === 'ctrl_iterate');
    expect(loop).toBeTruthy();
    // 块模型里只有 ctrl_iterate 能逐字表达一参数 range：TIMES 直接接 4。
    expect(loop?.fields?.VAR).toBe('i');
    expect(loop?.inputs?.TIMES?.block.fields?.NUM).toBe('4');
  });

  it('range(0) 与非常量终点的 range 都与 Python 一致，不再报漂移', () => {
    // ctrl_iterate 生成 `for i in range(expr):`：expr 为 0/负数时 Python 一次也不执行，块也一样。
    const empty = toWorkspace(['def f():', '    for i in range(0):', '        pass', '    return 1', ''].join('\n'));
    expect(empty.diagnostics).toEqual([]);
    expect(flatten(empty).some((block) => block.type === 'ctrl_iterate')).toBe(true);

    const dynamic = toWorkspace(['def f(n):', '    acc = 0', '    for i in range(n):', '        acc = acc + i', '    return acc', ''].join('\n'));
    expect(dynamic.diagnostics).toEqual([]);
    const loop = flatten(dynamic).find((block) => block.type === 'ctrl_iterate');
    expect(loop?.inputs?.TIMES?.block.type).toBe('variables_get');
  });
});

describe.skipIf(!hasPython)('不支持的部分必须逐条带行号报出来', () => {
  it('列表推导式：只认字面量 range，其他形态报出来而不是静默丢', () => {
    const state = toWorkspace(['def f(xs):', '    return [i for i in xs]', ''].join('\n'));
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0].line).toBe(2);
    expect(state.diagnostics[0].reason).toBe('unsupported');
    expect(state.diagnostics[0].detail).toContain('range');
    // 返回值翻不出来 → 函数按无返回值生成，但块还在，用户能看到缺了什么。
    expect(state.blocks.blocks[0].type).toBe('procedures_defnoreturn');
  });

  it('分支里的 return 有落点限制：报出来而不是悄悄丢掉', () => {
    const state = toWorkspace(
      ['def g(a):', '    if a > 0:', '        return 1', '    return 2', ''].join('\n'),
    );
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0].line).toBe(3);
    expect(state.diagnostics[0].detail).toContain('return');
    // 末尾那个 return 仍然保住：函数依旧是 defreturn。
    expect(state.blocks.blocks[0].type).toBe('procedures_defreturn');
  });

  it('下标赋值（s[i] ^= rk[i]）报出来，不产出错块', () => {
    const state = toWorkspace(['def f(s, rk):', '    s[0] ^= rk[0]', '    return s', ''].join('\n'));
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0].line).toBe(2);
  });

  it('调用了工作区里没有的函数：报出来，不搭一个空调用块', () => {
    const state = toWorkspace(['def f(x):', '    return len(x)', ''].join('\n'));
    expect(state.diagnostics.some((diag) => (diag.detail ?? '').includes('len'))).toBe(true);
    expect(flatten(state).some((block) => block.type === 'procedures_callreturn')).toBe(false);
  });
});

describe.skipIf(!hasPython)('两段式入口：模板优先，外部代码才走 AST', () => {
  /**
   * 模板路径认不出的外来代码：列表推导式（`core-syntax` 只认控制流与基础运算，推导式没有块）。
   * 前几轮这段样本是「纯算术 + 按位」，§41 之后模板路径已经能读，不再算外来代码——那是本轮
   * 想要的方向，所以样本换成真正读不回的形态。
   */
  const foreign = [
    'def sub_byte(x):',
    '    y = x ^ 0x63',
    '    x += 1',
    '    return y',
    '',
    'SBOX = [v for v in range(4)]',
    '',
  ].join('\n');

  it('外部函数走 AST 路径并产出块', async () => {
    const result = await reverseCodeAuto(foreign, payload, { astRunner: hostPython });
    expect(result.path).toBe('ast');
    expect(result.state.blocks.blocks.length).toBeGreaterThan(0);
    expect(result.stats.procedures).toBe(1);
    // 这段里有 `^`：结构能出，但按位块会强制 uint32，必须计入「不完整」。
    expect(result.astStats?.unsupported).toBeGreaterThan(0);
    expect(result.state.diagnostics.some((diag) => (diag.detail ?? '').includes('uint32'))).toBe(true);
    expect(result.state.diagnostics.some((diag) => diag.reason === 'semantic-drift')).toBe(true);
  });

  it('纯算术的外部函数：模板路径现在能自己读完，不再降级成「外来代码」', async () => {
    const arithmetic = ['def shift(x):', '    y = x + 1', '    if y > 8:', '        y = y - 8', '    return y', ''].join('\n');
    const result = await reverseCodeAuto(arithmetic, payload);
    expect(result.path).toBe('template');
    expect(result.state.diagnostics).toEqual([]);
    expect(result.state.blocks.blocks.length).toBe(1);
  });

  it('按位运算读得出来但要记漂移：不算「外来代码」，也不会静默改语义', async () => {
    const bitwise = ['def sub_byte(x):', '    y = x ^ 0x63', '    return y', ''].join('\n');
    const result = await reverseCodeAuto(bitwise, payload);
    expect(result.path).toBe('template');
    expect(result.state.diagnostics).toHaveLength(1);
    expect(result.state.diagnostics[0].reason).toBe('semantic-drift');
    expect(result.state.diagnostics[0].detail).toContain('uint32');
  });

  it('没有注入宿主时保持旧行为：明确拒绝而不是静默半成品', async () => {
    const result = await reverseCodeAuto(foreign, payload);
    expect(result.path).toBe('unsupported');
    expect(result.state.blocks.blocks).toEqual([]);
    expect(result.state.diagnostics[0].reason).toBe('foreign-code');
    expect(result.stats.foreignDefs).toEqual(['sub_byte']);
  });

  it('语法错误给出可读原因，且不产出块', async () => {
    const result = await reverseForeignCode('def f(:\n    pass\n', hostPython);
    expect(result.state.blocks.blocks).toEqual([]);
    expect(result.error).toContain('行');
  });
});

describe.skipIf(!hasPython)('外来代码里的已知原语调用（P2.3d）', () => {
  /** 两个 sha3 调用是模板路径认不出的密码块原语；字面量推导式则是两条路径都认的写法。 */
  const withPrimitives = [
    'def expand(seed, block):',
    '    absorbed = sha3_absorb(seed, block)',
    '    squeezed = sha3_squeeze(absorbed, 32)',
    '    return squeezed',
    '',
    'TABLE = [v for v in range(4)]',
    '',
  ].join('\n');

  it('调用名对得上块时直接产出密码块，不再报「工作区里没有这个函数」', async () => {
    const result = await reverseCodeAuto(withPrimitives, payload, { astRunner: hostPython });
    expect(result.path).toBe('ast');
    const types = flatten(result.state).map((block) => block.type);
    expect(types).toContain('sponge_absorb');
    expect(types).toContain('sponge_squeeze');
    // 三处调用的参数位置与模板槽位一一对应：absorb(seed, block)、squeeze(absorbed, 32)。
    expect(result.state.diagnostics.some((diag) => (diag.detail ?? '').includes('工作区里没有的函数'))).toBe(false);
    // 推导式现在也认（P2.3d 第 1 条）：展开成 4 项的列表块，不再是「未识别」。
    expect(types).toContain('lists_create_with');
    expect(result.state.diagnostics.some((diag) => (diag.detail ?? '').includes('ListComp'))).toBe(false);
  });

  it('参数个数对不上时给出具体原因，而不是静默换块', () => {
    const state = toWorkspaceWithPrimitives(
      ['def f(state):', '    return sha3_squeeze(state)', ''].join('\n'),
    );
    const types = flatten(state).map((block) => block.type);
    expect(types).not.toContain('sponge_squeeze');
    const diag = state.diagnostics.find((item) => (item.detail ?? '').includes('sha3_squeeze'));
    expect(diag?.detail).toContain('只认 2 个参数');
  });

  it('原语调用带关键字参数时拒绝：字段回填没做，认下来会静默用默认值', () => {
    const state = toWorkspaceWithPrimitives(
      ['def f(data):', '    return sha3_pad(data, suffix=0x1f)', ''].join('\n'),
    );
    const types = flatten(state).map((block) => block.type);
    expect(types).not.toContain('sponge_pad');
    expect(state.diagnostics.some((item) => (item.detail ?? '').includes('不接受关键字参数'))).toBe(true);
  });
});
