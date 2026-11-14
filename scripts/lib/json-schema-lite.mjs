/**
 * 本仓库 schema 门禁共用的极简 JSON Schema 校验器。
 *
 * 只实现 `scripts/*.schema.json` 实际用到的关键字：$ref($defs)、const、enum、type、
 * minLength、pattern、minimum、maximum、minItems、maxItems、items、required、
 * properties、additionalProperties=false。
 *
 * 为什么要自己实现而不是引依赖：门禁要能在离线、无 node_modules 的环境里跑，且
 * 「校验了什么」必须一眼可读——列出来的关键字才生效，没列出来的不会被悄悄忽略后
 * 假装通过。新增关键字时同步加实现，否则 schema 里写了也不会开火。
 */
import { readFileSync } from 'node:fs';

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function describeType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function joinPath(base, key) {
  return /^\d+$/.test(String(key)) ? `${base}[${key}]` : `${base}.${key}`;
}

export function validateSchema(value, schema, path, defs, errors) {
  let node = schema;
  if (node && node.$ref) {
    const match = /^#\/\$defs\/(.+)$/.exec(node.$ref);
    if (!match) {
      errors.push(`${path}: 不支持的 $ref ${node.$ref}`);
      return;
    }
    node = defs[match[1]];
    if (!node) {
      errors.push(`${path}: $ref 指向不存在的定义 ${match[1]}`);
      return;
    }
  }
  if (!node || typeof node !== 'object') return;

  if ('const' in node && value !== node.const) {
    errors.push(`${path}: 必须等于 ${JSON.stringify(node.const)}`);
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    errors.push(`${path}: 必须是 ${node.enum.map((item) => JSON.stringify(item)).join(' / ')} 之一，实际 ${JSON.stringify(value)}`);
  }

  if (node.type) {
    const expected = Array.isArray(node.type) ? node.type : [node.type];
    const actual = describeType(value);
    const ok = expected.some((type) => type === actual || (type === 'number' && actual === 'integer'));
    if (!ok) {
      errors.push(`${path}: 类型应为 ${expected.join('|')}，实际 ${actual}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof node.minLength === 'number' && value.length < node.minLength) {
      errors.push(`${path}: 长度至少 ${node.minLength}`);
    }
    if (node.pattern) {
      let pattern = null;
      try {
        pattern = new RegExp(node.pattern, 'u');
      } catch {
        errors.push(`${path}: schema pattern 无法编译: ${node.pattern}`);
      }
      if (pattern && !pattern.test(value)) {
        errors.push(`${path}: 不匹配 ${node.pattern}`);
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof node.minimum === 'number' && value < node.minimum) {
      errors.push(`${path}: 必须 >= ${node.minimum}`);
    }
    if (typeof node.maximum === 'number' && value > node.maximum) {
      errors.push(`${path}: 必须 <= ${node.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof node.minItems === 'number' && value.length < node.minItems) {
      errors.push(`${path}: 至少 ${node.minItems} 项`);
    }
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
      errors.push(`${path}: 至多 ${node.maxItems} 项`);
    }
    if (node.items) {
      value.forEach((item, index) => validateSchema(item, node.items, joinPath(path, index), defs, errors));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = node.properties || {};
    for (const key of node.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: 缺少必填字段`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) {
        validateSchema(child, properties[key], joinPath(path, key), defs, errors);
      } else if (node.additionalProperties === false) {
        errors.push(`${joinPath(path, key)}: 未定义的字段（schema 未声明，禁止自造键）`);
      }
    }
  }
}
