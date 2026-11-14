/**
 * 扁平 IR（block-ir v0）的拆解 / 组装 / 校验。
 *
 * 设计目的（见 docs/research/AI-HELPER-RESEARCH-2026-11-13.md §4.4.1）：
 * 让生成方只产出「块类型 + 字段 + 子槽」这样的扁平结构，布局、id 与序列化细节
 * 由确定性组装器补齐，而不是让模型直接写整份 workspace JSON。
 *
 * 本模块只做三件事，全部是纯函数，不依赖 Blockly：
 *   flattenWorkspace(doc)  workspace JSON → IR（丢掉 id/x/y，遇未知键直接抛错，不静默丢数据）
 *   assembleIr(ir)         IR → 可按 Blockly serialization 加载的 workspace JSON
 *   validateIr(ir, contract) 用 BLOCK-IO-CONTRACT.json 校验块/字段/输入名与连接类型
 *
 * 边界：v0 不支持 shadow 块与注释；遇到就抛错而不是丢弃——「表达不了」必须显式暴露。
 */

const BLOCK_KEYS = new Set(['type', 'id', 'x', 'y', 'fields', 'extraState', 'inputs', 'next', 'inline', 'disabled']);
const SLOT_KEYS = new Set(['block']);

/** 原生 Blockly 身份：不进 BLOCK-IO-CONTRACT.json，但 Demo 会用到。 */
export const NATIVE_BLOCK_TYPES = new Set([
  'procedures_defreturn',
  'procedures_defnoreturn',
  'procedures_callreturn',
  'procedures_callnoreturn',
  'procedures_ifreturn',
  'math_number',
  'variables_get',
  'variables_set',
]);

export class IrError extends Error {}

function fail(path, message) {
  throw new IrError(`${path}: ${message}`);
}

function flattenNode(block, path) {
  if (!block || typeof block !== 'object') fail(path, '块节点不是对象');
  for (const key of Object.keys(block)) {
    if (!BLOCK_KEYS.has(key)) fail(path, `v0 不支持的块字段 ${JSON.stringify(key)}（拒绝静默丢弃）`);
  }
  if (typeof block.type !== 'string' || !block.type) fail(path, '缺少块类型 type');
  const node = { type: block.type };
  if (block.fields && Object.keys(block.fields).length) {
    node.fields = {};
    for (const [name, value] of Object.entries(block.fields)) node.fields[name] = value;
  }
  if (block.extraState && Object.keys(block.extraState).length) {
    node.extraState = JSON.parse(JSON.stringify(block.extraState));
  }
  if (block.inline === true) node.inline = true;
  if (block.disabled === true) node.disabled = true;
  if (block.inputs) {
    node.inputs = {};
    for (const [name, slot] of Object.entries(block.inputs)) {
      for (const key of Object.keys(slot || {})) {
        if (!SLOT_KEYS.has(key)) {
          fail(`${path}.inputs[${JSON.stringify(name)}]`, `v0 只支持 block 槽，不支持 ${JSON.stringify(key)}`);
        }
      }
      if (!slot || !slot.block) fail(`${path}.inputs[${JSON.stringify(name)}]`, '槽里没有 block');
      node.inputs[name] = flattenNode(slot.block, `${path}.inputs[${JSON.stringify(name)}]`);
    }
  }
  if (block.next) {
    if (!block.next.block) fail(`${path}.next`, 'next 槽里没有 block');
    node.next = flattenNode(block.next.block, `${path}.next`);
  }
  return node;
}

export function flattenWorkspace(doc, source = '') {
  if (!doc || typeof doc !== 'object') fail('workspace', '不是对象');
  const blocks = doc.blocks?.blocks;
  if (!Array.isArray(blocks)) fail('workspace.blocks.blocks', '缺少顶层块数组');
  const ir = { schema: 'ciphercat.block-ir/v0', entry: blocks.map((block, index) => flattenNode(block, `entry[${index}]`)) };
  if (source) ir.source = source;
  return ir;
}

let assembleCounter = 0;

function assembleNode(node) {
  assembleCounter += 1;
  const out = { type: node.type, id: `ir-${String(assembleCounter).padStart(5, '0')}` };
  if (node.fields) out.fields = { ...node.fields };
  if (node.extraState) out.extraState = JSON.parse(JSON.stringify(node.extraState));
  if (node.inline) out.inline = true;
  if (node.disabled) out.disabled = true;
  if (node.inputs) {
    out.inputs = {};
    for (const [name, child] of Object.entries(node.inputs)) out.inputs[name] = { block: assembleNode(child) };
  }
  if (node.next) out.next = { block: assembleNode(node.next) };
  return out;
}

/** IR → workspace JSON；id 与坐标由组装器确定，输入顺序保持 IR 里的键序。 */
export function assembleIr(ir) {
  assembleCounter = 0;
  const entry = ir.entry.map((node, index) => {
    const block = assembleNode(node);
    block.x = 60;
    block.y = 60 + index * 320;
    return block;
  });
  return { blocks: { languageVersion: 0, blocks: entry } };
}

function sortObject(object) {
  const out = {};
  for (const key of Object.keys(object).sort()) out[key] = object[key];
  return out;
}

function canonicalNode(block) {
  const out = { type: block.type };
  if (block.fields) out.fields = sortObject(block.fields);
  if (block.extraState) out.extraState = sortObject(block.extraState);
  if (block.inline === true) out.inline = true;
  if (block.disabled === true) out.disabled = true;
  if (block.inputs) {
    out.inputs = {};
    for (const name of Object.keys(block.inputs).sort()) out.inputs[name] = canonicalNode(block.inputs[name].block);
  }
  if (block.next?.block) out.next = canonicalNode(block.next.block);
  return out;
}

/** 语义规范化：去掉 id 与布局，其余逐字保留，用于往返比较。 */
export function canonicalWorkspace(doc) {
  return { entry: doc.blocks.blocks.map(canonicalNode) };
}

export function sameCanonical(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contractInputInfo(contract, type) {
  return new Map((contract[type]?.inputs || []).filter((input) => input.name).map((input) => [input.name, input]));
}

function contractFieldNames(contract, type) {
  return new Set((contract[type]?.fields || []).map((field) => field.name));
}

function checkConnection(parentType, inputName, child, contract, path, errors) {
  const info = contractInputInfo(contract, parentType).get(inputName);
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
      errors.push(`${path}: 类型不匹配，${child.type} 输出 ${childOutput.join('|')} 接不进 ${parentType}.${inputName}（要求 ${parentCheck.join('|')}）`);
    }
  }
}

function validateNode(node, contract, isRoot, path, errors) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    errors.push(`${path}: 节点缺少 type`);
    return;
  }
  if (!NATIVE_BLOCK_TYPES.has(node.type)) {
    const spec = contract[node.type];
    if (!spec) {
      errors.push(`${path}: 契约里没有块 ${node.type}`);
      return;
    }
    const fields = contractFieldNames(contract, node.type);
    for (const name of Object.keys(node.fields || {})) {
      if (!fields.has(name)) errors.push(`${path}: ${node.type} 没有字段 ${name}`);
    }
    for (const [name, child] of Object.entries(node.inputs || {})) {
      if (!name) errors.push(`${path}: 输入名不能为空`);
      else checkConnection(node.type, name, child, contract, `${path}.inputs[${name}]`, errors);
      validateNode(child, contract, false, `${path}.inputs[${name}]`, errors);
    }
  } else if (node.inputs) {
    for (const [name, child] of Object.entries(node.inputs)) validateNode(child, contract, false, `${path}.inputs[${name}]`, errors);
  }
  if (node.next) validateNode(node.next, contract, false, `${path}.next`, errors);
  if (isRoot && node.type && NATIVE_BLOCK_TYPES.has(node.type) === false && !node.type.startsWith('procedures_')) {
    // 顶层块没有形状约束，仅记录；真正的检查在节点级完成。
  }
}

/** 用块契约校验 IR；返回错误列表（空数组表示通过）。 */
export function validateIr(ir, contract) {
  const errors = [];
  if (!ir || ir.schema !== 'ciphercat.block-ir/v0') errors.push('schema: 必须等于 "ciphercat/block-ir/v0"');
  if (!Array.isArray(ir?.entry)) {
    errors.push('entry: 必须是数组');
    return errors;
  }
  ir.entry.forEach((node, index) => validateNode(node, contract, true, `entry[${index}]`, errors));
  return errors;
}

/** 统计：块数、表达式块/语句块、被跳过的原生身份，供门禁打印。 */
export function irStats(ir, contract) {
  const stats = { blocks: 0, native: 0, checked: 0, types: new Set() };
  const walk = (node) => {
    stats.blocks += 1;
    stats.types.add(node.type);
    if (NATIVE_BLOCK_TYPES.has(node.type)) stats.native += 1;
    else if (contract[node.type]) stats.checked += 1;
    for (const child of Object.values(node.inputs || {})) walk(child);
    if (node.next) walk(node.next);
  };
  for (const node of ir.entry || []) walk(node);
  return { blocks: stats.blocks, native: stats.native, checked: stats.checked, types: stats.types.size };
}
