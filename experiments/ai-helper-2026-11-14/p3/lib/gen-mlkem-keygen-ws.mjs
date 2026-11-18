#!/usr/bin/env node
/**
 * 用 IR 组装 ML-KEM-512 的 K-PKE.KeyGen 工作区（B2 第二步的 pk/sk 侧）。
 *
 * 产物是 `procedures_defreturn` 名为 ML_KEM_KeyGen(d, z)，返回 ek || sk 的拼接
 * （Blockly 的 defreturn 只能返回一个值；拆包由调用方按 800 字节切）。参数语义：
 *   d, z —— FIPS 203 Algorithm 19 的两段 32 字节随机字节（KAT 的 64 字节 coins）。
 *
 * 计算链（FIPS 203 §5.1 Algorithm 13 K-PKE.KeyGen）：
 *   (rho, sigma) = G(d || k)                      k=2 作为单字节 0x02
 *   A[i][j]      = SampleNTT(rho || j || i)        i,j ∈ {0,1}
 *   s[i]         = CBD_eta1(PRF_eta1(sigma, i))    nonce 0,1；eta1=3 → 192 字节
 *   e[i]         = CBD_eta1(PRF_eta1(sigma, 2+i))  nonce 2,3；keygen 的 e 也用 eta1
 *   s_hat[i]=NTT(s[i]), e_hat[i]=NTT(e[i])
 *   t_hat[i]     = sum_j MultiplyNTTs(A[i][j], s_hat[j]) + e_hat[i]
 *   ek           = ByteEncode12(t_hat[0]) || ByteEncode12(t_hat[1]) || rho   (800)
 *   sk           = ByteEncode12(s_hat[0]) || ByteEncode12(s_hat[1])          (768 = dk_pke)
 *                  || ek || H(ek) || z                                      (1632)
 *
 * 用法：
 *   node …/p3/lib/gen-mlkem-keygen-ws.mjs [输出路径] [--stage rho|sigma|A00|s0|e0|t0|ek|dk|sk|full]
 *
 * `--stage` 只用于对分排错：把 RETURN 换成该中间变量（bytes 直接返回，多项式用
 * ByteEncode12 编码后返回），让「哪一段开始不一样」可被逐段定位，而不是只比对最终值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { assembleIr, validateIr } from '../../../lib/block-ir.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));

const Q = '3329';
const N = 256;

const num = (value) => ({ type: 'data_value', fields: { NUM: String(value) } });
const get = (name) => ({ type: 'variables_get', fields: { VAR: { id: `v_${name}`, name } } });
const set = (name, value) => ({ type: 'variables_set', fields: { VAR: { id: `v_${name}`, name } }, inputs: { VALUE: value } });

const pad = (input, rateBits) => ({ type: 'sponge_pad', fields: { RATE: String(rateBits), SUFFIX: '0x06' }, inputs: { INPUT: input } });
const absorb = (block, rateBits) => ({
  type: 'sponge_absorb',
  fields: { RATE: String(rateBits) },
  inputs: { STATE: { type: 'keccak_state_init' }, BLOCK: block },
});
const squeeze = (state, outLen, rateBits) => ({
  type: 'sponge_squeeze',
  fields: { RATE: String(rateBits) },
  inputs: { STATE: state, OUTLEN: num(outLen) },
});
const sha3 = (input, outLen, rateBits) => squeeze(absorb(pad(input, rateBits), rateBits), outLen, rateBits);

const seedWithNonce = (seed, nonce) => ({ type: 'pq_seed_with_nonce', inputs: { SEED: seed, NONCE: num(nonce) } });
const slice = (input, start, end) => ({ type: 'pq_bytes_slice', inputs: { INPUT: input, START: num(start), END: num(end) } });
const concat = (a, b) => ({ type: 'pq_byte_concat', inputs: { A: a, B: b } });

const sampleNtt = (seed) => ({ type: 'pq_sample_ntt', fields: { MODULUS: Q }, inputs: { SEED: seed } });
const prf = (seed, nonce, outLen) => ({
  type: 'pq_prf',
  fields: { ALGO: 'SHAKE256' },
  inputs: { SEED: seed, NONCE: num(nonce), OUTLEN: num(outLen) },
});
const cbd = (prfOut, eta) => ({ type: 'pq_sample_poly_cbd', fields: { ETA: String(eta), MODULUS: Q }, inputs: { SEED: prfOut } });
const ntt = (x) => ({ type: 'pq_ntt', fields: { MODULUS: Q, DEGREE: String(N) }, inputs: { INPUT: x } });
const nttMul = (a, b) => ({ type: 'pq_ntt_mul', fields: { MODULUS: Q }, inputs: { A: a, B: b } });
const polyAdd = (a, b) => ({ type: 'pq_poly_add', fields: { MODULUS: Q }, inputs: { A: a, B: b } });
const byteEncode = (x, bits = 12) => ({ type: 'pq_byte_encode', fields: { BITS: String(bits) }, inputs: { INPUT: x } });

/** K-PKE.KeyGen：返回 { statements, ret }，ret 是 ek||sk。
 *
 * `mutate` 只给阴性对照用，用来证明判据能分辨结构错误（默认不启用）：
 *   'e-eta2'     —— e 改用 eta2（KEM.Encrypt 用 eta2，KeyGen 不是）→ ek/sk 应当全错
 *   'a-transpose' —— A 的 seed 后缀顺序换成 i||j（即生成 Âᵀ）→ ek 应当全错
 */
export function buildKeyGenIr({ mutate = null } = {}) {
  const stmts = [];
  const add = (name, value) => stmts.push(set(name, value));

  // (rho, sigma) = G(d || k)，k=2；SHA3-512 → rate 576 bits
  add('G', sha3(seedWithNonce(get('d'), 2), 64, 576));
  add('rho', slice(get('G'), 0, 32));
  add('sigma', slice(get('G'), 32, 64));

  // A[i][j] = SampleNTT(rho || j || i)：先 j 后 i，故外层 nonce = i
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      const seed = mutate === 'a-transpose'
        ? seedWithNonce(seedWithNonce(get('rho'), i), j)
        : seedWithNonce(seedWithNonce(get('rho'), j), i);
      add(`A${i}${j}`, sampleNtt(seed));
    }
  }

  // s 用 nonce 0,1；e 用 nonce 2,3 —— keygen 两者都是 eta1（ML-KEM-512 的 eta1 = 3）
  for (const i of [0, 1]) add(`s${i}`, cbd(prf(get('sigma'), i, 192), 3));
  const eEta = mutate === 'e-eta2' ? 2 : 3;
  for (const i of [0, 1]) add(`e${i}`, cbd(prf(get('sigma'), 2 + i, 64 * eEta), eEta));

  for (const i of [0, 1]) add(`sh${i}`, ntt(get(`s${i}`)));
  for (const i of [0, 1]) add(`eh${i}`, ntt(get(`e${i}`)));

  // t_hat[i] = sum_j A[i][j] o s_hat[j] + e_hat[i]
  for (const i of [0, 1]) {
    add(`t${i}`, polyAdd(polyAdd(nttMul(get(`A${i}0`), get('sh0')), nttMul(get(`A${i}1`), get('sh1'))), get(`eh${i}`)));
  }

  add('b_t0', byteEncode(get('t0')));
  add('b_t1', byteEncode(get('t1')));
  add('ek', concat(concat(get('b_t0'), get('b_t1')), get('rho')));

  add('b_sh0', byteEncode(get('sh0')));
  add('b_sh1', byteEncode(get('sh1')));
  add('dk', concat(get('b_sh0'), get('b_sh1')));

  // H(ek)：SHA3-256 → rate 1088
  add('h_ek', sha3(get('ek'), 32, 1088));
  add('sk', concat(concat(concat(get('dk'), get('ek')), get('h_ek')), get('z')));
  add('ret', concat(get('ek'), get('sk')));

  return { stmts, add };
}

const STAGE_OUTPUT = {
  // bytes 变量直接返回
  G: (v) => get(v),
  rho: (v) => get(v),
  sigma: (v) => get(v),
  ek: (v) => get(v),
  dk: (v) => get(v),
  sk: (v) => get(v),
  full: () => get('ret'),
};

function stageReturn(stage, stmts) {
  if (STAGE_OUTPUT[stage]) return STAGE_OUTPUT[stage](stage);
  // 多项式变量：按 ByteEncode12 编码后返回，便于与 C 侧 pack/encode 结果对账
  const known = new Set(stmts.map((s) => s.fields.VAR.name));
  if (!known.has(stage)) throw new Error(`未知 --stage ${stage}；可用：${[...Object.keys(STAGE_OUTPUT), 'A00', 'A01', 'A10', 'A11', 's0', 's1', 'e0', 'e1', 'sh0', 'sh1', 'eh0', 'eh1', 't0', 't1'].join(' / ')}`);
  return byteEncode(get(stage));
}

export function buildWorkspace(stage = 'full', { mutate = null } = {}) {
  const { stmts } = buildKeyGenIr({ mutate });
  for (let i = 0; i < stmts.length - 1; i += 1) stmts[i].next = stmts[i + 1];
  const proc = {
    type: 'procedures_defreturn',
    extraState: {
      params: [
        { name: 'd', id: 'd', type: 'bytes' },
        { name: 'z', id: 'z', type: 'bytes' },
      ],
      hasStatements: true,
    },
    fields: { NAME: 'ML_KEM_KeyGen' },
    inputs: { STACK: stmts[0], RETURN: stageReturn(stage, stmts) },
  };
  const ir = { schema: 'ciphercat.block-ir/v0', entry: [proc] };
  const errors = validateIr(ir, CONTRACT);
  if (errors.length) throw new Error(`IR 校验失败：\n${errors.join('\n')}`);
  return { ir, workspace: assembleIr(ir), blocks: countBlocks(ir.entry[0]) };
}

function countBlocks(node) {
  let n = 1;
  for (const child of Object.values(node.inputs || {})) n += countBlocks(child);
  if (node.next) n += countBlocks(node.next);
  return n;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const args = process.argv.slice(2);
  const stageIdx = args.indexOf('--stage');
  const stage = stageIdx >= 0 ? args[stageIdx + 1] : 'full';
  const mutateIdx = args.indexOf('--mutate');
  const mutate = mutateIdx >= 0 ? args[mutateIdx + 1] : null;
  // 取第一个「不是 flag、也不是 flag 的值」的参数当输出路径
  const valueFlags = new Set(['--stage', '--mutate']);
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (valueFlags.has(args[i])) { i += 1; continue; }
    if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  const defaultName = `ws-mlkem-keygen${mutate ? `-${mutate}` : ''}.json`;
  const outPath = positional[0]
    || path.join(ROOT, 'experiments/ai-helper-2026-11-14/p3/out', defaultName);
  const { workspace, blocks } = buildWorkspace(stage, { mutate });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(workspace, null, 1)}\n`, 'utf8');
  process.stdout.write(`stage=${stage}${mutate ? ` mutate=${mutate}` : ''} blocks=${blocks} out=${path.relative(ROOT, outPath)}\n`);
}
