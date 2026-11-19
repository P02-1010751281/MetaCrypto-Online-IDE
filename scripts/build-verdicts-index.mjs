/**
 * A 线「标准 → 工作区」的数据制品：把 p4 的裁决 JSON 与试点工程合成随应用发布的数据。
 *
 * 为什么要有这一步，而不是让界面直接 import experiments/ 下的 JSON：
 * - `experiments/` 是研究现场，文件会被重跑、改名、分叉；应用只该依赖一份**确定的**制品；
 * - 计数必须自己会算：三档计数、缺口总数、每份源文件的 sha256 都从 clauses 重算后写进制品，
 *   而不是把源文件里的 `counts` 原样复制——复制来的数字与 clauses 脱钩后就再也对不上；
 * - 源文件必须已入库（git 跟踪）：否则提交出去的制品无法由任何人复现。
 *
 * 试点工程（PILOT_PROJECTS）走同一条路：从 p4 的 ProjectRecord 复制成
 * `src/services/ai-helper/pilot-projects/<standardId>.json`，剥掉字符串 id，登记 sha256；
 * 界面按需 import 那一份，打开时只在本机项目库复制一份，不改动制品。
 *
 * 用法：
 *   node scripts/build-verdicts-index.mjs           # 重写制品（索引 + 试点工程）
 *   node scripts/build-verdicts-index.mjs --check   # 只比对，不写；不一致退出 1
 *
 * 新增一份标准切片时：在 SOURCES 里加一行（顺序即界面里的顺序），需要试点工程时
 * 同时在 PILOT_PROJECTS 里登记，重跑本脚本。
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const OUT = 'src/services/ai-helper/verdicts-index.json';

/** 顺序即界面里的标准顺序；只列已入库的裁决文件。 */
const SOURCES = [
  'experiments/ai-helper-2026-11-14/p4/verdicts.json',
  'experiments/ai-helper-2026-11-14/p4/verdicts-sp800-38b-cmac.json',
  'experiments/ai-helper-2026-11-14/p4/verdicts-sp800-38c-ccm.json',
];

/**
 * 试点工程：每份标准切片用仓库现有块搭出的多文件 project（P4 的产物）。
 *
 * 和应用依赖裁决 JSON 的理由相同——应用只认这里**复制出来**的制品，不直接 import
 * `experiments/`：研究现场会被重跑、改名、分叉，而制品必须能被任何人按 sha256 复核。
 * 复制时剥掉源文件里的字符串 `id`：本机项目主键由 IndexedDB 自增分配，`/editor/:id`
 * 只认数字，带着 `p4-…` 的字符串 id 落库会打开一个打不开的项目。
 */
const PILOT_DIR = 'src/services/ai-helper/pilot-projects';
const PILOT_PROJECTS = [
  {
    standardId: 'fips180-4-SHA2',
    source: 'experiments/ai-helper-2026-11-14/p4/project/sha256-multiblock.project.json',
  },
  {
    standardId: 'sp800-38b-cmac',
    source: 'experiments/ai-helper-2026-11-14/p4/project-cmac/cmac-rfc4493.project.json',
  },
  {
    standardId: 'sp800-38c-ccm',
    source: 'experiments/ai-helper-2026-11-14/p4/project-ccm/ccm-appendix-c.project.json',
  },
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

/**
 * 数一份工作区里的积木总数（含嵌套）。
 *
 * Blockly 的 JSON 序列化把下一块放在 `next.block`、把输入块放在 `inputs.<名>.block`，
 * 只数 `blocks.blocks` 的根块会把 78 块的 CCM main 数成 1 块（实测过），
 * 界面上的「N 块」就会与实验目录 README 的数字对不上。
 */
function countBlockTree(node) {
  if (!node || typeof node !== 'object') return 0;
  let count = typeof node.type === 'string' ? 1 : 0;
  if (node.next) count += countBlockTree(node.next.block ?? node.next);
  if (node.inputs) {
    for (const input of Object.values(node.inputs)) {
      count += countBlockTree(input?.block) + countBlockTree(input?.shadow);
    }
  }
  return count;
}

/**
 * 读一份试点工程：结构必须是 ProjectRecord，覆盖报告必须与裁决逐条对得上。
 * 对不上的原因通常只有一个——工程是旧稿（裁决改过而工程没重生成），此时宁可不发布。
 */
function loadPilot(pilot, verdict, counts) {
  assertTracked(pilot.source);
  const text = readFileSync(pilot.source, 'utf8');
  const failPilot = (message) => fail(`${pilot.source}: ${message}`);

  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    failPilot(`不是合法 JSON（${error.message}）`);
    return null;
  }

  if (typeof record.name !== 'string' || !record.name.trim()) failPilot('缺 name');
  if (typeof record.language !== 'string' || !record.language) failPilot('缺 language');
  if (record.format !== 'json') failPilot(`format=${record.format}，本项目只发布 JSON 工作区`);
  if (!Array.isArray(record.files) || record.files.length === 0) {
    failPilot('files 为空');
    return null;
  }

  const fileIds = new Set();
  const files = [];
  for (const file of record.files) {
    if (!file.fileId || !file.name) failPilot(`文件缺 fileId/name：${JSON.stringify(file).slice(0, 80)}`);
    fileIds.add(file.fileId);
    if (typeof file.workspace !== 'string') {
      failPilot(`${file.name}: workspace 不是字符串`);
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(file.workspace);
    } catch (error) {
      failPilot(`${file.name}: workspace 不是合法 JSON（${error.message}）`);
      continue;
    }
    const rootBlocks = payload?.blocks?.blocks;
    if (!Array.isArray(rootBlocks) || rootBlocks.length === 0) {
      failPilot(`${file.name}: workspace 里没有 blocks.blocks`);
      continue;
    }
    files.push({
      fileId: file.fileId,
      name: file.name,
      /** 画布上互不相连的根块数；`blocks` 是含 next/inputs 的积木总数。 */
      roots: rootBlocks.length,
      blocks: rootBlocks.reduce((sum, block) => sum + countBlockTree(block), 0),
      entry: Boolean(file.isEntry),
    });
  }
  if (files.length !== record.files.length) return null;

  if (!record.entryFileId || !fileIds.has(record.entryFileId)) {
    failPilot(`entryFileId=${record.entryFileId} 不在 files 里`);
  }
  const entryFiles = files.filter((file) => file.entry);
  if (entryFiles.length !== 1) failPilot(`isEntry 的文件应恰好 1 个，实际 ${entryFiles.length}`);

  const meta = record.metadata?.aiHelper;
  if (!meta) {
    failPilot('缺 metadata.aiHelper（覆盖报告与锚点在这里）');
    return null;
  }
  if (meta.kind !== 'standards-to-project') failPilot(`kind=${meta.kind}`);
  if (meta.standard?.id !== pilot.standardId) {
    failPilot(`standard.id=${meta.standard?.id}，与登记的 ${pilot.standardId} 不一致`);
  }
  if (meta.semantic_equivalence !== 'unverified') {
    failPilot(`semantic_equivalence=${meta.semantic_equivalence}：「语义等价未验证」必须在工程里写明`);
  }

  const clauseIds = (meta.verdicts ?? []).map((item) => item.clauseId);
  const expectedClauses = verdict.clauses.map((clause) => clause.clauseId);
  for (const id of expectedClauses) {
    if (!clauseIds.includes(id)) failPilot(`覆盖报告缺条款 ${id}`);
  }
  for (const id of clauseIds) {
    if (!expectedClauses.includes(id)) failPilot(`覆盖报告多出条款 ${id}（裁决里没有）`);
  }
  const coverage = meta.coverage ?? {};
  for (const key of ['clauses', 'build', 'partial', 'missing']) {
    const want = key === 'clauses' ? verdict.clauses.length : counts[key];
    if (coverage[key] !== want) failPilot(`coverage.${key} 声明 ${coverage[key]}，裁决是 ${want}`);
  }

  // 剥掉字符串 id：本机主键由 IndexedDB 自增分配，/editor/:id 只认数字。
  const artifact = { ...record };
  delete artifact.id;
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const artifactName = `${pilot.standardId}.json`;
  return {
    artifactName,
    serialized,
    summary: {
      artifact: artifactName,
      standardId: pilot.standardId,
      name: record.name,
      language: record.language,
      entryFileId: record.entryFileId,
      files,
      blocks: files.reduce((sum, file) => sum + file.blocks, 0),
      clauseIds,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      sha256: sha256(serialized),
      source: {
        path: pilot.source,
        sha256: sha256(text),
        bytes: Buffer.byteLength(text, 'utf8'),
      },
    },
  };
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
const pilotArtifacts = [];
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
  const pilot = PILOT_PROJECTS.find((item) => item.standardId === verdict.standard.id);
  if (pilot) {
    const loaded = loadPilot(pilot, verdict, counts);
    if (loaded) {
      verdict.pilot = loaded.summary;
      pilotArtifacts.push(loaded);
    }
  }
  standards.push(verdict);
  generatedFrom.push({ path, sha256: sha256(text), standardId: verdict.standard.id, counts });
}

for (const pilot of PILOT_PROJECTS) {
  if (!standards.some((item) => item.standard?.id === pilot.standardId)) {
    fail(`${pilot.source}: 登记的标准 ${pilot.standardId} 不在 SOURCES 的裁决里`);
  }
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
  note: '三档判据是构建期机器候选，语义等价未验证；签核在人，界面不得把 tier 说成「已覆盖」。pilot 是把同一份切片用现有块搭出来的工程，打开只是在本机复制，不是「生成工作区」。',
  generatedFrom,
  totals: { standards: standards.length, ...totals },
  standards,
};

const serialized = `${JSON.stringify(index, null, 2)}\n`;
const checkOnly = process.argv.includes('--check');
const expectedArtifacts = new Map(
  pilotArtifacts.map((pilot) => [join(PILOT_DIR, pilot.artifactName), pilot.serialized]),
);

if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const staleArtifacts = [...expectedArtifacts].filter(([path, content]) => {
    const onDisk = existsSync(path) ? readFileSync(path, 'utf8') : '';
    return onDisk !== content;
  });
  if (current === serialized && staleArtifacts.length === 0) {
    console.log(
      `VERDICTS_INDEX_CHECK ok（${index.totals.standards} 份标准 / ${index.totals.clauses} 个条款 / ${pilotArtifacts.length} 份试点工程 / hash ${sha256(serialized).slice(0, 16)}）`,
    );
    process.exit(0);
  }
  console.error('VERDICTS_INDEX_CHECK 不一致：源码或裁决 JSON 变了，先跑 npm run verdicts:index');
  if (current !== serialized) {
    console.error(
      `  索引期望 hash ${sha256(serialized).slice(0, 16)}，磁盘上 ${current ? sha256(current).slice(0, 16) : '(缺失)'}`,
    );
  }
  for (const [path] of staleArtifacts) console.error(`  试点工程过期或缺失：${path}`);
  process.exit(1);
}

writeFileSync(OUT, serialized);
mkdirSync(PILOT_DIR, { recursive: true });
for (const [path, content] of expectedArtifacts) writeFileSync(path, content);

// 清单里删掉一份试点工程后，旧制品不能留在 src/ 里继续被打包。
const pruned = readdirSync(PILOT_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => join(PILOT_DIR, name))
  .filter((path) => !expectedArtifacts.has(path));
for (const path of pruned) rmSync(path);

console.log(
  `VERDICTS_INDEX ${OUT} 标准 ${index.totals.standards} / 条款 ${index.totals.clauses} / 能搭 ${index.totals.build} / 部分 ${index.totals.partial} / 不能 ${index.totals.missing} / 缺口 ${index.totals.gaps} / 试点工程 ${pilotArtifacts.length}${pruned.length ? `（清理 ${pruned.length} 份旧制品）` : ''}`,
);
