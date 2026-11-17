/**
 * 一次性验收脚本：真实无头 Chromium 里的「range(n) / 切片 / 推导式」（RESULTS §44 / P2.3d 第 1+2 条）。
 *
 * 这段代码刻意只用**模板路径**能读的写法（没有推导式外的外来构造），用来验两件事：
 *   1. 一参数 `range(n)` 现在落到 `ctrl_iterate`（TIMES 是值输入），不再是 `controls_for` 的
 *      upRange/downRange——解析后没有「没有对应块」的逐条诊断；
 *   2. 切片 `state[0:4]` 与字面量推导式 `[v * 2 for v in range(4)]` 都能出块，
 *      再生成的代码里保留 `crypto_array_slice(state, 0, 4)`、展开后的列表项与 `range(n)`。
 *
 * 跑法（先起干净的 vite --port 5199）：
 *   node experiments/ai-helper-2026-11-14/c2w-range-slice-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9337;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-range-slice.png';

const SAMPLE = [
  'def expand(state, n):',
  '    head = state[0:4]',
  '    table = [v * 2 for v in range(4)]',
  '    acc = 0',
  '    for i in range(n):',
  '        acc = acc + i',
  '    return acc',
  '',
].join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来：继续等 */
    }
    await sleep(300);
  }
  throw new Error('devtools endpoint 没起来');
}

function openSocket(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ send }));
    ws.addEventListener('error', reject);
  });
}

async function main() {
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,900',
      '--user-data-dir=experiments/ai-helper-2026-11-14/cdp-profile-c2w-range-slice',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const steps = [];
  try {
    const { send } = await openSocket(await connect());
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: URL });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`页面脚本报错：${result.exceptionDetails.text}`);
      return result.result.value;
    };

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ready = await evaluate("Boolean(document.querySelector('.blocklyMainBackground'))");
      if (ready) break;
      await sleep(500);
    }
    steps.push({ step: 'editor-ready', ok: ready, url: await evaluate('location.href') });

    await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const trigger =
        buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu') ??
        buttons.find((button) => /更多|More/.test((button.textContent ?? '').trim()));
      trigger?.click();
      return Boolean(trigger);
    })()`);
    await sleep(300);
    const opened = await evaluate(`(() => {
      const items = [...document.querySelectorAll('.dropdown-action')];
      const target = items.find((element) => /从代码生成工作区/.test(element.textContent ?? ''));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    steps.push({ step: 'dialog-open', ok: opened });
    await sleep(200);

    await evaluate(`(() => {
      const area = document.querySelector('.c2w-text');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, ${JSON.stringify(SAMPLE)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.c2w-primary')];
      buttons.find((button) => /解析|Parsing|Parse/.test(button.textContent ?? ''))?.click();
      return true;
    })()`);

    let observed = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      observed = await evaluate(`(() => {
        const summary = (document.querySelector('.c2w-summary')?.textContent ?? '').trim();
        const hints = [...document.querySelectorAll('.c2w-hint')].map((node) => (node.textContent ?? '').trim());
        const applyButton = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (!summary) return null;
        return {
          summary,
          hints,
          diagnostics: [...document.querySelectorAll('.c2w-diagnostics-list li')].map((node) => (node.textContent ?? '').trim()),
          applyDisabled: applyButton ? Boolean(applyButton.disabled) : null,
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }

    const checks = {
      summary: /识别结果/.test(observed?.summary ?? ''),
      noUnresolved: (observed?.diagnostics ?? []).every((line) => !/未识别|没有对应块/.test(line)),
      applyEnabled: observed?.applyDisabled === false,
    };
    steps.push({ step: 'parsed', ok: Object.values(checks).every(Boolean), checks, observed });

    if (observed?.applyDisabled === false) {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        button?.click();
        return Boolean(button);
      })()`);
      await sleep(1800);
      const canvas = await evaluate(`(() => ({
        dialogOpen: Boolean(document.querySelector('.c2w-overlay')),
        blocks: document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length,
      }))()`);
      steps.push({ step: 'applied', ok: canvas.dialogOpen === false && canvas.blocks > 0, canvas });

      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.code-toolbar .toolbar-btn')]
          .find((element) => /生成|Generate/.test(element.textContent ?? ''));
        button?.click();
        return Boolean(button);
      })()`);
      await sleep(1500);
      const code = await evaluate(
        "(() => (document.querySelector('.code-preview-container .code-content')?.textContent ?? ''))()",
      );
      const expected = ['crypto_array_slice(state, 0, 4)', 'for i in range(n):', '0 * 2', '3 * 2'];
      const missing = expected.filter((fragment) => !code.includes(fragment));
      const evidence = code
        .split('\n')
        .filter((line) => /expand|crypto_array_slice|range\(n\)|table|acc/.test(line))
        .slice(0, 8);
      steps.push({ step: 'regenerated', ok: missing.length === 0, missing, evidence });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    steps.push({ step: 'screenshot', path: OUT });

    const parsed = steps.find((step) => step.step === 'parsed');
    const regenerated = steps.find((step) => step.step === 'regenerated');
    process.stdout.write(`${JSON.stringify({ steps }, null, 2)}\n`);
    if (!parsed?.ok || !regenerated?.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ steps, error: String(error), chromeStderr: stderr.slice(-600) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    chrome.kill('SIGTERM');
  }
}

await main();
