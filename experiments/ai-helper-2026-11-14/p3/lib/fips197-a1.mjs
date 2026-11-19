/**
 * 从仓库内 FIPS 197 语料机械提取附录 A.1「Expansion of a 128-bit Key」的 44 个字
 * （w0..w43 = 176 字节），供 V3 向量与阻断记录使用。
 *
 * 语料：docs/standards/fips197-AES/00-Standard-Source.md（FIPS 197-upd1 提取稿）
 * 锚点：行 1362（A.1 标题）– 行 1422（w43）；印刷页 29–30
 * 提取规则（不改写、不查表、不凭记忆）：
 *   - w0..w3 取 `wN = xxxxxxxx` 形式的那一行（语料行 1367）；
 *   - w4..w43 取表格每行的**最后一个** 8 位十六进制字：该表的最后一列就是
 *     `w[i] = temp ⊕ w[i−Nk]`（表头行 1369 的最后一列）；
 *   - 行首的十进制 i 必须与表格顺序一致，防止错行。
 * 断言：44 个字、每个恰 8 位十六进制、互不相同、前 4 个字与同一页给出的 Key 字节一致。
 *
 * 为什么需要这个模块：FIPS 197-upd1 已删附录 C，仓库语料里唯一给出完整 176 字节
 * 轮密钥表的地方就是 A.1；把提取写成可复跑代码，读数才不依赖人工抄写。
 */
import fs from 'node:fs';
import path from 'node:path';

export const A1_ANCHOR = {
  file: 'docs/standards/fips197-AES/00-Standard-Source.md',
  startLine: 1362,
  endLine: 1422,
  printedPages: '29-30',
  keyLinePattern: /^\s*Key\s*=\s*([0-9a-f]{2}(?:\s+[0-9a-f]{2}){15})\s*$/i,
  tableHeaderLine: 1369,
};

const HEX_WORD = /^[0-9a-f]{8}$/;

export function extractA1(sourceText, anchor = A1_ANCHOR) {
  const lines = sourceText.split('\n');
  const section = lines.slice(anchor.startLine - 1, anchor.endLine);
  const words = new Map();
  let keyHex = null;

  for (let i = 0; i < section.length; i += 1) {
    const line = section[i];
    if (keyHex == null) {
      const km = anchor.keyLinePattern.exec(line);
      if (km) keyHex = km[1].replace(/\s+/g, '').toLowerCase();
    }
    for (const m of line.matchAll(/\bw(\d+)\s*=\s*([0-9a-f]{8})\b/gi)) {
      const idx = Number(m[1]);
      if (idx < 0 || idx > 43) throw new Error(`A.1 里出现越界字下标 w${idx}（行 ${anchor.startLine + i}）`);
      if (words.has(idx)) throw new Error(`A.1 里 w${idx} 重复出现（行 ${anchor.startLine + i}）`);
      words.set(idx, m[2].toLowerCase());
    }
    const rm = /^\s*(\d{1,2})\s+/.exec(line);
    if (rm) {
      const idx = Number(rm[1]);
      const toks = line.trim().split(/\s+/);
      const hexes = toks.filter((t) => HEX_WORD.test(t));
      if (idx >= 4 && idx <= 43 && hexes.length > 0) {
        if (words.has(idx)) throw new Error(`A.1 表格行 ${idx} 与 w${idx} 行重复`);
        words.set(idx, hexes[hexes.length - 1]);
      }
    }
  }

  const missing = [];
  for (let i = 0; i < 44; i += 1) if (!words.has(i)) missing.push(i);
  if (missing.length > 0) throw new Error(`A.1 提取缺字：${missing.join(',')}`);
  const ordered = Array.from({ length: 44 }, (_, i) => words.get(i));
  const hex = ordered.join('');
  if (hex.length !== 352) throw new Error(`A.1 提取长度异常：${hex.length} hex 字符（应为 352 = 176 字节）`);
  if (new Set(ordered).size !== 44) throw new Error('A.1 提取出重复字，表格最后一列解析不可信');
  if (!keyHex) throw new Error('A.1 段落里找不到 Key = ... 行');
  if (ordered.slice(0, 4).join('') !== keyHex) {
    throw new Error(`A.1 前 4 个字 ${ordered.slice(0, 4).join('')} 与 Key 字节 ${keyHex} 不一致`);
  }

  return {
    anchor,
    keyHex,
    words: ordered,
    hex,
    bytes: hex.length / 2,
    roundKeys: Array.from({ length: 11 }, (_, r) => ordered.slice(r * 4, r * 4 + 4).join('')),
    checks: {
      wordCount: ordered.length,
      uniqueWords: new Set(ordered).size,
      firstFourMatchKey: true,
      bytes: hex.length / 2,
    },
  };
}

export function readCorpus(root) {
  const p = path.join(root, A1_ANCHOR.file);
  return { path: p, text: fs.readFileSync(p, 'utf8') };
}

export function extractA1FromRoot(root) {
  const { path: corpusPath, text } = readCorpus(root);
  return { ...extractA1(text), corpusPath };
}
