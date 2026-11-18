#!/usr/bin/env node
/**
 * P3 第一步切片跑批脚本：C 子集 → 结构骨架/别名命中 → 差分（gcc vs 生成器再生成的代码）。
 *
 * 用法：
 *   node experiments/ai-helper-2026-11-14/p3/run-p3.mjs            # 全部阶段
 *   node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v0 # 只跑 V0（哈希/来源/别名可审）
 *   node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v1 # V0+V1
 *   node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v2 # V0..V2
 *   node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v3 # 全部
 *
 * 产物：
 *   p3/out/p3-summary.json   机器可读摘要（稳定结构，供后续脚本比对）
 *   p3/out/p3-summary.txt    人读摘要
 *   p3/out/ws-<id>.json      V2 映射出的块工作区（可被 dist-verify/verify-demo.js 载入）
 *   p3/out/gen-<id>.py       V3 里由工作区再生成的 Python（含向量驱动）
 *   p3/out/driver-<id>.c     V3 里 gcc 用的向量驱动
 *
 * 纪律：V0 对不上直接失败；V3 不可达时如实写原因，不跳过、不伪造。
 */
/* global Buffer */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseC } from './lib/c-parse.mjs';

const P3_DIR = import.meta.dirname;
const ROOT = path.resolve(P3_DIR, '../../..');
const SAMPLES_DIR = path.join(P3_DIR, 'samples');
const OUT_DIR = path.join(P3_DIR, 'out');
const CONTRACT_PATH = path.join(ROOT, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const HARNESS = process.env.P3_VERIFY_DEMO || path.join(ROOT, 'dist-verify/verify-demo.js');
const PYTHON = process.env.P3_PYTHON || 'python3';
const GCC = process.env.P3_GCC || 'gcc';

const args = process.argv.slice(2);
const stageArg = (() => {
  const i = args.indexOf('--stage');
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith('--stage='));
  return eq ? eq.split('=')[1] : 'all';
})();
const STAGES = { all: ['v0', 'v1', 'v2', 'v3'], v0: ['v0'], v1: ['v0', 'v1'], v2: ['v0', 'v1', 'v2'], v3: ['v0', 'v1', 'v2', 'v3'] };
const enabled = STAGES[stageArg];
if (!enabled) {
  console.error(`未知 --stage ${stageArg}（可用：v0 / v1 / v2 / v3 / all）`);
  process.exit(2);
}
const wants = (s) => enabled.includes(s);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');
const now = () => new Date().toISOString();

function runCommand(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error ? String(res.error.message || res.error) : null,
  };
}

const HEX = (h) => h.replace(/[^0-9a-fA-F]/g, '');
const toByteArrayLiteral = (hex) => {
  const h = HEX(hex);
  const parts = [];
  for (let i = 0; i < h.length; i += 2) parts.push(`0x${h.slice(i, i + 2)}`);
  return `{ ${parts.join(', ')} }`;
};
const toPyByteArray = (hex) => {
  const h = HEX(hex);
  const parts = [];
  for (let i = 0; i < h.length; i += 2) parts.push(`0x${h.slice(i, i + 2)}`);
  return `[${parts.join(', ')}]`;
};
const camel = (snake) => snake.split('_').filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('_');
// C 形参名直接进工作区会被双生成器原样写进函数签名；`in` 这类词在 Python 与 JS 都是保留字。
// 首跑 V3 就在这里红过（生成代码 SyntaxError），映射层必须清洗，不能指望用户改名。
const RESERVED = new Set([
  // Python
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'None', 'True', 'False',
  // JavaScript
  'var', 'let', 'const', 'function', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'switch',
  'case', 'default', 'do', 'catch', 'throw', 'extends', 'super', 'null', 'undefined', 'true', 'false',
]);
const sanitizeParam = (name) => (RESERVED.has(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? `${name}_` : name);
const defNameFor = (fnName) => `P3_${camel(fnName)
  .replaceAll('Aes', 'AES')
  .replaceAll('Sm4', 'SM4')
  .replaceAll('Ecb', 'ECB')
  .replaceAll('Cbc', 'CBC')}`;

// ---------------------------------------------------------------------------
// V0：样本哈希 / 来源 / 别名可审
// ---------------------------------------------------------------------------
function stageV0(manifest, aliasMap, contract) {
  const samples = [];
  const aliasNames = new Set(aliasMap.entries.map((e) => e.c.name));
  let ok = true;
  for (const s of manifest.samples) {
    const file = path.join(SAMPLES_DIR, s.file);
    const exists = fs.existsSync(file);
    const buf = exists ? fs.readFileSync(file) : Buffer.alloc(0);
    const actual = sha256(buf);
    const lines = exists ? buf.toString('utf8').split('\n').length - 1 : 0;
    const hashOk = actual === s.sha256;
    const linesOk = lines <= 40;
    // opaqueFunctions 是「函数体不解析」的豁免，必须只落在真被块吸收的函数上，
    // 否则它会变成「跳过分析」的万能开关。
    const opaque = s.opaqueFunctions || [];
    const opaqueUnknown = opaque.filter((name) => !aliasNames.has(name));
    const opaqueOk = opaqueUnknown.length === 0;
    if (!hashOk || !linesOk || !opaqueOk) ok = false;
    const deps = (s.dependsOn || []).map((dep) => {
      const depFile = path.join(SAMPLES_DIR, dep);
      const depActual = fs.existsSync(depFile) ? sha256(fs.readFileSync(depFile)) : null;
      return { file: dep, sha256: depActual, exists: fs.existsSync(depFile) };
    });
    samples.push({
      id: s.id,
      file: s.file,
      exists,
      expectedSha256: s.sha256,
      actualSha256: actual,
      hashOk,
      lines,
      linesOk,
      source: s.source,
      provenance: s.provenance,
      upstream: s.upstream ?? null,
      opaqueFunctions: opaque,
      opaqueOk,
      opaqueUnknown,
      standard: s.standard,
      license: s.license,
      retrieved: s.retrieved,
      verifyCommand: s.verifyCommand,
      dependsOn: deps,
      ok: exists && hashOk && linesOk && opaqueOk,
    });
  }

  // 别名表：≤8 条、C 名唯一、块必须在 222 键里、证据行仍含注册语句
  const aliasChecks = [];
  let aliasOk = aliasMap.entries.length <= 8;
  const seen = new Set();
  for (const e of aliasMap.entries) {
    const inContract = Object.prototype.hasOwnProperty.call(contract, e.block);
    const dup = seen.has(e.c.name);
    seen.add(e.c.name);
    const evidence = [];
    for (const [label, ev] of [
      ['blockDef', e.evidence.blockDef],
      ['generator', e.evidence.generator],
    ]) {
      const abs = path.join(ROOT, ev.file);
      const needle = label === 'blockDef'
        ? `Blockly.Blocks['${e.block}']`
        : `forBlock['${e.block}']`;
      let lineText = null;
      let found = false;
      if (fs.existsSync(abs)) {
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        lineText = (lines[ev.line - 1] || '').trim();
        found = lineText.includes(needle);
      }
      evidence.push({ label, file: ev.file, line: ev.line, found, lineText });
    }
    const evidenceOk = evidence.every((x) => x.found);
    const entryOk = inContract && !dup && evidenceOk;
    if (!entryOk) aliasOk = false;
    aliasChecks.push({
      c: e.c.name,
      block: e.block,
      inContract,
      duplicateCName: dup,
      evidence,
      evidenceOk,
      ok: entryOk,
    });
  }
  return {
    ok: ok && aliasOk,
    contractKeys: Object.keys(contract).length,
    sampleCount: samples.length,
    aliasCount: aliasMap.entries.length,
    aliasesOk: aliasOk,
    samples,
    aliases: aliasChecks,
  };
}

// ---------------------------------------------------------------------------
// V1：词法/结构解析
// ---------------------------------------------------------------------------
function stageV1(manifest) {
  const samples = [];
  for (const s of manifest.samples) {
    const file = path.join(SAMPLES_DIR, s.file);
    const sourceText = fs.readFileSync(file, 'utf8');
    let parsed = null;
    let error = null;
    try {
      parsed = parseC(sourceText, { opaqueFunctions: new Set(s.opaqueFunctions || []) });
    } catch (err) {
      error = String(err.message || err);
    }
    if (!parsed) {
      samples.push({ id: s.id, file: s.file, ok: false, error });
      continue;
    }
    const byKind = { unsupported: 0, 'semantic-drift': 0 };
    const byCode = {};
    for (const d of parsed.diagnostics) {
      byKind[d.kind] = (byKind[d.kind] || 0) + 1;
      byCode[d.code] = (byCode[d.code] || 0) + 1;
    }
    samples.push({
      id: s.id,
      file: s.file,
      ok: true,
      functions: parsed.functions.map((f) => ({
        name: f.name,
        line: f.line,
        returnType: f.returnType,
        params: f.params.map((p) => ({
          name: p.name,
          type: p.type,
          arraySize: p.arraySize,
          isConst: p.isConst,
          isPointer: p.isPointer ?? false,
        })),
        statements: f.body.length,
        bodySkipped: f.bodySkipped ?? false,
        bodyLines: f.bodyLines ?? null,
      })),
      globals: parsed.globals.map((g) => ({
        name: g.name,
        type: g.type,
        arraySize: g.arraySize,
        initKind: g.initKind,
        initLength: g.init?.elements?.length ?? null,
      })),
      preprocs: parsed.preprocs,
      constructCounts: parsed.constructCounts,
      callSites: parsed.callSites,
      diagnostics: parsed.diagnostics,
      diagnosticSummary: { total: parsed.diagnostics.length, byKind, byCode },
      error: null,
    });
  }
  return { ok: samples.every((s) => s.ok), samples };
}

// ---------------------------------------------------------------------------
// V2：别名映射 + 结构骨架 + 可生成工作区判定
// ---------------------------------------------------------------------------
function contractValueInputs(contract, blockType) {
  const entry = contract[blockType];
  if (!entry) return null;
  return (entry.inputs || []).filter((i) => i.name);
}

function paramBlockType(contract, blockType, index) {
  const inputs = contractValueInputs(contract, blockType) || [];
  const input = inputs[index];
  const check = input?.check || [];
  if (check.includes('Bytes')) return 'bytes';
  if (check.includes('IntList')) return 'int_list';
  if (check.includes('Number')) return 'int';
  if (check.includes('Print')) return 'print';
  return 'bytes';
}

function workspaceIdFactory(sampleId) {
  let n = 0;
  return () => `${sampleId.replaceAll('-', '_')}_n${(n += 1)}`;
}

function buildWholeAliasWorkspace({ fn, aliasEntry, contract, nextId }) {
  const block = aliasEntry.block;
  const blockInputs = contractValueInputs(contract, block);
  if (!blockInputs) return { ok: false, reason: `契约里没有块 ${block} 的输入定义` };
  const params = fn.params.map((p) => ({ ...p }));
  const returnedByOutParam = fn.returnType === 'void' && params.length === blockInputs.length + 1;
  if (params.length !== blockInputs.length && !returnedByOutParam) {
    return {
      ok: false,
      reason: `C 形参 ${params.length} 个，块 ${block} 的值输入 ${blockInputs.length} 个，位置对应不成立`,
    };
  }
  const valueParams = returnedByOutParam ? params.slice(0, blockInputs.length) : params;
  // 类型标签来源：定长数组与指针（如 tiny-AES-c 的 state_t*，typedef 展平后只剩 baseType）
  // 都表示「整块缓冲区」，必须问块的 IO 契约；只有标量才按 C 基础类型推断。
  // 指针形参一律标成 bytes 会与块的 IntList 输入自相矛盾（2026-11-18 接第三方样本时暴露）。
  const typeOfParam = (p, i) => {
    if (p.arraySize != null || p.isPointer) return paramBlockType(contract, block, i);
    return p.type.includes('uint8') ? 'int' : 'bytes';
  };
  const defParams = valueParams.map((p, i) => ({
    name: sanitizeParam(p.name),
    id: `p_${p.name}`,
    cName: p.name,
    type: typeOfParam(p, i),
  }));
  const renames = defParams.filter((p) => p.name !== p.cName).map((p) => ({ from: p.cName, to: p.name, why: '保留字/非法标识符' }));
  const inputs = {};
  blockInputs.forEach((input, i) => {
    if (!defParams[i]) return;
    inputs[input.name] = { block: { type: 'variables_get', id: nextId(), fields: { VAR: { id: defParams[i].id } } } };
  });
  const returnBlock = { type: block, id: nextId(), inputs };
  return {
    ok: true,
    defName: defNameFor(fn.name),
    params: defParams,
    paramRenames: renames,
    returnBlock,
    outParam: returnedByOutParam ? params[params.length - 1].name : null,
    note: returnedByOutParam
      ? 'C 的输出参数落成块的返回值'
      : (fn.returnType === 'void'
        ? 'C 以 void 就地改写形参；块以返回值给出同一缓冲区'
        : 'C 的返回值与块输出同义'),
  };
}

function buildChainWorkspace({ fn, aliasIndex, contract, nextId }) {
  if (fn.params.length < 1) return { ok: false, reason: '链式规则要求至少一个形参（被反复改写的缓冲区）' };
  const buffer = fn.params[0].name;
  const calls = [];
  for (const s of fn.body) {
    if (s.kind !== 'expr' || s.expr.kind !== 'call') {
      return { ok: false, reason: `函数体第 ${s.line} 行不是原语调用，链式规则不适用`, line: s.line };
    }
    const call = s.expr;
    const entry = aliasIndex.get(call.callee);
    if (!entry) return { ok: false, reason: `第 ${s.line} 行调用 ${call.callee}() 不在别名表里`, line: s.line };
    if (call.args.length < 1 || call.args[0].kind !== 'ident' || call.args[0].name !== buffer) {
      return { ok: false, reason: `第 ${s.line} 行第一个实参不是缓冲区 ${buffer}`, line: s.line };
    }
    const blockInputs = contractValueInputs(contract, entry.block) || [];
    if (call.args.length > blockInputs.length) {
      return { ok: false, reason: `第 ${s.line} 行实参 ${call.args.length} 个，块输入 ${blockInputs.length} 个`, line: s.line };
    }
    for (let i = 1; i < call.args.length; i += 1) {
      if (call.args[i].kind !== 'ident') {
        return { ok: false, reason: `第 ${s.line} 行第 ${i + 1} 个实参不是变量`, line: s.line };
      }
    }
    calls.push({ ...call, block: entry.block, blockInputs, line: call.line });
  }
  if (calls.length === 0) return { ok: false, reason: '函数体没有任何原语调用' };
  const defParams = [{ name: sanitizeParam(fn.params[0].name), id: `p_${fn.params[0].name}`, cName: fn.params[0].name, type: null }];
  let expr = { type: 'variables_get', id: nextId(), fields: { VAR: { id: defParams[0].id } } };
  for (const call of calls) {
    const node = { type: call.block, id: nextId(), inputs: {} };
    const firstInput = call.blockInputs[0];
    node.inputs[firstInput.name] = { block: expr };
    for (let i = 1; i < call.args.length; i += 1) {
      const arg = call.args[i];
      const paramIndex = fn.params.findIndex((p) => p.name === arg.name);
      if (paramIndex < 0) return { ok: false, reason: `第 ${call.line} 行实参 ${arg.name} 不是形参`, line: call.line };
      if (!defParams[paramIndex]) {
        defParams[paramIndex] = { name: sanitizeParam(arg.name), id: `p_${arg.name}`, cName: arg.name, type: null };
      }
      // 后面按块输入的 check 回填类型
      defParams[paramIndex].pendingBlock = call.block;
      defParams[paramIndex].pendingIndex = i;
      node.inputs[call.blockInputs[i].name] = { block: { type: 'variables_get', id: nextId(), fields: { VAR: { id: defParams[paramIndex].id } } } };
    }
    expr = node;
  }
  // 回填参数类型：缓冲区按第一块的首个输入，其余按出现位置
  defParams[0].type = paramBlockType(contract, calls[0].block, 0);
  for (let i = 1; i < defParams.length; i += 1) {
    const p = defParams[i];
    if (!p) continue;
    if (p.pendingBlock) {
      const blockInputs = contractValueInputs(contract, p.pendingBlock) || [];
      const idx = blockInputs.findIndex((inp) => inp.name === blockInputs[p.pendingIndex]?.name);
      p.type = paramBlockType(contract, p.pendingBlock, p.pendingIndex >= 0 ? p.pendingIndex : idx);
      delete p.pendingBlock;
      delete p.pendingIndex;
    } else {
      p.type = 'int_list';
    }
  }
  return {
    ok: true,
    defName: defNameFor(fn.name),
    params: defParams.filter(Boolean),
    returnBlock: expr,
    calls: calls.map((c) => ({ block: c.block, line: c.line })),
    paramRenames: defParams.filter((p) => p && p.name !== p.cName).map((p) => ({ from: p.cName, to: p.name, why: '保留字/非法标识符' })),
    note: 'C 的原地多语句改写折叠成嵌套返回链（顺序 = 语句顺序）',
  };
}

function mapSkeletonStatement(s, aliasIndex) {
  switch (s.kind) {
    case 'compound':
      return s.body.flatMap((x) => mapSkeletonStatement(x, aliasIndex));
    case 'decl':
      return s.decls.map((d) => ({
        construct: d.initKind === 'list' ? 'array-initializer' : 'declaration',
        block: d.initKind === 'list' ? 'data_int_list' : 'variables_set',
        line: s.line,
        name: d.name,
      }));
    case 'for':
      return [
        { construct: 'for', block: 'controls_for', line: s.line },
        ...(s.body ? mapSkeletonStatement(s.body, aliasIndex) : []),
      ];
    case 'while':
      return [
        { construct: 'while', block: 'controls_whileUntil', line: s.line },
        ...(s.body ? mapSkeletonStatement(s.body, aliasIndex) : []),
      ];
    case 'if':
      return [
        { construct: 'if', block: 'controls_if', line: s.line },
        ...(s.then ? mapSkeletonStatement(s.then, aliasIndex) : []),
        ...(s.alternate ? mapSkeletonStatement(s.alternate, aliasIndex) : []),
      ];
    case 'return':
      return [{ construct: 'return', block: 'procedures_defreturn.RETURN', line: s.line }];
    case 'break':
      return [{ construct: 'break', block: 'controls_flow_statements', line: s.line }];
    case 'continue':
      return [{ construct: 'continue', block: 'controls_flow_statements', line: s.line }];
    case 'expr': {
      const e = s.expr;
      if (e.kind === 'assign') {
        const isIndex = e.target?.kind === 'index';
        return [{ construct: 'assignment', block: isIndex ? 'lists_setIndex' : 'variables_set', line: s.line }];
      }
      if (e.kind === 'call') {
        const alias = aliasIndex.get(e.callee);
        if (alias) return [{ construct: 'alias-call', block: alias.block, line: s.line, hit: true }];
        return [{ construct: 'call', block: 'procedures_callreturn', line: s.line, callee: e.callee }];
      }
      if (e.kind === 'incdec') return [{ construct: 'incdec', block: 'math_arithmetic', line: s.line }];
      return [{ construct: 'expr', block: 'bit_operation', line: s.line }];
    }
    case 'unsupported':
      return [{ construct: s.construct, block: null, line: s.line, reason: '无对应块（V1 已报 unsupported）' }];
    default:
      return [{ construct: s.kind, block: null, line: s.line }];
  }
}

function stageV2(manifest, aliasMap, contract, parseResults, vectors) {
  const aliasIndex = new Map(aliasMap.entries.map((e) => [e.c.name, e]));
  const samples = [];
  for (const v1 of parseResults.samples) {
    if (!v1.ok) {
      samples.push({ id: v1.id, ok: false, error: v1.error, aliasHits: [], skeleton: [], buildable: { ok: false, reason: 'V1 未通过' } });
      continue;
    }
    const s = manifest.samples.find((x) => x.id === v1.id);
    const sourceText = fs.readFileSync(path.join(SAMPLES_DIR, s.file), 'utf8');
    const parsed = parseC(sourceText, { opaqueFunctions: new Set(s.opaqueFunctions || []) });
    const entryName = vectors.samples[v1.id]?.fn ? vectors.samples[v1.id].fn : null;
    const aliasHits = [];
    const skeleton = [];
    const absorbed = [];

    for (const fn of parsed.functions) {
      const whole = aliasIndex.get(fn.name);
      if (whole) {
        aliasHits.push({
          scope: 'whole-function',
          fn: fn.name,
          line: fn.line,
          block: whole.block,
          signature: whole.c.signature,
          absorbedStatements: fn.body.length,
          bodySkipped: fn.bodySkipped ?? false,
        });
        absorbed.push({
          fn: fn.name,
          statements: fn.body.length,
          bodySkipped: fn.bodySkipped ?? false,
          note: fn.bodySkipped
            ? `函数体整体被 ${whole.block} 吸收，且按 manifest.opaqueFunctions 只解析了签名（体行数 ${fn.bodyLines ?? '?'}，未做结构分析）`
            : `函数体整体被 ${whole.block} 吸收，内部构造不做结构映射`,
        });
        continue;
      }
      const nodes = fn.body.flatMap((stmt) => mapSkeletonStatement(stmt, aliasIndex));
      for (const site of parsed.callSites.filter((c) => c.fn === fn.name)) {
        const alias = aliasIndex.get(site.callee);
        if (alias) {
          aliasHits.push({ scope: 'call-site', fn: fn.name, line: site.line, block: alias.block, callee: site.callee });
        }
      }
      skeleton.push({
        function: fn.name,
        line: fn.line,
        nodes,
        blockHistogram: nodes.reduce((acc, n) => {
          const k = n.block || '(none)';
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {}),
      });
    }
    // 全局常量表：表在闭包里，只能落 data_int_list 或随别名一起吸收
    const globalTables = parsed.globals.filter((g) => g.arraySize != null).map((g) => ({
      name: g.name,
      line: g.line,
      elements: g.init?.elements?.length ?? null,
      candidateBlock: 'data_int_list',
      note: aliasHits.some((h) => h.scope === 'whole-function')
        ? '被整体命中的别名块吸收（S 盒在生成器闭包里）'
        : '结构上落 data_int_list；算法语义不在块里',
    }));

    // 可生成工作区判定：以 vectors 指定的入口函数为准
    const entryFn = parsed.functions.find((f) => f.name === entryName) || parsed.functions[parsed.functions.length - 1];
    let buildable = { ok: false, reason: '没有入口函数' };
    if (entryFn) {
      const whole = aliasIndex.get(entryFn.name);
      const nextId = workspaceIdFactory(v1.id);
      if (whole) {
        buildable = buildWholeAliasWorkspace({ fn: entryFn, aliasEntry: whole, contract, nextId });
      } else {
        buildable = buildChainWorkspace({ fn: entryFn, aliasIndex, contract, nextId });
      }
      if (buildable.ok) {
        buildable.entry = entryFn.name;
        buildable.sourceFile = s.file;
        buildable.via = whole ? 'whole-function-alias' : 'chain-fold';
      }
    }
    samples.push({
      id: v1.id,
      ok: true,
      entry: entryName,
      aliasHits,
      absorbed,
      skeleton,
      globalTables,
      buildable,
      diagnostics: v1.diagnostics,
      diagnosticSummary: v1.diagnosticSummary,
    });
  }
  return { ok: true, samples };
}

// ---------------------------------------------------------------------------
// V2 产物：块工作区 JSON
// ---------------------------------------------------------------------------
function writeWorkspace(sampleId, buildable) {
  const ws = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'procedures_defreturn',
          id: `${sampleId}_def`,
          x: 100,
          y: 100,
          extraState: {
            params: buildable.params.map((p) => ({ name: p.name, id: p.id, type: p.type })),
            hasStatements: false,
          },
          fields: { NAME: buildable.defName },
          inputs: { RETURN: { block: buildable.returnBlock } },
        },
      ],
    },
  };
  const file = path.join(OUT_DIR, `ws-${sampleId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(ws, null, 2)}\n`);
  return file;
}

// ---------------------------------------------------------------------------
// V3：差分
// ---------------------------------------------------------------------------
function buildCDriver(sampleId, fnName, kind, vectors, sampleFile) {
  const head = [
    '/* 由 run-p3.mjs 生成：同一组向量喂给 C 样本；不要手改，改 vectors.json 后重跑。 */',
    '#include <stdint.h>',
    '#include <stdio.h>',
    '',
  ];
  const printer = [
    'static void p3_print(const uint8_t *p, int n) {',
    '    for (int i = 0; i < n; i++) printf("%02x", p[i]);',
    '    printf("\\n");',
    '}',
    '',
  ];
  if (kind === 'inplace16') {
    const lines = [
      ...head,
      `void ${fnName}(uint8_t s[16], const uint8_t rk[16]);`,
      ...printer,
      'int main(void) {',
      '    uint8_t s[16];',
    ];
    vectors.forEach((v, i) => {
      lines.push(`    static const uint8_t a${i}[16] = ${toByteArrayLiteral(v.inputs[0])};`);
      lines.push(`    static const uint8_t k${i}[16] = ${toByteArrayLiteral(v.inputs[1])};`);
      lines.push(`    for (int j = 0; j < 16; j++) s[j] = a${i}[j];`);
      lines.push(`    ${fnName}(s, k${i});`);
      lines.push('    p3_print(s, 16);');
    });
    lines.push('    return 0;', '}', '');
    return lines.join('\n');
  }
  if (kind === 'ecb-block') {
    const lines = [
      ...head,
      `void ${fnName}(const uint8_t in[16], const uint8_t key[16], uint8_t out[16]);`,
      ...printer,
      'int main(void) {',
      '    uint8_t out[16];',
    ];
    vectors.forEach((v, i) => {
      lines.push(`    static const uint8_t in${i}[16] = ${toByteArrayLiteral(v.inputs[0])};`);
      lines.push(`    static const uint8_t k${i}[16] = ${toByteArrayLiteral(v.inputs[1])};`);
      lines.push(`    ${fnName}(in${i}, k${i}, out);`);
      lines.push('    p3_print(out, 16);');
    });
    lines.push('    return 0;', '}', '');
    return lines.join('\n');
  }
  if (kind === 'inplace16-ptr') {
    // 第三方样本里的这些函数是 static：与驱动分开编译就链接不上。
    // 这条分支把样本 #include 进同一编译单元，从而不必为了可链接去改上游源码（不去 static）。
    const lines = [
      '/* 由 run-p3.mjs 生成：样本以 #include 进入同一编译单元（static 函数才能被调用）；不要手改。 */',
      '#include <stdint.h>',
      '#include <stdio.h>',
      `#include "${sampleFile}"`,
      '',
      ...printer,
      'int main(void) {',
      '    uint8_t s[16];',
    ];
    vectors.forEach((v, i) => {
      lines.push(`    static const uint8_t a${i}[16] = ${toByteArrayLiteral(v.inputs[0])};`);
      lines.push(`    for (int j = 0; j < 16; j++) s[j] = a${i}[j];`);
      // 形参是 `state_t*`，而 state_t = uint8_t[4][4]，所以它的类型是 uint8_t (*)[4][4]
      // （不是 (*)[4]）。扁平 16 字节缓冲区按列优先就是这个 4x4 状态，直接转型传址。
      lines.push(`    ${fnName}((uint8_t (*)[4][4])s);`);
      lines.push('    p3_print(s, 16);');
    });
    lines.push('    return 0;', '}', '');
    return lines.join('\n');
  }
  if (kind === 'byte') {
    const lines = [...head, `uint8_t ${fnName}(uint8_t x);`, '', 'int main(void) {'];
    for (const v of vectors) lines.push(`    printf("%02x\\n", ${fnName}(0x${HEX(v.inputs[0])}));`);
    lines.push('    return 0;', '}', '');
    return lines.join('\n');
  }
  throw new Error(`未知向量形态 ${kind}`);
}

function buildPyDriver(defName, kind, vectors) {
  const lines = ['', '# ---- 由 run-p3.mjs 追加的向量驱动（与 C 驱动同源：vectors.json） ----'];
  if (kind === 'inplace16') {
    for (const v of vectors) {
      lines.push(`print(''.join(f'{b:02x}' for b in ${defName}(${toPyByteArray(v.inputs[0])}, ${toPyByteArray(v.inputs[1])})))`);
    }
  } else if (kind === 'ecb-block') {
    for (const v of vectors) {
      lines.push(`print(${defName}(bytes(${toPyByteArray(v.inputs[0])}), bytes(${toPyByteArray(v.inputs[1])})).hex())`);
    }
  } else if (kind === 'inplace16-ptr') {
    // 单个 16 字节缓冲区，无密钥参数：C 就地改写 ↔ 块返回值
    for (const v of vectors) {
      lines.push(`print(''.join(f'{b:02x}' for b in ${defName}(${toPyByteArray(v.inputs[0])})))`);
    }
  } else if (kind === 'byte') {
    for (const v of vectors) {
      lines.push(`print(f'{${defName}(0x${HEX(v.inputs[0])}):02x}')`);
    }
  } else {
    throw new Error(`未知向量形态 ${kind}`);
  }
  return lines.join('\n');
}

function extractPython(harnessStdout) {
  const pyMarker = '===== PYTHON =====';
  const jsMarker = '===== JAVASCRIPT =====';
  const start = harnessStdout.indexOf(pyMarker);
  const end = harnessStdout.indexOf(jsMarker);
  if (start < 0) return null;
  const body = harnessStdout.slice(start + pyMarker.length, end < 0 ? undefined : end);
  return body.replace(/^\s*\n/, '').replace(/\n\s*$/, '\n');
}

function stageV3(manifest, v2Results, vectors, env, aliasMapRef, contractRef) {
  const results = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-c-'));
  for (const s of manifest.samples) {
    const mapped = v2Results.samples.find((x) => x.id === s.id);
    const spec = vectors.samples[s.id];
    const out = {
      id: s.id,
      reachable: false,
      reason: null,
      kind: spec?.kind ?? null,
      pyFn: spec?.pyFn ?? null,
      cFn: spec?.fn ?? null,
      vectors: [],
      passed: 0,
      total: spec?.vectors?.length ?? 0,
    };
    if (!spec) {
      out.reason = 'vectors.json 没有该样本的向量定义';
      results.push(out);
      continue;
    }
    if (!mapped || !mapped.buildable?.ok) {
      out.reason = `V2 不可生成工作区：${mapped?.buildable?.reason || '无映射结果'}`;
      results.push(out);
      continue;
    }
    if (mapped.buildable.defName !== spec.pyFn) {
      out.reason = `映射产物函数名 ${mapped.buildable.defName} 与向量声明 ${spec.pyFn} 不一致`;
      results.push(out);
      continue;
    }
    if (!env.harness.ok) {
      out.reason = `生成器 harness 不可用：${env.harness.reason}`;
      results.push(out);
      continue;
    }
    const wsPath = writeWorkspace(s.id, mapped.buildable);
    out.workspace = rel(wsPath);
    // 1) 工作区 → 项目 Python 生成器
    const harness = runCommand('node', [HARNESS, wsPath], { cwd: ROOT, timeout: 180000 });
    if (!harness.ok) {
      out.reason = `verify-demo 载入/生成失败（rc=${harness.status}）：${(harness.stderr || harness.stdout).trim().slice(0, 400)}`;
      results.push(out);
      continue;
    }
    const pyCode = extractPython(harness.stdout);
    if (!pyCode) {
      out.reason = 'verify-demo 输出里找不到 PYTHON 段';
      results.push(out);
      continue;
    }
    const pyFile = path.join(OUT_DIR, `gen-${s.id}.py`);
    fs.writeFileSync(pyFile, pyCode + buildPyDriver(spec.pyFn, spec.kind, spec.vectors));
    out.generatedPython = rel(pyFile);
    const pyRun = runCommand(PYTHON, [pyFile], { cwd: ROOT, timeout: 120000 });
    if (!pyRun.ok) {
      out.reason = `生成代码执行失败（rc=${pyRun.status}）：${(pyRun.stderr || pyRun.stdout).trim().slice(0, 400)}`;
      results.push(out);
      continue;
    }
    const pyLines = pyRun.stdout.trim().split('\n').map((x) => x.trim()).filter(Boolean);

    // 2) C 样本 + 驱动 → gcc 编译执行
    const driverFile = path.join(OUT_DIR, `driver-${s.id}.c`);
    fs.writeFileSync(driverFile, buildCDriver(s.id, spec.fn, spec.kind, spec.vectors, s.file));
    out.cDriver = rel(driverFile);
    const driverText = fs.readFileSync(driverFile, 'utf8');
    const sampleText = fs.readFileSync(path.join(SAMPLES_DIR, s.file), 'utf8');
    const sampleFiles = [];
    // 驱动已经 #include 的翻译单元不能再单独编译（会重复定义）
    if (!driverText.includes(`#include "${s.file}"`)) sampleFiles.push(path.join(SAMPLES_DIR, s.file));
    for (const dep of s.dependsOn || []) {
      if (driverText.includes(`#include "${dep}"`)) continue;
      if (sampleText.includes(`#include "${dep}"`)) continue;
      sampleFiles.push(path.join(SAMPLES_DIR, dep));
    }
    const bin = path.join(tmpDir, s.id);
    const compile = runCommand(GCC, ['-O1', '-std=c11', '-Wall', '-Wextra', '-I', SAMPLES_DIR, '-o', bin, driverFile, ...sampleFiles], { cwd: ROOT, timeout: 120000 });
    if (!compile.ok) {
      out.reason = `gcc 编译失败（rc=${compile.status}）：${(compile.stderr || '').trim().slice(0, 400)}`;
      results.push(out);
      continue;
    }
    const cRun = runCommand(bin, [], { cwd: ROOT, timeout: 60000 });
    if (!cRun.ok) {
      out.reason = `C 程序运行失败（rc=${cRun.status}）：${(cRun.stderr || '').trim().slice(0, 400)}`;
      results.push(out);
      continue;
    }
    const cLines = cRun.stdout.trim().split('\n').map((x) => x.trim()).filter(Boolean);

    // 3) 逐例比对
    out.reachable = true;
    const n = Math.min(spec.vectors.length, pyLines.length, cLines.length);
    for (let i = 0; i < n; i += 1) {
      const v = spec.vectors[i];
      const c = cLines[i];
      const py = pyLines[i];
      const pass = c === v.expectHex && py === v.expectHex && c === py;
      if (pass) out.passed += 1;
      out.vectors.push({ id: v.id, expect: v.expectHex, c, py, pass, source: v.source });
    }
    if (n < spec.vectors.length) {
      out.reason = `输出行数不足：向量 ${spec.vectors.length} 条，C ${cLines.length} 行 / Python ${pyLines.length} 行`;
    }
    if (pyRun.stderr.trim()) out.pyStderr = pyRun.stderr.trim().slice(0, 400);
    results.push(out);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const negativeControl = process.argv.includes('--no-negative-control')
    ? { ran: false, reason: '按 --no-negative-control 跳过' }
    : runNegativeControl(manifest, aliasMapRef, contractRef, vectors);
  return {
    ok: results.every((r) => r.reachable && r.passed === r.total)
      && (!negativeControl.ran || negativeControl.detected),
    negativeControl,
    harness: env.harness,
    totals: {
      samples: results.length,
      reachable: results.filter((r) => r.reachable).length,
      cases: results.reduce((a, r) => a + r.total, 0),
      passed: results.reduce((a, r) => a + r.passed, 0),
      unreachable: results.filter((r) => !r.reachable).length,
    },
    samples: results,
  };
}

// ---------------------------------------------------------------------------
// 阴性对照：把 sub_bytes 的别名改成 shift_rows（同类型、能生成代码、语义错），V3 必须红
// ---------------------------------------------------------------------------
function runNegativeControl(manifest, aliasMap, contract, vectors) {
  const sample = manifest.samples.find((x) => x.id === 'jia-aes-round');
  const spec = vectors.samples['jia-aes-round'];
  const sourceText = fs.readFileSync(path.join(SAMPLES_DIR, sample.file), 'utf8');
  const parsed = parseC(sourceText);
  const mutated = aliasMap.entries.map((e) => (e.c.name === 'sub_bytes' ? { ...e, block: 'aes_shift_rows' } : e));
  const aliasIndex = new Map(mutated.map((e) => [e.c.name, e]));
  const nextId = workspaceIdFactory('negative-control');
  const fn = parsed.functions.find((f) => f.name === 'aes_round');
  const buildable = buildChainWorkspace({ fn, aliasIndex, contract, nextId });
  if (!buildable.ok) {
    return { ran: false, reason: `改动后的映射无法生成工作区：${buildable.reason}` };
  }
  const wsPath = path.join(OUT_DIR, 'ws-negative-control.json');
  const ws = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'procedures_defreturn',
        id: 'neg_def',
        x: 100,
        y: 100,
        extraState: { params: buildable.params.map((p) => ({ name: p.name, id: p.id, type: p.type })), hasStatements: false },
        fields: { NAME: buildable.defName },
        inputs: { RETURN: { block: buildable.returnBlock } },
      }],
    },
  };
  fs.writeFileSync(wsPath, `${JSON.stringify(ws, null, 2)}\n`);
  const harness = runCommand('node', [HARNESS, wsPath], { cwd: ROOT, timeout: 180000 });
  if (!harness.ok) return { ran: false, reason: `verify-demo 失败：${(harness.stderr || '').slice(0, 200)}` };
  const pyCode = extractPython(harness.stdout);
  if (!pyCode) return { ran: false, reason: 'verify-demo 输出里找不到 PYTHON 段' };
  const v = spec.vectors[0];
  const pyFile = path.join(OUT_DIR, 'gen-negative-control.py');
  fs.writeFileSync(pyFile, pyCode + buildPyDriver(buildable.defName, spec.kind, [v]));
  const pyRun = runCommand(PYTHON, [pyFile], { cwd: ROOT, timeout: 120000 });
  if (!pyRun.ok) return { ran: false, reason: `生成代码执行失败：${(pyRun.stderr || '').slice(0, 200)}` };
  const got = pyRun.stdout.trim().split('\n').pop().trim();
  return {
    ran: true,
    mutation: 'sub_bytes → aes_shift_rows（同一 C 函数，语义错误；类型仍可生成）',
    vector: v.id,
    expect: v.expectHex,
    got,
    detected: got !== v.expectHex,
    workspace: rel(wsPath),
    generatedPython: rel(pyFile),
  };
}

// ---------------------------------------------------------------------------
// 环境与摘要
// ---------------------------------------------------------------------------
function collectEnv() {
  const harnessExists = fs.existsSync(HARNESS);
  const harnessInfo = harnessExists
    ? { ok: true, path: rel(HARNESS), sha256: sha256(fs.readFileSync(HARNESS)), mtime: fs.statSync(HARNESS).mtime.toISOString() }
    : { ok: false, path: rel(HARNESS), reason: 'dist-verify/verify-demo.js 不存在（先构建 harness 或设置 P3_VERIFY_DEMO）' };
  const gcc = runCommand(GCC, ['--version']);
  const py = runCommand(PYTHON, ['--version']);
  const gitHead = runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    gcc: gcc.ok ? gcc.stdout.split('\n')[0].trim() : `不可用：${gcc.error || gcc.stderr}`,
    python: py.ok ? (py.stdout || py.stderr).trim() : `不可用：${py.error || py.stderr}`,
    gitHead: gitHead.ok ? gitHead.stdout.trim() : null,
    harness: harnessInfo,
  };
}

function renderText(summary) {
  const L = [];
  L.push('P3 第一步切片读数（B 线：外部 C 参考实现 → Blockly 工作区）');
  L.push(`生成时间 ${summary.generatedAt}  git ${summary.env.gitHead ?? 'n/a'}  node ${summary.env.node}`);
  L.push(`gcc: ${summary.env.gcc}`);
  L.push(`python: ${summary.env.python}`);
  L.push(`harness: ${summary.env.harness.path}${summary.env.harness.ok ? ` sha256=${summary.env.harness.sha256.slice(0, 16)}…` : ' 不可用'}`);
  L.push('');
  L.push('V0 样本哈希/来源/行数 + 别名可审');
  L.push('id                      lines  sha256(ok)  source');
  for (const s of summary.v0.samples) {
    L.push(`${s.id.padEnd(22)}  ${String(s.lines).padStart(4)}  ${s.hashOk ? 'OK      ' : 'MISMATCH'}  ${s.source}`);
  }
  L.push(`别名 ${summary.v0.aliasCount} 条，全部在契约键内且证据行可定位：${summary.v0.aliasesOk ? '是' : '否'}；契约键本轮实测 ${summary.v0.contractKeys} 个；V0 总判定 ${summary.v0.ok ? 'PASS' : 'FAIL'}`);
  L.push('');
  L.push('V1 结构解析（N=样本数 / 通过 / 诊断）');
  L.push('id                      fns  for if assigns calls indexR indexW  unsupported  drift');
  if (!summary.v1) { L.push('（本次未运行 V1：--stage v0）'); }
  for (const s of (summary.v1?.samples || [])) {
    const c = s.constructCounts || {};
    const d = s.diagnosticSummary?.byKind || {};
    L.push(`${s.id.padEnd(22)}  ${String(c.functions ?? '-').padStart(3)}  ${String(c.for ?? '-').padStart(3)} ${String(c.if ?? '-').padStart(2)} ${String(c.assignments ?? '-').padStart(7)} ${String(c.calls ?? '-').padStart(5)} ${String(c.subscriptReads ?? '-').padStart(6)} ${String(c.subscriptWrites ?? '-').padStart(6)}  ${String(d.unsupported ?? '-').padStart(11)}  ${String(d['semantic-drift'] ?? '-').padStart(5)}`);
  }
  L.push('');
  L.push('V2 映射（别名命中 / 结构骨架 / 工作区可生成）');
  if (!summary.v2) { L.push('（本次未运行 V2：--stage v0/v1）'); }
  for (const s of (summary.v2?.samples || [])) {
    const wholeHits = s.aliasHits.filter((h) => h.scope === 'whole-function');
    const siteHits = s.aliasHits.filter((h) => h.scope === 'call-site');
    const hits = [
      ...wholeHits.map((h) => `定义 ${h.fn}→${h.block}`),
      ...siteHits.map((h) => `调用 ${h.fn}:${h.line}→${h.block}`),
    ].join(', ') || '无';
    const blocks = s.skeleton.reduce((a, x) => a + x.nodes.filter((n) => n.block).length, 0);
    L.push(`- ${s.id}: 别名命中 ${s.aliasHits.length}（定义 ${wholeHits.length} / 调用点 ${siteHits.length}）（${hits}）`);
    L.push(`  骨架节点 ${s.skeleton.reduce((a, x) => a + x.nodes.length, 0)} 个（有块候选 ${blocks}）；工作区可生成：${s.buildable?.ok ? `是 → ${s.buildable.defName}（${s.buildable.via}）` : `否（${s.buildable?.reason}）`}`);
    if (s.buildable?.paramRenames?.length) {
      L.push(`  参数改名：${s.buildable.paramRenames.map((r) => `${r.from}→${r.to}（${r.why}）`).join('，')}`);
    }
  }
  L.push('');
  if (!summary.v3) {
    L.push('V3 差分：（本次未运行 V3：--stage v0/v1/v2）');
  } else {
  L.push(`V3 差分：可达样本 ${summary.v3.totals.reachable}/${summary.v3.totals.samples}，向量 ${summary.v3.totals.passed}/${summary.v3.totals.cases} 通过`);
  for (const s of summary.v3.samples) {
    if (!s.reachable) {
      L.push(`- ${s.id}: V3 不可达 — ${s.reason}`);
      continue;
    }
    L.push(`- ${s.id}: ${s.passed}/${s.total} 通过（${s.kind}）`);
    for (const v of s.vectors) {
      L.push(`    ${v.pass ? 'PASS' : 'FAIL'} ${v.id.padEnd(18)} expect=${v.expect} c=${v.c} py=${v.py}`);
    }
  }
  }
  if (summary.v3?.negativeControl) {
    const n = summary.v3.negativeControl;
    L.push('');
    L.push(`阴性对照：${n.ran ? `${n.detected ? '已捕获' : '未捕获（判据无牙）'} — ${n.mutation}；向量 ${n.vector} expect=${n.expect} got=${n.got}` : `未运行（${n.reason}）`}`);
  }
  L.push('');
  L.push('说明：V3 的 Python 侧代码由 dist-verify/verify-demo.js 载入 V2 生成的工作区后，用本仓库 Python 生成器输出；C 侧由 gcc 编译样本 + 生成的驱动。两侧跑同一组向量。');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = readJson(path.join(SAMPLES_DIR, 'manifest.json'));
  const aliasMap = readJson(path.join(P3_DIR, 'alias-map.json'));
  const contract = readJson(CONTRACT_PATH);
  const vectors = readJson(path.join(P3_DIR, 'vectors.json'));
  const env = collectEnv();

  const summary = {
    schema: 1,
    generatedAt: now(),
    stage: stageArg,
    env,
    v0: null,
    v1: null,
    v2: null,
    v3: null,
    ok: true,
  };

  if (wants('v0')) {
    summary.v0 = stageV0(manifest, aliasMap, contract);
    if (!summary.v0.ok) summary.ok = false;
  }
  if (wants('v1')) {
    summary.v1 = stageV1(manifest);
    if (!summary.v1.ok) summary.ok = false;
  }
  if (wants('v2')) {
    summary.v2 = stageV2(manifest, aliasMap, contract, summary.v1, vectors);
  }
  if (wants('v3')) {
    summary.v3 = stageV3(manifest, summary.v2, vectors, env, aliasMap, contract);
    if (!summary.v3.ok) summary.ok = false;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'p3-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const text = renderText(summary);
  fs.writeFileSync(path.join(OUT_DIR, 'p3-summary.txt'), `${text}\n`);
  process.stdout.write(`${text}\n`);
  process.stdout.write(`\nJSON: ${rel(path.join(OUT_DIR, 'p3-summary.json'))}\n`);
  // V0 对不上 / V3 有失败时退出码非 0，便于 CI 或 main thread 直接看 rc
  process.exitCode = summary.ok ? 0 : 1;
}

main();
