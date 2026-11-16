// @vitest-environment node
/**
 * 反解析器（`src/services/ai-helper/reverse/`）的回归。
 *
 * 钉住四件事：
 *   1. 导出面：脚本侧薄转发（`scripts/ai-helper-reverse.ts`）与 src 模块是同一批函数；
 *   2. 模板匹配的槽位语义：子块槽位只在**括号深度 0**被下一个字面量截断，
 *      `arr_slice(gf2m_poly_xgcd(a, b), 0, 2)` 的 LIST 槽不能被嵌套调用的逗号切错；
 *   3. 字段来源（默认值、变体、通配字面量、scan_out 占位符）都能回填到 ParsedNode.fields；
 *   4. 语句单元与生成文件的块代码区切分（多行块整段吃下、procedure 体单独成组）。
 */

import { describe, expect, it } from 'vitest';

import {
  buildMatchers,
  locateBlockCode,
  matchStatementSpan,
  parseExpression,
  parseStatement,
  splitCode,
  splitStatementUnits,
} from '@/services/ai-helper/reverse';
import type {
  BlockFieldTemplate,
  CodeLayout,
  FieldPayload,
  Matcher,
  ParsedNode,
  StatementUnit,
} from '@/services/ai-helper/reverse';
import {
  buildMatchers as scriptBuildMatchers,
  parseExpression as scriptParseExpression,
} from '../../scripts/ai-helper-reverse';

/** 采集器条目的最小形态：只写这段测试关心的字段，其余给空值。 */
function block(
  type: string,
  template: string | null,
  extra: Partial<BlockFieldTemplate> = {},
): BlockFieldTemplate {
  return { type, template, fields: [], probes: [], invisible: [], constant: [], ...extra };
}

/** 下拉/数字字段的变体探针。 */
function variantProbe(name: string, value: string, template: string): BlockFieldTemplate['probes'][number] {
  return {
    name,
    visible: true,
    constant: false,
    variants: [{ value, template }],
    wildcard: null,
    emittedDefault: null,
    valueShape: null,
  };
}

/** 测试用合成模板表：覆盖槽位、字段、布尔翻转、通配字面量、scan_out 与多行块。 */
const payload: FieldPayload = {
  blocks: [
    block('arr_slice', 'arr_slice(zzsigv_LIST, zzfield_START, zzfield_LENGTH)'),
    block('gf2m_poly_xgcd', 'gf2m_poly_xgcd(zzsigv_A, zzsigv_B)'),
    block('wrap', 'wrap(zzsigv_INNER, zzfield_TAIL)'),
    block('sm9_sign', 'sm9_sign(zzsigv_MSG, zzfield_ID, True)', {
      fields: [{ name: 'ID', kind: 'text', defaultValue: 'alice', options: null }],
      probes: [variantProbe('ID', 'bob', 'sm9_sign(zzsigv_MSG, bob, True)')],
    }),
    block('sample_poly_cbd', 'sample_poly_cbd(zzsigv_SEED, 3)', {
      fields: [{ name: 'ETA', kind: 'field_number', defaultValue: '3', options: null }],
      probes: [
        {
          name: 'ETA',
          visible: true,
          constant: false,
          variants: [],
          wildcard: '3',
          emittedDefault: '3',
          valueShape: 'number',
        },
      ],
    }),
    block('ecc_multiply', 'ecc_multiply(zzsigv_POINT, scan_out)', {
      fields: [
        { name: 'times', kind: 'text', defaultValue: '2', options: null },
        { name: 'mode', kind: 'dropdown', defaultValue: 'affine', options: ['affine', 'jacobian'] },
      ],
    }),
    block(
      'aes_sub_bytes_cell',
      'aes_sub_bytes(s)\nfor i in range(4):\n    s = s + i',
    ),
  ],
};

const matchers: Matcher[] = buildMatchers(payload);

describe('导出面', () => {
  it('脚本侧薄转发与 src 模块是同一批函数', () => {
    expect(scriptBuildMatchers).toBe(buildMatchers);
    expect(scriptParseExpression).toBe(parseExpression);
  });
});

describe('buildMatchers', () => {
  it('严格档在前、宽松档在后，各自按字面量长度降序', () => {
    const firstRelaxed = matchers.findIndex((matcher) => matcher.relaxed);
    expect(firstRelaxed).toBeGreaterThan(0);
    const strict = matchers.slice(0, firstRelaxed);
    const relaxed = matchers.slice(firstRelaxed);
    expect(relaxed.some((matcher) => !matcher.relaxed)).toBe(false);
    for (const group of [strict, relaxed]) {
      const lengths = group.map((matcher) => matcher.literalChars);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    }
    // 只有带 True/False 字面量的块才有翻转档。
    expect(new Set(relaxed.map((matcher) => matcher.type))).toEqual(new Set(['sm9_sign']));
  });

  it('多行模板的行数就是块的边界', () => {
    const cell = matchers.find((matcher) => matcher.type === 'aes_sub_bytes_cell');
    expect(cell?.lineSpan).toBe(3);
  });
});

describe('parseExpression', () => {
  it('子块槽位只在括号深度 0 被下一个字面量截断（arr_slice 回归）', () => {
    const node: ParsedNode = parseExpression('arr_slice(gf2m_poly_xgcd(a, b), 0, 2)', matchers);
    expect(node.type).toBe('arr_slice');
    expect(node.fields).toEqual({ START: '0', LENGTH: '2' });
    expect(node.children).toHaveLength(1);
    expect(node.children[0].input).toBe('LIST');
    // 惰性正则会在嵌套调用的第一个逗号处截断，把 LIST 认成 `gf2m_poly_xgcd(a`；
    // 括号深度扫描必须一路吞到配平后的右括号。
    expect(node.children[0].node).toEqual({
      type: 'gf2m_poly_xgcd',
      fields: {},
      children: [
        { input: 'A', node: { type: 'variables_get', fields: { VAR: 'a' }, children: [] } },
        { input: 'B', node: { type: 'variables_get', fields: { VAR: 'b' }, children: [] } },
      ],
    });
  });

  it('引号里的括号与逗号不参与深度判断', () => {
    const node = parseExpression('wrap("a, b)", 1)', matchers);
    expect(node.type).toBe('wrap');
    expect(node.children).toHaveLength(1);
    expect(node.children[0].node).toEqual({ type: 'data_value', fields: { NUM: '"a, b)"' }, children: [] });
    expect(node.fields).toEqual({ TAIL: '1' });
  });

  it('字面量先于标识符、标识符先于模板匹配', () => {
    expect(parseExpression('None', matchers)).toEqual({ type: 'data_value', fields: { NUM: 'None' }, children: [] });
    expect(parseExpression('0x2a', matchers)).toEqual({ type: 'data_value', fields: { NUM: '0x2a' }, children: [] });
    expect(parseExpression('counter_1', matchers)).toEqual({
      type: 'variables_get',
      fields: { VAR: 'counter_1' },
      children: [],
    });
    // 列表字面量只认「里面全是数字」的形态：带表达式的中括号必须留给模板匹配。
    expect(parseExpression('[1, 2]', matchers).type).toBe('data_value');
    expect(parseExpression('[a[0] ^ b[0]]', matchers).type).toBe('UNRESOLVED');
  });

  it('生成器给子块补的外层括号会被剥掉，但模板自带括号的仍然整体命中', () => {
    expect(parseExpression('(gf2m_poly_xgcd(a, b))', matchers).type).toBe('gf2m_poly_xgcd');
    expect(parseExpression('(a) + (b)', matchers).type).toBe('UNRESOLVED');
  });

  it('默认模板命中即推定字段默认值，翻转形态只在严格档落空后兜底', () => {
    const strict = parseExpression('sm9_sign(m, bob, True)', matchers);
    expect(strict.type).toBe('sm9_sign');
    expect(strict.fields).toEqual({ ID: 'bob' });
    expect(strict.children.map((child) => child.input)).toEqual(['MSG']);

    // 采集器只测到默认形态（True），代码里是 False 时靠 relaxed 档认出同一块。
    const relaxed = parseExpression('sm9_sign(m, alice, False)', matchers);
    expect(relaxed.type).toBe('sm9_sign');
    expect(relaxed.fields).toEqual({ ID: 'alice' });
  });

  it('通配字面量版本负责「字段取值无法枚举」的数字字段', () => {
    // 默认模板（字面量 3）只对默认形态成立；换成 5 只能靠 zzfield_ 通配槽那版匹配器。
    expect(parseExpression('sample_poly_cbd(seed, 3)', matchers).type).toBe('sample_poly_cbd');
    const wild = parseExpression('sample_poly_cbd(seed, 5)', matchers);
    expect(wild.type).toBe('sample_poly_cbd');
    expect(wild.fields).toEqual({ ETA: '5' });
  });

  it('scan_out 占位符按字段声明顺序还原成真实字段名', () => {
    const node = parseExpression('ecc_multiply(point, 7)', matchers);
    expect(node.type).toBe('ecc_multiply');
    expect(node.fields).toEqual({ times: '7' });
  });

  it('同一输入槽重复取同一段代码只算一个子块', () => {
    const twice = buildMatchers({
      blocks: [block('ecc_load_point', 'ecc_load_point(zzsigv_POINT, zzsigv_POINT)')],
    });
    const node = parseExpression('ecc_load_point(p, p)', twice);
    expect(node.children).toHaveLength(1);
    expect(node.children[0].input).toBe('POINT');
  });
});

describe('parseStatement', () => {
  it('空行返回 EMPTY', () => {
    expect(parseStatement('   ', matchers)).toEqual({ type: 'EMPTY', fields: {}, children: [] });
  });

  it('模板优先于通用赋值，普通赋值退回 variables_set', () => {
    const call = parseStatement('arr_slice(gf2m_poly_xgcd(a, b), 0, 2)', matchers);
    expect(call.type).toBe('arr_slice');

    const assignment = parseStatement('y = gf2m_poly_xgcd(a, b)', matchers);
    expect(assignment.type).toBe('variables_set');
    expect(assignment.fields).toEqual({ VAR: 'y' });
    expect(assignment.children).toHaveLength(1);
    expect(assignment.children[0].input).toBe('VALUE');
    expect(assignment.children[0].node.type).toBe('gf2m_poly_xgcd');
  });

  it('认不出的语句保留 UNRESOLVED 而不是当赋值吞掉', () => {
    expect(parseStatement('print("hi")', matchers).type).toBe('UNRESOLVED');
  });
});

describe('splitStatementUnits / matchStatementSpan', () => {
  const source = ['header()', 'aes_sub_bytes(s)', 'for i in range(4):', '    s = s + i', '', 'footer()'].join('\n');

  it('多行块整段吃下，单行块一行一个单元', () => {
    const units: StatementUnit[] = splitStatementUnits(source, matchers);
    expect(units.map((unit) => unit.lines)).toEqual([1, 3, 1]);
    expect(units[0].text).toBe('header()');
    expect(units[1].text).toBe('aes_sub_bytes(s)\nfor i in range(4):\n    s = s + i');
    expect(units[2].text).toBe('footer()');
  });

  it('单行位置不试多行模板，多行位置按最长可匹配行数返回', () => {
    const lines = source.split('\n');
    expect(matchStatementSpan(lines, 0, matchers)).toBeNull();
    expect(matchStatementSpan(lines, 1, matchers)).toEqual({
      text: 'aes_sub_bytes(s)\nfor i in range(4):\n    s = s + i',
      lines: 3,
    });
  });
});

describe('locateBlockCode / splitCode', () => {
  const lines = [
    'import helper',
    'def helper(a):',
    '    return a',
    '',
    'def user_proc(v):',
    '    w = helper(v)',
    '    return w',
    '',
    'x = 1',
  ];
  const names = new Set(['user_proc']);

  it('跳过内嵌实现前缀，块代码从可一路切到结尾的地方开始', () => {
    expect(locateBlockCode(lines, matchers, names)).toBe(3);
  });

  it('块代码区里 procedure 体单独成组，其余顶层行留给语句切分', () => {
    const layout: CodeLayout = splitCode(lines, 3, names);
    expect(layout.closureDefs).toBe(1);
    expect([...layout.bodies.keys()]).toEqual(['user_proc']);
    // 空行按「procedure 体内缩进行」处理，保留在体内而不是另起语句。
    expect(layout.bodies.get('user_proc')).toEqual(['    w = helper(v)', '    return w', '']);
    // 块代码区起点的空行与 def 之后的空行各归其位：前者留在 topLevel，后者并进 procedure 体。
    expect(layout.topLevel).toEqual(['', 'x = 1']);
  });
});
