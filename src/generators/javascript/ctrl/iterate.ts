import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';

javascriptGenerator.forBlock['ctrl_iterate'] = function (block: Block): string {
  const varName = block.getFieldValue('VAR') || 'i';
  // TIMES 是值输入：接变量/表达式时按代码取，空着时用影子块（32）的默认值。
  const times = javascriptGenerator.valueToCode(block, 'TIMES', Order.NONE) || '32';
  let branch = javascriptGenerator.statementToCode(block, 'DO');
  if (!branch || branch.trim() === '') {
    branch = '  // 空操作\n';
  }
  return `// 迭代循环\nfor (let ${varName} = 0; ${varName} < ${times}; ${varName}++) {\n${branch}}\n`;
};
