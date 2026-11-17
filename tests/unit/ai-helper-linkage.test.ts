// @vitest-environment node
/**
 * 跨域联动（`src/services/ai-helper/linkage.ts`）的回归：文档结果 ↔ 积木结果互相派生查询词。
 *
 * 钉住四件事：
 *   1. 派生规则本身的形状（标识符交集 / 标签去标点 / 标题回退），用固定夹具；
 *   2. 两条基线数字——`docsearch-eval` 30 题里 29 题派生出的查询词能查到积木，
 *      其中 28 题是词表派生且 top1 落在同名算法块上；
 *   3. 产品判据「有联动的文档不空点」：词表派生的 383 篇文档**每一篇**都能查到 ≥1 个块，
 *      这是界面只在 `linked` 时才显示「查积木」按钮的依据；
 *   4. 块 → 文档的覆盖率（222 个块里 200 个能查到文档，其余是 BM / 高斯消元这类共享数学原语，
 *      仓库里本来就没有对应文档页）。
 *
 * 数字是 2026-11-16 在真实索引上实测的基线（`experiments/ai-helper-2026-11-14/RESULTS.md` §23）。
 * 语料或索引更新后数字会变，改这里必须同步改 RESULTS，不能反过来为了让测试变绿而放宽断言。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDocIndex, searchDocs } from '@/services/ai-helper/doc-search';
import { search } from '@/services/ai-helper/block-search';
import type { BlockIndex, SearchHit } from '@/services/ai-helper/block-search';
import { blockToDocQuery, blockVocabulary, docToBlockLink, docToBlockQuery } from '@/services/ai-helper/linkage';

const ROOT = process.cwd();
const blockIndex = JSON.parse(
  readFileSync(resolve(ROOT, 'src/services/ai-helper/block-index.json'), 'utf8'),
) as BlockIndex;
const docIndex = parseDocIndex(readFileSync(resolve(ROOT, 'src/services/ai-helper/doc-index.json'), 'utf8'));
const vocabulary = blockVocabulary(blockIndex);

const evalCases = JSON.parse(
  readFileSync(resolve(ROOT, 'experiments/ai-helper-2026-11-14/docsearch-eval.json'), 'utf8'),
) as Array<{ q: string; expect: string[] }>;

function blockHitOf(query: string): SearchHit[] {
  return search(blockIndex, { inTypes: [], outTypes: [], text: query, limit: 3 });
}

/** top1 是否就是这条查询词点名的算法块（blockType 或标签里出现该标识符）。 */
function topHitMatchesToken(hits: SearchHit[], tokens: string[]): boolean {
  if (!hits.length) return false;
  const first = hits[0];
  const haystack = [first.blockType, ...first.labels.en, ...first.labels.zh].join(' ').toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

describe('派生规则', () => {
  it('文档 → 积木：取路径/标题里与块词表相交的标识符，长词优先', () => {
    // 455 → 454：ctrl_iterate 的次数从数字字段改成值输入后，块面文字只剩
    // 「Var / i / Loop / Do」，原来的 times 标签随字段一起消失（词表少一个 token）。
    expect(blockVocabulary(blockIndex).size).toBe(454);
    expect(vocabulary.has('sm4')).toBe(true);
    expect(vocabulary.has('addroundkey')).toBe(true);

    expect(
      docToBlockLink({ path: 'docs/standards/gbt32907-SM4/README.md', title: 'SM4 分组密码算法' }, vocabulary),
    ).toEqual({ query: 'sm4', linked: true });

    // 两个相交词：都留下（长词在前），因为块的语义在标题里同时给了原语名。
    expect(
      docToBlockLink(
        { path: 'docs/standards/fips197-AES/03-MixColumns-AddRoundKey.md', title: 'AES — MixColumns 与 AddRoundKey 原语' },
        vocabulary,
      ),
    ).toEqual({ query: 'addroundkey mixcolumns', linked: true });
  });

  it('文档 → 积木：无交集时退回标题原文，并标记 linked=false', () => {
    const link = docToBlockLink({ path: 'docs/guides/SETUP.md', title: '环境搭建与验收指南' }, vocabulary);
    expect(link).toEqual({ query: '环境搭建与验收指南', linked: false });
    expect(docToBlockQuery({ path: 'docs/guides/SETUP.md', title: '环境搭建与验收指南' }, vocabulary)).toBe(
      '环境搭建与验收指南',
    );
  });

  it('积木 → 文档：中文标签优先、去掉占位标点；没有标签时退回 blockType', () => {
    expect(
      blockToDocQuery({ blockType: 'aes_add_round_key', labels: { en: ['AES AddRoundKey(', ', rk:'], zh: ['AES AddRoundKey(', ', rk:'] } }),
    ).toBe('AES AddRoundKey rk');
    expect(blockToDocQuery({ blockType: 'sbox_sub', labels: { en: ['S-box'], zh: ['S-box 替换'] } })).toBe('S-box 替换');
    expect(blockToDocQuery({ blockType: 'foo_bar_baz', labels: { en: [], zh: [] } })).toBe('foo bar baz');
    // 标签只有标点时不能派生出一个空串以外的残渣。
    expect(blockToDocQuery({ blockType: 'x_y', labels: { en: ['(', ')'], zh: [] } })).toBe('x y');
  });
});

describe('文档 → 积木（真实索引）', () => {
  it('词表派生的文档不留空点：383 篇每一篇都查到 ≥1 个块', () => {
    const linked = docIndex.docs.filter(([path, title]) => docToBlockLink({ path, title }, vocabulary).linked);
    expect(linked.length).toBe(383);
    const empty = linked.filter(([path, title]) => blockHitOf(docToBlockQuery({ path, title }, vocabulary)).length === 0);
    expect(empty.map(([path]) => path)).toEqual([]);
  });

  it('docsearch-eval 30 题：29 题能查到积木，词表派生的 28 题 top1 落在同名算法块上', () => {
    let withHits = 0;
    let vocabularyDerived = 0;
    const wrong: string[] = [];
    for (const testCase of evalCases) {
      const doc = docIndex.docs.find(([path]) => path.startsWith(testCase.expect[0] ?? ''));
      if (!doc) continue;
      const [path, title] = doc;
      const link = docToBlockLink({ path, title }, vocabulary);
      const hits = blockHitOf(link.query);
      if (hits.length) withHits += 1;
      if (!link.linked) continue;
      vocabularyDerived += 1;
      if (!topHitMatchesToken(hits, link.query.toLowerCase().split(' '))) {
        wrong.push(`${testCase.expect[0]} q="${link.query}" top1=${hits[0]?.blockType ?? '(无)'}`);
      }
    }
    expect({ withHits, vocabularyDerived, wrong }).toEqual({
      withHits: 29,
      vocabularyDerived: 28,
      wrong: [],
    });
  });
});

describe('积木 → 文档（真实索引）', () => {
  it('222 个块里 200 个能查到 ≥1 篇文档；没命中的 22 个是共享数学原语', () => {
    const missing: string[] = [];
    for (const block of blockIndex.blocks) {
      const query = blockToDocQuery(block);
      if (!searchDocs(docIndex, query, { limit: 3 }).length) missing.push(block.blockType);
    }
    expect(missing.length).toBe(22);
    // 共享数学原语在 docs/ 里本来就没有单独页面（它们在标准页的公式段里出现）。
    expect(missing).toContain('berlekamp_massey');
    expect(missing).toContain('gauss_elim');
    expect(missing).not.toContain('aes_add_round_key');
    expect(missing).not.toContain('sm4_key_schedule');
  });

  it('算法块的首条文档落在它自己的标准页上（可解释，可点击）', () => {
    const expectTop = (blockType: string, pathPrefix: string): void => {
      const block = blockIndex.blocks.find((entry) => entry.blockType === blockType);
      expect(block, blockType).toBeTruthy();
      const hits = searchDocs(docIndex, blockToDocQuery(block!), { limit: 3 });
      expect(hits[0]?.path.startsWith(pathPrefix), `${blockType} → ${hits[0]?.path}`).toBe(true);
    };
    expectTop('aes_add_round_key', 'docs/standards/fips197-AES/');
    expectTop('aes_sub_bytes', 'docs/standards/fips197-AES/');
    expectTop('ascon_hash256', 'docs/standards/sp800-232-ascon/');
  });
});
