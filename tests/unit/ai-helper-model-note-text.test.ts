// @vitest-environment node
/**
 * 自述丢弃文案（`src/composables/model-note-text.ts`）的回归。
 *
 * 文档 §7.5 承诺：五种丢弃都只丢那一句，界面用 `−n` 显示被丢弃的句数，**悬浮给出原因**。
 * 但界面此前只给「没标依据」与「引用了候选外的 id」两类配了文案，另外三类（空文本、
 * 重复、超上限）只有计数、悬浮是空的——用户看到 `−2` 却问不出为什么。
 *
 * 钉住四件事：
 *   1. 五类丢弃各出各自那句，谁也不冒充谁；
 *   2. 同一类重复出现只算一条，多条按出现顺序排；
 *   3. 空文本仍是一句说明（不是空串），`−n` 与悬浮不能对不上；
 *   4. 五个 key 在中英语言包真实存在——`ui('字面量')` 的扫描器看不见动态 key。
 */

import { describe, expect, it } from 'vitest';

import { NOTE_DROP_TEXT_KEYS, noteDropTexts } from '@/composables/model-note-text';
import { UI_MESSAGES_EN } from '@/composables/locale/ui-messages-en';
import { UI_MESSAGES_ZH_HANS } from '@/composables/locale/ui-messages-zh';
import type { NoteDrop, NoteDropCode } from '@/services/ai-helper/model/notes';

const zh = UI_MESSAGES_ZH_HANS;
const en = UI_MESSAGES_EN;

/** 假 locale：key 原样返回，断言的是「选了哪一句」而不是文案内容。 */
const text = (key: string): string => `[${key}]`;

const ALL_CODES: NoteDropCode[] = [
  'empty-text',
  'unsupported-note',
  'unknown-support',
  'duplicate-text',
  'too-many',
];

const drop = (code: NoteDropCode, index = 0): NoteDrop => ({ index, code });

describe('noteDropTexts（五类丢弃各有说法）', () => {
  it('五类各出各自那句，没有两类共用一句', () => {
    const rendered = ALL_CODES.map((code) => noteDropTexts([drop(code)], text)[0]);
    expect(rendered).toEqual([
      '[modelNoteDropEmpty]',
      '[modelVerifyUnsupportedNote]',
      '[modelVerifyUnknownSupport]',
      '[modelNoteDropDuplicate]',
      '[modelNoteDropTooMany]',
    ]);
    expect(new Set(rendered).size).toBe(5);
  });

  it('两类既有文案被复用（语义相同的丢弃不该出现第二种说法）', () => {
    expect(NOTE_DROP_TEXT_KEYS['unsupported-note']).toBe('modelVerifyUnsupportedNote');
    expect(NOTE_DROP_TEXT_KEYS['unknown-support']).toBe('modelVerifyUnknownSupport');
  });

  it('同一类重复出现只算一条，多条按第一次出现的顺序排', () => {
    const dropped = [drop('duplicate-text', 0), drop('empty-text', 1), drop('duplicate-text', 2)];
    expect(noteDropTexts(dropped, text)).toEqual(['[modelNoteDropDuplicate]', '[modelNoteDropEmpty]']);
  });

  it('没有丢弃就不给一句空话（空数组），免得 −n 缺失时悬浮还有内容', () => {
    expect(noteDropTexts([], text)).toEqual([]);
  });

  it('未知码不炸也不显示空串之外的东西：直接跳过（类型上不可达，兜底用）', () => {
    const stranger = { index: 0, code: 'not-a-code' } as unknown as NoteDrop;
    expect(noteDropTexts([stranger], text)).toEqual([]);
  });
});

describe('文案键在语言包里真实存在', () => {
  it('五类丢弃的 key 中英都有，且中英各自没有混入另一种语言', () => {
    for (const key of Object.values(NOTE_DROP_TEXT_KEYS)) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
      expect(zh[key]).toMatch(/[\u4e00-\u9fff]/);
      expect(en[key]).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('模型相关键集在中英语言包里一致（动态 key 的扫描器看不见这层）', () => {
    const modelKeys = Object.keys(zh).filter((key) => key.startsWith('model'));
    expect(Object.keys(en).filter((key) => key.startsWith('model')).sort()).toEqual(modelKeys.sort());
  });
});
