// @vitest-environment jsdom
/**
 * 多文件项目代码生成：跨文件函数符号可见、entry 最后生成、原语代码只注入一次。
 *
 * 这些用例直接用手写的 Blockly 序列化 JSON 当文件负载，模拟 ProjectStore 里
 * 多个 block 文件拼成一个项目的形态；jsdom 下也必须先注册 procedure 块，
 * 因为工作区加载阶段就会解析 call 块的下拉选项。
 */
import { describe, expect, it } from 'vitest';

import '@/blocks/procedure/blocks';
import '@/generators/python/procedure/blocks';
import '@/generators/javascript/procedure/blocks';
import {
  extractProjectSymbols,
  generateProjectBundle,
} from '@/utils/projectCodegen';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';

/** 序列化工作区的最小骨架：languageVersion 与 blocks 数组。 */
function workspaceJson(blocks: unknown[]): string {
  return JSON.stringify({ blocks: { languageVersion: 0, blocks } });
}

const HELPER_FILE: ProjectFileRecord = {
  fileId: 'file-helper',
  name: 'helper.block.json',
  workspace: workspaceJson([
    {
      type: 'procedures_defreturn',
      fields: { NAME: 'helper' },
      extraState: { hasStatements: false },
    },
  ]),
};

const ENTRY_FILE: ProjectFileRecord = {
  fileId: 'file-main',
  name: 'main.block.json',
  workspace: workspaceJson([
    { type: 'procedures_callreturn', fields: { NAME: 'helper' } },
  ]),
  isEntry: true,
};

describe('extractProjectSymbols', () => {
  it('发现其他文件定义的函数，并按 name 记录归属', () => {
    const { symbols, errors } = extractProjectSymbols([HELPER_FILE, ENTRY_FILE]);

    expect(errors).toEqual([]);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      fileId: 'file-helper',
      path: 'helper.block.json',
      name: 'helper',
      hasReturn: true,
    });
  });

  it('同名函数在两个文件里定义时报重名', () => {
    const duplicate: ProjectFileRecord = {
      ...HELPER_FILE,
      fileId: 'file-dup',
      name: 'dup.block.json',
    };

    const { errors } = extractProjectSymbols([HELPER_FILE, duplicate]);

    expect(errors.some((message) => message.includes('函数名重复：helper'))).toBe(true);
    expect(errors.some((message) => message.includes('helper.block.json'))).toBe(true);
    expect(errors.some((message) => message.includes('dup.block.json'))).toBe(true);
  });

  it('空工作区文件不抛异常也不产生符号', () => {
    const empty: ProjectFileRecord = {
      fileId: 'file-empty',
      name: 'empty.block.json',
      workspace: '',
    };

    expect(() => extractProjectSymbols([empty])).not.toThrow();
    expect(extractProjectSymbols([empty])).toEqual({ symbols: [], errors: [] });
  });
});

describe('generateProjectBundle', () => {
  it('把两个文件拼成一份 python，entry 在最后且原语只注入一次', () => {
    // 故意把 entry 放在数组首位，验证生成顺序不只是照抄文件顺序。
    const bundle = generateProjectBundle(
      [ENTRY_FILE, HELPER_FILE],
      'file-main',
      'unknown',
    );

    expect(bundle.errors).toEqual([]);
    expect(bundle.symbols.map((symbol) => symbol.name)).toEqual(['helper']);

    // 两个文件的内容都在，且 helper 的 def 与 entry 的调用各自可见。
    expect(bundle.python).toContain('# file: helper.block.json');
    expect(bundle.python).toContain('def helper()');
    expect(bundle.python).toContain('# file: main.block.json');
    expect(bundle.python).toContain('helper()');

    // entry 必须排在最后：入口依赖其他文件的函数，原语支撑代码只属于入口。
    const helperAt = bundle.python.indexOf('# file: helper.block.json');
    const entryAt = bundle.python.indexOf('# file: main.block.json');
    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(entryAt).toBeGreaterThan(helperAt);

    // 原语与其算法入口只能由 entry 注入一次。
    expect(bundle.python.match(/def primitive\(/g)).toHaveLength(1);
    expect(bundle.python.match(/def algo\(/g)).toHaveLength(1);

    // JavaScript 侧同样拼出两个文件，调用与定义都在。
    expect(bundle.javascript).toContain('// file: helper.block.json');
    expect(bundle.javascript).toContain('// file: main.block.json');
    expect(bundle.javascript.indexOf('// file: helper.block.json')).toBeLessThan(
      bundle.javascript.indexOf('// file: main.block.json'),
    );
  });

  it('入口文件没有调用任何函数时仍生成代码而不抛异常', () => {
    const emptyEntry: ProjectFileRecord = {
      fileId: 'file-empty-entry',
      name: 'empty-entry.block.json',
      workspace: '',
      isEntry: true,
    };

    const bundle = generateProjectBundle([emptyEntry, HELPER_FILE], 'file-empty-entry', 'unknown');

    expect(bundle.errors).toEqual([]);
    expect(bundle.python).toContain('# file: helper.block.json');
    expect(bundle.python).toContain('def helper()');
    // 空入口没有可注入的代码体，注入器按空串原样返回。
    expect(bundle.python).not.toContain('def primitive(');
  });
});
