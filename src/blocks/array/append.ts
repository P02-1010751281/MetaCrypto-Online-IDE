/**
 * 数组追加语句块（`arr_append`）
 *
 * 语义：把 `VALUE` 追加到 `LIST` 末尾，**原地修改**（mutating）——Python 生成
 * `LIST.append(VALUE)`，JavaScript 生成 `LIST.push(VALUE);`。它是语句块（无输出、有
 * previous/next）：追加的效果只体现在列表本身上，接到值槽位没有可表达的结果。
 *
 * `VALUE` 的 check 取 `TYPE_NUMBER`：`LIST` 声明为 `TYPE_INT_LIST`，其元素域就是数值。
 * Blockly 的连接检查把**未标注类型**的槽位（`variables_get`、原生 `lists_getIndex` 等）视为
 * 通配，所以接变量/表达式不会被误拒；而明确返回 `IntList`/`Bytes`/`SBox` 的块会被挡在值槽位
 * 外——那正是「把另一个容器当成元素追加」的误用。若改用 null，这些容器也能接进来，生成的
 * JS/Python 会静默产出嵌套容器的结果，因此不取 null。
 */
import * as Blockly from 'blockly/core';
import { TYPE_INT_LIST, TYPE_NUMBER } from '@cc/constants/block-types';

export const APPEND_BLOCK_TYPES = ['arr_append'] as const;
export type AppendBlockType = (typeof APPEND_BLOCK_TYPES)[number];

Blockly.Blocks['arr_append'] = {
  init: function () {
    this.appendValueInput('LIST')
      .setCheck(TYPE_INT_LIST)
      .appendField(Blockly.Msg.CRYPTO_APPEND_LIST || 'Append to');
    this.appendValueInput('VALUE')
      .setCheck(TYPE_NUMBER)
      .appendField(Blockly.Msg.CRYPTO_APPEND_VALUE || 'value');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(200);
    this.setTooltip(
      Blockly.Msg.CRYPTO_APPEND_TOOLTIP ||
        'Append the value to the end of the list. This mutates the list in place; '
          + 'appending to a temporary literal has no effect.',
    );
    this.setHelpUrl('');
  },
};
