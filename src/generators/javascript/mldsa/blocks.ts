/**
 * ML-DSA-44 原子块 JavaScript 代码生成器
 * FIPS 204 final
 *
 * 内嵌完整 ML-DSA-44（单 mlDsaCore() 闭包，内部所有辅助函数逐行取自已验证算法
 * mldsa_js_algo.js；常量在闭包顶部声明一次，避免 per-function var 内联时
 * 一行函数 return 先于常量赋值执行导致 undefined 的死循环坑）。
 * - SHAKE128/256（rate 168/136）自实现 Keccak-f1600（BigInt 64 位字）
 * - NTT/INTT（ζ = 1753, F = 8347681）、mask 采样 γ1=2^17、hint 打包 ω=80
 * - mlDsaSign 确定性：rnd 缺省 = 0^32，ctx 缺省 = []（空上下文外部接口）
 * 回归范围：仓库登记 1 组 ML-DSA-44 确定性固定样例（ACVP 向量文件与 case ID 未登记，不作为官方 ACVP 证据）；未包含完整 ACVP 套件。
 */
import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';
import { MLDSA_PRELUDE_HEAD } from './mldsa-core-a';
import { MLDSA_PRELUDE_TAIL } from './mldsa-core-b';

/** ML-DSA-44 完整实现（闭包：常量 + 全部辅助函数 + 入口，返回对象） */
export function registerMlDsaCore(): string {
  return javascriptGenerator.provideFunction_('mlDsaCore', [
    ...MLDSA_PRELUDE_HEAD,
    ...MLDSA_PRELUDE_TAIL,
  ]);
}

/** 公共签名入口：mlDsaSign(sk, message, ctx?, rnd?) — 缺省 ctx=[], rnd=0^32（确定性） */
function registerMlDsaSign(): string {
  const core = registerMlDsaCore();
  registerMlDsaSignInternal();
  registerMlDsaVerifyInternal();
  registerMlDsaPkFromSk();
  return javascriptGenerator.provideFunction_('mlDsaSign', [
    'function ' + javascriptGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk, message, ctx, rnd) {',
    '  return ' + core + '().sign(sk, message, ctx, rnd);',
    '}',
  ]);
}

/** 公共验签入口：mlDsaVerify(pk, message, sig, ctx?) */
function registerMlDsaVerify(): string {
  const core = registerMlDsaCore();
  registerMlDsaSignInternal();
  registerMlDsaVerifyInternal();
  return javascriptGenerator.provideFunction_('mlDsaVerify', [
    'function ' + javascriptGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(pk, message, sig, ctx) {',
    '  return ' + core + '().verify(pk, message, sig, ctx);',
    '}',
  ]);
}

/** 公钥派生（测试/demo 用）：mlDsaPkFromSk(sk) */
function registerMlDsaPkFromSk(): string {
  const core = registerMlDsaCore();
  return javascriptGenerator.provideFunction_('mlDsaPkFromSk', [
    'function ' + javascriptGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk) {',
    '  return ' + core + '().pkFromSk(sk);',
    '}',
  ]);
}

/** 内部接口签名（ACVP internal 测试用）：mlDsaSignInternal(sk, mprime, rnd) */
function registerMlDsaSignInternal(): string {
  const core = registerMlDsaCore();
  return javascriptGenerator.provideFunction_('mlDsaSignInternal', [
    'function ' + javascriptGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk, mprime, rnd) {',
    '  return ' + core + '().signInternal(sk, mprime, rnd);',
    '}',
  ]);
}

/** 内部接口验签（ACVP internal 测试用）：mlDsaVerifyInternal(pk, mprime, sig) */
function registerMlDsaVerifyInternal(): string {
  const core = registerMlDsaCore();
  return javascriptGenerator.provideFunction_('mlDsaVerifyInternal', [
    'function ' + javascriptGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(pk, mprime, sig) {',
    '  return ' + core + '().verifyInternal(pk, mprime, sig);',
    '}',
  ]);
}

javascriptGenerator.forBlock['mldsa_sign'] = function (block: Block): [string, number] {
  const sk = javascriptGenerator.valueToCode(block, 'SECRET_KEY', Order.ATOMIC) || '[]';
  const msg = javascriptGenerator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '[]';
  const fn = registerMlDsaSign();
  return ['Uint8Array.from(' + fn + '(' + sk + ', ' + msg + '))', Order.ATOMIC];
};

javascriptGenerator.forBlock['mldsa_verify'] = function (block: Block): [string, number] {
  const pk = javascriptGenerator.valueToCode(block, 'PUBLIC_KEY', Order.ATOMIC) || '[]';
  const msg = javascriptGenerator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '[]';
  const sig = javascriptGenerator.valueToCode(block, 'SIGNATURE', Order.ATOMIC) || '[]';
  const fn = registerMlDsaVerify();
  return [fn + '(' + pk + ', ' + msg + ', ' + sig + ')', Order.ATOMIC];
};
