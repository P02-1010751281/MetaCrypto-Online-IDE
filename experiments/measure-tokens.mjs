/**
 * 把同一棵工作区树分别导出成两种格式的**紧凑**文本，供真实 tokenizer 计数。
 * 依赖：只读 demos/ 与各实验的 ground-truth.json，写临时目录 /tmp/ciphercat-tokens。
 * 计数由 measure-tokens.py（tiktoken cl100k_base）完成；本脚本不含任何模型调用。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { flattenWorkspace } from './lib/block-ir.mjs';

const root = resolve(import.meta.dirname, '..');
const outDir = '/tmp/ciphercat-tokens';
mkdirSync(outDir, { recursive: true });

const cases = [
  { id: 'ccm-35', label: '浅层·CCM（35 块）', file: 'demos/procedures/CCM-Encrypt.json' },
  { id: 'wide-218', label: '宽·合并（218 块）', file: 'experiments/ir-large-2026-11-14/ground-truth.json' },
  { id: 'deep-241', label: '深·语句链（241 块）', file: 'experiments/ir-depth-2026-11-14/ground-truth.json' },
  { id: 'mlkem-1494', label: '全量·ML-KEM（1494 块）', file: 'demos/procedures/ML-KEM-Encaps.json' },
];

const rows = [];
for (const item of cases) {
  const doc = JSON.parse(readFileSync(resolve(root, item.file), 'utf8'));
  const irText = JSON.stringify(flattenWorkspace(doc));
  const jsonText = JSON.stringify(doc);
  writeFileSync(resolve(outDir, `${item.id}.ir.txt`), irText);
  writeFileSync(resolve(outDir, `${item.id}.json.txt`), jsonText);
  rows.push({
    id: item.id,
    label: item.label,
    file: item.file,
    irChars: irText.length,
    jsonChars: jsonText.length,
  });
}

writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(rows, null, 2)}\n`);
for (const r of rows) {
  process.stdout.write(`${r.label}: IR ${r.irChars} 字符 / JSON ${r.jsonChars} 字符\n`);
}
process.stdout.write(`写出目录：${outDir}\n`);
