#!/usr/bin/env node
/**
 * B2 第二步：把 PQClean 的官方 KAT 摘要接到「块生成代码」上。
 *
 * 用法：
 *   node experiments/ai-helper-2026-11-14/p3/run-pqclean-kat.mjs
 *   PQCLEAN_DIR=/path/to/PQClean node …/run-pqclean-kat.mjs      # 换 clone 位置
 *   node …/run-pqclean-kat.mjs --skip-build                      # 复用已编译的 bin/
 *
 * 它做四件事，每一步都能单独核对：
 *   1. 编译并运行 PQClean 的 nistkat（ml-kem-512/clean），把输出摘要与 META.yml 的
 *      `nistkat-sha256` 对账 —— 证明 C 侧的「参考真值」就是官方那一条；
 *   2. 用**不改上游**的办法导出 KAT 实际吃到的随机字节：把 test/common/nistkatrng.c
 *      复制一份、只把 `randombytes` 改名成 `rb_raw`，再在自己的探针里提供带日志的
 *      `randombytes` 包一层。探针重新算出的 pk/sk/ct/ss 必须与 KAT 文件逐字节相同，
 *      否则说明「导出的随机字节不是 KAT 用的那批」，直接失败；
 *   3. 把其中的 ek(=pk) 与 m 喂给本仓库的 `demos/procedures/ML-KEM-Encaps.json`，
 *      经 verify-demo 载入 → Python 生成器出码 → 跑，得到 ct||ss；
 *   4. 用 `lib/gen-mlkem-keygen-ws.mjs` 组出 ML-KEM-512 的 K-PKE.KeyGen 工作区
 *      （146 块，纯 IR 组装），把 KAT 的 d||z 喂进去，得到 ek||sk；
 *   5. 与 KAT 的 pk/sk/ct/ss 逐字节比对；四项全部来自生成代码后，按 KAT 的六行
 *      格式（count/seed 是 RNG 输入，不是算法输出）重算 sha256，与 META.yml 比。
 *
 * 判据强度：只有 pk/sk/ct/ss 四个数据字段**都**来自生成代码、且重算摘要等于 META
 * 的 `nistkat-sha256`，才算「KAT 摘要对齐」。中间任何时候对不上，退出码非 0。
 */
/* global Buffer */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildWorkspace } from './lib/gen-mlkem-keygen-ws.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const P3_DIR = import.meta.dirname;
const PQCLEAN = process.env.PQCLEAN_DIR || '/tmp/b2probe/PQClean';
const SCHEME = 'ml-kem-512';
const IMPL = 'clean';
// 工作目录放系统临时目录，不落仓库内：这里会生成 Python/JS 出码文件，
// 落在仓库里会被 `eslint .` 当成源码扫（实测把整树 lint 打成 rc=1）。
const WORK = path.join(os.tmpdir(), 'cc-pqclean-kat');
const HARNESS = path.join(ROOT, 'dist-verify/verify-demo.js');
const DEMO = 'demos/procedures/ML-KEM-Encaps.json';
const skipBuild = process.argv.includes('--skip-build');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const rel = (p) => {
  const r = path.relative(ROOT, p).replaceAll('\\', '/');
  // 落在仓库外（如 os.tmpdir()）时 rel 会是一串 ../，没有可读性，直接给绝对路径
  return r.startsWith('..') ? p : r;
};
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function run(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { ok: res.status === 0, status: res.status, out: res.stdout || '', err: res.stderr || '', error: res.error?.message || null };
}
function must(res, what) {
  if (!res.ok) {
    console.error(`✗ ${what} 失败（rc=${res.status}）\n${(res.err || res.out).trim().slice(0, 1200)}`);
    process.exit(1);
  }
  return res;
}

/** verify-demo 的 stdout 里同时打 PYTHON 与 JAVASCRIPT 两段出码，按标记切开。 */
function splitHarness(stdout) {
  const pyStart = stdout.indexOf('===== PYTHON =====') + '===== PYTHON ====='.length;
  const pyEnd = stdout.indexOf('===== JAVASCRIPT =====');
  return {
    py: stdout.slice(pyStart, pyEnd < 0 ? undefined : pyEnd).replace(/^\s*\n/, ''),
    js: pyEnd < 0 ? '' : stdout.slice(pyEnd + '===== JAVASCRIPT ====='.length).replace(/^\s*\n/, ''),
  };
}

/** 探针：与 nistkat.c 同顺序，但把随机字节原样记下来。上游文件不改。 */
const PROBE_C = String.raw`
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>
#include "api.h"
#include "randombytes.h"

int PQCLEAN_MLKEM512_CLEAN_crypto_kem_keypair(uint8_t *pk, uint8_t *sk);
int PQCLEAN_MLKEM512_CLEAN_crypto_kem_enc(uint8_t *ct, uint8_t *ss, const uint8_t *pk);
void nist_kat_init(uint8_t *entropy_input, const uint8_t *personalization_string, int security_strength);
int rb_raw(uint8_t *buf, size_t n);

static int call_no = 0;
int randombytes(uint8_t *buf, size_t n) {
    int rc = rb_raw(buf, n);
    printf("RNG%d len=%zu ", ++call_no, n);
    for (size_t i = 0; i < n; i++) printf("%02X", buf[i]);
    printf("\n");
    return rc;
}
static void p(const char *tag, const uint8_t *b, size_t n) {
    printf("%s ", tag);
    for (size_t i = 0; i < n; i++) printf("%02X", b[i]);
    printf("\n");
}
int main(void) {
    uint8_t entropy[48], seed[48];
    uint8_t pk[PQCLEAN_MLKEM512_CLEAN_CRYPTO_PUBLICKEYBYTES];
    uint8_t sk[PQCLEAN_MLKEM512_CLEAN_CRYPTO_SECRETKEYBYTES];
    uint8_t ct[PQCLEAN_MLKEM512_CLEAN_CRYPTO_CIPHERTEXTBYTES];
    uint8_t ss[PQCLEAN_MLKEM512_CLEAN_CRYPTO_BYTES];
    for (uint8_t i = 0; i < 48; i++) entropy[i] = i;
    nist_kat_init(entropy, NULL, 256);
    randombytes(seed, 48);
    p("SEED", seed, 48);
    nist_kat_init(seed, NULL, 256);
    if (PQCLEAN_MLKEM512_CLEAN_crypto_kem_keypair(pk, sk) != 0) return 1;
    p("PK", pk, sizeof pk);
    p("SK", sk, sizeof sk);
    if (PQCLEAN_MLKEM512_CLEAN_crypto_kem_enc(ct, ss, pk) != 0) return 2;
    p("CT", ct, sizeof ct);
    p("SS", ss, sizeof ss);
    return 0;
}
`;

function main() {
  if (!fs.existsSync(path.join(PQCLEAN, `crypto_kem/${SCHEME}`))) {
    console.error(`✗ 找不到 PQClean clone：${PQCLEAN}（用 PQCLEAN_DIR=… 指定）`);
    process.exit(2);
  }
  if (!fs.existsSync(HARNESS)) {
    console.error(`✗ 缺少 ${rel(HARNESS)}（先构建 harness）`);
    process.exit(2);
  }
  fs.mkdirSync(WORK, { recursive: true });

  // ---- 0) 上游身份 ----
  const meta = fs.readFileSync(path.join(PQCLEAN, `crypto_kem/${SCHEME}/META.yml`), 'utf8');
  const expectDigest = (meta.match(/^nistkat-sha256:\s*([0-9a-f]{64})/m) || [])[1] || null;
  const commit = must(run('git', ['rev-parse', 'HEAD'], { cwd: PQCLEAN }), 'git rev-parse').out.trim();
  log(`PQClean commit ${commit}`);
  log(`META nistkat-sha256 ${expectDigest || '(缺)'}`);

  // ---- 1) 官方 KAT + 摘要 ----
  const katBin = path.join(PQCLEAN, 'bin', `nistkat_${SCHEME}_${IMPL}`);
  if (!skipBuild && !fs.existsSync(katBin)) {
    log('编译 PQClean nistkat …');
    must(run('make', ['nistkat', 'TYPE=kem', `SCHEME=${SCHEME}`, `IMPLEMENTATION=${IMPL}`], { cwd: path.join(PQCLEAN, 'test') }), 'make nistkat');
  }
  const katRun = must(run(katBin, [], { cwd: PQCLEAN }), '运行 nistkat');
  const katPath = path.join(WORK, `kat-${SCHEME}.rsp`);
  fs.writeFileSync(katPath, katRun.out, 'utf8');
  const actualDigest = sha256(Buffer.from(katRun.out, 'utf8'));
  const kat = Object.fromEntries(
    katRun.out.split('\n').filter(Boolean).map((l) => l.split(' = ')).map(([k, v]) => [k.trim(), (v || '').trim()]),
  );
  const digestOk = Boolean(expectDigest) && actualDigest === expectDigest;

  // ---- 2) 导出 KAT 实际吃到的随机字节（不改上游） ----
  const rngCopy = path.join(WORK, 'rng_raw.c');
  const rngSrc = fs.readFileSync(path.join(PQCLEAN, 'test/common/nistkatrng.c'), 'utf8');
  fs.writeFileSync(rngCopy, rngSrc.replace(/^int randombytes\(uint8_t \*buf, size_t n\)/m, 'int rb_raw(uint8_t *buf, size_t n)'), 'utf8');
  const probeC = path.join(WORK, 'kat-probe.c');
  fs.writeFileSync(probeC, PROBE_C, 'utf8');
  const probeBin = path.join(WORK, 'kat-probe');
  const schemeDir = path.join(PQCLEAN, `crypto_kem/${SCHEME}/${IMPL}`);
  const common = path.join(PQCLEAN, 'common');
  must(run('gcc', [
    '-O2', '-std=c99', '-I', schemeDir, '-I', common, '-o', probeBin,
    probeC, rngCopy,
    path.join(common, 'aes.c'), path.join(common, 'sha2.c'), path.join(common, 'fips202.c'),
    path.join(common, 'nistseedexpander.c'), path.join(common, 'sp800-185.c'),
    '-L', schemeDir, `-l${SCHEME}_${IMPL}`,
  ]), '编译随机字节探针');
  const probeRun = must(run(probeBin, []), '运行随机字节探针');
  const probe = Object.fromEntries(
    probeRun.out.split('\n').filter((l) => /^(SEED|PK|SK|CT|SS) /.test(l)).map((l) => l.split(' ')),
  );
  const rng = probeRun.out.split('\n').filter((l) => l.startsWith('RNG')).map((l) => {
    const [, len, hex] = l.split(' ');
    return { len: Number(len.slice(4)), hex };
  });
  const probeMatchesKat = ['PK', 'SK', 'CT', 'SS', 'SEED'].every((k) => probe[k] === kat[k.toLowerCase()]);

  // ---- 3) 块生成代码算 ct||ss ----
  const harness = must(run('node', [HARNESS, DEMO], { cwd: ROOT }), 'verify-demo 生成 ML-KEM 代码');
  const { py: pyCode, js: jsCode } = splitHarness(harness.out);
  const ek = kat.pk;
  const m = (rng[2] || {}).hex || '';
  const genPy = path.join(WORK, 'gen-mlkem-encaps.py');
  fs.writeFileSync(genPy, `${pyCode}\nprint(bytes(ML_KEM_Encaps(bytes.fromhex('${ek}'), bytes.fromhex('${m}'))).hex())\n`, 'utf8');
  const genRun = must(run('python3', [genPy], { cwd: ROOT }), '运行生成代码');

  // 同一工作区再走 JavaScript 生成器（verify-demo 同时打 PYTHON / JAVASCRIPT 两段）
  const genJs = path.join(WORK, 'gen-mlkem-encaps.mjs');
  fs.writeFileSync(genJs, `${jsCode}\nconsole.log(Buffer.from(ML_KEM_Encaps(Buffer.from('${ek}', 'hex'), Buffer.from('${m}', 'hex'))).toString('hex'));\n`, 'utf8');
  const jsRun = run('node', [genJs], { cwd: ROOT });
  const jsGot = (jsRun.out || '').trim().toUpperCase();
  const jsCtOk = jsGot.slice(0, kat.ct.length) === kat.ct;
  const jsSsOk = jsGot.slice(kat.ct.length) === kat.ss;
  const got = genRun.out.trim().toUpperCase();
  const ctGot = got.slice(0, kat.ct.length);
  const ssGot = got.slice(kat.ct.length);
  const ctOk = ctGot === kat.ct;
  const ssOk = ssGot === kat.ss;

  // ---- 3.5) 块生成代码算 ek||sk（K-PKE.KeyGen，146 块 IR 组装） ----
  const keygenWs = buildWorkspace('full');
  const keygenPath = path.join(WORK, 'ws-mlkem-keygen.json');
  fs.writeFileSync(keygenPath, `${JSON.stringify(keygenWs.workspace, null, 1)}\n`, 'utf8');
  fs.mkdirSync(path.join(P3_DIR, 'out'), { recursive: true });
  fs.writeFileSync(path.join(P3_DIR, 'out/ws-mlkem-keygen.json'), `${JSON.stringify(keygenWs.workspace, null, 1)}\n`, 'utf8');
  const kgHarness = must(run('node', [HARNESS, keygenPath], { cwd: ROOT }), 'verify-demo 生成 ML-KEM KeyGen 代码');
  const kg = splitHarness(kgHarness.out);
  const kgPyFile = path.join(WORK, 'gen-mlkem-keygen.py');
  const kgJsFile = path.join(WORK, 'gen-mlkem-keygen.mjs');
  const kgDriver = (lang, dHex, zHex) => (lang === 'py'
    ? `${kg.py}\nr = ML_KEM_KeyGen(bytes.fromhex('${dHex}'), bytes.fromhex('${zHex}'))\nprint(r.hex())\n`
    : `${kg.js}\nconst r = ML_KEM_KeyGen(Buffer.from('${dHex}', 'hex'), Buffer.from('${zHex}', 'hex'));\nconsole.log(Buffer.from(r).toString('hex'));\n`);
  /** 跑一次 keygen 出码，返回 { ok, ek, sk, err }（ek/sk 为大写十六进制）。 */
  const runKeygen = (dHex, zHex, lang = 'py') => {
    const file = lang === 'py' ? kgPyFile : kgJsFile;
    fs.writeFileSync(file, kgDriver(lang, dHex, zHex), 'utf8');
    const res = run(lang === 'py' ? 'python3' : 'node', [file], { cwd: ROOT });
    const blob = (res.out || '').trim().toUpperCase();
    return {
      ok: res.ok && blob.length === (kat.pk.length + kat.sk.length),
      ek: blob.slice(0, kat.pk.length),
      sk: blob.slice(kat.pk.length),
      err: res.ok ? null : (res.err || '').slice(0, 300),
    };
  };
  const coins = (rng[1] || {}).hex || '';
  const dHex = coins.slice(0, 64);
  const zHex = coins.slice(64);
  const kgPy = runKeygen(dHex, zHex, 'py');
  const kgJs = runKeygen(dHex, zHex, 'js');
  const ekOk = kgPy.ok && kgPy.ek === kat.pk;
  const skOk = kgPy.ok && kgPy.sk === kat.sk;
  const jsEkOk = kgJs.ok && kgJs.ek === kat.pk;
  const jsSkOk = kgJs.ok && kgJs.sk === kat.sk;

  // ---- 3.6) 六行摘要：count/seed 是 RNG 输入（不是算法输出），其余四项都取生成值 ----
  const assembled = [
    'count = 0',
    `seed = ${kat.seed}`,
    `pk = ${kgPy.ek}`,
    `sk = ${kgPy.sk}`,
    `ct = ${ctGot}`,
    `ss = ${ssGot}`,
    '',
  ].join('\n');
  const assembledDigest = sha256(Buffer.from(assembled, 'utf8'));
  const digestFromGeneratedOk = assembledDigest === expectDigest;


  // 阴性对照：把 m 的最低位翻转，再跑一遍。ct/ss 必须变；否则「通过」只是没在对答案。
  const mBad = m.slice(0, -1) + (m.slice(-1) === '0' ? '1' : '0');
  const genPyBad = path.join(WORK, 'gen-mlkem-encaps-flipped.py');
  fs.writeFileSync(genPyBad, `${pyCode}\nprint(bytes(ML_KEM_Encaps(bytes.fromhex('${ek}'), bytes.fromhex('${mBad}'))).hex())\n`, 'utf8');
  const badRun = run('python3', [genPyBad], { cwd: ROOT });
  const bad = (badRun.out || '').trim().toUpperCase();
  const negativeControl = {
    ran: badRun.ok,
    mutation: 'm 的最低位翻转 1 bit',
    changed: bad !== got,
    ctChanged: bad.slice(0, kat.ct.length) !== kat.ct,
  };

  // keygen 的两条定向阴性对照（比「随便翻一位看有没有变」更能说明哪一段真的在算）：
  //   d 翻 1 bit → ek 与 sk 都必须变（d 进 G，链条全变）；
  //   z 翻 1 bit → ek 与 sk 前 1600 字节必须不变，只有末尾 32 字节变（z 只落在 sk 尾部）。
  const flipLast = (hex) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;
  const kgBadD = runKeygen(flipLast(dHex), zHex, 'py');
  const kgBadZ = runKeygen(dHex, flipLast(zHex), 'py');
  const skHead = kat.sk.length - 64; // sk 共 1632 字节，末尾 32 字节是 z
  const keygenNegative = {
    dFlip: { ran: kgBadD.ok, ekChanged: kgBadD.ek !== kat.pk, skChanged: kgBadD.sk !== kat.sk },
    zFlip: {
      ran: kgBadZ.ok,
      ekUnchanged: kgBadZ.ek === kat.pk,
      skPrefixUnchanged: kgBadZ.sk.slice(0, skHead) === kat.sk.slice(0, skHead),
      skTailChanged: kgBadZ.sk.slice(skHead) !== kat.sk.slice(skHead),
    },
  };

  // 变异对照：故意把两处「容易写错但能跑通」的结构改掉，判据必须变红。
  //   e-eta2      —— e 用 eta2（Encrypt 才用 eta2；KeyGen 两处都是 eta1）
  //   a-transpose —— A 的 seed 后缀换成 i||j（生成 Âᵀ）
  const runMutant = (tag, code) => {
    const file = path.join(WORK, `gen-mlkem-keygen-${tag}.py`);
    fs.writeFileSync(file, `${code}\nr = ML_KEM_KeyGen(bytes.fromhex('${dHex}'), bytes.fromhex('${zHex}'))\nprint(r.hex())\n`, 'utf8');
    const res = run('python3', [file], { cwd: ROOT });
    const blob = (res.out || '').trim().toUpperCase();
    return { ran: res.ok, ek: blob.slice(0, kat.pk.length), sk: blob.slice(kat.pk.length) };
  };
  const keygenMutants = {};
  for (const mutation of ['e-eta2', 'a-transpose']) {
    const ws = buildWorkspace('full', { mutate: mutation });
    const wsPath = path.join(WORK, `ws-mlkem-keygen-${mutation}.json`);
    fs.writeFileSync(wsPath, `${JSON.stringify(ws.workspace, null, 1)}\n`, 'utf8');
    const h = must(run('node', [HARNESS, wsPath], { cwd: ROOT }), `verify-demo 生成变异工作区 ${mutation}`);
    const mut = runMutant(mutation, splitHarness(h.out).py);
    keygenMutants[mutation] = { ran: mut.ran, pkChanged: mut.ek !== kat.pk, skChanged: mut.sk !== kat.sk };
  }

  // ---- 4) 汇总 ----
  const summary = {
    generatedAt: new Date().toISOString(),
    pqclean: { commit, scheme: SCHEME, implementation: IMPL },
    kat: {
      file: rel(katPath),
      sha256: actualDigest,
      metaExpected: expectDigest,
      digestOk,
      lines: Object.keys(kat),
    },
    randomness: {
      probeMatchesKat,
      calls: rng.map((r) => ({ len: r.len, hex: `${r.hex.slice(0, 16)}…` })),
      note: 'seed(48) → keypair 吃 d||z(64) → enc 吃 m(32)；探针重算的 pk/sk/ct/ss 与 KAT 逐字节相同，才说明这批随机字节就是 KAT 用的那批',
    },
    generatedCode: {
      demo: DEMO,
      pythonChars: pyCode.length,
      compared: 'ct || ss',
      ctOk,
      ssOk,
      ctBytes: kat.ct.length / 2,
      ssBytes: kat.ss.length / 2,
      js: { ok: jsRun.ok, ctOk: jsCtOk, ssOk: jsSsOk, error: jsRun.ok ? null : (jsRun.err || '').slice(0, 300) },
    },
    keygen: {
      workspace: 'experiments/ai-helper-2026-11-14/p3/out/ws-mlkem-keygen.json',
      builder: 'experiments/ai-helper-2026-11-14/p3/lib/gen-mlkem-keygen-ws.mjs',
      blocks: keygenWs.blocks,
      procedure: 'ML_KEM_KeyGen(d, z) → ek || sk（800 + 1632 字节；defreturn 只能返回一个值）',
      python: { ok: kgPy.ok, ekOk, skOk, error: kgPy.err },
      js: { ok: kgJs.ok, ekOk: jsEkOk, skOk: jsSkOk, error: kgJs.err },
      negativeControl: keygenNegative,
      mutants: keygenMutants,
    },
    negativeControl,
    digestAlignment: {
      verdict: ekOk && skOk && ctOk && ssOk && digestFromGeneratedOk
        ? '六个字段全部来自生成代码，六行组装摘要与 META 相同'
        : '未对齐',
      assembledFromGenerated: assembledDigest,
      matchesMeta: digestFromGeneratedOk,
      pending: ekOk && skOk && ctOk && ssOk && digestFromGeneratedOk ? [] : ['见 keygen / generatedCode 的逐项读数'],
      why: 'count/seed 是 DRBG 输入，不是算法输出；pk/sk 由 K-PKE.KeyGen 工作区算出，ct/ss 由 Encaps 工作区算出，四项全部逐字节相同后按 KAT 六行格式重算 sha256',
    },
  };
  const outJson = path.join(P3_DIR, 'out/pqclean-kat.json');
  fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  log('');
  log(`① C 侧官方 KAT 摘要  实测 ${actualDigest}`);
  log(`   META.yml 期望     ${expectDigest || '(缺)'}  → ${digestOk ? 'PASS' : 'FAIL'}`);
  log(`② 随机字节导出      探针重算 pk/sk/ct/ss 与 KAT 逐字节一致：${probeMatchesKat ? 'PASS' : 'FAIL'}`);
  log(`   调用序列 ${rng.map((r) => r.len).join(' / ')} 字节`);
  log(`③ 块生成代码 Python ct ${ctOk ? 'PASS' : 'FAIL'}（${kat.ct.length / 2} 字节）/ ss ${ssOk ? 'PASS' : 'FAIL'}（${kat.ss.length / 2} 字节）`);
  log(`   块生成代码 JS     ct ${jsCtOk ? 'PASS' : 'FAIL'} / ss ${jsSsOk ? 'PASS' : 'FAIL'}${jsRun.ok ? '' : `（执行失败：${(jsRun.err || '').slice(0, 120)}）`}`);
  log(`④ 块生成代码 KeyGen Python ek ${ekOk ? 'PASS' : 'FAIL'}（${kat.pk.length / 2} 字节）/ sk ${skOk ? 'PASS' : 'FAIL'}（${kat.sk.length / 2} 字节）`);
  log(`   块生成代码 KeyGen JS     ek ${jsEkOk ? 'PASS' : 'FAIL'} / sk ${jsSkOk ? 'PASS' : 'FAIL'}（${keygenWs.blocks} 块，K-PKE.KeyGen）`);
  log(`⑤ 六行摘要组装      pk/sk/ct/ss 全取生成值 → ${assembledDigest}`);
  log(`   META.yml 期望     ${expectDigest}  → ${digestFromGeneratedOk ? 'PASS' : 'FAIL'}`);
  log(`⑥ 变异对照          e 用 eta2 → pk ${keygenMutants['e-eta2'].pkChanged ? '变（PASS）' : '没变（FAIL：判据没牙齿）'}`
    + `；A 转置 → pk ${keygenMutants['a-transpose'].pkChanged ? '变（PASS）' : '没变（FAIL：判据没牙齿）'}`);
  log(`⑦ 阴性对照          m 翻 1 bit → ct/ss 变化：${negativeControl.changed ? 'PASS' : 'FAIL'}`
    + `；d 翻 1 bit → ek/sk 变化：${keygenNegative.dFlip.ekChanged && keygenNegative.dFlip.skChanged ? 'PASS' : 'FAIL'}`
    + `；z 翻 1 bit → ek 不变且只有 sk 尾部变：${keygenNegative.zFlip.ekUnchanged && keygenNegative.zFlip.skPrefixUnchanged && keygenNegative.zFlip.skTailChanged ? 'PASS' : 'FAIL'}`);
  log(`⑧ 判定              ${summary.digestAlignment.verdict}`);
  log(`   JSON: ${rel(outJson)}`);

  const kgNegOk = keygenNegative.dFlip.ran && keygenNegative.dFlip.ekChanged && keygenNegative.dFlip.skChanged
    && keygenNegative.zFlip.ran && keygenNegative.zFlip.ekUnchanged
    && keygenNegative.zFlip.skPrefixUnchanged && keygenNegative.zFlip.skTailChanged;
  const mutantOk = ['e-eta2', 'a-transpose'].every((m) => keygenMutants[m].ran && keygenMutants[m].pkChanged);
  const hardFail = !digestOk || !probeMatchesKat || !ctOk || !ssOk || !jsCtOk || !jsSsOk
    || !ekOk || !skOk || !jsEkOk || !jsSkOk || !digestFromGeneratedOk
    || !negativeControl.ran || !negativeControl.changed || !kgNegOk || !mutantOk;
  process.exit(hardFail ? 1 : 0);
}

main();
