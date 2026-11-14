/**
 * 把两席 IR 产物组装成真实 workspace JSON，交给仓库的 Blockly 无头 harness 加载。
 *
 * 为什么需要这一步：打分器只做「规范化后逐块比较」，证明的是两棵树的形状相同；
 * 它不经过 Blockly 的注册表、连接检查与生成器。本脚本把产物落成 workspace JSON，
 * 再由 dist-verify/verify-demo.js 走 `Blockly.serialization.workspaces.load` 加载、
 * 生成 Python/JS 并执行官方向量——这才是「产物能被产品真正吃下」的证据。
 *
 * 用法：
 *   node experiments/ir-mlkem-2026-11-14/load-check.mjs
 * 产物：
 *   runs/<id>/assembled.workspace.json   —— 组装后的工作区
 *   runs/<id>/by-demo.ir.json            —— 扁平 IR（喂 demo harness 用）
 */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleIr, canonicalWorkspace, sameCanonical } from '../lib/block-ir.mjs';

const expDir = import.meta.dirname;
const truth = JSON.parse(readFileSync(resolve(expDir, 'ground-truth.json'), 'utf8'));
const truthCanonical = canonicalWorkspace(truth);

let failed = 0;
for (const id of ['A1', 'A2']) {
  const dir = resolve(expDir, 'runs', id);
  const ir = JSON.parse(readFileSync(resolve(dir, 'output.json'), 'utf8'));
  const workspace = assembleIr(ir);
  const canonical = canonicalWorkspace(workspace);
  const same = sameCanonical(canonical, truthCanonical);

  writeFileSync(resolve(dir, 'assembled.workspace.json'), `${JSON.stringify(workspace, null, 1)}\n`);

  let nodes = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    nodes += 1;
    for (const child of Object.values(n.inputs || {})) walk(child.block ?? child);
    if (n.next) walk(n.next.block ?? n.next);
  };
  for (const top of workspace.blocks.blocks) walk(top);

  process.stdout.write(`[${id}] assembled blocks=${nodes} canonical==ground-truth: ${same}\n`);
  if (!same) failed += 1;
}

process.exit(failed ? 1 : 0);
