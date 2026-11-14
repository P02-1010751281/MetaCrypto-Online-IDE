/**
 * SpecCard 门禁：把「标准说了一句什么」变成可机器复核的断言。
 *
 * 卡片位置：docs/standards/<标准目录>/SPEC-CARD.json（schema 见 scripts/spec-card.schema.json）。
 *
 * 本脚本重算三类事实，卡片自己说的不算数：
 *   1. 制品哈希：standard.artifacts[].sha256 必须与磁盘文件逐字节一致；
 *   2. 引文锚点：anchors[].quote 规范化空白后必须真的出现在 source 的 line_range 里，
 *      且 anchors[].quote_sha256 与重新计算的摘要一致（防止引文被悄悄改写）；
 *   3. 块与类型引用：entries[].blocks.existing 必须是 BLOCK-IO-CONTRACT.json 里的真实块，
 *      端口类型必须是契约里实际出现过的 check 标签。
 *
 * 另外两条纪律性检查：
 *   - fidelity=verbatim / text-layer 的张量必须与锚点引文逐字一致（text-layer 还要列出 known_defects）；
 *   - anchor_grade=A 必须给 PDF 物理页，否则只能标 B。
 *
 * 每轮都会跑自检（负控变异必须让门禁变红）。门禁自己能开火才算门禁。
 *
 * 用法：
 *   node scripts/check-spec-cards.mjs            # 校验并自检
 *   node scripts/check-spec-cards.mjs --no-selftest
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { readJson, validateSchema } from './lib/json-schema-lite.mjs';

const root = process.cwd();
const schemaPath = resolve(root, 'scripts/spec-card.schema.json');
const standardsRoot = resolve(root, 'docs/standards');
const contractPath = resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const CARD_FILENAME = 'SPEC-CARD.json';

const args = new Set(process.argv.slice(2));
const runSelftest = !args.has('--no-selftest');

function normalizeWhitespace(value) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\s\u00a0\u2028\u2029]+/g, ' ')
    .trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function discoverCards() {
  const cards = [];
  for (const item of readdirSync(standardsRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const candidate = join(standardsRoot, item.name, CARD_FILENAME);
    if (existsSync(candidate) && statSync(candidate).isFile()) cards.push(candidate);
  }
  return cards.sort();
}

function collectContractFacts() {
  const contract = readJson(contractPath);
  const blockTypes = new Set(Object.keys(contract));
  const checkLabels = new Set();
  for (const block of Object.values(contract)) {
    for (const port of block.inputs || []) {
      for (const label of port.check || []) checkLabels.add(label);
    }
    for (const label of block.outputCheck || []) checkLabels.add(label);
  }
  return { blockTypes, checkLabels };
}

function hintForMissingQuote(window, quote) {
  const head = quote.slice(0, 24);
  if (!head) return '';
  const index = window.indexOf(head);
  return index === -1 ? '（连引文开头都不在范围内）' : `（引文开头命中，第 ${index} 字符后开始分歧）`;
}

function checkCard(card, cardFile, context) {
  const errors = [];
  validateSchema(card, context.schema, '', context.schema.$defs, errors);
  if (errors.length) return errors;

  const cardDir = dirname(cardFile);
  const baseDir = resolve(cardDir, card.standard.dir);
  if (!existsSync(baseDir)) errors.push(`standard.dir: 目录不存在 ${relative(root, baseDir)}`);

  for (const [index, artifact] of card.standard.artifacts.entries()) {
    const label = `standard.artifacts[${index}]`;
    const file = resolve(baseDir, artifact.path);
    if (!existsSync(file)) {
      errors.push(`${label}: 制品不存在 ${relative(root, file)}`);
      continue;
    }
    const digest = sha256(readFileSync(file));
    if (digest !== artifact.sha256) {
      errors.push(`${label}: SHA-256 不符 ${artifact.path}（磁盘 ${digest.slice(0, 16)}… / 卡上 ${artifact.sha256.slice(0, 16)}…）`);
    }
  }

  const anchorsById = new Map();
  for (const [index, anchor] of card.anchors.entries()) {
    const label = `anchors[${index}](${anchor.id})`;
    if (anchorsById.has(anchor.id)) errors.push(`${label}: id 重复`);
    anchorsById.set(anchor.id, anchor);

    if (/\.pdf$/i.test(anchor.source)) {
      errors.push(`${label}: source 必须是文本层提取稿，不能直接指向 PDF`);
      continue;
    }
    const sourceFile = resolve(cardDir, anchor.source);
    if (!existsSync(sourceFile)) {
      errors.push(`${label}: source 不存在 ${anchor.source}`);
      continue;
    }
    const lines = readFileSync(sourceFile, 'utf8').split('\n');
    const [start, end] = anchor.line_range;
    if (start > end) errors.push(`${label}: line_range 起点大于终点`);
    if (end > lines.length) {
      errors.push(`${label}: line_range 超出文件长度 ${lines.length}`);
    } else if (start <= end) {
      const window = normalizeWhitespace(lines.slice(start - 1, end).join('\n'));
      const quote = normalizeWhitespace(anchor.quote);
      if (!window.includes(quote)) {
        errors.push(`${label}: 引文未出现在 ${anchor.source}:${start}-${end} ${hintForMissingQuote(window, quote)}`);
      }
    }

    const expectedHash = sha256(normalizeWhitespace(anchor.quote));
    if (anchor.quote_sha256 !== expectedHash) {
      errors.push(`${label}: quote_sha256 与规范化引文不符（卡上 ${anchor.quote_sha256.slice(0, 16)}… / 实数 ${expectedHash.slice(0, 16)}…）`);
    }
    if (anchor.anchor_grade === 'A' && !(anchor.pdf_pages || []).length) {
      errors.push(`${label}: anchor_grade=A 必须给出 pdf_pages，否则只能标 B`);
    }
  }

  const entryKeys = new Set();
  for (const [index, entry] of card.entries.entries()) {
    const label = `entries[${index}](${entry.key})`;
    if (entryKeys.has(entry.key)) errors.push(`${label}: key 重复`);
    entryKeys.add(entry.key);

    for (const port of [...(entry.io.inputs || []), ...(entry.io.outputs || [])]) {
      if (port.type !== 'Any' && !context.checkLabels.has(port.type)) {
        errors.push(`${label}: 端口类型 ${port.type} 不在 BLOCK-IO-CONTRACT.json 的 check 标签里`);
      }
    }
    for (const block of entry.blocks?.existing || []) {
      if (!context.blockTypes.has(block)) errors.push(`${label}: 块 ${block} 不在 BLOCK-IO-CONTRACT.json 中`);
    }

    const pseudocode = entry.pseudocode;
    if (pseudocode.fidelity !== 'paraphrase') {
      const anchor = anchorsById.get(pseudocode.anchor);
      if (!anchor) {
        errors.push(`${label}: fidelity=${pseudocode.fidelity} 必须引用已定义的锚点，实际 ${JSON.stringify(pseudocode.anchor)}`);
      } else if (normalizeWhitespace(pseudocode.text) !== normalizeWhitespace(anchor.quote)) {
        errors.push(`${label}: fidelity=${pseudocode.fidelity} 要求 text 与锚点 ${anchor.id} 逐字一致（规范化空白后）`);
      }
      if (pseudocode.fidelity === 'text-layer' && !(pseudocode.known_defects || []).length) {
        errors.push(`${label}: fidelity=text-layer 必须列出 known_defects`);
      }
    }
    if (entry.vectors?.status === 'wired' && !entry.vectors.detail) {
      errors.push(`${label}: vectors.status=wired 必须在 detail 写出回归入口`);
    }
  }

  // 拆解层级：composes 必须引用同卡条目、子级严格更低、整体无环（对应 §4.3.1 的粒度阶梯）。
  const LEVEL_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'];
  const entriesByKey = new Map(card.entries.map((entry) => [entry.key, entry]));
  for (const entry of card.entries) {
    const children = entry.composes || [];
    if (!children.length) continue;
    const label = `entries(${entry.key})`;
    if (!entry.level) {
      errors.push(`${label}: 声明 composes 必须同时声明 level，否则无法判定拆解到哪一级`);
      continue;
    }
    for (const child of children) {
      if (child === entry.key) {
        errors.push(`${label}: composes 不能引用自身`);
        continue;
      }
      const target = entriesByKey.get(child);
      if (!target) {
        errors.push(`${label}: composes 引用了本卡不存在的条目 ${child}`);
        continue;
      }
      if (!target.level) {
        errors.push(`${label}: 子条目 ${child} 未声明 level`);
      } else if (LEVEL_ORDER.indexOf(target.level) >= LEVEL_ORDER.indexOf(entry.level)) {
        errors.push(`${label}: 子条目 ${child} 的 level ${target.level} 必须严格低于 ${entry.level}`);
      }
    }
  }
  const visitState = new Map();
  const visitComposes = (key, stack) => {
    if (visitState.get(key) === 'done') return;
    if (visitState.get(key) === 'visiting') {
      errors.push(`entries: composes 出现环 ${[...stack, key].join(' → ')}`);
      return;
    }
    visitState.set(key, 'visiting');
    for (const child of entriesByKey.get(key)?.composes || []) {
      if (entriesByKey.has(child)) visitComposes(child, [...stack, key]);
    }
    visitState.set(key, 'done');
  };
  for (const entry of card.entries) visitComposes(entry.key, []);

  if (card.provenance.extracted_by.kind === 'llm' && !card.provenance.extracted_by.model) {
    errors.push('provenance.extracted_by: kind=llm 必须写 model');
  }
  const review = card.provenance.review;
  if (review.status === 'reviewed') {
    if (!review.by?.name) errors.push('provenance.review: status=reviewed 必须写 by.name');
    if (!review.by?.at) errors.push('provenance.review: status=reviewed 必须写 by.at');
  } else if (review.by) {
    errors.push('provenance.review: status=draft 不应写 by（未审的卡不能看起来已签核）');
  }

  return errors;
}

/** 负控：每个变异都必须让 checkCard 报错，否则门禁是纸糊的。 */
const NEGATIVE_CONTROLS = [
  ['anchor-quote-typo', (card) => {
    const anchor = card.anchors[0];
    anchor.quote = `${anchor.quote.slice(0, 5)}X${anchor.quote.slice(6)}`;
  }],
  ['anchor-quote-hash', (card) => {
    const anchor = card.anchors[0];
    anchor.quote_sha256 = (anchor.quote_sha256[0] === '0' ? '1' : '0') + anchor.quote_sha256.slice(1);
  }],
  ['anchor-lines-out-of-range', (card) => {
    card.anchors[0].line_range = [1, 999999];
  }],
  ['anchor-grade-a-without-pages', (card) => {
    delete card.anchors[0].pdf_pages;
    card.anchors[0].anchor_grade = 'A';
  }],
  ['artifact-hash', (card) => {
    const artifact = card.standard.artifacts[0];
    artifact.sha256 = (artifact.sha256[0] === '0' ? '1' : '0') + artifact.sha256.slice(1);
  }],
  ['verbatim-text-mismatch', (card) => {
    const entry = card.entries.find((item) => item.pseudocode.fidelity !== 'paraphrase');
    entry.pseudocode.text = '1. Let L = 0^b.';
  }],
  ['unknown-block', (card) => {
    const entry = card.entries[0];
    entry.blocks = { existing: [...(entry.blocks?.existing || []), 'cmac_not_a_real_block'] };
  }],
  ['reviewed-without-reviewer', (card) => {
    card.provenance.review = { status: 'reviewed' };
  }],
  ['composes-missing-target', (card) => {
    card.entries[0].composes = ['cmac_does_not_exist'];
  }],
  ['composes-self', (card) => {
    card.entries[0].composes = [card.entries[0].key];
    card.entries[0].level = 'L2';
  }],
  ['composes-level-not-lower', (card) => {
    card.entries[0].level = 'L2';
    card.entries[0].composes = [card.entries[1].key];
    card.entries[1].level = 'L2';
  }],
  ['composes-cycle', (card) => {
    card.entries[0].level = 'L3';
    card.entries[1].level = 'L2';
    card.entries[0].composes = [card.entries[1].key];
    card.entries[1].composes = [card.entries[0].key];
  }],
];

function runSelfTest(card, cardFile, context) {
  let fired = 0;
  const failures = [];
  for (const [name, mutate] of NEGATIVE_CONTROLS) {
    const clone = JSON.parse(JSON.stringify(card));
    try {
      mutate(clone);
    } catch (error) {
      failures.push(`${name}: 变异无法施加（${error.message}），该负控无效`);
      continue;
    }
    const errors = checkCard(clone, cardFile, context);
    if (errors.length) fired += 1;
    else failures.push(`${name}: 变异后仍然通过，门禁未开火`);
  }
  return { total: NEGATIVE_CONTROLS.length, fired, failures };
}

function main() {
  const schema = readJson(schemaPath);
  const context = { schema, ...collectContractFacts() };
  const cards = discoverCards();
  if (!cards.length) {
    console.error(`SPEC_CARD_ERROR 未找到任何 ${CARD_FILENAME}（docs/standards/*/）`);
    process.exit(1);
  }

  let totalErrors = 0;
  let anchorCount = 0;
  let entryCount = 0;
  let artifactCount = 0;
  for (const cardFile of cards) {
    const label = relative(root, cardFile);
    let card;
    try {
      card = readJson(cardFile);
    } catch (error) {
      console.error(`SPEC_CARD_ERROR ${label}: JSON 解析失败：${error.message}`);
      totalErrors += 1;
      continue;
    }
    const errors = checkCard(card, cardFile, context);
    for (const error of errors) console.error(`SPEC_CARD_ERROR ${label}: ${error}`);
    totalErrors += errors.length;
    anchorCount += card.anchors?.length || 0;
    entryCount += card.entries?.length || 0;
    artifactCount += card.standard?.artifacts?.length || 0;
  }

  if (totalErrors === 0 && runSelftest) {
    const firstCard = readJson(cards[0]);
    const result = runSelfTest(firstCard, cards[0], context);
    for (const failure of result.failures) console.error(`SPEC_CARD_SELFTEST_ERROR ${failure}`);
    if (result.failures.length) totalErrors += result.failures.length;
    else console.log(`SPEC_CARD_SELFTEST controls=${result.total} fired=${result.fired}`);
  }

  console.log(
    `SPEC_CARD_SUMMARY cards=${cards.length} anchors=${anchorCount} entries=${entryCount} artifacts=${artifactCount} errors=${totalErrors}`,
  );
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
