/**
 * 确定性测量（不涉及模型）：
 *   1. 语料里「拼装」的规模分布：每个 Demo、每个 procedure 的块数；
 *   2. 同一个工作区在两种格式下必须产出的键数与文本体积；
 *   3. id 唯一性约束的数量（B 组必须满足的全局约束）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { flattenWorkspace, assembleIr } from '../../scripts/lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '../..');
const tests = JSON.parse(readFileSync(resolve(root, 'demos/tests.json'), 'utf8'));

function walkAll(node, fn) {
  if (!node) return;
  fn(node);
  if (node.next) walkAll(node.next, fn);
  if (node.inputs) for (const child of Object.values(node.inputs)) walkAll(child, fn);
}

function countKeys(node) {
  let keys = 0;
  walkAll(node, (n) => {
    keys += 1; // type
    if (n.fields) keys += Object.keys(n.fields).length;
    if (n.extraState) keys += 1;
    keys += Object.keys(n.inputs || {}).length;
    if (n.next) keys += 1;
  });
  return keys;
}

const rows = [];
for (const file of Object.keys(tests).sort()) {
  const doc = JSON.parse(readFileSync(resolve(root, 'demos', file), 'utf8'));
  const ir = flattenWorkspace(doc, file);
  let nodes = 0;
  const procedures = [];
  for (const node of ir.entry) {
    let size = 0;
    walkAll(node, () => { size += 1; });
    nodes += size;
    procedures.push({ name: node.fields?.NAME || node.type, size });
  }
  const assembled = assembleIr(ir);
  rows.push({
    file,
    nodes,
    procedures: procedures.length,
    maxProcedure: Math.max(...procedures.map((p) => p.size)),
    irKeys: countKeys(ir.entry[0] ? { type: 'root', inputs: Object.fromEntries(ir.entry.map((n, i) => [`e${i}`, n])) } : null),
    irBytes: Buffer.byteLength(JSON.stringify(ir)),
    jsonBytes: Buffer.byteLength(JSON.stringify(doc)),
    assembledBytes: Buffer.byteLength(JSON.stringify(assembled)),
    ids: nodes,
  });
}

const sorted = rows.slice().sort((a, b) => b.nodes - a.nodes);
const summary = {
  demos: rows.length,
  procedures: rows.reduce((sum, r) => sum + r.procedures, 0),
  nodes: rows.reduce((sum, r) => sum + r.nodes, 0),
  demosOver100: rows.filter((r) => r.nodes >= 100).length,
  demosUnder25: rows.filter((r) => r.nodes < 25).length,
};

const lines = [];
lines.push('# 确定性测量结果', '');
lines.push(`- Demo 工作区：**${summary.demos}** 个，块总数 **${summary.nodes}**，procedure 总数 **${summary.procedures}**`);
lines.push(`- ≥100 块的 Demo：**${summary.demosOver100}** 个；<25 块的 Demo：**${summary.demosUnder25}** 个`);
lines.push('');
lines.push('## 规模最大的 8 个工作区');
lines.push('');
lines.push('| Demo | 块数 | 过程数 | 单过程最大块数 | IR 字节 | JSON 字节（原始） | JSON 字节（组装后） | 必须唯一的 id 数 |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of sorted.slice(0, 8)) {
  lines.push(`| ${r.file} | ${r.nodes} | ${r.procedures} | ${r.maxProcedure} | ${r.irBytes} | ${r.jsonBytes} | ${r.assembledBytes} | ${r.ids} |`);
}
lines.push('');
lines.push('## 每个 procedure 的块数分布（全部工作区）');
lines.push('');
const allProc = [];
for (const file of Object.keys(tests)) {
  const ir = flattenWorkspace(JSON.parse(readFileSync(resolve(root, 'demos', file), 'utf8')), file);
  for (const node of ir.entry) {
    let size = 0;
    walkAll(node, () => { size += 1; });
    allProc.push({ file, name: node.fields?.NAME || node.type, size });
  }
}
allProc.sort((a, b) => a.size - b.size);
const pick = (p) => allProc[Math.min(allProc.length - 1, Math.floor(allProc.length * p))].size;
lines.push(`- procedure 总数 **${allProc.length}**；块数中位数 **${pick(0.5)}**，p90 **${pick(0.9)}**，最大 **${allProc.at(-1).size}**（${allProc.at(-1).file} 的 ${allProc.at(-1).name}）`);
lines.push(`- 只有 1 个块的 procedure：**${allProc.filter((p) => p.size === 1).length}** 个；≤3 块的：**${allProc.filter((p) => p.size <= 3).length}** 个`);
lines.push('');
writeFileSync(resolve(import.meta.dirname, 'MEASURED-CORPUS.md'), `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
