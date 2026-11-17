// @vitest-environment jsdom
/**
 * 代码 → 工作区（B1c）形变回归：用户从 LLM 拿到的代码不会与生成器逐字相同。
 *
 * 60 个 demo 的生成代码各做一次**单项形变**（其余不动），判据与全量回归相同：
 * 0 诊断 + 反解析结果再生成的代码块与形变后原文逐块相等。形变只改不影响语义的东西：
 * 插注释、删文档串、换引号、十六进制写十进制、关键字实参两侧加空格、插空行、行尾空格。
 *
 * 分母 60 = demos/ 的 6 个工作区 + demos/procedures/ 的 54 个。基线必须 60/60；
 * 其余各项的通过数就是「这一层现在能吃多少」，改动下降即为回归（RESULTS §37/§38）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';
import { pythonGenerator } from 'blockly/python';
import { describe, expect, it } from 'vitest';

import '@/blocks';
import '@/generators/python';
import { parseClosureNames, parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import { readStringLiteral } from '@/services/ai-helper/reverse/tolerant';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);
// 闭包名单是 procedure 判别的第三条来源（§38）：没有它，删掉 docstring 后整份文件都被当内嵌实现。
payload.closures = parseClosureNames(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/closure-names.json'), 'utf8'),
);

/** 代码块：一个 def（含体）或一条顶层语句；顺序不算证据。 */
function chunks(code: string): string[] {
  const lines = code
    .split('\n')
    .filter((line) => !/^[A-Za-z_]\w*\s*=\s*None\s*$/.test(line))
    .filter((line) => line.trim() !== '');
  const out: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const text = current.join('\n').trim();
    if (text) out.push(text);
    current = [];
  };
  for (const line of lines) {
    if (/^def\s/.test(line) || (!/^\s/.test(line) && current.length > 0)) flush();
    current.push(line);
  }
  flush();
  return out.sort();
}

/**
 * 整数字面量按值算：0x1F 与 31 是同一个字面量（与 matchers 的宽容规则同源）。
 * 用 BigInt 而不是 parseInt——SM2 的曲线参数是 256 位十六进制，double 会丢精度。
 */
function numberValue(raw: string): string {
  if (raw.includes('.')) return `f:${Number(raw)}`;
  return `i:${BigInt(raw).toString()}`;
}

/**
 * 语义规范化后的代码块：数字按值、字符串按内容、注释行与多余空白不计。
 * 判据是「反解析的工作区与原文同构」，所以比较前两边都过一遍这个函数。
 */
function canonicalChunks(code: string): string[] {
  return chunks(code).map(canonicalizeChunk).sort();
}

function canonicalizeChunk(chunk: string): string {
  const lines = chunk
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  let text = '';
  let prev = '';
  for (const line of lines) {
    let index = 0;
    while (index < line.length) {
      const ch = line[index];
      if (ch === '"' || ch === "'") {
        const literal = readStringLiteral(line, index);
        if (literal) {
          text += `"${literal.body}"`;
          prev = '"';
          index = literal.end;
          continue;
        }
      }
      if (ch >= '0' && ch <= '9' && !/[A-Za-z0-9_.]/.test(prev)) {
        const match = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)(?:\.\d+)?/.exec(line.slice(index));
        if (match) {
          text += numberValue(match[0]);
          prev = '0';
          index += match[0].length;
          continue;
        }
      }
      text += ch;
      prev = ch;
      index += 1;
    }
    text += '\n';
  }
  return text.replace(/[ \t]+/g, ' ').replace(/ ?([=,()[\]{}]) ?/g, '$1').trim();
}

function workspaceFiles(): string[] {
  const files = [
    ...readdirSync('demos').filter((name) => name.endsWith('.json')).map((name) => `demos/${name}`),
    ...readdirSync('demos/procedures')
      .filter((name) => name.endsWith('.json'))
      .map((name) => `demos/procedures/${name}`),
  ];
  return files.filter((file) => {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { blocks?: unknown };
    return json.blocks !== undefined;
  });
}

function generate(state: unknown): string {
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

const TRANSFORMS: Array<{ name: string; apply: (code: string) => string }> = [
  { name: 'baseline', apply: (code) => code },
  { name: 'comment-lines', apply: (code) => code.replace(/^([A-Za-z_])/gm, '# 步骤说明\n$1') },
  { name: 'docstring-strip', apply: (code) => code.replace(/^[ \t]*"""[\s\S]*?"""\n/gm, '') },
  { name: 'double-to-single-quote', apply: (code) => code.replace(/"/g, "'") },
  // BigInt 而不是 parseInt：SM2 的曲线参数是 256 位十六进制，parseInt 会变成 1.15e+77
  // 这种浮点写法，那已经不是同一个字面量了（形变工具自己的坑，与解析器无关）。
  { name: 'hex-to-decimal', apply: (code) => code.replace(/0x([0-9a-fA-F]+)/g, (_, hex: string) => BigInt(`0x${hex}`).toString()) },
  { name: 'spaces-around-kwargs', apply: (code) => code.replace(/([A-Za-z_]\w*)=([^=\s])/g, '$1 = $2') },
  { name: 'blank-lines', apply: (code) => code.replace(/\n/g, '\n\n') },
  { name: 'trailing-spaces', apply: (code) => code.split('\n').map((line) => (line.trim() ? `${line}   ` : line)).join('\n') },
];

describe('形变回归（60 个 demo × 8 种形变）', () => {
  it('每种形变的通过数与基线', { timeout: 300_000 }, () => {
    const files = workspaceFiles();
    expect(files).toHaveLength(60);
    const sources = files.map((file) => ({ file, code: generate(JSON.parse(readFileSync(file, 'utf8'))) }));
    const summary: Record<string, { ok: number; failures: string[] }> = {};
    for (const transform of TRANSFORMS) {
      let ok = 0;
      const failures: string[] = [];
      for (const item of sources) {
        const code = transform.apply(item.code);
        const result = reverseCode(code, payload);
        if (result.stats.diagnostics > 0) {
          failures.push(`${item.file}: diag=${result.stats.diagnostics}`);
          continue;
        }
        let regenerated: string;
        try {
          regenerated = generate(result.state);
        } catch (error) {
          failures.push(`${item.file}: LOAD ${(error as Error).message.slice(0, 60)}`);
          continue;
        }
        // 判据是「反解析得到的工作区与原文同构」，不是「再生成的文字与输入逐字相同」：
        // 注释被剥掉、引号被换掉、0x1F 写成 31 都不该算差异，故两边先做语义规范化再比。
        if (JSON.stringify(canonicalChunks(regenerated)) === JSON.stringify(canonicalChunks(item.code))) ok += 1;
        else failures.push(item.file);
      }
      summary[transform.name] = { ok, failures };
      // eslint-disable-next-line no-console
      console.log(`PERTURB ${transform.name}: ok=${ok}/${sources.length} ${JSON.stringify(failures.slice(0, 3))}`);
    }
    // 基线是硬判据：归一化与宽容比较不许把原本能反解析的代码弄坏。
    expect(summary.baseline.ok).toBe(60);
    // 其余各项是「当前能吃多少」，只准升不准降；数字与 RESULTS §38 的表一致。
    expect(summary['comment-lines'].ok).toBe(60);
    expect(summary['double-to-single-quote'].ok).toBe(60);
    expect(summary['hex-to-decimal'].ok).toBe(60);
    expect(summary['spaces-around-kwargs'].ok).toBe(60);
    expect(summary['blank-lines'].ok).toBe(60);
    expect(summary['trailing-spaces'].ok).toBe(60);
    // 删掉 docstring 后靠「闭包名单反选」判别 procedure（§39）：名单内是内嵌实现，
    // 名单外才是用户函数，60/60 与基线一致。
    expect(summary['docstring-strip'].ok).toBe(60);
  });
});
