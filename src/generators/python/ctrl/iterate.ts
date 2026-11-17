import { pythonGenerator, Order } from 'blockly/python';
import type { Block } from 'blockly/core';

pythonGenerator.forBlock['ctrl_iterate'] = function (block: Block): string {
  const varName = block.getFieldValue('VAR') || 'i';
  // TIMES 是值输入：接变量/表达式时按代码取，空着时用影子块（32）的默认值。
  const times = pythonGenerator.valueToCode(block, 'TIMES', Order.NONE) || '32';
  let branch = pythonGenerator.statementToCode(block, 'DO');
  if (!branch || branch.trim() === '') {
    branch = 'pass\n';
  }
  const code =
    `for ${varName} in range(${times}):\n` +
    pythonGenerator.prefixLines(branch, '    ');
  return code;
};
