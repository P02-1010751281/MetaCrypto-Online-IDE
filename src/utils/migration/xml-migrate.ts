import { BLOCK_TYPE_MIGRATION_MAP } from './block-map';
import { legacyPartitionMode } from './partition-mode';
import {
  directXmlField,
  hasDirectXmlField,
  matchingBlockClose,
  xmlPartitionTarget,
} from './xml-helpers';
import { migrateSboxDefXml, migrateSboxXml } from './xml-sbox';

export function migrateXmlText(xmlText: string): string {
  if (!xmlText || !xmlText.trim()) return xmlText;

  let result = xmlText;

  result = migrateSboxXml(result);
  result = migrateLegacyGetTextXml(result);

  const sortedEntries = Object.entries(BLOCK_TYPE_MIGRATION_MAP).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [oldType, newType] of sortedEntries) {
    if (result.includes(`type="${oldType}"`)) {
      result = result.replace(
        new RegExp(`type="${oldType}"`, 'g'),
        `type="${newType}"`,
      );
    }
    if (result.includes(`type='${oldType}'`)) {
      result = result.replace(
        new RegExp(`type='${oldType}'`, 'g'),
        `type='${newType}'`,
      );
    }
  }

  // crypto_sbox_def / sbox_def → sbox_variables_set: 结构迁移
  result = migrateSboxDefXml(result);

  result = migrateCompoundFieldXml(result);
  result = migrateBitOperationFieldXml(result);
  result = migratePartitionModeXml(result);
  result = migrateIterateTimesXml(result);

  return result;
}

function migrateLegacyGetTextXml(xml: string): string {
  const openings = /<block\b(?:[^'">]|"[^"]*"|'[^']*')*>/g;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = openings.exec(xml))) {
    const type = match[0].match(/\btype=(['"])(.*?)\1/);
    if (type?.[2] !== 'crypto_get_text') continue;
    const end = matchingBlockClose(xml, match.index);
    if (end < 0) continue;
    const openingEnd = openings.lastIndex;
    const field = directXmlField(xml.slice(openingEnd, end), 'TEXT');
    if (!field) continue;
    const renamed = field.tag.replace(/\bname=(['"])TEXT\1/, (_, quote: string) => `name=${quote}NUM${quote}`);
    replacements.push({ start: openingEnd + field.index, end: openingEnd + field.index + field.tag.length, value: renamed });
  }
  for (const replacement of replacements.reverse()) {
    xml = `${xml.slice(0, replacement.start)}${replacement.value}${xml.slice(replacement.end)}`;
  }
  return xml;
}

function migrateCompoundFieldXml(xml: string): string {
  return xml.replace(
    /(<block type="lgc_compound"[^>]*>[\s\S]*?<field name="instr">)(XOR|OR|AND)(<\/field>)/g,
    (_, prefix, value, suffix) => {
      const map: Record<string, string> = {
        XOR: 'XOR_XOR',
        OR: 'OR_OR',
        AND: 'AND_AND',
      };
      return prefix + (map[value] || value) + suffix;
    },
  );
}

function migrateBitOperationFieldXml(xml: string): string {
  const opMap: Record<string, string> = {
    ROR32: 'RIGHT_ROTATE',
    SHR32: 'RIGHT_SHIFT',
  };
  return xml.replace(
    /(<block type="(?:crypto_bitwise_expr|bit_operation)"[^>]*>[\s\S]*?<field name="OP">)(ROR32|SHR32)(<\/field>)/g,
    (_, prefix, value, suffix) => {
      return prefix + (opMap[value] || value) + suffix;
    },
  );
}

/**
 * `ctrl_iterate` 的 `TIMES`：旧 XML 是 `<field name="TIMES">N</field>`，新块是值输入。
 * 就地改写成 `math_number` 影子值，次数不丢（与 json-migrate 的同一迁移对应）。
 */
function migrateIterateTimesXml(xml: string): string {
  const blockOpenings = /<block\b(?:[^'">]|"[^"]*"|'[^']*')*>/g;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = blockOpenings.exec(xml))) {
    const type = match[0].match(/\btype=(['"])(.*?)\1/);
    if (type?.[2] !== 'ctrl_iterate' || match[0].endsWith('/>')) continue;
    const end = matchingBlockClose(xml, match.index);
    if (end < 0) continue;
    const openingEnd = blockOpenings.lastIndex;
    const contents = xml.slice(openingEnd, end);
    const field = /<field\s+name=(['"])TIMES\1\s*>([^<]*)<\/field>/.exec(contents);
    if (!field) continue;
    replacements.push({
      start: openingEnd + field.index,
      end: openingEnd + field.index + field[0].length,
      value: `<value name="TIMES"><shadow type="data_value"><field name="NUM">${field[2].trim() || '32'}</field></shadow></value>`,
    });
  }

  for (const replacement of replacements.reverse()) {
    xml = `${xml.slice(0, replacement.start)}${replacement.value}${xml.slice(replacement.end)}`;
  }
  return xml;
}

function migratePartitionModeXml(xml: string): string {
  const blockOpenings = /<block\b(?:[^'">]|"[^"]*"|'[^']*')*>/g;
  const insertions: Array<{ index: number; field: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = blockOpenings.exec(xml))) {
    const type = match[0].match(/\btype=(['"])(.*?)\1/);
    if (!type || (type[2] !== 'crypto_partition_to_array' && type[2] !== 'arr_partition_to_array') || match[0].endsWith('/>')) continue;
    const end = matchingBlockClose(xml, match.index);
    if (end < 0) continue;
    const openingEnd = blockOpenings.lastIndex;
    const contents = xml.slice(openingEnd, end);
    if (!hasDirectXmlField(contents, 'MODE')) {
      const target = xmlPartitionTarget(contents);
      insertions.push({
        index: openingEnd,
        field: `<field name="MODE">${legacyPartitionMode(target)}</field>`,
      });
    }
  }

  for (const insertion of insertions.reverse()) {
    xml = `${xml.slice(0, insertion.index)}${insertion.field}${xml.slice(insertion.index)}`;
  }
  return xml;
}
