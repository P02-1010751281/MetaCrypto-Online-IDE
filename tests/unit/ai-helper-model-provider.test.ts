// @vitest-environment node
/**
 * D 线模型适配器（`model/provider.ts`）的回归：一次调用、输出形状、失败映射与 key 不外泄。
 *
 * 这里刻意**不做「模型答得对不对」的评测**（那要额度和真实 provider）。全部用例围绕
 * 我们自己的承诺：
 *   1. 一次操作只发一次请求（不重试），超时真取消；
 *   2. key 只进 Authorization，不进请求体、不进错误信息；
 *   3. 输出形状不对/空回复 → 结构化失败，不猜；超上限判失败而不是截断；
 *   4. 真实 HTTP 路径能跑通（本地起一个假 provider，而不是全程 mock fetch）；
 *   5. 解析出来的选择仍要过 `verifyRewrite`，模型没有写入句子的口子。
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelConfig } from '@/services/ai-helper/model/config';
import {
  callModel,
  extractJsonObject,
  parseModelReply,
  providerAdapter,
  readUsage,
  type ModelCallError,
} from '@/services/ai-helper/model/provider';
import { verifyRewrite } from '@/services/ai-helper/model/verify';
import type { RewriteRequest } from '@/services/ai-helper/model/types';

const API_KEY = 'sk-test-123';

const config: ModelConfig = {
  baseUrl: 'https://api.example.com/v1',
  modelId: 'cheap-fast',
  apiKey: API_KEY,
  timeoutMs: 3_000,
  maxTokens: 300,
};

const request: RewriteRequest = {
  question: 'AES 一轮里有哪些步骤？',
  candidates: [
    { id: 's1', path: 'docs/a.md', line: 12, text: 'SubBytes 用 S 盒做逐字节替换。' },
    { id: 's2', path: 'docs/a.md', line: 13, text: 'ShiftRows 把状态矩阵的每一行循环左移。' },
  ],
};

interface Captured {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function replyPayload(content: string, usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }): unknown {
  return { choices: [{ message: { role: 'assistant', content } }], usage };
}

function okBody(): string {
  return JSON.stringify({ selections: [{ id: 's1' }], note: '选第一句', support: ['s1'] });
}

describe('请求形状', () => {
  it('打到 /chat/completions，key 只在 Authorization 头里', async () => {
    const captured: Captured[] = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return jsonResponse(replyPayload(okBody()));
    });

    await callModel(config, request, { fetch: fakeFetch as unknown as typeof fetch });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.example.com/v1/chat/completions');
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);

    const body = String(captured[0].init.body);
    // key 不能出现在请求体里（不随提示词/上下文外发）
    expect(body).not.toContain(API_KEY);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.model).toBe('cheap-fast');
    expect(parsed.temperature).toBe(0);
    expect(parsed.max_tokens).toBe(300);
    expect(parsed.stream).toBe(false);
    const messages = parsed.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    // 候选 id 与原文都在提示词里，模型只能照抄 id
    expect(messages[1].content).toContain('s1 | docs/a.md:12');
    expect(messages[1].content).toContain('ShiftRows');
    expect(messages[0].content).toContain('只输出一个 JSON');
  });

  it('输出只含 id：解析结果没有句子文本字段', async () => {
    const outcome = await callModel(config, request, {
      fetch: (async () => jsonResponse(replyPayload(okBody()))) as unknown as typeof fetch,
    });
    expect(outcome.result.selections).toEqual([{ id: 's1' }]);
    expect(Object.keys(outcome.result.selections[0])).not.toContain('text');
    expect(outcome.usage).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
  });
});

describe('解析：宽松取 JSON、严格验形', () => {
  it('允许 ```json 围栏与前后客套话', () => {
    const text = '好的，结果如下：\n```json\n{"selections":[{"id":"s2"}]}\n```\n以上。';
    expect(parseModelReply(text).selections).toEqual([{ id: 's2' }]);
  });

  it('没有 JSON / 形状不对一律 format 失败', () => {
    expect(() => extractJsonObject('没有对象')).toThrowError(/JSON/);
    expect(() => parseModelReply('{"picks":["s1"]}')).toThrowError(/selections/);
    expect(() => parseModelReply('{"selections":[{"text":"编的句子"}]}')).toThrowError(/id/);
    expect(() => parseModelReply('   ')).toThrowError(/空/);
    // 三类失败都带稳定 code（界面按 code 分支，不解析文案）
    for (const bad of ['没有对象', '{"picks":[]}', '{"selections":[{"text":"x"}]}']) {
      let code = '';
      try {
        parseModelReply(bad);
      } catch (error) {
        code = (error as ModelCallError).code;
      }
      expect(code).toBe('format');
    }
  });

  it('usage 兼容 prompt_tokens 与 input_tokens 两种写法', () => {
    expect(readUsage({ usage: { input_tokens: 7, output_tokens: 9 } })).toEqual({
      inputTokens: 7,
      outputTokens: 9,
      totalTokens: 16,
    });
    expect(readUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('解析结果仍要过引用完整性校验：模型编 id 会被 verifyRewrite 拒', async () => {
    const outcome = await callModel(config, request, {
      fetch: (async () =>
        jsonResponse(replyPayload(JSON.stringify({ selections: [{ id: 'ghost' }] })))) as unknown as typeof fetch,
    });
    const checked = verifyRewrite(request, outcome.result);
    expect(checked.ok).toBe(false);
    expect(checked.errors.map((error) => error.code)).toEqual(['unknown-id']);
  });

  it('超过 5 句判失败，而不是悄悄截断', async () => {
    const many = JSON.stringify({ selections: ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => ({ id })) });
    await expect(
      callModel(config, request, {
        fetch: (async () => jsonResponse(replyPayload(many))) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'format' });
  });
});

describe('失败映射：不重试、不泄露 key', () => {
  const statusCases: Array<[number, string]> = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'http-error'],
    [400, 'http-error'],
  ];

  for (const [status, code] of statusCases) {
    it(`HTTP ${status} → ${code}，且只发一次`, async () => {
      const fakeFetch = vi.fn(async () => new Response('upstream said no', { status }));
      await expect(
        callModel(config, request, { fetch: fakeFetch as unknown as typeof fetch }),
      ).rejects.toMatchObject({ code, status });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });
  }

  it('provider 在错误体里回显 key 时被抹掉', async () => {
    const fakeFetch = vi.fn(async () => new Response(`bad key ${API_KEY}`, { status: 401 }));
    const error = (await callModel(config, request, {
      fetch: fakeFetch as unknown as typeof fetch,
    }).catch((caught: unknown) => caught)) as ModelCallError;
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain('[redacted]');
  });

  it('配置不全时根本不发请求', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(replyPayload(okBody())));
    await expect(
      callModel({ ...config, apiKey: '' }, request, { fetch: fakeFetch as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'not-configured' });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('超时真取消：信号 abort 后判 timeout，不重试', async () => {
    const fakeFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    await expect(
      callModel({ ...config, timeoutMs: 30 }, request, { fetch: fakeFetch as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('响应体不是 JSON 判 format', async () => {
    const fakeFetch = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }));
    await expect(
      callModel(config, request, { fetch: fakeFetch as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'format' });
  });
});

describe('真实 HTTP 路径（本地假 provider）', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  it('走全局 fetch 打到一个真实的 127.0.0.1 端口，并按 usage 记账', async () => {
    const seen: Array<{ auth?: string; body: string }> = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(replyPayload(okBody())));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const outcome = await callModel(
      { ...config, baseUrl: `http://127.0.0.1:${port}/v1` },
      request,
      { now: () => 1_000 },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].auth).toBe(`Bearer ${API_KEY}`);
    expect(seen[0].body).toContain('ShiftRows');
    expect(outcome.result.selections).toEqual([{ id: 's1' }]);
    expect(outcome.usage.totalTokens).toBe(150);
    expect(outcome.elapsedMs).toBe(0);
  });

  it('providerAdapter 是对外统一接口：只回选择结果', async () => {
    const adapter = providerAdapter(config, {
      fetch: (async () => jsonResponse(replyPayload(okBody()))) as unknown as typeof fetch,
    });
    await expect(adapter.rewrite(request)).resolves.toEqual({
      selections: [{ id: 's1' }],
      note: '选第一句',
      support: ['s1'],
    });
  });
});
