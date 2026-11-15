// @vitest-environment jsdom
/**
 * `data_int_list`（整数列表 / 多维矩阵）与形状工具的回归。
 *
 * 关键口径：单元格扁平存储、`shape` 只是元数据，所以 3×3×3 与 4×4 走同一条路径；
 * 生成代码永远是扁平列表。
 */

import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as enMessages from 'blockly/msg/en';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/blocks/data';
import '@/generators/javascript';
import '@/generators/python';

import { javascriptGenerator } from 'blockly/javascript';
import { pythonGenerator } from 'blockly/python';

import { auditShape, formatShape, parseShape, shapeSize } from '@/constants/grid-shape';

interface IntListLike extends Blockly.Block {
  values: string[];
  shapeWarning: string | null;
  popupHandle: { element: HTMLDivElement; close: () => void } | null;
  syncShape: () => void;
  toggleTable: () => void;
}

Blockly.setLocale(enMessages as unknown as Record<string, string>);

/**
 * 无头工作区不会派发 BlockChange 事件，`onChange` 这条 UI 接线在测试里不触发；
 * 所以测试显式调用 `syncShape()`——它与 UI 侧走的是同一个方法。
 */
function newIntList(shape = '4'): IntListLike {
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock('data_int_list') as IntListLike;
  block.setFieldValue(shape, 'SHAPE');
  block.syncShape();
  return block;
}

describe('形状工具（纯函数）', () => {
  it('parseShape 接受 1/2/3 维与多种分隔符', () => {
    expect(parseShape('16')).toEqual([16]);
    expect(parseShape('4,4')).toEqual([4, 4]);
    expect(parseShape('3x3x3')).toEqual([3, 3, 3]);
    expect(parseShape('2×2×2')).toEqual([2, 2, 2]);
  });

  it('parseShape 拒绝非法维度', () => {
    expect(parseShape('')).toBeNull();
    expect(parseShape('0')).toBeNull();
    expect(parseShape('-3')).toBeNull();
    expect(parseShape('4,abc')).toBeNull();
  });

  it('shapeSize 与 formatShape', () => {
    expect(shapeSize([3, 3, 3])).toBe(27);
    expect(shapeSize([])).toBe(0);
    expect(formatShape([3, 3, 3])).toBe('3x3x3');
  });

  it('auditShape 抓出「3×3×3 只填 26 个值」', () => {
    const short = Array.from({ length: 26 }, (_unused, index) => String(index));
    const audit = auditShape([3, 3, 3], short);
    expect(audit.ok).toBe(false);
    expect(audit.expected).toBe(27);
    expect(audit.actual).toBe(26);
    expect(audit.reason).toContain('27');
  });

  it('1 秩按元素总数计：14 671（仓库实测最长字面量）合法', () => {
    expect(parseShape('14671')).toEqual([14671]);
    expect(shapeSize([14671])).toBe(14671);
  });

  it('多秩保留单维 4096 上限，并新增 65 536 总格数上限', () => {
    expect(parseShape('4,4096')).toEqual([4, 4096]);
    // 单维上限拦下「一行 14671 列」的超宽表
    expect(parseShape('14671,4')).toBeNull();
    // 总量上限拦下乘积爆炸（旧实现只限单维，4096×4096 会分配 1677 万格）
    expect(parseShape('4096,4096')).toBeNull();
    expect(parseShape('4096,17')).toBeNull();
    expect(shapeSize([4096, 17])).toBe(0);
  });

  it('auditShape 拒绝非整数值', () => {
    expect(auditShape([2], ['1', 'x']).ok).toBe(false);
    expect(auditShape([2], ['1', '2']).ok).toBe(true);
  });
});

describe('data_int_list 块', () => {
  let block: IntListLike;

  beforeEach(() => {
    block = newIntList();
  });

  it('默认一维 4 个单元格', () => {
    expect(block.values).toHaveLength(4);
    expect(block.shapeWarning).toBeNull();
  });

  it('改成 3 维时单元格数变成乘积（3×3×3 → 27）', () => {
    block.setFieldValue('3,3,3', 'SHAPE');
    block.syncShape();
    expect(block.values).toHaveLength(27);
    expect(block.shapeWarning).toBeNull();
  });

  it('缩小形状时截断、放大时补 0，已有数据按扁平顺序保留', () => {
    block.values = ['7', '8', '9', '10'];
    block.setFieldValue('2', 'SHAPE');
    block.syncShape();
    expect(block.values).toEqual(['7', '8']);
    block.setFieldValue('3', 'SHAPE');
    block.syncShape();
    expect(block.values).toEqual(['7', '8', '0']);
  });

  it('形状非法时给出警告而不是静默', () => {
    block.setFieldValue('abc', 'SHAPE');
    block.syncShape();
    expect(block.shapeWarning).toContain('形状非法');
  });

  it('形状非法时不开表格弹窗（旧实现会按 [0] 画出 1 格，与块上数据对不上）', () => {
    block.setFieldValue('4096,4096', 'SHAPE');
    block.syncShape();
    expect(block.shapeWarning).toContain('形状非法');
    block.toggleTable();
    expect(block.popupHandle).toBeNull();
    expect(document.querySelector('div[style*="position:fixed"]')).toBeNull();
  });

  it('序列化往返保留 shape 与单元格', () => {
    block.setFieldValue('3,3,3', 'SHAPE');
    block.syncShape();
    block.values = Array.from({ length: 27 }, (_unused, index) => String(index));
    const workspace = block.workspace;
    const state = Blockly.serialization.workspaces.save(workspace);

    const restored = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(state, restored);
    const loaded = restored.getTopBlocks(false)[0] as IntListLike;
    expect(loaded.getFieldValue('SHAPE')).toBe('3,3,3');
    expect(loaded.values).toHaveLength(27);
    expect(loaded.values[26]).toBe('26');
    expect(loaded.shapeWarning).toBeNull();
  });

  it('生成代码是扁平列表字面量（Python 与 JS 一致）', () => {
    block.values = ['1', '2', '3'];
    const workspace = block.workspace;
    expect(pythonGenerator.workspaceToCode(workspace)).toContain('[1, 2, 3]');
    expect(javascriptGenerator.workspaceToCode(workspace)).toContain('[1, 2, 3]');
  });
});
