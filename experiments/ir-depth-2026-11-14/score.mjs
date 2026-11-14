/**
 * 大工作区打分器：把 4 个运行产物与合并后的 ground truth 逐过程比对。
 * 只做确定性比较，不参与生成。
 */
import process from 'node:process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  flattenWorkspace, assembleIr, canonicalWorkspace, validateIr, IrError,
} from '../lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '../..');
const expDir = import.meta.dirname;
const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));
const groundTruth = JSON.parse(readFileSync(resolve(expDir, 'ground-truth.json'), 'utf8'));
const referenceCanonical = canonicalWorkspace(groundTruth);
const refNames = referenceCanonical.entry.map((n) => n.fields?.NAME || n.type);

const walk = (node, fn) => {
  fn(node);
  for (const child of Object.values(node.inputs || {})) walk(child, fn);
  if (node.next) walk(node.next, fn);
};
const signature = (n) => `${n.type}|${JSON.stringify(n.fields || {})}`;
const multiset = (arr) => {
  const m = new Map();
  for (const k of arr) m.set(k, (m.get(k) || 0) + 1);
  return m;
};
function f1(runCounts, refCounts) {
  let tp = 0; let runTotal = 0; let refTotal = 0;
  for (const [k, n] of runCounts) { runTotal += n; tp += Math.min(n, refCounts.get(k) || 0); }
  for (const n of refCounts.values()) refTotal += n;
  const p = runTotal ? tp / runTotal : 0;
  const r = refTotal ? tp / refTotal : 0;
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}
const refTypes = []; const refSigs = [];
for (const node of referenceCanonical.entry) walk(node, (n) => { refTypes.push(n.type); refSigs.push(signature(n)); });
const refTypeCounts = multiset(refTypes); const refSigCounts = multiset(refSigs);
const TOTAL_BLOCKS = refTypes.length;
const TOTAL_PROCS = referenceCanonical.entry.length;
const chainLen = (doc) => {
  // 链长：从顶层块的 STACK 槽出发沿 next 走
  let best = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, child] of Object.entries(node.inputs || {})) {
      const c = child?.block ?? child;
      if (name === 'STACK') {
        let n = c, len = 0;
        while (n) { len++; n = n.next?.block ?? n.next ?? null; }
        best = Math.max(best, len);
      }
      visit(c);
    }
    if (node.next) visit(node.next?.block ?? node.next);
  };
  for (const top of doc.entry || []) visit(top);
  return best;
};
const maxDepth = (doc) => {
  const depth = (node, d) => {
    if (!node || typeof node !== 'object') return d;
    let best = d;
    for (const child of Object.values(node.inputs || {})) best = Math.max(best, depth(child?.block ?? child, d + 1));
    if (node.next) best = Math.max(best, depth(node.next?.block ?? node.next, d));
    return best;
  };
  let best = 0;
  for (const top of doc.entry || []) best = Math.max(best, depth(top, 1));
  return best;
};

const IR_KEYS = new Set(['type', 'fields', 'extraState', 'inputs', 'next', 'inline', 'disabled']);
const JSON_KEYS = new Set(['type', 'id', 'x', 'y', 'fields', 'extraState', 'inputs', 'next', 'inline', 'disabled']);

function formatDefects(kind, doc, limit = 40) {
  const defects = []; const ids = new Map(); let nodes = 0;
  const push = (msg) => { if (defects.length < limit) defects.push(msg); };
  const visit = (node, path, topLevel) => {
    if (!node || typeof node !== 'object') { push(`${path}: 不是对象`); return; }
    nodes++;
    if (typeof node.type !== 'string') push(`${path}: 缺 type`);
    const allowed = kind === 'ir' ? IR_KEYS : JSON_KEYS;
    for (const key of Object.keys(node)) if (!allowed.has(key)) push(`${path}: 不允许的键 ${key}`);
    if (kind === 'json') {
      if (node.id === undefined) push(`${path}: 缺 id`);
      else ids.set(node.id, (ids.get(node.id) || 0) + 1);
      if (topLevel && (node.x === undefined || node.y === undefined)) push(`${path}: 顶层块缺坐标`);
      if (!topLevel && (node.x !== undefined || node.y !== undefined)) push(`${path}: 嵌套块不应带坐标`);
    } else if (node.id !== undefined || node.x !== undefined || node.y !== undefined) {
      push(`${path}: IR 不应出现 id/坐标`);
    }
    for (const [name, child] of Object.entries(node.inputs || {})) {
      if (kind === 'json') {
        if (!child || typeof child !== 'object' || !('block' in child)) push(`${path}.inputs.${name}: 缺 {"block": …} 包装`);
        else visit(child.block, `${path}.inputs.${name}.block`, false);
      } else {
        if (child && typeof child === 'object' && 'block' in child) { push(`${path}.inputs.${name}: IR 不应有包装`); visit(child.block, `${path}.inputs.${name}`, false); }
        else visit(child, `${path}.inputs.${name}`, false);
      }
    }
    if (node.next !== undefined) {
      if (kind === 'json') {
        if (!node.next || typeof node.next !== 'object' || !('block' in node.next)) push(`${path}.next: 缺 {"block": …} 包装`);
        else visit(node.next.block, `${path}.next.block`, false);
      } else visit(node.next, `${path}.next`, false);
    }
  };
  const entry = kind === 'ir' ? doc.entry : doc?.blocks?.blocks;
  if (!Array.isArray(entry)) return { defects: ['顶层没有块数组'], duplicateIds: 0, nodes: 0 };
  entry.forEach((node, i) => visit(node, `entry[${i}]`, true));
  const duplicateIds = [...ids.values()].filter((n) => n > 1).length;
  if (duplicateIds) push(`${duplicateIds} 个 id 被重复使用`);
  return { defects, duplicateIds, nodes, ids: ids.size };
}

const results = [];
for (const run of ['A1', 'A2', 'B1', 'B2']) {
  const expected = run.startsWith('A') ? 'ir' : 'json';
  const runsDir = process.env.RUNS_DIR || 'runs';
  const file = resolve(expDir, runsDir, run, 'output.json');
  const result = { run, expected, exists: existsSync(file) };
  if (!result.exists) { results.push(result); continue; }
  const raw = readFileSync(file, 'utf8');
  result.bytes = Buffer.byteLength(raw);
  let doc;
  try { doc = JSON.parse(raw); } catch (error) { result.parseError = String(error.message); results.push(result); continue; }
  const detected = doc && typeof doc === 'object' && 'schema' in doc ? 'ir' : doc && typeof doc === 'object' && 'blocks' in doc ? 'json' : 'unknown';
  result.detected = detected;
  result.shapeMatches = detected === expected;
  if (detected !== expected) { results.push(result); continue; }

  const fd = formatDefects(detected, doc);
  result.formatDefects = fd.defects;
  result.formatDefectCount = fd.defects.length;
  result.duplicateIds = fd.duplicateIds;
  result.nodes = fd.nodes;
  result.ids = fd.ids ?? null;

  let canonical;
  try {
    if (detected === 'ir') {
      result.contractErrors = validateIr(doc, contract);
      canonical = canonicalWorkspace(assembleIr(doc));
    } else {
      canonical = canonicalWorkspace(doc);
      result.contractErrors = validateIr(flattenWorkspace(doc, 'reconstructed'), contract);
    }
  } catch (error) {
    result.assembleError = error instanceof IrError ? `flatten/assemble: ${error.message}` : String(error.message);
    results.push(result); continue;
  }
  result.contractErrorCount = result.contractErrors.length;

  // 按顺序（位置）比对：任务书要求顶层块顺序与 spec 一致；名字在此工作区里有重复
  // （GA/GM/GMod 在两个源 Demo 各有一份），按名字比对会塌成 45 个，故以位置为准。
  result.procedures = canonical.entry.filter((n) => n.type.startsWith('procedures_def')).length;
  result.topLevel = canonical.entry.length;
  result.missingProcedures = canonical.entry.length < refNames.length ? refNames.slice(canonical.entry.length) : [];
  const diffs = [];
  let exact = 0;
  for (const [i, ref] of referenceCanonical.entry.entries()) {
    const got = canonical.entry[i];
    const name = `${i}:${ref.fields?.NAME || ref.type}`;
    if (!got) { diffs.push(`${name}(缺)`); continue; }
    if (JSON.stringify(ref) === JSON.stringify(got)) exact++;
    else diffs.push(name);
  }
  result.procedureExact = exact;
  result.procedureTotal = refNames.length;
  result.differingProcedures = diffs;
  const runTypes = []; const runSigs = [];
  for (const node of canonical.entry) walk(node, (n) => { runTypes.push(n.type); runSigs.push(signature(n)); });
  result.typeF1 = f1(multiset(runTypes), refTypeCounts).f1;
  result.leafF1 = f1(multiset(runSigs), refSigCounts).f1;
  result.exactMatch = diffs.length === 0;
  result.chainLength = chainLen(canonical);
  result.maxDepth = maxDepth(canonical);
  result.canonicalText = JSON.stringify(canonical);
  result.compactBytes = Buffer.byteLength(JSON.stringify(doc));
  results.push(result);
}

const keys = Object.keys(Object.fromEntries(results.filter((r) => r.canonicalText).map((r) => [r.run, 1])));
const cross = [];
for (const a of keys.filter((k) => k.startsWith('A'))) {
  for (const b of keys.filter((k) => k.startsWith('B'))) {
    cross.push({ pair: `${a}≡${b}`, same: results.find((r) => r.run === a).canonicalText === results.find((r) => r.run === b).canonicalText });
  }
}

const suffix = process.env.REPORT_SUFFIX || '';
writeFileSync(resolve(expDir, `RESULTS-DEPTH${suffix}.json`), `${JSON.stringify({ results, cross }, null, 2)}\n`);

const lines = ['# 深度复测结果（语句链）', ''];
lines.push(`参考工作区：${TOTAL_PROCS} 个 procedure / ${TOTAL_BLOCKS} 块（ML-KEM 前 17 条语句的真实链，链长 17、最大缩进 29 层）。`, '');
lines.push('| 运行 | 格式 | 形状 | 文件字节 | 紧凑字节 | 块数 | 链长 | 最大深度 | id 数 | 格式缺陷 | 契约错误 | 逐过程精确 | 类型 F1 | 叶子 F1 | 整体同构 |');
lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const r of results) {
  if (!r.exists) { lines.push(`| ${r.run} | ${r.expected} | 缺产物 | — | — | — | — | — | — | — | — | — | — |`); continue; }
  if (r.parseError) { lines.push(`| ${r.run} | ${r.expected} | 解析失败 | ${r.bytes} | — | — | — | — | — | — | — | — | — |`); continue; }
  lines.push(`| ${r.run} | ${r.detected} | ${r.shapeMatches ? '✓' : '✗'} | ${r.bytes} | ${r.compactBytes ?? '—'} | ${r.nodes ?? '—'} | ${r.chainLength ?? '—'} | ${r.maxDepth ?? '—'} | ${r.ids ?? '—'} | ${r.formatDefectCount ?? '—'} | ${r.contractErrorCount ?? '—'} | ${r.procedureExact ?? '—'}/${TOTAL_PROCS} | ${r.typeF1?.toFixed(3) ?? '—'} | ${r.leafF1?.toFixed(3) ?? '—'} | ${r.exactMatch ? '✓' : '✗'} |`);
}
lines.push('');
if (cross.length) lines.push(`跨臂同构：${cross.map((c) => `${c.pair} ${c.same ? 'identical' : 'different'}`).join('；')}`, '');
writeFileSync(resolve(expDir, `RESULTS-DEPTH${suffix}.md`), `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
for (const r of results) {
  if (r.differingProcedures?.length) process.stdout.write(`${r.run} 不精确: ${r.differingProcedures.join(', ')}\n`);
  if (r.formatDefects?.length) process.stdout.write(`${r.run} 格式缺陷(前5): ${r.formatDefects.slice(0, 5).join(' | ')}\n`);
  if (r.contractErrors?.length) process.stdout.write(`${r.run} 契约错误(前3): ${r.contractErrors.slice(0, 3).join(' | ')}\n`);
}
