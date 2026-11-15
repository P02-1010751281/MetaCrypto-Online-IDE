/**
 * 数组/矩阵的形状工具（纯函数，无 Blockly、无 DOM）。
 *
 * 设计口径（见 `experiments/ai-helper-2026-11-14/proposals/TYPE-SYSTEM-ARRAY-MATRIX.md`）：
 * **秩不是类型，是元数据**。单元格永远扁平存储，`shape` 只描述怎么展示与如何校验，
 * 因此 1 秩、2 秩、3 秩走同一套代码，类型系统不随维数增长。
 */

/** **不能**用 `parseShape` 的输入：非正整数、多秩单维超过 4096、空串。 */
const MAX_DIM = 4096;

/**
 * 单元格总数上限。实测（Chromium，1 秩表格，见 `experiments/ai-helper-2026-11-14/grid-harness`）：
 * 14 671 格 173 ms、65 536 格 988 ms、262 144 格 3 578 ms。取 65 536 —— 覆盖仓库实测最长
 * 字面量（14 671），最坏情况约 1 s，再往上就是肉眼可见的卡顿，所以拒绝而不是硬扛。
 *
 * 单维上限 `MAX_DIM` 只约束多秩：多秩第二维直接决定表格宽度，4096 列已不可读；
 * 1 秩按总格数计（表格固定 16 列一行），因此不受 `MAX_DIM` 限制。
 */
export const MAX_CELLS = 65536;

/** 形状上限的人话版，给块的警告文案复用。 */
export const SHAPE_LIMITS_TEXT = `1 秩最多 ${MAX_CELLS} 个元素；多秩每维最多 ${MAX_DIM} 且总数最多 ${MAX_CELLS}`;

/** 维度乘积；任何非法维度、越界维度或超总量都让结果为 0（表示「形状无效」）。 */
export function shapeSize(shape: readonly number[]): number {
  if (!shape.length) return 0;
  const multiRank = shape.length > 1;
  let size = 1;
  for (const dim of shape) {
    if (!Number.isInteger(dim) || dim <= 0) return 0;
    if (multiRank && dim > MAX_DIM) return 0;
    size *= dim;
    if (size > MAX_CELLS) return 0;
  }
  return size;
}

/** 解析 `"16"` / `"4,4"` / `"3,3,3"`（也接受 `x` / `×` / `*` 分隔）；非法返回 null。 */
export function parseShape(raw: string): number[] | null {
  const parts = raw
    .split(/[,x×*]/i)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const multiRank = parts.length > 1;
  const dims: number[] = [];
  let size = 1;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value <= 0) return null;
    if (multiRank && value > MAX_DIM) return null;
    size *= value;
    if (size > MAX_CELLS) return null;
    dims.push(value);
  }
  return dims;
}

/** `[4,4]` → `"4x4"`，用于块的显示与警告文案。 */
export function formatShape(shape: readonly number[]): string {
  return shape.join('x');
}

export interface ShapeAudit {
  ok: boolean;
  /** 形状声明应有的单元格数；形状非法时为 0。 */
  expected: number;
  /** 实际单元格数。 */
  actual: number;
  reason: string | null;
}

/**
 * 形状自洽校验：`prod(shape) === values.length`，且每个值都是十进制整数。
 * 这是 3×3×3 只填 26 个值这类错误唯一能被抓到的地方。
 */
export function auditShape(shape: readonly number[], values: readonly string[]): ShapeAudit {
  const expected = shapeSize(shape);
  const actual = values.length;
  if (!expected) {
    return { ok: false, expected: 0, actual, reason: `形状非法：${formatShape(shape)}` };
  }
  if (expected !== actual) {
    return {
      ok: false,
      expected,
      actual,
      reason: `形状 ${formatShape(shape)} 需要 ${expected} 个值，实际 ${actual} 个`,
    };
  }
  for (const [index, value] of values.entries()) {
    if (!/^-?\d+$/.test(String(value).trim())) {
      return { ok: false, expected, actual, reason: `第 ${index + 1} 个值不是整数：${value}` };
    }
  }
  return { ok: true, expected, actual, reason: null };
}
