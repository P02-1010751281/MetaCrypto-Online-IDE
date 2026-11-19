/**
 * P4 A 线 · 画布类型门探针（第二 / 第三份标准切片）
 *
 * 判决器（p4-verdicts.ts）说「某几步在画布上拼不出来」时，依据必须来自 Blockly 的运行时连接结果，
 * 而不是读 `BLOCK-IO-CONTRACT.json`。本脚本在 jsdom + Blockly 里**真的连一次**，每个用例一个
 * 期望（blocked / allowed），并同时记录契约层的 `compatibility()` 判定——两者同向且独立。
 *
 * 两份标准的用例（`--standard` 选择，默认 sp800-38b-cmac 以保持既有产物逐字节不变）：
 *   - sp800-38b-cmac：
 *     subkey-l:   mode_ecb_encrypt.Bytes  → cmac_double.X(IntList)    预期被拒
 *     subkey-K:   cmac_double.IntList     → cmac_subkeys.KEY(Bytes)   预期被拒
 *     mac-key:    mode_ecb_encrypt.Bytes  → cmac_mac.KEY(Bytes)       预期通过（正对照）
 *   - sp800-38c-ccm（分解链：格式化 → CBC-MAC / CTR）：
 *     nonce-format: data_int_list.IntList → ccm_b0.NONCE              预期通过
 *     b0-aad:       ccm_b0.IntList        → ccm_cbc_mac.AAD(IntList)  预期通过（同类型门正对照）
 *     b0-msg:       ccm_b0.IntList        → ccm_cbc_mac.MSG(Bytes)    预期被拒
 *     aadprefix-msg: ccm_aad_len_prefix.IntList → ccm_cbc_mac.MSG     预期被拒
 *     counter-ecb:  ccm_counter_block.IntList → mode_ecb_encrypt.DATA 预期被拒
 *     key-cbc:      mode_ecb_encrypt.Bytes → ccm_cbc_mac.KEY(Bytes)   预期通过（正对照）
 *
 * 用法：
 *   AIVERIFY_ENTRY=scripts/p4-connect-probe.ts AIVERIFY_OUTDIR=dist-verify/p4-connect \
 *     npx vite build --config vite.verify.config.ts
 *   node dist-verify/p4-connect/p4-connect-probe.js [--standard <id>] [--out <json>]
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

interface ProbeConfig {
  id: string;
  purpose: string;
  cases: Case[];
}

const PROBES: Record<string, ProbeConfig> = {
  'sp800-38b-cmac': {
    id: 'sp800-38b-cmac',
    purpose: '判定 SP 800-38B §6.1 的四步能否在画布上拼出来（运行时连接结果，不读契约 JSON）',
    cases: [
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
    ],
  },
  'sp800-38c-ccm': {
    id: 'sp800-38c-ccm',
    purpose: '判定 SP 800-38C CCM 的分解链能否在画布上拼出来：格式化产物（IntList）与 CBC-MAC/CTR 入口（Bytes）之间的关键类型门（运行时连接结果，不读契约 JSON）',
    cases: [
      {
        id: 'nonce-format',
        note: '§A.2 格式化的入口：7–13 字节 nonce 用 IntList 字面量喂 ccm_b0.NONCE',
        source: 'data_int_list',
        target: 'ccm_b0',
        targetInput: 'NONCE',
        expect: 'allowed',
      },
      {
        id: 'b0-aad',
        note: '同类型门正对照：ccm_b0 的 IntList 产物能接 ccm_cbc_mac 的 IntList 入口（只是类型门，B0 语义上不是 AAD）',
        source: 'ccm_b0',
        target: 'ccm_cbc_mac',
        targetInput: 'AAD',
        expect: 'allowed',
      },
      {
        id: 'b0-msg',
        note: '格式化产物接明文入口：ccm_b0（IntList）→ ccm_cbc_mac.MSG（Bytes），预期被拒',
        source: 'ccm_b0',
        target: 'ccm_cbc_mac',
        targetInput: 'MSG',
        expect: 'blocked',
      },
      {
        id: 'aadprefix-msg',
        note: 'AAD 长度前缀（IntList）接明文入口（Bytes），预期被拒——AAD 正文编码只能留在块闭包里',
        source: 'ccm_aad_len_prefix',
        target: 'ccm_cbc_mac',
        targetInput: 'MSG',
        expect: 'blocked',
      },
      {
        id: 'counter-ecb',
        note: 'S_i = AES_K(Ctr_i)：计数器块（IntList）接 AES 块 DATA（Bytes），预期被拒——画布不能单独算计数器密钥流',
        source: 'ccm_counter_block',
        target: 'mode_ecb_encrypt',
        targetInput: 'DATA',
        expect: 'blocked',
      },
      {
        id: 'key-cbc',
        note: '正对照：AES 块的 Bytes 输出接 ccm_cbc_mac.KEY（Bytes→Bytes）必须连得上',
        source: 'mode_ecb_encrypt',
        target: 'ccm_cbc_mac',
        targetInput: 'KEY',
        expect: 'allowed',
      },
    ],
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const standardIndex = process.argv.indexOf('--standard');
  const standardId = standardIndex >= 0 ? process.argv[standardIndex + 1] : 'sp800-38b-cmac';
  const probe = PROBES[standardId];
  if (!probe) {
    console.error(`未知标准 ${standardId}；可选：${Object.keys(PROBES).join(' / ')}`);
    process.exit(2);
  }
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

  const results = probe.cases.map((item) => {
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
    // 默认标准保持原产物形状；只有新标准才带 standard 字段。
    ...(standardId === 'sp800-38b-cmac' ? {} : { standard: standardId }),
    purpose: probe.purpose,
    cases: results,
    counts: {
      cases: results.length,
      blocked: results.filter((item) => item.blocked).length,
      allowed: results.filter((item) => item.connected).length,
      pass: results.filter((item) => item.pass).length,
      fail: failures.length,
    },
  };

  if (standardId !== 'sp800-38b-cmac') console.log(`PROBE standard=${standardId}`);
  for (const item of results) {
    console.log(`PROBE ${item.id.padEnd(14)} ${item.blocked ? 'BLOCKED' : 'CONNECTED'} ` +
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
