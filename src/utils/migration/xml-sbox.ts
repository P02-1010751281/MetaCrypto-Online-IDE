export function migrateSboxXml(xml: string): string {
  let result = xml;

  // Old SXX (hex) field names → SBox_R_C
  result = result.replace(
    /<field name=(['"])S([0-9A-F])([0-9A-F])\1/gi,
    (_, quote, rowHex, colHex) => {
      const row = parseInt(rowHex, 16);
      const col = parseInt(colHex, 16);
      return `<field name=${quote}SBox_${row}_${col}${quote}`;
    },
  );

  let defaultSize = 16;
  if (result.includes('crypto_sbox_4x4')) defaultSize = 4;
  else if (result.includes('crypto_sbox_8x8')) defaultSize = 8;

  const sboxOldTypes = [
    'crypto_sbox_16x16',
    'crypto_sbox_16x16_settings',
    'crypto_sbox_8x8',
    'crypto_sbox_8x8_settings',
    'crypto_sbox_4x4',
    'crypto_sbox_configurable',
    'crypto_sbox',
  ];

  for (const oldType of sboxOldTypes) {
    if (!result.includes(oldType)) continue;
    result = result.replace(
      new RegExp(`type=(["'])${oldType}\\1`, 'g'),
      (_, quote) => `type=${quote}sbox${quote}`,
    );
  }

  // Add <mutation> for blocks that don't already have one
  result = result.replace(
    /<block\b(?=[^>]*\btype=(['"])sbox\1)[^>]*>(?!\s*<mutation)/g,
    '$&<mutation row="' +
      defaultSize +
      '" col="' +
      defaultSize +
      '" output_format="2d"></mutation>',
  );

  return result;
}

/**
 * crypto_sbox_def / sbox_def → sbox_variables_set 结构迁移 (XML)
 *
 * 旧结构: <block type="sbox_def"><value name="new_box">...</value></block>
 * 新结构: <block type="sbox_variables_set">
 *           <field name="VAR" id="..." variabletype="SBox">sbox</field>
 *           <value name="VALUE">...</value>
 *         </block>
 */
export function migrateSboxDefXml(xml: string): string {
  let result = xml;

  const blockRe =
    /<block type="(?:crypto_sbox_def|sbox_def)"[^>]*>[\s\S]*?<\/block>/g;

  result = result.replace(blockRe, (match) => {
    if (match.includes('sbox_variables_set')) return match;

    const varId = 'sbox_migrated_' + simpleHash(match.slice(0, 80));

    let m = match;
    m = m.replace(
      /type="(?:crypto_sbox_def|sbox_def)"/,
      'type="sbox_variables_set"',
    );
    m = m.replace(/name="new_box"/g, 'name="VALUE"');
    m = m.replace(
      /(<value name="VALUE")/,
      `<field name="VAR" id="${varId}" variabletype="SBox">sbox</field>$1`,
    );
    return m;
  });

  return result;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
