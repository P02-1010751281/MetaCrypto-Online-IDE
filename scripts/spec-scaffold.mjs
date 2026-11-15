#!/usr/bin/env node
/**
 * 规格卡生产者入口 · 第二步：按卡片与块 I/O 契约生成候选文件。
 *
 * 写面只有一处：`spec-runs/candidates/<...>`（本地产物，不进版本库）。它不写 src/、
 * 不改 docs/standards 的证据页、不合并、不调用模型，也不替人做判断——候选里的
 * 每个「该补齐什么」都留成 TODO 与审核包条目。
 *
 * 硬前提（缺一条就拒绝产出候选）：
 *   1. 卡片存在且能解析；
 *   2. 目标积木出现在卡片的 entries[].blocks 里，且必须是 planned——existing 块的定义
 *      已经在契约里，再脚手架只会产出一份重复的 stub（2026-11-14 实际踩到过）；
 *   3. 目标积木不在 BLOCK-IO-CONTRACT.json 里（防御卡片把已实现块错标成 planned）；
 *   4. 输出目录在 spec-runs/candidates/ 内；
 *   5. `npm run spec:validate` 与 `npm run spec:runs` 都 exit 0（--skip-gates 仅限自检目录）。
 *
 * 用法：
 *   npm run spec:scaffold -- <card-id> --block <planned-block>
 *   npm run spec:scaffold -- <card> --block <type> --out spec-runs/candidates/<dir>
 *   npm run spec:scaffold -- --selftest
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();
const standardsRoot = resolve(root, 'docs/standards');
const contractPath = resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const candidatesRoot = resolve(root, 'spec-runs/candidates');
const CARD_FILENAME = 'SPEC-CARD.json';
const SCHEMA = 'ciphercat-spec-scaffold/1';

// Blockly 的输入类型常量：1/3/5 即 VALUE/STATEMENT/DUMMY（见 verify-templates.ts 的导出逻辑）。
const INPUT_VALUE = 1;
const INPUT_STATEMENT = 3;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function discoverCards() {
  const cards = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (name !== CARD_FILENAME) continue;
      const card = readJson(full);
      cards.set(String(card.id ?? relative(standardsRoot, full)), card);
    }
  };
  walk(standardsRoot);
  return cards;
}

function findEntry(card, blockType) {
  for (const entry of Array.isArray(card.entries) ? card.entries : []) {
    const existing = Array.isArray(entry.blocks?.existing) ? entry.blocks.existing : [];
    const planned = Array.isArray(entry.blocks?.planned) ? entry.blocks.planned : [];
    if (existing.includes(blockType) || planned.includes(blockType)) {
      return { entry, planned: planned.includes(blockType) };
    }
  }
  return null;
}

function checkGate(script, label) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf-8' });
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-3).join('\n');
    return { label, ok: false, tail };
  }
  return { label, ok: true, tail: '' };
}

function renderCheck(labels) {
  return `[${labels.map((label) => `'${String(label)}'`).join(', ')}]`;
}

function renderBlockStub(card, blockType, entry, spec) {
  const lines = ["import * as Blockly from 'blockly/core';", ''];
  lines.push('/**');
  lines.push(` * 候选积木：${blockType}`);
  lines.push(` * 来源：卡片 ${card.id} 的条目 ${entry.key}（${entry.level ?? 'L?'} / ${entry.normative_level ?? '?'}）`);
  lines.push(' * 形状取自 docs/blocks/BLOCK-IO-CONTRACT.json（由真实块定义生成）。');
  lines.push(' * TODO(候选): 补中文标签、字段、颜色与 tooltip，再移入 src/blocks/<family>/ 并注册。');
  lines.push(' */');
  lines.push(`Blockly.Blocks['${blockType}'] = {`);
  lines.push('  init: function() {');
  if (spec) {
    for (const input of spec.inputs ?? []) {
      const name = input.name || '';
      const check = Array.isArray(input.check) && input.check.length ? renderCheck(input.check) : null;
      if (input.type === INPUT_VALUE) {
        const chain = `    this.appendValueInput('${name}')`;
        lines.push(check ? `${chain}.setCheck(${check}).appendField('TODO 标签');` : `${chain}.appendField('TODO 标签');`);
      } else if (input.type === INPUT_STATEMENT) {
        lines.push(`    this.appendStatementInput('${name}').appendField('TODO 标签');`);
      } else {
        lines.push("    this.appendDummyInput().appendField('TODO 标签');");
      }
    }
    for (const field of spec.fields ?? []) {
      lines.push(`    // TODO(候选): 字段 ${field.name}（${field.fieldClass}）需按语义补默认值与取值范围`);
    }
    if (Array.isArray(spec.outputCheck) && spec.outputCheck.length) {
      lines.push(`    this.setOutput(true, ${renderCheck(spec.outputCheck)});`);
    } else {
      lines.push('    // TODO(候选): 契约无法区分「无连接」与「任意类型」，按块语义设置 setOutput / setPreviousStatement / setNextStatement');
    }
  } else {
    lines.push('    // TODO(候选): 该积木尚未注册，契约里没有条目；按卡片 io 手写输入输出：');
    for (const input of entry.io?.inputs ?? []) {
      lines.push(`    //   输入 ${input.name}: ${input.type}`);
    }
    for (const output of entry.io?.outputs ?? []) {
      lines.push(`    //   输出 ${output.name}: ${output.type}`);
    }
    lines.push("    this.appendDummyInput().appendField('TODO 标签');");
    lines.push('    this.setOutput(true, null);');
  }
  lines.push('    this.setColour(0);');
  lines.push("    this.setTooltip('');");
  lines.push("    this.setHelpUrl('');");
  lines.push('  }');
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function renderGeneratorStub(card, blockType, entry, language) {
  const isPy = language === 'python';
  const pkg = isPy ? 'blockly/python' : 'blockly/javascript';
  const gen = isPy ? 'pythonGenerator' : 'javascriptGenerator';
  const lines = [];
  lines.push(`import { ${gen} } from '${pkg}';`);
  lines.push("import type { Block } from 'blockly/core';");
  lines.push('');
  lines.push(`/** 候选生成器（${language}）：按卡片 ${card.id} 条目 ${entry.key} 的 pseudocode 实现。 */`);
  lines.push(`${gen}.forBlock['${blockType}'] = function(block: Block): string {`);
  lines.push('  // TODO(候选): 读取输入/字段并返回代码；不得在此引入新依赖，双语言语义必须一致。');
  lines.push(`  return ${isPy ? '`# TODO ${block.type}\\n`' : '`// TODO ${block.type}\\n`'};`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function renderReviewPacket(card, blockType, hit, gates, plan) {
  const lines = [];
  lines.push(`# 候选审核包：${blockType}`);
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 卡片 | \`${card.id}\` |`);
  lines.push(`| 条目 | \`${hit.entry.key}\`（${hit.entry.level ?? 'L?'} / ${hit.entry.normative_level ?? '?'}） |`);
  lines.push(`| 积木 | \`${blockType}\` |`);
  lines.push(`| 契约状态 | ${plan.contract === 'present' ? '已在 BLOCK-IO-CONTRACT.json' : '未在契约（planned 块）'} |`);
  lines.push(`| 生成门禁 | ${gates.map((gate) => `\`${gate.label}\` exit 0`).join('、')} |`);
  lines.push('');
  lines.push('## 人工必须补齐');
  lines.push('');
  lines.push('1. 中文标签、tooltip、颜色与字段取值范围（候选里都是 TODO）。');
  lines.push('2. 输入/输出连接类型：契约只能给出 `getCheck()` 的结果，无法区分「无连接」与「任意类型」。');
  lines.push('3. 双生成器实现：Python 与 JavaScript 的语义必须一致，且不引入新依赖。');
  lines.push('4. 官方测试向量：期望值只能来自本卡片的锚点原文，不许自造。');
  lines.push('5. 注册链：`src/blocks/index.ts`、`src/constants/block-types.ts`、`src/utils/toolbox-config.ts`。');
  lines.push('');
  lines.push('## 候选目录之外必须由人完成的事');
  lines.push('');
  lines.push('- 运行 `npm run block-io:write` 让契约重新生成，并复核差异；再跑 `npm run verify:all`。');
  lines.push('- 把锚点原文与向量写回卡片（`vectors.status` 从 `partial`/`missing` 变 `wired`）。');
  lines.push('');
  lines.push('## 明确不做');
  lines.push('');
  lines.push('- 不自动合并进 `src/`；本目录只是候选。');
  lines.push('- 不改 `00-Standard-Source.md` 一类证据页。');
  lines.push('- 不写 `demos/tests.json` 的 `expect`——期望值只能来自 SpecCard。');
  lines.push('');
  return lines.join('\n');
}

function insideCandidates(dir) {
  const target = resolve(dir);
  const base = resolve(candidatesRoot);
  return target === base || target.startsWith(base + sep);
}

function writeCandidates(options) {
  const { card, blockType, hit, outDir, gates } = options;
  const spec = options.contract?.blocks?.[blockType] ?? null;
  const plan = {
    schema: SCHEMA,
    card: card.id,
    block: blockType,
    entry: {
      key: hit.entry.key ?? null,
      level: hit.entry.level ?? null,
      normative_level: hit.entry.normative_level ?? null,
    },
    contract: spec ? 'present' : 'absent',
    gates: Object.fromEntries(gates.map((gate) => [gate.label, 0])),
    files: [
      'plan.json',
      'block.ts',
      'generator.python.ts',
      'generator.javascript.ts',
      'REVIEW-PACKET.md',
    ],
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  writeFileSync(join(outDir, 'block.ts'), renderBlockStub(card, blockType, hit.entry, spec), 'utf-8');
  writeFileSync(
    join(outDir, 'generator.python.ts'),
    renderGeneratorStub(card, blockType, hit.entry, 'python'),
    'utf-8',
  );
  writeFileSync(
    join(outDir, 'generator.javascript.ts'),
    renderGeneratorStub(card, blockType, hit.entry, 'javascript'),
    'utf-8',
  );
  writeFileSync(join(outDir, 'REVIEW-PACKET.md'), renderReviewPacket(card, blockType, hit, gates, plan), 'utf-8');
  return plan;
}

function parseArgs(argv) {
  const positional = [];
  const options = { block: null, out: null, json: false, skipGates: false, selftest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--block') {
      options.block = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--out') {
      options.out = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--skip-gates') {
      options.skipGates = true;
    } else if (arg === '--selftest') {
      options.selftest = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`未知参数: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function runSelftest() {
  const controls = [
    { name: '缺参数', args: [] },
    { name: '未知卡片', args: ['no-such-card', '--block', 'cmac_mac'] },
    { name: '积木不在卡片里', args: ['sp800-38b-cmac', '--block', 'no_such_block'] },
    { name: '输出目录越界', args: ['sp800-38b-cmac', '--block', 'cmac_mac', '--out', 'docs/tmp'] },
    { name: '积木已实现', args: ['sp800-38b-cmac', '--block', 'cmac_mac'] },
  ];
  let fired = 0;
  const failures = [];
  for (const control of controls) {
    const result = spawnSync(process.execPath, [process.argv[1], ...control.args], {
      cwd: root,
      encoding: 'utf-8',
    });
    if (result.status !== 0) fired += 1;
    else failures.push(`应拒绝但通过了: ${control.name}`);
  }

  // 正控：只有「卡片声明为 planned、契约里不存在」的积木才允许脚手架。
  // 直接调用 writeCandidates，避免为了自检往 docs/standards 里塞假卡片；
  // 同时保证 --skip-gates 不会因为自检而放宽到真实卡片目录。
  const outDir = join(candidatesRoot, '.selftest', 'fixture-card', 'selftest_planned_block');
  const fixtureEntry = {
    key: 'selftest-entry',
    level: 'L1',
    normative_level: 'MUST',
    blocks: { existing: [], planned: ['selftest_planned_block'] },
    io: { inputs: [{ name: 'INPUT', type: 'Bytes' }], outputs: [{ name: 'OUTPUT', type: 'Bytes' }] },
  };
  try {
    const plan = writeCandidates({
      card: { id: 'fixture-card', entries: [fixtureEntry] },
      blockType: 'selftest_planned_block',
      hit: { entry: fixtureEntry, planned: true },
      outDir,
      gates: [],
      contract: { blocks: {} },
    });
    const produced = [
      'plan.json',
      'REVIEW-PACKET.md',
      'block.ts',
      'generator.python.ts',
      'generator.javascript.ts',
    ].every((file) => existsSync(join(outDir, file)));
    if (plan.contract === 'absent' && plan.block === 'selftest_planned_block' && produced) fired += 1;
    else failures.push(`正控应产出 planned 块候选: contract=${plan.contract} produced=${produced}`);
  } catch (error) {
    failures.push(`正控应产出但抛错: ${error.message}`);
  } finally {
    // 自检不留残留：正控目录验完即删，避免 candidates/ 里堆历史自检产物
    rmSync(join(candidatesRoot, '.selftest'), { recursive: true, force: true });
  }

  for (const failure of failures) console.error(`SPEC_SCAFFOLD_SELFTEST_ERROR ${failure}`);
  console.log(`SPEC_SCAFFOLD_SELFTEST controls=${controls.length + 1} fired=${fired}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`SPEC_SCAFFOLD_ERROR ${error.message}`);
    process.exit(2);
  }
  const { positional, options } = parsed;
  if (options.selftest) {
    runSelftest();
    return;
  }
  if (positional.length !== 1 || !options.block) {
    console.error('用法: node scripts/spec-scaffold.mjs <card-id> --block <block-type> [--out <dir>] [--json]');
    process.exit(2);
  }

  const [cardId] = positional;
  const blockType = options.block;

  let cards;
  let contract = { blocks: {} };
  try {
    cards = discoverCards();
    if (existsSync(contractPath)) {
      const raw = readJson(contractPath);
      contract = { blocks: raw };
    }
  } catch (error) {
    console.error(`SPEC_SCAFFOLD_ERROR 读取失败: ${error.message}`);
    process.exit(1);
  }

  const card = cards.get(cardId);
  if (!card) {
    console.error(`SPEC_SCAFFOLD_ERROR 找不到卡片: ${cardId}`);
    process.exit(1);
  }
  const hit = findEntry(card, blockType);
  if (!hit) {
    console.error(`SPEC_SCAFFOLD_ERROR 积木 ${blockType} 不在卡片 ${cardId} 的任何条目里（existing/planned 都没有）`);
    process.exit(1);
  }

  const outDir = resolve(options.out ?? join(candidatesRoot, `${cardId}-${blockType}`));
  if (!insideCandidates(outDir)) {
    console.error(`SPEC_SCAFFOLD_ERROR 输出目录必须在 ${relative(root, candidatesRoot)}/ 内，收到 ${relative(root, outDir)}`);
    process.exit(1);
  }
  if (options.skipGates && !relative(root, outDir).includes('.selftest')) {
    console.error('SPEC_SCAFFOLD_ERROR --skip-gates 只允许写到 spec-runs/candidates/.selftest/ 下');
    process.exit(1);
  }

  if (!hit.planned) {
    console.error(
      `SPEC_SCAFFOLD_ERROR 积木 ${blockType} 在卡片 ${cardId} 里是 existing 而不是 planned：` +
        '它的块定义已经存在，scaffold 只给尚未实现的新块生成骨架；' +
        '核对已实现块请用 spec:plan / spec:matrix',
    );
    process.exit(1);
  }
  if (contract.blocks[blockType]) {
    console.error(
      `SPEC_SCAFFOLD_ERROR 积木 ${blockType} 已出现在 BLOCK-IO-CONTRACT.json：` +
        '契约里存在说明块定义已经实现，拒绝产出重复 stub（若卡片标错了 planned，先修卡片）',
    );
    process.exit(1);
  }

  const gates = [];
  if (!options.skipGates) {
    for (const [script, label] of [
      ['scripts/check-spec-cards.mjs', 'spec:validate'],
      ['scripts/check-spec-runs.mjs', 'spec:runs'],
    ]) {
      const gate = checkGate(script, label);
      if (!gate.ok) {
        console.error(`SPEC_SCAFFOLD_ERROR 门禁 ${label} 未通过，拒绝产出候选:\n${gate.tail}`);
        process.exit(1);
      }
      gates.push(gate);
    }
  }

  const plan = writeCandidates({ card, blockType, hit, outDir, gates, contract });
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(
      `SPEC_SCAFFOLD card=${cardId} block=${blockType} entry=${hit.entry.key ?? '-'} ` +
        `contract=${plan.contract} gates=${gates.map((gate) => gate.label).join(',') || 'skipped'} ` +
        `files=${plan.files.length} out=${relative(root, outDir)}`,
    );
  }
}

main();
