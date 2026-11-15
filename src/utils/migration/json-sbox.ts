export function migrateSboxFieldNamesJson(json: string): string {
  return json.replace(/"S([0-9A-F])([0-9A-F])"/gi, (_, rowHex, colHex) => {
    const row = parseInt(rowHex, 16);
    const col = parseInt(colHex, 16);
    return `"SBox_${row}_${col}"`;
  });
}

const SBOX_ALIASES = new Set([
  'sbox',
  'sbox_4x4',
  'sbox_8x8',
  'sbox_16x16',
  'sbox_16x16_settings',
  'sbox_8x8_settings',
  'crypto_sbox_configurable',
]);

function isSboxType(type: unknown): boolean {
  return typeof type === 'string' && SBOX_ALIASES.has(type);
}

export function injectSboxRowColFields(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) injectSboxRowColFields(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  if (
    isSboxType(record.type) &&
    record.fields &&
    typeof record.fields === 'object'
  ) {
    const fields = record.fields as Record<string, unknown>;
    if (!('ROW' in fields)) {
      record.fields = {
        ROW: 16,
        COL: 16,
        OUTPUT_FORMAT: '2d',
        ...fields,
      };
    }
    record.type = 'sbox';
  }

  for (const key of Object.keys(record)) {
    injectSboxRowColFields(record[key]);
  }
}

/**
 * Migrate old SBox_X_Y field values into mutations.data for JSON state.
 */
export function migrateSboxJsonMutateData(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) migrateSboxJsonMutateData(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  if (
    record.type === 'sbox' &&
    record.fields &&
    typeof record.fields === 'object'
  ) {
    const fields = record.fields as Record<string, unknown>;

    // Ensure extraState container exists (Blockly 12 uses extraState, not mutations)
    if (!record.extraState || typeof record.extraState !== 'object') {
      record.extraState = {};
    }
    const extra = record.extraState as Record<string, unknown>;

    // Collect SBox_ values from fields OR from _sbx_def_ (legacy deferral format)
    const source: Record<string, unknown> = { ...fields };
    const sbxDef =
      record._sbx_def_ && typeof record._sbx_def_ === 'object'
        ? (record._sbx_def_ as Record<string, unknown>)
        : null;
    if (sbxDef) {
      for (const [k, v] of Object.entries(sbxDef)) {
        if (/^SBox_\d+_\d+$/.test(k) && !(k in source)) {
          source[k] = v;
        }
      }
    }

    const sboxKeys = Object.keys(source)
      .filter((k) => /^SBox_\d+_\d+$/.test(k))
      .sort((a, b) => {
        const [, ar, ac] = a.match(/^SBox_(\d+)_(\d+)$/)!;
        const [, br, bc] = b.match(/^SBox_(\d+)_(\d+)$/)!;
        return parseInt(ar) - parseInt(br) || parseInt(ac) - parseInt(bc);
      });

    // Always clean up SBox_* from fields (even if extraState.data already exists)
    for (const k of sboxKeys) {
      delete fields[k];
      if (sbxDef) delete sbxDef[k];
    }

    if (sboxKeys.length === 0) {
      // No SBox fields to migrate, recurse and return
      for (const key of Object.keys(record)) {
        migrateSboxJsonMutateData(record[key]);
      }
      return;
    }

    // Only set data if not already present (don't overwrite existing)
    if (!('data' in extra)) {
      extra.data = sboxKeys.map((k) => String(source[k] ?? '00')).join(',');
    }
    // Also migrate row/col/output_format so loadExtraState sees the correct size.
    // Prefer the old mutations if present (which had correct dimensions),
    // otherwise fall back to fields, then defaults.
    const oldMut =
      record.mutations && typeof record.mutations === 'object'
        ? (record.mutations as Record<string, unknown>)
        : null;
    const extR = (oldMut?.row as number) || (fields.ROW as number) || 4;
    const extC = (oldMut?.col as number) || (fields.COL as number) || 4;
    const extF =
      (oldMut?.output_format as string) ||
      (fields.OUTPUT_FORMAT as string) ||
      '2d';
    extra.row = String(extR);
    extra.col = String(extC);
    extra.output_format = String(extF);
  }

  for (const key of Object.keys(record)) {
    migrateSboxJsonMutateData(record[key]);
  }
}

/**
 * crypto_sbox_def / sbox_def → sbox_variables_set 结构迁移 (JSON)
 *
 * 旧: { type: "sbox_def", inputs: { new_box: { block: ... } } }
 * 新: { type: "sbox_variables_set", fields: { VAR: { id: "..." } }, inputs: { VALUE: { block: ... } } }
 */
export function migrateSboxDefJson(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) migrateSboxDefJson(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === 'variables' || key === 'blocks') continue;
    migrateSboxDefJson(record[key]);
  }

  if ('blocks' in record && Array.isArray(record.blocks)) {
    const blocks = record.blocks as Record<string, unknown>[];
    let varsMutated = false;

    const walkBlocks = (items: Record<string, unknown>[]) => {
      for (const block of items) {
        const btype = block.type;
        if (btype === 'crypto_sbox_def' || btype === 'sbox_def') {
          block.type = 'sbox_variables_set';

          if (block.inputs && typeof block.inputs === 'object') {
            const inputs = block.inputs as Record<string, unknown>;
            if (inputs.new_box !== undefined) {
              inputs.VALUE = inputs.new_box;
              delete inputs.new_box;
            }
          }

          if (!block.fields || typeof block.fields !== 'object') {
            block.fields = {};
          }
          const fields = block.fields as Record<string, unknown>;
          if (!fields.VAR) {
            const varId =
              'sbox_migrated_' +
              Date.now().toString(36) +
              '_' +
              Math.random().toString(36).slice(2, 8);
            fields.VAR = { id: varId };
            if (!record.variables) {
              record.variables = [];
            }
            (record.variables as Record<string, unknown>[]).push({
              name: 'sbox',
              id: varId,
              type: 'SBox',
            });
            varsMutated = true;
          }
        }

        if (block.inputs && typeof block.inputs === 'object') {
          for (const inputVal of Object.values(
            block.inputs as Record<string, unknown>,
          )) {
            if (
              inputVal &&
              typeof inputVal === 'object' &&
              'block' in (inputVal as Record<string, unknown>)
            ) {
              walkBlocks([
                (inputVal as Record<string, unknown>).block as Record<
                  string,
                  unknown
                >,
              ]);
            }
          }
        }
        if (
          block.next &&
          typeof block.next === 'object' &&
          'block' in (block.next as Record<string, unknown>)
        ) {
          walkBlocks([
            (block.next as Record<string, unknown>).block as Record<
              string,
              unknown
            >,
          ]);
        }
      }
    };

    walkBlocks(blocks);

    if (varsMutated && Array.isArray(record.variables)) {
      const seen = new Set<string>();
      record.variables = (record.variables as Record<string, unknown>[]).filter(
        (v) => {
          const id = v.id as string;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        },
      );
    }
  }
}
