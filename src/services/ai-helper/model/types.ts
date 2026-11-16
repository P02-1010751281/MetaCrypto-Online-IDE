/**
 * D 线（用户问题 → 答案 + 出处）的**模型适配层契约**：M0 骨架。
 *
 * 本层只定义「模型能对候选句做什么」，不接任何 provider、不读环境变量与 key、
 * 不发网络请求；实现只有确定性的 `mockAdapter`，用于单测与离线演示。
 *
 * ## 为什么模型只能做选择 / 重排（extractive）
 *
 * D 线的答案必须能被复核，而答案的唯一可验证形式是「原文句子 + 出处」：
 * 句子逐字取自语料（`doc-answer.ts` 的 `AnswerSentence`），出处是 `path:line`，
 * 校验方式是回到源文件的那一行逐字比对
 * （见 `tests/unit/doc-answer.test.ts`「每条答案句都能在它自报的行上逐字找到」）。
 *
 * 模型生成的句子两样都没有：既没有原文可逐字核对，也没有能点开的行号。
 * 一旦允许它写句子，「答案」就退化成不可验证的自述，出处只能事后附会。
 * 所以本层把模型输出收窄成**候选句 id 的有序子集**：句子文本、path、line 全部来自
 * `RewriteRequest.candidates`，模型碰不到文本，也就没有「编一句原文里没有的话」的入口。
 *
 * ## 解释/改写模式（note + support）
 *
 * `note` 是模型的自述，**解释文本不进答案证据**：它不参与出处、不参与逐字校验，
 * 只能当界面提示。为了不出现「无支撑的模型说法」，校验器要求带 note 的结果必须给出
 * `support`（依据的候选句 id）；没有候选句支撑的 note 一律判不合法。
 *
 * ## 约定
 *
 * - `CandidateSentence.id` 由检索层分配，一次请求内唯一；模型只能引用，不能自造。
 * - 候选为空 → 唯一合法输出是空选择（= 拒答），不是「随便选一句」。
 * - 本模块是纯类型 + 纯函数：不依赖 Vue、DOM、fs、网络。
 */

/** 检索层交给模型的一句候选原文：模型只能按 `id` 引用它，改不了其中任何字段。 */
export interface CandidateSentence {
  /** 一次请求内唯一的候选标识（检索层分配）。 */
  readonly id: string;
  /** 源文件路径（仓库相对路径，与 `doc-search.ts` 的 `DocHit.path` 同形）。 */
  readonly path: string;
  /** 1 基行号：该句在源文件里的起始行（与 `AnswerSentence.line` 同义）。 */
  readonly line: number;
  /** 原文句子，逐字未改。 */
  readonly text: string;
}

/** 一次「选句/重排」请求：问题 + 检索层已经定好出处的候选句。 */
export interface RewriteRequest {
  readonly question: string;
  readonly candidates: readonly CandidateSentence[];
}

/** 模型对单句的选择，只引用 id；`reason` 是可选说明，同样不进证据。 */
export interface RewriteSelection {
  readonly id: string;
  readonly reason?: string;
}

/**
 * 模型的输出：候选句 id 的有序子集。
 *
 * 注意这里**没有句子文本字段**——不是约定，而是类型上就没有地方放模型生成的句子。
 * `selections` 的顺序就是答案顺序；空数组表示拒答（没有依据时这是正确答案）。
 */
export interface RewriteResult {
  readonly selections: readonly RewriteSelection[];
  /** 模型自述（解释/说明），**不进答案证据**；非空时必须配 `support`。 */
  readonly note?: string;
  /** `note` 所依据的候选句 id；只有 id，没有文本。 */
  readonly support?: readonly string[];
}

/**
 * 模型适配器：任何真实 provider 都实现这个接口，上层只认它。
 *
 * 只暴露一个 `rewrite`，因为 D 线的模型只被允许做「选择/重排」这一件事；
 * 以后要加别的能力，必须先证明它的输出也能逐字回链到原文。
 */
export interface ModelAdapter {
  rewrite(request: RewriteRequest): Promise<RewriteResult>;
}
