/**
 * S-box 旧格式迁移：把 _sbx_def_ / SBox_xx_yy 字段写回到 gridData 或老字段。
 *
 * 从 utils/workspace/serialization.ts 按行区间原样搬出（302-472），
 * 由 serialization.ts 在 loadXml / loadJson 后调用。
 */
import * as Blockly from 'blockly/core';

/**
 * 安排一个宏任务在 Blockly 完成当前渲染周期后执行。
 * 优先使用 requestAnimationFrame（双帧保证渲染完成），
 * 降级使用 setTimeout(0)。
 */
function scheduleDeferred(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    // 双帧 RAF：第一帧排队，第二帧执行，确保 DOM 已更新
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          fn();
        } catch (e) {
          console.warn('[serialization] deferred fn error:', e);
        }
      });
    });
  } else {
    setTimeout(() => {
      try {
        fn();
      } catch (e) {
        console.warn('[serialization] deferred fn error:', e);
      }
    }, 16); // ~1 frame @ 60fps
  }
}

interface SBoxLike extends Blockly.Block {
  updateShape?: () => void;
  gridData?: string[];
}

function _applySboxFields(
  block: Blockly.Block,
  fields: Map<string, string>,
): void {
  if (typeof (block as SBoxLike).updateShape !== 'function') return;

  const firstKey = fields.keys().next().value;
  if (!firstKey) return;
  const hasField = block.getField(firstKey) !== null;

  Blockly.Events.disable();
  try {
    (block as SBoxLike).updateShape!();
    if (hasField) {
      // Old-format block: SBox_ fields exist
      for (const [fieldName, value] of fields) {
        const field = block.getField(fieldName);
        if (field) field.setValue(value);
      }
    } else {
      // New-format block: inject into gridData
      const rowCount = Number(block.getFieldValue('ROW')) || 4;
      const colCount = Number(block.getFieldValue('COL')) || 4;
      const size = rowCount * colCount;
      const gd: string[] = Array.from({ length: size }, () => '00');
      for (const [fieldName, value] of fields) {
        const m = fieldName.match(/^SBox_(\d+)_(\d+)$/);
        if (m) {
          const idx = parseInt(m[1]) * colCount + parseInt(m[2]);
          if (idx < size) gd[idx] = value.padStart(2, '0');
        }
      }
      (block as SBoxLike).gridData = gd;
    }
  } finally {
    Blockly.Events.enable();
  }
}

/** 检测 state 中是否存在旧格式 _sbx_def_ 的 S-box 块（随 collectSboxFieldValues 一次遍历完成） */
export function fixSboxFieldsAfterLoad(
  workspace: Blockly.WorkspaceSvg,
  sboxFieldValues: Map<string, Map<string, string>>,
): void {
  const allBlocks = workspace.getAllBlocks(false);
  const sboxBlocks = allBlocks.filter((b) => b.type === 'sbox');
  if (sboxBlocks.length === 0) return;

  sboxBlocks.forEach((block) => {
    const fields = sboxFieldValues.get(block.id);
    if (!fields) {
      console.warn(
        '[fixSboxFieldsAfterLoad] ⚠️ 未找到 block',
        block.id,
        '的 S-box 数据',
      );
      return;
    }
    scheduleDeferred(() => _applySboxFields(block, fields));
  });
}

export function fixSboxFieldsAfterXmlLoad(
  workspace: Blockly.WorkspaceSvg,
  xmlText: string,
): void {
  const sboxFieldValues = collectSboxFieldValuesFromXml(xmlText);
  workspace.getAllBlocks(false).forEach((block) => {
    if (block.type !== 'sbox') return;
    const fields = sboxFieldValues.get(block.id);
    if (!fields) return;
    scheduleDeferred(() => _applySboxFields(block, fields));
  });
}

export function collectSboxFieldValues(
  obj: unknown,
  result: Map<string, Map<string, string>> = new Map(),
  legacyFound: { value: boolean } = { value: false },
): Map<string, Map<string, string>> {
  if (Array.isArray(obj)) {
    for (const item of obj)
      collectSboxFieldValues(item, result, legacyFound);
    return result;
  }
  if (typeof obj !== 'object' || obj === null) return result;

  const record = obj as Record<string, unknown>;
  if (record.type === 'sbox' && record.id) {
    let fieldMap: Map<string, string> | undefined;

    if (record._sbx_def_ && typeof record._sbx_def_ === 'object') {
      legacyFound.value = true;
      fieldMap = new Map<string, string>();
      for (const [key, val] of Object.entries(
        record._sbx_def_ as Record<string, unknown>,
      )) {
        if (typeof val === 'string') fieldMap.set(key, val);
      }
    } else if (record.fields && typeof record.fields === 'object') {
      fieldMap = new Map<string, string>();
      const fieldObj = record.fields as Record<string, unknown>;
      for (const [key, val] of Object.entries(fieldObj)) {
        if (key.startsWith('SBox_') && typeof val === 'string') {
          fieldMap.set(key, val);
        }
      }
    }

    if (fieldMap && fieldMap.size > 0) result.set(record.id as string, fieldMap);
  }

  for (const key of Object.keys(record))
    collectSboxFieldValues(record[key], result, legacyFound);
  return result;
}

function collectSboxFieldValuesFromXml(
  xmlText: string,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  const blockRegex =
    /<block\b(?=[^>]*\btype=(['"])sbox\1)(?=[^>]*\bid=(['"])([^'"]*)\2)[^>]*>([\s\S]*?)<\/block>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(xmlText)) !== null) {
    const fieldMap = new Map<string, string>();
    const fieldRegex =
      /<field name=(['"])(SBox_\d+_\d+)\1>((?:[^<]|<(?!\/field>))*)<\/field>/g;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = fieldRegex.exec(match[4])) !== null) {
      fieldMap.set(fMatch[2], fMatch[3]);
    }
    if (fieldMap.size > 0) result.set(match[3], fieldMap);
  }

  return result;
}
