/**
 * 通用表格编辑器（grid editor）：S-box 与字面量块共用的表格弹窗 + CSV 进出。
 *
 * 抽出来的动机：原实现在 `src/blocks/sbox/sbox.ts` 里，弹出层、CSV 导入、CSV 导出、
 * 表格渲染四段共约 200 行，且与块实例强耦合。新的 `data_int_list` 需要同一套交互
 * （大数组靠文本字段没法看、没法改），所以把「排版 + 文件进出 + 定位」放到这里，
 * 块侧只提供形状与数据读写回调。
 *
 * 形状约定（与 `shape` 元数据一致）：`shape` 是维度数组，单元格一律**扁平存储**。
 * 弹窗按 `shape[0] × shape[1]` 渲染一页，其余维度用切片选择器翻页——
 * 因此 3×3×3 与 4×4 走同一条代码路径，秩不产生分支。
 */

/** 取块的 SVG 根：`getSvgRoot` 只存在于渲染态块（BlockSvg），类型上需要显式收窄。 */
export function svgRoot(block: unknown): Element | null {
  const candidate = block as { getSvgRoot?: () => Element } | null;
  return typeof candidate?.getSvgRoot === 'function' ? candidate.getSvgRoot() : null;
}

/** 弹窗宿主：块侧需要提供的最小能力。 */
export interface GridHost {
  /** 当前数据（扁平）。 */
  getCells(): string[];
  /** 写回数据（长度必须与 shape 乘积一致，由调用方保证）。 */
  setCells(cells: string[]): void;
  /** 维度数组，例如 [16,16] 或 [3,3,3]。 */
  getShape(): number[];
  /** 单元格校验/规范化；返回 null 表示非法。 */
  normalize(raw: string): string | null;
  /** 弹窗锚点（通常是块的 SVG 根）。 */
  getAnchor?(): Element | null;
  /** 提示信息（可选，块有 setWarningText 时可传入）。 */
  warn?(message: string | null): void;
}

export interface GridPopupOptions {
  title: string;
  /** 允许直接编辑单元格；默认 false（与 S-box 只读表格一致）。 */
  editable?: boolean;
  /** 关闭回调。 */
  onClose?(): void;
}

export interface GridPopupHandle {
  element: HTMLDivElement;
  close(): void;
}

/** 一维数组按每行最多 16 个渲染，保证单元格不会被压成一条线。 */
function renderShape(shape: readonly number[]): { rows: number; cols: number; slices: number } {
  if (shape.length === 1) {
    const cols = Math.min(shape[0] || 1, 16);
    return { rows: Math.ceil((shape[0] || 1) / cols), cols, slices: 1 };
  }
  const rows = shape[0] || 1;
  const cols = shape[1] || 1;
  const slices = shape.slice(2).reduce((acc, dim) => acc * (dim || 1), 1);
  return { rows, cols, slices };
}

/** 表格类操作按钮图标（CSV 导入 / 导出 / 查看表格），供各表格块共用。 */
export const GRID_ICONS = {
  load: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiM0NDQiIHJ4PSIyIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTcgM2gydjRINGEyVjNoM3YySDl2NGgtMlY1SDRWM2gzeiIvPjwvc3ZnPg==',
  save: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiMyYTliZCIgcng9IjIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNOCAydjZINmwzIDMgMy0zaC0yVjJ6TTIgMTJoMTJ2MkgyeiIvPjwvc3ZnPg==',
  table: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIGZpbGw9IiM2YTYiIHJ4PSIyIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTIgMmgxMnYxMkgyVjJ6bTEgMXY0aDRWM0gzem01IDB2NGg0VjNIOHpNMyA4djRoNFY4SDN6bTUgMHY0aDRWOEg4eiIvPjwvc3ZnPg==',
} as const;

const BORDER = '1px solid var(--el-border-color,#bbb)';
const HEAD_BG = 'background:var(--el-fill-color-light,#e8f4fd);';
const CELL = `border:${BORDER};padding:3px 6px;text-align:center;font-family:monospace;`;

/** 把单元格值渲染成表格；`editable` 时是可写 input。 */
function buildTable(
  host: GridHost,
  rows: number,
  cols: number,
  offset: number,
  editable: boolean,
): HTMLTableElement {
  const cells = host.getCells();
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;';

  const head = document.createElement('tr');
  const corner = document.createElement('th');
  corner.style.cssText = `border:${BORDER};padding:3px 6px;${HEAD_BG}min-width:28px;`;
  head.appendChild(corner);
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    th.style.cssText = `border:${BORDER};padding:3px 6px;${HEAD_BG}font-weight:bold;`;
    th.textContent = 'x' + c.toString(16).toUpperCase();
    head.appendChild(th);
  }
  table.appendChild(head);

  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    const rowHead = document.createElement('td');
    rowHead.style.cssText = `border:${BORDER};padding:3px 6px;${HEAD_BG}font-weight:bold;`;
    rowHead.textContent = r.toString(16).toUpperCase();
    tr.appendChild(rowHead);
    for (let c = 0; c < cols; c++) {
      const index = offset + r * cols + c;
      const td = document.createElement('td');
      td.style.cssText = CELL;
      const raw = cells[index];
      // 末行右余格（1 秩 100 格按 16 列排版，末行只剩 4 格）不属于数据：渲染成不可编辑的空格。
      // 否则往这些格子里输入会把 values 撑长，形状自洽被静默破坏。
      if (raw === undefined) {
        td.textContent = '';
        tr.appendChild(td);
        continue;
      }
      if (editable) {
        const input = document.createElement('input');
        input.value = raw;
        input.style.cssText =
          'width:3.6em;border:0;background:transparent;text-align:center;font-family:monospace;';
        input.addEventListener('change', () => {
          const attempt = input.value;
          const normalized = host.normalize(attempt);
          if (normalized === null) {
            input.value = raw;
            host.warn?.(`第 ${index + 1} 个单元格非法：${attempt}`);
            return;
          }
          const next = host.getCells().slice();
          next[index] = normalized;
          host.setCells(next);
          host.warn?.(null);
        });
        td.appendChild(input);
      } else {
        td.textContent = raw;
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

/** 把弹窗放在块右侧，越界时收进视口；拿不到锚点就退回左上角。 */
function positionPopup(popup: HTMLElement, anchor: Element | null): void {
  if (!anchor) {
    popup.style.left = '80px';
    popup.style.top = '80px';
    return;
  }
  try {
    const rect = anchor.getBoundingClientRect();
    const width = popup.offsetWidth || 200;
    const height = popup.offsetHeight || 300;
    const x = Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
  } catch (error) {
    console.warn('[grid-editor] 弹窗定位失败，退回左上角', error);
    popup.style.left = '80px';
    popup.style.top = '80px';
  }
}

/** 打开表格弹窗；同一宿主只应保持一个（由调用方负责关闭旧的）。 */
export function openGridPopup(host: GridHost, options: GridPopupOptions): GridPopupHandle {
  const shape = host.getShape();
  const { rows, cols, slices } = renderShape(shape);

  const popup = document.createElement('div');
  popup.style.cssText =
    'position:fixed;z-index:10000;background:var(--el-bg-color-overlay,#fff);' +
    'border:2px solid var(--el-color-primary,#4a90d9);border-radius:8px;padding:12px;' +
    'color:var(--el-text-color-primary,#333);' +
    'max-width:min(90vw,720px);box-shadow:0 4px 20px rgba(0,0,0,0.25);' +
    'font-family:monospace;max-height:420px;overflow:auto;';

  const title = document.createElement('div');
  title.style.cssText =
    'font-size:14px;font-weight:bold;margin-bottom:8px;color:var(--el-text-color-primary,#333);';
  title.textContent = `${options.title} ${shape.join('×')}`;
  popup.appendChild(title);

  // 秩 ≥ 3：用一个切片选择器翻页，页内始终是二维表。
  let activeSlice = 0;
  const tableHost = document.createElement('div');
  if (slices > 1) {
    const picker = document.createElement('select');
    picker.style.cssText = 'margin-bottom:8px;font-family:monospace;';
    for (let i = 0; i < slices; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `切片 ${i + 1}/${slices}`;
      picker.appendChild(option);
    }
    picker.addEventListener('change', () => {
      activeSlice = Number(picker.value) || 0;
      tableHost.replaceChildren(buildTable(host, rows, cols, activeSlice * rows * cols, Boolean(options.editable)));
    });
    popup.appendChild(picker);
  }
  tableHost.appendChild(buildTable(host, rows, cols, 0, Boolean(options.editable)));
  popup.appendChild(tableHost);
  document.body.appendChild(popup);
  positionPopup(popup, host.getAnchor?.() ?? null);

  let closed = false;
  const handle: GridPopupHandle = {
    element: popup,
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('click', outside);
      popup.remove();
      options.onClose?.();
    },
  };
  const outside = (event: MouseEvent): void => {
    if (!popup.contains(event.target as Node)) handle.close();
  };
  setTimeout(() => document.addEventListener('click', outside));
  return handle;
}

/** 解析 CSV 文本为单元格数组（逗号或换行分隔，空项丢弃）。 */
export function parseCsv(text: string): string[] {
  return text
    .split(/[,\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 把单元格数组下载成 CSV。 */
export function downloadCsv(fileName: string, cells: readonly string[]): void {
  const blob = new Blob([cells.join(',')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 弹出文件选择框，读回文本交给调用方校验。 */
export function pickCsvFile(onText: (text: string) => void, onError: (message: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.txt';
  input.style.display = 'none';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => onText(String(event.target?.result ?? ''));
      reader.onerror = () => onError('CSV 读取失败');
      reader.readAsText(file);
    }
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}
