/**
 * 方言自检：证明 spec.md 能被**确定性解析**回与 ground-truth 等价的工作区。
 *
 * 前三轮的事故是「(then) 行缩进 +1，读起来像嵌套」，两席把它读成了嵌套。本轮改为
 * 「then: 与语句同缩进」，本脚本按该规则实现解析器并做逐块规范比对：
 *   - 若解析结果与真实工作区不同构，说明方言仍有歧义 → 材料不能用；
 *   - 若能同构，说明「缩进 = 嵌套、then: = 后继」是一条可机械执行的规则。
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalWorkspace, sameCanonical } from '../../scripts/lib/block-ir.mjs';

const dir = import.meta.dirname === undefined ? '.' : import.meta.dirname;
const spec = readFileSync(resolve(dir, 'spec.md'), 'utf8');
const groundTruth = JSON.parse(readFileSync(resolve(dir, 'ground-truth.json'), 'utf8'));

/** 从 `pos` 起读一个 JSON 值，返回 [value, nextPos]。 */
function readJson(text, pos) {
  const ch = text[pos];
  if (ch === '"') {
    let i = pos + 1;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i] === '"') {
        return [JSON.parse(text.slice(pos, i + 1)), i + 1];
      } else i += 1;
    }
    throw new Error(`未闭合字符串 @${pos}`);
  }
  if (ch === '{' || ch === '[') {
    let depth = 0;
    let i = pos;
    let inString = false;
    while (i < text.length) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) return [JSON.parse(text.slice(pos, i + 1)), i + 1];
      }
      i += 1;
    }
    throw new Error(`未闭合结构 @${pos}`);
  }
  const match = /^[^\s]+/.exec(text.slice(pos));
  return [JSON.parse(match[0]), pos + match[0].length];
}

/** 解析一行块头：`type [extraState=…] [FIELD=…]`。 */
function parseHead(text) {
  const typeMatch = /^[A-Za-z_][\w]*/.exec(text);
  if (!typeMatch) throw new Error(`无法识别块类型：${text.slice(0, 40)}`);
  const node = { type: typeMatch[0] };
  let pos = typeMatch[0].length;
  for (;;) {
    const rest = text.slice(pos);
    const keyMatch = /^\s+([A-Za-z_][\w]*)=/.exec(rest);
    if (!keyMatch) {
      if (rest.trim() === '') return node;
      throw new Error(`无法识别的尾部：${rest.slice(0, 40)}`);
    }
    const key = keyMatch[1];
    const [value, next] = readJson(text, pos + keyMatch[0].length);
    if (key === 'extraState') node.extraState = value;
    else node.fields = { ...(node.fields || {}), [key]: value };
    pos = next;
  }
}

const roots = [];
const lastAtDepth = [];
let total = 0;
let started = false;

for (const raw of spec.split('\n')) {
  if (raw.startsWith('## ')) {
    started = true;
    continue;
  }
  if (!started) continue;
  if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
  const spaces = raw.length - raw.trimStart().length;
  if (spaces % 2 !== 0) throw new Error(`缩进不是 2 的倍数：${raw.slice(0, 40)}`);
  const depth = spaces / 2;
  const text = raw.trim();
  if (text.startsWith('then: ')) {
    const head = parseHead(text.slice('then: '.length));
    const prev = lastAtDepth[depth];
    if (!prev) throw new Error(`then: 找不到同缩进的前一条语句：${text.slice(0, 40)}`);
    if (prev.next) throw new Error(`同一块出现两个后继：${text.slice(0, 40)}`);
    prev.next = { block: head };
    lastAtDepth[depth] = head;
    lastAtDepth.length = depth + 1;
    total += 1;
    continue;
  }
  const slotMatch = /^([A-Z_][\w]*) -> /.exec(text);
  const slot = slotMatch ? slotMatch[1] : null;
  const head = parseHead(slot ? text.slice(slotMatch[0].length) : text);
  if (slot) {
    const parent = lastAtDepth[depth - 1];
    if (!parent) throw new Error(`槽 ${slot} 找不到父块`);
    parent.inputs = { ...(parent.inputs || {}), [slot]: { block: head } };
  } else if (depth === 0) {
    roots.push(head);
  } else {
    throw new Error(`缩进 ${depth} 处出现无槽名块`);
  }
  lastAtDepth[depth] = head;
  lastAtDepth.length = depth + 1;
  total += 1;
}

const parsed = { blocks: { languageVersion: 0, blocks: roots } };
const identical = sameCanonical(canonicalWorkspace(parsed), canonicalWorkspace(groundTruth));
const parsedNodes = (function count(node) {
  let n = 1;
  for (const child of Object.values(node.inputs || {})) n += count(child.block ?? child);
  if (node.next?.block) n += count(node.next.block);
  return n;
})(roots[0]);

process.stdout.write(`解析块数=${total}（根级 ${roots.length}，节点 ${parsedNodes}）\n`);
process.stdout.write(`与 ground-truth 同构：${identical}\n`);
if (!identical) process.exitCode = 1;
