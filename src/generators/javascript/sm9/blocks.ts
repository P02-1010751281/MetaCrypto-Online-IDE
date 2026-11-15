/**
 * SM9 数字签名原子块 JavaScript 代码生成器
 * GB/T 38635.2-2020（R-ate pairing，BN 曲线，Fp12 塔域 u²=-2, s³=u, t²=s）
 *
 * 内嵌全套（一次 provideFunction_ 注册去重）：
 *   sm9Sm3/sm9ModInv/sm9H + Fp2/Fp6/Fp12 塔域 + G1/G2 射影点 + 线函数 + sm9Pair
 *   入口 sm9MasterKey/sm9UserKey/sm9Sign/sm9Verify（模块作用域，driver 可直接调用）
 * GB/T 38635.2-2020 附录 A.2 向量（ks=0130E784…/IDA=Alice/hid=01/
 * M="Chinese IBS standard"/r=033c8616…）在 JS/Python 生成代码回归中通过。
 */
import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';
import { SM9_PRELUDE_FIELD } from './sm9-field';
import { SM9_PRELUDE_CURVES } from './sm9-curves';
import { SM9_PRELUDE_PAIRING } from './sm9-pairing';

/** SM9 全套内嵌函数（常数/塔域/配对/四入口均在模块作用域，driver 可直接调用） */
function registerSm9(): string {
  return javascriptGenerator.provideFunction_('sm9Sign', [
    ...SM9_PRELUDE_FIELD,
    ...SM9_PRELUDE_CURVES,
    ...SM9_PRELUDE_PAIRING,
  ]);
}

javascriptGenerator.forBlock['sm9_master_key'] = function (block: Block): [string, number] {
  const ks = javascriptGenerator.valueToCode(block, 'KS', Order.ATOMIC) || '[]';
  registerSm9();
  return ['Uint8Array.from(sm9MasterKey(' + ks + '))', Order.ATOMIC];
};

javascriptGenerator.forBlock['sm9_user_key'] = function (block: Block): [string, number] {
  const ks = javascriptGenerator.valueToCode(block, 'KS', Order.ATOMIC) || '[]';
  const id = javascriptGenerator.valueToCode(block, 'ID', Order.ATOMIC) || '[]';
  registerSm9();
  return ['Uint8Array.from(sm9UserKey(' + ks + ', ' + id + ', 1))', Order.ATOMIC];
};

javascriptGenerator.forBlock['sm9_sign'] = function (block: Block): [string, number] {
  const msg = javascriptGenerator.valueToCode(block, 'MSG', Order.ATOMIC) || '[]';
  const ds = javascriptGenerator.valueToCode(block, 'DS', Order.ATOMIC) || '[]';
  const ppub = javascriptGenerator.valueToCode(block, 'PPUB', Order.ATOMIC) || '[]';
  const randomR = block.getInputTargetBlock('R') === null ? 'true' : 'false';
  const r = javascriptGenerator.valueToCode(block, 'R', Order.ATOMIC) || '[]';
  registerSm9();
  return ['Uint8Array.from(sm9Sign(' + msg + ', ' + ds + ', ' + ppub + ', ' + r + ', ' + randomR + '))', Order.ATOMIC];
};

javascriptGenerator.forBlock['sm9_verify'] = function (block: Block): [string, number] {
  const msg = javascriptGenerator.valueToCode(block, 'MSG', Order.ATOMIC) || '[]';
  const id = javascriptGenerator.valueToCode(block, 'ID', Order.ATOMIC) || '[]';
  const h = javascriptGenerator.valueToCode(block, 'H', Order.ATOMIC) || '[]';
  const s = javascriptGenerator.valueToCode(block, 'S', Order.ATOMIC) || '[]';
  const ppub = javascriptGenerator.valueToCode(block, 'PPUB', Order.ATOMIC) || '[]';
  registerSm9();
  return ['sm9Verify(' + msg + ', ' + id + ', ' + h + ', ' + s + ', ' + ppub + ', 1)', Order.ATOMIC];
};
