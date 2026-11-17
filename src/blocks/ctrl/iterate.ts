/**
 * 迭代循环块（`ctrl_iterate`）
 *
 * 语义：`for {VAR} in range({TIMES}):` + 循环体。与 `controls_for` 的分工是**精确对应 Python**：
 * `range(n)` 在 n ≤ 0 时一次也不执行，而 `controls_for` 的 FROM/TO 是闭区间、起点大于终点时会
 * 倒序执行——所以「一次数区间」的循环用本块，`range(a, b)` 那种闭区间才用 `controls_for`。
 *
 * `TIMES` 是**值输入**（不是数字字段）：它要能接变量与表达式（`range(n)`、`range(len(x))`），
 * 字段只能填常数。默认挂一个 `math_number(32)` 影子块，保留「拖出来就能用」的手感；旧工作区
 * 里 `fields.TIMES` 的迁移在 `src/utils/migration/json-migrate.ts` / `xml-migrate.ts`。
 */
import * as Blockly from 'blockly/core';

export const ITERATE_BLOCK_TYPES = ['ctrl_iterate'] as const;

export type IterateBlockType = typeof ITERATE_BLOCK_TYPES[number];

/** 默认次数：与旧字段默认值一致，模板预填会覆盖它。 */
const DEFAULT_TIMES = '32';

Blockly.Blocks['ctrl_iterate'] = {
  init: function() {
    this.appendDummyInput()
      .appendField(Blockly.Msg.CRYPTO_ITERATE_VAR || 'Var')
      .appendField(new Blockly.FieldTextInput('i'), 'VAR');
    this.appendValueInput('TIMES')
      .setCheck('Number')
      .appendField(Blockly.Msg.CRYPTO_ITERATE_LOOP || 'Loop');
    this.appendStatementInput('DO')
      .setCheck(null)
      .appendField(Blockly.Msg.CRYPTO_ITERATE_DO || 'Do');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip(Blockly.Msg.CRYPTO_ITERATE_TOOLTIP || 'Custom iteration loop');
    this.setHelpUrl('');

    const input = this.getInput('TIMES');
    if (input?.connection) {
      input.connection.setShadowDom(
        Blockly.utils.xml.textToDom(
          `<shadow type="data_value"><field name="NUM">${DEFAULT_TIMES}</field></shadow>`,
        ),
      );
    }
  }
};
