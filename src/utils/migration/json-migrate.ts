import { migrateBlockTypesJson } from './block-map';
import {
  injectSboxRowColFields,
  migrateSboxDefJson,
  migrateSboxFieldNamesJson,
  migrateSboxJsonMutateData,
} from './json-sbox';
import { legacyPartitionMode } from './partition-mode';

export function migrateJsonState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  if (!state || typeof state !== 'object') return state;

  let jsonStr = JSON.stringify(state);

  jsonStr = migrateSboxFieldNamesJson(jsonStr);

  try {
    const parsed = JSON.parse(jsonStr);
    migrateBlockTypesJson(parsed);
    injectSboxRowColFields(parsed);
    migrateSboxJsonMutateData(parsed);
    migrateSboxDefJson(parsed);
    // deferSboxFields 已移除：Blockly 12 原生支持大量字段，不再搬移到 _sbx_def_
    migrateCompoundInstrField(parsed);
    migrateBitOpFieldValues(parsed);
    const variableNames = new Map<string, string>();
    if (Array.isArray(parsed.variables)) {
      for (const variable of parsed.variables) {
        if (typeof variable !== 'object' || variable === null) continue;
        const { id, name } = variable as Record<string, unknown>;
        if (typeof id === 'string' && typeof name === 'string') variableNames.set(id, name);
      }
    }
    migratePartitionModeJson(parsed, variableNames);
    // ctrl_assign 赋值块 → variables_set（Blockly 内置变量赋值）
    migrateAssignmentBlocks(parsed);
    // ctrl_iterate 的 TIMES：数字字段 → 值输入（次数不丢）
    migrateIterateTimesField(parsed);
    return parsed as Record<string, unknown>;
  } catch {
    return state;
  }
}

/**
 * `ctrl_iterate` 的次数从数字字段（`fields.TIMES`）改成值输入（`inputs.TIMES`）。
 *
 * 为什么改：`range(n)` 的次数可能不是常数，而数字字段只能填常数；改成值输入后循环次数
 * 可以接变量与表达式，生成代码与 Python 的 `range(n)` 逐字对应。旧工作区把次数存在字段里，
 * 这里搬到 `math_number` 影子块，次数本身不丢。
 */
function migrateIterateTimesField(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) migrateIterateTimesField(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;
  if (record.type === 'ctrl_iterate' && typeof record.fields === 'object' && record.fields !== null) {
    const fields = record.fields as Record<string, unknown>;
    if ('TIMES' in fields) {
      const times = fields.TIMES;
      delete fields.TIMES;
      if (typeof record.inputs !== 'object' || record.inputs === null) record.inputs = {};
      const inputs = record.inputs as Record<string, unknown>;
      if (!('TIMES' in inputs)) {
        inputs.TIMES = {
          shadow: { type: 'data_value', fields: { NUM: String(times ?? '32') } },
        };
      }
    }
  }

  for (const child of Object.values(record)) migrateIterateTimesField(child);
}

function migratePartitionModeJson(value: unknown, variableNames: ReadonlyMap<string, string>): void {
  if (Array.isArray(value)) {
    for (const item of value) migratePartitionModeJson(item, variableNames);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;
  if (record.type === 'arr_partition_to_array') {
    const fields = record.fields && typeof record.fields === 'object'
      ? record.fields as Record<string, unknown>
      : (record.fields = {}) as Record<string, unknown>;
    if (!('MODE' in fields)) {
      fields.MODE = legacyPartitionMode(jsonPartitionTarget(record.inputs, variableNames));
    }
  }
  for (const child of Object.values(record)) migratePartitionModeJson(child, variableNames);
}

function jsonPartitionTarget(value: unknown, variableNames: ReadonlyMap<string, string>): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const inputs = value as Record<string, unknown>;
  const target = inputs.TARGET;
  if (typeof target !== 'object' || target === null) return undefined;
  const input = target as Record<string, unknown>;
  const child = input.block ?? input.shadow;
  if (typeof child !== 'object' || child === null) return undefined;
  const block = child as Record<string, unknown>;
  const fields = block.fields;
  if (typeof fields !== 'object' || fields === null) return undefined;
  const blockFields = fields as Record<string, unknown>;
  const field = block.type === 'data_value' ? blockFields.NUM : block.type === 'variables_get' ? blockFields.VAR : undefined;
  if (typeof field === 'string' || typeof field === 'number') return String(field);
  if (typeof field === 'object' && field !== null) {
    const variableField = field as Record<string, unknown>;
    if (typeof variableField.name === 'string') return variableField.name;
    if (typeof variableField.id === 'string') return variableNames.get(variableField.id);
  }
  return undefined;
}

function migrateCompoundInstrField(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) migrateCompoundInstrField(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  if (
    record.type === 'lgc_compound' &&
    record.fields &&
    typeof record.fields === 'object'
  ) {
    const fields = record.fields as Record<string, unknown>;
    if (typeof fields.instr === 'string') {
      const map: Record<string, string> = {
        XOR: 'XOR_XOR',
        OR: 'OR_OR',
        AND: 'AND_AND',
      };
      fields.instr = map[fields.instr as string] || fields.instr;
    }
  }

  for (const key of Object.keys(record)) {
    migrateCompoundInstrField(record[key]);
  }
}

function migrateBitOpFieldValues(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) migrateBitOpFieldValues(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  if (
    (record.type === 'crypto_bitwise_expr' ||
      record.type === 'bit_operation') &&
    record.fields &&
    typeof record.fields === 'object'
  ) {
    const fields = record.fields as Record<string, unknown>;
    const opMap: Record<string, string> = {
      ROR32: 'RIGHT_ROTATE',
      SHR32: 'RIGHT_SHIFT',
    };
    if (typeof fields.OP === 'string') {
      fields.OP = opMap[fields.OP as string] || fields.OP;
    }
  }

  for (const key of Object.keys(record)) {
    migrateBitOpFieldValues(record[key]);
  }
}

/**
 * ctrl_assign 赋值块 → variables_set（Blockly 内置变量赋值）结构迁移 (JSON)
 *
 * 迁移步骤:
 *   1. 类型已由 BLOCK_TYPE_MIGRATION_MAP 从 ctrl_assign 改为 variables_set
 *   2. 从 inputs.LEFT 的 variables_get 内块提取 VAR 字段
 *   3. 删除 inputs.LEFT
 *   4. inputs.RIGHT 重命名为 VALUE
 */
function migrateAssignmentBlocks(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) migrateAssignmentBlocks(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === 'variables' || key === 'blocks') continue;
    migrateAssignmentBlocks(record[key]);
  }

  if ('blocks' in record) {
    const blocksVal = record.blocks;
    if (Array.isArray(blocksVal)) {
      _migrateBlocksArray(blocksVal);
    } else if (blocksVal && typeof blocksVal === 'object') {
      const inner = (blocksVal as Record<string, unknown>).blocks;
      if (Array.isArray(inner)) {
        _migrateBlocksArray(inner);
      }
    }
  }
}

function _migrateBlocksArray(items: Record<string, unknown>[]): void {
  for (const block of items) {
    _migrateSingleBlock(block);

    if (block.inputs && typeof block.inputs === 'object') {
      for (const inputVal of Object.values(
        block.inputs as Record<string, unknown>,
      )) {
        if (
          inputVal &&
          typeof inputVal === 'object' &&
          'block' in (inputVal as Record<string, unknown>)
        ) {
          _migrateBlocksArray([
            (inputVal as Record<string, unknown>).block as Record<
              string,
              unknown
            >,
          ]);
        }
      }
    }
    if (
      block.next &&
      typeof block.next === 'object' &&
      'block' in (block.next as Record<string, unknown>)
    ) {
      _migrateBlocksArray([
        (block.next as Record<string, unknown>).block as Record<
          string,
          unknown
        >,
      ]);
    }
  }
}

function _migrateSingleBlock(block: Record<string, unknown>): void {
  if (block.type !== 'variables_set') return;
  const fields = block.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields === 'object' && 'VAR' in fields) return;

  const inputs = block.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs !== 'object') return;

  const leftInput = inputs.LEFT as Record<string, unknown> | undefined;
  const leftBlock = leftInput?.block as Record<string, unknown> | undefined;
  // LEFT 为 data_value 等下标/复杂左值（如 W[j]、Comp[7]、H[j]）时，variables_set 无法表达，
  // 必须保留为 ctrl_assign——其代码生成器（left = right）可正确处理下标赋值。
  // 否则迁移成 variables_set(VAR='tmp') 会丢失下标目标，导致算法状态变量（如哈希链 H）永不更新。
  // LEFT 缺失（退化块）不在此列，仍走下方 tmp 兜底以保持旧行为。
  if (leftBlock && leftBlock.type !== 'variables_get') {
    block.type = 'ctrl_assign';
    return;
  }
  let varName = 'tmp';

  if (leftBlock && leftBlock.type === 'variables_get') {
    const leftFields = leftBlock.fields as Record<string, unknown> | undefined;
    if (leftFields && typeof leftFields.VAR === 'string') {
      varName = leftFields.VAR;
    } else if (leftFields && typeof leftFields.VAR === 'object') {
      const varObj = leftFields.VAR as Record<string, unknown>;
      varName = (varObj.name as string) || (varObj.id as string) || 'tmp';
    }
  }

  if (!block.fields || typeof block.fields !== 'object') {
    block.fields = {};
  }
  (block.fields as Record<string, unknown>).VAR = varName;
  delete inputs.LEFT;

  if ('RIGHT' in inputs) {
    inputs.VALUE = inputs.RIGHT;
    delete inputs.RIGHT;
  }
}
