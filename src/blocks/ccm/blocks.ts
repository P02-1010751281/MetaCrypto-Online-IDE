/**
 * CCM 认证加密原子块定义 (NIST SP 800-38C)
 *
 * - ccm_encrypt: CCM-Encrypt(key, nonce, aad, msg, tagLen) → Bytes（密文 ‖ 认证标签）
 *   CBC-MAC 认证（B0 ‖ 长度编码 AAD ‖ 明文，零填充）+ CTR 加密（flags ‖ nonce ‖ 计数器）。
 *   TAGLEN 下拉 4-16 字节（偶数），官方向量（附录 C Example 1-3）双语言通过。
 * - ccm_decrypt: CCM-Decrypt(key, nonce, aad, ct‖tag, tagLen) → Bytes（明文，标签不符即抛错）
 *   SP 800-38C §6.2 decryption-verification 路径：先 CTR 解出明文，再重算标签并逐字节比对。
 */
import * as Blockly from 'blockly/core';
import { TYPE_BYTES, TYPE_INT_LIST, TYPE_NUMBER } from '@/constants/block-types';

export const CCM_BLOCK_TYPES = [
  'ccm_encrypt',
  'ccm_decrypt',
  'ccm_b0',
  'ccm_counter_block',
  'ccm_cbc_mac',
  'ccm_ctr',
  'ccm_aad_len_prefix',
] as const;
export type CcmBlockType = (typeof CCM_BLOCK_TYPES)[number];

Blockly.Blocks['ccm_encrypt'] = {
  init: function () {
    this.appendValueInput('KEY')
      .setCheck(TYPE_BYTES)
      .appendField('CCM-Encrypt(');
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField(' nonce:');
    this.appendValueInput('AAD').setCheck(TYPE_INT_LIST).appendField(' aad:');
    this.appendValueInput('MSG').setCheck(TYPE_BYTES).appendField(' msg:');
    const tagDropdown = new Blockly.FieldDropdown([
      ['4', '4'],
      ['6', '6'],
      ['8', '8'],
      ['10', '10'],
      ['12', '12'],
      ['14', '14'],
      ['16', '16'],
    ]);
    tagDropdown.setValue('16');
    this.appendDummyInput()
      .appendField(tagDropdown, 'TAGLEN')
      .appendField(' tagLen)');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_BYTES);
    this.setColour(190);
    this.setTooltip(
      'CCM 认证加密 (NIST SP 800-38C)：CBC-MAC 认证标签（B0 标志位含 nonce 长度/明文长度/标签长度）+ CTR 加密，输出 密文‖标签。AES-128 官方向量（附录 C Example 1-3）验证通过。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

Blockly.Blocks['ccm_decrypt'] = {
  init: function () {
    this.appendValueInput('KEY').setCheck(TYPE_BYTES).appendField('CCM-Decrypt(');
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField(' nonce:');
    this.appendValueInput('AAD').setCheck(TYPE_INT_LIST).appendField(' aad:');
    this.appendValueInput('CT').setCheck(TYPE_BYTES).appendField(' ct‖tag:');
    const tagDropdown = new Blockly.FieldDropdown([
      ['4', '4'],
      ['6', '6'],
      ['8', '8'],
      ['10', '10'],
      ['12', '12'],
      ['14', '14'],
      ['16', '16'],
    ]);
    tagDropdown.setValue('16');
    this.appendDummyInput()
      .appendField(tagDropdown, 'TAGLEN')
      .appendField(' tagLen)');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_BYTES);
    this.setColour(190);
    this.setTooltip(
      'CCM 解密并验证 (NIST SP 800-38C §6.2)：输入 密文‖标签，先 CTR 解出明文，再重算 CBC-MAC 标签逐字节比对；标签不符直接抛错，不返回未认证明文。返回的明文只代表标签比对通过，不代表常量时间。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

/** CCM 内部算子（SP 800-38C §A.1–A.3）：B0、计数器块、CBC-MAC。 */Blockly.Blocks['ccm_b0'] = {
  init: function () {
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField('CCM-B0 首个计数器块( nonce:');
    this.appendValueInput('MSGLEN').setCheck(TYPE_NUMBER).appendField(' msgLen:');
    this.appendValueInput('AADLEN').setCheck(TYPE_NUMBER).appendField(' aadLen:');
    this.appendDummyInput()
      .appendField(' tagLen:')
      .appendField(
        new Blockly.FieldDropdown([
          ['4', '4'],
          ['6', '6'],
          ['8', '8'],
          ['10', '10'],
          ['12', '12'],
          ['14', '14'],
          ['16', '16'],
        ]),
        'TAGLEN',
      )
      .appendField(')');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_INT_LIST);
    this.setColour(190);
    this.setTooltip(
      'CCM 首块 B0（SP 800-38C §A.2）：flags（Adata 位 + (M−2)/2 + L−1）‖ nonce ‖ 明文长度（L 字节大端）。输出 16 字节，是 CBC-MAC 的起始块。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

Blockly.Blocks['ccm_counter_block'] = {
  init: function () {
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField('CCM 计数器块 A_i( nonce:');
    this.appendValueInput('I').setCheck(TYPE_NUMBER).appendField(' i:');
    this.appendDummyInput()
      .appendField(' tagLen:')
      .appendField(
        new Blockly.FieldDropdown([
          ['4', '4'],
          ['6', '6'],
          ['8', '8'],
          ['10', '10'],
          ['12', '12'],
          ['14', '14'],
          ['16', '16'],
        ]),
        'TAGLEN',
      )
      .appendField(')');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_INT_LIST);
    this.setColour(190);
    this.setTooltip(
      'CCM 计数器块 A_i（SP 800-38C §A.3）：flags（仅 L−1，无 Adata/标签位）‖ nonce ‖ i（L 字节大端）。A_0 用于掩码标签，A_1… 用于 CTR 加密。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

Blockly.Blocks['ccm_cbc_mac'] = {
  init: function () {
    this.appendValueInput('KEY').setCheck(TYPE_BYTES).appendField('CCM-CBC-MAC( key:');
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField(' nonce:');
    this.appendValueInput('AAD').setCheck(TYPE_INT_LIST).appendField(' aad:');
    this.appendValueInput('MSG').setCheck(TYPE_BYTES).appendField(' msg:');
    this.appendDummyInput()
      .appendField(' tagLen:')
      .appendField(
        new Blockly.FieldDropdown([
          ['4', '4'],
          ['6', '6'],
          ['8', '8'],
          ['10', '10'],
          ['12', '12'],
          ['14', '14'],
          ['16', '16'],
        ]),
        'TAGLEN',
      )
      .appendField(')');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_BYTES);
    this.setColour(190);
    this.setTooltip(
      'CCM CBC-MAC（SP 800-38C §A.2）：对 B0 ‖ 长度编码 AAD ‖ 明文（各段零填充到 16 字节）做整串 CBC-MAC，输出 16 字节 X。实际标签还需与 E_K(A_0) 异或后截断，本块不代替 ccm_encrypt。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

Blockly.Blocks['ccm_ctr'] = {
  init: function () {
    this.appendValueInput('KEY').setCheck(TYPE_BYTES).appendField('CCM-CTR( key:');
    this.appendValueInput('NONCE').setCheck(TYPE_INT_LIST).appendField(' nonce:');
    this.appendValueInput('MSG').setCheck(TYPE_BYTES).appendField(' msg:');
    this.appendDummyInput()
      .appendField(' tagLen:')
      .appendField(
        new Blockly.FieldDropdown([
          ['4', '4'],
          ['6', '6'],
          ['8', '8'],
          ['10', '10'],
          ['12', '12'],
          ['14', '14'],
          ['16', '16'],
        ]),
        'TAGLEN',
      )
      .appendField(')');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_BYTES);
    this.setColour(190);
    this.setTooltip(
      'CCM 计数器模式（SP 800-38C §A.3）：用 A_1… 生成密钥流并与明文异或，只输出密文，不含认证标签。认证与标签由 ccm_cbc_mac / ccm_encrypt 负责。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};

Blockly.Blocks['ccm_aad_len_prefix'] = {
  init: function () {
    this.appendValueInput('AADLEN').setCheck(TYPE_NUMBER).appendField('CCM AAD 长度前缀( aadLen:');
    this.appendDummyInput().appendField(')');
    this.setInputsInline(true);
    this.setOutput(true, TYPE_INT_LIST);
    this.setColour(190);
    this.setTooltip(
      'CCM AAD 长度编码（SP 800-38C §A.2.2）：aadLen < 0xFF00 时用 2 字节大端；否则输出 0xFFFE ‖ 4 字节大端（aadLen 必须 < 2³²）。',
    );
    this.setHelpUrl('https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38C.pdf');
  },
};
