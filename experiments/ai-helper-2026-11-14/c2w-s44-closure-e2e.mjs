/**
 * 一次性验收脚本：§44.6 缺口收口后的真实浏览器验收（非字面量推导式、切片钳位、两参 range）。
 *
 * 走真实无头 Chromium 的「更多菜单 → 从代码生成工作区 → 解析 → 载入 → 再生成」，验四件事：
 *   1. `[v * 2 for v in range(n)]` 脱糖成「空列表 + 循环 + append」，再生成代码里有 `table = []`
 *      与 `table.append(...)`，而不是一条 unsupported 诊断；
 *   2. 带 `if` 的推导式展开成循环 + `if` + append（`odds.append(...)`）；
 *   3. `state[i:]` 的长度被 `math_constrain` 钳位，再生成代码里出现 `min(max(`；
 *   4. `for k in range(0, len(state))` 落到 `ctrl_range`，再生成代码是 `range(0, len(state))`。
 * 汇总要求：0 条诊断（这些构造现在都能忠实表达），且载入后画布有块。
 *
 * 跑法（先起干净的 vite --port 5199）：
 *   node experiments/ai-helper-2026-11-14/c2w-s44-closure-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9339;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-s44-closure.png';

const SAMPLE = [
  'def expand(state, i, n):',
  '    head = state[0:4]',
  '    tail = state[i:]',
  '    table = [v * 2 for v in range(n)]',
  '    odds = [v for v in range(n) if v > 2]',
  '    acc = 0',
  '    for k in range(0, len(state)):',
  '        acc = acc + k',
  '    return acc',
  '',
].join('\n');

/** 再生成代码里必须出现的片段（不写死空格与括号，生成器排版变化不算失败）。 */
const EXPECTED = [
  'def expand(',
  'min(max(',
  'table = []',
  'table.append(',
  'odds = []',
  'odds.append(',
  'if v > 2:',
  'range(0, len(state))',
];

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
      // 复用 e2e 的浏览器 profile：里面已有 project 1，否则 /#/editor/1 没有可打开的工作区。
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
        const applyButton = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (!summary) return null;
        return {
          summary,
          hints: [...document.querySelectorAll('.c2w-hint')].map((node) => (node.textContent ?? '').trim()),
          diagnostics: [...document.querySelectorAll('.c2w-diagnostics-list li')].map((node) => (node.textContent ?? '').trim()),
          applyDisabled: applyButton ? Boolean(applyButton.disabled) : null,
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }

    const checks = {
      summary: /识别结果/.test(observed?.summary ?? ''),
      // 这些构造现在都能忠实表达：既不许有 unsupported，也不该再有漂移诊断。
      noDiagnostics: (observed?.diagnostics ?? []).length === 0,
      summaryZero: /0 处诊断|0 条诊断/.test(observed?.summary ?? ''),
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
      const missing = EXPECTED.filter((fragment) => !code.includes(fragment));
      const evidence = code
        .split('\n')
        .filter((line) => /def expand|table|odds|append|min\(max|range\(0, len/.test(line))
        .slice(0, 14);
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
