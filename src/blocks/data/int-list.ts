/**
 * 整数列表 / 多维矩阵字面量块（`data_int_list`）。
 *
 * 解决的问题：数组此前只能作为 `data_value` 文本字段里的一串字面量存在（实测最长
 * 14 671 个元素），既没法看、也没法校验取值范围。这个块把数据存成 **扁平单元格数组**
 * 加一个 `shape` 元数据：
 *
 *   - 输出类型固定为 `IntList`，生成代码始终是扁平列表——秩不进类型系统；
 *   - `shape` 只用于表格展示（秩 ≥ 3 用切片翻页）与自洽校验（`prod(shape) == 单元格数`）；
 *   - 3×3×3 与 4×4 走同一条代码路径，加一维不需要新块。
 *
 * 编辑器与 S-box 共用 `src/blocks/grid/grid-editor.ts`。
 */

import * as Blockly from 'blockly/core';

import { GRID_ICONS, downloadCsv, openGridPopup, parseCsv, pickCsvFile } from '@cc/blocks/grid/grid-editor';
import type { GridHost, GridPopupHandle } from '@cc/blocks/grid/grid-editor';
import { svgRoot } from '@cc/blocks/grid/grid-editor';
import { TYPE_INT_LIST } from '@cc/constants/block-types';
import {
  SHAPE_LIMITS_TEXT,
  auditShape,
  formatShape,
  parseShape,
  shapeSize,
} from '@cc/constants/grid-shape';

export const INT_LIST_BLOCK_TYPES = ['data_int_list'] as const;

export type IntListBlockType = (typeof INT_LIST_BLOCK_TYPES)[number];

const INT_RE = /^-?\d+$/;

interface IntListBlock extends Blockly.Block {
  values: string[];
  /** 形状自洽警告；与 setWarningText 同步，便于无头测试与检索读取。 */
  shapeWarning: string | null;
  popupHandle: GridPopupHandle | null;
  setShapeWarning: (_message: string | null) => void;
  syncShape: () => void;
  validateShape: () => void;
  toggleTable: () => void;
  importCsv: () => void;
  exportCsv: () => void;
  applyCsvText: (_text: string) => void;
}

function dimsOf(block: Blockly.Block): number[] | null {
  return parseShape(String(block.getFieldValue('SHAPE') ?? ''));
}

function normalizeInt(raw: string): string | null {
  const text = raw.trim();
  return INT_RE.test(text) ? text : null;
}

Blockly.Blocks['data_int_list'] = {
  init: function (this: IntListBlock) {
    this.values = [];
    this.shapeWarning = null;
    this.popupHandle = null;
    this.appendDummyInput()
      .appendField('整数列表 shape:')
      .appendField(new Blockly.FieldTextInput('4'), 'SHAPE')
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.table, 16, 16, '查看表格', () => this.toggleTable()),
      )
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.load, 16, 16, '导入 CSV', () => this.importCsv()),
      )
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.save, 16, 16, '导出 CSV', () => this.exportCsv()),
      );
    this.setOutput(true, TYPE_INT_LIST);
    this.setColour(230);
    this.setTooltip(
      '整数列表 / 多维矩阵：单元格扁平存储，shape 决定表格视图与校验（4 / 4,4 / 3,3,3）。生成代码是扁平列表。' +
        SHAPE_LIMITS_TEXT,
    );
    this.setHelpUrl('');

    this.syncShape();

    this.setOnChange((event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.BLOCK_CHANGE) return;
      const change = event as Blockly.Events.BlockChange;
      if (change.blockId === this.id && change.name === 'SHAPE') this.syncShape();
      if (change.blockId === this.id && change.element === 'disabled') return;
    });
  },

  /** 同时更新可读状态与块上的警告气泡。 */
  setShapeWarning: function (this: IntListBlock, message: string | null) {
    this.shapeWarning = message;
    this.setWarningText(message);
  },

  /** 单元格数跟随形状：多退少补，已有数据按扁平顺序保留。 */
  syncShape: function (this: IntListBlock) {
    const dims = dimsOf(this);
    if (!dims) {
      this.setShapeWarning(`形状非法：用 4、4,4 或 3,3,3；${SHAPE_LIMITS_TEXT}`);
      return;
    }
    const size = shapeSize(dims);
    const next = Array.from({ length: size }, (_unused, index) => this.values?.[index] ?? '0');
    this.values = next;
    this.validateShape();
  },

  validateShape: function (this: IntListBlock) {
    const dims = dimsOf(this);
    if (!dims) return;
    const audit = auditShape(dims, this.values ?? []);
    this.setShapeWarning(audit.ok ? null : audit.reason);
  },

  toggleTable: function (this: IntListBlock) {
    if (this.popupHandle) {
      this.popupHandle.close();
      return;
    }
    // 形状非法时不要开一个退化的表格（旧实现按 [0] 只画 1 格，与块上的数据对不上）。
    if (!dimsOf(this)) {
      this.setShapeWarning(`形状非法：用 4、4,4 或 3,3,3；${SHAPE_LIMITS_TEXT}`);
      return;
    }
    const host: GridHost = {
      getCells: () => this.values ?? [],
      setCells: (cells) => {
        this.values = cells;
        this.validateShape();
      },
      getShape: () => dimsOf(this) ?? [0],
      normalize: normalizeInt,
      getAnchor: () => svgRoot(this),
      warn: (message) => this.setShapeWarning(message),
    };
    this.popupHandle = openGridPopup(host, {
      title: '整数列表',
      editable: true,
      onClose: () => {
        this.popupHandle = null;
      },
    });
  },

  applyCsvText: function (this: IntListBlock, text: string) {
    const dims = dimsOf(this);
    if (!dims) return;
    const values = parseCsv(text);
    const audit = auditShape(dims, values);
    if (!audit.ok) {
      this.setShapeWarning(audit.reason);
      return;
    }
    this.values = values;
    this.setShapeWarning(null);
  },

  importCsv: function (this: IntListBlock) {
    pickCsvFile(
      (text) => this.applyCsvText(text),
      (message) => this.setShapeWarning(message),
    );
  },

  exportCsv: function (this: IntListBlock) {
    const dims = dimsOf(this);
    downloadCsv(`int_list_${dims ? formatShape(dims) : 'shape'}.csv`, this.values ?? []);
  },

  saveExtraState: function (this: IntListBlock): object {
    return {
      shape: String(this.getFieldValue('SHAPE') ?? ''),
      data: (this.values ?? []).join(','),
    };
  },

  loadExtraState: function (this: IntListBlock, state: Record<string, unknown>) {
    const shape = typeof state.shape === 'string' ? state.shape : '';
    const data = typeof state.data === 'string' ? state.data : '';
    if (shape) this.setFieldValue(shape, 'SHAPE');
    const dims = parseShape(shape);
    const cells = data ? data.split(',') : [];
    if (!dims) {
      this.values = cells;
      this.setShapeWarning(`形状非法：用 4、4,4 或 3,3,3；${SHAPE_LIMITS_TEXT}`);
      return;
    }
    const size = shapeSize(dims);
    this.values = Array.from({ length: size }, (_unused, index) => cells[index] ?? '0');
    this.validateShape();
  },
};
