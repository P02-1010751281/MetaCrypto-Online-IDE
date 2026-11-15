/**
 * 先设 Blockly 语言包，再加载块定义。
 *
 * 块的 JSON 定义里写的是 `%{BKY_...}`，注册时会立刻把占位符替换成 `Blockly.Msg` 的值；
 * 若此时语言包没装，`Blockly.Msg.X` 是 undefined，注册直接抛
 * `Cannot read properties of undefined (reading 'replace')`。
 * ESM 按 import 顺序求值，所以本模块必须在 `@/blocks` 之前被 import。
 */

import * as Blockly from 'blockly/core';
import * as enMessages from 'blockly/msg/en';

Blockly.setLocale(enMessages as unknown as Record<string, string>);
