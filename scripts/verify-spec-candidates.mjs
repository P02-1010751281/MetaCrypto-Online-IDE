#!/usr/bin/env node
/**
 * 规格卡生产者入口 · 第三段：候选目录的三层验证（`npm run spec:candidates`）。
 *
 * 候选由 `spec:scaffold` 写到 `spec-runs/candidates/<card>-<block>/`（本地产物，gitignore）。
 * 上一段只保证「产出时门禁是绿的」，不保证「产出后依据没漂移、骨架还能解析、两个生成器
 * 指向同一块」。本脚本逐目录重算能在候选层证明的部分：
 *
 *   1. 形状：plan.json 可解析、schema 正确、必备文件齐、files 清单与磁盘一致、
 *      目录名 = `<card>-<block>`；
 *   2. 依据仍在：卡片与条目仍存在、条目的 blocks.existing/planned 仍含该块、level/
 *      normative_level 与卡片一致、`contract` 标记与 BLOCK-IO-CONTRACT.json 自洽；
 *   3. 结构与语法：三个 TS 文件通过 TypeScript 语法解析、import 只来自白名单（不得依赖
 *      `@/` 项目别名，否则候选无法独立编译）、block.ts 注册的块名与两个生成器的
 *      `forBlock[...]` 键都等于 plan.block；
 *   4. 契约一致：block.ts 的 `appendValueInput(...).setCheck([...])` / `setOutput(true,[...])`
 *      与 BLOCK-IO-CONTRACT.json 的 check/outputCheck 逐项相同；
 *   5. 双语言对齐（仅在候选已去掉 `TODO(候选)` 后判定）：两个生成器读取的输入名集合必须
 *      相同，且每个名字都在契约里；任一语言读不到输入即判失败。
 *
 * 它**不能**证明的事（不要靠退出码越权声称）：
 *   - 不证明候选实现了算法。生成器仍是 TODO 骨架时，本脚本把 `parity` 记为 `stub`，
 *     汇总里计为 pending 而不是 verified。
 *   - 不证明双语言**输出**相同。候选不在 `src/` 注册链里，跑不了 Blockly 生成；真正的
 *     输出等价要等候选并入 `src/` 后由单测与 `verify:demos` 执行。
 *   - `vectors=card-wired` 只表示卡片条目声明了回归入口，不表示候选代码通过了该向量。
 *
 * 每轮跑负控自检：复制真实候选到 `spec-runs/candidates/.selftest/` 后逐项变异，每种变异
 * 都必须让检查变红；正控（未变异副本）必须通过。自检目录验完即删。
 *
 * 用法：
 *   node scripts/verify-spec-candidates.mjs              # 校验并自检
 *   node scripts/verify-spec-candidates.mjs --no-selftest
 *   node scripts/verify-spec-candidates.mjs --json
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = process.cwd();
const standardsRoot = resolve(root, 'docs/standards');
const contractPath = resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const candidatesRoot = resolve(root, 'spec-runs/candidates');
const PLAN_SCHEMA = 'ciphercat-spec-scaffold/1';
const PLAN_FILENAME = 'plan.json';
const REQUIRED_FILES = [
  'plan.json',
  'block.ts',
  'generator.python.ts',
  'generator.javascript.ts',
  'REVIEW-PACKET.md',
];
const GENERATOR_FILES = ['generator.python.ts', 'generator.javascript.ts'];
const TS_FILES = ['block.ts', ...GENERATOR_FILES];
const ALLOWED_IMPORTS = new Set(['blockly/core', 'blockly/javascript', 'blockly/python']);
const STUB_MARKER = 'TODO(候选)';
const INPUT_VALUE = 1;
const INPUT_STATEMENT = 3;

const args = new Set(process.argv.slice(2));
const withSelftest = !args.has('--no-selftest');
const asJson = args.has('--json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readText(path) {
  return readFileSync(path, 'utf-8');
}

/** 与 spec:scaffold 相同的卡片发现口径：docs/standards 下任意深度的 SPEC-CARD.json。 */
function discoverCards() {
  const cards = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (name !== 'SPEC-CARD.json') continue;
      const card = readJson(full);
      cards.set(String(card.id ?? relative(standardsRoot, full)), card);
    }
  };
  walk(standardsRoot);
  return cards;
}

/** 候选目录只认 candidates/ 的直接子目录；点开头的是自检产物，不参与正式扫描。 */
function discoverCandidates() {
  if (!existsSync(candidatesRoot)) return [];
  return readdirSync(candidatesRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .map((item) => resolve(candidatesRoot, item.name))
    .sort();
}

/** TypeScript 语法解析：transpileModule 只做语法层，不做跨文件类型检查。 */
function syntaxErrors(file) {
  const result = ts.transpileModule(readText(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => `${basename(file)}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
}

function importSpecifiers(text) {
  const specifiers = new Set();
  for (const match of text.matchAll(/(?:^|\n)\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1]);
  }
  for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1]);
  }
  return [...specifiers];
}

function registrationNames(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** 把 `['Bytes', 'IntList']` 这类字面量解体成集合；解析不了就返回 null（交给调用方报格式不符）。 */
function checkSet(raw) {
  if (raw == null) return new Set();
  const names = [...String(raw).matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  return new Set(names);
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

function setText(set) {
  return `[${[...set].sort().join(', ')}]`;
}

/** 从候选 block.ts 里抽出 `appendValueInput('X')...` / `appendStatementInput('X')` 的声明。 */
function readCandidateInputs(text) {
  const inputs = new Map();
  for (const match of text.matchAll(/append(Value|Statement|Dummy)Input\(\s*(?:['"]([A-Z0-9_]*)['"])?\s*\)([^;]*)/g)) {
    const [, kind, name = '', chain] = match;
    if (kind === 'Dummy') continue;
    const setCheckMatch = /\.setCheck\(\s*(\[[^\]]*\])?\s*\)/.exec(chain);
    inputs.set(name, {
      kind: kind === 'Statement' ? INPUT_STATEMENT : INPUT_VALUE,
      checks: setCheckMatch ? checkSet(setCheckMatch[1] ?? '') : null,
    });
  }
  return inputs;
}

function readCandidateOutput(text) {
  const match = /setOutput\(\s*true\s*,\s*(\[[^\]]*\])\s*\)/.exec(text);
  return match ? checkSet(match[1]) : null;
}

function checkCandidate(dir, context) {
  const errors = [];
  const stages = { shape: 'pending', provenance: 'pending', parse: 'pending', parity: 'pending', vectors: 'pending' };
  const label = relative(root, dir);

  // ---- 1. 形状 -------------------------------------------------------------
  const planPath = join(dir, PLAN_FILENAME);
  if (!existsSync(planPath)) {
    return { dir, label, errors: [`缺 ${PLAN_FILENAME}，候选不完整`], stages, plan: null, stub: true };
  }
  let plan;
  try {
    plan = readJson(planPath);
  } catch (error) {
    return { dir, label, errors: [`${PLAN_FILENAME} JSON 解析失败：${error.message}`], stages, plan: null, stub: true };
  }
  const shapeErrors = [];
  if (plan.schema !== PLAN_SCHEMA) shapeErrors.push(`schema: 期望 ${PLAN_SCHEMA}，实际 ${JSON.stringify(plan.schema)}`);
  for (const field of ['card', 'block']) {
    if (typeof plan[field] !== 'string' || !plan[field].trim()) shapeErrors.push(`${field}: 必须是非空字符串`);
  }
  if (!plan.entry || typeof plan.entry.key !== 'string' || !plan.entry.key.trim()) {
    shapeErrors.push('entry.key: 必须是非空字符串');
  }
  if (!Array.isArray(plan.files)) {
    shapeErrors.push('files: 必须是数组');
  } else {
    const actual = readdirSync(dir).sort();
    const declared = [...new Set(plan.files)].sort();
    if (declared.length !== plan.files.length) shapeErrors.push('files: 存在重复条目');
    if (declared.join('|') !== actual.join('|')) {
      shapeErrors.push(`files: 清单与磁盘不一致（清单 ${declared.join(',') || '空'}；磁盘 ${actual.join(',') || '空'}）`);
    }
  }
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(dir, file))) shapeErrors.push(`缺必备文件 ${file}`);
  }
  if (typeof plan.card === 'string' && typeof plan.block === 'string' && basename(dir) !== `${plan.card}-${plan.block}`) {
    shapeErrors.push(`目录名: 期望 ${plan.card}-${plan.block}，实际 ${basename(dir)}`);
  }
  errors.push(...shapeErrors);
  stages.shape = shapeErrors.length ? 'fail' : 'pass';

  // ---- 2. 依据仍在 ---------------------------------------------------------
  const provenanceErrors = [];
  const card = typeof plan.card === 'string' ? context.cards.get(plan.card) : null;
  let entry = null;
  if (!card) {
    provenanceErrors.push(`卡片不存在：${plan.card}（候选产出后卡片被改名或删除）`);
  } else {
    entry = (Array.isArray(card.entries) ? card.entries : []).find((item) => item.key === plan.entry?.key) ?? null;
    if (!entry) {
      provenanceErrors.push(`条目已不在卡片里：${plan.entry?.key}`);
    } else {
      const blocks = [
        ...(Array.isArray(entry.blocks?.existing) ? entry.blocks.existing : []),
        ...(Array.isArray(entry.blocks?.planned) ? entry.blocks.planned : []),
      ];
      if (!blocks.includes(plan.block)) {
        provenanceErrors.push(`积木 ${plan.block} 已不在条目 ${entry.key} 的 blocks.existing/planned 里`);
      }
      for (const field of ['level', 'normative_level']) {
        const declared = plan.entry?.[field] ?? null;
        const actual = entry[field] ?? null;
        if (declared !== actual) {
          provenanceErrors.push(`entry.${field}: 候选记 ${JSON.stringify(declared)}，卡片现为 ${JSON.stringify(actual)}`);
        }
      }
    }
  }
  const contractSpec = context.contract[plan.block] ?? null;
  if (plan.contract === 'present' && !contractSpec) {
    provenanceErrors.push(`contract: 候选声明 present，但 BLOCK-IO-CONTRACT.json 里没有 ${plan.block}`);
  }
  if (plan.contract === 'absent' && contractSpec) {
    provenanceErrors.push(`contract: 候选声明 absent，但 ${plan.block} 已进入 BLOCK-IO-CONTRACT.json（应重新 scaffold）`);
  }
  errors.push(...provenanceErrors);
  stages.provenance = provenanceErrors.length ? 'fail' : 'pass';

  // ---- 3. 结构与语法 -------------------------------------------------------
  const parseErrors = [];
  for (const file of TS_FILES) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    parseErrors.push(...syntaxErrors(full));
  }
  for (const file of TS_FILES) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    const text = readText(full);
    for (const specifier of importSpecifiers(text)) {
      if (specifier.startsWith('@/')) {
        parseErrors.push(`${file}: 不得依赖项目别名 ${specifier}（候选不在 src/ 里，无法独立解析）`);
      } else if (!ALLOWED_IMPORTS.has(specifier)) {
        parseErrors.push(`${file}: 引入不在白名单的依赖 ${specifier}（只允许 ${[...ALLOWED_IMPORTS].join(' / ')}）`);
      }
    }
  }
  const blockFile = join(dir, 'block.ts');
  if (existsSync(blockFile)) {
    const declared = registrationNames(readText(blockFile), /Blockly\.Blocks\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g);
    if (!declared.length) parseErrors.push('block.ts: 没有 Blockly.Blocks[...] 注册');
    for (const name of declared) {
      if (name !== plan.block) parseErrors.push(`block.ts: 注册了 ${name}，但 plan.block 是 ${plan.block}`);
    }
  }
  for (const file of GENERATOR_FILES) {
    const full = join(dir, file);
    if (!existsSync(full)) continue;
    const declared = registrationNames(readText(full), /forBlock\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g);
    if (!declared.length) parseErrors.push(`${file}: 没有 forBlock[...] 注册`);
    for (const name of declared) {
      if (name !== plan.block) parseErrors.push(`${file}: 注册了 ${name}，但 plan.block 是 ${plan.block}`);
    }
  }
  errors.push(...parseErrors);
  stages.parse = parseErrors.length ? 'fail' : 'pass';

  // ---- 4. 契约一致 ---------------------------------------------------------
  const contractErrors = [];
  if (contractSpec && existsSync(blockFile)) {
    const text = readText(blockFile);
    const declaredInputs = readCandidateInputs(text);
    for (const input of Array.isArray(contractSpec.inputs) ? contractSpec.inputs : []) {
      if (input.type !== INPUT_VALUE && input.type !== INPUT_STATEMENT) continue;
      const declared = declaredInputs.get(input.name ?? '');
      const expectedChecks = checkSet(Array.isArray(input.check) ? JSON.stringify(input.check) : null);
      if (!declared) {
        contractErrors.push(`契约输入 ${JSON.stringify(input.name)} 未在 block.ts 里声明`);
        continue;
      }
      if (input.type === INPUT_VALUE && expectedChecks.size) {
        if (!declared.checks) {
          contractErrors.push(`输入 ${input.name}: 契约要求 setCheck(${setText(expectedChecks)})，候选未设置`);
        } else if (!sameSet(declared.checks, expectedChecks)) {
          contractErrors.push(
            `输入 ${input.name}: check 不一致（契约 ${setText(expectedChecks)}，候选 ${setText(declared.checks)}）`,
          );
        }
      }
    }
    const expectedOutput = checkSet(Array.isArray(contractSpec.outputCheck) ? JSON.stringify(contractSpec.outputCheck) : null);
    if (expectedOutput.size) {
      const declaredOutput = readCandidateOutput(text);
      if (!declaredOutput) {
        contractErrors.push(`输出: 契约要求 setOutput(true, ${setText(expectedOutput)})，候选未设置`);
      } else if (!sameSet(declaredOutput, expectedOutput)) {
        contractErrors.push(
          `输出: check 不一致（契约 ${setText(expectedOutput)}，候选 ${setText(declaredOutput)}）`,
        );
      }
    }
  }
  errors.push(...contractErrors);

  // ---- 5. 双语言对齐 -------------------------------------------------------
  const parityErrors = [];
  const generatorTexts = GENERATOR_FILES.filter((file) => existsSync(join(dir, file))).map((file) =>
    readText(join(dir, file)),
  );
  const stub =
    (existsSync(blockFile) && readText(blockFile).includes(STUB_MARKER)) ||
    generatorTexts.some((text) => text.includes(STUB_MARKER));
  if (stub || generatorTexts.length < 2) {
    stages.parity = stub ? 'stub' : 'fail';
    if (!stub) parityErrors.push('缺少一个生成器文件，无法比较双语言');
  } else {
    const readSets = generatorTexts.map((text) => ({
      inputs: new Set(registrationNames(text, /(?:getInput|getInputTargetBlock)\(\s*['"]([A-Z0-9_]+)['"]/g)),
      fields: new Set(registrationNames(text, /getFieldValue\(\s*['"]([A-Z0-9_]+)['"]/g)),
    }));
    const [js, py] = readSets;
    if (!js.inputs.size || !sameSet(js.inputs, py.inputs)) {
      parityErrors.push(
        `输入读取集合不一致（javascript ${setText(js.inputs)}，python ${setText(py.inputs)}）；生成器必须读同一组输入`,
      );
    }
    if (!sameSet(js.fields, py.fields)) {
      parityErrors.push(`字段读取集合不一致（javascript ${setText(js.fields)}，python ${setText(py.fields)}）`);
    }
    if (contractSpec) {
      const known = new Set(
        (Array.isArray(contractSpec.inputs) ? contractSpec.inputs : [])
          .map((input) => input.name ?? '')
          .filter(Boolean),
      );
      for (const name of js.inputs) {
        if (!known.has(name)) parityErrors.push(`生成器读取的输入 ${name} 不在契约里`);
      }
    }
    stages.parity = parityErrors.length ? 'fail' : 'ok';
  }
  errors.push(...parityErrors);

  // ---- 6. 向量状态 ---------------------------------------------------------
  const vectorStatus = entry?.vectors?.status ?? 'missing';
  if (stub) {
    stages.vectors = 'pending';
  } else if (vectorStatus === 'wired') {
    stages.vectors = 'card-wired';
  } else {
    stages.vectors = 'pending';
    errors.push(`卡片条目 ${plan.entry?.key} 的 vectors.status 是 ${vectorStatus}，候选只能算未接线`);
  }

  return { dir, label, errors, stages, plan, stub };
}

const NEGATIVE_CONTROLS = [
  ['plan-missing', (dir) => rmSync(join(dir, PLAN_FILENAME), { force: true })],
  ['plan-corrupt', (dir) => writeFileSync(join(dir, PLAN_FILENAME), '{', 'utf-8')],
  ['schema-wrong', (dir) => mutatePlan(dir, (plan) => ({ ...plan, schema: 'ciphercat-spec-scaffold/0' }))],
  ['unknown-card', (dir) => mutatePlan(dir, (plan) => ({ ...plan, card: 'no-such-card' }))],
  ['unknown-entry', (dir) => mutatePlan(dir, (plan) => ({ ...plan, entry: { ...plan.entry, key: 'no-such-entry' } }))],
  ['block-not-in-entry', (dir) => mutatePlan(dir, (plan) => ({ ...plan, block: `${plan.block}_drifted` }))],
  ['files-missing-entry', (dir) =>
    mutatePlan(dir, (plan) => ({ ...plan, files: plan.files.filter((file) => file !== 'REVIEW-PACKET.md') }))],
  ['syntax-broken', (dir) => mutateText(join(dir, 'block.ts'), (text) => text.replace(/};\s*$/, '},\n'))],
  ['setcheck-mismatch', (dir) =>
    mutateText(join(dir, 'block.ts'), (text) => text.replace(/\.setCheck\(\[[^\]]*\]\)/, ".setCheck(['NotAContractType'])"))],
  ['output-mismatch', (dir) =>
    mutateText(join(dir, 'block.ts'), (text) => text.replace(/setOutput\(\s*true\s*,\s*\[[^\]]*\]\s*\)/, "setOutput(true, ['NotAContractType'])"))],
  ['generator-wrong-block', (dir) =>
    mutateText(join(dir, 'generator.python.ts'), (text) => text.replace(/forBlock\[\s*['"][A-Za-z0-9_]+['"]\s*\]/, "forBlock['some_other_block']"))],
  ['alias-import', (dir) =>
    mutateText(join(dir, 'generator.javascript.ts'), (text) => `import { helper } from '@/utils/helper';\n${text}`)],
  ['contract-claim-flipped', (dir) => mutatePlan(dir, (plan) => ({ ...plan, contract: plan.contract === 'present' ? 'absent' : 'present' }))],
  ['stub-to-implemented-without-inputs', (dir) => {
    for (const file of ['block.ts', ...GENERATOR_FILES]) {
      mutateText(join(dir, file), (text) => text.split(STUB_MARKER).join('已实现'));
    }
  }],
];

function mutatePlan(dir, mutate) {
  const path = join(dir, PLAN_FILENAME);
  writeFileSync(path, `${JSON.stringify(mutate(readJson(path)), null, 2)}\n`, 'utf-8');
}

function mutateText(path, mutate) {
  const before = readText(path);
  const after = mutate(before);
  if (before === after) throw new Error(`${basename(path)} 没有可施加的变异点`);
  writeFileSync(path, after, 'utf-8');
}

/**
 * 把 TODO 骨架改成「已实现」形态：生成器按契约读取全部输入与字段。
 * 用来给 `parity=ok` / `vectors=card-wired` 这两条分支做正控——只有负控会漏掉「永远失败」的实现。
 */
function implementFixture(dir, contractSpec) {
  const inputs = (Array.isArray(contractSpec?.inputs) ? contractSpec.inputs : [])
    .filter((input) => input.type === INPUT_VALUE && input.name)
    .map((input) => input.name);
  const fields = (Array.isArray(contractSpec?.fields) ? contractSpec.fields : []).map((field) => field.name);
  for (const file of ['block.ts', ...GENERATOR_FILES]) {
    mutateText(join(dir, file), (text) => text.split(STUB_MARKER).join('已实现').split('TODO 标签').join('标签'));
  }
  const body = [
    ...inputs.map((name) => `  const ${name.toLowerCase()} = block.getInputTargetBlock('${name}');`),
    ...fields.map((name) => `  const ${name.toLowerCase()} = block.getFieldValue('${name}');`),
    ...(inputs.length ? [`  return String(${inputs[0].toLowerCase()});`] : ['  return String(block.type);']),
  ];
  for (const [file, header] of [
    [
      'generator.javascript.ts',
      ["import { javascriptGenerator } from 'blockly/javascript';", "import type { Block } from 'blockly/core';", ''],
    ],
    [
      'generator.python.ts',
      ["import { pythonGenerator } from 'blockly/python';", "import type { Block } from 'blockly/core';", ''],
    ],
  ]) {
    const generator = file.includes('python') ? 'pythonGenerator' : 'javascriptGenerator';
    writeFileSync(
      join(dir, file),
      [
        ...header,
        `${generator}.forBlock['${contractSpec.__block}'] = function(block: Block): string {`,
        ...body,
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );
  }
}

function runSelftest(source, context) {
  const results = [];
  const scratch = resolve(candidatesRoot, '.selftest');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const fixture = () => {
    const dir = resolve(scratch, `${source.plan.card}-${source.plan.block}`);
    rmSync(dir, { recursive: true, force: true });
    cpSync(source.dir, dir, { recursive: true });
    return dir;
  };

  // 正控：未变异的副本必须通过，否则负控「全红」毫无意义。
  try {
    const positive = checkCandidate(fixture(), context);
    results.push(['positive-control', positive.errors.length === 0, positive.errors[0] ?? '']);
  } catch (error) {
    results.push(['positive-control', false, error.message]);
  }

  // 第二个正控：已完成形态必须同时拿到 parity=ok 与 vectors=card-wired。
  try {
    const dir = fixture();
    const contractSpec = { ...(context.contract[source.plan.block] ?? {}), __block: source.plan.block };
    implementFixture(dir, contractSpec);
    const outcome = checkCandidate(dir, context);
    const wired = outcome.stages.vectors === 'card-wired';
    const ok = outcome.errors.length === 0 && outcome.stages.parity === 'ok' && wired;
    results.push([
      'positive-implemented',
      ok,
      outcome.errors[0] ?? `parity=${outcome.stages.parity} vectors=${outcome.stages.vectors}`,
    ]);
  } catch (error) {
    results.push(['positive-implemented', false, error.message]);
  }

  for (const [name, mutate] of NEGATIVE_CONTROLS) {
    let dir;
    try {
      dir = fixture();
      mutate(dir);
    } catch (error) {
      results.push([name, false, `变异无法施加：${error.message}`]);
      continue;
    }
    const outcome = checkCandidate(dir, context);
    results.push([name, outcome.errors.length > 0, outcome.errors[0] ?? '变异后仍然通过']);
  }

  rmSync(scratch, { recursive: true, force: true });
  return results;
}

function main() {
  let cards;
  let contract;
  try {
    cards = discoverCards();
    contract = existsSync(contractPath) ? readJson(contractPath) : {};
  } catch (error) {
    console.error(`SPEC_CANDIDATE_ERROR 读取卡片或契约失败：${error.message}`);
    process.exit(1);
  }
  const context = { cards, contract };
  const candidates = discoverCandidates();

  const results = candidates.map((dir) => checkCandidate(dir, context));
  for (const result of results) {
    for (const error of result.errors) console.error(`SPEC_CANDIDATE_ERROR ${result.label}: ${error}`);
  }

  const summarize = (list) => ({
    shape: list.filter((item) => item.stages.shape === 'pass').length,
    parse: list.filter((item) => item.stages.parse === 'pass').length,
    parityOk: list.filter((item) => item.stages.parity === 'ok').length,
    parityStub: list.filter((item) => item.stages.parity === 'stub').length,
    vectorsWired: list.filter((item) => item.stages.vectors === 'card-wired').length,
    vectorsPending: list.filter((item) => item.stages.vectors === 'pending').length,
  });
  const stats = summarize(results);

  let selftestExit = 0;
  let selftest = null;
  if (results.length && withSelftest) {
    const source = results.find((item) => item.errors.length === 0) ?? results[0];
    const outcomes = runSelftest(source, context);
    const fired = outcomes.filter(([, ok]) => ok).length;
    for (const [name, ok, detail] of outcomes) {
      if (!ok) console.error(`SPEC_CANDIDATE_SELFTEST_ERROR ${name}: ${detail}`);
    }
    if (outcomes.some(([, ok]) => !ok)) selftestExit = outcomes.filter(([, ok]) => !ok).length;
    selftest = { controls: outcomes.length, fired };
  }

  const errorCount = results.reduce((total, item) => total + item.errors.length, 0) + selftestExit;
  if (asJson) {
    console.log(JSON.stringify({ candidates: results, stats, selftest }, null, 2));
  } else {
    if (selftest) {
      console.log(`SPEC_CANDIDATE_SELFTEST controls=${selftest.controls} fired=${selftest.fired}`);
    } else if (candidates.length && !withSelftest) {
      console.log('SPEC_CANDIDATE_SELFTEST skipped=--no-selftest');
    } else if (!candidates.length) {
      console.log('SPEC_CANDIDATE_SELFTEST skipped=no-candidates');
    }
    console.log(
      `SPEC_CANDIDATE_SUMMARY candidates=${results.length} shape_ok=${stats.shape} parse_ok=${stats.parse} ` +
        `parity_ok=${stats.parityOk} parity_stub=${stats.parityStub} ` +
        `vectors_wired=${stats.vectorsWired} vectors_pending=${stats.vectorsPending} errors=${errorCount}`,
    );
  }
  process.exit(errorCount === 0 ? 0 : 1);
}

main();
