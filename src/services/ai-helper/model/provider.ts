/**
 * D 线的真实模型适配器：OpenAI 兼容的 `POST {baseURL}/chat/completions`（BYOK）。
 *
 * 这一层的职责只有三件，全部围绕「不要在用户额度上擅自动作」：
 *
 * 1. **一次操作一次调用**（§3.4）：没有重试、没有续跑、没有分段；失败就把结构化原因
 *    交给调用方去显示，而不是偷偷再来一次。
 * 2. **输出只能是候选句 id**：提示词与解析都锁死 `{selections:[{id}]}`，句子文本永远来自
 *    检索层的候选（`types.ts` 的约定），模型没有写入句子文本的入口。
 * 3. **不越过配置的边界**：超时、max_tokens、key 都来自用户配置；key 只进
 *    `Authorization` 头，不进请求体、不进错误信息、不进任何日志。
 *
 * 解析是「先宽松取 JSON、再严格验形」：不少 provider 会在 JSON 外面包一层 ```json 围栏或
 * 前后加一句客套话，这不值得判失败；但拿到的对象一旦形状不对（缺 selections、id 不是字符串），
 * 一律当 `format` 失败——宁可让用户看到「模型没按要求回答」，也不要猜它的意思。
 *
 * 本模块不读环境变量、不读全局 storage、不依赖 DOM：配置与 fetch 都由调用方注入。
 */

import { DEFAULT_MAX_SELECTIONS, selectionLimit } from './limits';
import type { ModelAdapter, RewriteRequest, RewriteResult, RewriteSelection } from './types';
import { chatEndpoint, type ModelConfig } from './config';

/** 结构化失败原因：界面按 code 分支，不解析自由文本。 */
export type ModelCallErrorCode =
  | 'not-configured'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'http-error'
  | 'network'
  | 'format'
  | 'empty';

export class ModelCallError extends Error {
  readonly code: ModelCallErrorCode;
  /** HTTP 状态码（网络/超时/格式错误时没有）。 */
  readonly status?: number;

  constructor(code: ModelCallErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ModelCallError';
    this.code = code;
    this.status = status;
  }
}

/** 一次调用实际花掉的 token（provider 不返回 usage 时三个字段都是 0）。 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ModelCallOutcome {
  readonly result: RewriteResult;
  readonly usage: TokenUsage;
  /** 端到端耗时（含排队），界面用来显示「这次等了多久」。 */
  readonly elapsedMs: number;
}

/** 可注入依赖：单测用假 fetch 或无网络；浏览器里用全局 fetch。 */
export interface ProviderDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** 单句候选进提示词的最大长度：超长句子截断，避免把整段文档塞进一次调用。 */
const MAX_CANDIDATE_CHARS = 400;

const SYSTEM_PROMPT = [
  '你是检索问答里的「选句器」，只做一件事：从给定的候选句里挑出能回答问题的句子。',
  '硬性规则：',
  '1. 只能引用候选句的 id，不能改写、拼接、概括或新增任何句子；',
  '2. 没有能回答的候选时就返回空数组（拒答是合法答案，不要硬凑）；',
  '3. `note` 是可选的简短说明，提到依据时必须用 `support` 列出所依据的候选 id；',
  `4. 最多选 ${DEFAULT_MAX_SELECTIONS} 句；`,
  '5. 只输出一个 JSON 对象，不要 Markdown 围栏、不要解释。',
  '输出格式：{"selections":[{"id":"s1"}],"note":"可选","support":["s1"]}',
].join('\n');

function clip(text: string): string {
  return text.length <= MAX_CANDIDATE_CHARS ? text : `${text.slice(0, MAX_CANDIDATE_CHARS)}…`;
}

/** 提示词里的候选清单：`id | path:line | 原文`，模型只能照抄 id。 */
export function candidateDigest(request: RewriteRequest): string {
  return request.candidates
    .map((candidate) => `${candidate.id} | ${candidate.path}:${candidate.line} | ${clip(candidate.text)}`)
    .join('\n');
}

export function buildMessages(request: RewriteRequest): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `问题：${request.question}`,
        '',
        '候选句：',
        candidateDigest(request) || '（没有候选句）',
      ].join('\n'),
    },
  ];
}

/** OpenAI 兼容请求体。`temperature: 0` 与 `stream: false` 都是刻意的：选句要可复现，不要流式。 */
export function buildRequestBody(config: ModelConfig, request: RewriteRequest): Record<string, unknown> {
  return {
    model: config.modelId,
    messages: buildMessages(request),
    temperature: 0,
    max_tokens: config.maxTokens,
    stream: false,
  };
}

/** 从一段文本里取出第一个完整的 JSON 对象（允许 ```json 围栏与前后客套话）。 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ModelCallError('format', '模型回复里没有 JSON 对象');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new ModelCallError('format', '模型回复的 JSON 解析失败');
  }
}

/**
 * 校验模型回复的形状并转成 `RewriteResult`（只验形，不验引用完整性）。
 *
 * 「id 必须在候选里」由 `verifyRewrite` 负责；这里只保证形状可读，两层各管一段。
 */
export function parseModelReply(text: string): RewriteResult {
  if (!text.trim()) throw new ModelCallError('empty', '模型回复为空');
  const raw = extractJsonObject(text);
  if (typeof raw !== 'object' || raw === null) throw new ModelCallError('format', '模型回复不是对象');

  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.selections)) throw new ModelCallError('format', '模型回复缺少 selections 数组');

  const selections: RewriteSelection[] = [];
  for (const item of record.selections) {
    if (typeof item !== 'object' || item === null) throw new ModelCallError('format', 'selections 的元素不是对象');
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new ModelCallError('format', 'selections 的元素缺少字符串 id');
    }
    const selection: RewriteSelection =
      typeof entry.reason === 'string'
        ? { id: entry.id.trim(), reason: entry.reason }
        : { id: entry.id.trim() };
    selections.push(selection);
  }

  const result: RewriteResult = {
    selections,
    ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim() } : {}),
    ...(Array.isArray(record.support)
      ? { support: record.support.filter((id): id is string => typeof id === 'string') }
      : {}),
  };
  return result;
}

function readNumber(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/** 取 usage：不同 provider 用 `prompt_tokens` 或 `input_tokens`，两者都认。 */
export function readUsage(payload: unknown): TokenUsage {
  if (typeof payload !== 'object' || payload === null) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const usage = (payload as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const record = usage as Record<string, unknown>;
  const inputTokens = readNumber(record, ['prompt_tokens', 'input_tokens']);
  const outputTokens = readNumber(record, ['completion_tokens', 'output_tokens']);
  const totalTokens = readNumber(record, ['total_tokens']) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

/** 取回复正文：`choices[0].message.content`；有的 provider 给数组分段，这里只认纯字符串。 */
export function readReplyText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) throw new ModelCallError('format', '模型响应不是对象');
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new ModelCallError('format', '模型响应缺少 choices');
  const first = choices[0];
  if (typeof first !== 'object' || first === null) throw new ModelCallError('format', 'choices[0] 不是对象');
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) throw new ModelCallError('format', 'choices[0].message 不是对象');
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string') throw new ModelCallError('format', 'choices[0].message.content 不是字符串');
  return content;
}

/** 把错误信息里的 key 抹掉：provider 有时会把请求头回显进错误体。 */
function redact(text: string, apiKey: string): string {
  if (!apiKey) return text;
  return text.split(apiKey).join('[redacted]');
}

function statusError(status: number, detail: string, apiKey: string): ModelCallError {
  const message = redact(`HTTP ${status}${detail ? `：${detail}` : ''}`, apiKey).slice(0, 300);
  if (status === 401) return new ModelCallError('unauthorized', message, status);
  if (status === 403) return new ModelCallError('forbidden', message, status);
  if (status === 429) return new ModelCallError('rate-limited', message, status);
  return new ModelCallError('http-error', message, status);
}

/**
 * 发起一次调用（**不重试**）。
 *
 * 超时用 `AbortController` 真取消请求，而不是「先返回、后台继续跑」——
 * 后者会让用户以为只发了一次，账单上却是另一回事。
 */
export async function callModel(
  config: ModelConfig,
  request: RewriteRequest,
  deps: ProviderDeps = {},
): Promise<ModelCallOutcome> {
  const endpoint = chatEndpoint(config.baseUrl);
  if (!endpoint || !config.modelId || !config.apiKey) {
    throw new ModelCallError('not-configured', '模型配置不完整（base URL / 模型 id / key）');
  }

  const doFetch = deps.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new ModelCallError('network', '当前环境没有 fetch');
  const now = deps.now ?? (() => Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = now();

  try {
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildRequestBody(config, request)),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelCallError('timeout', `模型调用超过 ${config.timeoutMs} ms 未返回`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ModelCallError('network', redact(`请求失败：${detail}`, config.apiKey).slice(0, 300));
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).trim().slice(0, 200);
      } catch {
        detail = '';
      }
      throw statusError(response.status, detail, config.apiKey);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ModelCallError('format', '模型响应不是合法 JSON');
    }

    const result = parseModelReply(readReplyText(payload));
    // 超上限的直接判失败，而不是悄悄截断：截断会让「谁被选」变成实现细节。
    const limit = selectionLimit(DEFAULT_MAX_SELECTIONS, DEFAULT_MAX_SELECTIONS);
    if (result.selections.length > limit) {
      throw new ModelCallError('format', `模型选了 ${result.selections.length} 句，超过上限 ${limit}`);
    }

    return { result, usage: readUsage(payload), elapsedMs: Math.max(0, now() - startedAt) };
  } finally {
    clearTimeout(timer);
  }
}

/** 把 `callModel` 包成通用 `ModelAdapter`（丢弃 usage：接口只承诺选择结果）。 */
export function providerAdapter(config: ModelConfig, deps: ProviderDeps = {}): ModelAdapter {
  return {
    async rewrite(request: RewriteRequest): Promise<RewriteResult> {
      const outcome = await callModel(config, request, deps);
      return outcome.result;
    },
  };
}
