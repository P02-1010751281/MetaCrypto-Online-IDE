// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createToolboxConfig } from '@/utils/toolbox-config';

/**
 * 工具箱类目口径（docs/standards/CONFORMANCE-INVENTORY.md「工具箱类目口径」）：
 * 一个类目按「列出的积木来自 blockly/blocks 自带库，还是本项目 src/blocks 注册」分三类。
 *
 * 清单只收 blockly/blocks 自带且本项目未覆盖的积木。`procedures_*` 虽然沿用 Blockly
 * 的类型名，但 src/blocks/procedure 覆盖了实现，因此不算自带积木。
 */
const BLOCKLY_BUILTIN = new Set<string>([
  // Control Flow
  'logic_compare',
  'logic_operation',
  'logic_negate',
  'logic_boolean',
  'logic_ternary',
  'logic_null',
  'controls_repeat_ext',
  'controls_whileUntil',
  'controls_for',
  'controls_forEach',
  'controls_flow_statements',
  // Math
  'math_number',
  'math_arithmetic',
  'math_single',
  'math_trig',
  'math_constant',
  'math_modulo',
  'math_constrain',
  'math_round',
  'math_random_int',
  'math_random_float',
  // Arrays
  'lists_create_with',
  'lists_create_empty',
  'lists_repeat',
  'lists_length',
  'lists_isEmpty',
  'lists_indexOf',
  'lists_getIndex',
  'lists_setIndex',
  'lists_getSublist',
  'lists_split',
  'lists_sort',
  // Data & Convert
  'text',
  'text_join',
  'text_append',
  'text_length',
  'text_isEmpty',
  'text_indexOf',
  'text_charAt',
  'text_getSubstring',
  'text_changeCase',
  'text_trim',
  'text_print',
]);

interface ToolboxItem {
  kind?: string;
  type?: string;
}

interface ToolboxCategory {
  kind?: string;
  name?: string;
  custom?: string;
  contents?: ToolboxItem[];
}

function blockTypes(category: ToolboxCategory): string[] {
  const contents = Array.isArray(category.contents) ? category.contents : [];
  return contents
    .filter((item) => item?.kind === 'block' && typeof item.type === 'string')
    .map((item) => item.type as string);
}

function partition(types: string[]) {
  const builtin = types.filter((type) => BLOCKLY_BUILTIN.has(type));
  const project = types.filter((type) => !BLOCKLY_BUILTIN.has(type));
  return { builtin, project };
}

describe('toolbox category taxonomy', () => {
  const categories = (
    createToolboxConfig() as unknown as { contents: ToolboxCategory[] }
  ).contents;

  it('exposes 17 categories, matching the inventory count', () => {
    expect(categories).toHaveLength(17);
    for (const category of categories) {
      expect(category.kind).toBe('category');
      expect(typeof category.name).toBe('string');
    }
  });

  it('keeps the 2 / 3 / 12 split from the inventory', () => {
    const rows = categories.map((category) => {
      const types = blockTypes(category);
      const { builtin, project } = partition(types);
      return {
        name: category.name,
        custom: category.custom ?? null,
        total: types.length,
        builtin: builtin.length,
        project: project.length,
        projectNames: project,
      };
    });

    // 静态类目按列出的积木判；动态类目（custom flyout）没有静态清单，单列一类。
    const staticBuiltinOnly = rows.filter(
      (row) => row.custom === null && row.builtin > 0 && row.project === 0,
    );
    const mixed = rows.filter((row) => row.builtin > 0 && row.project > 0);
    const dynamicBuiltin = rows.filter((row) => row.custom === 'VARIABLE');
    const staticProjectOnly = rows.filter(
      (row) => row.custom === null && row.builtin === 0,
    );
    const dynamicProject = rows.filter(
      (row) => row.custom !== null && row.custom !== 'VARIABLE',
    );

    // 纯内置 2 个（Math 静态 + Variables 动态）+ 混用 3 个 + 项目块 12 个 = 17。
    expect(staticBuiltinOnly.map((row) => row.name)).toHaveLength(1);
    expect(mixed.map((row) => row.name)).toHaveLength(3);
    expect(dynamicBuiltin).toHaveLength(1);
    expect(staticProjectOnly).toHaveLength(9);
    expect(dynamicProject.map((row) => row.custom)).toEqual([
      'SBOX',
      'CRYPTO_PROCEDURE',
      'CRYPTO_TEMPLATES',
    ]);
    expect(
      staticBuiltinOnly.length + mixed.length + dynamicBuiltin.length +
        staticProjectOnly.length + dynamicProject.length,
    ).toBe(17);

    for (const row of staticProjectOnly) expect(row.total).toBeGreaterThan(0);
    expect(staticBuiltinOnly.map((row) => row.total)).toEqual([10]);

    // 混用：Control Flow 11+2、Arrays 11+2、Data & Convert 11+10。
    expect(mixed.map((row) => [row.builtin, row.project])).toEqual([
      [11, 2],
      [11, 2],
      [11, 10],
    ]);
    expect(mixed.map((row) => row.projectNames)).toEqual([
      ['ctrl_iterate', 'ctrl_range'],
      ['arr_append', 'arr_partition_to_array'],
      [
        'data_bit_length',
        'data_byte_length',
        'data_convert_to_int',
        'data_convert_bits_to_bytes',
        'data_convert_bytes_to_bits',
        'data_value',
        'data_int_list',
        'seed_bytes',
        'seed_hex',
        'cipher_key_from_seed',
      ],
    ]);
  });

  it('counts 43 distinct Blockly built-in blocks across those five categories', () => {
    const seen = new Set<string>();
    let duplicates = 0;
    for (const category of categories) {
      for (const type of partition(blockTypes(category)).builtin) {
        if (seen.has(type)) duplicates += 1;
        seen.add(type);
      }
    }
    expect(duplicates).toBe(0);
    expect(seen.size).toBe(43);
    for (const type of seen) expect(BLOCKLY_BUILTIN.has(type)).toBe(true);
  });

  it('does not let overridden procedure blocks count as built-in', () => {
    // src/blocks/procedure 覆盖了 procedures_defreturn 等实现，类型名仍来自 Blockly；
    // 类目口径按「实现来源」判，因此这些类目一律落到项目块一侧。
    const rows = categories.map((category) => {
      const types = blockTypes(category);
      return { custom: category.custom ?? null, types };
    });
    const procedureCategory = rows.find((row) => row.custom === 'CRYPTO_PROCEDURE');
    expect(procedureCategory).toBeDefined();
    expect(procedureCategory?.types).toHaveLength(0);
  });
});
