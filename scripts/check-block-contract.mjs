/**
 * 块契约门禁：直接递归 Blockly 工作区 JSON，逐块对照 docs/blocks/BLOCK-IO-CONTRACT.json。
 *
 * 这个脚本取代 check-block-ir.mjs 的「契约校验」职责：原来它先把工作区拆成扁平 IR 再校验，
 * 现在直接在原始 JSON 上做同样的检查，不再需要 IR 这一中间格式。
 *
 *   node scripts/check-block-contract.mjs              # 校验 + 自检（控制项必须开火）
 *   node scripts/check-block-contract.mjs --no-selftest # 只校验
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const demoRoot = resolve(root, 'demos');
const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));

// 原生块没有契约条目：它们的端口由 Blockly 定义，不在 BLOCK-IO-CONTRACT.json 里。
const NATIVE_BLOCK_TYPES = new Set([
  'procedures_defreturn',
  'procedures_defnoreturn',
  'procedures_callreturn',
  'procedures_callnoreturn',
  'procedures_ifreturn',
  'math_number',
  'variables_get',
  'variables_set',
]);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function inputInfo(type) {
  return new Map((contract[type]?.inputs || []).filter((i) => i.name).map((i) => [i.name, i]));
}

function fieldNames(type) {
  return new Set((contract[type]?.fields || []).map((f) => f.name));
}

function checkConnection(parentType, inputName, child, path, errors) {
  const info = inputInfo(parentType).get(inputName);
  if (!info) {
    errors.push(`${path}: 契约里 ${parentType} 没有名为 ${inputName} 的输入`);
    return;
  }
  if (info.type === 5) {
    errors.push(`${path}: ${parentType}.${inputName} 是 dummy 输入（字段行），不能接子块`);
    return;
  }
  const childOutput = contract[child.type]?.outputCheck || null;
  const parentCheck = info.check || null;
  if (info.type === 3) {
    if (childOutput && childOutput.length) {
      errors.push(`${path}: 输出块 ${child.type} 不能接进语句输入 ${parentType}.${inputName}`);
    }
    return;
  }
  if (info.type === 1 && childOutput && childOutput.length && parentCheck && parentCheck.length) {
    const common = childOutput.filter((label) => parentCheck.includes(label));
    if (!common.length) {
      errors.push(
        `${path}: 类型不匹配，${child.type} 输出 ${childOutput.join('|')} 接不进 ${parentType}.${inputName}（要求 ${parentCheck.join('|')}）`,
      );
    }
  }
}

/** 校验一个工作区文档；返回错误列表（空数组表示通过）。 */
function validateWorkspace(doc, label = 'workspace') {
  const errors = [];
  const blocks = doc?.blocks?.blocks;
  if (!Array.isArray(blocks)) return [`${label}: 缺少 blocks.blocks 数组`];

  const visit = (node, path) => {
    if (!node || typeof node !== 'object') {
      errors.push(`${path}: 不是对象`);
      return;
    }
    if (typeof node.type !== 'string') {
      errors.push(`${path}: 节点缺少 type`);
      return;
    }
    if (!NATIVE_BLOCK_TYPES.has(node.type)) {
      if (!contract[node.type]) {
        errors.push(`${path}: 契约里没有块 ${node.type}`);
        return;
      }
      const allowedFields = fieldNames(node.type);
      for (const name of Object.keys(node.fields || {})) {
        if (!allowedFields.has(name)) errors.push(`${path}: ${node.type} 没有字段 ${name}`);
      }
      for (const [name, child] of Object.entries(node.inputs || {})) {
        if (!name) {
          errors.push(`${path}: 输入名不能为空`);
          continue;
        }
        if (!child || typeof child !== 'object' || !('block' in child)) {
          errors.push(`${path}.inputs[${name}]: 缺少 {"block": …} 包装`);
          continue;
        }
        checkConnection(node.type, name, child.block, `${path}.inputs[${name}]`, errors);
        visit(child.block, `${path}.inputs[${name}]`);
      }
    } else {
      for (const [name, child] of Object.entries(node.inputs || {})) {
        if (!child || typeof child !== 'object' || !('block' in child)) {
          errors.push(`${path}.inputs[${name}]: 缺少 {"block": …} 包装`);
          continue;
        }
        visit(child.block, `${path}.inputs[${name}]`);
      }
    }
    if (node.next !== undefined) {
      if (!node.next || typeof node.next !== 'object' || !('block' in node.next)) {
        errors.push(`${path}.next: 缺少 {"block": …} 包装`);
      } else {
        visit(node.next.block, `${path}.next`);
      }
    }
  };

  blocks.forEach((node, index) => visit(node, `blocks[${index}]`));
  return errors;
}

function collectStats(doc) {
  const stats = { blocks: 0, checked: 0, native: 0 };
  const types = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    stats.blocks += 1;
    if (typeof node.type === 'string') types.add(node.type);
    if (NATIVE_BLOCK_TYPES.has(node.type)) stats.native += 1;
    else stats.checked += 1;
    for (const child of Object.values(node.inputs || {})) visit(child?.block);
    if (node.next?.block) visit(node.next.block);
  };
  for (const node of doc?.blocks?.blocks || []) visit(node);
  return { ...stats, types };
}

function runAll() {
  const registry = Object.keys(readJson(join(demoRoot, 'tests.json'))).sort();
  return registry.map((name) => {
    const doc = readJson(join(demoRoot, name));
    return { name, errors: validateWorkspace(doc, name), stats: collectStats(doc) };
  });
}

function report(results) {
  let blocks = 0;
  let checked = 0;
  let native = 0;
  let failed = 0;
  const types = new Set();
  for (const result of results) {
    blocks += result.stats.blocks;
    checked += result.stats.checked;
    native += result.stats.native;
    for (const type of result.stats.types) types.add(type);
    if (result.errors.length) {
      failed += 1;
      for (const error of result.errors) console.error(`CONTRACT_GATE_ERROR ${result.name}: ${error}`);
    }
  }
  console.log(
    `CONTRACT_GATE_SUMMARY demos=${results.length} blocks=${blocks} checked=${checked} native=${native} types=${types.size} errors=${failed}`,
  );
  return failed;
}

// ─── 自检：变异控制项必须开火 ───────────────────────────────────────────
// 门禁「通过」只有在它能变红时才算证据。这里对真实 Demo 做内存变异，
// 每个变异都必须产出一条包含预期关键字的错误。

function selftest() {
  const sampleName = Object.keys(readJson(join(demoRoot, 'tests.json'))).sort()[0];
  const base = readJson(join(demoRoot, sampleName));
  const clone = () => JSON.parse(JSON.stringify(base));

  const controls = [
    ['未知块类型', (doc) => { doc.blocks.blocks[0].type = 'no_such_block_type'; }, '契约里没有块'],
    ['缺 {"block"} 包装', (doc) => { doc.blocks.blocks[0].inputs = { STACK: doc.blocks.blocks[0].inputs?.STACK ?? {} }; }, '包装'],
    // 空输入名只在非原生块上检查（原生块端口由 Blockly 定义），所以变异要打在契约块上。
    ['空输入名', (doc) => {
      const findContractBlock = (node) => {
        if (!node || typeof node !== 'object') return null;
        for (const child of Object.values(node.inputs || {})) {
          if (child && child.block && !NATIVE_BLOCK_TYPES.has(child.block.type)) return child.block;
          const hit = findContractBlock(child && child.block);
          if (hit) return hit;
        }
        return node.next && node.next.block ? findContractBlock(node.next.block) : null;
      };
      const target = findContractBlock(doc.blocks.blocks[0]);
      if (!target) throw new Error('样例里找不到契约块，无法构造空输入名控制项');
      target.inputs = { ...(target.inputs || {}), '': { block: { type: 'math_number', fields: { NUM: 1 } } } };
    }, '输入名不能为空'],
  ];

  let fired = 0;
  for (const [label, mutate, expect] of controls) {
    const doc = clone();
    mutate(doc);
    const errors = validateWorkspace(doc, 'selftest');
    const hit = errors.some((e) => e.includes(expect));
    if (!hit) console.error(`CONTRACT_GATE_SELFTEST_ERROR ${label}: 控制项未开火（期望包含「${expect}」，实得 ${JSON.stringify(errors)}）`);
    else fired += 1;
  }
  // 正路径：未变异的原始文档必须 0 错误，否则门禁在空跑
  const clean = validateWorkspace(clone(), 'selftest');
  if (clean.length) {
    console.error(`CONTRACT_GATE_SELFTEST_ERROR 正路径: 未变异文档本该 0 错误，实得 ${clean.length} 条：${clean.slice(0, 3).join(' | ')}`);
  } else {
    fired += 1;
  }
  console.log(`CONTRACT_GATE_SELFTEST controls=${controls.length + 1} passed=${fired} sample=${sampleName}`);
  return fired === controls.length + 1 ? 0 : 1;
}

const selftestExit = process.argv.includes('--no-selftest') ? 0 : selftest();
const failed = report(runAll());
process.exitCode = failed || selftestExit ? 1 : 0;
