/**
 * A 线「标准 → 工作区」的只读数据制品：把 p4 的裁决 JSON 合成一份随应用发布的数据。
 *
 * 为什么要有这一步，而不是让界面直接 import experiments/ 下的 JSON：
 * - `experiments/` 是研究现场，文件会被重跑、改名、分叉；应用只该依赖一份**确定的**制品；
 * - 计数必须自己会算：三档计数、缺口总数、每份源文件的 sha256 都从 clauses 重算后写进制品，
 *   而不是把源文件里的 `counts` 原样复制——复制来的数字与 clauses 脱钩后就再也对不上；
 * - 源文件必须已入库（git 跟踪）：否则提交出去的制品无法由任何人复现。
 *
 * 用法：
 *   node scripts/build-verdicts-index.mjs           # 重写制品
 *   node scripts/build-verdicts-index.mjs --check   # 只比对，不写；不一致退出 1
 *
 * 新增一份标准切片时：在 SOURCES 里加一行（顺序即界面里的顺序），重跑本脚本。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const OUT = 'src/services/ai-helper/verdicts-index.json';

/** 顺序即界面里的标准顺序；只列已入库的裁决文件。 */
const SOURCES = [
  'experiments/ai-helper-2026-11-14/p4/verdicts.json',
  'experiments/ai-helper-2026-11-14/p4/verdicts-sp800-38b-cmac.json',
];

const TIERS = ['build', 'partial', 'missing'];
const EVIDENCE_LAYERS = ['L1', 'L2', 'L3', 'none'];
const VISIBILITIES = ['canvas', 'internal', 'none'];

const errors = [];
const fail = (message) => errors.push(message);

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** 只检查「这份源文件能否被别人复现」；不在 git 仓库里（导出包）时跳过，不算错误。 */
function assertTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], {
      stdio: 'ignore',
      cwd: process.cwd(),
    });
  } catch (error) {
    if (error.code === 'ENOENT') return; // 没装 git：跳过，产物仍可用
    fail(`${path}: 未被 git 跟踪——制品必须能由入库文件复现，先提交裁决 JSON`);
  }
}

function countBy(values, keys) {
  const out = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/** 从 clauses 重算汇总，并与源文件里声明的 counts 对账。 */
function recount(verdict, path) {
  const clauses = verdict.clauses ?? [];
  const tiers = countBy(clauses.map((clause) => clause.tier), TIERS);
  const layers = countBy(
    clauses.map((clause) => clause.evidenceLayer ?? 'none'),
    EVIDENCE_LAYERS,
  );
  const gaps = clauses.reduce((sum, clause) => sum + (clause.gaps?.length ?? 0), 0);
  const computed = {
    clauses: clauses.length,
    build: tiers.build,
    partial: tiers.partial,
    missing: tiers.missing,
    evidenceLayers: layers,
    gaps,
  };
  const declared = verdict.counts ?? {};
  for (const [key, value] of Object.entries(computed)) {
    if (key === 'evidenceLayers') {
      for (const layer of EVIDENCE_LAYERS) {
        if ((declared.evidenceLayers ?? {})[layer] !== value[layer]) {
          fail(
            `${path}: counts.evidenceLayers.${layer} 声明 ${declared.evidenceLayers?.[layer]}，按 clauses 实算 ${value[layer]}`,
          );
        }
      }
      continue;
    }
    if (declared[key] !== value) {
      fail(`${path}: counts.${key} 声明 ${declared[key]}，按 clauses 实算 ${value}`);
    }
  }
  return computed;
}

/** 结构校验：界面要用的字段缺了就直接退回生成，而不是让界面静默画半页。 */
function validate(clause, path) {
  const id = `${path} ${clause.clauseId ?? '(无 clauseId)'}`;
  if (!clause.clauseId) fail(`${id}: 缺 clauseId`);
  if (!clause.entryPath) fail(`${id}: 缺 entryPath`);
  if (!clause.title) fail(`${id}: 缺 title`);
  if (!TIERS.includes(clause.tier)) fail(`${id}: tier=${clause.tier} 不在 ${TIERS.join('/')}`);
  if (!EVIDENCE_LAYERS.includes(clause.evidenceLayer)) {
    fail(`${id}: evidenceLayer=${clause.evidenceLayer} 不在 ${EVIDENCE_LAYERS.join('/')}`);
  }
  if (!Array.isArray(clause.steps) || clause.steps.length === 0) fail(`${id}: steps 为空`);
  for (const step of clause.steps ?? []) {
    if (!step.text) fail(`${id}/${step.id}: 缺 text`);
    if (!VISIBILITIES.includes(step.visibility)) {
      fail(`${id}/${step.id}: visibility=${step.visibility} 不在 ${VISIBILITIES.join('/')}`);
    }
    if (!Array.isArray(step.blocks)) fail(`${id}/${step.id}: blocks 不是数组`);
  }
  if (!Array.isArray(clause.anchors)) fail(`${id}: anchors 不是数组`);
  for (const anchor of clause.anchors ?? []) {
    const click = anchor.click ?? {};
    if (!click.doc || !Number.isFinite(click.line_start)) {
      fail(`${id}/${anchor.section}: anchor 缺 doc 或 line_start`);
    } else if (!existsSync(click.doc)) {
      fail(`${id}/${anchor.section}: 锚点指向的文档不存在：${click.doc}`);
    }
  }
}

const standards = [];
const generatedFrom = [];

for (const path of SOURCES) {
  assertTracked(path);
  const text = readFileSync(path, 'utf8');
  let verdict;
  try {
    verdict = JSON.parse(text);
  } catch (error) {
    fail(`${path}: 不是合法 JSON（${error.message}）`);
    continue;
  }
  if (verdict.schemaVersion !== 1) fail(`${path}: schemaVersion=${verdict.schemaVersion}，本脚本只认 1`);
  if (!verdict.standard?.id) fail(`${path}: 缺 standard.id`);
  if (!Array.isArray(verdict.clauses) || verdict.clauses.length === 0) {
    fail(`${path}: clauses 为空`);
    continue;
  }
  verdict.clauses.forEach((clause) => validate(clause, path));
  const counts = recount(verdict, path);
  standards.push(verdict);
  generatedFrom.push({ path, sha256: sha256(text), standardId: verdict.standard.id, counts });
}

if (errors.length) {
  console.error('VERDICTS_INDEX_ERRORS');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const totals = standards.reduce(
  (sum, verdict) => {
    sum.clauses += verdict.counts.clauses;
    sum.build += verdict.counts.build;
    sum.partial += verdict.counts.partial;
    sum.missing += verdict.counts.missing;
    sum.gaps += verdict.counts.gaps;
    return sum;
  },
  { clauses: 0, build: 0, partial: 0, missing: 0, gaps: 0 },
);

const index = {
  schemaVersion: 1,
  generatedBy: 'scripts/build-verdicts-index.mjs',
  note: '三档判据是构建期机器候选，语义等价未验证；签核在人，界面不得把 tier 说成「已覆盖」。',
  generatedFrom,
  totals: { standards: standards.length, ...totals },
  standards,
};

const serialized = `${JSON.stringify(index, null, 2)}\n`;
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current === serialized) {
    console.log(
      `VERDICTS_INDEX_CHECK ok（${index.totals.standards} 份标准 / ${index.totals.clauses} 个条款 / hash ${sha256(serialized).slice(0, 16)}）`,
    );
    process.exit(0);
  }
  console.error('VERDICTS_INDEX_CHECK 不一致：源码或裁决 JSON 变了，先跑 npm run verdicts:index');
  console.error(`  期望 hash ${sha256(serialized).slice(0, 16)}，磁盘上 ${current ? sha256(current).slice(0, 16) : '(缺失)'}`);
  process.exit(1);
}

writeFileSync(OUT, serialized);
console.log(
  `VERDICTS_INDEX ${OUT} 标准 ${index.totals.standards} / 条款 ${index.totals.clauses} / 能搭 ${index.totals.build} / 部分 ${index.totals.partial} / 不能 ${index.totals.missing} / 缺口 ${index.totals.gaps}`,
);
