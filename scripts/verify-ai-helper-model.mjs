#!/usr/bin/env node
/**
 * D 线「让模型选句」（BYOK）的真浏览器验收：默认关、配置校验、存储档位互斥、
 * 真实 HTTP 请求（本地假 provider，穿过 CSP 的 connect-src）与「失败不吞答案」。
 *
 * 为什么必须在浏览器里验：这一段的判据全在接缝上——
 *   · 「默认关时一个请求都不发」只有真网络计数能证明；
 *   · 会话档 / 持久档的切换是 sessionStorage 与 localStorage 的互斥，单测造的是假 storage；
 *   · CSP 的 connect-src 是浏览器策略，fetch 桩永远绕过它；
 *   · 弹窗层级、v-model 回填、失败后答案卡是否还在，都只在真实渲染里成立。
 *
 * 本地假 provider 不是兜底：仓库里没有任何 key，也不能把真实 key 带进验收。
 * 它按 OpenAI 兼容形状回答，并记录收到的请求，用来核对「key 只进 Authorization、
 * 不进请求体」「temperature 0 / stream false / max_tokens 300」。
 *
 * 用法：
 *   npm run dev -- --port 5242 --strictPort      # 另开终端（干净实例，dev server 会缓存已删模块）
 *   BASE_URL=http://localhost:5242 node scripts/verify-ai-helper-model.mjs
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境不满足。
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5242';
const CDP_PORT = Number(process.env.CDP_PORT || 9361);
const FAKE_PORT = Number(process.env.FAKE_PORT || 9137);
const OUT = process.env.OUT_DIR || 'experiments/ai-helper-2026-11-14/out/model-browser';
const CHROME =
  process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const KEY = 'cc-browser-test-key-0123456789';
const MODEL_ID = 'fake-model';
const APP = `${BASE_URL}/#/editor/1`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });

try {
  const response = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(String(response.status));
} catch (error) {
  console.error(`verify-ai-helper-model ENV: ${BASE_URL} 不可达（${String(error)}），先起 npm run dev -- --port 5242`);
  process.exit(2);
}

// ---- 假 provider：记录每一次请求，按 mode 决定成功或 429 -------------------------------
const calls = [];
let mode = 'ok';

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
};

const fake = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    calls.push({ url: req.url, method: req.method, headers: req.headers, body: bodyText });
    if (mode === 'rate') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited by fake provider' } }));
      return;
    }
    if (mode === 'note-only') {
      // 校验层失败：给了 note 却不给 support（`unsupported-note`）。界面必须说
      // 「说明没标注依据」，不能笼统说成「选中的句子不在候选里」（RESULTS §60.8 第 3 条）。
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ selections: [{ id: 's1' }], note: 'note-without-support' }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 },
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                selections: [{ id: 's1' }],
                note: 'fake-provider-note',
                support: ['s1'],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 },
      }),
    );
  });
});

await new Promise((resolve, reject) => {
  fake.once('error', reject);
  fake.listen(FAKE_PORT, '127.0.0.1', resolve);
});

// Chrome 配置目录放项目里而不是 /tmp：每跑一次都要重新写一遍缓存，
// 而 /tmp 是 tmpfs，几个 harness 连跑就会把它占满、把整台机器的 shell 一起憋死
// （2026-11-18 实测：/tmp 16G 被历史 profile 填到 100%，DSH 的 bash 直接起不来）。
const PROFILE_ROOT = join(process.cwd(), '.tmp-build');
mkdirSync(PROFILE_ROOT, { recursive: true });
const profile = mkdtempSync(join(PROFILE_ROOT, 'chrome-model-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,900', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, APP,
  ],
  { stdio: 'ignore' },
);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <<< ${String(JSON.stringify(detail ?? null)).slice(0, 400)}`}`);
};

async function pageTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await globalThis.fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page' && entry.url.startsWith('http'));
      if (page) return page;
    } catch {
      /* chrome 还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error('no page target');
}

let ws;
try {
  const page = await pageTarget();
  ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
} catch (error) {
  console.error(`verify-ai-helper-model ENV: 连不上 Chrome CDP（${String(error)}）`);
  chrome.kill();
  fake.close();
  process.exit(2);
}

let seq = 0;
const pendingCalls = new Map();
const pageErrors = [];
const consoleErrors = [];
const cspViolations = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    consoleErrors.push(text.slice(0, 300));
    if (/Content Security Policy|Refused to connect/i.test(text)) cspViolations.push(text.slice(0, 300));
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry.level === 'error' && /Content Security Policy|Refused to connect/i.test(entry.text ?? '')) {
      cspViolations.push(String(entry.text).slice(0, 300));
    }
  }
  if (message.id && pendingCalls.has(message.id)) {
    pendingCalls.get(message.id)(message);
    pendingCalls.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pendingCalls.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

async function js(expression) {
  const reply = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
  return reply.result?.result?.value;
}

async function waitFor(expression, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await js(expression)) return true;
    } catch {
      /* 页面正在渲染，重试 */
    }
    await sleep(200);
  }
  return false;
}

async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
}

// ---- 页面侧读取器 ---------------------------------------------------------------------
const READ_BAR = `(() => {
  const bar = document.querySelector('.dsp .as-bar');
  if (!bar) return null;
  const toggle = bar.querySelector('.as-toggle input');
  const status = bar.querySelector('.as-status');
  const section = bar.closest('.as');
  return {
    label: bar.querySelector('.as-toggle span')?.textContent?.trim() ?? '',
    checked: !!toggle && toggle.checked,
    status: status?.textContent?.trim() ?? '',
    statusError: !!status && status.classList.contains('as-status-error'),
    note: section?.querySelector('.as-note')?.textContent?.trim() ?? '',
    hint: section?.querySelector('.as-hint')?.textContent?.trim() ?? '',
    dialog: !!document.querySelector('.dsp .msd'),
  };
})()`;

const READ_ANSWER = `(() => {
  const card = document.querySelector('.dsp .ac');
  if (!card) return null;
  return {
    miss: card.classList.contains('ac-miss'),
    sentences: [...card.querySelectorAll('.ac-item .ac-text')].map((el) => el.textContent.trim()),
    source: card.querySelector('.ac-link')?.textContent?.trim() ?? null,
  };
})()`;

const READ_STORAGE = `(() => ({
  session: window.sessionStorage.getItem('ciphercat.ai-model.session'),
  persist: window.localStorage.getItem('ciphercat.ai-model.persist'),
}))()`;

const READ_DIALOG_ERROR = 'document.querySelector(\'.dsp .msd .msd-error\')?.textContent?.trim() ?? \'\'';

async function openAssistant() {
  return js(`(() => {
    const button = [...document.querySelectorAll('.activity-bar .activity-btn')].find((b) => b.title === '问答助手');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function setDocQuery(value) {
  return js(`(() => {
    const input = document.querySelector('.dsp-input');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function fillDialog(values) {
  return js(`(() => {
    const inputs = [...document.querySelectorAll('.dsp .msd .msd-input')];
    if (inputs.length !== 3) return { ok: false, count: inputs.length };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    ${JSON.stringify([values.baseUrl, values.modelId, values.apiKey])}.forEach((value, index) => {
      setter.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    });
    return { ok: true, count: inputs.length };
  })()`);
}

const ANSWER_READY = `(() => {
  const card = document.querySelector('.dsp .ac');
  if (!card) return false;
  return card.querySelectorAll('.ac-item .ac-text').length > 0 || card.classList.contains('ac-miss');
})()`;

try {
  check('编辑器就绪', await waitFor('document.querySelector(\'.editor-view\') !== null', 90000));
  check('问答助手入口可点开', await openAssistant());
  check('助手壳渲染', await waitFor('document.querySelector(\'.aip\') !== null', 15000));

  await setDocQuery('SM4 密钥扩展');
  check('检索命中并落成答案卡', await waitFor(ANSWER_READY, 30000));
  const before = await js(READ_ANSWER);
  check('答案卡有原文句与 path:line 出处',
    !!before && before.miss === false && before.sentences.length >= 1 && /docs\/standards\/.+:\d+/.test(before.source ?? ''),
    before);

  const bar = await js(READ_BAR);
  check('答案区出现模型工具条（开关 + 设置 + 状态位）', !!bar, bar);
  check('开关默认关闭', bar?.checked === false, bar);
  check('开关文案走 locale（让模型选句）', bar?.label === '让模型选句', bar);
  check('默认关时状态位为空（没有「未配置」之类噪音）', bar?.status === '', bar);
  check('默认关时一个请求都不发（provider 收到 0 次调用）', calls.length === 0, calls.length);
  await shoot('model-01-default-off');

  // 1. 打开开关但没配置 → 自动弹设置窗，并明确说「未配置」
  await js('document.querySelector(\'.dsp .as-bar .as-toggle input\').click()');
  check('打开开关后自动弹设置窗', await waitFor('document.querySelector(\'.dsp .msd\') !== null', 5000));
  const noConfig = await js(READ_BAR);
  check('未配置时状态位说「未配置模型」且给下一步提示',
    noConfig?.status === '未配置模型' && (noConfig?.hint ?? '').includes('模型设置'), noConfig);
  check('弹窗标题与数据说明在位', await js(`(() => {
    const dialog = document.querySelector('.dsp .msd');
    return !!dialog && dialog.getAttribute('role') === 'dialog'
      && (dialog.querySelector('.msd-title')?.textContent ?? '').includes('自带 key')
      && (dialog.querySelector('.msd-notice')?.textContent ?? '').includes('key 只走请求头');
  })()`));
  await shoot('model-02-dialog-empty');

  // 2. 空值与非法 Base URL 都必须在对话框里拦住，不落存储、不发请求
  await js('document.querySelector(\'.dsp .msd .msd-primary\').click()');
  await sleep(300);
  const required = await js(READ_DIALOG_ERROR);
  check('三项必填校验挡住空保存', required.includes('Base URL') && required.includes('必填'), required);

  await fillDialog({ baseUrl: 'http://example.com/v1', modelId: MODEL_ID, apiKey: KEY });
  await js('document.querySelector(\'.dsp .msd .msd-primary\').click()');
  await sleep(300);
  const badUrl = await js(READ_DIALOG_ERROR);
  check('明文 http 的非本机地址被拒（不是 https 也不是回环）', badUrl.includes('Base URL 必须是 https'), badUrl);
  check('被拒时对话框不关闭、仍是未配置', await js('!!document.querySelector(\'.dsp .msd\')'));
  const afterBad = await js(READ_STORAGE);
  check('被拒时什么都没写进存储', afterBad.session === null && afterBad.persist === null, afterBad);
  check('被拒时没有发出任何请求', calls.length === 0, calls.length);
  await shoot('model-03-dialog-invalid');

  // 3. 合法配置（本机回环 http）→ 落会话档，开关保持开，立刻用当前答案调一次
  await fillDialog({ baseUrl: `http://127.0.0.1:${FAKE_PORT}/v1`, modelId: MODEL_ID, apiKey: KEY });
  await js('document.querySelector(\'.dsp .msd .msd-primary\').click()');
  check('保存后对话框关闭', await waitFor('document.querySelector(\'.dsp .msd\') === null', 5000));
  check('模型调用返回并被采纳（状态位出现「模型选了 1 句」）',
    await waitFor(`(() => {
      const status = document.querySelector('.dsp .as-bar .as-status');
      return !!status && (status.textContent ?? '').includes('模型选了 1 句');
    })()`, 20000));
  await sleep(400);

  const stored = await js(READ_STORAGE);
  check('不勾「记住」时只写会话档（localStorage 为空）',
    typeof stored.session === 'string' && stored.session.includes(KEY) && stored.persist === null, stored);

  check('provider 恰好收到 1 次请求（一次操作一次调用）', calls.length === 1, calls.length);
  const call = calls[0] ?? { headers: {}, body: '{}' };
  let payload = {};
  try {
    payload = JSON.parse(call.body);
  } catch {
    payload = {};
  }
  const messagesText = (payload.messages ?? []).map((m) => m.content).join('\n');
  check('请求打到 /v1/chat/completions', call.url === '/v1/chat/completions', call.url);
  check('key 只在 Authorization 头里', call.headers.authorization === `Bearer ${KEY}`, call.headers.authorization);
  check('key 不在请求体里（正文 0 命中）', !call.body.includes(KEY), call.body.slice(0, 200));
  check('请求体是选句用的确定性形状（temperature 0 / stream false / max_tokens 300）',
    payload.temperature === 0 && payload.stream === false && payload.max_tokens === 300 && payload.model === MODEL_ID,
    { temperature: payload.temperature, stream: payload.stream, max_tokens: payload.max_tokens, model: payload.model });
  check('提示词带上了用户问题与候选句（含候选 id 与出处行）',
    messagesText.includes('SM4 密钥扩展') && /s1 \| docs\/standards\/.+:\d+/.test(messagesText),
    messagesText.slice(0, 240));

  const afterModel = await js(READ_ANSWER);
  check('模型只缩小/重排同一段句子：选中句来自原答案，出处不变',
    !!afterModel && afterModel.sentences.length === 1 && before.sentences.includes(afterModel.sentences[0])
      && afterModel.source === before.source,
    { before, afterModel });
  const barAfter = await js(READ_BAR);
  check('状态位报告选中句数与本次 token/耗时',
    /模型选了 1 句 · 132 tokens · \d+ ms/.test(barAfter.status), barAfter.status);
  check('模型自述单独标注「不进答案证据」',
    (barAfter.note ?? '').includes('模型说明（不进答案证据）') && (barAfter.note ?? '').includes('fake-provider-note'),
    barAfter.note);
  await shoot('model-04-selected');

  // 4. 重载后：配置还在（会话档），但开关回到默认关，且不发请求
  //    必须用 Page.reload：导航到同一个带 hash 的 URL 是 same-document，并不会真的重载。
  await send('Page.reload', { ignoreCache: false });
  await sleep(500);
  check('重载后编辑器就绪', await waitFor('document.querySelector(\'.editor-view\') !== null', 90000));
  const reloadCalls = calls.length;
  check('重载后按需点开问答助手', await js(`(() => {
    if (document.querySelector('.aip')) return true;
    const button = [...document.querySelectorAll('.activity-bar .activity-btn')].find((b) => b.title === '问答助手');
    button?.click();
    return !!button;
  })()`));
  check('重载后助手壳渲染', await waitFor('document.querySelector(\'.aip\') !== null', 15000));
  await setDocQuery('SM4 密钥扩展');
  check('重载后答案卡再次出现', await waitFor(ANSWER_READY, 30000));
  const reloadBar = await js(READ_BAR);
  check('重载后开关仍是默认关（配置在、开关不自己开）', reloadBar?.checked === false, reloadBar);
  check('重载后未开开关时仍不发请求', calls.length === reloadCalls, { reloadCalls, now: calls.length });
  check('重载后会话档配置仍在', (await js(READ_STORAGE)).session?.includes(KEY) === true);

  await js('document.querySelector(\'.dsp .as-bar .as-toggle input\').click()');
  check('已配置时打开开关不再弹设置窗', await waitFor('document.querySelector(\'.dsp .msd\') === null', 3000)
    && (await js(READ_BAR))?.dialog === false);
  check('重载后打开开关能再次调用并选中', await waitFor(`(() => {
    const status = document.querySelector('.dsp .as-bar .as-status');
    return !!status && (status.textContent ?? '').includes('模型选了 1 句');
  })()`, 20000));
  check('第二次调用仍是 1 次请求（共 2 次）', calls.length === reloadCalls + 1, calls.length);
  await shoot('model-05-reload-on');

  // 5. 失败不吞答案：429 只加一行原因，检索答案仍在
  mode = 'rate';
  await setDocQuery('SM4 密钥扩展 轮密钥');
  check('429 落成一条结构化失败原因', await waitFor(`(() => {
    const status = document.querySelector('.dsp .as-bar .as-status');
    return !!status && status.classList.contains('as-status-error')
      && (status.textContent ?? '').includes('额度或频率受限（429）');
  })()`, 20000));
  const failedAnswer = await js(READ_ANSWER);
  check('失败时检索答案与出处仍在（不吞答案）',
    !!failedAnswer && failedAnswer.miss === false && failedAnswer.sentences.length >= 1
      && /docs\/standards\/.+:\d+/.test(failedAnswer.source ?? ''), failedAnswer);
  const failedBar = await js(READ_BAR);
  check('失败原因前面有「模型调用失败：」前缀', failedBar.status.startsWith('模型调用失败：'), failedBar.status);
  check('失败后不重试（请求数只 +1）', calls.length === reloadCalls + 2, calls.length);
  await shoot('model-06-rate-limited');

  // 5b. 校验层失败要说对原因：note 没给 support 是「说明没标注依据」，不是「句子不在候选里」
  mode = 'note-only';
  await setDocQuery('SM4 密钥扩展');
  await waitFor(ANSWER_READY, 30000);
  check('校验失败按类别说话：模型给了说明却没标注依据', await waitFor(`(() => {
    const status = document.querySelector('.dsp .as-bar .as-status');
    return !!status && status.classList.contains('as-status-error')
      && (status.textContent ?? '').includes('模型给了说明却没标注依据');
  })()`, 20000));
  const verifyBar = await js(READ_BAR);
  check('校验失败不会冒充「句子不在候选里」（URL 越界的说法）',
    !(verifyBar?.status ?? '').includes('不在候选里'), verifyBar?.status);
  const verifyAnswer = await js(READ_ANSWER);
  check('校验失败时检索答案与出处仍在',
    !!verifyAnswer && verifyAnswer.miss === false && verifyAnswer.sentences.length >= 1
      && /docs\/standards\/.+:\d+/.test(verifyAnswer.source ?? ''), verifyAnswer);
  check('校验失败后不重试（请求数只 +1）', calls.length === reloadCalls + 3, calls.length);
  await shoot('model-06b-verify-unsupported');

  // 6. 存储档位：勾「记住」→ 持久档，清会话档
  await js('document.querySelector(\'.dsp .as-bar .as-btn\').click()');
  check('「模型设置」按钮打开弹窗', await waitFor('document.querySelector(\'.dsp .msd\') !== null', 5000));
  const prefilled = await js(`(() => {
    const inputs = [...document.querySelectorAll('.dsp .msd .msd-input')];
    return { baseUrl: inputs[0]?.value ?? '', modelId: inputs[1]?.value ?? '', apiKey: inputs[2]?.value ?? '' };
  })()`);
  check('弹窗回填当前真正在用的配置',
    prefilled.baseUrl === `http://127.0.0.1:${FAKE_PORT}/v1` && prefilled.modelId === MODEL_ID && prefilled.apiKey === KEY,
    prefilled);
  await js('document.querySelector(\'.dsp .msd .msd-remember input\').click()');
  const callsBeforeRemember = calls.length;
  await js('document.querySelector(\'.dsp .msd .msd-primary\').click()');
  await sleep(600);
  check('只改「记住」不重新调用模型（配置内容没变就不该再烧额度）',
    calls.length === callsBeforeRemember, { callsBeforeRemember, now: calls.length });
  const persisted = await js(READ_STORAGE);
  check('勾「记住」后写持久档并清掉会话档（两份互斥）',
    persisted.session === null && typeof persisted.persist === 'string' && persisted.persist.includes(KEY), persisted);

  // 7. 一键清除：两个档位一起清、开关自动关、状态位清空
  await js('document.querySelector(\'.dsp .as-bar .as-btn\').click()');
  await waitFor('document.querySelector(\'.dsp .msd\') !== null', 5000);
  await js('document.querySelector(\'.dsp .msd .msd-foot .msd-btn\').click()');
  await sleep(600);
  const cleared = await js(READ_STORAGE);
  check('清除后两个档位都为空', cleared.session === null && cleared.persist === null, cleared);
  const clearedBar = await js(READ_BAR);
  check('清除后开关关闭、状态位清空',
    clearedBar?.checked === false && clearedBar?.status === '' && clearedBar?.hint === '', clearedBar);
  await shoot('model-07-cleared');

  check('CSP 未拦截回环 provider（0 条 CSP 违规）', cspViolations.length === 0, cspViolations.slice(0, 3));
  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3));
  check('控制台无 error（含 CORS/网络错误）', consoleErrors.length === 0, consoleErrors.slice(0, 3));
} catch (error) {
  check(`执行中断：${String(error).slice(0, 200)}`, false);
} finally {
  const failed = results.filter((entry) => !entry.ok).length;
  writeFileSync(
    join(OUT, 'summary.json'),
    `${JSON.stringify({ baseUrl: BASE_URL, fakePort: FAKE_PORT, calls: calls.map((c) => ({ url: c.url, body: c.body })), results }, null, 2)}\n`,
  );
  console.log(`\nAI_HELPER_MODEL_SUMMARY total=${results.length} pass=${results.length - failed} fail=${failed}`);
  ws?.close();
  chrome.kill();
  fake.close();
  try {
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  } catch (error) {
    console.warn(`profile 清理失败（${String(error)}）：${profile}`);
  }
  process.exit(failed ? 1 : 0);
}
