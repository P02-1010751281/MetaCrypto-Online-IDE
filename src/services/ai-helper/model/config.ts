/**
 * D 线模型的配置与 key 存储档位（BYOK，PARALLEL-EXECUTION §3.2/§3.3）。
 *
 * 三条口径写死在这里，界面与适配器都不再各自解释：
 *
 * 1. **仓库里不出现任何 provider**：base URL、模型 id、key 全部由用户填，
 *    没有默认值、没有环境变量、没有内置 key；空配置就是「没接模型」，不是「用默认的」。
 * 2. **默认不落盘**：key 先放 `sessionStorage`（关标签页即失）；只有用户显式勾了
 *    「记住」才落 `localStorage`。不做「前端加密后存 localStorage」——密钥也在同一个
 *    页面里，XSS 一样能拿到，那只是自欺（§3.3）。
 * 3. **明文只走 loopback**：`https://` 任意主机可填；`http://` 只允许 127.0.0.1 /
 *    localhost / [::1]（本机 Ollama、LM Studio 一类）。别的主机名上走 http 会把
 *    key 明文发到网络上，直接判配置无效，而不是「警告后照发」。
 *
 * 本模块不碰 DOM 全局：storage 由调用方传入，单测用内存实现即可跑。
 */

/** 会话档（默认）：关标签页即失。 */
export const MODEL_SESSION_KEY = 'ciphercat.ai-model.session';
/** 持久档（用户显式勾「记住」才写）。 */
export const MODEL_PERSIST_KEY = 'ciphercat.ai-model.persist';

/** D 档的一次调用上限（§3.4）：20 s、≤300 输出 token、0 次重试。 */
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_TOKENS = 300;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MIN_MAX_TOKENS = 32;
export const MAX_MAX_TOKENS = 4_000;

export interface ModelConfig {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
}

/** 只填了一半的配置（设置表单的原始输入）。 */
export interface ModelConfigDraft {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ConfigIssue = 'base-url' | 'model-id' | 'api-key';

export interface ConfigCheck {
  readonly ok: boolean;
  /** 缺哪些必填项；按固定顺序，界面直接照它标红。 */
  readonly issues: readonly ConfigIssue[];
}

/**
 * 本机回环地址：只有这几个主机名允许走明文 http。
 *
 * 不收 IPv6 字面量（`[::1]`）：浏览器的 CSP 源列表不接受 IPv6 主机——Chromium 把
 * `http://[::1]:*` 判成 invalid source 并整条忽略（实测控制台原文见 RESULTS §60），
 * 于是「配置放行、请求必被 CSP 拦掉」只会变成一个莫名其妙的网络错误。
 * 本机 provider 用 `127.0.0.1` 或 `localhost`。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * 规范化 base URL：去空白、去末尾 `/`、校验协议。
 *
 * 不合法返回空串（而不是抛异常）：调用方拿空串就是「配置不可用」，
 * 校验器与界面共用这一个判定，不会出现「表单说合法、请求时才炸」。
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return '';
  }

  if (url.protocol === 'https:') return trimmed;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return trimmed;
  return '';
}

/** 实际请求地址：已经写到 `/chat/completions` 就原样用，否则补上（OpenAI 兼容路径）。 */
export function chatEndpoint(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return '';
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

/** 超时归一化：非数值落回默认；越界夹到区间内，保证「一次调用最多等这么久」。 */
export function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

/** 输出 token 上限归一化：同超时，越界夹紧而不是猜用户意图。 */
export function clampMaxTokens(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.floor(value)));
}

/**
 * 校验必填三项。
 *
 * key 只查「非空」——格式因 provider 而异，猜格式只会把合法 key 判死。
 * base URL 走 `normalizeBaseUrl` 的同一套协议/回环规则。
 */
export function checkConfig(draft: ModelConfigDraft): { check: ConfigCheck; config: ModelConfig } {
  const issues: ConfigIssue[] = [];
  const baseUrl = normalizeBaseUrl(draft.baseUrl);
  if (!baseUrl) issues.push('base-url');
  const modelId = draft.modelId.trim();
  if (!modelId) issues.push('model-id');
  const apiKey = draft.apiKey.trim();
  if (!apiKey) issues.push('api-key');

  return {
    check: { ok: issues.length === 0, issues },
    config: {
      baseUrl,
      modelId,
      apiKey,
      timeoutMs: clampTimeout(draft.timeoutMs),
      maxTokens: clampMaxTokens(draft.maxTokens),
    },
  };
}

/** 存下来的一条配置（与 `ModelConfig` 同形；单独命名是为了让序列化格式显式）。 */
type StoredConfig = ModelConfig;

/**
 * 两份配置内容是否相同。
 *
 * 用途只有一个：`save()` 在内容没变时保留**原来的对象引用**。界面按 `config` 的身份
 * 触发调用（见 `AnswerSection` 的 watch），换一个内容一样的新对象就会再烧一次额度——
 * 2026-11-18 真浏览器验收实测：只勾／去掉「记住」并保存，也会发一次模型请求。§3.4 说的是
 * 「一次操作一次调用」，改存储档位不是一次新的提问。
 *
 * 比较的是 `checkConfig` 归一化之后的字段，所以末尾斜杠、首尾空白不会造成假差异。
 */
export function sameModelConfig(a: ModelConfig | null, b: ModelConfig | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.baseUrl === b.baseUrl &&
    a.modelId === b.modelId &&
    a.apiKey === b.apiKey &&
    a.timeoutMs === b.timeoutMs &&
    a.maxTokens === b.maxTokens
  );
}

function parseStored(raw: string | null): StoredConfig | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 坏数据当没存过，不让一处损坏的 JSON 卡住整个面板
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const draft: ModelConfigDraft = {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    modelId: typeof record.modelId === 'string' ? record.modelId : '',
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    timeoutMs: typeof record.timeoutMs === 'number' ? record.timeoutMs : undefined,
    maxTokens: typeof record.maxTokens === 'number' ? record.maxTokens : undefined,
  };
  const { check, config } = checkConfig(draft);
  return check.ok ? config : null;
}

export interface LoadedModelConfig {
  readonly config: ModelConfig | null;
  /** true 表示来自持久档（用户勾过「记住」）。 */
  readonly remembered: boolean;
}

/**
 * 读配置：先看持久档，再看会话档。
 *
 * 持久档优先：用户勾了「记住」时保存会把会话档清掉，这里再兜一次顺序，
 * 即使两份同时存在（旧版本残留）也不会读到过期的会话档。
 */
export function loadModelConfig(session: StorageLike, local: StorageLike): LoadedModelConfig {
  const persisted = parseStored(local.getItem(MODEL_PERSIST_KEY));
  if (persisted) return { config: persisted, remembered: true };
  const volatile = parseStored(session.getItem(MODEL_SESSION_KEY));
  return { config: volatile, remembered: false };
}

/**
 * 写配置：按档位互斥落一处。
 *
 * 勾「记住」→ 写持久档并清会话档；不勾 → 写会话档并清持久档。
 * 互斥是刻意的：两份共存时「关标签页即失」的承诺就破了。
 */
export function saveModelConfig(
  target: { config: ModelConfig; remember: boolean },
  session: StorageLike,
  local: StorageLike,
): void {
  const text = JSON.stringify(target.config satisfies StoredConfig);
  if (target.remember) {
    local.setItem(MODEL_PERSIST_KEY, text);
    session.removeItem(MODEL_SESSION_KEY);
    return;
  }
  session.setItem(MODEL_SESSION_KEY, text);
  local.removeItem(MODEL_PERSIST_KEY);
}

/** 清除：两个档位一起清（「一键清除」不能让持久档残留）。 */
export function clearModelConfig(session: StorageLike, local: StorageLike): void {
  session.removeItem(MODEL_SESSION_KEY);
  local.removeItem(MODEL_PERSIST_KEY);
}
