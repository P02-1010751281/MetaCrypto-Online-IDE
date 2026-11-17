/**
 * 反解析的输入归一化与宽容比较（B1c）：
 *
 * - `normalizePythonSource` 只做不改变语义也不改变字段取值的清理（注释/空行/行尾空白）；
 * - `matchLiteralAt` 用值比较数字、用内容比较字符串、按边界放宽空白。
 *
 * 这里逐条钉住「允许什么」与「不允许什么」。放宽错方向的代价比收紧大：把 `fromximporty`
 * 认成 `from x import y` 会静默生成错块，比留一条诊断更糟。
 */

import { describe, expect, it } from 'vitest';

import { normalizePythonSource } from '@/services/ai-helper/reverse/normalize';
import { matchLiteralAt, readStringLiteral } from '@/services/ai-helper/reverse/tolerant';

describe('normalizePythonSource', () => {
  it('剥掉行注释、行尾空白与空行', () => {
    const input = '# 顶部注释\nx = 1   \n\n   \ny = 2\n# 中间\n';
    expect(normalizePythonSource(input)).toBe('x = 1\ny = 2');
  });

  it('字符串里的 # 不是注释', () => {
    expect(normalizePythonSource('h = "a#b"  # 真注释')).toBe('h = "a#b"');
    expect(normalizePythonSource("h = 'a#b'")).toBe("h = 'a#b'");
  });

  it('三重引号文档串整体保留，内部的 # 与空行不动', () => {
    const input = 'def f():\n    """\n    Crypto function: f  # 不是注释\n\n    """\n    return 1\n';
    expect(normalizePythonSource(input)).toBe('def f():\n    """\n    Crypto function: f  # 不是注释\n\n    """\n    return 1');
  });

  it('转义引号不会提前结束字符串', () => {
    expect(normalizePythonSource('a = "it\\"s"  # 注释')).toBe('a = "it\\"s"');
  });

  it('幂等：再跑一遍结果不变', () => {
    const once = normalizePythonSource('x = 1  # 注释\n\n\ny = "a#b"\n');
    expect(normalizePythonSource(once)).toBe(once);
  });
});

describe('matchLiteralAt（模板字面量 ↔ 源码）', () => {
  const at = (source: string, literal: string): number => matchLiteralAt(source, 0, literal);

  it('逐字相同走快路径', () => {
    expect(at('abc', 'abc')).toBe(3);
  });

  it('数字按值比较：0x1F 与 31 等价，写法不回写', () => {
    expect(at('rate_bytes=31', 'rate_bytes=0x1F')).toBe(13);
    expect(at('rate_bytes=0x1F', 'rate_bytes=31')).toBe(15);
    expect(at('x=0b101', 'x=5')).toBe(7);
  });

  it('大整数按 BigInt 精确比较，不受 double 精度影响', () => {
    const big = '0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFC';
    const dec = BigInt(big).toString();
    expect(at(`p=${dec}`, `p=${big}`)).toBe(2 + dec.length);
  });

  it('数字不相等就不匹配（31 与 32）', () => {
    expect(at('x=32', 'x=31')).toBe(-1);
  });

  it('字符串按内容比较：引号种类与引号转义不计', () => {
    expect(at("h = 'utf-8'", 'h = "utf-8"')).toBe(11);
    expect(at('h = "it\'s"', "h = 'it\\'s'")).toBe(10);
    expect(at('h = "a"', "h = 'b'")).toBe(-1);
  });

  it('空格可省，但两个标识符之间不能省', () => {
    expect(at('x = 1', 'x=1')).toBe(5);
    expect(at('x=1', 'x = 1')).toBe(3);
    expect(at('rate_bytes = 168', 'rate_bytes=168')).toBe(16);
    // `fromximporty` 不能被认成 `from x import y`
    expect(at('fromximporty', 'from x import y')).toBe(-1);
  });

  it('换行是硬边界：多行模板不会跨行吞代码', () => {
    expect(at('a = 1\nb = 2', 'a = 1\nb = 2')).toBe(11);
    expect(at('a = 1 b = 2', 'a = 1\nb = 2')).toBe(-1);
  });
});

describe('readStringLiteral', () => {
  it('读三重引号并保留内容', () => {
    expect(readStringLiteral('"""Crypto function: x""", 1', 0)).toEqual({ body: 'Crypto function: x', end: 24 });
  });

  it('未闭合时返回 null', () => {
    expect(readStringLiteral('"abc', 0)).toBeNull();
  });
});
