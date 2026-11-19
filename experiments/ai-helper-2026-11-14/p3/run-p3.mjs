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
    // 行数上限默认 40（既有自撰小样本）。整函数被原样摘录的第三方样本（带必需上下文）
    // 压不进 40 行，只能显式给 maxLines——不自动放宽，也不为凑 40 行改写原文。
    const maxLines = s.maxLines ?? 40;
    const linesOk = lines <= maxLines;
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
      ...(s.maxLines != null ? { maxLines } : {}),
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
      // 条件编译/宏表只在样本真的用到时出现：既有样本没有 #define/#if，
      // 不新增字段就不会让旧读数的结构发生变化。
      ...(parsed.preprocessor.conditionals.length > 0 || parsed.preprocessor.defines.length > 0
        ? { preprocessor: parsed.preprocessor }
        : {}),
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

// ---------------------------------------------------------------------------
// V2 覆盖差距：函数体既不是整函数别名、也不是单链折叠时，逐语句回答两个问题——
// 哪类构造有块候选（骨架已有），哪类构造连「候选块」都指不出来。只记录证据
// （样本行号 + 该行原文），不拼半截工作区、不用未经验证的块冒充可生成。
// ---------------------------------------------------------------------------
function walkStatements(stmts, cb) {
  for (const s of stmts || []) {
    cb(s);
    if (s.kind === 'compound') walkStatements(s.body, cb);
    else if (s.kind === 'for' || s.kind === 'while') walkStatements([s.body], cb);
    else if (s.kind === 'if') {
      walkStatements([s.then], cb);
      if (s.alternate) walkStatements([s.alternate], cb);
    }
  }
}

function walkExprs(expr, cb) {
  if (!expr) return;
  cb(expr);
  switch (expr.kind) {
    case 'bin': walkExprs(expr.left, cb); walkExprs(expr.right, cb); break;
    case 'un':
    case 'cast':
    case 'incdec': walkExprs(expr.expr, cb); break;
    case 'assign': walkExprs(expr.target, cb); walkExprs(expr.value, cb); break;
    case 'call': expr.args.forEach((a) => walkExprs(a, cb)); break;
    case 'index': walkExprs(expr.base, cb); walkExprs(expr.index, cb); break;
    default: break;
  }
}

function collectUnexpressible(fn, parsed, sourceLines) {
  const functionMacros = new Map((parsed.preprocessor?.defines || [])
    .filter((d) => d.functionLike)
    .map((d) => [d.name, d]));
  const params = new Map(fn.params.map((p) => [p.name, p]));
  const globals = new Map(parsed.globals.map((g) => [g.name, g]));
  const found = new Map();
  const note = (key, gap, line) => {
    if (!found.has(key)) found.set(key, { ...gap, sourceLines: [] });
    const g = found.get(key);
    if (!g.sourceLines.includes(line)) g.sourceLines.push(line);
  };
  const visit = (e) => {
    if (e.kind === 'call' && functionMacros.has(e.callee)) {
      note(`macro:${e.callee}`, {
        id: 'function-like-macro-call',
        construct: `call ${e.callee}(...)`,
        capability: functionMacros.get(e.callee).value,
        why: `函数式宏 ${e.callee}() 未展开：它把「常量表按字节下标取值」藏进宏体；块模型里 sbox 只作为 aes_sub_bytes / sbox_sub 的内部常量，没有可索引的字节查表块`,
        missingBlockType: '无（按字节查表的原子块）',
      }, e.line);
    }
    if (e.kind === 'index' && e.base.kind === 'ident' && globals.has(e.base.name)) {
      note(`global:${e.base.name}`, {
        id: 'global-const-table-index-read',
        construct: `read ${e.base.name}[...]`,
        capability: `常量表 ${e.base.name} 按下标取值`,
        why: `全局常量表 ${e.base.name} 的读：表本身可落 data_int_list，但「按下标从表里取值」在密码原语块里没有对应类型（data_int_list 只是字面量）`,
        missingBlockType: '无（常量表下标读取原语；可由 Blockly 内置 lists_getIndex 承担，但不在本项目密码块集内）',
      }, e.line);
    }
    if (e.kind === 'index' && e.base.kind === 'ident') {
      const p = params.get(e.base.name);
      if (p && p.isPointer) {
        note(`pointer:${e.base.name}`, {
          id: 'pointer-param-index-io',
          construct: `${e.base.name}[...]（指针形参按计算下标读写）`,
          capability: '输入/输出缓冲区按 32 位字下标读写',
          why: `${e.base.name} 是 uint8_t* 指针形参：C 里它与调用方缓冲区同一份内存；块模型是值语义列表，同一效果要先声明 176 元素列表再逐下标写（Blockly 内置 lists_setIndex），没有「外部字节缓冲」概念`,
          missingBlockType: '无（按字节下标写外部缓冲的块；只能展开成列表块组合）',
        }, e.line);
      }
    }
  };
  walkStatements(fn.body, (s) => {
    if (s.kind === 'expr') walkExprs(s.expr, visit);
    else if (s.kind === 'decl') s.decls.forEach((d) => walkExprs(d.init, visit));
    else if (s.kind === 'for') {
      if (s.init?.kind === 'expr') walkExprs(s.init.expr, visit);
      walkExprs(s.cond, visit);
      walkExprs(s.incr, visit);
    } else if (s.kind === 'if' || s.kind === 'while') walkExprs(s.cond, visit);
  });
  const pointerParams = fn.params.filter((p) => p.isPointer);
  // 返回类型带限定符（`static void`），不能和 'void' 直接全等比较。
  if (/\bvoid\b/.test(fn.returnType) && pointerParams.length >= 2) {
    note('multi-buffer-io', {
      id: 'multi-buffer-io',
      construct: `${fn.name}(${fn.params.map((p) => `${p.type}${p.isPointer ? '*' : ''} ${p.name}`).join(', ')})`,
      capability: '一个输入缓冲 + 一个 176 字节输出缓冲的整函数 IO',
      why: '函数以 void 返回、用两个指针形参分别传输入与输出；现有整函数别名块的 IO 契约是单 STATE/单 BYTES（如 aes_sub_bytes 只有 STATE），没有承接 16 字节 key → 176 字节轮密钥的块',
      missingBlockType: '无（整段密钥扩展块）',
    }, fn.line);
  }
  return [...found.values()]
    .map((g) => ({
      ...g,
      sourceLines: g.sourceLines.sort((a, b) => a - b),
      firstSnippets: g.sourceLines.slice(0, 4).map((ln) => ({ line: ln, text: (sourceLines[ln - 1] || '').trim() })),
    }))
    .sort((a, b) => a.sourceLines[0] - b.sourceLines[0]);
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
    const sourceLines = sourceText.split(/\r?\n/);
    const parsed = parseC(sourceText, { opaqueFunctions: new Set(s.opaqueFunctions || []) });
    const entryName = vectors.samples[v1.id]?.fn ? vectors.samples[v1.id].fn : null;
    const aliasHits = [];
    const skeleton = [];
    const absorbed = [];
    const coverage = [];

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
      const gaps = collectUnexpressible(fn, parsed, sourceLines);
      if (gaps.length > 0) coverage.push({ function: fn.name, line: fn.line, gaps });
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
      } else if (coverage.length > 0) {
        // 链式规则失败只是第一道闸；把「还有几类构造连候选块都指不出」一并写进原因，
        // 免得读者把「不是调用链」当成唯一阻断点。
        const gapCount = coverage.reduce((a, c) => a + c.gaps.length, 0);
        buildable = { ...buildable, reason: `${buildable.reason}；另有 ${gapCount} 类构造无候选块（见 coverage）` };
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
      ...(coverage.length > 0 ? { coverage } : {}),
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
// 阻断记录：V3 不可达时，把「构造 → 缺的块/能力 → 样本证据行」写成机器可读 JSON。
//
// 这里的原则是「不许把没做的事写成做不了」：whiteBox 段落逐条列出**画布上已有**的候选块，
// 只有真的指不出候选块的构造才写 missing。本轮 kokke-keyexpansion 的阻断点是两层：
// (a) 别名表没有整段密钥扩展块（B 线现有形态只能整函数吸收或单链折叠）；
// (b) V2 没有语句级组装器，73 行的双循环+分支+数组改写拼不成工作区。
// 画布本身是否「表达不出」要分开写，不能用 (a)(b) 冒充画布缺块。
// ---------------------------------------------------------------------------
const BLOCK_GAP_PROFILES = {
  'kokke-keyexpansion': {
    minimalUnblock: {
      blockType: 'aes_key_expansion',
      capability: '整段 AES 密钥扩展：16 字节 key → Nb*(Nr+1)*4 = 176 字节轮密钥（AES-128：Nk=4/Nb=4/Nr=10）',
      ioHint: {
        inputs: [{ name: 'KEY', check: ['Bytes'], size: 16 }],
        output: { name: 'ROUND_KEYS', check: ['Bytes'], size: 176 },
      },
      pattern: '与 kokke-shiftrows / kokke-mixcolumns 相同的 whole-function-alias：块整体吸收 KeyExpansion，块闭包里保留 Nk/Nb/Nr、sbox、Rcon',
      searchTerms: ['key_expansion', 'keyexpansion', 'expand_key', 'key_schedule', 'keyschedule', 'round_keys', 'key_expand', 'expandkey'],
      whyThisIsMinimal: '现有别名表的两种形态是「整函数吸收」和「单链折叠」；新增这一个整函数块后，本样本走 whole-function-alias，不需要语句级组装器，也不需要改 V2 的映射模型。',
    },
    whiteBox: [
      {
        id: 'loop',
        construct: 'for (i = 0; i < Nk; ++i) / for (i = Nk; i < Nb * (Nr + 1); ++i)',
        evidenceLines: [{ line: 69, contains: 'for (i = 0' }, { line: 78, contains: 'for (i = Nk' }],
        candidateBlocks: ['controls_for'],
        candidateSource: 'Blockly 内置块（BLOCK-IO-CONTRACT.json 只收密码原语，故不在表内；本仓库 mapSkeletonStatement 已把 for 映射到 controls_for）',
        expressible: true,
        why: 'Nk/Nr/Nb 已由预处理取值（4/10/4），上下界与步长都是数字常量；controls_for 可表达。',
      },
      {
        id: 'branch',
        construct: 'if (i % Nk == 0)',
        evidenceLines: [{ line: 89, contains: 'if (i % Nk == 0)' }],
        candidateBlocks: ['controls_if', 'math_arithmetic(MODULO)', 'logic_compare(EQ)'],
        candidateSource: 'Blockly 内置块',
        expressible: true,
        why: '取模 + 相等比较 + 单分支，全部有内置块。',
      },
      {
        id: 'rotword',
        construct: 'RotWord：tempa[0..3] 循环左移 1 字节（含 u8tmp 暂存）',
        evidenceLines: [{ line: 96, contains: 'u8tmp' }, { line: 97, contains: 'tempa[0] = tempa[1]' }, { line: 100, contains: 'tempa[3] = u8tmp' }],
        candidateBlocks: ['bit_rotate_left', 'lists_setIndex / variables_set'],
        candidateSource: 'bit_rotate_left 在 BLOCK-IO-CONTRACT.json 内；list 读写为 Blockly 内置',
        expressible: true,
        why: '两种写法都有块：把 4 字节打包成 32 位字后 bit_rotate_left(8)，或用变量与列表元素搬运实现同样置换。',
      },
      {
        id: 'subword',
        construct: 'SubWord：tempa[k] = getSBoxValue(tempa[k])（函数式宏）',
        evidenceLines: [{ line: 108, contains: 'getSBoxValue(tempa[0])' }, { line: 111, contains: 'getSBoxValue(tempa[3])' }],
        candidateBlocks: ['sbox(PRESET=aes, OUTPUT_FORMAT=1d) + lists_getIndex', 'sbox_sub（32 位字）'],
        candidateSource: 'sbox / sbox_sub 在 BLOCK-IO-CONTRACT.json 内；lists_getIndex 为 Blockly 内置',
        expressible: 'partial',
        why: '宏本身不是块，但语义可用「sbox 预设生成 256 项 AES 表 + 按下标取值」表达；sbox 的 gridData 会随 extraState 序列化（src/blocks/sbox/sbox.ts:156-188，loadExtraState 在无 data 时按 preset 回填），所以生成式工作区也能带表。缺的不是块，是 V2 不会把宏调用改写成这种组合。',
      },
      {
        id: 'rcon',
        construct: 'Rcon[i/Nk]（全局常量表按下标读取）',
        evidenceLines: [{ line: 114, contains: 'Rcon[i/Nk]' }],
        candidateBlocks: ['data_int_list + lists_getIndex'],
        candidateSource: 'data_int_list 在 BLOCK-IO-CONTRACT.json 内；lists_getIndex 为 Blockly 内置',
        expressible: true,
        why: 'Rcon 的 11 个值可原样写进 data_int_list（上游 120-121 行），下标表达式由 i/Nk 得到；V2 没有「全局表读取」的映射规则。',
      },
      {
        id: 'narrowing',
        construct: 'uint8_t 元素赋值隐式截断：tempa[0] ^= Rcon[...] / RoundKey[j+k] = RoundKey[k+k] ^ tempa[k]',
        evidenceLines: [{ line: 114, contains: 'Rcon[i/Nk]' }, { line: 129, contains: 'RoundKey[j + 0]' }, { line: 132, contains: 'RoundKey[j + 3] =' }],
        candidateBlocks: ['bit_operation(XOR) + bit_operation(AND 0xFF)'],
        candidateSource: 'bit_operation 在 BLOCK-IO-CONTRACT.json 内',
        expressible: 'partial',
        why: '块算术按 32 位，必须显式 & 0xFF 才与 C 的 uint8_t 截断等价；V1 已把 5 处赋值为 semantic-drift，V2 不会自动补掩码。',
      },
      {
        id: 'buffer-io',
        construct: 'void KeyExpansion(uint8_t* RoundKey, const uint8_t* Key)：输入 16 字节、输出 176 字节，按 32 位字下标读写',
        evidenceLines: [{ line: 63, contains: 'static void KeyExpansion' }, { line: 71, contains: 'RoundKey[(i * 4) + 0]' }, { line: 132, contains: 'RoundKey[j + 3] =' }],
        candidateBlocks: ['procedures_defreturn + lists_*（值语义列表）'],
        candidateSource: 'Blockly 内置过程块；列表长度 176 可由 data_int_list/循环初始化',
        expressible: 'partial',
        why: 'C 的指针形参是缓冲区别名；块模型是值语义列表，要先建 176 元素列表再按下标写，最后 return。语义在该函数里等价（只读已写过的前序字），但没有「外部字节缓冲」概念，且 V2 无语句级组装器。',
      },
    ],
    verdictNote: '阻断点不是「画布一个块都没有」，而是 (a) 没有任何块以「密钥扩展」为单位承接该函数，(b) V2 只能在整函数吸收/单链折叠两种形态下产出工作区。画布若要白盒表达，得手搭数十个块（V2 骨架已识别 32 个语句节点，实际块数只会更多）并把 uint8 截断显式掩码；本轮没有做这种手搭，也不把它算作 B 线映射能力。',
  },
};

/** 在 src/blocks 里做一次只读文本扫描（不 import、不改文件），用于核对「文档声称有块」是否属实。 */
function scanSrcBlocks(needle) {
  const base = path.join(ROOT, 'src/blocks');
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(needle)) hits.push({ file: rel(p), line: i + 1, text: line.trim().slice(0, 120) });
        });
      }
    }
  };
  walk(base);
  return hits;
}

function writeBlockedRecords({ manifest, v0, v1, v2, v3, contract, aliasMap, vectors }) {
  const out = [];
  const contractKeys = Object.keys(contract);
  for (const [sampleId, profile] of Object.entries(BLOCK_GAP_PROFILES)) {
    const v3s = v3?.samples?.find((x) => x.id === sampleId);
    if (!v3s || v3s.reachable) continue;
    const v0s = v0?.samples?.find((x) => x.id === sampleId);
    const v1s = v1?.samples?.find((x) => x.id === sampleId);
    const v2s = v2?.samples?.find((x) => x.id === sampleId);
    const s = manifest.samples.find((x) => x.id === sampleId);
    const file = path.join(SAMPLES_DIR, s.file);
    const sampleText = fs.readFileSync(file, 'utf8');
    const sourceLines = sampleText.split(/\r?\n/);
    const spec = vectors.samples[sampleId];

    const searches = profile.minimalUnblock.searchTerms || [profile.minimalUnblock.blockType];
    const contractSearch = searches.map((term) => ({
      term,
      hits: contractKeys.filter((k) => k.toLowerCase().includes(term.toLowerCase())),
    }));
    const absenceOk = contractSearch.every((x) => x.hits.length === 0);
    const nearest = [];
    for (const blockId of ['aes_sub_bytes', 'aes_add_round_key', 'sbox', 'sbox_sub', 'bit_rotate_left', 'bit_operation', 'data_int_list']) {
      const entry = contract[blockId];
      const aliasEntry = aliasMap.entries.find((e) => e.block === blockId);
      nearest.push({
        block: blockId,
        inContract: Boolean(entry),
        inputs: entry?.inputs ?? null,
        outputCheck: entry?.outputCheck ?? null,
        aliasEvidence: aliasEntry
          ? { blockDef: aliasEntry.evidence.blockDef, generator: aliasEntry.evidence.generator }
          : null,
      });
    }
    const whiteBox = profile.whiteBox.map((w) => {
      const evidence = w.evidenceLines.map(({ line, contains }) => {
        const text = (sourceLines[line - 1] || '').trim();
        return { line, contains, text, matched: text.includes(contains) };
      });
      return {
        ...w,
        evidenceLines: undefined,
        evidence,
        evidenceOk: evidence.every((e) => e.matched),
        candidatesInContract: w.candidateBlocks.map((id) => ({ block: id, inContract: Object.prototype.hasOwnProperty.call(contract, id) })),
      };
    });

    // 上游片段逐字节一致性：只有本机存在同一 clone 时才复核，否则如实写 skipped。
    const upstreamPath = process.env.P3_KOKKE_AES || '/tmp/kokke-ssh/aes.c';
    let contiguity = { checked: false, reason: `上游文件不存在：${upstreamPath}` };
    if (fs.existsSync(upstreamPath) && s.upstream?.lineRanges) {
      const upstreamText = fs.readFileSync(upstreamPath, 'utf8');
      const segs = s.upstream.lineRanges.map((r) => {
        const [a, b] = r.split('-').map(Number);
        const lines = upstreamText.split(/\r?\n/);
        return { range: r, text: lines.slice(a - 1, b).join('\n') };
      });
      let cursor = 0;
      const hits = segs.map((seg) => {
        const idx = sampleText.indexOf(seg.text);
        const ok = idx >= 0 && idx >= cursor;
        if (ok) cursor = idx + seg.text.length;
        return { range: seg.range, found: idx >= 0, inOrder: ok, at: idx };
      });
      contiguity = { checked: true, file: upstreamPath, sha256: sha256(fs.readFileSync(upstreamPath)), segments: hits, ok: hits.every((h) => h.found && h.inOrder) };
    }

    const record = {
      schema: 1,
      generatedAt: now(),
      kind: 'blocked',
      sample: {
        id: sampleId,
        file: s.file,
        sha256: sha256(fs.readFileSync(file)),
        lines: sourceLines.length - 1,
        entry: v2s?.entry ?? spec?.fn ?? null,
        upstream: s.upstream ?? null,
        standard: s.standard ?? null,
      },
      pipeline: {
        v0: {
          ok: Boolean(v0s?.ok),
          hashOk: Boolean(v0s?.hashOk),
          lines: v0s?.lines ?? sourceLines.length - 1,
          maxLines: v0s?.maxLines ?? 40,
          contractKeys: v0?.contractKeys ?? null,
        },
        v1: {
          ok: Boolean(v1s?.ok),
          constructs: v1s?.constructCounts ?? null,
          preprocessor: v1s?.preprocessor ?? null,
          preprocessorNote: v1s?.preprocessor
            ? '条件编译已按 C 语义求值：样本第 16/19 行的 #if/#elif 为假，取 #else 的 Nk=4/Nr=10；第 116 行 #if defined(AES256) 为假，AES-256 的额外 SubWord 分支被裁掉并留空行保行号，所以 V1 的 if 计数是 1（只有默认配置的 i % Nk == 0）。'
            : null,
          diagnosticSummary: v1s?.diagnosticSummary ?? null,
          diagnostics: v1s?.diagnostics ?? null,
        },
        v2: {
          buildable: false,
          reason: v2s?.buildable?.reason ?? null,
          aliasHits: v2s?.aliasHits ?? [],
          coverage: v2s?.coverage ?? [],
          skeleton: (v2s?.skeleton ?? []).map((x) => ({ function: x.function, line: x.line, nodes: x.nodes.length, blockHistogram: x.blockHistogram })),
        },
        v3: { reachable: false, reason: v3s?.reason ?? null, vectorId: spec?.vectors?.[0]?.id ?? null },
      },
      standardVector: spec
        ? {
          id: spec.vectors[0].id,
          kind: spec.kind,
          keyHex: spec.vectors[0].inputs[0],
          expectBytes: spec.vectors[0].expectHex.length / 2,
          source: spec.vectors[0].source,
          note: spec.vectors[0].note,
        }
        : null,
      blockGap: {
        rootCause: profile.verdictNote,
        assessment: 'static-inspection-only',
        assessmentNote: 'whiteBox 的 expressible 只表示「按块定义/IO 契约存在候选块」，本轮没有用手搭工作区实跑验证；它不是生成能力结论，也不改变 V3 不可达。',
        minimalUnblock: {
          ...profile.minimalUnblock,
          inContract: Object.prototype.hasOwnProperty.call(contract, profile.minimalUnblock.blockType),
          contractKeys: contractKeys.length,
          contractSearch,
          absenceOk,
        },
        whiteBox,
        nearestExisting: nearest,
      },
      documentationClaimCheck: {
        file: 'docs/standards/fips197-AES/07-KEY-EXPANSION.md',
        claim: '条目元数据写「项目状态：部分实现」，并给出项目映射 `aes_key_expand`',
        contractHasBlock: Object.prototype.hasOwnProperty.call(contract, 'aes_key_expand'),
        srcBlockHits: scanSrcBlocks('aes_key_expand'),
        note: 'src/blocks 与 BLOCK-IO-CONTRACT.json 都找不到 aes_key_expand；文档的「部分实现」是文档侧状态，不是可映射块。本轮只记录，不改 docs/。',
      },
      parserExtension: (() => {
        const f = path.join(OUT_DIR, 'keyexpansion-parser-gap.json');
        if (!fs.existsSync(f)) return { file: null, reason: '本轮未运行 run-keyexpansion-precheck.mjs' };
        const r = readJson(f);
        return {
          file: rel(f),
          v0LineRule: r.preExtension.v0LineRule,
          before: {
            if: r.preExtension.constructCounts.if,
            assignments: r.preExtension.constructCounts.assignments,
            diagnostics: r.preExtension.diagnosticCount,
            preprocLines: r.preExtension.preprocLineCount,
          },
          after: {
            if: r.postExtension.constructCounts.if,
            assignments: r.postExtension.constructCounts.assignments,
            diagnostics: r.postExtension.diagnosticCount,
            preprocLines: r.postExtension.preprocLineCount,
            defines: r.postExtension.defines,
            conditionals: r.postExtension.conditionals,
          },
          note: '旧解析器不抛错，但把 AES-256 分支当活动代码读（if=2/assignments=32）；扩展后与默认构建一致（if=1/assignments=28）。',
        };
      })(),
      evidence: {
        cSideReading: (() => {
          const f = path.join(OUT_DIR, 'keyexpansion-cside.json');
          if (!fs.existsSync(f)) return { file: null, reason: '本轮未运行 run-keyexpansion-cside.mjs' };
          const r = readJson(f);
          return {
            file: rel(f),
            differential: r.differential,
            ok: r.ok,
            vector: r.vector?.id ?? null,
            bytes: r.compare?.bytesCompared ?? null,
            wordsPassed: r.compare?.wordsPassed ?? null,
            wordsTotal: r.compare?.wordsTotal ?? null,
            roundKeysPassed: r.compare?.roundKeysPassed ?? null,
            note: 'C 侧读数，不是 V3 双侧差分；不得读作 PASS',
          };
        })(),
        sampleUpstreamContiguity: contiguity,
        note: '其余证据（V0/V1/V2/V3 读数、13/13 旧样本回归）见 p3/out/p3-summary.json 与 p3-summary.txt',
      },
      verdict: {
        status: 'blocked',
        v3: 'not-reachable',
        notClaimed: [
          '没有生成 keyexpansion 的工作区（V2 buildable=false）',
          '没有跑双侧差分；没有把 C 侧读数写成 V3 PASS',
          '没有验证手搭白盒组合能否生成等价 Python',
          '没有改 src/** 的块定义或生成器',
        ],
        nextRound: [
          '选项 A（口径最小）：新增 aes_key_expansion 整函数块（KEY Bytes[16] → ROUND_KEYS Bytes[176]），别名表上限从 8 放宽到 9，然后重跑本样本，期望进入 V3 差分。',
          '选项 B（管线能力）：给 p3 的 V2 增加语句级组装器（for/if/赋值/列表下标/表达式的块级翻译），并把 uint8 截断显式落成 & 0xFF；工作量大，但能把 loops/branches/arrays 这类第三方函数体纳入 B 线。',
        ],
      },
    };
    const outFile = path.join(OUT_DIR, `blocked-${sampleId}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
    out.push({ sample: sampleId, file: rel(outFile), status: 'blocked', blocker: 'no whole-function block for KeyExpansion + V2 has no statement-level workspace builder' });
  }
  return out;
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
    for (const cov of (s.coverage || [])) {
      L.push(`  ${cov.function}(): 无候选块的构造 ${cov.gaps.length} 类 — ${cov.gaps.map((g) => `${g.id}[${g.construct.split('（')[0]}]（行 ${g.sourceLines.slice(0, 4).join('/')}${g.sourceLines.length > 4 ? '…' : ''}）`).join('，')}`);
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
  if (summary.blocked?.length) {
    L.push('');
    L.push(`阻断记录（机器可读）：${summary.blocked.map((b) => `${b.file}`).join('，')}`);
    for (const b of summary.blocked) L.push(`- ${b.sample}: ${b.blocker}`);
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
    const blocked = writeBlockedRecords({
      manifest, v0: summary.v0, v1: summary.v1, v2: summary.v2, v3: summary.v3, contract, aliasMap, vectors,
    });
    if (blocked.length > 0) summary.blocked = blocked;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'p3-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const text = renderText(summary);
  fs.writeFileSync(path.join(OUT_DIR, 'p3-summary.txt'), `${text}\n`);
  process.stdout.write(`${text}\n`);
  process.stdout.write(`\nJSON: ${rel(path.join(OUT_DIR, 'p3-summary.json'))}\n`);
  // 默认严格：V0 对不上 / V3 有失败就非 0，便于 CI 或 main thread 直接看 rc。
  // `--allow-blocked` 只在「失败样本都已有机器可读阻断记录、其余阶段全绿」时放行，
  // 防止把真失败混进阻断里一起变绿。
  const allowBlocked = process.argv.includes('--allow-blocked');
  const blockedSamples = new Set((summary.blocked ?? []).map((b) => b.sample));
  const upstreamStagesOk = [summary.v0, summary.v1, summary.v2].every((stage) => !stage || stage.ok !== false);
  const failedOutsideBlocked = (summary.v3?.samples ?? []).some(
    (s) => !blockedSamples.has(s.id) && (!s.reachable || s.passed !== s.total),
  );
  const blockedOnly = upstreamStagesOk && blockedSamples.size > 0 && !failedOutsideBlocked;
  const exitOk = summary.ok || (allowBlocked && blockedOnly);
  if (allowBlocked && blockedOnly && !summary.ok) {
    process.stdout.write('\n--allow-blocked：失败只来自已记录的阻断样本，其余阶段全绿，按 0 退出。\n');
  }
  process.exitCode = exitOk ? 0 : 1;
}

main();
