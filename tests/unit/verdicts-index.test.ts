/**
 * A 线「标准 → 工作区」只读制品：结构、计数与新鲜度的门禁。
 *
 * 这里守的是四件容易被「看起来对」骗过去的事：
 *   1. 制品里的计数必须能由 clauses 重算出来（不是抄源文件的 counts）；
 *   2. 三条档位数字与 p4 的实测结论一致（1/3/1 与 0/3/0），换数据时会红；
 *   3. 每一步点名的块必须真的在块索引里（拼错块名 → 界面显示不存在的块）；
 *   4. 锚点指向的文档必须存在、行号在文件范围内，否则「点回原文」落到越界行；
 *   5. 源文件 sha256 与制品记录一致（源改了没重生成 = 制品过期）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planDocLine } from '@/services/ai-helper/doc-hit-target';
import {
  anchorLineLabel,
  loadVerdictsIndex,
  parseVerdictsIndex,
  summarizeStandard,
  type VerdictsIndex,
} from '@/services/ai-helper/verdicts';

const ROOT = process.cwd();
const ARTIFACT = join(ROOT, 'src/services/ai-helper/verdicts-index.json');
const BLOCK_INDEX = join(ROOT, 'src/services/ai-helper/block-index.json');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const index: VerdictsIndex = parseVerdictsIndex(readFileSync(ARTIFACT, 'utf8'));
const blockTypes = new Set(
  ((readJson(BLOCK_INDEX) as { blocks: Array<{ blockType: string }> }).blocks).map((block) => block.blockType),
);

/**
 * 原生核心块不在 block-index / BLOCK-IO-CONTRACT.json 里（端口与代码生成由 Blockly 核心负责），
 * 但 p4 的步骤可以点名它们。清单与 `scripts/check-block-contract.mjs` 的 NATIVE_BLOCK_TYPES
 * 同口径，另加裁决里实际用到的 math_round；新增原生块时两处一起补。
 */
const NATIVE_CORE_BLOCKS = new Set([
  'procedures_defreturn',
  'procedures_defnoreturn',
  'procedures_callreturn',
  'procedures_callnoreturn',
  'procedures_ifreturn',
  'math_number',
  'math_arithmetic',
  'math_round',
  'math_modulo',
  'variables_get',
  'variables_set',
]);

describe('裁决索引：结构与新鲜度', () => {
  it('制品由生成脚本产出，且 note 里写明「机器候选、语义未验证」', () => {
    expect(index.generatedBy).toBe('scripts/build-verdicts-index.mjs');
    expect(index.note).toContain('机器候选');
    expect(index.note).toContain('语义等价未验证');
  });

  it('每份源文件的 sha256 与制品记录一致（源改了要重跑 verdicts:index）', () => {
    for (const source of index.generatedFrom) {
      const text = readFileSync(join(ROOT, source.path), 'utf8');
      expect(sha256(text), `${source.path} 已变化`).toBe(source.sha256);
    }
  });

  it('totals 能由各标准的 clauses 重算出来', () => {
    const recomputed = index.standards.reduce(
      (sum, standard) => {
        const summary = summarizeStandard(standard);
        sum.clauses += summary.clauses;
        sum.build += summary.build;
        sum.partial += summary.partial;
        sum.missing += summary.missing;
        sum.gaps += summary.gaps;
        return sum;
      },
      { standards: index.standards.length, clauses: 0, build: 0, partial: 0, missing: 0, gaps: 0 },
    );
    expect(index.totals).toEqual(recomputed);
  });

  it('每份标准的 counts 也能由自己的 clauses 重算', () => {
    for (const standard of index.standards) {
      const summary = summarizeStandard(standard);
      expect(standard.counts.clauses, standard.standard.id).toBe(summary.clauses);
      expect(standard.counts.build, standard.standard.id).toBe(summary.build);
      expect(standard.counts.partial, standard.standard.id).toBe(summary.partial);
      expect(standard.counts.missing, standard.standard.id).toBe(summary.missing);
      expect(standard.counts.gaps, standard.standard.id).toBe(summary.gaps);
    }
  });

  it('两份切片的实测档位没有被改写（SHA-2 1/3/1，CMAC 0/3/0）', () => {
    const sha2 = index.standards.find((standard) => standard.standard.id === 'fips180-4-SHA2');
    const cmac = index.standards.find((standard) => standard.standard.id === 'sp800-38b-cmac');
    if (!sha2 || !cmac) throw new Error('制品缺 SHA-2 或 CMAC 切片');
    expect(summarizeStandard(sha2)).toMatchObject({ clauses: 5, build: 1, partial: 3, missing: 1 });
    expect(summarizeStandard(cmac)).toMatchObject({ clauses: 3, build: 0, partial: 3, missing: 0 });
    expect(index.totals).toMatchObject({ standards: 2, clauses: 8, build: 1, partial: 6, missing: 1, gaps: 17 });
  });

  it('否定对照：缺标准 / 非法档位都要被 parse 拒绝', () => {
    expect(() => parseVerdictsIndex('{}')).toThrow(/schemaVersion/);
    expect(() =>
      parseVerdictsIndex(
        JSON.stringify({ schemaVersion: 1, generatedBy: 'x', standards: [{ standard: { id: 'x' }, clauses: [] }] }),
      ),
    ).toThrow(/没有条款/);
    expect(() =>
      parseVerdictsIndex(
        JSON.stringify({
          schemaVersion: 1,
          generatedBy: 'x',
          standards: [
            {
              standard: { id: 'x' },
              clauses: [{ clauseId: 'c', title: 't', tier: 'covered', steps: [] }],
            },
          ],
        }),
      ),
    ).toThrow(/tier=covered 非法/);
  });
});

describe('裁决索引：块与锚点都能落地', () => {
  it('每一步点名的块都在块索引或原生核心块清单里', () => {
    const missing: string[] = [];
    for (const standard of index.standards) {
      for (const clause of standard.clauses) {
        for (const step of clause.steps) {
          for (const block of step.blocks) {
            if (!blockTypes.has(block) && !NATIVE_CORE_BLOCKS.has(block)) {
              missing.push(`${standard.standard.id}/${clause.clauseId}/${step.id}: ${block}`);
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('锚点指向的文档存在，行号在文件范围内', () => {
    const problems: string[] = [];
    for (const standard of index.standards) {
      for (const clause of standard.clauses) {
        for (const anchor of clause.anchors) {
          const path = join(ROOT, anchor.click.doc);
          if (!existsSync(path)) {
            problems.push(`${clause.clauseId}/${anchor.section}: 文档不存在 ${anchor.click.doc}`);
            continue;
          }
          const lineCount = readFileSync(path, 'utf8').split('\n').length;
          const end = anchor.click.line_end ?? anchor.click.line_start;
          if (anchor.click.line_start < 1 || end > lineCount) {
            problems.push(`${clause.clauseId}/${anchor.section}: L${anchor.click.line_start}–L${end} 超出 ${lineCount} 行`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('锚点行区间文案与深链格式', () => {
    expect(anchorLineLabel({ section: '1', click: { doc: 'a.md', line_start: 12 } })).toBe('L12');
    expect(anchorLineLabel({ section: '1', click: { doc: 'a.md', line_start: 12, line_end: 40 } })).toBe('L12–L40');
    const plan = planDocLine('docs/standards/fips180-4-SHA2/00-Standard-Source.md', 886, '/editor/3');
    expect(plan).toEqual({
      kind: 'navigate',
      href: '/editor/3#/docs?doc=%2Fdocs%2Fstandards%2Ffips180-4-SHA2%2F00-Standard-Source.md&line=886',
    });
  });

  it('每份标准都写明了来源钉死信息（标准号 + 校验日期）', () => {
    for (const standard of index.standards) {
      expect(standard.standard.id).toBeTruthy();
      expect(standard.standard.source_checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(standard.inputs.anchorsSource?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('loadVerdictsIndex 返回同一份数据（懒加载路径可用）', async () => {
    const loaded = await loadVerdictsIndex();
    expect(loaded.totals).toEqual(index.totals);
  });
});
