/**
 * D 线费用估算：用户自填单价 → 本次调用的 token 换算成金额。
 *
 * 三条口径写死在这里，界面不各自解释：
 *
 * 1. **仓库里没有价目表**：不同 provider、不同模型、不同时间价格都不同，内置一张表只会
 *    过期，还会让人以为金额是「平台算的」。单价由用户按自己的账单填，我们不替他查价。
 * 2. **没填单价就不显示费用**：不拿 0 或猜一个数字顶上——「这次是免费的」与「你没填价」
 *    是两回事，后者不能显示成前者。
 * 3. **只做估算**：金额按 provider 返回的 usage 换算后四舍五入显示，界面上带「≈」。
 *    缓存命中价、推理 token 的额外计费、阶梯价都不在模型内，实际以 provider 账单为准。
 *
 * 单价按「每百万 token」计（OpenAI 兼容接口的通用标价口径），输入/输出分开：两者价差
 * 常常是 3–5 倍，混成一个数会让估价系统性偏低。输出单价留空则同输入单价——用户只知道
 * 一个混合价时，不必编第二个数。
 *
 * 本模块不碰 DOM：storage 由调用方传入（与 `config.ts` 同口径）。
 */
import type { StorageLike } from './config';
import type { TokenUsage } from './provider';

/** 单价存本机 localStorage：不是密钥，没必要每开一个标签页重填。 */
export const MODEL_PRICING_KEY = 'ciphercat.ai-model.pricing';

export const DEFAULT_CURRENCY = 'USD';
/** 币种标签上限：金额要拼进一行状态位，不能让它无限长。 */
export const MAX_CURRENCY_LENGTH = 8;

const TOKENS_PER_UNIT = 1_000_000;

export interface ModelPricing {
  /** 每百万输入 token 的单价。 */
  readonly inputPerMillion: number;
  /** 每百万输出 token 的单价；null = 与输入同价。 */
  readonly outputPerMillion: number | null;
  /** 币种标签（USD / CNY / ¥ …）：只用于显示，不参与换算。 */
  readonly currency: string;
}

/** 设置表单里的原始输入（字符串，便于原样回填与校验报错）。 */
export interface PricingDraft {
  readonly inputPerMillion: string;
  readonly outputPerMillion: string;
  readonly currency: string;
}

export type PricingIssue = 'price-input' | 'price-output' | 'price-currency' | 'price-need-input';

export interface PricingCheck {
  /** 通过时为归一化后的单价；`inputPerMillion` 留空则为 null（= 不估价）。 */
  readonly pricing: ModelPricing | null;
  /** 逐项问题；按固定顺序，界面照它标红。 */
  readonly issues: readonly PricingIssue[];
}

/**
 * 解析单价：空 → 不估价；非数字/负数 → 记问题（而不是默默当 0）。
 *
 * 0 是合法值（本机 Ollama 一类确实不收费），所以「空」与「0」必须分开：
 * 前者不显示费用，后者显示 ≈0。
 */
function parsePrice(raw: string): { value: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, invalid: false };
  // 允许用户从账单里抄 `$3.00` 或 `3.00元`：只取数字部分会静默改语义，这里仍要求纯数字。
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { value: null, invalid: true };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { value: null, invalid: true };
  return { value, invalid: false };
}

/** 校验并归一化单价表单。 */
export function checkPricing(draft: PricingDraft): PricingCheck {
  const issues: PricingIssue[] = [];
  const input = parsePrice(draft.inputPerMillion);
  const output = parsePrice(draft.outputPerMillion);
  if (input.invalid) issues.push('price-input');
  if (output.invalid) issues.push('price-output');

  const currency = draft.currency.trim() || DEFAULT_CURRENCY;
  if (currency.length > MAX_CURRENCY_LENGTH) issues.push('price-currency');

  if (issues.length > 0) return { pricing: null, issues };
  // 输入价空着就没有估价基准：此时只填输出价是矛盾的（用户显然想估价，但公式缺一半），
  // 报出来让人补，而不是静默存一份用不上的单价。
  if (input.value === null) {
    return output.value === null
      ? { pricing: null, issues }
      : { pricing: null, issues: ['price-need-input'] };
  }
  return {
    pricing: { inputPerMillion: input.value, outputPerMillion: output.value, currency },
    issues,
  };
}

export interface CostEstimate {
  readonly amount: number;
  readonly currency: string;
}

/**
 * 本次调用的估算金额。
 *
 * 返回 null 的三种情况都不该显示金额：
 *   · 没填单价（用户没授权我们估价）；
 *   · 没有用量（provider 没回 usage，或调用在拿到响应前就失败）；
 *   · provider 只回了 `total_tokens` 而没回输入/输出拆分——按哪个单价折算都是猜，
 *     宁可不给数（界面仍显示 token 与耗时）。
 */
export function estimateCost(usage: TokenUsage | null, pricing: ModelPricing | null): CostEstimate | null {
  if (!pricing || !usage) return null;
  if (usage.totalTokens <= 0) return null;
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return null;
  const outputPrice = pricing.outputPerMillion ?? pricing.inputPerMillion;
  const amount =
    (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * outputPrice) / TOKENS_PER_UNIT;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, currency: pricing.currency };
}

/** 金额的精度随量级走：一次调用常常不到 1 分钱，固定两位小数会全显示成 0.00。 */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  if (amount >= 1) return trimZeros(amount.toFixed(2));
  if (amount >= 0.01) return trimZeros(amount.toFixed(4));
  if (amount >= 0.0001) return trimZeros(amount.toFixed(6));
  return amount.toExponential(2);
}

function trimZeros(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * 金额展示：币种标签 + 数字。
 *
 * 符号币种（¥ / $ / €）直接相连，字母币种（USD / CNY）中间空一格——`¥0.0004` 与
 * `USD 0.0004` 都是一眼能读的写法，反过来都会别扭。
 */
export function formatCost(estimate: CostEstimate): string {
  const gap = /^[A-Za-z]/.test(estimate.currency) ? ' ' : '';
  return `${estimate.currency}${gap}${formatAmount(estimate.amount)}`;
}

/** 读单价：坏数据当没填过（一处损坏的 JSON 不该卡住整个面板）。 */
export function loadModelPricing(local: StorageLike): ModelPricing | null {
  const raw = local.getItem(MODEL_PRICING_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const input = record.inputPerMillion;
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return null;
  const output = record.outputPerMillion;
  const currency = typeof record.currency === 'string' && record.currency.trim() ? record.currency.trim() : DEFAULT_CURRENCY;
  return {
    inputPerMillion: input,
    outputPerMillion: typeof output === 'number' && Number.isFinite(output) && output >= 0 ? output : null,
    currency: currency.slice(0, MAX_CURRENCY_LENGTH),
  };
}

/** 写单价：null 表示用户清空了单价，直接从存储里删掉而不是留一份 0。 */
export function saveModelPricing(pricing: ModelPricing | null, local: StorageLike): void {
  if (!pricing) {
    local.removeItem(MODEL_PRICING_KEY);
    return;
  }
  local.setItem(MODEL_PRICING_KEY, JSON.stringify(pricing));
}
