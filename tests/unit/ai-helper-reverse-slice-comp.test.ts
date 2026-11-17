/**
 * 两条路径的「切片 / 推导式」（P2.3d 第 1 条）
 *
 * 两条路径（模板层的核心语法层 / AST 路径）必须对同一段代码给出同一套块，所以断言分两组：
 *   - 模板路径只看形状串（`parseValue`），不依赖 Python；
 *   - AST 路径用本机 `python3` 跑真实转储脚本，断言块类型与诊断。
 *
 * 纪律：块模型的切片/列表都是「结构块」，语义边界（负索引、空区间、展开次数）必须
 * 要么明确拒绝、要么记漂移诊断，不许静默近似。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildMatchers, parseClosureNames, parseFieldPayload } from '@/services/ai-helper/reverse';
import type { ParsedNode } from '@/services/ai-helper/reverse';
import { buildAstDumpScript, readAstDump } from '@/services/ai-helper/reverse/ast/dump';
import { irToWorkspace } from '@/services/ai-helper/reverse/ast/blocks';
import { astToIr } from '@/services/ai-helper/reverse/ast/ir';
import { buildPrimitiveIndex } from '@/services/ai-helper/reverse/primitive-calls';
import { parsePythonBody, parseValue } from '@/services/ai-helper/reverse/core-syntax';
import type { CoreContext } from '@/services/ai-helper/reverse/core-syntax';
import type { SerializedBlock, SerializedWorkspace } from '@/services/ai-helper/reverse';

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

function shape(node: ParsedNode): string {
  const tags = Object.entries(node.fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',');
  const children = node.children.map((child) => `${child.input}:${shape(child.node)}`).join(' ');
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

describe('模板路径：切片', () => {
  it('a[1:2] → arr_slice，长度按 end - start 折成字面量', () => {
    expect(shape(parseValue('a[1:2]', context()))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:data_value(NUM=1) LENGTH:data_value(NUM=1)}',
    );
    expect(shape(parseValue('a[0:4]', context()))).toContain('LENGTH:data_value(NUM=4)');
  });

  it('负起点 + 负终点同号，长度仍是 end - start', () => {
    expect(shape(parseValue('a[-2:-1]', context()))).toContain('arr_slice');
    expect(shape(parseValue('a[-2:-1]', context()))).toContain('LENGTH:data_value(NUM=1)');
  });

  it('省略终点：a[i:] / a[:] 用 len(源) - 起点补长度（lists_length 生成就是 len）', () => {
    expect(shape(parseValue('a[i:]', context()))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:variables_get(VAR=i) '
        + 'LENGTH:math_arithmetic(OP=MINUS){A:lists_length{VALUE:variables_get(VAR=a)} B:variables_get(VAR=i)}}',
    );
    expect(shape(parseValue('a[:]', context()))).toBe(
      'arr_slice{LIST:variables_get(VAR=a) START:data_value(NUM=0) '
        + 'LENGTH:math_arithmetic(OP=MINUS){A:lists_length{VALUE:variables_get(VAR=a)} B:data_value(NUM=0)}}',
    );
    // 负起点同样走同一个减法块：arr_slice 的负起点先按长度归一，等价于 a[-2:]。
    expect(shape(parseValue('a[-2:]', context()))).toContain('LENGTH:math_arithmetic(OP=MINUS)');
  });

  it('步长 / 起终点异号 / 终点小于起点都拒绝，并说清原因', () => {
    for (const text of ['a[1:2:3]', 'a[-2:2]', 'a[2:1]']) {
      expect(shape(parseValue(text, context()))).toContain('UNRESOLVED');
    }
    // 拒绝的理由要具体，不是笼统的 UNRESOLVED。
    expect(parseValue('a[1:2:3]', context()).blocked?.detail).toContain('步长');
    expect(parseValue('a[-2:2]', context()).blocked?.detail).toContain('一正一负');
    expect(parseValue('a[2:1]', context()).blocked?.detail).toContain('非负');
  });

  it('起终点不是字面量：出块，但必须记漂移诊断', () => {
    const ctx = context();
    const parsed = parseValue('a[i:j]', ctx);
    expect(shape(parsed)).toContain('arr_slice');
    expect(shape(parsed)).toContain('LENGTH:math_arithmetic(OP=MINUS)');
    expect(ctx.diagnostics?.some((diag) => diag.reason === 'semantic-drift')).toBe(true);
  });
});

describe('模板路径：推导式', () => {
  it('[v for v in range(4)] 展开成四个字面量项', () => {
    const parsed = parseValue('[v for v in range(4)]', context());
    expect(shape(parsed)).toBe(
      'lists_create_with{ADD0:data_value(NUM=0) ADD1:data_value(NUM=1) ADD2:data_value(NUM=2) ADD3:data_value(NUM=3)}',
    );
  });

  it('表达式体按每个取值代换（v * 2 展开成乘法）', () => {
    const parsed = parseValue('[v * 2 for v in range(3)]', context());
    const text = shape(parsed);
    expect(text.match(/math_arithmetic\(OP=MULTIPLY\)/g)?.length).toBe(3);
    expect(text).toContain('data_value(NUM=2)');
  });

  it('空区间展开成空列表块', () => {
    expect(shape(parseValue('[v for v in range(0)]', context()))).toBe('lists_create_empty');
    expect(shape(parseValue('[v for v in range(4, 2)]', context()))).toBe('lists_create_empty');
  });

  it('非字面量区间 / 带 if 拒绝，且诊断点名缺 list append', () => {
    for (const text of ['[v for v in range(n)]', '[v for v in range(2) if v]']) {
      const parsed = parseValue(text, context());
      expect(shape(parsed)).toContain('UNRESOLVED');
      expect(parsed.blocked?.reason).toBe('unsupported');
      expect(parsed.blocked?.detail).toContain('append');
    }
    // 迭代器不是 range 的写法同样要落到 append 这个原语上。
    expect(parseValue('[v for v in xs]', context()).blocked?.detail).toContain('append');
  });

  it('多个生成器：字面量区间按笛卡尔积展开（外层 for 变化最慢）', () => {
    expect(shape(parseValue('[v for v in range(2) for w in range(2)]', context()))).toBe(
      'lists_create_with{ADD0:data_value(NUM=0) ADD1:data_value(NUM=0) '
        + 'ADD2:data_value(NUM=1) ADD3:data_value(NUM=1)}',
    );
    const summed = shape(parseValue('[v + w for v in range(2) for w in range(2)]', context()));
    expect(summed.match(/math_arithmetic\(OP=ADD\)/g)?.length).toBe(4);
  });

  it('展开后超过上限的推导式报诊断，不静默截断', () => {
    const parsed = parseValue('[v for v in range(8) for w in range(8) for u in range(2)]', context());
    expect(parsed.type).toBe('UNRESOLVED');
    expect(parsed.blocked?.detail).toContain('128');
  });

  it('语句里同样成立：SBOX = [v ^ 0x63 for v in range(4)]', () => {
    const parsed = parsePythonBody(['SBOX = [v ^ 0x63 for v in range(4)]'], context());
    expect(shape(parsed.statements[0].node)).toContain('variables_set');
    expect(shape(parsed.statements[0].node)).toContain('lists_create_with');
  });
});

describe.skipIf(!hasPython)('AST 路径：切片与推导式', () => {
  it('a[1:2] → arr_slice，参数是 LIST/START/LENGTH', () => {
    const state = astState(['def f(a):', '    return a[1:2]', ''].join('\n'));
    const block = flatten(state).find((item) => item.type === 'arr_slice');
    expect(block).toBeTruthy();
    expect(Object.keys(block?.inputs ?? {}).sort()).toEqual(['LENGTH', 'LIST', 'START']);
    expect(state.diagnostics).toEqual([]);
  });

  it('a[i:j] 出块并记漂移；a[i:] 用 len 补长度；a[1:2:3] 拒绝', () => {
    expect(astState(['def f(a, i, j):', '    return a[i:j]', ''].join('\n')).diagnostics[0]?.reason).toBe('semantic-drift');

    const tail = astState(['def f(a, i):', '    return a[i:]', ''].join('\n'));
    const slice = flatten(tail).find((block) => block.type === 'arr_slice');
    expect(Object.keys(slice?.inputs ?? {}).sort()).toEqual(['LENGTH', 'LIST', 'START']);
    expect(slice?.inputs?.LENGTH?.block.type).toBe('math_arithmetic');
    expect(slice?.inputs?.LENGTH?.block.inputs?.A?.block.type).toBe('lists_length');
    // 起点为正时源可能更短 → 负长度会被块拒绝，Python 返回空列表：一条漂移诊断。
    expect(tail.diagnostics).toHaveLength(1);
    expect(tail.diagnostics[0].reason).toBe('semantic-drift');

    expect(flatten(astState(['def f(a):', '    return a[1:2:3]', ''].join('\n'))).some((b) => b.type === 'arr_slice')).toBe(false);
  });

  it('多个生成器：AST 路径与模板路径展开出同样的项（范围 2×3）', () => {
    const state = astState(['def f():', '    return [v * 10 + w for v in range(2) for w in range(3)]', ''].join('\n'));
    const list = flatten(state).find((block) => block.type === 'lists_create_with');
    expect(list?.extraState).toEqual({ itemCount: 6 });
    expect(state.diagnostics).toEqual([]);
  });

  it('[v for v in range(4)] 展开成 lists_create_with / math_number', () => {
    const state = astState(['SBOX = [v for v in range(4)]', ''].join('\n'));
    const list = flatten(state).find((item) => item.type === 'lists_create_with');
    expect(list?.extraState).toEqual({ itemCount: 4 });
    expect(state.diagnostics).toEqual([]);
  });

  it('非常量 range 拒绝：展开次数不能静态确定', () => {
    const state = astState(['def f(n):', '    return [v for v in range(n)]', ''].join('\n'));
    expect(flatten(state).some((block) => block.type === 'lists_create_with')).toBe(false);
    expect(state.diagnostics.some((diag) => (diag.detail ?? '').includes('字面量'))).toBe(true);
  });
});
