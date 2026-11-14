/**
 * 打分器：把四个运行目录的 output.json 与参考工作区（demos/procedures/CCM-Encrypt.json）逐项比对。
 *
 * 两族指标分开报：
 *   格式类  —— 产物是否是自己承诺的形状、有没有多余的键、id/坐标是否齐全且唯一；
 *   语义类  —— 与参考工作区的结构重合度（类型的多重集 F1、叶子(type+fields)多重集 F1、逐过程精确匹配）。
 *
 * 语义分数不是"正确率"：同一个标准义务可以有多种合法拼法，这里只是重合度。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { flattenWorkspace, assembleIr, canonicalWorkspace, validateIr, IrError } from '../lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '../..');
const expDir = import.meta.dirname;
const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));
const referenceDoc = JSON.parse(readFileSync(resolve(root, 'demos/procedures/CCM-Encrypt.json'), 'utf8'));
const referenceIr = flattenWorkspace(referenceDoc, 'reference');
const referenceCanonical = canonicalWorkspace(referenceDoc);

const walkAll = (node, fn) => {
  if (!node) return;
  fn(node);
  if (node.next) walkAll(node.next, fn);
  if (node.inputs) for (const child of Object.values(node.inputs)) walkAll(child, fn);
};

function signature(node) {
  return `${node.type}|${JSON.stringify(node.fields || {})}`;
}

function multiset(nodes) {
  const map = new Map();
  for (const node of nodes) map.set(node, (map.get(node) || 0) + 1);
  return map;
}

function f1(runCounts, refCounts) {
  let tp = 0;
  let runTotal = 0;
  let refTotal = 0;
  for (const [key, n] of runCounts) { runTotal += n; tp += Math.min(n, refCounts.get(key) || 0); }
  for (const n of refCounts.values()) refTotal += n;
  const precision = runTotal ? tp / runTotal : 0;
  const recall = refTotal ? tp / refTotal : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

const refSig = [];
const refTypes = [];
for (const node of referenceIr.entry) walkAll(node, (n) => { refSig.push(signature(n)); refTypes.push(n.type); });

function formatDefects(kind, doc) {
  const defects = [];
  const ids = new Map();
  const visit = (node, path, topLevel) => {
    if (!node || typeof node !== 'object') { defects.push(`${path}: 不是对象`); return; }
    if (typeof node.type !== 'string') defects.push(`${path}: 缺 type`);
    for (const key of Object.keys(node)) {
      const allowed = kind === 'ir'
        ? new Set(['type', 'fields', 'extraState', 'inputs', 'next', 'inline', 'disabled'])
        : new Set(['type', 'id', 'x', 'y', 'fields', 'extraState', 'inputs', 'next', 'inline', 'disabled']);
      if (!allowed.has(key)) defects.push(`${path}: 不允许的键 ${key}`);
    }
    if (kind === 'json') {
      if (node.id === undefined) defects.push(`${path}: 缺 id`);
      else ids.set(node.id, (ids.get(node.id) || 0) + 1);
      if (topLevel && (node.x === undefined || node.y === undefined)) defects.push(`${path}: 顶层块缺坐标`);
      if (!topLevel && (node.x !== undefined || node.y !== undefined)) defects.push(`${path}: 嵌套块不应带坐标`);
    } else if (node.id !== undefined || node.x !== undefined || node.y !== undefined) {
      defects.push(`${path}: IR 不应出现 id/坐标`);
    }
    const childOf = (value, path2) => {
      if (kind === 'json') {
        if (!value || typeof value !== 'object' || !('block' in value)) { defects.push(`${path2}: 输入未用 {"block": ...} 包装`); return; }
        visit(value.block, `${path2}.block`, false);
      } else {
        if (value && typeof value === 'object' && 'block' in value) { defects.push(`${path2}: IR 输入不应有 {"block": ...} 包装`); visit(value.block, `${path2}.block`, false); return; }
        visit(value, path2, false);
      }
    };
    for (const [name, child] of Object.entries(node.inputs || {})) {
      if (kind === 'json' && child && typeof child === 'object' && 'block' in child) childOf(child, `${path}.inputs.${name}`);
      else childOf(child, `${path}.inputs.${name}`);
    }
    if (node.next !== undefined) {
      if (kind === 'json') {
        if (!node.next || typeof node.next !== 'object' || !('block' in node.next)) defects.push(`${path}.next: 未用 {"block": ...} 包装`);
        else visit(node.next.block, `${path}.next.block`, false);
      } else visit(node.next, `${path}.next`, false);
    }
  };
  const entry = kind === 'ir' ? doc.entry : doc?.blocks?.blocks;
  if (!Array.isArray(entry)) { defects.push('顶层没有块数组'); return { defects, duplicateIds: 0 }; }
  entry.forEach((node, index) => visit(node, `entry[${index}]`, true));
  const duplicateIds = [...ids.values()].filter((n) => n > 1).length;
  if (duplicateIds) defects.push(`有 ${duplicateIds} 个 id 被重复使用`);
  return { defects, duplicateIds };
}

const results = [];
for (const run of ['A1', 'A2', 'B1', 'B2']) {
  const expected = run.startsWith('A') ? 'ir' : 'json';
  const file = resolve(expDir, 'runs', run, 'output.json');
  const result = { run, expected, exists: existsSync(file) };
  if (!result.exists) { results.push(result); continue; }
  const raw = readFileSync(file, 'utf8');
  result.bytes = Buffer.byteLength(raw);
  let doc;
  try { doc = JSON.parse(raw); } catch (error) { result.parseError = String(error.message); results.push(result); continue; }
  const detected = doc && typeof doc === 'object' && 'schema' in doc ? 'ir' : doc && typeof doc === 'object' && 'blocks' in doc ? 'json' : 'unknown';
  result.detected = detected;
  result.shapeMatches = detected === expected;

  let canonical = null;
  if (detected === 'ir') {
    const { defects } = formatDefects('ir', doc);
    result.formatDefects = defects;
    try {
      result.contractErrors = validateIr(doc, contract);
      canonical = canonicalWorkspace(assembleIr(doc));
    } catch (error) {
      result.assembleError = String(error.message);
    }
  } else if (detected === 'json') {
    const { defects, duplicateIds } = formatDefects('json', doc);
    result.formatDefects = defects;
    result.duplicateIds = duplicateIds;
    try {
      canonical = canonicalWorkspace(doc);
      const flat = flattenWorkspace(doc, 'reconstructed');
      result.contractErrors = validateIr(flat, contract);
    } catch (error) {
      result.assembleError = error instanceof IrError ? `flatten: ${error.message}` : String(error.message);
    }
  }

  if (canonical) {
    result.canonicalText = JSON.stringify(canonical);
    result.exactMatch = result.canonicalText === JSON.stringify(referenceCanonical);
    const runSig = [];
    const runTypes = [];
    for (const node of canonical.entry) walkAll(node, (n) => { runSig.push(signature(n)); runTypes.push(n.type); });
    result.typeF1 = f1(multiset(runTypes), multiset(refTypes));
    result.leafF1 = f1(multiset(runSig), multiset(refSig));
    const runNames = canonical.entry.filter((n) => n.type === 'procedures_defreturn').map((n) => n.fields?.NAME);
    result.procedures = runNames;
    const refNames = referenceCanonical.entry.filter((n) => n.type === 'procedures_defreturn').map((n) => n.fields?.NAME);
    result.missingProcedures = refNames.filter((name) => !runNames.includes(name));
    result.extraProcedures = runNames.filter((name) => !refNames.includes(name));
    result.procedureExact = refNames.filter((name) => {
      const ref = referenceCanonical.entry.find((n) => n.fields?.NAME === name);
      const got = canonical.entry.find((n) => n.fields?.NAME === name);
      return ref && got && JSON.stringify(ref) === JSON.stringify(got);
    }).length;
  }
  results.push(result);
}

const crossArm = [];
for (const a of results.filter((r) => r.run.startsWith('A') && r.canonicalText)) {
  for (const b of results.filter((r) => r.run.startsWith('B') && r.canonicalText)) {
    crossArm.push({ pair: `${a.run}≡${b.run}`, same: a.canonicalText === b.canonicalText });
  }
}
if (crossArm.length) process.stdout.write(`cross-arm: ${crossArm.map((c) => `${c.pair} ${c.same ? 'identical' : 'different'}`).join('; ')}\n`);

writeFileSync(resolve(expDir, 'RESULTS.json'), `${JSON.stringify(results, null, 2)}\n`);

const lines = ['# 实验结果', ''];
lines.push('| 运行 | 预期格式 | 识别为 | 形状正确 | 解析/组装 | 格式缺陷 | 契约错误 | 过程名齐 | 逐过程精确 | 类型 F1 | 叶子 F1 |');
lines.push('|---|---|---|---|---|---:|---:|---|---:|---:|---:|');
for (const r of results) {
  const ok = !r.exists || r.parseError || r.assembleError ? '✗' : '✓';
  lines.push(`| ${r.run} | ${r.expected} | ${r.detected || '—'} | ${r.shapeMatches ? '✓' : '✗'} | ${ok} | ${r.formatDefects ? r.formatDefects.length : '—'} | ${r.contractErrors ? r.contractErrors.length : '—'} | ${r.missingProcedures ? (r.missingProcedures.length ? `缺 ${r.missingProcedures.length}` : '✓') : '—'} | ${r.procedureExact ?? '—'}/7 | ${r.typeF1 ? r.typeF1.f1.toFixed(2) : '—'} | ${r.leafF1 ? r.leafF1.f1.toFixed(2) : '—'} |`);
}
lines.push('');
writeFileSync(resolve(expDir, 'RESULTS-TABLE.md'), `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
for (const r of results) {
  if (r.parseError) process.stdout.write(`${r.run} parseError: ${r.parseError}\n`);
  if (r.assembleError) process.stdout.write(`${r.run} assembleError: ${r.assembleError}\n`);
  if (r.formatDefects?.length) process.stdout.write(`${r.run} defects(${r.formatDefects.length}): ${r.formatDefects.slice(0, 5).join(' | ')}\n`);
  if (r.contractErrors?.length) process.stdout.write(`${r.run} contract(${r.contractErrors.length}): ${r.contractErrors.slice(0, 4).join(' | ')}\n`);
}
