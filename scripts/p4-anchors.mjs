#!/usr/bin/env node
/**
 * P4 A 线纵向切片 · 第 1 段：条款锚点抽取器
 *
 * 只做 FIPS 180-4 相关条目（docs/standards/fips180-4-SHA2/ 下的 01–05 五个结构化条目页），
 * 不铺全语料。输出 experiments/ai-helper-2026-11-14/p4/anchors.json。
 *
 * 口径（与 docs/standards/STRUCTURED-ENTRY-SCHEMA.md、P4-SCOPE.md §4 一致）：
 *   - 条目页的「原文位置」是**声明**；本脚本把它与 00-Standard-Source.md 的实际小节标题行交叉核对，
 *     对不上就在 anchor.mismatch 里记一条，不静默改写语料。
 *   - 条款单元 = 条目页「标准定位」里的每个 § 号；区间写法（§6.1–§6.7）展开成逐个 §。
 *   - 每个条款单元解析成 #L 行区间：起点 = 小节标题行，终点 = 下一个「层级不深于它」的标题行 −1。
 *     找不到同名标题时降级为 section 级（derived span）并写明原因——不伪造行号。
 *   - slice_sha256 = sha256(join(lines[start-1..end], '\n'))，钉死语料切片。
 *
 * 复跑：node scripts/p4-anchors.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const STANDARD_DIR = 'docs/standards/fips180-4-SHA2';
const SOURCE_NAME = '00-Standard-Source.md';
const MANIFEST = 'docs/standards/standards-manifest.json';
const MANIFEST_ID = 'fips180-4-SHA2';
const ENTRY_FILES = ['01-SHA2.md', '02-Padding.md', '03-MessageExpansion.md', '04-Compression.md', '05-Digest.md'];
const OUT = resolve(ROOT, 'experiments/ai-helper-2026-11-14/p4/anchors.json');

/**
 * 小节标题行：行首无缩进、编号（可带章号后的点）+ 空白 + 大写开头的标题。
 * 三条排除：目录点线（`....`）、带冒号/花括号的行（正文里的编号步骤 `1. Prepare the message schedule, {Wt}:`）、
 * 以及缩进行（PDF 提取稿把正文步骤缩进了，标题都顶格）。分页控制符 \f 先剥掉。
 */
const HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+([A-Z][^:{}]{2,80})$/;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

/** 抽取源文件的小节标题表：编号 → {line, title, level, end}。 */
function buildHeadings(lines) {
  const headings = [];
  lines.forEach((line, index) => {
    const cleaned = line.replace(/\f/g, '');
    const match = HEADING_RE.exec(cleaned);
    if (!match) return;
    if (cleaned.includes('....')) return;
    const number = match[1];
    if (number.startsWith('0')) return;
    headings.push({
      number,
      title: match[2].trim(),
      level: number.split('.').length,
      line: index + 1,
    });
  });
  return headings;
}

function endOfSection(headings, startLine, level, totalLines) {
  const next = headings.find((item) => item.line > startLine && item.level <= level);
  return next ? next.line - 1 : totalLines;
}

/** 条目页的「条目元数据」表：`| 字段 | 内容 |`。返回行文本；缺字段算 null。 */
function metadataRow(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm').exec(text);
  return match ? match[1] : null;
}

/** 「标准定位」里的 § 引用；`§6.1–§6.7` 这类区间按同级编号展开。 */
function parseSectionRefs(cell) {
  if (!cell) return [];
  const refs = [];
  const rangeRe = /§\s*(\d+(?:\.\d+)*)\s*[–—-]\s*§?\s*(\d+(?:\.\d+)*)/g;
  let remaining = cell;
  for (let match = rangeRe.exec(cell); match; match = rangeRe.exec(cell)) {
    const [from, to] = [match[1], match[2]];
    remaining = remaining.replace(match[0], ' ');
    const prefix = from.includes('.') ? from.slice(0, from.lastIndexOf('.') + 1) : '';
    const fromTail = Number(from.slice(prefix.length));
    const toTail = Number(to.slice(prefix.length));
    if (!Number.isInteger(fromTail) || !Number.isInteger(toTail) || toTail < fromTail || toTail - fromTail > 20) {
      refs.push({ section: from, expandedFrom: match[0] });
      if (to !== from) refs.push({ section: to, expandedFrom: match[0] });
      continue;
    }
    for (let value = fromTail; value <= toTail; value += 1) {
      refs.push({ section: `${prefix}${value}`, expandedFrom: match[0] });
    }
  }
  const singleRe = /§\s*(\d+(?:\.\d+)*)/g;
  for (let match = singleRe.exec(remaining); match; match = singleRe.exec(remaining)) {
    refs.push({ section: match[1], expandedFrom: null });
  }
  return refs;
}

/** 条目页里指向 00-Standard-Source.md 的行锚点（区间 / 单行）。 */
function parseDeclaredAnchors(cell) {
  if (!cell) return [];
  const anchors = [];
  const linkRe = /\((\.\/00-Standard-Source\.md)?#L(\d+)(?:-L(\d+))?\)/g;
  for (let match = linkRe.exec(cell); match; match = linkRe.exec(cell)) {
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : null;
    anchors.push({ kind: end ? 'line-range' : 'line-start', line_start: start, line_end: end });
  }
  return anchors;
}

function main() {
  const manifest = JSON.parse(readText(MANIFEST));
  const standard = manifest.entries.find((entry) => entry.id === MANIFEST_ID);
  if (!standard) throw new Error(`manifest 缺 ${MANIFEST_ID}`);

  const sourcePath = `${STANDARD_DIR}/${SOURCE_NAME}`;
  const sourceText = readText(sourcePath);
  const lines = sourceText.split('\n');
  const headings = buildHeadings(lines);
  if (headings.length === 0) throw new Error('源文件未解析出任何小节标题，口径失效');

  const entries = [];
  const clauseUnits = [];
  const counts = {
    entries: 0,
    declaredLineStart: 0,
    declaredLineRange: 0,
    declaredHeadingOnly: 0,
    clauseUnits: 0,
    clauseUnitsClickable: 0,
    clauseUnitsSectionLevel: 0,
    clauseUnitsWithoutHeading: 0,
    entryAnchorMismatch: 0,
    declaredOutsideSections: 0,
  };

  for (const file of ENTRY_FILES) {
    const entryPath = `${STANDARD_DIR}/${file}`;
    const text = readText(entryPath);
    const positionCell = metadataRow(text, '原文位置');
    const scopeCell = metadataRow(text, '标准定位');
    const declared = parseDeclaredAnchors(positionCell);
    const refs = parseSectionRefs(scopeCell);
    const clauseId = file.replace(/\.md$/, '');

    counts.entries += 1;
    for (const anchor of declared) {
      if (anchor.kind === 'line-range') counts.declaredLineRange += 1;
      else counts.declaredLineStart += 1;
    }
    if (declared.length === 0) counts.declaredHeadingOnly += 1;

    const resolved = [];
    for (const ref of refs) {
      const heading = headings.find((item) => item.number === ref.section);
      if (heading) {
        const end = endOfSection(headings, heading.line, heading.level, lines.length);
        const slice = lines.slice(heading.line - 1, end).join('\n');
        resolved.push({
          section: ref.section,
          expandedFrom: ref.expandedFrom,
          anchorLevel: 'line',
          clickable: true,
          line_start: heading.line,
          line_end: end,
          heading: heading.title,
          firstLine: lines[heading.line - 1],
          slice_sha256: sha256(slice),
        });
        counts.clauseUnitsClickable += 1;
      } else {
        // §6 这类「章号」在本提取稿里没有同名标题：用它的第一个子小节到最后一个子小节推导跨度。
        const children = headings.filter((item) => item.number.startsWith(`${ref.section}.`));
        const derived = children.length > 0
          ? {
              line_start: children[0].line,
              line_end: endOfSection(headings, children[children.length - 1].line,
                children[children.length - 1].level, lines.length),
            }
          : null;
        resolved.push({
          section: ref.section,
          expandedFrom: ref.expandedFrom,
          anchorLevel: derived ? 'section' : 'none',
          clickable: Boolean(derived),
          line_start: derived ? derived.line_start : null,
          line_end: derived ? derived.line_end : null,
          heading: null,
          firstLine: derived ? lines[derived.line_start - 1] : null,
          slice_sha256: derived
            ? sha256(lines.slice(derived.line_start - 1, derived.line_end).join('\n'))
            : null,
          reason: derived
            ? '提取稿没有与章号同名的标题行；跨度由首个与末个子小节推导，不是唯一可验证的行号'
            : '既无同名标题也无子小节，只能保留章节级定位',
        });
        if (derived) counts.clauseUnitsSectionLevel += 1;
        else counts.clauseUnitsWithoutHeading += 1;
      }
      counts.clauseUnits += 1;
    }

    // 声明与实际交叉核对：条目页声明的起点行必须落在某个已解析小节标题上。
    const mismatches = [];
    for (const anchor of declared) {
      const headingAt = headings.find((item) => item.line === anchor.line_start);
      if (!headingAt) {
        mismatches.push({
          declared: anchor,
          detail: `第 ${anchor.line_start} 行不是小节标题行：${JSON.stringify((lines[anchor.line_start - 1] || '').slice(0, 60))}`,
        });
      }
    }
    counts.entryAnchorMismatch += mismatches.length;

    // 语义越界：声明的行号虽然是标题行，但不是本条目所声明的小节（例：03/04 的「SHA-512：第 1142 行」
    // 实际落在 §6.4.1 预处理，而条目声明的是 §6.4.2 哈希计算）。只记录，不改语料。
    // 判定「在范围内」= 落在任一声明小节的跨度里（章级声明 §6 的跨度覆盖其子节，故 05 的 1029/1130 合法）。
    const inScope = (line) => resolved.some(
      (item) => item.anchorLevel === 'line' && item.line_start <= line && line <= item.line_end,
    );
    const outsideSections = declared.filter((anchor) => !inScope(anchor.line_start));
    counts.declaredOutsideSections += outsideSections.length;

    for (const item of resolved) {
      item.matchesDeclared = declared.some((anchor) => anchor.line_start === item.line_start);
    }

    entries.push({
      clauseId,
      entryPath,
      standardPosition: scopeCell,
      declaredPosition: positionCell,
      declaredAnchors: declared,
      resolvedSections: resolved,
      anchorMismatch: mismatches,
      declaredOutsideSections: outsideSections.map((anchor) => ({
        declared: anchor,
        lineText: (lines[anchor.line_start - 1] || '').trim().slice(0, 80),
      })),
      entryLevelAnchor: declared.length > 0 ? declared[0] : null,
    });

    for (const item of resolved) {
      clauseUnits.push({
        clauseId: `${clauseId}#§${item.section}`,
        entryId: clauseId,
        entryPath,
        section: item.section,
        expandedFrom: item.expandedFrom,
        anchorLevel: item.anchorLevel,
        clickable: item.clickable,
        matchesDeclared: item.matchesDeclared ?? false,
        click: item.clickable
          ? { doc: sourcePath, line_start: item.line_start, line_end: item.line_end }
          : null,
        source: {
          path: sourcePath,
          line_start: item.line_start,
          line_end: item.line_end,
          heading: item.heading,
          firstLine: item.firstLine,
          slice_sha256: item.slice_sha256,
        },
        reason: item.reason ?? null,
      });
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedBy: 'scripts/p4-anchors.mjs',
    scope: { standardId: MANIFEST_ID, entries: ENTRY_FILES.length, note: '只做 FIPS 180-4 相关条目，不铺全语料' },
    standard: {
      id: standard.id,
      name: standard.standard,
      version: standard.version,
      source_url: standard.source_url,
      source_checked_at: standard.source_checked_at,
      artifacts: standard.artifacts,
    },
    source: {
      path: sourcePath,
      lines: lines.length,
      sha256: sha256(sourceText),
    },
    counts,
    entries,
    clauseUnits,
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`ANCHORS ok entries=${counts.entries} clauseUnits=${counts.clauseUnits} ` +
    `clickable=${counts.clauseUnitsClickable} sectionLevel=${counts.clauseUnitsSectionLevel} ` +
    `unresolved=${counts.clauseUnitsWithoutHeading} mismatch=${counts.entryAnchorMismatch} ` +
    `outsideSections=${counts.declaredOutsideSections}`);
  console.log(`ANCHORS source=${sourcePath} lines=${lines.length} sha256=${payload.source.sha256.slice(0, 12)}…`);
  console.log(`ANCHORS out=${OUT.replace(`${ROOT}/`, '')}`);
}

main();
