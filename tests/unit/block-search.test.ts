// @vitest-environment node
/**
 * 浏览器侧块检索内核（`src/services/ai-helper/block-search.ts`）的回归。
 *
 * 内核是从 `scripts/ai-helper-blocksearch.ts` 抽出来的：脚本仍负责建索引与打表，
 * 前端界面与脚本从此共用同一份打分。这里钉住三件事：
 *   1. 抽出来以后判据没变（脚本 eval / eval-hard 仍 100%，本文件钉住几条代表查询）；
 *   2. 索引是**构建期产物**，与 `BLOCK-IO-CONTRACT.json` 必须同步——契约改了不重建索引要在这里红；
 *   3. 运行时副本（`src/`）与实验留档副本逐字节一致，避免两份索引各说各话。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { search } from '@/services/ai-helper/block-search';
import type { BlockIndex } from '@/services/ai-helper/block-search';

const ROOT = process.cwd();
const PRODUCT_INDEX = resolve(ROOT, 'src/services/ai-helper/block-index.json');
const ARCHIVE_INDEX = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/block-index.json');
const CONTRACT = resolve(ROOT, 'docs/blocks/BLOCK-IO-CONTRACT.json');

const index = JSON.parse(readFileSync(PRODUCT_INDEX, 'utf8')) as BlockIndex;

/** 与脚本 `contentHash` 同一实现（FNV-1a 64）。 */
function contentHash(text: string): string {
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function types(options: Parameters<typeof search>[1]): string[] {
  return search(index, options).map((hit) => hit.blockType);
}

describe('索引新鲜度', () => {
  it('索引记录的契约摘要与当前 BLOCK-IO-CONTRACT.json 一致', () => {
    const actual = contentHash(readFileSync(CONTRACT, 'utf8'));
    expect(index.sources.contract.contentFnv1a64).toBe(actual);
  });

  it('运行时副本与实验留档副本逐字节一致', () => {
    expect(readFileSync(PRODUCT_INDEX)).toEqual(readFileSync(ARCHIVE_INDEX));
  });

  it('规模与块清单一致（222 块、中英标签各 222、58 个块带下拉选项）', () => {
    expect(index.stats.blockTypes).toBe(222);
    expect(index.blocks).toHaveLength(222);
    expect(index.stats.labelCoverage.en).toEqual({ labeled: 222, total: 222 });
    expect(index.stats.labelCoverage.zh).toEqual({ labeled: 222, total: 222 });
    expect(index.stats.localizedZh).toBe(32);
    expect(index.blocks.filter((block) => block.options.length > 0)).toHaveLength(58);
    expect(index.stats.creationErrors).toHaveLength(0);
  });
});

describe('文本检索（术语层展开后仍能命中）', () => {
  it('「模幂」→ nt_mod_pow 排第一', () => {
    expect(types({ inTypes: [], outTypes: [], text: '模幂', limit: 5 })[0]).toBe('nt_mod_pow');
  });

  it('「按位与」→ bit_operation 排第一（算子只在标签/选项里）', () => {
    expect(types({ inTypes: [], outTypes: [], text: '按位与', limit: 5 })[0]).toBe('bit_operation');
  });

  it('「S 盒」→ sbox_sub / sbox 都在前三', () => {
    const top = types({ inTypes: [], outTypes: [], text: 'S 盒', limit: 3 });
    expect(top.slice(0, 2).sort()).toEqual(['sbox', 'sbox_sub']);
  });

  it('查不到的词返回空，不漏出 score=0 的块', () => {
    expect(types({ inTypes: [], outTypes: [], text: 'zzzqqqnotexists', limit: 5 })).toEqual([]);
  });

  it('每条命中都带可解释的 matched 证据', () => {
    const hits = search(index, { inTypes: [], outTypes: [], text: '模幂', limit: 3 });
    expect(hits[0].matched.length).toBeGreaterThan(0);
    for (const hit of hits) {
      for (const reason of hit.matched) {
        expect(reason.evidence.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('结构化过滤（输入/输出类型）', () => {
  it('Bytes → IntList 返回具备该端口组合的块，且纯结构查询不产生分数', () => {
    const hits = search(index, { inTypes: ['Bytes'], outTypes: ['IntList'], text: null, limit: 5 });
    expect(hits[0].blockType).toBe('pq_byte_decode');
    for (const hit of hits) {
      expect(hit.score).toBe(0);
      expect(hit.inputs.some((input) => (input.check ?? []).includes('Bytes'))).toBe(true);
      expect((hit.outputCheck ?? []).includes('IntList')).toBe(true);
    }
  });

  it('端口组合不满足时返回空，而不是放宽条件', () => {
    expect(types({ inTypes: ['SBox'], outTypes: ['String'], text: null, limit: 5 })).toEqual([]);
  });
});
