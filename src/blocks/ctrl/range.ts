/**
 * 范围循环块（`ctrl_range`）
 *
 * 语义：逐字对应 Python 的 `range(FROM, TO)`——`TO` 是**独占**终点，`FROM ≥ TO` 时一次也不
 * 执行；`FROM`/`TO` 都是**值输入**（不是数字字段），所以能接变量与表达式（`range(n, m)`、
 * `range(0, len(x))`），这正是这块存在的理由。
 *
 * 与 `controls_for` 的分工：`controls_for` 的 FROM/TO 是**闭区间**，起点大于终点会倒序执行；
 * 本块是半开区间，所以只有它逐字对应 `range(a, b)`。默认挂 0 / 10 两个影子块，保留「拖出来
 * 就能跑」的手感；生成器对空输入另有 '0' / '10' 兜底。
 *
 * 区间在进入循环前定格：Python 的 `range(...)` 只求值一次端点，JavaScript 侧在终点非常量时
 * 先绑临时变量再比较（`loop-bound.ts`），否则循环体改端点变量会跑出与 Python 不同的次数。
 */
import * as Blockly from 'blockly/core';

export const RANGE_BLOCK_TYPES = ['ctrl_range'] as const;

export type RangeBlockType = typeof RANGE_BLOCK_TYPES[number];

/** 影子块默认值：FROM=0、TO=10，与生成器的空输入兜底保持一致。 */
const DEFAULT_FROM = '0';
const DEFAULT_TO = '10';

Blockly.Blocks['ctrl_range'] = {
  init: function () {
    this.appendValueInput('FROM')
      .setCheck('Number')
      .appendField(Blockly.Msg.CRYPTO_RANGE_VAR || 'Var')
      .appendField(new Blockly.FieldTextInput('i'), 'VAR')
      .appendField(Blockly.Msg.CRYPTO_RANGE_FROM || 'from');
    this.appendValueInput('TO')
      .setCheck('Number')
      .appendField(Blockly.Msg.CRYPTO_RANGE_TO || 'to (exclusive)');
    this.appendStatementInput('DO')
      .setCheck(null)
      .appendField(Blockly.Msg.CRYPTO_RANGE_DO || 'Do');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip(
      Blockly.Msg.CRYPTO_RANGE_TOOLTIP ||
        'range(FROM, TO) with an exclusive TO: the loop body never runs when FROM >= TO. '
          + 'control_for (controls_for) is inclusive and counts down when FROM > TO.',
    );
    this.setHelpUrl('');

    for (const [name, value] of [['FROM', DEFAULT_FROM], ['TO', DEFAULT_TO]] as const) {
      const input = this.getInput(name);
      if (input?.connection) {
        input.connection.setShadowDom(
          Blockly.utils.xml.textToDom(
            `<shadow type="data_value"><field name="NUM">${value}</field></shadow>`,
          ),
        );
      }
    }
  },
};
