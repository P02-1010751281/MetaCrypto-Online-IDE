/**
 * 真实浏览器里的表格弹窗验收 harness（`data_int_list` + `sbox`）。
 *
 * 为什么需要它：`tests/unit/*` 跑在 jsdom 上，只能证明状态与生成代码；弹窗的
 * `getBoundingClientRect`、可见性、滚动与「每页单元格数」都依赖真实排版。本页在
 * Chromium 里用真实 Blockly 渲染态工作区加载块、打开弹窗，并把实测数字写进 `#out`，
 * 由 `--dump-dom` 读回。
 *
 * 运行（dev server 需已在 5199 端口）：
 *   chrome --headless=new --no-sandbox --virtual-time-budget=20000 --dump-dom \
 *     http://127.0.0.1:5199/experiments/ai-helper-2026-11-14/grid-harness/index.html
 */

import * as Blockly from 'blockly/core';
import { setLocale } from 'blockly/core';
import * as enMessages from 'blockly/msg/en';

import '@/blocks/data';
import '@/blocks/sbox';
import { openGridPopup } from '@/blocks/grid/grid-editor';

setLocale(enMessages as unknown as Record<string, string>);

interface PopupHandle {
  element: HTMLDivElement;
  close: () => void;
}

interface IntListBlock extends Blockly.Block {
  values: string[];
  shapeWarning: string | null;
  syncShape: () => void;
  toggleTable: () => void;
  popupHandle: PopupHandle | null;
}

interface SBoxBlock extends Blockly.Block {
  gridData: string[];
  toggleSboxTable: () => void;
  popupHandle: PopupHandle | null;
}

const report: Record<string, unknown>[] = [];
const pageErrors: string[] = [];

window.addEventListener('error', (event) => pageErrors.push(`error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) =>
  pageErrors.push(`rejection: ${String(event.reason)}`),
);

function element(value: unknown, label: string): HTMLElement {
  if (!(value instanceof HTMLElement)) throw new Error(`缺少元素 ${label}`);
  return value;
}

const workspace = Blockly.inject(element(document.getElementById('ws'), '#ws'), {
  grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
  move: { scrollbars: false, drag: true, wheel: false },
  zoom: { controls: false, wheel: false, startScale: 1 },
});

function loadBlocks(blocks: unknown[]): void {
  Blockly.serialization.workspaces.load({ blocks: { blocks } }, workspace);
}

function firstBlock<T>(type: string): T {
  const found = workspace.getAllBlocks(false).find((block) => block.type === type);
  if (!found) throw new Error(`工作区没有 ${type}`);
  return found as unknown as T;
}

function openPopup(block: IntListBlock): HTMLDivElement {
  block.toggleTable();
  if (!block.popupHandle) throw new Error('弹窗未打开');
  return block.popupHandle.element;
}

function closePopup(block: IntListBlock): void {
  block.popupHandle?.close();
}

function rectOf(popup: HTMLDivElement): Record<string, unknown> {
  const rect = popup.getBoundingClientRect();
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    insideViewport:
      rect.left >= 0 &&
      rect.top >= 0 &&
      Math.round(rect.right) <= window.innerWidth &&
      Math.round(rect.bottom) <= window.innerHeight,
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function inputsOf(popup: HTMLElement): HTMLInputElement[] {
  return [...popup.querySelectorAll('input')];
}

/** 用例 A：1 秩 4 格可编辑表 —— 单元格数、行数、锚点定位、样式、合法/非法写入。 */
function caseEditable4(): void {
  workspace.clear();
  loadBlocks([
    { type: 'data_int_list', x: 40, y: 40, extraState: { shape: '4', data: '0,1,2,3' } },
  ]);
  const block = firstBlock<IntListBlock>('data_int_list');
  const anchor = (block as unknown as { getSvgRoot?: () => Element }).getSvgRoot?.();
  const popup = openPopup(block);
  const inputs = inputsOf(popup);
  const entry: Record<string, unknown> = {
    case: 'A.1d-4-editable',
    title: popup.firstElementChild?.textContent,
    anchorExists: Boolean(anchor),
    inputs: inputs.length,
    rows: popup.querySelectorAll('tr').length,
    cells: block.values.slice(0, 4),
    rect: rectOf(popup),
    cellFont: inputs.length ? getComputedStyle(inputs[0]).fontFamily : null,
    cellBackground: inputs.length ? getComputedStyle(inputs[0]).backgroundColor : null,
    visible: popup.offsetParent !== null || popup.getClientRects().length > 0,
  };
  typeInto(inputs[0], '42');
  entry.afterValidEdit = block.values[0];
  typeInto(inputs[1], 'x');
  entry.afterIllegalEdit = { value: inputs[1].value, warning: block.shapeWarning };
  report.push(entry);
  closePopup(block);
}

/** 用例 B：3×3×3 —— 每页仍只有 9 格，切片选择器翻页取到第 2 页的数据。 */
function caseSliced3d(): void {
  workspace.clear();
  loadBlocks([{ type: 'data_int_list', x: 40, y: 40, extraState: { shape: '4' } }]);
  const block = firstBlock<IntListBlock>('data_int_list');
  block.setFieldValue('3,3,3', 'SHAPE');
  block.syncShape();
  const popup = openPopup(block);
  const picker = popup.querySelector('select');
  const entry: Record<string, unknown> = {
    case: 'B.3x3x3-sliced',
    title: popup.firstElementChild?.textContent,
    storedCells: block.values.length,
    cellsPerPage: inputsOf(popup).length,
    slices: picker?.options.length ?? 0,
    sliceLabels: picker ? [...picker.options].map((option) => option.textContent) : [],
  };
  if (picker) {
    picker.value = '1';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    const afterSlice = inputsOf(popup);
    entry.cellsAfterSliceChange = afterSlice.length;
    entry.firstCellOfSlice2 = afterSlice[0]?.value;
    entry.expectedSlice2 = block.values[9];
  }
  entry.rect = rectOf(popup);
  report.push(entry);
  closePopup(block);
}

/** 用例 C：1D 100 —— 每行 16 格、共 7 行，末行左余 12 格不该可写。 */
function caseLong1d(): void {
  workspace.clear();
  loadBlocks([{ type: 'data_int_list', x: 40, y: 40, extraState: { shape: '4' } }]);
  const block = firstBlock<IntListBlock>('data_int_list');
  block.setFieldValue('100', 'SHAPE');
  block.syncShape();
  const popup = openPopup(block);
  const inputs = inputsOf(popup);
  const entry: Record<string, unknown> = {
    case: 'C.1d-100',
    storedCells: block.values.length,
    renderedInputs: inputs.length,
    rows: popup.querySelectorAll('tr').length - 1,
    firstInputs: inputs.slice(0, 4).map((input) => input.value),
    trailingInputValues: inputs.slice(100).map((input) => input.value),
    rect: rectOf(popup),
  };
  if (inputs[105]) {
    typeInto(inputs[105], '7');
    entry.afterEditingOutOfRange = {
      storedCells: block.values.length,
      warning: block.shapeWarning,
    };
  } else {
    entry.afterEditingOutOfRange = 'no input at index 105';
  }
  report.push(entry);
  closePopup(block);
}

/** 用例 D：1D 14671（仓库实测最长字面量）—— 打开耗时与渲染规模。 */
function caseHuge(): void {
  workspace.clear();
  loadBlocks([{ type: 'data_int_list', x: 40, y: 40, extraState: { shape: '4' } }]);
  const block = firstBlock<IntListBlock>('data_int_list');
  block.setFieldValue('14671', 'SHAPE');
  block.syncShape();
  const started = performance.now();
  const popup = openPopup(block);
  const elapsed = performance.now() - started;
  const entry: Record<string, unknown> = {
    case: 'D.1d-14671',
    storedCells: block.values.length,
    renderedInputs: inputsOf(popup).length,
    rows: popup.querySelectorAll('tr').length - 1,
    openMs: Math.round(elapsed),
    popupNodes: popup.querySelectorAll('*').length,
    rect: rectOf(popup),
    scrollHeight: popup.scrollHeight,
    clientHeight: popup.clientHeight,
  };
  report.push(entry);
  closePopup(block);
}

/**
 * 用例 F：越过 `MAX_DIM` 的规模还能不能渲染 —— 直接用 fake host 调 `openGridPopup`，
 * 绕开块上的形状解析，量的是渲染器本体的容量（决定上限该抬还是要加分页）。
 */
function caseCapacity(sizes: number[]): void {
  for (const size of sizes) {
    const cells = Array.from({ length: size }, (_unused, index) => String(index % 256));
    let written = 0;
    const started = performance.now();
    const handle = openGridPopup(
      {
        getCells: () => cells,
        setCells: (next) => {
          written = next.length;
        },
        getShape: () => [size],
        normalize: (raw) => (/^-?\d+$/.test(raw.trim()) ? raw.trim() : null),
        getAnchor: () => null,
      },
      { title: '容量', editable: true },
    );
    const elapsed = performance.now() - started;
    report.push({
      case: `F.capacity-${size}`,
      openMs: Math.round(elapsed),
      renderedInputs: handle.element.querySelectorAll('input').length,
      rows: handle.element.querySelectorAll('tr').length - 1,
      nodes: handle.element.querySelectorAll('*').length,
      height: Math.round(handle.element.getBoundingClientRect().height),
      scrollHeight: handle.element.scrollHeight,
      written,
    });
    handle.close();
  }
}

/** 用例 E：S-box 只读表（R1 把弹窗委托给通用模块后的回归）。 */
function caseSbox(): void {
  workspace.clear();
  loadBlocks([{ type: 'sbox', x: 40, y: 40 }]);
  const block = firstBlock<SBoxBlock>('sbox');
  block.toggleSboxTable();
  const popup = block.popupHandle?.element;
  if (!popup) throw new Error('S-box 弹窗未打开');
  report.push({
    case: 'E.sbox-readonly',
    title: popup.firstElementChild?.textContent,
    cells: popup.querySelectorAll('td').length,
    inputs: popup.querySelectorAll('input').length,
    firstRow: popup.querySelector('tr')?.textContent,
    rect: rectOf(popup),
  });
  block.popupHandle?.close();
}

const cases: Array<[string, () => void]> = [
  ['A', caseEditable4],
  ['B', caseSliced3d],
  ['C', caseLong1d],
  ['D', caseHuge],
  ['F', () => caseCapacity([14671, 65536])],
  ['E', caseSbox],
];

for (const [name, run] of cases) {
  try {
    run();
  } catch (error) {
    report.push({ case: name, failed: String(error) });
  }
}

/** 用例 G：留一个 3×3×3 弹窗开着，供 `--screenshot` 目检（CJK、表格线、切片控件）。 */
function leavePopupOpen(): void {
  workspace.clear();
  loadBlocks([{ type: 'data_int_list', x: 40, y: 40, extraState: { shape: '4' } }]);
  const block = firstBlock<IntListBlock>('data_int_list');
  block.setFieldValue('3,3,3', 'SHAPE');
  block.syncShape();
  block.values = Array.from({ length: 27 }, (_unused, index) => String(index));
  const popup = openPopup(block);
  report.push({ case: 'G.screenshot', title: popup.firstElementChild?.textContent, rect: rectOf(popup) });
}

try {
  leavePopupOpen();
} catch (error) {
  report.push({ case: 'G', failed: String(error) });
}

const summary = {
  blockly: Blockly.VERSION,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  pageErrors,
  cases: report,
};

element(document.getElementById('out'), '#out').textContent = JSON.stringify(summary, null, 1);
