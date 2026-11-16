import * as Blockly from 'blockly/core';
import { TYPE_BYTES, TYPE_NUMBER } from '@cc/constants/block-types';

// ─────────────────────────────────────────────────────────
// crypto_return — 独立返回块
// ─────────────────────────────────────────────────────────

Blockly.Blocks['crypto_return'] = {
  init: function () {
    this.appendValueInput('VALUE').setCheck(null).appendField('🔧 return');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290);
    this.setTooltip('Return a value from a crypto function.');
    this.setHelpUrl('');
  },
};

// ─────────────────────────────────────────────────────────
// primitive_def — 随机性测评入口（固定函数名与签名）
// ─────────────────────────────────────────────────────────

Blockly.Blocks['primitive_def'] = {
  init: function () {
    this.appendDummyInput().appendField('🧪 测评原语 primitive');
    this.appendValueInput('NBYTES')
      .setCheck(TYPE_NUMBER)
      .appendField('字节数 n_bytes');
    this.appendValueInput('SEED')
      .setCheck(TYPE_BYTES)
      .appendField('种子 seed');
    this.appendStatementInput('BODY').appendField('执行');
    this.appendValueInput('RETURN')
      .setCheck(TYPE_BYTES)
      .appendField('返回 bytes');
    this.setColour(290);
    this.setTooltip(
      '生成后端随机性测评的固定入口 def primitive(n_bytes, seed=b"") -> bytes。\n' +
        'n_bytes 留空按 32 字节，seed 留空按空字节串；返回值必须为 bytes。',
    );
    this.setHelpUrl('');
  },
};
