import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';

import { captureLoopBound } from './loop-bound';

/**
 * `ctrl_iterate` → `for (let VAR = 0; VAR < TIMES; VAR++)`。
 *
 * 与 `ctrl_range` 同理：Python 的 `range(TIMES)` 只求值一次次数，JS 的 `for` 条件每轮
 * 重算，所以 `TIMES` 非常量时先绑临时变量（见 `loop-bound.ts`）。
 */
javascriptGenerator.forBlock['ctrl_iterate'] = function (block: Block): string {
  const varName = block.getFieldValue('VAR') || 'i';
  // TIMES 是值输入：接变量/表达式时按代码取，空着时用影子块（32）的默认值。
  const times = javascriptGenerator.valueToCode(block, 'TIMES', Order.NONE) || '32';
  let branch = javascriptGenerator.statementToCode(block, 'DO');
  if (!branch || branch.trim() === '') {
    branch = '  // 空操作\n';
  }
  const bound = captureLoopBound(times, '__ctrl_iterate_times__', varName);
  const note = bound.captured ? '// 次数只求值一次（对齐 Python range 的语义）\n' : '';
  return `// 迭代循环\n${note}for (let ${varName} = 0${bound.declaration}; ${varName} < ${bound.reference}; ${varName}++) {\n${branch}}\n`;
};
