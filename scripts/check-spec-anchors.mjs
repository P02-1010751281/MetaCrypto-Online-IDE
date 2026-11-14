#!/usr/bin/env node
/**
 * SpecCard 锚点页签核门禁：把「这段引文在 PDF 第几页」变成可机器重算的断言。
 *
 * 卡片里的 `anchors[].pdf_pages` 一直是人手填的：`spec:validate` 只要求 `anchor_grade=A`
 * 时该字段非空，所以填哪一页都不会被任何脚本发现。本脚本重算两件事：
 *
 *   1. 提取稿自己的换页位置。`00-Standard-Source.md` 由 `pdftotext -layout` 生成，正文里保留
 *      了换页符（\f）。锚点 `line_range` 首行/末行落在第几页是确定的，卡片上写的
 *      `pdf_pages` 必须与这个区间逐页相同——多报一页、少报一页、顺序颠倒都判红。
 *   2. PDF 的真实页内容。用 `pdftotext -layout` 重新抽取同目录 PDF，规范化空白后把
 *      `pdf_pages` 所列各页按顺序拼起来，必须真的包含 `anchors[].quote`。提取稿与 PDF
 *      漂移、页码填错、引文被悄悄改写都会在这里暴露。
 *
 * 边界（写进 docs/guides/SPEC-CARDS.md，不要靠退出码越权声称）：
 *   - 核对的是**文本层**，不是页面图像。扫描件或字形失真由 `anchors[].known_defects` 记录，
 *     本门禁不替代人工目视版式。
 *   - 只证明「引文出现在这一页」，不证明「这一页就是标准第几节」——章节语义仍要人看。
 *   - 引文跨页时 `pdf_pages` 自然是相邻两页，此时按顺序拼接后再匹配。
 *
 * 依赖：poppler-utils 的 `pdftotext -layout`。缺工具时 fail closed，不静默跳过。
 *
 * 用法：
 *   node scripts/check-spec-anchors.mjs              # 校验 + 自检
 *   node scripts/check-spec-anchors.mjs --write      # 先核验再按提取稿回填 pdf_pages
 *   node scripts/check-spec-anchors.mjs --no-selftest
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readJson } from './lib/json-schema-lite.mjs';

const root = process.cwd();
const standardsRoot = resolve(root, 'docs/standards');
const CARD_FILENAME = 'SPEC-CARD.json';
const PAGE_BREAK = '\f';
const CARD_INDENT = 2;

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write');
const withSelftest = !args.has('--no-selftest');
const debugControls = args.has('--debug');

function normalizeWhitespace(value) {
  return value.replace(/\r\n/g, '\n').replace(/[\s\u00a0\u2028\u2029]+/g, ' ').trim();
}

function probeToolVersion() {
  const result = spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' });
  if (result.error) return null;
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = text.match(/pdftotext version (\S+)/);
  return match ? match[1] : 'unknown';
}

function discoverCards() {
  const cards = [];
  for (const item of readdirSync(standardsRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const candidate = resolve(standardsRoot, item.name, CARD_FILENAME);
    if (existsSync(candidate) && statSync(candidate).isFile()) cards.push(candidate);
  }
  return cards.sort();
}

const pdfCache = new Map();

/** 逐页抽取 PDF 文本层。`pdftotext` 每页输出后跟一个换页符，最后一段若只剩空白就是尾巴。 */
function extractPdf(file) {
  const cached = pdfCache.get(file);
  if (cached) return cached;
  const result = spawnSync('pdftotext', ['-layout', file, '-'], {
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw new Error(`无法执行 pdftotext：${result.error.message}`);
  if (result.status !== 0) throw new Error(`pdftotext exit=${result.status}：${(result.stderr || '').trim()}`);
  const parts = (result.stdout ?? '').split(PAGE_BREAK);
  const pageTexts = parts[parts.length - 1].trim() === '' ? parts.slice(0, -1) : parts;
  const payload = { pages: pageTexts.map(normalizeWhitespace), pageCount: pageTexts.length };
  pdfCache.set(file, payload);
  return payload;
}

function lineStartOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

/**
 * 行号 → PDF 物理页（1 起）。
 *
 * `-layout` 把换页符放在上一页末行的换行之后，所以换页符常常就是下一行的第一个字符；
 * 计数必须包含行首空白里的那个换页符，否则跨页首行会被算到上一页。
 */
function pageOfLine(text, offsets, lineNumber) {
  const start = offsets[lineNumber - 1];
  if (start === undefined) return null;
  const newline = text.indexOf('\n', start);
  const lineText = text.slice(start, newline === -1 ? text.length : newline);
  const indentation = lineText.length - lineText.replace(/^\s*/, '').length;
  let breaks = 0;
  for (let index = 0; index < start + indentation; index += 1) {
    if (text[index] === PAGE_BREAK) breaks += 1;
  }
  return breaks + 1;
}

function hintForMissingQuote(report, quote) {
  const head = quote.slice(0, 32);
  if (!head) return '';
  const hit = report.pages.findIndex((page) => page.includes(head));
  return hit === -1 ? '（连引文开头都不在这份 PDF 里）' : `（引文开头在第 ${hit + 1} 页）`;
}

function pdfArtifacts(card, baseDir) {
  return (card.standard?.artifacts || [])
    .filter((artifact) => /\.pdf$/i.test(artifact.path || ''))
    .map((artifact) => resolve(baseDir, artifact.path));
}

/** 由提取稿的换页符推出 line_range 覆盖的物理页区间。 */
function derivePages(anchor, cardDir, readSource) {
  const errors = [];
  if (!anchor.source) return { pages: null, errors: ['没有 source，无法定位换页位置'] };
  const sourceFile = resolve(cardDir, anchor.source);
  if (!existsSync(sourceFile)) return { pages: null, errors: [`source 不存在 ${anchor.source}`] };
  const text = readSource(sourceFile);
  const offsets = lineStartOffsets(text);
  const [start, end] = anchor.line_range || [];
  const startPage = pageOfLine(text, offsets, start);
  const endPage = pageOfLine(text, offsets, end);
  if (startPage === null || endPage === null) {
    return { pages: null, errors: [`line_range ${JSON.stringify(anchor.line_range)} 超出 ${anchor.source} 的行数`] };
  }
  if (startPage > endPage) {
    errors.push(`line_range 起点页 ${startPage} 大于终点页 ${endPage}`);
  }
  const pages = [];
  for (let page = startPage; page <= endPage; page += 1) pages.push(page);
  return { pages, errors };
}

/** 引文必须真的落在给定页上（多页按顺序拼接，覆盖跨页引文）。 */
function verifyQuoteOnPages(anchor, pages, pdfReports) {
  const quote = normalizeWhitespace(anchor.quote || '');
  if (!quote) return { errors: ['quote 为空'], verifiedBy: null };
  const candidates = [...pdfReports.entries()];
  if (!candidates.length) return { errors: [], verifiedBy: null, skipped: true };
  const failures = [];
  for (const [pdf, report] of candidates) {
    const local = [];
    for (const page of pages) {
      if (page > report.pageCount) {
        local.push(`${basename(pdf)} 只有 ${report.pageCount} 页，pdf_pages 里的第 ${page} 页不存在`);
      }
    }
    if (!local.length) {
      const joined = pages.map((page) => report.pages[page - 1]).join(' ');
      if (!joined.includes(quote)) {
        local.push(`引文未出现在 ${basename(pdf)} 第 ${pages.join(',')} 页${hintForMissingQuote(report, quote)}`);
      }
    }
    if (!local.length) return { errors: [], verifiedBy: basename(pdf) };
    failures.push(...local);
  }
  return { errors: failures, verifiedBy: null };
}

function checkAnchorPages(anchor, label, context) {
  const errors = [];
  const declared = Array.isArray(anchor.pdf_pages) ? [...anchor.pdf_pages] : null;
  const stat = { id: anchor.id, grade: anchor.anchor_grade, pages: declared, verified: false };
  const requiresPages = anchor.anchor_grade === 'A' || anchor.anchor_grade === 'B';
  if (!declared || !declared.length) {
    if (requiresPages) {
      errors.push(`${label}: anchor_grade=${anchor.anchor_grade} 必须给出 pdf_pages（npm run spec:anchors -- --write 可按提取稿回填）`);
    }
    return { errors, stat };
  }

  const shapeErrors = [];
  for (const [index, page] of declared.entries()) {
    if (!Number.isInteger(page)) shapeErrors.push(`${label}: pdf_pages[${index}] 必须是整数，实际 ${JSON.stringify(page)}`);
    else if (page < 1) shapeErrors.push(`${label}: pdf_pages[${index}] 必须从 1 起，实际 ${page}`);
  }
  if (shapeErrors.length) return { errors: [...errors, ...shapeErrors], stat };
  for (let index = 1; index < declared.length; index += 1) {
    if (declared[index] === declared[index - 1]) {
      errors.push(`${label}: pdf_pages 有重复页 ${declared[index]}`);
    } else if (declared[index] < declared[index - 1]) {
      errors.push(`${label}: pdf_pages 必须严格递增，实际 ${declared.join(',')}`);
    }
  }

  const pageCounts = [...context.pdfReports.values()].map((report) => report.pageCount);
  if (pageCounts.length) {
    const pageCount = Math.max(...pageCounts);
    for (const page of declared) {
      if (page > pageCount) errors.push(`${label}: PDF 只有 ${pageCount} 页，pdf_pages 里的第 ${page} 页不存在`);
    }
  }

  const derived = derivePages(anchor, context.cardDir, context.readSource);
  errors.push(...derived.errors);
  const derivedText = derived.pages ? derived.pages.join(',') : '?';
  if (derived.pages && derived.pages.join(',') !== declared.join(',')) {
    errors.push(
      `${label}: pdf_pages [${declared.join(',')}] 与提取稿换页位置不符（${anchor.source}:${(anchor.line_range || []).join('-')} 落在 PDF 第 ${derivedText} 页）`,
    );
  }

  const verified = verifyQuoteOnPages(anchor, declared, context.pdfReports);
  errors.push(...verified.errors.map((error) => `${label}: ${error}`));
  stat.verified = Boolean(verified.verifiedBy);
  return { errors, stat };
}

function checkCard(card, cardFile, context) {
  const errors = [];
  const cardDir = dirname(cardFile);
  const baseDir = resolve(cardDir, card.standard?.dir || '.');
  const pdfReports = new Map();
  const pdfs = pdfArtifacts(card, baseDir);
  if (!pdfs.length) errors.push('standard.artifacts: 卡片没有一个 PDF 制品，无法核对 pdf_pages');
  for (const pdf of pdfs) {
    if (!existsSync(pdf)) {
      errors.push(`standard.artifacts: PDF 不存在 ${relative(root, pdf)}`);
      continue;
    }
    try {
      pdfReports.set(pdf, extractPdf(pdf));
    } catch (error) {
      errors.push(`standard.artifacts: ${relative(root, pdf)} 抽取失败：${error.message}`);
    }
  }

  const local = { ...context, cardDir, pdfReports };
  const stats = [];
  for (const [index, anchor] of (card.anchors || []).entries()) {
    const result = checkAnchorPages(anchor, `anchors[${index}](${anchor.id})`, local);
    errors.push(...result.errors);
    stats.push(result.stat);
  }
  return { errors, stats, pdfReports };
}

function makeReadSource() {
  const cache = new Map();
  return (file) => {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    const text = readFileSync(file, 'utf8');
    cache.set(file, text);
    return text;
  };
}

function serializeCard(card) {
  return `${JSON.stringify(card, null, CARD_INDENT)}\n`;
}

/** --write：先按提取稿算出页区间并核验，通过了才写回卡片；不通过就一个字节都不改。 */
function writePages(card, cardFile, context) {
  const cardDir = dirname(cardFile);
  const baseDir = resolve(cardDir, card.standard?.dir || '.');
  const pdfReports = new Map();
  const skipped = [];
  for (const pdf of pdfArtifacts(card, baseDir)) {
    if (!existsSync(pdf)) {
      skipped.push(`${relative(root, pdf)} 不存在，跳过`);
      continue;
    }
    try {
      pdfReports.set(pdf, extractPdf(pdf));
    } catch (error) {
      // 抽取失败在 checkCard 里也会报一次；这里写明「为什么这一轮没写」，避免 --write 静默跳过。
      skipped.push(`${relative(root, pdf)} 抽取失败：${error.message}`);
    }
  }
  const local = { ...context, cardDir, pdfReports };
  const pending = [];
  for (const anchor of card.anchors || []) {
    const derived = derivePages(anchor, cardDir, local.readSource);
    if (!derived.pages) {
      skipped.push(`锚点 ${anchor.id} 无法定位换页位置：${derived.errors.join('；')}`);
      continue;
    }
    const verified = verifyQuoteOnPages(anchor, derived.pages, pdfReports);
    if (verified.errors.length) {
      skipped.push(`锚点 ${anchor.id} 引文未在 PDF 第 ${derived.pages.join(',')} 页核到，不写入`);
      continue;
    }
    const current = Array.isArray(anchor.pdf_pages) ? anchor.pdf_pages.join(',') : '';
    if (current !== derived.pages.join(',')) pending.push({ anchor, pages: derived.pages });
  }
  if (!pending.length) return { updated: 0, skipped };
  const before = serializeCard(card);
  for (const item of pending) item.anchor.pdf_pages = item.pages;
  const after = serializeCard(card);
  if (after !== before) writeFileSync(cardFile, after, 'utf-8');
  return { updated: pending.length, skipped };
}

const NEGATIVE_CONTROLS = [
  ['pages-missing', (card) => { delete card.anchors[0].pdf_pages; }, /必须给出 pdf_pages/],
  ['pages-not-integer', (card) => { card.anchors[0].pdf_pages = ['12']; }, /必须是整数/],
  ['pages-out-of-range', (card, ctx) => { card.anchors[0].pdf_pages = [ctx.pageCount + 1]; }, /只有 .* 页|不存在/],
  ['pages-unsorted', (card, ctx) => { card.anchors[0].pdf_pages = [ctx.other, ctx.startPage]; }, /严格递增|重复|不符/],
  ['pages-duplicate', (card, ctx) => { card.anchors[0].pdf_pages = [ctx.startPage, ctx.startPage]; }, /重复|递增/],
  ['pages-too-wide', (card, ctx) => { card.anchors[0].pdf_pages = ctx.wider; }, /与提取稿换页位置不符/],
  ['pages-shifted', (card, ctx) => { card.anchors[0].pdf_pages = [ctx.other]; }, /与提取稿换页位置不符/],
  ['line-range-drift', (card, ctx) => { card.anchors[0].line_range = ctx.driftRange; }, /与提取稿换页位置不符/],
  ['pdf-missing', (card) => { card.standard.artifacts[0].path = 'NIST-SP-DOES-NOT-EXIST.pdf'; }, /PDF 不存在/],
  ['pdf-none', (card) => { card.standard.artifacts = []; }, /没有一个 PDF 制品/],
];

function runSelftest(card, cardFile, context) {
  const outcomes = [];
  const clone = () => JSON.parse(JSON.stringify(card));
  const baseline = checkCard(clone(), cardFile, context);
  outcomes.push(['positive-control', baseline.errors.length === 0, baseline.errors[0] ?? '']);

  const first = card.anchors[0];
  const startPage = first.pdf_pages[0];
  const pageCount = Math.max(...[...baseline.pdfReports.values()].map((report) => report.pageCount));
  const other = startPage < pageCount ? startPage + 1 : startPage - 1;
  const wider = [Math.min(startPage, other), Math.max(startPage, other)].sort((left, right) => left - right);
  const sourceFile = resolve(dirname(cardFile), first.source);
  const text = context.readSource(sourceFile);
  const offsets = lineStartOffsets(text);
  // 漂移取「引用区间之后最近的一次换页」，比跳回文件开头更接近真实误填。
  let driftLine = null;
  for (let line = (first.line_range?.[1] ?? 1) + 1; line <= offsets.length; line += 1) {
    if (pageOfLine(text, offsets, line) !== startPage) {
      driftLine = line;
      break;
    }
  }
  for (let line = (first.line_range?.[0] ?? 1) - 1; line >= 1 && driftLine === null; line -= 1) {
    if (pageOfLine(text, offsets, line) !== startPage) driftLine = line;
  }
  if (driftLine === null) driftLine = 1;
  const driftRange = [driftLine, driftLine + 1];
  const shape = { startPage, pageCount, other, wider, driftRange };

  for (const [name, mutate, pattern] of NEGATIVE_CONTROLS) {
    const mutated = clone();
    try {
      mutate(mutated, shape);
    } catch (error) {
      outcomes.push([name, false, `变异无法施加：${error.message}`]);
      continue;
    }
    const outcome = checkCard(mutated, cardFile, context);
    const hit = outcome.errors.find((error) => pattern.test(error));
    outcomes.push([name, Boolean(hit), hit ?? (outcome.errors[0] ?? '变异后仍然通过，门禁未开火')]);
  }
  return outcomes;
}

function main() {
  const toolVersion = probeToolVersion();
  if (!toolVersion) {
    console.error('SPEC_ANCHOR_ERROR 缺少 pdftotext（poppler-utils）：本门禁核对 PDF 物理页，缺工具时 fail closed，不静默跳过');
    process.exit(1);
  }
  const context = { readSource: makeReadSource() };
  const cards = discoverCards();
  if (!cards.length) {
    console.error(`SPEC_ANCHOR_ERROR 未找到任何 ${CARD_FILENAME}`);
    process.exit(1);
  }

  let totalErrors = 0;
  let anchorCount = 0;
  let verifiedCount = 0;
  let gradeACount = 0;
  const citedPages = new Set();
  const clean = [];

  for (const cardFile of cards) {
    const label = relative(root, cardFile);
    let card;
    try {
      card = readJson(cardFile);
    } catch (error) {
      console.error(`SPEC_ANCHOR_ERROR ${label}: JSON 解析失败：${error.message}`);
      totalErrors += 1;
      continue;
    }
    if (writeMode) {
      const written = writePages(card, cardFile, context);
      for (const reason of written.skipped) console.error(`SPEC_ANCHOR_WRITE_SKIP ${label}: ${reason}`);
      if (written.updated) {
        console.log(`SPEC_ANCHOR_WRITE ${label} updated=${written.updated}`);
        card = readJson(cardFile);
      }
    }
    const { errors, stats } = checkCard(card, cardFile, context);
    for (const error of errors) console.error(`SPEC_ANCHOR_ERROR ${label}: ${error}`);
    totalErrors += errors.length;
    anchorCount += stats.length;
    verifiedCount += stats.filter((stat) => stat.verified).length;
    gradeACount += stats.filter((stat) => stat.grade === 'A').length;
    for (const stat of stats) for (const page of stat.pages || []) citedPages.add(page);
    if (!errors.length) clean.push({ card, cardFile });
    const pages = [...new Set(stats.flatMap((stat) => stat.pages || []))].sort((left, right) => left - right);
    console.log(
      `SPEC_ANCHOR card=${card.id} anchors=${stats.length} grade_a=${stats.filter((stat) => stat.grade === 'A').length} verified=${stats.filter((stat) => stat.verified).length} pages=${pages.join(',') || '-'} errors=${errors.length}`,
    );
  }

  if (!totalErrors && withSelftest) {
    if (!clean.length) {
      console.error('SPEC_ANCHOR_SELFTEST skipped=no-clean-card');
    } else {
      const outcomes = runSelftest(clean[0].card, clean[0].cardFile, context);
      for (const [name, ok, detail] of outcomes) {
        if (debugControls) console.log(`SPEC_ANCHOR_CONTROL ${name} ok=${ok} => ${detail}`);
        if (!ok) console.error(`SPEC_ANCHOR_SELFTEST_ERROR ${name}: ${detail}`);
      }
      const fired = outcomes.filter(([, ok]) => ok).length;
      if (fired === outcomes.length) console.log(`SPEC_ANCHOR_SELFTEST controls=${outcomes.length} fired=${fired}`);
      else totalErrors += outcomes.length - fired;
    }
  } else if (withSelftest && !writeMode) {
    console.log('SPEC_ANCHOR_SELFTEST skipped=card-errors');
  }

  console.log(
    `SPEC_ANCHOR_SUMMARY cards=${cards.length} anchors=${anchorCount} grade_a=${gradeACount} verified=${verifiedCount} pages=${citedPages.size} tool=pdftotext/${toolVersion} errors=${totalErrors}`,
  );
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
