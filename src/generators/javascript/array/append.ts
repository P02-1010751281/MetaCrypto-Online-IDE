import { javascriptGenerator, Order } from 'blockly/javascript';
import type { Block } from 'blockly/core';

/**
 * `arr_append` → `LIST.push(VALUE);`：原地修改列表，语句块无返回值。
 * 列表表达式按 member 优先级取码，`a[i].push(...)` 之类不会缺括号。
 */
javascriptGenerator.forBlock['arr_append'] = function (block: Block): string {
  const list = javascriptGenerator.valueToCode(block, 'LIST', Order.MEMBER) || '[]';
  const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.NONE) || 'null';
  return `${list}.push(${value});\n`;
};
