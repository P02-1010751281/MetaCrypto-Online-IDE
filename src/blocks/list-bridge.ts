/**
 * 原生列表块的类型桥接（R2）。
 *
 * 原生块有两种定义形态，必须分别处理：
 *   1. **函数式**（`{init() {...}}`，如 `lists_create_with` / `lists_split`）——
 *      包装 `init` 与形状更新钩子，原结构完全保留。
 *   2. **JSON 定义**（`{message0, args0, output}`，如 `lists_repeat` / `lists_length`）——
 *      直接改写 `output` 与 `args0[].check`。**不能**给它加 `init`：Blockly 会走
 *      `jsonInit` 的 token 校验并抛 `Message does not reference all N arg(s)`。
 *
 * 只拓宽「当前已经接受 `'Array'`」的端口，所以 `NUM`/`DELIM` 这类纯 Number/String
 * 端口不会被误放宽；`lists_length` 的 `VALUE`（`['String','Array']`）会被放宽。
 *
 * 触发点在模块加载时（`installListBridge()`），并且是幂等的。
 */

import 'blockly/blocks';
import * as Blockly from 'blockly/core';

import {
  LIST_BRIDGE_CHECKS,
  LIST_BRIDGE_INPUT_WIDEN,
  LIST_BRIDGE_LIST_OUTPUT,
} from '@cc/constants/list-bridge';

const LIST_OUTPUT = new Set(LIST_BRIDGE_LIST_OUTPUT);

/** 会重建端口 check 的原生钩子；存在才包装。 */
const SHAPE_HOOKS = ['updateType_', 'updateShape_', 'updateAt_'] as const;

let installed = false;

/** JSON 定义里可能出现的输入/输出字段名。 */
interface JsonFieldEntry {
  check?: string | string[] | null;
  [key: string]: unknown;
}
type JsonBlockDefinition = Record<string, unknown> & {
  init?: (this: Blockly.Block) => void;
};

function widenCheck(check: readonly string[]): string[] {
  return [...new Set([...check, ...LIST_BRIDGE_CHECKS])];
}

function toCheckList(check: string | string[] | null | undefined): string[] {
  if (!check) return [];
  return Array.isArray(check) ? check : [check];
}

/** 只拓宽「当前已经接受 Array」的值输入端口。 */
function widenInputs(block: Blockly.Block): void {
  for (const input of block.inputList) {
    const connection = input.connection;
    if (!connection) continue;
    const check = connection.getCheck();
    if (!check || !check.includes('Array')) continue;
    connection.setCheck(widenCheck(check));
  }
}

function applyBridge(block: Blockly.Block, isListOutput: boolean): void {
  if (isListOutput && block.outputConnection) {
    block.setOutput(true, [...LIST_BRIDGE_CHECKS]);
  }
  widenInputs(block);
}

/** 函数式定义的块：包 init + 钩子。 */
function wrapFunctionalBlock(
  definition: JsonBlockDefinition,
  isListOutput: boolean,
): void {
  const originalInit = definition.init as (this: Blockly.Block) => void;
  definition.init = function (this: Blockly.Block): void {
    originalInit.call(this);
    applyBridge(this, isListOutput);
  };

  for (const hook of SHAPE_HOOKS) {
    const original = definition[hook];
    if (typeof original !== 'function') continue;
    definition[hook] = function (this: Blockly.Block, ...args: unknown[]): unknown {
      const result = (original as (...rest: unknown[]) => unknown).apply(this, args);
      applyBridge(this, isListOutput);
      return result;
    };
  }
}

/** JSON 定义的块：原地改写 output 与 argsN[].check。 */
function widenJsonDefinition(
  definition: JsonBlockDefinition,
  isListOutput: boolean,
): void {
  if (isListOutput) {
    const output = toCheckList(definition.output as string | string[] | null);
    if (output.includes('Array')) definition.output = [...LIST_BRIDGE_CHECKS];
  }
  for (const [key, value] of Object.entries(definition)) {
    if (!/^args\d+$/.test(key) || !Array.isArray(value)) continue;
    for (const entry of value as JsonFieldEntry[]) {
      if (!entry || typeof entry !== 'object') continue;
      const check = toCheckList(entry.check);
      if (!check.includes('Array')) continue;
      entry.check = widenCheck(check);
    }
  }
}

function bridgeBlock(blockType: string): void {
  const definition = (Blockly.Blocks as Record<string, JsonBlockDefinition | undefined>)[
    blockType
  ];
  if (!definition) {
    console.warn(`[list-bridge] 原生块 ${blockType} 未定义，跳过桥接`);
    return;
  }
  const isListOutput = LIST_OUTPUT.has(blockType);
  if (typeof definition.init === 'function') wrapFunctionalBlock(definition, isListOutput);
  else widenJsonDefinition(definition, isListOutput);
}

/** 幂等地把桥接装到原生列表块上。 */
export function installListBridge(): void {
  if (installed) return;
  installed = true;
  for (const blockType of LIST_BRIDGE_INPUT_WIDEN) bridgeBlock(blockType);
}

installListBridge();
