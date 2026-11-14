/**
 * 大工作区复测的材料构建：
 *   1. 把 7 份真实 Demo 的 procedure 合并成一个 218 块 / 48 过程的工作区（真实块树、合成工作区）；
 *   2. 产出「格式中立」的缩进规格（只写类型 + 字段 + 输入槽，不含 id / 坐标 / {"block":…} 包装）；
 *   3. 产出两臂各自的格式说明 + 一个小样例（取自 CMAC-AES，7 块，不在任务集合内，不泄题）；
 *   4. 产出 ground-truth.json 仅供打分器使用。
 */
import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = import.meta.dirname;

const PICK = [
  'procedures/Goppa-Decode.json',
  'procedures/CCM-Encrypt.json',
  'procedures/PQC-Gaps.json',
  'procedures/Code-Based-Math.json',
  'procedures/Tree-Index.json',
  'procedures/ML-DSA-Primitives.json',
  'procedures/GF2m-Poly.json',
];

const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));

// ——— 合并工作区（真实块树，只做拼接，不改任何节点）———
// 合并后过程名必须唯一：GA/GM/GMod 在 Goppa-Decode 与 Code-Based-Math 各有一份，
// 这里给定义块的 NAME 加来源后缀（块树其余部分原样不动；合并集合里没有 procedures_call* 块，
// 所以不存在需要同步改的引用）。
const RENAME = {
  'procedures/Goppa-Decode.json': { GA: 'GA_GO', GM: 'GM_GO', GMod: 'GMod_GO' },
  'procedures/Code-Based-Math.json': { GA: 'GA_CBM', GM: 'GM_CBM', GMod: 'GMod_CBM' },
};
const blocks = [];
for (const file of PICK) {
  const doc = JSON.parse(readFileSync(resolve(root, 'demos', file), 'utf8'));
  for (const b of doc.blocks.blocks) {
    const renamed = RENAME[file]?.[b.fields?.NAME];
    if (renamed) blocks.push({ ...b, fields: { ...b.fields, NAME: renamed } });
    else blocks.push(b);
  }
}
const groundTruth = { blocks: { languageVersion: 0, blocks } };

const walk = (node, fn) => {
  fn(node);
  for (const child of Object.values(node.inputs || {})) walk(child.block ?? child, fn);
  if (node.next?.block) walk(node.next.block, fn);
};

// ——— 格式中立规格 ———
const q = (v) => JSON.stringify(v);
function renderNode(node, indent, lines, label) {
  const pad = '  '.repeat(indent);
  const parts = [node.type];
  if (node.extraState) parts.push(`extraState=${q(node.extraState)}`);
  const fields = Object.entries(node.fields || {});
  for (const [k, v] of fields) parts.push(`${k}=${q(v)}`);
  lines.push(`${pad}${label ? `${label} -> ` : ''}${parts.join(' ')}`);
  for (const [name, child] of Object.entries(node.inputs || {})) {
    renderNode(child.block ?? child, indent + 1, lines, name);
  }
  if (node.next?.block) {
    lines.push(`${pad}  (then)`);
    renderNode(node.next.block, indent + 1, lines, null);
  }
}

const specLines = ['# 复现任务规格（格式中立）', ''];
specLines.push('每个 `NAME -> 类型 字段="值"` 行是一个块；缩进表示「该输入槽里放这个块」；`(then)` 表示语句链的下一块。');
specLines.push('本文件不含 id、坐标、`{"block": …}` 包装——这些由你在目标格式里自行补。', '');
let totalNodes = 0;
const perProc = [];
for (const top of blocks) {
  const name = top.fields?.NAME || top.type;
  const lines = [];
  const acc = { n: 0 };
  walk(top, () => { acc.n++; });
  totalNodes += acc.n;
  perProc.push({ name, nodes: acc.n });
  specLines.push(`## ${name}（${acc.n} 块）`);
  renderNode(top, 0, lines, null);
  specLines.push(...lines, '');
}
writeFileSync(resolve(out, 'spec.md'), `${specLines.join('\n')}\n`);

// ——— 块契约摘录（任务里出现过的类型）———
// 契约覆盖的块用契约；原生 Blockly 块（math_number / variables_get 等）不在 BLOCK-IO-CONTRACT.json 里，
// 其端口从真实块树的实际出现位置汇总，并在表里标明来源。
const used = new Map();
for (const top of blocks) walk(top, (n) => {
  if (!used.has(n.type)) used.set(n.type, { inputs: new Set(), fields: new Set() });
  const rec = used.get(n.type);
  for (const k of Object.keys(n.inputs || {})) rec.inputs.add(k);
  for (const k of Object.keys(n.fields || {})) rec.fields.add(k);
});

const blockLines = ['# 块端口契约（任务里出现的全部类型）', '', `共 ${used.size} 个块类型。字段名与输入槽名取自真实定义；\`(options)\` 表示枚举取值。原生 Blockly 块没有契约条目，端口按实际块树汇总。`, ''];
blockLines.push('| 类型 | 输入槽 | 字段 | 来源 |', '|---|---|---|---|');
for (const type of [...used.keys()].sort()) {
  const rec = used.get(type);
  const c = contract[type];
  const inputs = c ? (c.inputs || []).map((i) => i.name) : [...rec.inputs];
  const fields = c ? (c.fields || []).map((f) => (f.options ? `${f.name}(${f.options.join('/')})` : f.name)) : [...rec.fields];
  blockLines.push(`| \`${type}\` | ${inputs.length ? inputs.map((s) => `\`${s}\``).join('<br>') : '—'} | ${fields.length ? fields.map((s) => `\`${s}\``).join('<br>') : '—'} | ${c ? '契约' : '原生块'} |`);
}
blockLines.push('');
writeFileSync(resolve(out, 'blocks.md'), `${blockLines.join('\n')}\n`);

// ——— 两臂格式说明 ———
const example = JSON.parse(readFileSync(resolve(root, 'demos/procedures/CMAC-AES.json'), 'utf8'));
const { flattenWorkspace } = await import('../lib/block-ir.mjs');
const exampleIr = flattenWorkspace(example, 'example');
mkdirSync(resolve(out, 'refs'), { recursive: true });
writeFileSync(resolve(out, 'refs/example.ir.json'), `${JSON.stringify(exampleIr, null, 1)}\n`);
writeFileSync(resolve(out, 'refs/example.workspace.json'), `${JSON.stringify(example, null, 1)}\n`);

const formatIr = `# 目标格式：扁平 IR（ciphercat.block-ir/v0）

\`\`\`json
{ "schema": "ciphercat.block-ir/v0", "entry": [ <顶层块>, … ] }
\`\`\`

- 每个块只有这些键：\`type\`（必填）、\`fields\`、\`extraState\`、\`inputs\`、\`next\`（可选）。
- \`inputs\` 的值**直接是子块节点**，不要 \`{"block": …}\` 包装。
- **不要** \`id\`、\`x\`、\`y\`。
- \`fields\` 是「字段名 → 值」对象：**值的 JSON 类型照抄 spec**——spec 写 \`NUM=2\` 就写数字 \`2\`，写 \`NUM="2"\` 才写字符串 \`"2"\`。
- 语句链用 \`next\`（对象，直接是下一块节点）。
- 样例：\`refs/example.ir.json\`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。

- \`extraState.params[].id\` 与 \`variables_get\` 的 \`fields.VAR.id\` 是 spec 直接给出的**字段值**，必须照抄；它们不是块级 id。

**校验**：产物会被 \`experiments/lib/block-ir.mjs\` 的 schema 与契约校验读取。
`;
const formatJson = `# 目标格式：Blockly 工作区 JSON

\`\`\`json
{ "blocks": { "languageVersion": 0, "blocks": [ <顶层块>, … ] } }
\`\`\`

- 每个块：\`type\`（必填）、\`id\`（必填，**全工作区唯一**）、\`fields\`、\`extraState\`、\`inputs\`、\`next\`。
- \`inputs\` 的每个值必须是 \`{ "block": <子块> }\` 包装；\`next\` 同样。
- \`id\`：任意非空字符串，但**不得重复**（218 个块 = 218 个不同 id）。
- \`x\`/\`y\`：只给**顶层**块（任意数字），嵌套块**不要**带坐标。
- \`extraState.params[].id\` 与 \`variables_get\` 的 \`fields.VAR.id\` 是 spec 直接给出的**字段值**，必须照抄；它们不算块 id。
- 样例：\`refs/example.workspace.json\`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。
`;
writeFileSync(resolve(out, 'format-ir.md'), formatIr);
writeFileSync(resolve(out, 'format-json.md'), formatJson);

// ——— 任务书 ———
function renderTask(format) {
  return `# 任务：把规格复现成 218 块的工作区（目标格式：${format === 'ir' ? '扁平 IR' : 'Blockly 工作区 JSON'}）

输入（只读本目录）：
- \`spec.md\`：**格式中立**的块树规格，48 个 procedure、218 个块。每行一个块，缩进等于输入槽嵌套，\`(then)\` 表示语句链。
- \`blocks.md\`：任务里出现的每个块类型的端口名与字段名。
- \`format.md\`：目标序列化格式说明与样例（样例来自 CMAC，不在任务集合内）。

要求：把 \`spec.md\` 的**全部 48 个 procedure** 按顺序完整序列化成目标格式，写到本目录的 \`output.json\`。
- 不增、不删、不改任何块：类型、字段值、输入槽名、嵌套关系必须与 spec 逐字一致；
- 顶层块顺序与 spec 中的 procedure 顺序一致；
- 只写 \`output.json\` 一个文件，不要联网，不要读本目录以外的内容。

完成标准：产物能被对应格式解析，且每个块都能在 \`blocks.md\` 里找到端口与字段。
`;
}
writeFileSync(resolve(out, 'task.ir.md'), renderTask('ir'));
writeFileSync(resolve(out, 'task.json.md'), renderTask('json'));

writeFileSync(resolve(out, 'ground-truth.json'), `${JSON.stringify(groundTruth)}\n`);
writeFileSync(resolve(out, 'per-procedure.json'), `${JSON.stringify(perProc, null, 1)}\n`);

process.stdout.write(`procedures=${blocks.length} nodes=${totalNodes} types=${used.size}\n`);
process.stdout.write(`spec.md=${specLines.join('\n').length}B blocks.md=${blockLines.join('\n').length}B exampleIr=${JSON.stringify(exampleIr).length}B\n`);
