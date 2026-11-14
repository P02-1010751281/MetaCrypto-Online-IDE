#!/usr/bin/env node
/**
 * 规格卡对照表生成器：把「卡片条目 → 声明的积木 → 真正执行它的 Demo/过程」摊平成一张表。
 *
 * 为什么需要它：三张卡各自声明了条目、积木与 vectors 状态，但「这个条目到底被哪个
 * 工作区执行过」只写在 vectors.detail 的散文里。散文不能复核，也不能被门禁比对。
 * 本脚本只做确定性连接：
 *
 *   - 条目 → 积木：取卡片 entries[].blocks.existing（卡自己声明的）；
 *   - 积木 → Demo：遍历 demos/tests.json 登记的 60 个工作区，直接递归 Blockly
 *     工作区 JSON，收集块类型与过程名；
 *   - 条目 → 运行清单：spec-runs/<run-id>/manifest.json 的 outputs 里出现该卡片即视为冻结；
 *   - 积木是否存在：以 docs/blocks/BLOCK-IO-CONTRACT.json 的键为准。
 *
 * 它不判定任何东西：不判断条目实现是否与标准一致、不判断向量是否来自官方测试集、
 * 也不把「有 Demo 覆盖」说成「已验证」。Gap 表只是把差集写出来，判定仍归
 * spec:validate / spec:plan / spec:candidates。
 *
 * 用法：
 *   node scripts/generate-spec-matrix.mjs          # 只检查（verify:all 用这个）
 *   node scripts/generate-spec-matrix.mjs --write  # 写盘
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const standardsRoot = resolve(root, 'docs/standards');
const contractPath = resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const testsPath = resolve(root, 'demos/tests.json');
const runsRoot = resolve(root, 'spec-runs');
const outPath = resolve(standardsRoot, 'SPEC-CARD-MATRIX.md');
const writeMode = process.argv.includes('--write');

const CARD_FILENAME = 'SPEC-CARD.json';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function code(value) {
  return `\`${value}\``;
}

export function discoverCards() {
  const cards = [];
  for (const name of readdirSync(standardsRoot)) {
    const dir = join(standardsRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    const cardPath = join(dir, CARD_FILENAME);
    if (!existsSync(cardPath)) continue;
    cards.push({ dir: name, cardPath, card: readJson(cardPath) });
  }
  return cards.sort((left, right) => left.dir.localeCompare(right.dir));
}

/** 把每个登记 Demo 拆成「用到的块类型 + 定义的过程名」。 */
export function loadDemos() {
  const registry = readJson(testsPath);
  const demos = [];
  for (const file of Object.keys(registry).sort()) {
    const workspacePath = resolve(root, 'demos', file);
    if (!existsSync(workspacePath)) throw new Error(`demos/tests.json 登记了不存在的工作区：demos/${file}`);
    const doc = readJson(workspacePath);
    const types = new Set();
    const procedures = [];
    // Blockly 工作区里输入槽与 next 都是 {"block": …} 包装；这里统一剥一层再递归。
    const child = (value) => (value && typeof value === 'object' && 'block' in value ? value.block : value);
    const visit = (node, body) => {
      if (!node || typeof node !== 'object') return;
      if (node.type) {
        types.add(node.type);
        if (body) body.add(node.type);
      }
      if (node.next) visit(child(node.next), body);
      for (const value of Object.values(node.inputs || {})) visit(child(value), body);
    };
    for (const node of doc.blocks.blocks) {
      // 每个顶层 procedures_def* 节点连同它的子槽构成一个过程体；过程名取自 NAME 字段。
      if (node.type?.startsWith('procedures_def')) {
        const name = node.fields?.NAME;
        if (name) {
          const body = new Set();
          visit(node, body);
          procedures.push({ name, types: [...body] });
        }
        continue;
      }
      visit(node, null);
    }
    demos.push({ file, types, procedures });
  }
  return demos;
}

/** 运行清单：哪些 run 冻结了哪张卡。 */
export function loadRuns() {
  if (!existsSync(runsRoot)) return [];
  const runs = [];
  for (const name of readdirSync(runsRoot).sort()) {
    const manifestPath = join(runsRoot, name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const outputs = (manifest.outputs || []).map((item) => item.path);
    runs.push({ runId: manifest.run_id ?? name, outputs, decision: manifest.decision ?? '' });
  }
  return runs;
}

export function loadContract() {
  if (!existsSync(contractPath)) throw new Error('缺少 docs/blocks/BLOCK-IO-CONTRACT.json（npm run block-io:write 生成）');
  return new Set(Object.keys(readJson(contractPath)));
}

/** 纯函数：把四份数据渲染成对照表，并返回统计与缺口。 */
export function buildMatrix({ cards, demos, runs, contract }) {
  const cardRows = [];
  const entryRows = [];
  const gaps = [];
  const entryBlocks = new Set();

  for (const { dir, cardPath, card } of cards) {
    const cardRel = relative(root, cardPath);
    const anchors = Array.isArray(card.anchors) ? card.anchors : [];
    const gradeA = anchors.filter((anchor) => anchor.anchor_grade === 'A').length;
    const frozen = runs.filter((run) => run.outputs.includes(cardRel)).map((run) => run.runId);
    cardRows.push({
      id: card.id ?? dir,
      standard: [card.standard?.name, card.standard?.version]
        .filter(Boolean)
        .filter((part, index, list) => index === 0 || !String(list[0]).includes(String(part)))
        .join(' '),
      anchors: `${gradeA}/${anchors.length}`,
      entries: (card.entries || []).length,
      artifacts: (card.standard?.artifacts || []).length,
      review: card.provenance?.review?.status ?? 'missing',
      frozen: frozen.length ? frozen.map(code).join('、') : '未登记',
    });

    for (const entry of card.entries || []) {
      const declared = Array.isArray(entry.blocks?.existing) ? entry.blocks.existing : [];
      const planned = Array.isArray(entry.blocks?.planned) ? entry.blocks.planned : [];
      declared.forEach((type) => entryBlocks.add(type));

      const full = demos.filter((demo) => declared.length > 0 && declared.every((type) => demo.types.has(type)));
      const dedicated = [];
      for (const demo of demos) {
        for (const procedure of demo.procedures) {
          const covered = declared.filter((type) => procedure.types.includes(type));
          if (covered.length) dedicated.push({ demo: demo.file, name: procedure.name, covered });
        }
      }

      const unregistered = declared.filter((type) => !contract.has(type));
      const inNoDemo = declared.filter((type) => !demos.some((demo) => demo.types.has(type)));
      const status = entry.vectors?.status ?? 'missing';

      entryRows.push({
        card: card.id ?? dir,
        key: entry.key,
        type: entry.type ?? '',
        level: entry.level ?? '',
        normative: entry.normative_level ?? '',
        declared,
        full: full.map((demo) => demo.file),
        dedicated,
        status,
        unregistered,
        planned,
      });

      for (const type of unregistered) {
        gaps.push({ card: card.id ?? dir, entry: entry.key, kind: '契约缺失', detail: `${code(type)} 不在 BLOCK-IO-CONTRACT.json` });
      }
      for (const type of inNoDemo) {
        gaps.push({ card: card.id ?? dir, entry: entry.key, kind: 'Demo 未使用', detail: `${code(type)} 未被任何登记 Demo 使用` });
      }
      if (full.length === 0) {
        gaps.push({
          card: card.id ?? dir,
          entry: entry.key,
          kind: '无完整覆盖工作区',
          detail: declared.length ? `声明积木 ${declared.map(code).join(' ')} 未同时出现在同一 Demo` : '条目未声明现有积木',
        });
      }
      if (dedicated.length === 0) {
        gaps.push({ card: card.id ?? dir, entry: entry.key, kind: '无过程执行', detail: '没有任何 Demo 过程的块树里出现该条目声明的积木' });
      }
      if (status !== 'wired') {
        gaps.push({ card: card.id ?? dir, entry: entry.key, kind: '向量未接线', detail: `vectors.status=${status}` });
      }
      if (entry.level && entry.composes) {
        const childLevels = entry.composes
          .map((childKey) => (card.entries || []).find((candidate) => candidate.key === childKey)?.level)
          .filter(Boolean);
        const order = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
        if (childLevels.some((child) => order[child] >= order[entry.level])) {
          gaps.push({ card: card.id ?? dir, entry: entry.key, kind: '粒度倒置', detail: `子级 ${childLevels.join('、')} 不低于父级 ${entry.level}` });
        }
      }
    }
  }

  const stats = {
    cards: cards.length,
    entries: entryRows.length,
    demos: demos.length,
    demoTypes: new Set(demos.flatMap((demo) => [...demo.types])).size,
    entryBlocks: entryBlocks.size,
    gaps: gaps.length,
  };

  return { text: render({ cardRows, entryRows, gaps, stats }), stats, gaps };
}

function render({ cardRows, entryRows, gaps, stats }) {
  const lines = [];
  lines.push('# 规格卡对照表：卡片条目、声明积木与执行它的 Demo');
  lines.push('');
  lines.push('> 本文件由 `npm run spec:matrix:write` 生成，**不要手工编辑**。`npm run spec:matrix`（已并入 `npm run verify:all`）会重新生成并与磁盘逐字节比对，手工改动会直接让门禁变红。');
  lines.push('');
  lines.push('## 口径');
  lines.push('');
  lines.push('这张表只做**确定性连接**，不做任何判定：');
  lines.push('');
  lines.push('- **声明积木**取自卡片自身的 `entries[].blocks.existing`，不是从代码反推的；');
  lines.push(`- **工作区覆盖**是把 \`demos/tests.json\` 登记的 ${stats.demos} 个工作区 JSON 逐块递归后，按「该 Demo 是否同时包含条目声明的全部积木」判定的；`);
  lines.push('- **专用过程**指 Demo 里存在与某个声明积木同名（忽略大小写与分隔符）的 `procedures_def*` 过程，即该块有独立的执行入口；');
  lines.push('- **冻结运行清单**指 `spec-runs/<run-id>/manifest.json` 的 `outputs` 里包含该卡片路径的运行；');
  lines.push('- **积木是否存在**以 [`BLOCK-IO-CONTRACT.json`](../blocks/BLOCK-IO-CONTRACT.json) 为准，它本身由真实块定义生成并由 `verify:all` 逐字节校验。');
  lines.push('');
  lines.push('因此本表**不能**证明：条目实现与标准原文语义一致、Demo 的期望值来自官方测试集、或条目已被具名密码学审阅者签核。这三件事分别归 `spec:validate`、`demos/evidence.json` 与 `provenance.review`。');
  lines.push('');
  lines.push('## 1. 卡片台账');
  lines.push('');
  lines.push('| 卡片 | 标准 | 锚点（A/总） | 条目 | 标准制品 | 审阅状态 | 冻结运行清单 |');
  lines.push('|---|---|---:|---:|---:|---|---|');
  for (const row of cardRows) {
    lines.push(`| ${code(row.id)} | ${escapeCell(row.standard)} | ${row.anchors} | ${row.entries} | ${row.artifacts} | ${escapeCell(row.review)} | ${row.frozen} |`);
  }
  lines.push('');
  lines.push('## 2. 条目 → 声明积木 → 执行证据');
  lines.push('');
  lines.push('| 卡片 | 条目 | 类型 | 粒度 | 声明积木 | 工作区覆盖 | 执行过程 | 向量 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const row of entryRows) {
    const blocks = row.declared.length
      ? row.declared.map((type) => (row.unregistered.includes(type) ? `⚠${code(type)}` : code(type))).join('<br>')
      : '—';
    const full = row.full.length ? row.full.map((file) => code(basename(file))).join('<br>') : '无';
    const dedicated = row.dedicated.length
      ? row.dedicated.map((item) => `${code(item.name)}@${code(basename(item.demo))}`).join('<br>')
      : '—';
    lines.push(`| ${code(row.card)} | ${code(row.key)} | ${escapeCell(row.type)} | ${row.level} | ${blocks} | ${full} | ${dedicated} | ${row.status} |`);
  }
  lines.push('');
  lines.push('`⚠` 前缀表示该积木在卡片里被声明但不在 `BLOCK-IO-CONTRACT.json` 里（`spec:validate` 会对这种情况直接失败，这里只是同屏提示）。');
  lines.push('');
  lines.push('## 3. 差集（不是缺陷判定）');
  lines.push('');
  if (gaps.length === 0) {
    lines.push('当前没有任何差集。');
  } else {
    lines.push('| 卡片 | 条目 | 差集 | 明细 |');
    lines.push('|---|---|---|---|');
    for (const gap of gaps) {
      lines.push(`| ${code(gap.card)} | ${code(gap.entry)} | ${gap.kind} | ${escapeCell(gap.detail)} |`);
    }
  }
  lines.push('');
  lines.push('这些行说明「卡片的声明」与「Demo 的实际执行」之间的差集。它不等于阻塞缺陷：例如只由单元测试驱动、没有 Demo 工作区的原语，会在「无过程执行」里出现，而它的证据在 `tests/unit/` 里。');
  lines.push('');
  lines.push('## 4. 统计');
  lines.push('');
  lines.push('```');
  lines.push(`cards=${stats.cards} entries=${stats.entries} demos=${stats.demos}`);
  lines.push(`demo_block_types=${stats.demoTypes} entry_blocks=${stats.entryBlocks} gaps=${stats.gaps}`);
  lines.push('```');
  lines.push('');
  lines.push('## 5. 相关入口');
  lines.push('');
  lines.push('| 入口 | 作用 |');
  lines.push('|---|---|');
  lines.push('| [`npm run spec:validate`](../guides/SPEC-CARDS.md) | 重算制品哈希、引文锚点、块与类型引用 |');
  lines.push('| [`npm run spec:plan`](../guides/SPEC-CARDS.md) | 把卡片缺口算成可执行工作项 |');
  lines.push('| [`npm run spec:candidates`](../guides/SPEC-CARDS.md) | 复核 `spec-runs/candidates/` 的候选骨架 |');
  lines.push('| [`demos/ENDPOINT-MATRIX.md`](../demos/ENDPOINT-MATRIX.md) | Demo 端点级的「测试来源 + 参数范围 + 缺口」 |');
  lines.push('| [`CONFORMANCE-INVENTORY.md`](./CONFORMANCE-INVENTORY.md) | 全量符合性对象边界与逐块证据表 |');
  lines.push('| [`COVERAGE.md`](./COVERAGE.md) | 标准目录与积木的聚合覆盖矩阵 |');
  lines.push('');
  lines.push('本表与 `ENDPOINT-MATRIX.md` 的分工：**端点矩阵以 Demo 为主体**（每个工作区用了哪些块、测试来源是什么），**本表以卡片条目为主体**（每条标准义务由哪些 Demo/过程执行、哪些没有）。');
  lines.push('');
  return `${lines.join('\n')}`;
}

/** 负控自检：每条变异都必须让渲染结果变化，否则说明这条连接是死代码。 */
function selftest({ cards, demos, runs, contract }) {
  const baseline = buildMatrix({ cards, demos, runs, contract });
  const controls = [];
  const mutate = (label, mutateArgs, expect) => {
    const args = {
      cards: JSON.parse(JSON.stringify(cards)),
      demos: demos.map((demo) => ({ file: demo.file, types: new Set(demo.types), procedures: [...demo.procedures] })),
      runs: JSON.parse(JSON.stringify(runs)),
      contract: new Set(contract),
    };
    mutateArgs(args);
    const result = buildMatrix(args);
    const fired = expect({ baseline, mutated: result, args });
    controls.push({ label, fired });
  };

  mutate('vectors-status', (args) => {
    args.cards[0].card.entries[0].vectors.status = 'missing';
  }, ({ baseline, mutated }) => baseline.text !== mutated.text && mutated.gaps.length > baseline.gaps.length);

  mutate('declare-block', (args) => {
    args.cards[0].card.entries[0].blocks.existing.push('not_a_real_block');
  }, ({ mutated }) => mutated.gaps.some((gap) => gap.kind === '契约缺失') && mutated.text.includes('not_a_real_block'));

  mutate('anchor-grade', (args) => {
    args.cards[0].card.anchors[0].anchor_grade = 'B';
  }, ({ baseline, mutated }) => baseline.text !== mutated.text);

  mutate('drop-demo', (args) => {
    const target = args.cards[0].card.entries[1].blocks.existing[0];
    args.demos = args.demos.filter((demo) => !demo.types.has(target));
  }, ({ baseline, mutated }) => baseline.gaps.length !== mutated.gaps.length || baseline.text !== mutated.text);

  mutate('drop-procedure', (args) => {
    for (const demo of args.demos) demo.procedures = [];
  }, ({ mutated }) => mutated.gaps.some((gap) => gap.kind === '无过程执行') && mutated.text.includes('| — |'));

  mutate('drop-run', (args) => {
    args.runs = [];
  }, ({ mutated }) => mutated.text.includes('未登记'));

  mutate('level-inversion', (args) => {
    args.cards[0].card.entries[0].level = 'L3';
  }, ({ mutated }) => mutated.gaps.some((gap) => gap.kind === '粒度倒置'));

  const errors = controls.filter((control) => !control.fired).map((control) => control.label);
  const summary = `SPEC_MATRIX_SELFTEST controls=${controls.length} fired=${controls.length - errors.length}`;
  return { errors, summary };
}

function main() {
  const cards = discoverCards();
  const demos = loadDemos();
  const runs = loadRuns();
  const contract = loadContract();

  if (cards.length === 0) {
    console.log('SPEC_MATRIX_ERROR 没有找到任何 SPEC-CARD.json');
    process.exitCode = 1;
    return;
  }

  const { text, stats } = buildMatrix({ cards, demos, runs, contract });
  const { errors, summary } = selftest({ cards, demos, runs, contract });

  if (writeMode) {
    writeFileSync(outPath, text);
    console.log(`SPEC_MATRIX_WRITE ${relative(root, outPath)}`);
  } else {
    const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    if (existing === null) {
      console.log(`SPEC_MATRIX_ERROR 缺少 ${relative(root, outPath)}（用 \`npm run spec:matrix:write\` 生成）`);
      process.exitCode = 1;
      return;
    }
    if (existing !== text) {
      console.log(`SPEC_MATRIX_STALE ${relative(root, outPath)} 与卡片/Demo 现状不一致，先跑 \`npm run spec:matrix:write\``);
      process.exitCode = 1;
      return;
    }
  }

  if (errors.length) {
    for (const label of errors) console.log(`SPEC_MATRIX_SELFTEST_ERROR ${label}: 控制项未开火`);
    process.exitCode = 1;
    return;
  }

  console.log(summary);
  console.log(
    `SPEC_MATRIX cards=${stats.cards} entries=${stats.entries} demos=${stats.demos} demo_types=${stats.demoTypes} entry_blocks=${stats.entryBlocks} gaps=${stats.gaps}`,
  );
}

main();
