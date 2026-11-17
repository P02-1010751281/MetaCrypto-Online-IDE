import { pythonGenerator, Order } from 'blockly/python';
import type { Block } from 'blockly/core';

/**
 * `arr_append` → `LIST.append(VALUE)`：原地修改列表，语句块无返回值。
 * 列表表达式按 member 优先级取码，`a[i].append(...)` 之类不会缺括号。
 */
pythonGenerator.forBlock['arr_append'] = function (block: Block): string {
  const list = pythonGenerator.valueToCode(block, 'LIST', Order.MEMBER) || '[]';
  const value = pythonGenerator.valueToCode(block, 'VALUE', Order.NONE) || 'None';
  return `${list}.append(${value})\n`;
};
