/**
 * 模板路径的核心语法层（`reverse/core-syntax.ts`，B2 / S3 P2.3c 第一刀）
 *
 * 这组用例只测「拆得对不对」：按 Python 优先级拆表达式、按缩进拆语句，产出与 AST 路径
 * 同一套块形状。生成器那边的一致性由 `ai-helper-reverse-ast-roundtrip.test.ts` 的闭链判据
 * 守（生成的代码必须能被这一层读回同一段程序）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseClosureNames, parseFieldPayload } from '@/services/ai-helper/reverse';
import { buildMatchers } from '@/services/ai-helper/reverse';
import { parsePythonBody, parseValue } from '@/services/ai-helper/reverse/core-syntax';
import type { CoreContext } from '@/services/ai-helper/reverse/core-syntax';
import type { ParsedNode } from '@/services/ai-helper/reverse';

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);

function context(procedures: Array<[string, string[]]> = []): CoreContext {
  return { matchers: buildMatchers(payload), procedures: new Map(procedures), diagnostics: [] };
}

/** 树 → 一行形状串：类型(字段) 子输入。比 JSON 好读，断言里能直接看出结构错在哪。 */
function shape(node: ParsedNode): string {
  const tags = Object.entries(node.fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',');
  const children = node.children
    .map((child) => `${child.input}:${shape(child.node)}`)
    .join(' ');
  return `${node.type}${tags ? `(${tags})` : ''}${children ? `{${children}}` : ''}`;
}

function value(text: string, ctx = context()): string {
  return shape(parseValue(text, ctx));
}

describe('表达式：按 Python 优先级拆', () => {
  it('乘除优先于加减，且左结合', () => {
    expect(value('a + b * c')).toBe(
      'math_arithmetic(OP=ADD){A:variables_get(VAR=a) B:math_arithmetic(OP=MULTIPLY){A:variables_get(VAR=b) B:variables_get(VAR=c)}}',
    );
    expect(value('a - b - c')).toContain('A:math_arithmetic(OP=MINUS)');
  });

  it('一元负号比乘号紧、比幂松', () => {
    // -a * b == (-a) * b：乘号先拆。
    expect(value('-a * b')).toBe(
      'math_arithmetic(OP=MULTIPLY){A:math_single(OP=NEG){NUM:variables_get(VAR=a)} B:variables_get(VAR=b)}',
    );
    // -a ** b == -(a ** b)：一元负号在幂之后收。
    expect(value('-a ** b')).toBe(
      'math_single(OP=NEG){NUM:math_arithmetic(OP=POWER){A:variables_get(VAR=a) B:variables_get(VAR=b)}}',
    );
  });

  it('幂右结合，模运算落 math_modulo', () => {
    expect(value('a ** b ** c')).toContain(
      'math_arithmetic(OP=POWER){A:variables_get(VAR=a) B:math_arithmetic(OP=POWER)',
    );
    expect(value('a % b')).toBe(
      'math_modulo{DIVIDEND:variables_get(VAR=a) DIVISOR:variables_get(VAR=b)}',
    );
  });

  it('比较、and/or、条件表达式、下标', () => {
    expect(value('a < b')).toBe(
      'logic_compare(OP=LT){A:variables_get(VAR=a) B:variables_get(VAR=b)}',
    );
    // `a and b or c` == (a and b) or c：or 是最后拆的。
    expect(value('a and b or c')).toContain('logic_operation(OP=OR){A:logic_operation(OP=AND)');
    expect(value('first if flag else xs[1]')).toBe(
      'logic_ternary{IF:variables_get(VAR=flag) THEN:variables_get(VAR=first) ELSE:lists_getIndex(MODE=GET,WHERE=FROM_START){VALUE:variables_get(VAR=xs) AT:data_value(NUM=1)}}',
    );
  });

  it('调用只认本模块 procedure：名字不在名单里就不猜', () => {
    const known = context([['inc', ['x']]]);
    const call = parseValue('inc(x)', known);
    expect(call.type).toBe('procedures_callreturn');
    // 调用块靠 extraState 记住函数名与形参：与 AST 路径同一套字段。
    expect(call.extraState).toEqual({ name: 'inc', params: ['x'] });
    expect(call.children.map((child) => child.input)).toEqual(['ARG0']);
    expect(value('unknown_fn(x)')).toContain('UNRESOLVED');
  });

  it('按位运算出块，但必须记一条语义漂移', () => {
    const ctx = context();
    expect(shape(parseValue('a ^ b', ctx))).toContain('bit_operation(OP=XOR)');
    expect(ctx.diagnostics).toHaveLength(1);
    expect(ctx.diagnostics?.[0].reason).toBe('semantic-drift');
  });
});

describe('语句：按缩进拆', () => {
  it('if / elif / else：分支数与 else 都进 extraState', () => {
    const parsed = parsePythonBody(
      ['if a > 0:', '    b = 1', 'elif a == 0:', '    b = 2', 'else:', '    b = 3'],
      context(),
    );
    expect(parsed.statements).toHaveLength(1);
    const node = parsed.statements[0].node;
    expect(node.type).toBe('controls_if');
    expect(node.extraState).toEqual({ elseIfCount: 1, hasElse: true });
    // IF0/DO0/IF1/DO1/ELSE 五个输入，体是 chain。
    expect(node.children.map((child) => child.input)).toEqual(['IF0', 'DO0', 'IF1', 'DO1', 'ELSE']);
    expect(node.children[1].node.type).toBe('chain');
  });

  it('while + break：体内语句串成 next 链', () => {
    const parsed = parsePythonBody(['while a > 0:', '    a = a - 1', '    break'], context());
    const node = parsed.statements[0].node;
    expect(node.type).toBe('controls_whileUntil');
    expect(node.fields.MODE).toBe('WHILE');
    const body = node.children.find((child) => child.input === 'DO')?.node;
    expect(body?.type).toBe('chain');
    expect(body?.children).toHaveLength(2);
  });

  it('for range(3)：一参数落 ctrl_iterate；range(n) 与 range(0) 都逐字对应 Python', () => {
    const literal = parsePythonBody(['for i in range(3):', '    x = i'], context());
    const loop = literal.statements[0].node;
    expect(loop.type).toBe('ctrl_iterate');
    expect(loop.fields.VAR).toBe('i');
    expect(shape(loop.children.find((child) => child.input === 'TIMES')!.node)).toContain('NUM=3');

    // TIMES 是值输入，变量次数不需要漂移诊断（`range(n)` 一次也不执行时块也一样）。
    const dynamic = context();
    const variableLoop = parsePythonBody(['for i in range(n):', '    x = i'], dynamic);
    expect(variableLoop.statements[0].node.type).toBe('ctrl_iterate');
    expect(shape(variableLoop.statements[0].node)).toContain('variables_get(VAR=n)');
    expect(dynamic.diagnostics).toEqual([]);

    // 常量空区间同样是 ctrl_iterate(NUM=0)：生成 `for i in range(0):`，与 Python 一致。
    const empty = context();
    const zero = parsePythonBody(['for i in range(0):', '    x = i'], empty);
    expect(zero.statements[0].node.type).toBe('ctrl_iterate');
    expect(empty.diagnostics).toEqual([]);
  });

  it('两参数 range(a, b) 仍落 controls_for（闭区间语义）', () => {
    const parsed = parsePythonBody(['for i in range(2, 5):', '    x = i'], context());
    expect(parsed.statements[0].node.type).toBe('controls_for');
    expect(shape(parsed.statements[0].node)).toContain('TO:data_value(NUM=4)');
  });

  it('末尾 return 属于 RETURN 槽；嵌套 return 所在分支整条不产出（与 AST 同口径）', () => {
    const trailing = parsePythonBody(['a = 1', 'return a'], context(), { trailingReturn: true });
    expect(trailing.returnExpr).toBe('a');
    expect(trailing.statements).toHaveLength(1);

    // 块模型只有一个 RETURN 口：分支里的 return 没有落点。它所在的体因此变空，
    // 整个 if 不产出（AST 路径同样在体为空时整块不出），末尾 return 仍进 RETURN 槽。
    const nested = parsePythonBody(['if a > 0:', '    return 1', 'return 2'], context(), {
      trailingReturn: true,
    });
    expect(nested.statements[0].node.type).toBe('UNRESOLVED');
    expect(nested.returnExpr).toBe('2');
  });

  it('文档串跳过：生成器题头不算语句', () => {
    const parsed = parsePythonBody(
      ['"""', 'Crypto function: f', '"""', 'a = 1', 'return a'],
      context(),
      { trailingReturn: true },
    );
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.returnExpr).toBe('a');
  });
});
