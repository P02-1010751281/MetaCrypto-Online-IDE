import * as Blockly from 'blockly/core';
import { TYPE_SBOX } from '@/constants/block-types';
import { SBOX_PRESETS } from '@/constants/sbox-presets';
import {
  GRID_ICONS,
  downloadCsv,
  openGridPopup,
  parseCsv,
  pickCsvFile,
  type GridHost,
  svgRoot,
  type GridPopupHandle,
} from '@/blocks/grid/grid-editor';

export const SBOX_BLOCK_TYPES = ['sbox', 'sbox_sub'] as const;

export type SBoxBlockType = (typeof SBOX_BLOCK_TYPES)[number];

interface SBoxBlock extends Blockly.Block {
  gridData: string[];
  settingsPopup: HTMLDivElement | null;
  popupHandle: GridPopupHandle | null;
  exportToCsv: () => void;
  openCsvImportDialog: () => void;
  loadCsvData: (_file: File) => void;
  applyCsvText: (text: string, size: number) => void;
  updateShape: () => void;
  toggleSboxTable: () => void;
}

/** 打开着 S-box 表格弹窗的块（workspace.clear/导入/组件卸载时统一关闭，防 listener + DOM 泄漏） */
const openPopupBlocks = new Set<SBoxBlock>();

export function closeAllSboxPopups(): void {
  for (const block of openPopupBlocks) {
    block.popupHandle?.close();
    block.popupHandle = null;
    block.settingsPopup = null;
  }
  openPopupBlocks.clear();
}

function hexValidator(newValue: string): string | null {
  if (
    /^0[xX][0-9a-fA-F]{1,2}$/.test(newValue) ||
    /^[0-9a-fA-F]{1,2}$/.test(newValue)
  ) {
    return newValue.toUpperCase().replace(/^0x/i, '');
  }
  return null;
}

 
function getSboxRowCol(this: SBoxBlock) {
  void this;
  const row = Number(this.getFieldValue('ROW')) || 4;
  const col = Number(this.getFieldValue('COL')) || 4;
  const maxRow = Math.min(row, 32);
  const maxCol = Math.min(col, 32);
  return { maxRow, maxCol };
}

Blockly.Blocks['sbox'] = {
   
  init: function (this: SBoxBlock) {
    const dropdown = new Blockly.FieldDropdown(() => [
      [Blockly.Msg.CRYPTO_SBOX_ARRAY_1D || '1D Array', '1d'],
      [Blockly.Msg.CRYPTO_SBOX_ARRAY_2D || '2D Array', '2d'],
    ]);
    const presetDropdown = new Blockly.FieldDropdown(() => [
      [Blockly.Msg.CRYPTO_SBOX_PRESET_NONE || 'Custom (CSV)', ''],
      [Blockly.Msg.CRYPTO_SBOX_PRESET_AES || 'AES S-box (FIPS 197)', 'aes'],
      [Blockly.Msg.CRYPTO_SBOX_PRESET_SM4 || 'SM4 S-box (GB/T 32907-2016)', 'sm4'],
      [Blockly.Msg.CRYPTO_SBOX_PRESET_ZUC_S0 || 'ZUC S0 (GB/T 33133)', 'zuc_s0'],
      [Blockly.Msg.CRYPTO_SBOX_PRESET_ZUC_S1 || 'ZUC S1 (GB/T 33133)', 'zuc_s1'],
    ]);
    presetDropdown.setValidator((newValue) => {
      if (newValue && newValue !== '') {
        const preset = SBOX_PRESETS[newValue];
        if (preset) {
          // 预设填充：16×16 网格 + 数据
          Blockly.Events.disable();
          try {
            this.setFieldValue('16', 'ROW');
            this.setFieldValue('16', 'COL');
            this.gridData = preset.slice();
            this.updateShape();
          } finally {
            Blockly.Events.enable();
          }
        }
      }
      return newValue;
    });
    this.appendDummyInput()
      .appendField(Blockly.Msg.CRYPTO_SBOX_SIZE || 'S-box Size')
      .appendField(new Blockly.FieldNumber(4, 1, 32), 'ROW')
      .appendField('x')
      .appendField(new Blockly.FieldNumber(4, 1, 32), 'COL')
      .appendField(dropdown, 'OUTPUT_FORMAT');
    this.appendDummyInput()
      .appendField(Blockly.Msg.CRYPTO_SBOX_PRESET || 'Preset')
      .appendField(presetDropdown, 'PRESET')
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.load, 16, 16, '导入CSV', () => {
          this.openCsvImportDialog();
        }),
      )
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.save, 16, 16, '导出CSV', () => {
          this.exportToCsv();
        }),
      )
      .appendField(
        new Blockly.FieldImage(GRID_ICONS.table, 16, 16, '查看表格', () => {
          this.toggleSboxTable();
        }),
      );

    this.updateShape();

    this.setOutput(true, TYPE_SBOX);
    this.setColour(230);
    this.setTooltip(
      Blockly.Msg.CRYPTO_SBOX_TOOLTIP || 'S-box lookup table, import CSV',
    );

    this.setOnChange(function (
      this: SBoxBlock,
      event: Blockly.Events.Abstract,
    ) {
      if (event.type === Blockly.Events.BLOCK_CHANGE) {
        const e = event as Blockly.Events.BlockChange;
        if (e.blockId === this.id && (e.name === 'ROW' || e.name === 'COL')) {
          Blockly.Events.disable();
          try {
            this.updateShape();
          } finally {
            Blockly.Events.enable();
          }
        }
      } else if (event.type === Blockly.Events.BLOCK_DELETE) {
        const e = event as Blockly.Events.BlockDelete;
        if (e.blockId === this.id) {
          this.popupHandle?.close();
          this.popupHandle = null;
          this.settingsPopup = null;
        }
      }
    });
  },

  /** JSON serialize: return the mutation data for Blockly 12 */

   
  saveExtraState: function (this: SBoxBlock): object {
    void this;
    const state: Record<string, unknown> = {};
    state.row = this.getFieldValue('ROW') || 4;
    state.col = this.getFieldValue('COL') || 4;
    state.output_format = this.getFieldValue('OUTPUT_FORMAT') || '2d';
    const preset = this.getFieldValue('PRESET') || '';
    if (preset) state.preset = preset;
    if (this.gridData && this.gridData.length > 0) {
      state.data = this.gridData.join(',');
    }
    return state;
  },

  /** JSON deserialize: receive mutation data from Blockly 12 */
  loadExtraState: function (this: SBoxBlock, state: Record<string, unknown>) {
    void this;
    const rowA = String(state.row || 4);
    const colA = String(state.col || 4);
    const fmt = String(state.output_format || '2d');
    const dataStr = typeof state.data === 'string' ? state.data : undefined;
    const preset = typeof state.preset === 'string' ? state.preset : '';
    if (rowA) this.setFieldValue(rowA, 'ROW');
    if (colA) this.setFieldValue(colA, 'COL');
    if (fmt) this.setFieldValue(fmt, 'OUTPUT_FORMAT');
    if (preset) this.setFieldValue(preset, 'PRESET');

    if (dataStr) {
      this.gridData = dataStr.split(',');
    } else if (preset && SBOX_PRESETS[preset]) {
      this.gridData = SBOX_PRESETS[preset].slice();
    } else {
      console.warn('[sbox] loadExtraState: no data in state');
    }
    this.updateShape();
  },

   
  mutationToDom: function (this: SBoxBlock) {
    void this;
    const c = Blockly.utils.xml.createElement('mutation');
    c.setAttribute('row', String(this.getFieldValue('ROW') || 4));
    c.setAttribute('col', String(this.getFieldValue('COL') || 4));
    c.setAttribute(
      'output_format',
      String(this.getFieldValue('OUTPUT_FORMAT') || '2d'),
    );
    const preset = this.getFieldValue('PRESET') || '';
    if (preset) c.setAttribute('preset', preset);
    if (this.gridData && this.gridData.length > 0) {
      c.setAttribute('data', this.gridData.join(','));
    }
    return c;
  },

  domToMutation: function (this: SBoxBlock, xmlElement: Element) {
    void this;
    const rowA = xmlElement.getAttribute('row');
    const colA = xmlElement.getAttribute('col');
    const fmt = xmlElement.getAttribute('output_format');
    const dataStr = xmlElement.getAttribute('data');
    const preset = xmlElement.getAttribute('preset') || '';
    if (rowA) this.setFieldValue(rowA, 'ROW');
    if (colA) this.setFieldValue(colA, 'COL');
    if (fmt) this.setFieldValue(fmt, 'OUTPUT_FORMAT');
    if (preset) this.setFieldValue(preset, 'PRESET');

    if (dataStr) {
      this.gridData = dataStr.split(',');
    } else if (preset && SBOX_PRESETS[preset]) {
      this.gridData = SBOX_PRESETS[preset].slice();
    } else if (xmlElement.parentElement) {
      const r = Number(rowA) || 4,
        c = Number(colA) || 4;
      const arr: string[] = [];
      for (let ri = 0; ri < r; ri++) {
        for (let ci = 0; ci < c; ci++) {
          const f = xmlElement.parentElement.querySelector(
            'field[name=\'SBox_' + ri + '_' + ci + '\']',
          );
          arr.push(f?.textContent?.trim() || '00');
        }
      }
      if (arr.length === r * c) {
        this.gridData = arr;
      }
    }
    this.updateShape();
  },

   
  /**
   * 调整 gridData 大小以匹配当前 ROW×COL。
   * ROW_ input 清理是历史兼容代码（当前版本无此类 input）。
   */
  updateShape: function (this: SBoxBlock) {
    const { maxRow, maxCol } = getSboxRowCol.call(this);
    const size = maxRow * maxCol;
    // 历史兼容：清理旧版 ROW_ 输入
    this.inputList
      .filter((i) => i.name?.startsWith('ROW_'))
      .forEach((i) => this.removeInput(i.name!));
    // gridData 大小同步
    if (!this.gridData || this.gridData.length === 0) {
      this.gridData = Array.from({ length: size }, () => '00');
    } else if (this.gridData.length !== size) {
      const nd = Array.from({ length: size }, () => '00');
      for (let i = 0; i < Math.min(this.gridData.length, size); i++)
        nd[i] = this.gridData[i];
      this.gridData = nd;
    }
  },

   
  toggleSboxTable: function (this: SBoxBlock) {
    if (this.popupHandle) {
      this.popupHandle.close();
      return;
    }
    const host: GridHost = {
      getCells: () => this.gridData ?? [],
      setCells: (cells) => {
        this.gridData = cells;
      },
      getShape: () => {
        const { maxRow, maxCol } = getSboxRowCol.call(this);
        return [maxRow, maxCol];
      },
      normalize: hexValidator,
      getAnchor: () => svgRoot(this),
      warn: (message) => this.setWarningText(message),
    };
    this.popupHandle = openGridPopup(host, {
      title: 'S-box',
      onClose: () => {
        this.popupHandle = null;
        this.settingsPopup = null;
        openPopupBlocks.delete(this);
      },
    });
    this.settingsPopup = this.popupHandle.element;
    openPopupBlocks.add(this);
  },

  loadCsvData: function (this: SBoxBlock, file: File) {
    const { maxRow, maxCol } = getSboxRowCol.call(this);
    const size = maxRow * maxCol;
    const reader = new FileReader();
    reader.onload = (event) => {
      this.applyCsvText(String(event.target?.result ?? ''), size);
    };
    reader.onerror = () => this.setWarningText('CSV 读取失败');
    reader.readAsText(file);
  },

  /** 校验并写入 CSV 文本；长度或取值不合法时清空为默认值并给出警告。 */
  applyCsvText: function (this: SBoxBlock, text: string, size: number) {
    const values = parseCsv(text);
    if (values.length !== size) {
      this.setWarningText(`CSV: ${values.length} 个值，需要 ${size}`);
      this.gridData = Array.from({ length: size }, () => '00');
      return;
    }
    const validated: string[] = [];
    for (const [index, value] of values.entries()) {
      const normalized = hexValidator(value);
      if (normalized === null) {
        this.setWarningText(`CSV 第 ${index + 1} 个值非法：${value}`);
        this.gridData = Array.from({ length: size }, () => '00');
        return;
      }
      validated.push(normalized.padStart(2, '0'));
    }
    this.gridData = validated;
    this.setWarningText(null);
  },

  openCsvImportDialog: function (this: SBoxBlock) {
    const { maxRow, maxCol } = getSboxRowCol.call(this);
    const size = maxRow * maxCol;
    pickCsvFile(
      (text) => this.applyCsvText(text, size),
      (message) => this.setWarningText(message),
    );
  },

  exportToCsv: function (this: SBoxBlock) {
    const { maxRow, maxCol } = getSboxRowCol.call(this);
    downloadCsv(
      `sbox_${maxRow}x${maxCol}.csv`,
      this.gridData.slice(0, maxRow * maxCol),
    );
  },
};

Blockly.Blocks['sbox_sub'] = {
  init: function () {
    this.appendValueInput('INPUT_VAR')
      .setCheck(null)
      .appendField(Blockly.Msg.CRYPTO_SBOX_SUB || 'S-box Sub Input Var');
    this.appendValueInput('SBOX_VAR')
      .setCheck(TYPE_SBOX)
      .appendField(Blockly.Msg.CRYPTO_SBOX_SUB_VAR || 'S-box');
    this.appendValueInput('OUTPUT_VAR')
      .setCheck(null)
      .appendField(Blockly.Msg.CRYPTO_LOGIC_OUTPUT_VAR || '输出变量');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230);
    this.setTooltip(
      Blockly.Msg.CRYPTO_SBOX_SUB_TOOLTIP ||
        'Apply an S-box to an unsigned 32-bit word in big-endian byte order; the first 256 entries must be integer byte values.',
    );
    this.setHelpUrl('');
  },
};
