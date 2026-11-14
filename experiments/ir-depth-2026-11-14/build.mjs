/**
 * 深度复测的材料构建：从 ML-KEM（全仓唯一深样本）里截取一段真实语句链。
 *
 * ML_KEM_Encaps 是 procedures_defreturn + 28 条 variables_set 的 STACK 链（表达式侧最深只有 6），
 * 所以这份代码库里「深」= 语句链，不是表达式嵌套。本任务截取前 17 条语句：
 * 239 块 + RETURN 1 块 + 定义 1 块 = 241 块，next 链深 17。
 * 语义不完整（后面的语句引用前面的变量），任务是序列化，不是执行。
 */
import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { flattenWorkspace } from '../../scripts/lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = import.meta.dirname;
const STATEMENTS = 17;

const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));
const source = JSON.parse(readFileSync(resolve(root, 'demos/procedures/ML-KEM-Encaps.json'), 'utf8'));
const original = source.blocks.blocks[0];

// ——— 取前 N 条语句，切断链尾 ———
const chain = [];
for (let cur = original.inputs.STACK.block; cur && chain.length < STATEMENTS; cur = cur.next?.block ?? null) chain.push(cur);
const last = JSON.parse(JSON.stringify(chain.at(-1)));
const stripNext = (n) => { delete n.next; for (const c of Object.values(n.inputs || {})) stripNext(c.block ?? c); return n; };
stripNext(last);
const stack = JSON.parse(JSON.stringify(chain.slice(0, -1).concat([last]))).reduceRight((nextBlock, statement) => {
  if (!nextBlock) return statement;
  statement.next = { block: nextBlock };
  return statement;
}, null);

const procedure = {
  type: 'procedures_defreturn',
  extraState: { params: [], hasStatements: true },
  fields: { NAME: 'MLKEM_SEG' },
  inputs: { STACK: { block: stack }, RETURN: JSON.parse(JSON.stringify(original.inputs.RETURN)) },
};
const groundTruth = { blocks: { languageVersion: 0, blocks: [procedure] } };

const walk = (node, fn) => {
  fn(node);
  for (const child of Object.values(node.inputs || {})) walk(child.block ?? child, fn);
  if (node.next?.block) walk(node.next.block, fn);
};
const acc = { nodes: 0, depth: 0, nextHops: 0 };
(function measure(node, depth) {
  acc.nodes++; acc.depth = Math.max(acc.depth, depth);
  for (const child of Object.values(node.inputs || {})) measure(child.block ?? child, depth + 1);
  if (node.next?.block) { acc.nextHops++; measure(node.next.block, depth); }
})(procedure, 0);

// ——— 格式中立规格 ———
const q = (v) => JSON.stringify(v);
function render(node, indent, lines, label) {
  const pad = '  '.repeat(indent);
  const parts = [node.type];
  if (node.extraState) parts.push(`extraState=${q(node.extraState)}`);
  for (const [k, v] of Object.entries(node.fields || {})) parts.push(`${k}=${q(v)}`);
  lines.push(`${pad}${label ? `${label} -> ` : ''}${parts.join(' ')}`);
  for (const [name, child] of Object.entries(node.inputs || {})) render(child.block ?? child, indent + 1, lines, name);
  if (node.next?.block) {
    lines.push(`${pad}  (then)`);
    render(node.next.block, indent + 1, lines, null);
  }
}

const specLines = ['# 复现任务规格（格式中立）', ''];
specLines.push('每个 `NAME -> 类型 字段="值"` 行是一个块；缩进表示「该输入槽里放这个块」；`(then)` 表示语句链的下一块。');
specLines.push('本文件不含 id、坐标、`{"block": …}` 包装——这些由你在目标格式里自行补。', '');
specLines.push(`## MLKEM_SEG（${acc.nodes} 块）`);
const body = [];
render(procedure, 0, body, null);
specLines.push(...body, '');
writeFileSync(resolve(out, 'spec.md'), `${specLines.join('\n')}\n`);

// ——— 块契约摘录 ———
const used = new Map();
walk(procedure, (n) => {
  if (!used.has(n.type)) used.set(n.type, { inputs: new Set(), fields: new Set() });
  const rec = used.get(n.type);
  for (const k of Object.keys(n.inputs || {})) rec.inputs.add(k);
  for (const k of Object.keys(n.fields || {})) rec.fields.add(k);
});
const blockLines = ['# 块端口契约（任务里出现的全部类型）', '', `共 ${used.size} 个块类型。`, '', '| 类型 | 输入槽 | 字段 | 来源 |', '|---|---|---|---|'];
for (const type of [...used.keys()].sort()) {
  const rec = used.get(type);
  const c = contract[type];
  const inputs = c ? (c.inputs || []).map((i) => i.name) : [...rec.inputs];
  const fields = c ? (c.fields || []).map((f) => (f.options ? `${f.name}(${f.options.join('/')})` : f.name)) : [...rec.fields];
  blockLines.push(`| \`${type}\` | ${inputs.length ? inputs.map((s) => `\`${s}\``).join('<br>') : '—'} | ${fields.length ? fields.map((s) => `\`${s}\``).join('<br>') : '—'} | ${c ? '契约' : '原生块'} |`);
}
blockLines.push('');
writeFileSync(resolve(out, 'blocks.md'), `${blockLines.join('\n')}\n`);

// ——— 两臂格式说明（沿用上一轮修正后的措辞）———
const example = JSON.parse(readFileSync(resolve(root, 'demos/procedures/CMAC-AES.json'), 'utf8'));
const exampleIr = flattenWorkspace(example, 'example');
writeFileSync(resolve(out, 'refs/example.ir.json'), `${JSON.stringify(exampleIr, null, 1)}\n`);
writeFileSync(resolve(out, 'refs/example.workspace.json'), `${JSON.stringify(example, null, 1)}\n`);

writeFileSync(resolve(out, 'format-ir.md'), `# 目标格式：扁平 IR（ciphercat.block-ir/v0）

\`\`\`json
{ "schema": "ciphercat.block-ir/v0", "entry": [ <顶层块>, … ] }
\`\`\`

- 每个块只有这些键：\`type\`（必填）、\`fields\`、\`extraState\`、\`inputs\`、\`next\`（可选）。
- \`inputs\` 的值**直接是子块节点**，不要 \`{"block": …}\` 包装。
- **不要** \`id\`、\`x\`、\`y\`。
- \`fields\` 是「字段名 → 值」对象：**值的 JSON 类型照抄 spec**——spec 写 \`NUM=2\` 就写数字 \`2\`，写 \`NUM="2"\` 才写字符串 \`"2"\`。
- 语句链用 \`next\`：**\`next\` 的值直接是下一块节点**（不是 \`{"block": …}\`）。链的最后一块不要 \`next\` 键。
- \`extraState.params[].id\` 与 \`variables_get\` 的 \`fields.VAR.id\` 是 spec 直接给出的**字段值**，必须照抄；它们不是块级 id。
- 样例：\`refs/example.ir.json\`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。
`);

writeFileSync(resolve(out, 'format-json.md'), `# 目标格式：Blockly 工作区 JSON

\`\`\`json
{ "blocks": { "languageVersion": 0, "blocks": [ <顶层块>, … ] } }
\`\`\`

- 每个块：\`type\`（必填）、\`id\`（必填，**全工作区唯一**）、\`fields\`、\`extraState\`、\`inputs\`、\`next\`。
- \`inputs\` 的每个值必须是 \`{ "block": <子块> }\` 包装。
- \`next\` 也必须是 \`{ "block": <下一块> }\` 包装；链的最后一块不要 \`next\` 键。
- \`id\`：任意非空字符串，但**不得重复**（共 ${acc.nodes} 个块 = ${acc.nodes} 个不同 id）。
- \`x\`/\`y\`：只给**顶层**块（任意数字），嵌套块**不要**带坐标。
- \`extraState.params[].id\` 与 \`variables_get\` 的 \`fields.VAR.id\` 是 spec 直接给出的**字段值**，必须照抄；它们不算块 id。
- 样例：\`refs/example.workspace.json\`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。
`);

const task = (name, blocks) => `# 任务：把规格复现成 ${blocks} 块的工作区（含 ${STATEMENTS} 条语句的链）

输入（只读本目录）：
- \`spec.md\`：**格式中立**的块树规格，1 个 procedure、${blocks} 个块。每行一个块，缩进等于输入槽嵌套，\`(then)\` 表示语句链的下一块。
- \`blocks.md\`：任务里出现的每个块类型的端口名与字段名。
- \`format.md\`：目标序列化格式说明与样例（样例来自 CMAC，不在任务集合内）。

要求：把 \`spec.md\` 的整棵树完整序列化成目标格式，写到本目录的 \`output.json\`。
- 不增、不删、不改任何块：类型、字段值、输入槽名、嵌套关系、\`(then)\` 链的先后顺序必须与 spec 逐字一致；
- 只写 \`output.json\` 一个文件，不要联网，不要读本目录以外的内容。

完成标准：产物能被对应格式解析，且每个块都能在 \`blocks.md\` 里找到端口与字段。
`;
writeFileSync(resolve(out, 'task.ir.md'), task('ir', acc.nodes));
writeFileSync(resolve(out, 'task.json.md'), task('json', acc.nodes));
writeFileSync(resolve(out, 'ground-truth.json'), `${JSON.stringify(groundTruth)}\n`);

for (const run of ['A1', 'A2', 'B1', 'B2']) {
  const dir = resolve(out, 'runs', run);
  mkdirSync(resolve(dir, 'refs'), { recursive: true });
  for (const f of ['spec.md', 'blocks.md']) writeFileSync(resolve(dir, f), readFileSync(resolve(out, f)));
  for (const f of ['example.ir.json', 'example.workspace.json']) writeFileSync(resolve(dir, 'refs', f), readFileSync(resolve(out, 'refs', f)));
  const arm = run.startsWith('A') ? 'ir' : 'json';
  writeFileSync(resolve(dir, 'task.md'), readFileSync(resolve(out, `task.${arm}.md`)));
  writeFileSync(resolve(dir, 'format.md'), readFileSync(resolve(out, `format-${arm}.md`)));
}

process.stdout.write(`nodes=${acc.nodes} depth=${acc.depth} nextHops=${acc.nextHops} statements=${STATEMENTS} types=${used.size}\n`);
process.stdout.write(`spec.md=${specLines.join('\n').length}B blocks.md=${blockLines.join('\n').length}B\n`);
