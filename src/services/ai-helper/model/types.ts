/**
 * D 线（用户问题 → 答案 + 出处）的**模型适配层契约**。
 *
 * 本层只定义「模型能对候选句做什么」与「模型自述的形状」；不读环境变量与 key，
 * 网络只发生在 `./provider`，实现里还有一个确定性的 `mockAdapter` 用于单测与离线演示。
 *
 * ## 为什么答案句只能是候选句（extractive）
 *
 * D 线的答案必须能被复核，而答案的唯一可验证形式是「原文句子 + 出处」：
 * 句子逐字取自语料（`doc-answer.ts` 的 `AnswerSentence`），出处是 `path:line`，
 * 校验方式是回到源文件的那一行逐字比对
 * （见 `tests/unit/doc-answer.test.ts`「每条答案句都能在它自报的行上逐字找到」）。
 *
 * 模型生成的句子两样都没有：既没有原文可逐字核对，也没有能点开的行号。
 * 一旦允许它写**答案句**，「答案」就退化成不可验证的自述，出处只能事后附会。
 * 所以 `selections` 被收窄成**候选句 id 的有序子集**：句子文本、path、line 全部来自
 * `RewriteRequest.candidates`，模型碰不到文本，也就没有「编一句原文里没有的话」的入口。
 *
 * ## 解释段（notes）：模型可以写字，但每句都要自报依据
 *
 * `notes` 是模型自己的解释，**不进答案证据**：不参与出处，也不参与逐字校验，
 * 界面上与「逐句引用原文」的答案分区显示、并标注「不进答案证据」。
 *
 * 为了不出现「没有任何依据的模型说法」，每一句自述都必须带 `support`（它依据的候选 id）：
 * 挂不上候选 id 的句子由 `./notes` 的 `planNotes` **整句丢弃**（丢弃也要计数并说明），
 * 而不是判整次调用失败——解释是附加信息，不能因为一句解释没标依据就把可用的选择也扔掉。
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
 * 一句模型自述：`text` 是模型写的字，`support` 是它自报依据的候选 id。
 *
 * `support` 只放 id，没有句子文本——依据句永远从候选里取，界面显示 `path:line`。
 */
export interface NoteSentence {
  readonly text: string;
  readonly support: readonly string[];
}

/**
 * 模型的输出：候选句 id 的有序子集 +（可选的）逐句自述。
 *
 * 注意 `selections` 与 `notes` 的形状不对称：**选择没有句子文本字段**（类型上就没有
 * 放模型生成句子的地方），而自述有——因为自述永远不进证据，只作界面提示。
 */
export interface RewriteResult {
  readonly selections: readonly RewriteSelection[];
  /** 模型自述，逐句带依据；非证据。没有自述时省略。 */
  readonly notes?: readonly NoteSentence[];
}

/**
 * 模型适配器：任何真实 provider 都实现这个接口，上层只认它。
 *
 * 只暴露一个 `rewrite`，因为 D 线的模型只被允许做「选句 + 写带依据的说明」；
 * 以后要加别的能力，必须先证明它的输出也能回链到候选句。
 */
export interface ModelAdapter {
  rewrite(request: RewriteRequest): Promise<RewriteResult>;
}
