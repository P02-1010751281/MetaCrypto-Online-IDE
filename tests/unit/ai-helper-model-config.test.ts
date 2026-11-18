// @vitest-environment node
/**
 * D 线模型配置（`model/config.ts`）的回归：协议/回环白名单、档位互斥与归一化。
 *
 * 这些用例保护的是「key 会跑到哪里」这一件事，而不是表单好不好看：
 *   1. 明文 http 只允许回环，别的主机一律判无效（不能「警告后照发」）；
 *   2. 不勾「记住」只落 sessionStorage，勾了才落 localStorage，且两份互斥；
 *   3. 坏 JSON / 不完整配置读出来当「没配置」，不让一处损坏卡住面板。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  MODEL_PERSIST_KEY,
  MODEL_SESSION_KEY,
  chatEndpoint,
  checkConfig,
  clampMaxTokens,
  clampTimeout,
  clearModelConfig,
  loadModelConfig,
  normalizeBaseUrl,
  sameModelConfig,
  saveModelConfig,
  type StorageLike,
} from '@/services/ai-helper/model/config';

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

const CONFIG = {
  baseUrl: 'https://api.example.com/v1',
  modelId: 'cheap-fast',
  apiKey: 'sk-test-123',
  timeoutMs: 20_000,
  maxTokens: 300,
};

describe('base URL 白名单', () => {
  it('https 任意主机可用，末尾斜杠被去掉', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
  });

  it('明文 http 只允许回环（本机 Ollama / LM Studio）', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
    expect(normalizeBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
    // IPv6 回环不放行：CSP 源列表不接受 IPv6 主机，放行只会让请求死在 CSP 上（RESULTS §60）。
    expect(normalizeBaseUrl('http://[::1]:8080/v1')).toBe('');
  });

  it('明文 http 指向外网主机判无效：key 不能明文上网', () => {
    expect(normalizeBaseUrl('http://api.example.com/v1')).toBe('');
    expect(normalizeBaseUrl('ftp://127.0.0.1/v1')).toBe('');
    expect(normalizeBaseUrl('not-a-url')).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
  });

  it('请求地址只补一次 /chat/completions', () => {
    expect(chatEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
    expect(chatEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(chatEndpoint('http://api.example.com/v1')).toBe('');
  });
});

describe('限额归一化', () => {
  it('缺失落回 D 档默认（20 s / 300 token）', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(20_000);
    expect(DEFAULT_MAX_TOKENS).toBe(300);
    expect(clampTimeout(undefined)).toBe(20_000);
    expect(clampMaxTokens(undefined)).toBe(300);
  });

  it('越界夹到区间内，NaN 落回默认（不猜调用方意图）', () => {
    expect(clampTimeout(1)).toBe(1_000);
    expect(clampTimeout(999_999)).toBe(120_000);
    expect(clampTimeout(Number.NaN)).toBe(20_000);
    expect(clampMaxTokens(1)).toBe(32);
    expect(clampMaxTokens(99_999)).toBe(4_000);
    expect(clampMaxTokens(Number.POSITIVE_INFINITY)).toBe(300);
  });
});

describe('必填项校验', () => {
  it('缺项按固定顺序报（界面直接照它标红）', () => {
    const { check } = checkConfig({ baseUrl: 'http://example.com', modelId: ' ', apiKey: '' });
    expect(check.ok).toBe(false);
    expect(check.issues).toEqual(['base-url', 'model-id', 'api-key']);
  });

  it('齐全时给出规范化后的配置', () => {
    const { check, config } = checkConfig({ baseUrl: 'https://api.example.com/v1/', modelId: 'm', apiKey: ' k ' });
    expect(check).toEqual({ ok: true, issues: [] });
    expect(config).toMatchObject({ baseUrl: 'https://api.example.com/v1', modelId: 'm', apiKey: 'k' });
  });
});

describe('存储档位', () => {
  it('默认只写 sessionStorage（关标签页即失）', () => {
    const session = memoryStorage();
    const local = memoryStorage();
    saveModelConfig({ config: CONFIG, remember: false }, session, local);
    expect(session.getItem(MODEL_SESSION_KEY)).not.toBeNull();
    expect(local.dump()).toEqual({});
    expect(loadModelConfig(session, local)).toEqual({ config: CONFIG, remembered: false });
  });

  it('勾「记住」写 localStorage 并清掉 session 副本，两份互斥', () => {
    const session = memoryStorage({ [MODEL_SESSION_KEY]: JSON.stringify(CONFIG) });
    const local = memoryStorage();
    saveModelConfig({ config: CONFIG, remember: true }, session, local);
    expect(session.dump()).toEqual({});
    expect(loadModelConfig(session, local)).toEqual({ config: CONFIG, remembered: true });
  });

  it('一键清除把两个档位都清掉', () => {
    const session = memoryStorage({ [MODEL_SESSION_KEY]: JSON.stringify(CONFIG) });
    const local = memoryStorage({ [MODEL_PERSIST_KEY]: JSON.stringify(CONFIG) });
    clearModelConfig(session, local);
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({});
    expect(loadModelConfig(session, local)).toEqual({ config: null, remembered: false });
  });

  it('坏 JSON 与不完整配置读成「没配置」，不抛异常', () => {
    const session = memoryStorage({ [MODEL_SESSION_KEY]: '{oops' });
    const local = memoryStorage({ [MODEL_PERSIST_KEY]: JSON.stringify({ modelId: 'm' }) });
    expect(loadModelConfig(session, local)).toEqual({ config: null, remembered: false });
  });

  it('内容相同的两份配置判同一份（只改「记住」不该算换配置）', () => {
    const again = { ...CONFIG };
    expect(sameModelConfig(CONFIG, again)).toBe(true);
    // 同一个引用直接短路（null 也是）
    expect(sameModelConfig(CONFIG, CONFIG)).toBe(true);
    expect(sameModelConfig(null, null)).toBe(true);
    expect(sameModelConfig(CONFIG, null)).toBe(false);
    // 归一化之后再比：末尾斜杠与首尾空白不造成假差异
    expect(sameModelConfig(CONFIG, checkConfig({ ...CONFIG, baseUrl: ` ${CONFIG.baseUrl}/ ` }).config)).toBe(true);
  });

  it('任何一项不同都判不同（否则换了 provider 却不重新调用）', () => {
    for (const patch of [
      { baseUrl: 'https://api.other.example.com/v1' },
      { modelId: 'other-model' },
      { apiKey: '{{SECRET_other}}' },
      { timeoutMs: 30_000 },
      { maxTokens: 512 },
    ]) {
      expect(sameModelConfig(CONFIG, { ...CONFIG, ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });
});
