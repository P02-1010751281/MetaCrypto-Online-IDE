/** 生成三份实验输入：任务说明、积木契约摘录、两种格式的样例。全部由仓库真实数据生成。 */
import process from 'node:process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flattenWorkspace } from '../../scripts/lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = import.meta.dirname;

const contract = JSON.parse(readFileSync(resolve(root, 'docs/blocks/BLOCK-IO-CONTRACT.json'), 'utf8'));
const card = JSON.parse(readFileSync(resolve(root, 'docs/standards/sp800-38c-ccm/SPEC-CARD.json'), 'utf8'));

// —— 1. 积木契约摘录：CCM 族 7 块 + 两个通用块；另附完整类型清单 ——
const WANTED = ['ccm_encrypt','ccm_decrypt','ccm_b0','ccm_aad_len_prefix','ccm_counter_block','ccm_cbc_mac','ccm_ctr','data_value'];
const lines = ['# 可用积木的端口契约（取自 docs/blocks/BLOCK-IO-CONTRACT.json）', ''];
for (const type of WANTED) {
  const spec = contract[type];
  if (!spec) throw new Error(`契约缺 ${type}`);
  lines.push(`## \`${type}\``);
  lines.push('```json');
  lines.push(JSON.stringify(spec, null, 2));
  lines.push('```', '');
}
lines.push(`## 全部可用的块类型（${Object.keys(contract).length} 个，只能使用这些类型）`, '');
lines.push(Object.keys(contract).sort().join('、'));
lines.push('');
writeFileSync(resolve(out, 'blocks.md'), lines.join('\n'));

// —— 2. 任务说明 ——
writeFileSync(resolve(out, 'task.md'), `# 任务

把 NIST SP 800-38C（CCM）的 7 个条目实现为一个 Blockly 工作区。

必须恰好包含以下 7 个 \`procedures_defreturn\` 过程，\`NAME\` 分别为：

\`CCM_Encrypt\`、\`CCM_B0\`、\`CCM_AAD_PREFIX\`、\`CCM_COUNTER_BLOCK\`、\`CCM_CBC_MAC\`、\`CCM_CTR\`、\`CCM_Decrypt\`

每个过程无参数（\`extraState.params\` 为空数组、\`hasStatements: false\`），通过 \`RETURN\` 输入返回对应原语的结果。
只能使用 \`blocks.md\` 里列出的块类型，不要新增块，不要引用不存在的块。

卡片条目（含伪代码、端口与参数）见 \`spec.json\` 的 \`entries\` 字段；这是你要实现的标准义务。
参数请统一取 SP 800-38C 附录 C **Example 1**：K = 16 字节、N = 7 字节、A = 8 字节、P = 4 字节、Tlen = 4 位组。
\`data_value\` 块用 \`NUM\` 字段承载字面量（字节串写成 \`[0x40,0x41,...]\`，整数写成十进制）。

## 产物

把结果写成当前目录下的 \`output.json\`，除此之外不要写别的文件。格式见 \`format.md\`。
`);

// —— 3. 规格：卡片条目 ——
writeFileSync(resolve(out, 'spec.json'), JSON.stringify({ id: card.id, standard: card.standard.name, entries: card.entries }, null, 2));

// —— 4. 两种格式的样例（同一个真实工作区：XTS-Encrypt，8 个块） ——
const xtsDoc = JSON.parse(readFileSync(resolve(root, 'demos/procedures/XTS-Encrypt.json'), 'utf8'));
const xtsIr = flattenWorkspace(xtsDoc, 'XTS-Encrypt.json');
writeFileSync(resolve(out, 'refs/example.ir.json'), JSON.stringify(xtsIr, null, 2));
writeFileSync(resolve(out, 'refs/example.workspace.json'), JSON.stringify(xtsDoc, null, 2));

const FORMAT_A = `# 产物格式（A 组：扁平 IR）

\`output.json\` 必须是 \`ciphercat.block-ir/v0\`：顶层两个键 \`schema\` 与 \`entry\`（顶层块数组）。
每个节点只允许这些键：\`type\`、\`fields\`、\`extraState\`、\`inputs\`、\`next\`、\`inline\`、\`disabled\`。
**没有 id，也没有 x/y 坐标** —— 组装器会自己补。
\`inputs\` 的值是节点本身（不是 \`{"block": ...}\` 包装）。

完整例子见 \`refs/example.ir.json\`（一个真实工作区：XTS-Encrypt，8 个块）。

## 不要做的事

- 不要读本目录之外的文件（这是评分实验，读了就没有意义）；
- 不要写注释、说明或额外文件，只写 \`output.json\`。
`;

const FORMAT_B = `# 产物格式（B 组：Blockly 工作区序列化）

\`output.json\` 必须是 Blockly 工作区 JSON：\`{"blocks": {"languageVersion": 0, "blocks": [...]}}\`。
每个块需要 \`type\`、**全局唯一** \`id\`、\`x\`/\`y\` 坐标；可选 \`fields\`、\`extraState\`、\`next\`。
输入槽的值是 \`{"block": ...}\` 包装，\`next\` 也是 \`{"block": ...}\` 包装。

完整例子见 \`refs/example.workspace.json\`（同一个真实工作区，注意每个块都有 id 和坐标）。

## 不要做的事

- 不要读本目录之外的文件（这是评分实验，读了就没有意义）；
- 不要写注释、说明或额外文件，只写 \`output.json\`。
`;

// —— 每次运行一个目录：A 组只看到 IR 样例，B 组只看到 JSON 样例 ——
const arms = [
  ['A1', FORMAT_A, 'example.ir.json'],
  ['A2', FORMAT_A, 'example.ir.json'],
  ['B1', FORMAT_B, 'example.workspace.json'],
  ['B2', FORMAT_B, 'example.workspace.json'],
];
mkdirSync(resolve(out, 'runs'), { recursive: true });
for (const [run, format, example] of arms) {
  const dir = resolve(out, 'runs', run);
  mkdirSync(resolve(dir, 'refs'), { recursive: true });
  copyFileSync(resolve(out, 'task.md'), resolve(dir, 'task.md'));
  copyFileSync(resolve(out, 'blocks.md'), resolve(dir, 'blocks.md'));
  copyFileSync(resolve(out, 'spec.json'), resolve(dir, 'spec.json'));
  writeFileSync(resolve(dir, 'format.md'), format);
  copyFileSync(resolve(out, 'refs', example), resolve(dir, 'refs', example));
}

process.stdout.write(`materials written + runs laid out: ${arms.map(([run]) => run).join(', ')}\n`);
