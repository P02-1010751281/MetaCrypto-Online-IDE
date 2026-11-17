import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';

import { captureLoopBound } from './loop-bound';

/**
 * `ctrl_range` → `for (let VAR = FROM; VAR < TO; VAR++)`（TO 独占）。
 *
 * `TO` 非常量时先绑临时变量：Python 的 `range(FROM, TO)` 只求值一次终点，JS 的 `for`
 * 条件每轮重算，循环体改了端点变量就会越跑越长（见 `loop-bound.ts`）。`FROM` 只在初始化
 * 里出现一次，不需要处理。空循环体补注释，与 `ctrl_iterate` 的写法一致。
 */
javascriptGenerator.forBlock['ctrl_range'] = function (block: Block): string {
  const varName = block.getFieldValue('VAR') || 'i';
  // FROM/TO 是值输入：接变量/表达式时按代码取，空着时用影子块的默认值兜底。
  const from = javascriptGenerator.valueToCode(block, 'FROM', Order.NONE) || '0';
  const to = javascriptGenerator.valueToCode(block, 'TO', Order.NONE) || '10';
  let branch = javascriptGenerator.statementToCode(block, 'DO');
  if (!branch || branch.trim() === '') {
    branch = '  // 空操作\n';
  }
  const bound = captureLoopBound(to, '__ctrl_range_to__', varName);
  const note = bound.captured ? '// 终点只求值一次（对齐 Python range 的语义）\n' : '';
  return '// 范围循环（TO 独占）\n'
    + note
    + `for (let ${varName} = ${from}${bound.declaration}; ${varName} < ${bound.reference}; ${varName}++) {\n${branch}}\n`;
};
