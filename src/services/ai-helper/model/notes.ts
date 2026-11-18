/**
 * 模型自述（`notes`）的核对与裁剪：**逐句要依据，没依据的整句丢弃**。
 *
 * 为什么与 `verify.ts` 分开：两层失败的后果不同。
 *   - `verify.ts` 管答案句（`selections`）——一旦越界，这次模型结果整体作废
 *     （宁可这次不给答案，也不给一份掺了越界选择的答案）；
 *   - 这里管自述（`notes`）——自述**不是证据**，一句没标依据不该连累可用的选择，
 *     所以是**逐句丢弃 + 计数**，界面照实说「N 句被丢弃」，不静默吞掉。
 *
 * 丢弃规则（码值稳定，界面按它取文案）：
 *   - `empty-text`：句子只有空白；
 *   - `unsupported-note`：`support` 为空——说了话却没交代依据；
 *   - `unknown-support`：`support` 里有候选之外的 id。整句丢，而不是「把那个 id 划掉继续用」：
 *     模型的依据本身就是错的，替它挑一半等于替模型改口；
 *   - `duplicate-text`：同一句自述重复出现（重复看起来像两条独立说明）；
 *   - `too-many`：超过 `MAX_NOTE_SENTENCES`，多出来的不显示。
 *
 * 保留下来的句子带 `cited`（依据句的原对象），界面用它显示 `path:line`。
 * `cited` 只是提示，**不进答案证据**：解释文本永远不参与出处与逐字校验。
 */

import type { CandidateSentence, RewriteRequest, RewriteResult } from './types';

/**
 * 一次最多显示几句自述。
 *
 * 上限存在的理由不是「省 token」，而是「解释不该盖过答案」：答案只有几句，
 * 一段长篇解释会让界面读起来像模型在作答，而它其实只是附注。
 */
export const MAX_NOTE_SENTENCES = 4;

/** 一句自述被判丢弃的原因。码值稳定，界面与测试按它分支。 */
export type NoteDropCode =
  | 'empty-text'
  | 'unsupported-note'
  | 'unknown-support'
  | 'duplicate-text'
  | 'too-many';

/** 一条丢弃记录：`index` 是它在模型原始 `notes` 里的下标（便于对账）。 */
export interface NoteDrop {
  readonly index: number;
  readonly code: NoteDropCode;
  /** `unknown-support` 时指出那个越界 id。 */
  readonly id?: string;
}

/** 通过核对的一句自述：`support` 是自报依据的 id，`cited` 是对应的候选句原对象。 */
export interface AuditedNote {
  readonly text: string;
  readonly support: readonly string[];
  readonly cited: readonly CandidateSentence[];
}

/** 核对结论：`kept` 按模型给出的顺序；`dropped` 只用于计数与说明。 */
export interface NotePlan {
  readonly kept: readonly AuditedNote[];
  readonly dropped: readonly NoteDrop[];
}

export interface NotePlanOptions {
  /** 覆盖上限（默认 `MAX_NOTE_SENTENCES`）；`undefined` 用默认，`0` 表示一句都不收。 */
  readonly maxNotes?: number;
}

function noteLimit(value: number | undefined): number {
  if (value === undefined) return MAX_NOTE_SENTENCES;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/** 判重用的归一化：去空白差异与大小写差异，避免「同一句换个空格」混过去。 */
function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * 核对模型自述：能挂上候选句的留下，挂不上的整句丢弃。
 *
 * 不抛异常：丢弃是正常路径（模型经常忘了标依据），结论以结构返回。
 *
 * @param request 原始请求（候选 id 是唯一的事实来源）
 * @param result 模型返回的组合结果（只读它的 `notes`）
 * @param options 上限覆盖
 */
export function planNotes(
  request: RewriteRequest,
  result: RewriteResult,
  options: NotePlanOptions = {},
): NotePlan {
  const known = new Map<string, CandidateSentence>();
  for (const candidate of request.candidates) known.set(candidate.id, candidate);
  const limit = noteLimit(options.maxNotes);

  const kept: AuditedNote[] = [];
  const dropped: NoteDrop[] = [];
  const seenText = new Set<string>();

  const notes = result.notes ?? [];
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const text = note.text.trim();
    if (!text) {
      dropped.push({ index, code: 'empty-text' });
      continue;
    }

    // support 去空白、去重，保持模型给出的顺序。
    const support: string[] = [];
    for (const raw of note.support ?? []) {
      const id = raw.trim();
      if (id && !support.includes(id)) support.push(id);
    }
    if (support.length === 0) {
      dropped.push({ index, code: 'unsupported-note' });
      continue;
    }
    const unknown = support.find((id) => !known.has(id));
    if (unknown !== undefined) {
      dropped.push({ index, code: 'unknown-support', id: unknown });
      continue;
    }

    const key = normalize(text);
    if (seenText.has(key)) {
      dropped.push({ index, code: 'duplicate-text' });
      continue;
    }
    if (kept.length >= limit) {
      dropped.push({ index, code: 'too-many' });
      continue;
    }

    seenText.add(key);
    kept.push({
      text,
      support,
      // support 已核对全部存在，这里的取值不会落空。
      cited: support.map((id) => known.get(id) as CandidateSentence),
    });
  }

  return { kept, dropped };
}
