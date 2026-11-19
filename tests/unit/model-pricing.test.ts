/**
 * D 线费用估算的纯逻辑：单价校验、换算、四舍五入显示与本地存储。
 *
 * 这里守的是四件「看起来对但会害人」的事：
 *   1. 没填单价不能算出 0 元——「免费」与「没填」是两回事；
 *   2. provider 只回合计、不回输入/输出拆分时不估价（按哪个单价折算都是猜）；
 *   3. 小数位随量级走：一次调用常常不到 1 分钱，固定两位小数会全显示成 0.00；
 *   4. 坏存储当没填过，不让一条损坏的 JSON 卡住整个面板。
 */
import { describe, expect, it } from 'vitest';

import type { StorageLike } from '@/services/ai-helper/model/config';
import {
  checkPricing,
  DEFAULT_CURRENCY,
  estimateCost,
  formatCost,
  loadModelPricing,
  MAX_CURRENCY_LENGTH,
  MODEL_PRICING_KEY,
  saveModelPricing,
  type ModelPricing,
  type PricingDraft,
} from '@/services/ai-helper/model/pricing';
import type { TokenUsage } from '@/services/ai-helper/model/provider';

const usage = (inputTokens: number, outputTokens: number, totalTokens = inputTokens + outputTokens): TokenUsage => ({
  inputTokens,
  outputTokens,
  totalTokens,
});

const draft = (overrides: Partial<PricingDraft> = {}): PricingDraft => ({
  inputPerMillion: '3',
  outputPerMillion: '15',
  currency: 'USD',
  ...overrides,
});

const pricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPerMillion: 3,
  outputPerMillion: 15,
  currency: 'USD',
  ...overrides,
});

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('checkPricing', () => {
  it('三项都留空就是不估价（不是 0 元）', () => {
    const check = checkPricing({ inputPerMillion: '', outputPerMillion: '', currency: '' });
    expect(check.pricing).toBeNull();
    expect(check.issues).toEqual([]);
  });

  it('币种留空回落到 USD，输出价留空表示同输入价', () => {
    const check = checkPricing(draft({ outputPerMillion: '', currency: '  ' }));
    expect(check.issues).toEqual([]);
    expect(check.pricing).toEqual({ inputPerMillion: 3, outputPerMillion: null, currency: DEFAULT_CURRENCY });
  });

  it('0 是合法单价（本机模型确实不收费），与"没填"分开', () => {
    const check = checkPricing(draft({ inputPerMillion: '0', outputPerMillion: '0' }));
    expect(check.pricing).toEqual({ inputPerMillion: 0, outputPerMillion: 0, currency: 'USD' });
  });

  it('非数字、负数与带货币符号的串都判无效，而不是静默取前面几个字符', () => {
    for (const raw of ['abc', '-1', '$3', '3元', '1e3', '3,00']) {
      const check = checkPricing(draft({ inputPerMillion: raw }));
      expect(check.issues, raw).toEqual(['price-input']);
      expect(check.pricing, raw).toBeNull();
    }
  });

  it('输出价单独填出来是矛盾配置：报"先填输入单价"而不是静默丢一个', () => {
    const check = checkPricing(draft({ inputPerMillion: '', outputPerMillion: '15' }));
    expect(check.issues).toEqual(['price-need-input']);
    expect(check.pricing).toBeNull();
  });

  it('币种超长被拒（金额要拼进一行状态位）', () => {
    const check = checkPricing(draft({ currency: 'X'.repeat(MAX_CURRENCY_LENGTH + 1) }));
    expect(check.issues).toEqual(['price-currency']);
  });

  it('多项同时错时按固定顺序报，且都要报出来', () => {
    const check = checkPricing(draft({ inputPerMillion: 'x', outputPerMillion: 'y', currency: 'TOOLONGLABEL' }));
    expect(check.issues).toEqual(['price-input', 'price-output', 'price-currency']);
  });
});

describe('estimateCost', () => {
  it('没填单价就没有估算（返回 null 而不是 0）', () => {
    expect(estimateCost(usage(100, 8), null)).toBeNull();
  });

  it('没有用量时不算钱', () => {
    expect(estimateCost(null, pricing())).toBeNull();
    expect(estimateCost(usage(0, 0, 0), pricing())).toBeNull();
  });

  it('只回合计、不回输入/输出拆分时不估价（不猜配比）', () => {
    expect(estimateCost(usage(0, 0, 132), pricing())).toBeNull();
  });

  it('按输入/输出单价分别折算：100×3 + 8×15 每百万', () => {
    const estimate = estimateCost(usage(100, 8), pricing());
    expect(estimate).not.toBeNull();
    expect(estimate!.currency).toBe('USD');
    expect(estimate!.amount).toBeCloseTo((100 * 3 + 8 * 15) / 1_000_000, 12);
  });

  it('输出价留空时输出 token 按输入价计', () => {
    const estimate = estimateCost(usage(100, 100), pricing({ outputPerMillion: null }));
    expect(estimate!.amount).toBeCloseTo((200 * 3) / 1_000_000, 12);
  });

  it('单价为 0 时估算就是 0（与没有估算不同）', () => {
    const estimate = estimateCost(usage(100, 8), pricing({ inputPerMillion: 0, outputPerMillion: 0 }));
    expect(estimate).not.toBeNull();
    expect(estimate!.amount).toBe(0);
  });
});

describe('formatCost', () => {
  it('小数位随量级走：大额两位、分位四位、更小六位、极小用科学计数', () => {
    const show = (amount: number): string => formatCost({ amount, currency: 'USD' });
    expect(show(12.3456)).toBe('USD 12.35');
    expect(show(1)).toBe('USD 1');
    expect(show(0.01234)).toBe('USD 0.0123');
    expect(show(0.000396)).toBe('USD 0.000396');
    expect(show(0.0000123)).toBe('USD 1.23e-5');
    expect(show(0)).toBe('USD 0');
  });

  it('符号币种直接相连，字母币种空一格', () => {
    expect(formatCost({ amount: 0.0004, currency: '¥' })).toBe('¥0.0004');
    expect(formatCost({ amount: 0.0004, currency: 'CNY' })).toBe('CNY 0.0004');
  });
});

describe('loadModelPricing / saveModelPricing', () => {
  it('写入后能原样读回（含输出价留空）', () => {
    const storage = memoryStorage();
    saveModelPricing(pricing(), storage);
    expect(storage.map.has(MODEL_PRICING_KEY)).toBe(true);
    expect(loadModelPricing(storage)).toEqual(pricing());

    saveModelPricing(pricing({ outputPerMillion: null }), storage);
    expect(loadModelPricing(storage)).toEqual(pricing({ outputPerMillion: null }));
  });

  it('保存 null 是删除，而不是留一份 0', () => {
    const storage = memoryStorage();
    saveModelPricing(pricing(), storage);
    saveModelPricing(null, storage);
    expect(storage.map.has(MODEL_PRICING_KEY)).toBe(false);
    expect(loadModelPricing(storage)).toBeNull();
  });

  it('坏 JSON / 顶层不是对象 / 负单价都当没存过', () => {
    for (const raw of ['{oops', '[]', 'null', '{"inputPerMillion":-1}', '{"inputPerMillion":"3"}']) {
      expect(loadModelPricing(memoryStorage({ [MODEL_PRICING_KEY]: raw })), raw).toBeNull();
    }
  });

  it('输出价缺失或非法时退回"同输入价"，币种缺失回落到 USD', () => {
    const storage = memoryStorage({ [MODEL_PRICING_KEY]: '{"inputPerMillion":3,"outputPerMillion":"x"}' });
    expect(loadModelPricing(storage)).toEqual({ inputPerMillion: 3, outputPerMillion: null, currency: DEFAULT_CURRENCY });
  });

  it('币种超长时截断到上限（避免历史数据把状态位撑开）', () => {
    const storage = memoryStorage({ [MODEL_PRICING_KEY]: '{"inputPerMillion":3,"currency":"ABCDEFGHIJK"}' });
    expect(loadModelPricing(storage)?.currency).toBe('ABCDEFGH');
    expect(loadModelPricing(storage)?.currency).toHaveLength(MAX_CURRENCY_LENGTH);
  });
});
