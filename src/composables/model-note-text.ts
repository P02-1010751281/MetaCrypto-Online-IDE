/**
 * 自述丢弃原因 → 界面人话（纯函数：不碰 DOM、不读全局语言、不 import 文案表）。
 *
 * 文档 §7.5 承诺「五种情况都只丢那一句，界面上用 −n 计数显示被丢弃的句数（悬浮给出原因）」，
 * 但界面此前只给两类（没标依据、引用了候选外的 id）配了文案：空文本、重复、超上限三种
 * 丢弃只有计数、悬浮是空的——用户看到 `−2` 却问不出为什么。
 *
 * 五类必须逐类对准，理由与失败文案相同：笼统说「说明有问题」等于让用户去猜。
 * 两条既有键（`modelVerifyUnsupportedNote` / `modelVerifyUnknownSupport`）直接复用，
 * 语义就是同一件事，新增同义键只会让同一含义出现两种说法。
 *
 * 文案以参数注入（`text` 由调用方从 locale 取），所以单测不用挂组件、也不用切全局语言。
 */

import type { NoteDrop, NoteDropCode } from '@/services/ai-helper/model/notes';

/** 丢弃码 → locale key。`Record` 而不是 `Partial`：漏一类就编译不过。 */
export const NOTE_DROP_TEXT_KEYS: Record<NoteDropCode, string> = {
  'empty-text': 'modelNoteDropEmpty',
  'unsupported-note': 'modelVerifyUnsupportedNote',
  'unknown-support': 'modelVerifyUnknownSupport',
  'duplicate-text': 'modelNoteDropDuplicate',
  'too-many': 'modelNoteDropTooMany',
};

/**
 * 把丢弃记录摊成一组人话（按出现顺序，已去重）。
 *
 * 返回数组而不是拼好的句子：多条原因之间的分隔符中英不同（`；` / `; `），
 * 那是调用方（知道当前语言）的事，不是这个纯函数该猜的。
 */
export function noteDropTexts(dropped: readonly NoteDrop[], text: (key: string) => string): string[] {
  const keys: string[] = [];
  for (const drop of dropped) {
    const key = NOTE_DROP_TEXT_KEYS[drop.code];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.map((key) => text(key));
}
