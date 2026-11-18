/**
 * P4 A 线 CMAC 切片 · 画布类型门探针
 *
 * `verdicts-sp800-38b-cmac.json` 里 `02-Subkeys` 判「能搭」，理由是四步都在画布上：
 * L = mode_ecb_encrypt(0, key) → cmac_double → cmac_double → cmac_subkeys。
 * 但 `cmac_double` 的 X 输入 setCheck(IntList)，而 `mode_ecb_encrypt` 输出 Bytes，
 * 224 个块里没有 Bytes→IntList 的转换块。本探针在 jsdom + Blockly 里**真的连一次**，
 * 用运行时结果（而不是读契约 JSON）判定这四步能不能拼出来。
 *
 * 三个用例（正对照保证探针不是恒拒）：
 *   - subkey-l:   mode_ecb_encrypt.Bytes  → cmac_double.X(IntList)   预期被拒
 *   - subkey-K:   cmac_double.IntList     → cmac_subkeys.KEY(Bytes)  预期被拒
 *   - mac-key:    mode_ecb_encrypt.Bytes  → cmac_mac.KEY(Bytes)      预期通过
 *
 * 用法：
 *   AIVERIFY_ENTRY=scripts/p4-connect-probe.ts AIVERIFY_OUTDIR=dist-verify/p4-connect \
 *     npx vite build --config vite.verify.config.ts
 *   node dist-verify/p4-connect/p4-connect-probe.js [--out <json>]
 */
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';

type Globals = typeof globalThis & {
  document: unknown;
  window: unknown;
  DOMParser: unknown;
  XMLSerializer: unknown;
  Node: unknown;
  Element: unknown;
};

interface ConnectionLike {
  connect(other: ConnectionLike): void;
  isConnected(): boolean;
  getCheck(): string[] | null;
}

interface BlockLike {
  type: string;
  outputConnection: ConnectionLike | null;
  getInput(name: string): { connection: ConnectionLike | null } | null;
  dispose(): void;
}

interface WorkspaceLike {
  newBlock(type: string): BlockLike;
  dispose(): void;
}

interface Case {
  id: string;
  note: string;
  source: string;
  target: string;
  targetInput: string;
  expect: 'blocked' | 'allowed';
}

const CASES: Case[] = [
  {
    id: 'subkey-l',
    note: '§6.1 第一步 L = CIPH_K(0^b) 的产物接到加倍：Bytes → IntList',
    source: 'mode_ecb_encrypt',
    target: 'cmac_double',
    targetInput: 'X',
    expect: 'blocked',
  },
  {
    id: 'subkey-K',
    note: '§6.1 最后一步返回 K1‖K2：加倍产出的 IntList 接到只收 Bytes 的子密钥块',
    source: 'cmac_double',
    target: 'cmac_subkeys',
    targetInput: 'KEY',
    expect: 'blocked',
  },
  {
    id: 'mac-key',
    note: '正对照：同一份 Bytes 接 cmac_mac 的 KEY（Bytes→Bytes）必须连得上',
    source: 'mode_ecb_encrypt',
    target: 'cmac_mac',
    targetInput: 'KEY',
    expect: 'allowed',
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';

  // headless DOM 桩（必须先于 import Blockly）
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const globals = globalThis as Globals;
  globals.document = dom.window.document;
  globals.window = dom.window;
  globals.DOMParser = dom.window.DOMParser;
  globals.XMLSerializer = dom.window.XMLSerializer;
  globals.Node = dom.window.Node;
  globals.Element = dom.window.Element;

  const Blockly = (await import('blockly/core')).default ?? (await import('blockly/core'));
  const { setLocale } = await import('blockly/core');
  // 与 verify-project 同款用法；模块命名空间带 default，setLocale 只要 string 字典，这里显式窄化
  setLocale((await import('blockly/msg/en')) as unknown as { [key: string]: string });
  await import('blockly/blocks');
  await import('@/blocks');
  await import('@/generators/python');
  await import('@/generators/javascript');
  const { compatibility, inputCheck, loadContract, outputCheck } = await import('./ai-helper-contract');

  const workspace = new Blockly.Workspace() as unknown as WorkspaceLike;
  const contract = loadContract();

  const results = CASES.map((item) => {
    const source = workspace.newBlock(item.source);
    const target = workspace.newBlock(item.target);
    const inputConnection = target.getInput(item.targetInput)?.connection ?? null;
    const outputConnection = source.outputConnection;
    const expectedCheck = inputConnection?.getCheck() ?? null;
    const actualCheck = outputConnection?.getCheck() ?? null;

    let blocked = false;
    let message = '';
    if (!inputConnection) {
      blocked = true;
      message = `块 ${item.target} 没有值输入 ${item.targetInput}`;
    } else if (!outputConnection) {
      blocked = true;
      message = `块 ${item.source} 没有输出连接`;
    } else {
      try {
        inputConnection.connect(outputConnection);
        if (!inputConnection.isConnected()) {
          blocked = true;
          message = 'connect() 未抛错但连接未建立';
        }
      } catch (error) {
        blocked = true;
        message = errorMessage(error);
      }
    }
    const connected = inputConnection ? inputConnection.isConnected() : false;

    // 契约层的判定（与运行时结果分开记，二者不一致本身就是读数）
    const contractVerdict = compatibility(
      inputCheck(contract, item.target, item.targetInput),
      outputCheck(contract, item.source),
    );

    source.dispose();
    target.dispose();

    return {
      id: item.id,
      note: item.note,
      source: item.source,
      target: `${item.target}.${item.targetInput}`,
      sourceOutputCheck: actualCheck,
      targetInputCheck: expectedCheck,
      contractVerdict,
      connected,
      blocked,
      error: message,
      expect: item.expect,
      pass: item.expect === 'blocked' ? blocked : connected,
    };
  });

  const failures = results.filter((item) => !item.pass);
  const payload = {
    schemaVersion: 1,
    generatedBy: 'scripts/p4-connect-probe.ts',
    purpose: '判定 SP 800-38B §6.1 的四步能否在画布上拼出来（运行时连接结果，不读契约 JSON）',
    cases: results,
    counts: {
      cases: results.length,
      blocked: results.filter((item) => item.blocked).length,
      allowed: results.filter((item) => item.connected).length,
      pass: results.filter((item) => item.pass).length,
      fail: failures.length,
    },
  };

  for (const item of results) {
    console.log(`PROBE ${item.id.padEnd(10)} ${item.blocked ? 'BLOCKED' : 'CONNECTED'} ` +
      `src=${item.sourceOutputCheck?.join('|') ?? '-'} → ${item.target}=${item.targetInputCheck?.join('|') ?? '-'} ` +
      `contract=${item.contractVerdict} expect=${item.expect} ${item.pass ? 'PASS' : 'FAIL'}`);
    if (item.error) console.log(`       error: ${item.error}`);
  }
  console.log(`PROBE cases=${payload.counts.cases} blocked=${payload.counts.blocked} ` +
    `allowed=${payload.counts.allowed} pass=${payload.counts.pass} fail=${payload.counts.fail}`);

  if (outPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(process.cwd(), outPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`PROBE out=${outPath}`);
  }

  workspace.dispose();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
