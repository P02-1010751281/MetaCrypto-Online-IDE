/**
 * 扁平 IR 门禁：workspace JSON → IR → workspace JSON 的语义往返。
 *
 * 验收口径（docs/research/AI-HELPER-RESEARCH-2026-11-13.md P0）：
 *   「扁平 IR 的拆解—组装往返，用全部 Demo 验证表达力」。
 * 本门禁逐份 Demo 做四件事：
 *   1. 拆解：workspace JSON → IR（IR 里没有 id/坐标；遇到 v0 表达不了的键直接失败，不静默丢弃）；
 *   2. 形状：IR 必须过 scripts/block-ir.schema.json；
 *   3. 契约：每个块、字段名、输入名必须与 docs/blocks/BLOCK-IO-CONTRACT.json 一致，
 *      声明的输入/输出检查标签必须接得上（值块不能插进语句槽，类型不相交即失败）；
 *   4. 组装：IR → workspace JSON，去掉 id 与布局后必须与原始逐字相等。
 *
 * 每轮跑负控自检：控制项必须让门禁变红，否则「0 错误」没有意义。
 *
 * 用法：
 *   node scripts/check-block-ir.mjs               # 校验 + 自检
 *   node scripts/check-block-ir.mjs --no-selftest # 只校验
 */
import { join, resolve } from 'node:path';
import process from 'node:process';
import { readJson, validateSchema } from './lib/json-schema-lite.mjs';
import {
  IrError,
  assembleIr,
  canonicalWorkspace,
  flattenWorkspace,
  irStats,
  sameCanonical,
  validateIr,
} from './lib/block-ir.mjs';

const root = process.cwd();
const demoRoot = resolve(root, 'demos');
const contract = readJson(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'));
const schema = readJson(resolve(root, 'scripts/block-ir.schema.json'));

const withSelftest = !process.argv.includes('--no-selftest');

function checkOne(name) {
  const doc = readJson(join(demoRoot, name));
  const errors = [];

  let ir;
  try {
    ir = flattenWorkspace(doc, `demos/${name}`);
  } catch (error) {
    if (error instanceof IrError) return { name, errors: [error.message] };
    throw error;
  }

  validateSchema(ir, schema, `ir(${name})`, schema.$defs, errors);
  errors.push(...validateIr(ir, contract));

  const assembled = assembleIr(ir);
  const original = canonicalWorkspace(doc);
  const rebuilt = canonicalWorkspace(assembled);
  if (!sameCanonical(original, rebuilt)) errors.push('往返后语义不一致（组装结果与原始 workspace 的规范化形式不同）');

  return { name, errors, ir, stats: irStats(ir, contract) };
}

function runAll() {
  // 工作区清单以 demos/tests.json 为准（与 verify:demos 同一份登记），避免漏掉根目录下的 Demo。
  const registry = Object.keys(readJson(join(demoRoot, 'tests.json'))).sort();
  const results = registry.map(checkOne);
  return { demos: registry, results };
}

function report({ demos, results }) {
  let blocks = 0;
  let checked = 0;
  let native = 0;
  let failed = 0;
  const types = new Set();
  for (const result of results) {
    if (result.stats) {
      blocks += result.stats.blocks;
      checked += result.stats.checked;
      native += result.stats.native;
      for (const type of collectTypes(result.ir)) types.add(type);
    }
    if (result.errors.length) {
      failed += 1;
      for (const error of result.errors) console.error(`IR_GATE_ERROR ${result.name}: ${error}`);
    }
  }
  console.log(
    `IR_GATE_SUMMARY demos=${demos.length} blocks=${blocks} checked=${checked} native=${native} types=${types.size} roundtrip_ok=${demos.length - failed} errors=${failed}`,
  );
  return failed;
}

function collectTypes(ir) {
  const types = new Set();
  if (!ir) return types;
  const walk = (node) => {
    types.add(node.type);
    for (const child of Object.values(node.inputs || {})) walk(child);
    if (node.next) walk(node.next);
  };
  for (const node of ir.entry) walk(node);
  return types;
}

// ─── 自检：控制项必须开火 ───────────────────────────────────────────────

function expectErrors(label, run, controls) {
  let errors;
  try {
    errors = run();
  } catch (error) {
    errors = [error instanceof IrError ? error.message : `抛出非 IrError: ${error.message}`];
  }
  if (!errors || !errors.length) {
    console.error(`IR_GATE_SELFTEST_ERROR ${label}: 控制项未开火（门禁应当变红）`);
    return false;
  }
  controls.push(label);
  return true;
}

function selftest() {
  const doc = readJson(join(demoRoot, 'procedures/CCM-Encrypt.json'));
  const base = flattenWorkspace(doc);
  const clone = () => JSON.parse(JSON.stringify(base));
  /** 找一个真正受契约约束的节点（procedures_* 是原生块，字段/输入名不受契约检查）。 */
  const findContractNode = (ir) => {
    let found = null;
    const walk = (node) => {
      if (found) return;
      if (contract[node.type]) {
        found = node;
        return;
      }
      for (const child of Object.values(node.inputs || {})) walk(child);
      if (node.next) walk(node.next);
    };
    for (const node of ir.entry) walk(node);
    return found;
  };
  const controls = [];
  let ok = true;

  ok = expectErrors('unknown-block', () => validateIr({ ...clone(), entry: [{ type: 'ccm_does_not_exist' }] }, contract), controls) && ok;
  ok = expectErrors('unknown-field', () => {
    const ir = clone();
    const node = findContractNode(ir);
    if (!node) return [];
    node.fields = { ...(node.fields || {}), NOT_A_FIELD: 'x' };
    return validateIr(ir, contract);
  }, controls) && ok;
  ok = expectErrors('unknown-input', () => {
    const ir = clone();
    const node = findContractNode(ir);
    if (!node) return [];
    node.inputs = { ...(node.inputs || {}), NOT_AN_INPUT: { type: node.type } };
    return validateIr(ir, contract);
  }, controls) && ok;
  ok = expectErrors('empty-input-name', () => {
    const ir = clone();
    const node = findContractNode(ir);
    if (!node) return [];
    node.inputs = { '': { type: node.type } };
    return validateIr(ir, contract);
  }, controls) && ok;
  ok = expectErrors('type-mismatch', () => validateIr({
    schema: 'ciphercat.block-ir/v0',
    entry: [{ type: 'ccm_encrypt', inputs: { KEY: { type: 'ccm_b0', inputs: {} } } }],
  }, contract), controls) && ok;
  ok = expectErrors('value-into-statement', () => validateIr({
    schema: 'ciphercat.block-ir/v0',
    entry: [{ type: 'ctrl_iterate', inputs: { DO: { type: 'ccm_ctr' } } }],
  }, contract), controls) && ok;
  ok = expectErrors('unsupported-key', () => {
    const bad = JSON.parse(JSON.stringify(doc));
    bad.blocks.blocks[0].comment = 'v0 不表达注释';
    return flattenWorkspace(bad).entry;
  }, controls) && ok;
  ok = expectErrors('shadow-slot', () => {
    const bad = JSON.parse(JSON.stringify(doc));
    const holder = bad.blocks.blocks[0];
    const inputName = Object.keys(holder.inputs || {})[0];
    holder.inputs[inputName] = { shadow: holder.inputs[inputName].block };
    return flattenWorkspace(bad).entry;
  }, controls) && ok;
  ok = expectErrors('schema-missing-entry', () => {
    const errors = [];
    validateSchema({ schema: 'ciphercat.block-ir/v0' }, schema, 'ir', schema.$defs, errors);
    return errors;
  }, controls) && ok;
  ok = expectErrors('schema-bad-version', () => {
    const errors = [];
    validateSchema({ schema: 'ciphercat.block-ir/v1', entry: [] }, schema, 'ir', schema.$defs, errors);
    return errors;
  }, controls) && ok;
  ok = expectErrors('roundtrip-detects-field-change', () => {
    const ir = clone();
    const stat = JSON.stringify(canonicalWorkspace(assembleIr(ir)));
    const changed = JSON.parse(JSON.stringify(assembleIr(ir)));
    const walk = (block) => {
      if (block.fields && Object.keys(block.fields).length) {
        const key = Object.keys(block.fields)[0];
        block.fields[key] = String(block.fields[key]) + 'x';
        return true;
      }
      for (const slot of Object.values(block.inputs || {})) if (walk(slot.block)) return true;
      return block.next ? walk(block.next.block) : false;
    };
    walk(changed.blocks.blocks[0]);
    return sameCanonical(JSON.parse(stat), canonicalWorkspace(changed)) ? [] : ['检测到字段改动'];
  }, controls) && ok;

  // 正控：基线 IR 必须通过（否则负控全红也没有意义）。
  const baseline = validateIr(flattenWorkspace(doc), contract);
  if (baseline.length) {
    console.error(`IR_GATE_SELFTEST_ERROR positive-control: 基线 Demo 不通过: ${baseline[0]}`);
    ok = false;
  } else {
    controls.push('positive-control');
  }
  if (!ok) return 1;
  console.log(`IR_GATE_SELFTEST controls=${controls.length} fired=${controls.length}`);
  return 0;
}

const selftestExit = withSelftest ? selftest() : 0;
if (selftestExit !== 0) process.exit(1);

const failed = report(runAll());
if (failed) {
  console.error(`IR_GATE_FAILED demos_with_errors=${failed}`);
  process.exit(1);
}
