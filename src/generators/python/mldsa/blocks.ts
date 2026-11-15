/**
 * ML-DSA-44 原子块 Python 代码生成器
 * FIPS 204 final
 *
 * 内嵌完整 ML-DSA-44（单 ml_dsa_core() 闭包，内部所有辅助函数逐行取自已验证算法
 * mldsa_py_algo.py；常量在闭包顶部声明一次；SHAKE 用标准库 hashlib.shake_128/256）。
 * - ml_dsa_sign 确定性：rnd 缺省 = 0^32，ctx 缺省 = []（空上下文外部接口）
 * 回归范围：仓库登记 1 组 ML-DSA-44 确定性固定样例（ACVP 向量文件与 case ID 未登记，不作为官方 ACVP 证据）；未包含完整 ACVP 套件。
 */
import { pythonGenerator, Order } from 'blockly/python';
import type { Block } from 'blockly/core';
import { MLDSA_PRELUDE_HEAD } from './mldsa-core-a';
import { MLDSA_PRELUDE_TAIL } from './mldsa-core-b';

/** ML-DSA-44 完整实现（闭包：常量 + 全部辅助函数 + 入口，返回 dict） */
export function registerMlDsaCore(): string {
  return pythonGenerator.provideFunction_('ml_dsa_core', [
    ...MLDSA_PRELUDE_HEAD,
    ...MLDSA_PRELUDE_TAIL,
  ]);
}

/** 公共签名入口：ml_dsa_sign(sk, message, ctx?, rnd?) — 缺省 ctx=[], rnd=0^32 */
function registerMlDsaSign(): string {
  const core = registerMlDsaCore();
  registerMlDsaSignInternal();
  registerMlDsaVerifyInternal();
  registerMlDsaPkFromSk();
  return pythonGenerator.provideFunction_('ml_dsa_sign', [
    'def ' + pythonGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk, message, ctx=None, rnd=None):',
    '    return ' + core + "()['sign'](sk, message, ctx, rnd)",
  ]);
}

/** 公共验签入口：ml_dsa_verify(pk, message, sig, ctx?) */
function registerMlDsaVerify(): string {
  const core = registerMlDsaCore();
  registerMlDsaSignInternal();
  registerMlDsaVerifyInternal();
  return pythonGenerator.provideFunction_('ml_dsa_verify', [
    'def ' + pythonGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(pk, message, sig, ctx=None):',
    '    return ' + core + "()['verify'](pk, message, sig, ctx)",
  ]);
}

/** 公钥派生（测试/demo 用）：ml_dsa_pk_from_sk(sk) */
function registerMlDsaPkFromSk(): string {
  const core = registerMlDsaCore();
  return pythonGenerator.provideFunction_('ml_dsa_pk_from_sk', [
    'def ' + pythonGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk):',
    '    return ' + core + "()['pk_from_sk'](sk)",
  ]);
}

/** 内部接口签名（ACVP internal 测试用）：ml_dsa_sign_internal(sk, mprime, rnd) */
function registerMlDsaSignInternal(): string {
  const core = registerMlDsaCore();
  return pythonGenerator.provideFunction_('ml_dsa_sign_internal', [
    'def ' + pythonGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(sk, mprime, rnd):',
    '    return ' + core + "()['sign_internal'](sk, mprime, rnd)",
  ]);
}

/** 内部接口验签（ACVP internal 测试用）：ml_dsa_verify_internal(pk, mprime, sig) */
function registerMlDsaVerifyInternal(): string {
  const core = registerMlDsaCore();
  return pythonGenerator.provideFunction_('ml_dsa_verify_internal', [
    'def ' + pythonGenerator.FUNCTION_NAME_PLACEHOLDER_ + '(pk, mprime, sig):',
    '    return ' + core + "()['verify_internal'](pk, mprime, sig)",
  ]);
}

pythonGenerator.forBlock['mldsa_sign'] = function (block: Block): [string, number] {
  const sk = pythonGenerator.valueToCode(block, 'SECRET_KEY', Order.ATOMIC) || '[]';
  const msg = pythonGenerator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '[]';
  const fn = registerMlDsaSign();
  return ['bytes(' + fn + '(' + sk + ', ' + msg + '))', Order.ATOMIC];
};

pythonGenerator.forBlock['mldsa_verify'] = function (block: Block): [string, number] {
  const pk = pythonGenerator.valueToCode(block, 'PUBLIC_KEY', Order.ATOMIC) || '[]';
  const msg = pythonGenerator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '[]';
  const sig = pythonGenerator.valueToCode(block, 'SIGNATURE', Order.ATOMIC) || '[]';
  const fn = registerMlDsaVerify();
  return [fn + '(' + pk + ', ' + msg + ', ' + sig + ')', Order.ATOMIC];
};
