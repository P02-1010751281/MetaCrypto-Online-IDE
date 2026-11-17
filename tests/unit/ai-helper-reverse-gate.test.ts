// @vitest-environment jsdom
/**
 * 代码 → 工作区（B1b）的类型门禁回归：反解析产物不能只「代码逐块相等」，还要能过
 * 项目自己的类型检查器（`scripts/ai-helper-validate.ts` 的 `analyze`，与 validate CLI
 * 同一份实现）。
 *
 * 为什么值得单列一条判据：老的 `reverse --gate` 走 ParsedNode 形态，W' 里没有过程形参
 * 声明，1237 对里有 387 对（31.3%）只能记 unknown（RESULTS §22）。这条路径的产物带
 * `procedures_def*` + 形参 id/类型，配对结构相同（1237 对），mismatch 0、unknown 0。
 *
 * 一个必须说清的细节：demo 基线本身有 3 条 unknown（SHA3/SHA384/SHA512），因为它们的
 * 形参声明是 `message`——检查器词表里没有这一档。反解析只能看到生成器写的 Python 提示
 * `msg: bytes`，回填成 `bytes` 后这 3 对就变成可判定的 ok。所以这里的 0 unknown 有一半是
 * 「有损类型标签被抹平」的结果，不是反解析比 demo 更会定型；真正承重的是 mismatch 0 与
 * 配对数不缩水（1237）。
 *
 * 判据边界：类型自洽 ≠ 生成代码语义正确。后者仍由官方向量差分与 `verify:demos` 承担。
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
import { loadContract } from '../../scripts/ai-helper-contract';
import { analyze } from '../../scripts/ai-helper-validate';
import { parseFieldPayload, reverseCode } from '@/services/ai-helper/reverse';

setLocale(enMessages as unknown as Record<string, string>);

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);

/** 60 = demos/ 6 个 + demos/procedures/ 54 个；数据文件按 `blocks` 键排除。 */
function workspaceFiles(): string[] {
  return [
    ...readdirSync('demos').filter((name) => name.endsWith('.json')).map((name) => `demos/${name}`),
    ...readdirSync('demos/procedures')
      .filter((name) => name.endsWith('.json'))
      .map((name) => `demos/procedures/${name}`),
  ].filter((file) => {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { blocks?: unknown };
    return json.blocks !== undefined;
  });
}

function generatePython(state: unknown): string {
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

describe('反解析产物过类型门禁（60 个 demo）', () => {
  it('0 mismatch / 0 unknown，配对结构与 demo 基线一致', () => {
    const contract = loadContract();
    const files = workspaceFiles();
    expect(files).toHaveLength(60);

    const totals = { blocks: 0, pairs: 0, ok: 0, mismatch: 0, unknown: 0 };
    const failures: string[] = [];
    for (const file of files) {
      const result = reverseCode(generatePython(JSON.parse(readFileSync(file, 'utf8'))), payload);
      if (result.stats.diagnostics > 0) failures.push(`${file}: diagnostics=${result.stats.diagnostics}`);
      const report = analyze(result.state.blocks.blocks, contract);
      totals.blocks += report.blocks;
      totals.pairs += report.pairs;
      totals.ok += report.ok;
      totals.mismatch += report.mismatch;
      totals.unknown += report.unknown;
      for (const finding of report.findings.slice(0, 3)) {
        failures.push(`${file}: MISMATCH ${finding.path} ${finding.parent}.${finding.input}`);
      }
    }

    expect(failures).toEqual([]);
    // 1237 对与 `validate` 在 demo 基线（RESULTS §22）上的配对数相同：不是少判，
    // 而是同一批配对全部判成了 ok。
    expect(totals).toEqual({ blocks: 2151, pairs: 1237, ok: 1237, mismatch: 0, unknown: 0 });
  });
});
