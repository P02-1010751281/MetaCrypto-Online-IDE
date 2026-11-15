// @vitest-environment jsdom
/**
 * 通用表格编辑器（`src/blocks/grid/grid-editor.ts`）的 DOM 级回归。
 *
 * 这些行为是真实浏览器验收发现的缺陷固化点（见 `experiments/ai-helper-2026-11-14/RESULTS.md` §15）：
 *   - 1 秩 100 格按 16 列排版时，末行右余 12 格必须**不可编辑**，否则输入会把 values 撑长、
 *     形状自洽被静默破坏（`storedCells` 100 → 106 且警告被 `warn(null)` 抹掉）；
 *   - 非法单元格的提示必须回显用户真正输入的值，而不是回退后的旧值。
 *
 * jsdom 没有排版，所以这里只断言结构与状态；定位/可见性由浏览器 harness 覆盖。
 */

import { describe, expect, it } from 'vitest';

import { openGridPopup, parseCsv } from '@/blocks/grid/grid-editor';
import type { GridPopupHandle } from '@/blocks/grid/grid-editor';

interface HostRecorder {
  cells: string[];
  warnings: Array<string | null>;
  setCalls: string[][];
  host: Parameters<typeof openGridPopup>[0];
}

function recorder(cells: string[], shape: number[], editable = true): HostRecorder {
  const state: HostRecorder = {
    cells: cells.slice(),
    warnings: [],
    setCalls: [],
    host: {
      getCells: () => state.cells,
      setCells: (next) => {
        state.cells = next.slice();
        state.setCalls.push(next.slice());
      },
      getShape: () => shape,
      normalize: (raw) => (/^-?\d+$/.test(raw.trim()) ? raw.trim() : null),
      getAnchor: () => null,
      warn: (message) => state.warnings.push(message),
    },
  };
  void editable;
  return state;
}

function inputs(popup: HTMLElement): HTMLInputElement[] {
  return [...popup.querySelectorAll('input')];
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('表格弹窗：渲染规模', () => {
  it('1 秩 100 格只渲染 100 个可编辑格，末行右余格是空 td', () => {
    const state = recorder(Array.from({ length: 100 }, () => '0'), [100]);
    const handle: GridPopupHandle = openGridPopup(state.host, {
      title: '整数列表',
      editable: true,
    });
    const popup = handle.element;
    expect(inputs(popup)).toHaveLength(100);
    // 7 行 × 16 列 = 112 个数据格，其中 109..111 等越界格不可编辑。
    const rows = [...popup.querySelectorAll('tr')].slice(1);
    expect(rows).toHaveLength(7);
    const tailCells = [...rows[6].querySelectorAll('td')].slice(1);
    expect(tailCells).toHaveLength(16);
    expect(tailCells.filter((cell) => cell.querySelector('input'))).toHaveLength(4);
    expect(tailCells[15].textContent).toBe('');
    handle.close();
  });

  it('3 秩每页 9 格，切片选择器翻页取到第 2 页的数据', () => {
    const cells = Array.from({ length: 27 }, (_unused, index) => String(index));
    const state = recorder(cells, [3, 3, 3]);
    const handle = openGridPopup(state.host, { title: '整数列表', editable: true });
    const popup = handle.element;
    expect(inputs(popup)).toHaveLength(9);
    expect(inputs(popup)[0].value).toBe('0');
    const picker = popup.querySelector('select');
    expect(picker?.options).toHaveLength(3);
    expect(picker?.textContent).toContain('切片 1/3');
    if (picker) {
      picker.value = '1';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const page2 = inputs(popup);
    expect(page2).toHaveLength(9);
    expect(page2[0].value).toBe('9');
    expect(page2[8].value).toBe('17');
    handle.close();
  });

  it('只读模式（S-box）不产生任何输入框', () => {
    const state = recorder(['A5', '63', '63', 'C6'], [2, 2]);
    const handle = openGridPopup(state.host, { title: 'S-box' });
    expect(inputs(handle.element)).toHaveLength(0);
    expect(handle.element.textContent).toContain('A5');
    handle.close();
  });
});

describe('表格弹窗：单元格写回', () => {
  it('合法输入写回 setCells，并清掉旧警告', () => {
    const state = recorder(['0', '1', '2', '3'], [4]);
    const handle = openGridPopup(state.host, { title: '整数列表', editable: true });
    typeInto(inputs(handle.element)[0], '42');
    expect(state.cells).toEqual(['42', '1', '2', '3']);
    expect(state.setCalls).toHaveLength(1);
    expect(state.warnings.at(-1)).toBeNull();
    handle.close();
  });

  it('非法输入：回退旧值、提示回显用户真正输入的值、不写回', () => {
    const state = recorder(['0', '1', '2', '3'], [4]);
    const handle = openGridPopup(state.host, { title: '整数列表', editable: true });
    const input = inputs(handle.element)[1];
    typeInto(input, 'x9');
    expect(input.value).toBe('1');
    expect(state.setCalls).toHaveLength(0);
    expect(state.warnings.at(-1)).toBe('第 2 个单元格非法：x9');
    handle.close();
  });
});

describe('表格弹窗：定位与关闭', () => {
  it('拿不到锚点时退回左上角 (80px, 80px)', () => {
    const state = recorder(['1'], [1]);
    const handle = openGridPopup(state.host, { title: '整数列表', editable: true });
    expect(handle.element.style.left).toBe('80px');
    expect(handle.element.style.top).toBe('80px');
    handle.close();
  });

  it('close 移除节点且只触发一次 onClose', () => {
    let closes = 0;
    const state = recorder(['1'], [1]);
    const handle = openGridPopup(state.host, {
      title: '整数列表',
      editable: true,
      onClose: () => {
        closes += 1;
      },
    });
    expect(document.body.contains(handle.element)).toBe(true);
    handle.close();
    handle.close();
    expect(document.body.contains(handle.element)).toBe(false);
    expect(closes).toBe(1);
  });
});

describe('CSV 解析', () => {
  it('逗号与换行分隔，空项丢弃', () => {
    expect(parseCsv('1,2,3')).toEqual(['1', '2', '3']);
    expect(parseCsv('1\n2\r\n3')).toEqual(['1', '2', '3']);
    expect(parseCsv('1,,2,\n')).toEqual(['1', '2']);
  });
});
