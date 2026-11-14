// @vitest-environment jsdom
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import '@/blocks/ccm';
import '@/blocks/data/number';
import '@/generators/javascript';
import '@/generators/javascript/ccm';
import '@/generators/python';
import '@/generators/python/ccm';

import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';

const pythonCommand = process.env.CIPHER_CAT_PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

/** SP 800-38C 附录 C.1 Example 1：Tlen=32、Nlen=56、Alen=64、Plen=32 */
const EX1 = {
  key: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f],
  nonce: [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16],
  aad: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07],
  /** C.1 公布的 密文‖标签：7162015b | 4dac255d */
  ctTag: [0x71, 0x62, 0x01, 0x5b, 0x4d, 0xac, 0x25, 0x5d],
  plain: '20212223',
  tagLen: 4,
};

/** 附录 C.2 Example 2：Tlen=48、Nlen=64、Alen=128、Plen=128，L=7 走另一条计数分支 */
const EX2 = {
  key: EX1.key,
  nonce: [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17],
  aad: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f],
  /** C.2 公布的 密文‖标签（22 字节）：16 字节密文 + 6 字节标签 */
  ctTag: [
    0xd2, 0xa1, 0xf0, 0xe0, 0x51, 0xea, 0x5f, 0x62, 0x08, 0x1a, 0x77, 0x92, 0x07, 0x3d, 0x59, 0x3d,
    0x1f, 0xc6, 0x4f, 0xbf, 0xac, 0xcd,
  ],
  plain: '202122232425262728292a2b2c2d2e2f',
  tagLen: 6,
};

type Vector = { key: number[]; nonce: number[]; aad: number[]; ctTag: number[]; tagLen: number };

function generate(
  language: 'javascript' | 'python',
  vector: Vector,
  overrides: { aad?: number[]; ctTag?: number[] } = {},
): string {
  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock('ccm_decrypt');
    if (block.getField('TAGLEN')) block.setFieldValue(String(vector.tagLen), 'TAGLEN');
    const lists: Record<string, number[]> = {
      KEY: vector.key,
      NONCE: vector.nonce,
      AAD: overrides.aad ?? vector.aad,
      CT: overrides.ctTag ?? vector.ctTag,
    };
    for (const [input, values] of Object.entries(lists)) {
      const source = workspace.newBlock('data_value');
      source.setFieldValue(`[${values.join(', ')}]`, 'NUM');
      block.getInput(input)!.connection!.connect(source.outputConnection!);
    }
    const generator = language === 'javascript' ? javascriptGenerator : pythonGenerator;
    return generator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

function evaluateJavaScript(program: string): string {
  const lines = program.trim().split('\n');
  const expression = lines.pop()!.replace(/;$/, '');
  return execFileSync(process.execPath, ['-e', [
    ...lines,
    `const result = ${expression};`,
    'console.log(Buffer.from(result).toString("hex"));',
  ].join('\n')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function evaluatePython(program: string): string {
  const lines = program.trim().split('\n');
  const expression = lines.pop()!;
  return execFileSync(pythonCommand, ['-c', [
    ...lines,
    `result = ${expression}`,
    'print(bytes(result).hex())',
  ].join('\n')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function runBoth(vector: Vector): [string, string] {
  return [
    evaluateJavaScript(generate('javascript', vector)),
    evaluatePython(generate('python', vector)),
  ];
}

describe('CCM decrypt block contract (SP 800-38C §6.2)', () => {
  it('recovers the published plaintext of Appendix C.1 Example 1', () => {
    const [js, py] = runBoth(EX1);
    expect(js).toBe(EX1.plain);
    expect(py).toBe(EX1.plain);
  });

  it('recovers the published plaintext of Appendix C.2 Example 2 (L=7, 6-byte tag)', () => {
    const [js, py] = runBoth(EX2);
    expect(js).toBe(EX2.plain);
    expect(py).toBe(EX2.plain);
  });

  it('rejects a tampered tag in both languages', () => {
    const tampered = [...EX1.ctTag];
    tampered[tampered.length - 1] ^= 0x01;
    const js = generate('javascript', EX1, { ctTag: tampered });
    const py = generate('python', EX1, { ctTag: tampered });
    expect(() => evaluateJavaScript(js)).toThrow();
    expect(() => evaluatePython(py)).toThrow();
  });

  it('rejects a tampered AAD (authentication covers the header)', () => {
    const wrongAad = [...EX1.aad];
    wrongAad[0] ^= 0x01;
    const js = generate('javascript', EX1, { aad: wrongAad });
    const py = generate('python', EX1, { aad: wrongAad });
    expect(() => evaluateJavaScript(js)).toThrow();
    expect(() => evaluatePython(py)).toThrow();
  });

  it('rejects Clen ≤ Tlen per §6.2 step 1 (empty payload is INVALID)', () => {
    // 恰好只有标签：Clen == Tlen，标准要求 INVALID，而不是返回空明文。
    const tagOnly = EX1.ctTag.slice(EX1.ctTag.length - EX1.tagLen);
    const js = generate('javascript', EX1, { ctTag: tagOnly });
    const py = generate('python', EX1, { ctTag: tagOnly });
    expect(() => evaluateJavaScript(js)).toThrow();
    expect(() => evaluatePython(py)).toThrow();
  });
});
