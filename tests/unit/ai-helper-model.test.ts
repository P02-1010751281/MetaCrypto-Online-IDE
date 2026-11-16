// @vitest-environment node
/**
 * D 线模型适配层（`src/services/ai-helper/model/`）的回归。
 *
 * 这一层不是「接模型」，而是把模型能做的事收窄成一个可验证的投影：
 * 模型只能按 id 选/重排检索层给出的候选句，句子、路径、行号一律原样来自候选。
 * 所以用例全部围绕证据契约，而不是「模型答得好不好」：
 *
 *   1. 引用完整：未知 id、重复 id、超过上限、无支撑的 note 一律拒绝，且**不抛异常**；
 *   2. 拒答合法：没有候选时唯一的合法输出是空选择（不是「随便选一句」）；
 *   3. 确定性：mock 对同一输入两次给出逐字段相等的结果（不用随机数、不用时间）；
 *   4. 逐字保留：applySelection 交出的是候选对象本身，按选择顺序、文本一字不改；
 *   5. note 不是证据：它不会出现在 applySelection 的结果里，无 support 时校验器直接拒。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_SELECTIONS,
  applySelection,
  mockAdapter,
  verifyRewrite,
  type CandidateSentence,
  type RewriteRequest,
  type RewriteResult,
} from '@/services/ai-helper/model';

const PATH = 'docs/standards/fips197-AES/README.md';

const candidates: CandidateSentence[] = [
  { id: 's1', path: PATH, line: 12, text: 'SubBytes 用 S 盒做逐字节替换。' },
  { id: 's2', path: PATH, line: 13, text: 'ShiftRows 把状态矩阵的每一行循环左移。' },
  { id: 's3', path: PATH, line: 14, text: 'MixColumns 在 GF(2^8) 上乘一个固定矩阵。' },
  { id: 's4', path: PATH, line: 15, text: 'AddRoundKey 把轮密钥逐字异或进状态。' },
  { id: 's5', path: PATH, line: 16, text: '轮密钥由密钥扩展按字生成。' },
  { id: 's6', path: PATH, line: 17, text: '末轮不做 MixColumns。' },
];

const request: RewriteRequest = { question: 'AES 一轮里有哪些步骤？', candidates };

function codes(result: RewriteResult): string[] {
  return verifyRewrite(request, result).errors.map((error) => error.code);
}

describe('引用完整性（verifyRewrite）', () => {
  it('未知 id 一律拒绝，并指出是哪个 id（不抛异常）', () => {
    const result: RewriteResult = { selections: [{ id: 's1' }, { id: 'ghost' }] };
    const checked = verifyRewrite(request, result);
    expect(checked.ok).toBe(false);
    expect(checked.errors.map((error) => error.code)).toEqual(['unknown-id']);
    expect(checked.errors[0].id).toBe('ghost');
    // 失败时投影发包不出：不会把「s1 如常拿走」这种半份证据漏出去。
    expect(applySelection(request, result)).toEqual({ ok: false, sentences: [], errors: checked.errors });
  });

  it('重复 id 拒绝：同一句选两次不能冒充两条证据', () => {
    const result: RewriteResult = { selections: [{ id: 's2' }, { id: 's1' }, { id: 's2' }] };
    expect(codes(result)).toEqual(['duplicate-id']);
  });

  it('超过上限拒绝：默认上限是常量，显式传入的覆盖值同样生效', () => {
    const all: RewriteResult = { selections: candidates.map((candidate) => ({ id: candidate.id })) };
    expect(candidates.length).toBe(6);
    expect(DEFAULT_MAX_SELECTIONS).toBe(5);
    expect(codes(all)).toEqual(['too-many']);

    const four: RewriteResult = { selections: candidates.slice(0, 4).map((candidate) => ({ id: candidate.id })) };
    expect(verifyRewrite(request, four, { maxSelections: 4 }).ok).toBe(true);
    expect(verifyRewrite(request, four, { maxSelections: 2 }).errors.map((error) => error.code)).toEqual(['too-many']);
  });

  it('空选择合法：没有依据时拒答才是正确答案', () => {
    expect(verifyRewrite(request, { selections: [] })).toEqual({ ok: true, errors: [] });
    expect(applySelection(request, { selections: [] })).toEqual({ ok: true, sentences: [], errors: [] });
  });

  it('note 必须有 support 且 support 只能引用候选：解释文本不进答案证据', () => {
    // 有 note 没 support：模型自述没有出处。
    const bare: RewriteResult = { selections: [{ id: 's1' }], note: '这一步是查表替换。' };
    expect(codes(bare)).toEqual(['unsupported-note']);

    // support 指向候选之外的 id：等于没交代依据。
    const ghost: RewriteResult = { selections: [{ id: 's1' }], note: '这一步是查表替换。', support: ['s1', 'ghost'] };
    expect(codes(ghost)).toEqual(['unknown-support']);

    // 空候选时连 note 都无处支撑：拒答只能是「空选择 + 无 note」。
    const emptyRequest: RewriteRequest = { question: '量子退火怎么破 SM4', candidates: [] };
    const talkative: RewriteResult = { selections: [], note: '语料里没有相关依据。' };
    expect(verifyRewrite(emptyRequest, talkative).errors.map((error) => error.code)).toEqual(['unsupported-note']);
    expect(verifyRewrite(emptyRequest, { selections: [] })).toEqual({ ok: true, errors: [] });
  });
});

describe('mockAdapter（确定性）', () => {
  it('同一输入两次逐字段相等，按候选顺序取前 N 句', async () => {
    const adapter = mockAdapter();
    const first = await adapter.rewrite(request);
    const second = await adapter.rewrite({ question: request.question, candidates: [...candidates] });

    expect(first).toEqual(second);
    expect(first.selections.map((selection) => selection.id)).toEqual(['s1', 's2', 's3']);
    // 结果里只有 id：模型这一层拿不到、也交不出句子文本。
    for (const selection of first.selections) {
      expect(Object.keys(selection)).toEqual(['id']);
    }
    // mock 自己的输出必须过自己的校验器（否则离线 demo 一开就红）。
    expect(verifyRewrite(request, first).ok).toBe(true);

    // N 可配；≤0 视为拒答而不是「全选」。
    const two = await mockAdapter({ maxSelections: 2 }).rewrite(request);
    expect(two.selections.map((selection) => selection.id)).toEqual(['s1', 's2']);
    const zero = await mockAdapter({ maxSelections: 0 }).rewrite(request);
    expect(zero).toEqual({ selections: [] });
  });

  it('空候选返回空选择（拒答），且不给自己编 note', async () => {
    const emptyRequest: RewriteRequest = { question: 'CipherCat 支持哪些区块链共识算法', candidates: [] };
    const result = await mockAdapter().rewrite(emptyRequest);
    expect(result.selections).toEqual([]);
    expect(result.note).toBeUndefined();
    expect(verifyRewrite(emptyRequest, result)).toEqual({ ok: true, errors: [] });
  });
});

describe('applySelection（只排版不造句）', () => {
  it('按选择顺序返回原对象，path/line/text 逐字不变', () => {
    const result: RewriteResult = {
      selections: [
        { id: 's3', reason: '这句讲列混合，正好是轮函数的一步。' },
        { id: 's1' },
      ],
    };
    const applied = applySelection(request, result);
    expect(applied.ok).toBe(true);
    expect(applied.sentences.map((sentence) => sentence.id)).toEqual(['s3', 's1']);
    // 同一引用：不是复制、不是拼装，reason 也没有混进句子文本。
    expect(applied.sentences[0]).toBe(candidates[2]);
    expect(applied.sentences[1]).toBe(candidates[0]);
    expect(applied.sentences[0].text).toBe(candidates[2].text);
    expect(applied.sentences[0].line).toBe(candidates[2].line);
    expect(applied.sentences[0].path).toBe(PATH);
  });

  it('note 不参与证据：只出现在模型结果里，不进入返回的句子', async () => {
    const withNote = await mockAdapter().rewrite(request);
    expect(withNote.note).toContain('mock');
    expect(withNote.support).toEqual(['s1', 's2', 's3']);

    const applied = applySelection(request, withNote);
    expect(applied.ok).toBe(true);
    expect(applied.sentences).toHaveLength(3);
    expect(JSON.stringify(applied.sentences)).not.toContain('mock');
  });

  it('非法结果不发包：错误原样带回，sentences 为空', () => {
    const result: RewriteResult = { selections: [{ id: 's1' }, { id: 'ghost' }] };
    const applied = applySelection(request, result);
    expect(applied.ok).toBe(false);
    expect(applied.sentences).toEqual([]);
    expect(applied.errors.map((error) => error.code)).toEqual(['unknown-id']);
  });
});
