#!/usr/bin/env node
/**
 * 规格卡生产者入口 · 第一步（只读）：把卡片里的缺口算成可执行的工作项。
 *
 * 只读设计：不写文件、不调用模型、不改卡片，也不替任何判定背书。它只回答
 * 「这张卡离可产出候选还差什么」，缺口分四类：
 *
 *   - register-block ：条目引用的积木不在 BLOCK-IO-CONTRACT.json（卡与代码脱节）
 *   - implement-block：条目声明为 planned 的积木
 *   - wire-vectors   ：条目 vectors.status 不是 wired
 *   - refine-anchor  ：锚点缺 quote_sha256 或 line_range
 *
 * 「已注册积木」以 docs/blocks/BLOCK-IO-CONTRACT.json 的键为准：该文件由
 * `npm run block-io:write` 从真实块定义生成，verify:all 会校验它与代码一致。
 *
 * 用法：
 *   npm run spec:plan -- sp800-38b-cmac   指定一张卡
 *   npm run spec:plan -- --all            全部卡
 *   npm run spec:plan -- --all --json     机器可读
 *
 * 退出码：0 = 计划已产出（缺口不是错误）；1 = 卡片/契约读不出。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const standardsRoot = resolve(root, 'docs/standards');
const contractPath = resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const CARD_FILENAME = 'SPEC-CARD.json';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadRegisteredBlocks() {
  if (!existsSync(contractPath)) {
    throw new Error(`缺少 ${relative(root, contractPath)}（用 \`npm run block-io:write\` 生成）`);
  }
  return new Set(Object.keys(readJson(contractPath)));
}

function discoverCards() {
  const cards = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (name === CARD_FILENAME) cards.push(full);
    }
  };
  walk(standardsRoot);
  return cards.sort();
}

/** 把一张卡算成工作项；不做任何判定，只做差集。 */
function planCard(card, cardFile, registered) {
  const entries = Array.isArray(card.entries) ? card.entries : [];
  const anchors = Array.isArray(card.anchors) ? card.anchors : [];
  const work = [];
  let registeredHits = 0;
  let unregistered = 0;
  let planned = 0;
  let vectorsOpen = 0;

  for (const entry of entries) {
    const existing = Array.isArray(entry.blocks?.existing) ? entry.blocks.existing : [];
    const plannedBlocks = Array.isArray(entry.blocks?.planned) ? entry.blocks.planned : [];
    for (const type of existing) {
      if (registered.has(type)) {
        registeredHits += 1;
        continue;
      }
      unregistered += 1;
      work.push({ kind: 'register-block', entry: entry.key, block: type });
    }
    for (const type of plannedBlocks) {
      planned += 1;
      work.push({ kind: 'implement-block', entry: entry.key, block: type });
    }
    const status = entry.vectors?.status ?? 'missing';
    if (status !== 'wired') {
      vectorsOpen += 1;
      work.push({ kind: 'wire-vectors', entry: entry.key, block: null, detail: status });
    }
  }

  let anchorsOpen = 0;
  for (const anchor of anchors) {
    if (anchor.quote_sha256 && Array.isArray(anchor.line_range)) continue;
    anchorsOpen += 1;
    work.push({
      kind: 'refine-anchor',
      entry: anchor.id,
      block: null,
      detail: !anchor.quote_sha256 ? 'quote_sha256 缺失' : 'line_range 缺失',
    });
  }

  return {
    card: card.id ?? relative(standardsRoot, cardFile),
    entries: entries.length,
    anchors: anchors.length,
    registered: registeredHits,
    unregistered,
    planned,
    vectorsOpen,
    anchorsOpen,
    gaps: work.length,
    work,
  };
}

function formatHuman(plans) {
  const lines = [];
  for (const plan of plans) {
    lines.push(
      `SPEC_PLAN card=${plan.card} entries=${plan.entries} anchors=${plan.anchors} ` +
        `registered=${plan.registered} unregistered=${plan.unregistered} planned=${plan.planned} ` +
        `vectors_open=${plan.vectorsOpen} anchors_open=${plan.anchorsOpen} gaps=${plan.gaps}`,
    );
    for (const item of plan.work) {
      const target = item.block ? `${item.entry} -> ${item.block}` : item.entry;
      lines.push(`  GAP ${item.kind} ${target}${item.detail ? ` (${item.detail})` : ''}`);
    }
  }
  const total = plans.reduce((sum, plan) => sum + plan.gaps, 0);
  lines.push(`SPEC_PLAN_SUMMARY cards=${plans.length} gaps=${total}`);
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const ids = argv.filter((arg) => !arg.startsWith('--'));
  const all = argv.includes('--all');

  if (!all && ids.length === 0) {
    console.error('用法: node scripts/spec-plan.mjs <card-id>... | --all [--json]');
    process.exit(2);
  }

  let registered;
  let cardFiles;
  try {
    registered = loadRegisteredBlocks();
    cardFiles = discoverCards();
  } catch (error) {
    console.error(`SPEC_PLAN_ERROR ${error.message}`);
    process.exit(1);
  }
  if (cardFiles.length === 0) {
    console.error(`SPEC_PLAN_ERROR 在 ${relative(root, standardsRoot)} 下没有找到 ${CARD_FILENAME}`);
    process.exit(1);
  }

  const wanted = new Map();
  for (const file of cardFiles) {
    try {
      const card = readJson(file);
      if (card && typeof card === 'object') wanted.set(String(card.id ?? relative(standardsRoot, file)), { card, file });
    } catch (error) {
      console.error(`SPEC_PLAN_ERROR 无法读取 ${relative(root, file)}: ${error.message}`);
      process.exit(1);
    }
  }

  const selected = all ? [...wanted.entries()] : ids.map((id) => [id, wanted.get(id)]);
  const missing = selected.filter(([, hit]) => !hit).map(([id]) => id);
  if (missing.length > 0) {
    console.error(`SPEC_PLAN_ERROR 找不到卡片: ${missing.join(', ')}`);
    process.exit(1);
  }

  const plans = selected.map(([, hit]) => planCard(hit.card, hit.file, registered));
  console.log(asJson ? JSON.stringify(plans, null, 2) : formatHuman(plans));
}

main();
