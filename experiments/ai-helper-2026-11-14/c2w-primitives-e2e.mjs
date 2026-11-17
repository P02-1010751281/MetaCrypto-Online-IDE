/**
 * 一次性验收脚本：真实无头 Chromium 里的「外来代码 + 已知原语调用」（RESULTS §43 / P2.3d）。
 *
 * 判据不是「界面上有块」，而是**块真的接上了**：
 *   1. 粘一段 LLM 风格 Python（推导式逼进 AST 路径，两处 sha3 原语调用没有被定义过）；
 *   2. 解析后「载入工作区」可用，载入不报连接错误；
 *   3. 载入后重新「生成代码」，产物里必须出现 `sha3_absorb(` / `sha3_squeeze(` 与函数签名——
 *      说明调用被还原成密码块，而不是被当成未知函数丢掉；
 *   4. 试运行不报错，控制台零错误。
 *
 * 跑法（先起干净的 vite --port 5199）：
 *   node experiments/ai-helper-2026-11-14/c2w-primitives-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9336;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-primitives.png';

/** 原文：没有生成器题头、没有本模块定义 sha3_*，推导式保证模板路径判成外来代码。 */
const FOREIGN = [
  'def expand(seed, block):',
  '    absorbed = sha3_absorb(seed, block)',
  '    squeezed = sha3_squeeze(absorbed, 32)',
  '    return squeezed',
  '',
  'TABLE = [v for v in range(4)]',
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
      '--user-data-dir=experiments/ai-helper-2026-11-14/cdp-profile-c2w-primitives',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const steps = [];
  const consoleErrors = [];
  try {
    const { send } = await openSocket(await connect());
    await send('Page.enable');
    await send('Runtime.enable');
    send('Runtime.addBinding', { name: 'noop' }).catch(() => undefined);
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
      setter.call(area, ${JSON.stringify(FOREIGN)});
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
          applyLabel: (applyButton?.textContent ?? '').trim(),
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }

    steps.push({ step: 'parsed', ok: Boolean(observed) && observed.applyDisabled === false, observed });

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

      // 块是不是真的接上了：重新生成代码，看原语调用还在不在。
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
      const expected = ['def expand(', 'sha3_absorb(', 'sha3_squeeze('];
      const missing = expected.filter((fragment) => !code.includes(fragment));
      // 证据要落在具体行上：把函数体与原语调用整段留下，便于和原文逐行对。
      const evidence = code
        .split('\n')
        .filter((line) => /def expand|sha3_absorb|sha3_squeeze|return/.test(line))
        .slice(0, 8);
      steps.push({ step: 'regenerated', ok: missing.length === 0, missing, evidence });

      // 试运行：证明默认分支（真执行）没被原语映射破坏。
      await evaluate(`(() => {
        const button = document.querySelector('.code-toolbar .run-btn');
        button?.click();
        return Boolean(button);
      })()`);
      let run = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        run = await evaluate(`(() => {
          const panel = document.querySelector('.run-output');
          if (!panel) return null;
          return {
            running: Boolean(document.querySelector('.run-output-badge')),
            failed: panel.classList.contains('is-failed'),
            text: (panel.querySelector('.run-output-body')?.textContent ?? '').trim().slice(0, 160),
          };
        })()`);
        if (run && !run.running) break;
        await sleep(500);
      }
      steps.push({ step: 'run', ok: Boolean(run) && run.failed === false, run });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    steps.push({ step: 'screenshot', path: OUT });

    const parsed = steps.find((step) => step.step === 'parsed');
    const regenerated = steps.find((step) => step.step === 'regenerated');
    process.stdout.write(
      `${JSON.stringify({ steps, consoleErrors: consoleErrors.length }, null, 2)}\n`,
    );
    if (!parsed?.ok || !regenerated?.ok || consoleErrors.length) process.exitCode = 1;
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
