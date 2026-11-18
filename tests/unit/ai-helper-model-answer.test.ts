// @vitest-environment node
/**
 * 候选句投影（`useModelAnswer.candidatesFromAnswer`）的回归。
 *
 * 这条规则决定了「模型选的句子能不能对上答案卡的出处」，所以必须有测试钉住：
 *   1. 只从**最佳段落**摊候选——`others` 是别的文档，混进来会让出处指错文件；
 *   2. 同一行只给一次（重复 id 会被校验器判 duplicate-id，等于白丢一次调用）；
 *   3. 最多 5 句（D 档上限），id 从 s1 起按顺序分配。
 */

import { describe, expect, it } from 'vitest';

import { candidatesFromAnswer, useModelAnswer } from '@/composables/useModelAnswer';
import type { AnswerDraft, AnswerResult } from '@/services/ai-helper/doc-answer';

const BEST: AnswerDraft = {
  sentences: [
    { text: '第一句', line: 10 },
    { text: '第二句', line: 11 },
    { text: '第三句', line: 12 },
    { text: '第一句', line: 10 },
  ],
  evidence: { path: 'docs/a.md', title: 'A', heading: 'H', kind: 'md', sectionLine: 10 },
  coverage: 1,
  missing: [],
  excerptOnly: false,
};

const OTHER: AnswerDraft = {
  sentences: [{ text: '别的文档里的句子', line: 3 }],
  evidence: { path: 'docs/b.md', title: 'B', heading: 'H', kind: 'md', sectionLine: 3 },
  coverage: 0.5,
  missing: [],
  excerptOnly: false,
};

const result: AnswerResult = { best: BEST, others: [OTHER], terms: ['t'], missing: [] };

describe('候选句投影', () => {
  it('只取最佳段落，按行去重，id 顺序分配', () => {
    const candidates = candidatesFromAnswer(result);
    expect(candidates.map((item) => item.id)).toEqual(['s1', 's2', 's3']);
    expect(candidates.map((item) => item.line)).toEqual([10, 11, 12]);
    expect(candidates.every((item) => item.path === 'docs/a.md')).toBe(true);
    expect(candidates.map((item) => item.text)).not.toContain('别的文档里的句子');
  });

  it('最多 5 句（D 档上限）', () => {
    const many: AnswerResult = {
      ...result,
      best: {
        ...BEST,
        sentences: Array.from({ length: 9 }, (_, index) => ({ text: `句${index}`, line: index + 1 })),
      },
    };
    expect(candidatesFromAnswer(many)).toHaveLength(5);
  });

  it('没有最佳答案时给空候选（= 不发起调用）', () => {
    expect(candidatesFromAnswer({ ...result, best: null })).toEqual([]);
  });
});

describe('保存配置与调用触发（§3.4 一次操作一次调用）', () => {
  const draft = { baseUrl: 'https://api.example.com/v1', modelId: 'cheap-fast', apiKey: '{{SECRET_testkey}}' };

  it('保存同一份配置保留对象引用：只改「记住」不该触发新一次调用', () => {
    const model = useModelAnswer();
    expect(model.save(draft, false).ok).toBe(true);
    const first = model.config.value;
    expect(first).not.toBeNull();

    // 界面按 config 身份触发调用（AnswerSection 的 watch）；换引用 = 白烧一次额度。
    expect(model.save(draft, true).ok).toBe(true);
    expect(model.remembered.value).toBe(true);
    expect(model.config.value).toBe(first);

    // 内容真的变了就必须换引用，否则换了 provider 却继续用旧配置。
    expect(model.save({ ...draft, modelId: 'other-model' }, false).ok).toBe(true);
    expect(model.config.value).not.toBe(first);
  });
});
