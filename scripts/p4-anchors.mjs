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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SOURCE_NAME = '00-Standard-Source.md';
const MANIFEST = 'docs/standards/standards-manifest.json';
const P4_DIR = 'experiments/ai-helper-2026-11-14/p4';

/**
 * 每个标准一份抽取配置。判定口径（三档、证据层）不在本脚本里，这里只解决「怎么把语料里的
 * 声明变成可点的行区间」——语料版式不同，标题识别与 § 出处也不同，所以这三项按标准配置：
 *
 * - `layout`：`strict-column0` = 标题顶格（FIPS 180-4 的提取稿）；`indented` = 标题被
 *   pdftotext -layout 缩进到固定列（SP 800-38B），只认「编号 + 两个以上空格 + 纯字母标题」，
 *   正文步骤（`1.     Let L = CIPHK(0b).`）因为带 `=()0` 不会被当成标题。
 * - `sectionRef`：条款单元从哪取 § 号。`standard-position` = 只认条目元数据的「标准定位」；
 *   `position-fallback` = 「标准定位」没有 § 时退回「原文位置」里的 §（CMAC 三页都是后者）。
 * - `appendices`：提取稿末尾的 `Appendix A: …` 是否算一级标题。不算时章级跨度会一路吃掉附录，
 *   把 §6 的锚点撑到文件尾；FIPS 180-4 保持关闭以维持既有产物逐字节不变。
 */
const STANDARDS = {
  'fips180-4-SHA2': {
    dir: 'docs/standards/fips180-4-SHA2',
    entries: ['01-SHA2.md', '02-Padding.md', '03-MessageExpansion.md', '04-Compression.md', '05-Digest.md'],
    layout: 'strict-column0',
    sectionRef: 'standard-position',
    appendices: false,
    out: `${P4_DIR}/anchors.json`,
    note: '只做 FIPS 180-4 相关条目，不铺全语料',
  },
  'sp800-38b-cmac': {
    dir: 'docs/standards/sp800-38b-cmac',
    entries: ['01-CMAC.md', '02-Subkeys.md', '03-MAC.md'],
    layout: 'indented',
    sectionRef: 'position-fallback',
    appendices: true,
    out: `${P4_DIR}/anchors-sp800-38b-cmac.json`,
    note: '第二份标准切片（非哈希标准）：SP 800-38B CMAC 三个条目页；同一套锚点口径，只换版式适配',
  },
};

function selectStandard(argv) {
  const at = argv.indexOf('--standard');
  const id = at >= 0 ? argv[at + 1] : 'fips180-4-SHA2';
  const config = STANDARDS[id];
  if (!config) {
    console.error(`未知标准 ${id}；可选：${Object.keys(STANDARDS).join(' / ')}`);
    process.exit(2);
  }
  return { id, ...config };
}

/**
 * 小节标题行（顶格版式）：行首无缩进、编号（可带章号后的点）+ 空白 + 大写开头的标题。
 * 三条排除：目录点线（`....`）、带冒号/花括号的行（正文里的编号步骤 `1. Prepare the message schedule, {Wt}:`）、
 * 以及缩进行（PDF 提取稿把正文步骤缩进了，标题都顶格）。分页控制符 \f 先剥掉。
 */
const HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+([A-Z][^:{}]{2,80})$/;

/**
 * 缩进版式（SP 800-38B 这类 `pdftotext -layout` 提取稿）：标题被推到固定列，正文步骤缩得更深。
 * 区分靠标题形状而不是缩进深度：编号后**两个以上空格**、标题只由字母/空格/连字符组成。
 * 正文步骤带 `=`、`(`、数字或逗号，因此不会被误认；`Appendix A: …` 由 APPENDIX_RE 单独认。
 */
const INDENTED_HEADING_RE = /^[ \t]*(\d+(?:\.\d+)*)\.?[ ]{2,}([A-Z][A-Za-z]*(?:[ ][A-Za-z][A-Za-z-]*){0,7})\s*$/;
const APPENDIX_RE = /^[ \t]*Appendix\s+([A-Z]):\s+([A-Za-z][A-Za-z -]{2,60})\s*$/;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

/** 抽取源文件的小节标题表：编号 → {line, title, level, end}。 */
function buildHeadings(lines, config) {
  const headings = [];
  lines.forEach((line, index) => {
    const cleaned = line.replace(/\f/g, '');
    if (cleaned.includes('....')) return;
    const pattern = config.layout === 'indented' ? INDENTED_HEADING_RE : HEADING_RE;
    const match = pattern.exec(cleaned);
    if (match) {
      const number = match[1];
      if (number.startsWith('0')) return;
      headings.push({
        number,
        title: match[2].trim(),
        level: number.split('.').length,
        line: index + 1,
      });
      return;
    }
    if (!config.appendices) return;
    const appendix = APPENDIX_RE.exec(cleaned);
    if (!appendix) return;
    // 附录按一级标题处理：它的编号不是数字，但同样要截断前一章的跨度。
    headings.push({
      number: `Appendix ${appendix[1]}`,
      title: appendix[2].trim(),
      level: 1,
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
  const config = selectStandard(process.argv.slice(2));
  const manifest = JSON.parse(readText(MANIFEST));
  const standard = manifest.entries.find((entry) => entry.id === config.id);
  if (!standard) throw new Error(`manifest 缺 ${config.id}`);

  const sourcePath = `${config.dir}/${SOURCE_NAME}`;
  const sourceText = readText(sourcePath);
  const lines = sourceText.split('\n');
  const headings = buildHeadings(lines, config);
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

  for (const file of config.entries) {
    const entryPath = `${config.dir}/${file}`;
    const text = readText(entryPath);
    const positionCell = metadataRow(text, '原文位置');
    const scopeCell = metadataRow(text, '标准定位');
    const declared = parseDeclaredAnchors(positionCell);
    // 「标准定位」没有 § 的语料（CMAC 三页）退回「原文位置」里的 §；两处都没有才真的无条款单元。
    const refs = config.sectionRef === 'position-fallback' && parseSectionRefs(scopeCell).length === 0
      ? parseSectionRefs(positionCell)
      : parseSectionRefs(scopeCell);
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

  // SPEC-CARD（有的话）是第二种证据：它把原文片段按「空白归一化后的整段文本」钉哈希。
  // 本脚本顺带复算它，避免「锚点行区间还在、内容已经漂了」这种静默失效。
  // 允许用 `--spec-card <路径>` 指向一份副本：阴性对照要在「内容被改过」的卡片上跑，
  // 不能为了证明核对会开火去改仓库里的语料。
  const argv = process.argv.slice(2);
  const specCardArg = argv.indexOf('--spec-card');
  const specCardPath = specCardArg >= 0 ? argv[specCardArg + 1] : `${config.dir}/SPEC-CARD.json`;
  let specCard = null;
  if (existsSync(resolve(ROOT, specCardPath))) {
    const card = JSON.parse(readText(specCardPath));
    const checks = card.anchors.map((item) => {
      const [start, end] = item.line_range;
      const normalized = lines.slice(start - 1, end).join('\n').replace(/\s+/g, ' ').trim();
      const contained = clauseUnits.some((unit) => unit.anchorLevel === 'line'
        && unit.source.line_start <= start && end <= unit.source.line_end);
      return {
        id: item.id,
        line_range: item.line_range,
        quoteTextMatch: normalized === item.quote,
        quoteHashMatch: sha256(normalized) === item.quote_sha256,
        insideResolvedSpan: contained,
      };
    });
    specCard = {
      path: specCardPath,
      anchors: checks.length,
      quoteTextMatch: checks.filter((item) => item.quoteTextMatch).length,
      quoteHashMatch: checks.filter((item) => item.quoteHashMatch).length,
      insideResolvedSpan: checks.filter((item) => item.insideResolvedSpan).length,
      checks,
    };
  }

  const payload = {
    schemaVersion: 1,
    generatedBy: 'scripts/p4-anchors.mjs',
    scope: { standardId: config.id, entries: config.entries.length, note: config.note },
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
    ...(specCard ? { specCard } : {}),
  };
  const OUT = resolve(ROOT, config.out);
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`ANCHORS ok entries=${counts.entries} clauseUnits=${counts.clauseUnits} ` +
    `clickable=${counts.clauseUnitsClickable} sectionLevel=${counts.clauseUnitsSectionLevel} ` +
    `unresolved=${counts.clauseUnitsWithoutHeading} mismatch=${counts.entryAnchorMismatch} ` +
    `outsideSections=${counts.declaredOutsideSections}`);
  console.log(`ANCHORS source=${sourcePath} lines=${lines.length} sha256=${payload.source.sha256.slice(0, 12)}…`);
  if (specCard) {
    console.log(`ANCHORS specCard=${specCard.anchors} quoteText=${specCard.quoteTextMatch} ` +
      `quoteHash=${specCard.quoteHashMatch} insideSpan=${specCard.insideResolvedSpan}`);
  }
  console.log(`ANCHORS out=${OUT.replace(`${ROOT}/`, '')}`);
}

main();
