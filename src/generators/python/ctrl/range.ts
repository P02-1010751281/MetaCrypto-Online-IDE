import { pythonGenerator, Order } from 'blockly/python';
import type { Block } from 'blockly/core';

/**
 * `ctrl_range` → `for VAR in range(FROM, TO):`（TO 独占，逐字对应 Python 的 range 两参形式）。
 * 空循环体补 `pass`，与 `ctrl_iterate` 的写法一致。
 */
pythonGenerator.forBlock['ctrl_range'] = function (block: Block): string {
  const varName = block.getFieldValue('VAR') || 'i';
  // FROM/TO 是值输入：接变量/表达式时按代码取，空着时用影子块的默认值兜底。
  const from = pythonGenerator.valueToCode(block, 'FROM', Order.NONE) || '0';
  const to = pythonGenerator.valueToCode(block, 'TO', Order.NONE) || '10';
  let branch = pythonGenerator.statementToCode(block, 'DO');
  if (!branch || branch.trim() === '') {
    branch = 'pass\n';
  }
  return `for ${varName} in range(${from}, ${to}):\n` + pythonGenerator.prefixLines(branch, '    ');
};
