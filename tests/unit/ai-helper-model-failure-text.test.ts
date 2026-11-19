// @vitest-environment node
/**
 * 失败原因文案（`src/composables/model-failure-text.ts`）的回归。
 *
 * 这条规则是 2026-11-18 真浏览器验收抓出来的（RESULTS §60.8 第 3 条）：假 provider 回
 * 「带说明却没给 support」时，界面说「模型选中的句子不在候选里」——把「说明没依据」
 * 说成了「编造 id」，用户照这句话去查候选句永远查不到问题。
 *
 * 现在「说明没依据」不再是失败：自述由 `planNotes` 逐句丢弃（见 ai-helper-model-notes 测试），
 * 所以这里只剩**答案句**的三类越界。钉住四件事：
 *   1. 三类越界各出各自那句，谁也冒充不了谁；
 *   2. 同一类越界重复出现只算一条，多条按出现顺序排；
 *   3. 没有分类（旧数据/新码）退回兜底句，不显示空串；
 *   4. 两张映射表里的 key 在中英语言包都真实存在——`ui('字面量')` 的扫描器看不见
 *      动态 key，这一层的缺键只能靠这里守。
 */

import { describe, expect, it } from 'vitest';

import { VERIFY_VIOLATION_KEYS, modelFailureTexts } from '@/composables/model-failure-text';
import { UI_MESSAGES_EN } from '@/composables/locale/ui-messages-en';
import { UI_MESSAGES_ZH_HANS } from '@/composables/locale/ui-messages-zh';
import type { ModelFailure } from '@/composables/useModelAnswer';
import { applySelection } from '@/services/ai-helper/model/apply';
import type { RewriteRequest, RewriteResult } from '@/services/ai-helper/model/types';
import type { RewriteViolationCode } from '@/services/ai-helper/model/verify';

const zh = UI_MESSAGES_ZH_HANS;
const en = UI_MESSAGES_EN;

/** 假 locale：key 原样返回，断言的是「选了哪一句」而不是文案内容。 */
const context = { text: (key: string) => `[${key}]`, status: (status: number) => `[status:${status}]` };

const texts = (failure: ModelFailure): string[] => modelFailureTexts(failure, context);

const request: RewriteRequest = {
  question: 'SM4 密钥扩展怎么做',
  candidates: [
    { id: 's1', path: 'docs/a.md', line: 10, text: '第一句' },
    { id: 's2', path: 'docs/a.md', line: 11, text: '第二句' },
  ],
};

describe('越界类别 → 文案', () => {
  it('没标依据的自述不再是一次调用失败：applySelection 只看 selections', () => {
    // 以前这句会把整次选择判死（unsupported-note），现在只由 planNotes 丢弃、并计数显示。
    const result: RewriteResult = { selections: [{ id: 's1' }], notes: [{ text: '我的解释', support: [] }] };
    const applied = applySelection(request, result);
    expect(applied.ok).toBe(true);
    expect(applied.sentences.map((sentence) => sentence.id)).toEqual(['s1']);
    // 文案表里也不该再有这两类：它们不是「失败」。
    expect(Object.values(VERIFY_VIOLATION_KEYS)).toEqual([
      'modelVerifyUnknownId',
      'modelVerifyDuplicateId',
      'modelVerifyTooMany',
    ]);
  });

  it('三类越界各出各自那句（互不替换）', () => {
    const codes: RewriteViolationCode[] = ['unknown-id', 'duplicate-id', 'too-many'];
    const rendered = codes.map((code) => texts({ code: 'verify', violations: [code], message: code }));
    expect(rendered.map((lines) => lines[0])).toEqual([
      '[modelVerifyUnknownId]',
      '[modelVerifyDuplicateId]',
      '[modelVerifyTooMany]',
    ]);
    expect(new Set(rendered.map((lines) => lines[0])).size).toBe(3);
  });

  it('重复类别只算一条，多条按出现顺序用分号连接由调用方决定', () => {
    expect(texts({ code: 'verify', violations: ['unknown-id', 'unknown-id', 'too-many'], message: 'x' })).toEqual([
      '[modelVerifyUnknownId]',
      '[modelVerifyTooMany]',
    ]);
  });

  it('没有分类时退回兜底句，不返回空数组', () => {
    expect(texts({ code: 'verify', message: 'legacy' })).toEqual(['[modelErrorVerify]']);
  });

  it('调用层失败码各有专属文案', () => {
    // 逐条写死期望，不用驼峰推导：`rate-limited` / `not-configured` 推导会算出错键名，
    // 而「推导出来的键正好也存在」这种巧合会让测试替坏键背书。
    const cases: Array<[ModelFailure['code'], string]> = [
      ['timeout', 'modelErrorTimeout'],
      ['unauthorized', 'modelErrorUnauthorized'],
      ['forbidden', 'modelErrorForbidden'],
      ['rate-limited', 'modelErrorRateLimited'],
      ['format', 'modelErrorFormat'],
      ['empty', 'modelErrorEmpty'],
      ['network', 'modelErrorNetwork'],
      ['not-configured', 'modelErrorNotConfigured'],
    ];
    for (const [code, key] of cases) {
      expect(texts({ code, message: code }), code).toEqual([`[${key}]`]);
    }
  });

  it('http-error 没有专属文案，按状态码说话（未知码也不给空串）', () => {
    expect(texts({ code: 'http-error', status: 503, message: 'x' })).toEqual(['[status:503]']);
    expect(texts({ code: 'http-error', message: 'x' })).toEqual(['[status:0]']);
  });
});

describe('文案键在语言包里真实存在', () => {
  it('五类越界的 key 中英都有', () => {
    for (const key of Object.values(VERIFY_VIOLATION_KEYS)) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
      expect(zh[key]).toMatch(/[\u4e00-\u9fff]/);
      expect(en[key]).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('两个语言包的模型失败键集一致（动态 key 的扫描器看不见这层）', () => {
    const modelKeys = Object.keys(zh).filter((key) => key.startsWith('model'));
    expect(Object.keys(en).filter((key) => key.startsWith('model')).sort()).toEqual(modelKeys.sort());
  });
});
