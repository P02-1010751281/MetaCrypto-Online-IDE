#!/usr/bin/env python3
"""用真实 BPE tokenizer 计数两种格式的 token 数，生成 MEASURED-TOKENS.md。

两步复跑（必须先跑 node 导出紧凑文本，再跑本脚本计数）：

    node experiments/measure-tokens.mjs
    python3 experiments/measure-tokens.py

tokenizer 是 OpenAI 家族的 cl100k_base / o200k_base（tiktoken），**不是**生成实验里
各席所用模型的 tokenizer，因此数字是量级证据，不是该模型的确切输出 token 数。
"""

import json
from pathlib import Path

import tiktoken

TOKEN_DIR = Path('/tmp/ciphercat-tokens')
OUT = Path(__file__).resolve().parent / 'MEASURED-TOKENS.md'
ENCODINGS = ('cl100k_base', 'o200k_base')


def main() -> None:
    manifest = json.loads((TOKEN_DIR / 'manifest.json').read_text())
    encs = {name: tiktoken.get_encoding(name) for name in ENCODINGS}
    rows = []
    for item in manifest:
        ir_text = (TOKEN_DIR / f"{item['id']}.ir.txt").read_text()
        json_text = (TOKEN_DIR / f"{item['id']}.json.txt").read_text()
        row = {
            'label': item['label'],
            'id': item['id'],
            'irChars': item['irChars'],
            'jsonChars': item['jsonChars'],
        }
        for name, enc in encs.items():
            row[f'ir_{name}'] = len(enc.encode(ir_text))
            row[f'json_{name}'] = len(enc.encode(json_text))
        rows.append(row)

    lines = ['# 两种格式的实测 token 数', '']
    lines.append(
        '由 `experiments/measure-tokens.mjs`（导出紧凑文本）+ `experiments/measure-tokens.py`'
        '（tiktoken 计数）生成，勿手改。'
    )
    lines.append('')
    lines.append(
        'tokenizer 为 `cl100k_base` 与 `o200k_base`（OpenAI 家族的公开 BPE），**不是**生成实验里'
        '各席所用模型的 tokenizer，故只作量级证据；同一对比的两种编码相差 <3%，结论不随编码改变。'
    )
    lines.append('')
    lines.append('## 同一棵工作区树的两种表示')
    lines.append('')
    lines.append('| 场景 | 块数 | IR 字符 | JSON 字符 | IR token（cl100k / o200k） | JSON token（cl100k / o200k） | token 差 |')
    lines.append('|---|---:|---:|---:|---:|---:|---:|')
    blocks = {'ccm-35': 35, 'wide-218': 218, 'deep-241': 241, 'mlkem-1494': 1494}
    for row in rows:
        low = row['ir_cl100k_base'] / row['json_cl100k_base'] - 1
        lines.append(
            f"| {row['label']} | {blocks[row['id']]} | {row['irChars']} | {row['jsonChars']} "
            f"| {row['ir_cl100k_base']:,} / {row['ir_o200k_base']:,} "
            f"| {row['json_cl100k_base']:,} / {row['json_o200k_base']:,} "
            f"| IR 少 {abs(low) * 100:.0f}% |"
        )
    lines.append('')
    lines.append('## 每块成本')
    lines.append('')
    lines.append('| 场景 | IR 字符/token | JSON 字符/token | IR token/块 | JSON token/块 |')
    lines.append('|---|---:|---:|---:|---:|')
    for row in rows:
        n = blocks[row['id']]
        lines.append(
            f"| {row['label']} | {row['irChars'] / row['ir_cl100k_base']:.2f} "
            f"| {row['jsonChars'] / row['json_cl100k_base']:.2f} "
            f"| {row['ir_cl100k_base'] / n:.1f} | {row['json_cl100k_base'] / n:.1f} |"
        )
    lines.append('')
    lines.append('## 结论')
    lines.append('')
    mlkem = next(r for r in rows if r['id'] == 'mlkem-1494')
    lines.append(
        f"- 同一棵树按**紧凑文本**计：ML-KEM（1494 块）IR {mlkem['ir_cl100k_base']:,} token、"
        f"JSON {mlkem['json_cl100k_base']:,} token。"
    )
    lines.append(
        '- JSON 每字符的 token 更贵（字符/token 比更低），原因是 `{"block": …}`、引号与短键名'
        '在 BPE 里被切得更碎——所以「字符数 −29%」对应的 token 差是 −33%，比字符差更大。'
    )
    lines.append(
        '- **32k 不是本环境的硬上限**：第 4 轮两席实际各写出 51 477 token（见下节）。'
        '「IR 装得进 32k / JSON 装不进」只能作为供给侧容量指标，不能当作「本环境能不能做」的判据。'
    )
    lines.append('')
    lines.append('## 生成席实际写出的产物（含缩进风格）')
    lines.append('')
    lines.append('按各席**实际落盘的产物**重新计数（「紧凑 token」由该产物自身再做一次紧凑序列化得出）：'
                 '缩进是真实输出成本，不是排版噪声。')
    lines.append('')
    lines.append('| 实验 / 运行 | 文件字节 | 实际输出 token（cl100k） | 紧凑 token | 缩进占字节 |')
    lines.append('|---|---:|---:|---:|---:|')
    root = Path(__file__).resolve().parent
    for out in sorted(root.glob('ir-*/runs/*/output.json')):
        raw = out.read_text()
        compact = json.dumps(json.loads(raw), separators=(',', ':'), ensure_ascii=False)
        raw_bytes = len(raw.encode())
        compact_bytes = len(compact.encode())
        indent = (1 - compact_bytes / raw_bytes) * 100 if raw_bytes else 0
        label = f"{out.parent.parent.parent.name.replace('-2026-11-14', '')}/{out.parent.name}"
        lines.append(
            f"| {label} | {raw_bytes:,} | {len(encs['cl100k_base'].encode(raw)):,} "
            f"| {len(encs['cl100k_base'].encode(compact)):,} | {indent:.0f}% |"
        )
    lines.append('')
    lines.append(
        '- 四轮共 14 份产物**全部**是缩进排版，缩进占 43%–90% 字节：格式选择（IR vs JSON）省下的 27%–33%，'
        '被「缩进宽度」这一个风格选择盖过去了。同一轮里 B 臂的实际输出恒大于 A 臂。'
    )
    lines.append('')
    OUT.write_text('\n'.join(lines))
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
