// @vitest-environment node
/**
 * 模型自述的核对（`model/notes.ts`）：**逐句要依据，挂不上的整句丢弃**。
 *
 * 为什么单独一组用例：自述与答案句的失败后果不同，规则也不同。
 *   - 答案句越界 → 整次模型结果作废（`verify.ts`）；
 *   - 自述越界 → 只丢这一句，其它句子与答案句都不受影响，且**丢弃数量要能显示出来**。
 * 这里钉住四件事：
 *   1. 依据必须真实存在（候选之外的 id 连累整句，不替模型挑一半）；
 *   2. 没依据 / 空文本 / 重复 / 超上限各有稳定码值，界面按码说话；
 *   3. 保留句带 `cited`（候选原对象），界面能显示 `path:line`，但**不进入答案证据**；
 *   4. `mockAdapter` 的自述必须过自己的核对（否则离线 demo 一开就红）。
 */

import { describe, expect, it } from 'vitest';

import { mockAdapter } from '@/services/ai-helper/model/mock';
import { MAX_NOTE_SENTENCES, planNotes } from '@/services/ai-helper/model/notes';
import type { CandidateSentence, RewriteRequest, RewriteResult } from '@/services/ai-helper/model/types';

const PATH = 'docs/standards/fips197-aes/05-cipher.md';
const candidates: CandidateSentence[] = [
  { id: 's1', path: PATH, line: 10, text: '第一句' },
  { id: 's2', path: PATH, line: 11, text: '第二句' },
  { id: 's3', path: PATH, line: 12, text: '第三句' },
];
const request: RewriteRequest = { question: 'AES 的轮函数有哪几步', candidates };

const resultOf = (notes: RewriteResult['notes']): RewriteResult => ({ selections: [], notes });
const codesOf = (plan: ReturnType<typeof planNotes>): string[] => plan.dropped.map((drop) => drop.code);

describe('planNotes（自述逐句核对）', () => {
  it('依据存在就保留：support 去空白去重，cited 是候选原对象（同一引用）', () => {
    const plan = planNotes(
      request,
      resultOf([{ text: '这句解释靠前两句。', support: [' s1 ', 's2', 's1'] }]),
    );

    expect(plan.dropped).toEqual([]);
    expect(plan.kept).toHaveLength(1);
    expect(plan.kept[0].text).toBe('这句解释靠前两句。');
    expect(plan.kept[0].support).toEqual(['s1', 's2']);
    // 同一引用：界面显示 path:line 时拿到的是候选的真值，不是复制来的字符串。
    expect(plan.kept[0].cited[0]).toBe(candidates[0]);
    expect(plan.kept[0].cited[1]).toBe(candidates[1]);
  });

  it('没标依据的句子被丢弃，但不连累别的句子（这正是与 verifyRewrite 分开的理由）', () => {
    const plan = planNotes(
      request,
      resultOf([
        { text: '有依据的一句。', support: ['s1'] },
        { text: '张口就来的一句。', support: [] },
        { text: '又一句有依据的。', support: ['s2'] },
      ]),
    );

    expect(plan.kept.map((note) => note.text)).toEqual(['有依据的一句。', '又一句有依据的。']);
    expect(plan.dropped).toEqual([{ index: 1, code: 'unsupported-note' }]);
  });

  it('依据指向候选之外：整句丢，并指出那个 id（不替模型划掉它继续用）', () => {
    const plan = planNotes(
      request,
      resultOf([{ text: '依据一半真一半假。', support: ['s1', 'ghost'] }]),
    );

    expect(plan.kept).toEqual([]);
    expect(plan.dropped).toEqual([{ index: 0, code: 'unknown-support', id: 'ghost' }]);
  });

  it('空白文本、重复文本各有码值；重复只留第一条', () => {
    const plan = planNotes(
      request,
      resultOf([
        { text: '   ', support: ['s1'] },
        { text: '同一句解释。', support: ['s1'] },
        // 只差空白与大小写：归一化后仍算同一句，不能冒充两条独立说明。
        { text: ' 同一句解释。 ', support: ['s2'] },
      ]),
    );

    expect(plan.kept.map((note) => note.text)).toEqual(['同一句解释。']);
    expect(plan.dropped).toEqual([
      { index: 0, code: 'empty-text' },
      { index: 2, code: 'duplicate-text' },
    ]);
  });

  it('超过上限的多出来的不显示（默认上限是常量，可显式覆盖）', () => {
    const many = Array.from({ length: MAX_NOTE_SENTENCES + 1 }, (_, index) => ({
      text: `解释 ${index}`,
      support: ['s1'],
    }));
    const plan = planNotes(request, resultOf(many));

    expect(MAX_NOTE_SENTENCES).toBe(4);
    expect(plan.kept).toHaveLength(4);
    expect(plan.dropped).toEqual([{ index: 4, code: 'too-many' }]);
    // 覆盖成 0：一句都不收，全部记 too-many。
    expect(planNotes(request, resultOf(many), { maxNotes: 0 }).dropped.map((drop) => drop.code)).toEqual([
      'too-many',
      'too-many',
      'too-many',
      'too-many',
      'too-many',
    ]);
  });

  it('没有自述时两边都是空；空候选时任何自述都挂不上', () => {
    expect(planNotes(request, { selections: [] })).toEqual({ kept: [], dropped: [] });

    const emptyRequest: RewriteRequest = { question: '量子退火怎么破 SM4', candidates: [] };
    const plan = planNotes(emptyRequest, resultOf([{ text: '语料里没有依据。', support: ['s1'] }]));
    expect(plan.kept).toEqual([]);
    expect(codesOf(plan)).toEqual(['unknown-support']);
    expect(planNotes(emptyRequest, resultOf([{ text: '什么也没依据。', support: [] }])).dropped).toEqual([
      { index: 0, code: 'unsupported-note' },
    ]);
  });

  it('mock 的自述过自己的核对：离线 demo 不会一开就红', async () => {
    const mock = await mockAdapter().rewrite(request);
    const plan = planNotes(request, mock);
    expect(plan.dropped).toEqual([]);
    expect(plan.kept).toHaveLength(1);
    expect(plan.kept[0].text).toContain('mock');
    expect(plan.kept[0].support).toEqual(['s1', 's2', 's3']);
  });
});
