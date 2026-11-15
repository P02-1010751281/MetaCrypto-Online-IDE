/**
 * SM9 数字签名原子块 Python 代码生成器
 * GB/T 38635.2-2020（R-ate pairing，BN 曲线，Fp12 塔域 u²=-2, s³=u, t²=s）
 *
 * 内嵌全套（一次 provideFunction_ 注册去重）：ref_sm9.py 类结构转写，
 * 全部符号加 sm9/SM9 前缀防与其它生成器冲突。SM3 走 hashlib + 纯 Python 兜底。
 * 入口 sm9_master_key/sm9_user_key/sm9_sign/sm9_verify（模块作用域，driver 可直接调用）。
 * GB/T 38635.2-2020 附录 A.2 向量（ks=0130E784…/IDA=Alice/hid=01/
 * M="Chinese IBS standard"/r=033c8616…）在 JS/Python 生成代码回归中通过。
 */
import { pythonGenerator, Order } from 'blockly/python';
import type { Block } from 'blockly/core';
import { SM9_PRELUDE_FIELD } from './sm9-field';
import { SM9_PRELUDE_CURVES } from './sm9-curves';
import { SM9_PRELUDE_PAIRING } from './sm9-pairing';

/** SM9 全套内嵌函数（常数/塔域/配对/四入口均在模块作用域，driver 可直接调用） */
function registerSm9(): string {
  return pythonGenerator.provideFunction_('sm9_sign', [
    ...SM9_PRELUDE_FIELD,
    ...SM9_PRELUDE_CURVES,
    ...SM9_PRELUDE_PAIRING,
  ]);
}

pythonGenerator.forBlock['sm9_master_key'] = function (block: Block): [string, number] {
  const ks = pythonGenerator.valueToCode(block, 'KS', Order.ATOMIC) || '[]';
  registerSm9();
  return ['bytes(sm9_master_key(' + ks + '))', Order.ATOMIC];
};

pythonGenerator.forBlock['sm9_user_key'] = function (block: Block): [string, number] {
  const ks = pythonGenerator.valueToCode(block, 'KS', Order.ATOMIC) || '[]';
  const id = pythonGenerator.valueToCode(block, 'ID', Order.ATOMIC) || '[]';
  registerSm9();
  return ['bytes(sm9_user_key(' + ks + ', ' + id + ', 1))', Order.ATOMIC];
};

pythonGenerator.forBlock['sm9_sign'] = function (block: Block): [string, number] {
  const msg = pythonGenerator.valueToCode(block, 'MSG', Order.ATOMIC) || '[]';
  const ds = pythonGenerator.valueToCode(block, 'DS', Order.ATOMIC) || '[]';
  const ppub = pythonGenerator.valueToCode(block, 'PPUB', Order.ATOMIC) || '[]';
  const randomR = block.getInputTargetBlock('R') === null ? 'True' : 'False';
  const r = pythonGenerator.valueToCode(block, 'R', Order.ATOMIC) || '[]';
  registerSm9();
  return ['bytes(sm9_sign(' + msg + ', ' + ds + ', ' + ppub + ', ' + r + ', ' + randomR + '))', Order.ATOMIC];
};

pythonGenerator.forBlock['sm9_verify'] = function (block: Block): [string, number] {
  const msg = pythonGenerator.valueToCode(block, 'MSG', Order.ATOMIC) || '[]';
  const id = pythonGenerator.valueToCode(block, 'ID', Order.ATOMIC) || '[]';
  const h = pythonGenerator.valueToCode(block, 'H', Order.ATOMIC) || '[]';
  const s = pythonGenerator.valueToCode(block, 'S', Order.ATOMIC) || '[]';
  const ppub = pythonGenerator.valueToCode(block, 'PPUB', Order.ATOMIC) || '[]';
  registerSm9();
  return ['sm9_verify(' + msg + ', ' + id + ', ' + h + ', ' + s + ', ' + ppub + ', 1)', Order.ATOMIC];
};
