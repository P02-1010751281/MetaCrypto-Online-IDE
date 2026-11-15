import * as Blockly from 'blockly/core';
import { CRYPTO_PARAM_TYPES } from './shared';

// ─────────────────────────────────────────────────────────
// procedures_mutatorcontainer — mutator 根块
// ─────────────────────────────────────────────────────────

Blockly.Blocks['procedures_mutatorcontainer'] = {
  init: function () {
    const msg = Blockly.Msg as Record<string, string>;
    this.appendDummyInput()
      .appendField(msg.PROCEDURES_MUTATORCONTAINER_TITLE || 'procedure properties');
    this.appendStatementInput('STACK');
    this.setColour(290);
    this.setTooltip(msg.PROCEDURES_MUTATORCONTAINER_TOOLTIP || 'Add, remove, or reorder items.');
    this.setHelpUrl(msg.PROCEDURES_MUTATORCONTAINER_HELPURL || '');
    (this as unknown as { contextMenu: boolean }).contextMenu = false;
  },
};

// ─────────────────────────────────────────────────────────
// procedures_mutatorarg — 参数块（变量名 + 类型下拉）
// ─────────────────────────────────────────────────────────

Blockly.Blocks['procedures_mutatorarg'] = {
  init: function () {
    this.appendDummyInput()
      .appendField((Blockly.Msg as Record<string, string>).PROCEDURES_MUTATORARG_TITLE || 'input')
      .appendField(new Blockly.FieldVariable(null, undefined, undefined, ''), 'NAME')
      .appendField(':')
      .appendField(new Blockly.FieldDropdown(CRYPTO_PARAM_TYPES), 'PARAM_TYPE');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setStyle('procedure_blocks');
    this.setColour(290);
    this.setTooltip('A crypto procedure parameter with a type annotation.');
    (this as unknown as { contextMenu: boolean }).contextMenu = false;
  },
};
