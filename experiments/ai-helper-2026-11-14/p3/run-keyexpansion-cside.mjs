#!/usr/bin/env node
/**
 * Kokke KeyExpansion 的 C 侧读数（不是 V3 差分）。
 *
 * 背景：V2 无法为本样本生成工作区（没有整段密钥扩展块，也没有语句级组装器），
 * 所以 p3 的 V3 双侧比对不可达。本脚本只做能诚实验证的那一半：
 *   用 gcc 编译上游样本 + 生成的驱动 → 跑 A.1 向量 → 与仓库内 FIPS 197 语料的
 *   44 个字逐字对照。
 * 输出里 `differential: false` 是硬字段：它不能、也不应该被读成 V3 PASS。
 *
 * 用法：
 *   node experiments/ai-helper-2026-11-14/p3/run-keyexpansion-cside.mjs
 * 产物：
 *   p3/out/driver-kokke-keyexpansion-cside.c   驱动（与既有 driver-*.c 同目录）
 *   p3/out/keyexpansion-cside.json            读数（机器可读）
 * 临时文件：.tmp-build/b-keyexp/
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extractA1FromRoot, A1_ANCHOR } from './lib/fips197-a1.mjs';

const P3_DIR = import.meta.dirname;
const ROOT = path.resolve(P3_DIR, '../../..');
const OUT_DIR = path.join(P3_DIR, 'out');
const SAMPLES_DIR = path.join(P3_DIR, 'samples');
const TMP_DIR = path.join(ROOT, '.tmp-build/b-keyexp');
const SAMPLE_ID = 'kokke-keyexpansion';
const SAMPLE_FILE = 'kokke-keyexpansion.c';
const GCC = process.env.P3_GCC || 'gcc';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

function run(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  return { ok: res.status === 0, status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error ? String(res.error.message || res.error) : null };
}

const hexToLiteral = (hex, indent = '    ') => {
  const h = hex.replace(/[^0-9a-fA-F]/g, '');
  if (h.length % 2 !== 0) throw new Error('向量长度不是整字节');
  const parts = [];
  for (let i = 0; i < h.length; i += 2) parts.push(`0x${h.slice(i, i + 2)}`);
  const perLine = 12;
  const lines = [];
  for (let i = 0; i < parts.length; i += perLine) lines.push(`${indent}${parts.slice(i, i + perLine).join(', ')}`);
  return `{\n${lines.join(',\n')}\n  }`;
};

function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, 'manifest.json'), 'utf8'));
  const manifestEntry = manifest.samples.find((s) => s.id === SAMPLE_ID);
  if (!manifestEntry) throw new Error(`manifest 里没有 ${SAMPLE_ID}`);
  const samplePath = path.join(SAMPLES_DIR, SAMPLE_FILE);
  const sampleBuf = fs.readFileSync(samplePath);
  const sampleSha = sha256(sampleBuf);
  if (sampleSha !== manifestEntry.sha256) throw new Error(`样本哈希与 manifest 不一致：${sampleSha}`);

  const vectors = JSON.parse(fs.readFileSync(path.join(P3_DIR, 'vectors.json'), 'utf8'));
  const spec = vectors.samples[SAMPLE_ID];
  if (!spec) throw new Error('vectors.json 里没有该样本');
  const vector = spec.vectors[0];
  const keyHex = vector.inputs[0].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const vectorHex = vector.expectHex.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (keyHex.length !== 32) throw new Error(`key 不是 16 字节：${keyHex.length / 2}`);

  const a1 = extractA1FromRoot(ROOT);
  const corpusHex = a1.hex;
  const vectorMatchesCorpus = vectorHex === corpusHex;
  if (!vectorMatchesCorpus) throw new Error('vectors.json 的 expectHex 与语料 A.1 的机械提取结果不一致（向量漂移）');

  const driver = `/* 由 run-keyexpansion-cside.mjs 生成：把样本 #include 进同一编译单元（KeyExpansion 是 static）；
 * 只跑 A.1 向量，打印 176 字节轮密钥。不要手改，改向量请重跑脚本。 */
#include <stdint.h>
#include <stdio.h>
#include "${SAMPLE_FILE}"

static void p3_print(const uint8_t *p, int n) {
    for (int i = 0; i < n; i++) printf("%02x", p[i]);
    printf("\\n");
}

int main(void) {
    static const uint8_t key[16] = ${hexToLiteral(keyHex)};
    uint8_t roundkeys[176];
    KeyExpansion(roundkeys, key);
    p3_print(roundkeys, 176);
    return 0;
}
`;
  const driverPath = path.join(OUT_DIR, `driver-${SAMPLE_ID}-cside.c`);
  fs.writeFileSync(driverPath, driver);

  const bin = path.join(TMP_DIR, 'keyexp-cside');
  const compile = run(GCC, ['-O1', '-std=c11', '-Wall', '-Wextra', '-I', SAMPLES_DIR, '-o', bin, driverPath], { cwd: ROOT });
  const gccVersion = run(GCC, ['--version']);
  const result = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    sample: SAMPLE_ID,
    kind: 'keyexp-176',
    differential: false,
    differentialReason: 'V3 双侧差分不可达：V2 无工作区（没有整段密钥扩展块，也没有语句级组装器）。本文件只是 C 侧读数，不得读作 V3 PASS。',
    sampleFile: SAMPLE_FILE,
    sampleSha256: sampleSha,
    manifestSha256: manifestEntry.sha256,
    vector: {
      id: vector.id,
      kind: spec.kind,
      keyHex,
      keyBytes: keyHex.length / 2,
      expectHex: corpusHex,
      expectBytes: corpusHex.length / 2,
      source: vector.source,
      note: vector.note,
      corpus: {
        file: A1_ANCHOR.file,
        startLine: A1_ANCHOR.startLine,
        endLine: A1_ANCHOR.endLine,
        printedPages: A1_ANCHOR.printedPages,
        checks: a1.checks,
      },
      vectorMatchesCorpus,
    },
    build: {
      gcc: gccVersion.ok ? gccVersion.stdout.split('\n')[0].trim() : `不可用：${gccVersion.error || gccVersion.stderr}`,
      command: [GCC, '-O1', '-std=c11', '-Wall', '-Wextra', '-I', rel(SAMPLES_DIR), '-o', rel(bin), rel(driverPath)].join(' '),
      rc: compile.status,
      ok: compile.ok,
      stderr: (compile.stderr || '').trim() || null,
    },
    run: null,
    compare: null,
  };

  if (!compile.ok) {
    fs.writeFileSync(path.join(OUT_DIR, 'keyexpansion-cside.json'), `${JSON.stringify(result, null, 2)}\n`);
    throw new Error(`gcc 编译失败（rc=${compile.status}）：${(compile.stderr || '').trim().slice(0, 400)}`);
  }

  const exec = run(bin, [], { cwd: ROOT });
  const gotHex = exec.stdout.trim().split('\n')[0].trim().toLowerCase();
  const expectWords = a1.words;
  const gotWords = [];
  for (let i = 0; i < gotHex.length; i += 8) gotWords.push(gotHex.slice(i, i + 8));
  const wordCompare = expectWords.map((w, i) => ({ index: i, expect: w, c: gotWords[i] ?? null, pass: gotWords[i] === w }));
  const roundKeys = a1.roundKeys.map((rk, r) => {
    const c = gotHex.slice(r * 32, r * 32 + 32);
    return { round: r, expect: rk, c, pass: c === rk };
  });
  result.run = { rc: exec.status, ok: exec.ok, stdoutBytes: exec.stdout.trim().length / 2, stderr: (exec.stderr || '').trim() || null };
  result.compare = {
    expectHex: corpusHex,
    cHex: gotHex,
    pass: gotHex === corpusHex,
    bytesCompared: Math.min(gotHex.length, corpusHex.length) / 2,
    words: wordCompare,
    wordsPassed: wordCompare.filter((w) => w.pass).length,
    wordsTotal: wordCompare.length,
    roundKeys,
    roundKeysPassed: roundKeys.filter((r) => r.pass).length,
  };
  result.ok = exec.ok && result.compare.pass;
  fs.writeFileSync(path.join(OUT_DIR, 'keyexpansion-cside.json'), `${JSON.stringify(result, null, 2)}\n`);

  // 只打印长度/计数，不打印密钥与轮密钥本体（避免把向量内容带进日志）。
  process.stdout.write(`C 侧读数（非 V3 差分）：${SAMPLE_ID}\n`);
  process.stdout.write(`向量 ${vector.id}：语料 ${A1_ANCHOR.file} ${A1_ANCHOR.startLine}-${A1_ANCHOR.endLine}（印刷页 ${A1_ANCHOR.printedPages}），expect ${corpusHex.length / 2} 字节；vectors.json 与语料一致：${vectorMatchesCorpus ? '是' : '否'}\n`);
  process.stdout.write(`gcc ${result.build.gcc}；编译 rc=${compile.status}；运行 rc=${exec.status}\n`);
  process.stdout.write(`C 输出 ${gotHex.length / 2} 字节；逐字 ${result.compare.wordsPassed}/${result.compare.wordsTotal}；逐轮密钥 ${result.compare.roundKeysPassed}/${roundKeys.length}；整段相等：${result.compare.pass ? '是' : '否'}\n`);
  process.stdout.write(`JSON: ${rel(path.join(OUT_DIR, 'keyexpansion-cside.json'))}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main();
