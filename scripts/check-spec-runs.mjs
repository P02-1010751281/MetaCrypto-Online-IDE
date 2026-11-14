/**
 * 运行清单门禁：让「这批结果是哪次运行产生的」可复核。
 *
 * 清单位置：spec-runs/<run-id>/manifest.json（schema 见 scripts/spec-run.schema.json）。
 *
 * 现有的 spec:validate / verify:all 只证明「此刻的树是绿的」，证明不了「这批产出由哪次
 * 运行、读了哪份输入、门禁当时退出码是多少」。没有清单时，改过锚点后重跑与没重跑在仓库
 * 里长得一模一样。
 *
 * 本脚本重算的事实：
 *   1. run_id 必须等于目录名；
 *   2. inputs 的 SHA-256 必须与磁盘逐字节一致（源变了，这次运行的结论就不成立）；
 *   3. outputs / shared 只列路径、必须存在，且不得与 inputs 或彼此重复记账；
 *   4. gates[].cmd 必须真指向 package.json 里的脚本或仓库内已存在的脚本，不能自造门禁名；
 *   5. decision 与退出码必须自洽：gated 要求至少一次门禁且全 0；halted/rejected 要求至少一次非 0。
 *
 * 它不能证明的事（写进文档，不要靠这张清单越权声称）：门禁确实按清单说的运行过。清单与
 * demos/evidence.json 一样是「声明的证据基础」，脚本只能保证它内部自洽、且引用的字节还在。
 * 每轮都会跑负控自检：变异必须让门禁变红，门禁自己能开火才算门禁。
 *
 * 用法：
 *   node scripts/check-spec-runs.mjs              # 校验并自检
 *   node scripts/check-spec-runs.mjs --no-selftest
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import { readJson, validateSchema } from './lib/json-schema-lite.mjs';

const root = process.cwd();
const schemaPath = resolve(root, 'scripts/spec-run.schema.json');
const runsRoot = resolve(root, 'spec-runs');
const packagePath = resolve(root, 'package.json');
const MANIFEST_FILENAME = 'manifest.json';

const args = new Set(process.argv.slice(2));
const runSelftest = !args.has('--no-selftest');

// 这些 provider 值等于「模型没参与」，出现即说明清单在拿空壳字段冒充事实。
const PLACEHOLDER_PROVIDERS = new Set(['offline', 'none', 'n/a', 'na', '-']);

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function discoverRuns() {
  if (!existsSync(runsRoot)) return [];
  const runs = [];
  for (const item of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const candidate = resolve(runsRoot, item.name, MANIFEST_FILENAME);
    if (existsSync(candidate) && statSync(candidate).isFile()) runs.push(candidate);
  }
  return runs.sort();
}

/** 门禁命令必须是仓库里真实存在的脚本，避免清单自造一个不会失败的检查。 */
function unknownGateReason(cmd, scripts) {
  const text = String(cmd).trim();
  const npmRun = /^npm run ([a-z][a-z0-9:_-]*)$/.exec(text);
  if (npmRun) {
    return scripts.has(npmRun[1]) ? null : `package.json 没有脚本 ${npmRun[1]}`;
  }
  const nodeScript = /^node (\S+)$/.exec(text);
  if (nodeScript) {
    return existsSync(resolve(root, nodeScript[1])) ? null : `脚本不存在 ${nodeScript[1]}`;
  }
  return `只接受 "npm run <package.json 脚本>" 或 "node <仓库内脚本>"，实际 ${JSON.stringify(cmd)}`;
}

function checkRun(manifest, manifestFile, context) {
  const errors = [];
  validateSchema(manifest, context.schema, '', context.schema.$defs, errors);
  if (errors.length) return errors;

  const runDir = resolve(manifestFile, '..');
  const expectedId = basename(runDir);
  if (manifest.run_id !== expectedId) {
    errors.push(`run_id: 必须等于目录名 ${expectedId}，实际 ${manifest.run_id}`);
  }
  if (Number.isNaN(Date.parse(manifest.created_at))) {
    errors.push(`created_at: 无法解析为时间 ${manifest.created_at}`);
  }

  // 同一路径只能在 inputs / outputs / shared 里出现一次，重复记账会让「谁改了什么」失真。
  const seen = new Map();
  const claim = (path, kind) => {
    const previous = seen.get(path);
    if (previous) errors.push(`${kind}: 路径 ${path} 已经在 ${previous} 里记过一次`);
    else seen.set(path, kind);
  };

  for (const [index, input] of manifest.inputs.entries()) {
    const label = `inputs[${index}]`;
    claim(input.path, `${label}`);
    const file = resolve(root, input.path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${label}: 文件不存在 ${input.path}`);
      continue;
    }
    const digest = sha256File(file);
    if (digest !== input.sha256) {
      errors.push(`${label}: SHA-256 与磁盘不符 ${input.path}（磁盘 ${digest.slice(0, 16)}… / 清单 ${input.sha256.slice(0, 16)}…）`);
    }
  }

  // 产出一律只列路径，不冻结哈希：SpecCard 与 Demo 工作区会被后续评审改写，冻结它们
  // 会让每次正常修订都把历史清单拖红，最后只能靠「顺手改哈希」绕过，等于没有证据。
  for (const [index, output] of manifest.outputs.entries()) {
    const label = `outputs[${index}]`;
    claim(output.path, `${label}`);
    const file = resolve(root, output.path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${label}: 产出不存在 ${output.path}`);
    }
  }

  for (const [index, shared] of (manifest.shared || []).entries()) {
    const label = `shared[${index}]`;
    claim(shared.path, `${label}`);
    if (!existsSync(resolve(root, shared.path))) {
      errors.push(`${label}: 共享文件不存在 ${shared.path}`);
    }
  }

  if (manifest.model && PLACEHOLDER_PROVIDERS.has(manifest.model.provider.toLowerCase())) {
    errors.push(`model.provider: ${JSON.stringify(manifest.model.provider)} 是占位值；没有调用模型就整段省略 model`);
  }

  for (const [index, gate] of manifest.gates.entries()) {
    const reason = unknownGateReason(gate.cmd, context.scripts);
    if (reason) errors.push(`gates[${index}]: ${reason}`);
  }

  const failing = manifest.gates.filter((gate) => gate.exit !== 0);
  if (manifest.decision === 'gated') {
    if (!manifest.gates.length) errors.push('decision: gated 必须至少记录一次门禁');
    for (const gate of failing) {
      errors.push(`decision: gated 但 "${gate.cmd}" 退出码 ${gate.exit}`);
    }
  } else if (!failing.length) {
    errors.push(`decision: ${manifest.decision} 必须由至少一次非 0 退出的门禁支撑，否则应为 gated`);
  }

  return errors;
}

/** 负控：每个变异都必须让 checkRun 报错。 */
const NEGATIVE_CONTROLS = [
  ['input-hash', (run) => {
    const input = run.inputs[0];
    input.sha256 = (input.sha256[0] === '0' ? '1' : '0') + input.sha256.slice(1);
  }],
  ['input-missing', (run) => {
    run.inputs[0].path = 'spec-runs/does-not-exist-input.pdf';
  }],
  ['output-missing', (run) => {
    run.outputs[0].path = 'spec-runs/does-not-exist.json';
  }],
  ['run-id-mismatch', (run) => {
    run.run_id = 'not-the-directory-name';
  }],
  ['gated-with-failing-gate', (run) => {
    run.gates = [{ cmd: 'npm run spec:validate', exit: 1, summary: 'SPEC_CARD_SUMMARY errors=1' }];
  }],
  ['gated-without-gates', (run) => {
    run.gates = [];
  }],
  ['invented-gate-name', (run) => {
    run.gates = [{ cmd: 'npm run this-gate-does-not-exist', exit: 0, summary: 'OK' }];
  }],
  ['duplicate-output', (run) => {
    run.outputs.push({ ...run.outputs[0] });
  }],
  ['offline-model-shell', (run) => {
    run.model = { provider: 'offline', id: 'none', version: 'n/a' };
  }],
  ['shared-with-hash', (run) => {
    run.shared = [{ path: run.shared?.[0]?.path || run.inputs[0].path, sha256: run.inputs[0].sha256 }];
  }],
];

function runSelfTest(manifest, manifestFile, context) {
  let fired = 0;
  const failures = [];
  for (const [name, mutate] of NEGATIVE_CONTROLS) {
    const clone = JSON.parse(JSON.stringify(manifest));
    try {
      mutate(clone);
    } catch (error) {
      failures.push(`${name}: 变异无法施加（${error.message}），该负控无效`);
      continue;
    }
    const errors = checkRun(clone, manifestFile, context);
    if (errors.length) fired += 1;
    else failures.push(`${name}: 变异后仍然通过，门禁未开火`);
  }
  return { total: NEGATIVE_CONTROLS.length, fired, failures };
}

function main() {
  const schema = readJson(schemaPath);
  const scripts = new Set(Object.keys(readJson(packagePath).scripts || {}));
  const context = { schema, scripts };

  const manifests = discoverRuns();
  if (!manifests.length) {
    console.error(`SPEC_RUN_ERROR 未找到任何 ${MANIFEST_FILENAME}（spec-runs/<run-id>/）`);
    process.exit(1);
  }

  let totalErrors = 0;
  let inputCount = 0;
  let outputCount = 0;
  let sharedCount = 0;
  let gateCount = 0;
  const decisions = [];
  for (const manifestFile of manifests) {
    let manifest;
    try {
      manifest = readJson(manifestFile);
    } catch (error) {
      console.error(`SPEC_RUN_ERROR ${manifestFile}: JSON 解析失败：${error.message}`);
      totalErrors += 1;
      continue;
    }
    const label = manifestFile.slice(root.length + 1);
    const errors = checkRun(manifest, manifestFile, context);
    for (const error of errors) console.error(`SPEC_RUN_ERROR ${label}: ${error}`);
    totalErrors += errors.length;
    inputCount += manifest.inputs?.length || 0;
    outputCount += manifest.outputs?.length || 0;
    sharedCount += manifest.shared?.length || 0;
    gateCount += manifest.gates?.length || 0;
    decisions.push(manifest.decision);
  }

  if (totalErrors === 0 && runSelftest) {
    const firstManifest = readJson(manifests[0]);
    const result = runSelfTest(firstManifest, manifests[0], context);
    for (const failure of result.failures) console.error(`SPEC_RUN_SELFTEST_ERROR ${failure}`);
    if (result.failures.length) totalErrors += result.failures.length;
    else console.log(`SPEC_RUN_SELFTEST controls=${result.total} fired=${result.fired}`);
  }

  const decisionSummary = [...new Set(decisions)].sort().join(',');
  console.log(
    `SPEC_RUN_SUMMARY runs=${manifests.length} inputs=${inputCount} outputs=${outputCount} shared=${sharedCount} gates=${gateCount} decision=${decisionSummary} errors=${totalErrors}`,
  );
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
