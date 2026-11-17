/**
 * 一次性验收脚本：在真实无头 Chromium 里复验「双下拉同翻」这条失败路径。
 *
 * 判据：把 RATE=1344（rate_bytes=168）× SUFFIX=0x1F 的 ML-KEM-Encaps 生成代码粘进面板，
 * 解析后必须给出块数、诊断 0、载入按钮可用；点「载入工作区」后画布上真的出现积木。
 * 这段代码在修组合探测之前会给出 54 条「未识别」（RESULTS §36）。
 *
 * 跑法（先起干净的 vite --port 5199；本机用 playwright 缓存里的 chromium_headless_shell）：
 *   node experiments/ai-helper-2026-11-14/c2w-combo-fixed-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9333;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-combo-fixed.png';
const CODE_FILE = 'experiments/ai-helper-2026-11-14/out/c2w-mutated-mlkem.py';

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
      '--user-data-dir=experiments/ai-helper-2026-11-14/cdp-profile-c2w',
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
    const socketUrl = await connect();
    const { send } = await openSocket(socketUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: URL });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`页面脚本报错：${result.exceptionDetails.text}`);
      return result.result.value;
    };

    // 编辑器就绪
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ready = await evaluate('Boolean(document.querySelector(\'.blocklyMainBackground\'))');
      if (ready) break;
      await sleep(500);
    }
    steps.push({ step: 'editor-ready', ok: ready, url: await evaluate('location.href') });

    // 打开「更多」菜单 → 点「从代码生成工作区」
    const menu = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const trigger =
        buttons.find((button) => button.getAttribute('aria-haspopup') === 'menu') ??
        buttons.find((button) => /更多|More/.test((button.textContent ?? '').trim()));
      if (!trigger) return { ok: false, labels: buttons.map((button) => (button.textContent ?? '').trim()).filter(Boolean).slice(0, 40) };
      trigger.click();
      return { ok: true, label: (trigger.textContent ?? '').trim() };
    })()`);
    steps.push({ step: 'menu-open', ...menu });
    await sleep(300);
    const item = await evaluate(`(() => {
      const items = [...document.querySelectorAll('.dropdown-action')];
      const target = items.find((element) => /从代码生成工作区/.test(element.textContent ?? ''));
      if (!target) return { ok: false, labels: items.map((element) => (element.textContent ?? '').trim()) };
      target.click();
      return { ok: true };
    })()`);
    steps.push({ step: 'dialog-open', ...item });

    // 粘代码 → 解析
    const code = readFileSync(CODE_FILE, 'utf8');
    await evaluate(`(() => {
      const area = document.querySelector('.c2w-text');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, ${JSON.stringify(code)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    const parsedClick = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.c2w-primary')];
      const parseButton = buttons.find((button) => /解析|Parsing|Parse/.test(button.textContent ?? ''));
      if (!parseButton) return false;
      parseButton.click();
      return true;
    })()`);
    steps.push({ step: 'parse-clicked', ok: parsedClick });

    // 等结果出现（首次解析要拉 ~170 KB 模板载荷）
    let observed = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      observed = await evaluate(`(() => {
        const pick = (selector) => document.querySelector(selector);
        const summary = pick('.c2w-summary');
        const error = pick('.c2w-error');
        const warn = pick('.c2w-hint--warn');
        if (!summary && !error && !warn) return null;
        const applyButton = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        return {
          summary: (summary?.textContent ?? '').trim(),
          error: (error?.textContent ?? '').trim(),
          experimentalWarning: (warn?.textContent ?? '').trim(),
          diagnostics: document.querySelectorAll('.c2w-diagnostics-list li').length,
          diagnosticsHead: (pick('.c2w-diagnostics-head')?.textContent ?? '').trim(),
          replaceNote: (pick('.c2w-note')?.textContent ?? '').trim(),
          applyDisabled: applyButton ? Boolean(applyButton.disabled) : null,
          applyLabel: (applyButton?.textContent ?? '').trim(),
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }
    steps.push({ step: 'parsed', ok: Boolean(observed?.summary), observed });

    // 载入工作区 → 数画布上的积木
    if (observed && !observed.applyDisabled) {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (button) button.click();
        return Boolean(button);
      })()`);
      await sleep(1500);
      const canvas = await evaluate(`(() => ({
        dialogOpen: Boolean(document.querySelector('.c2w-overlay')),
        blocks: document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length,
        toast: (document.querySelector('.toast, .c2w-toast')?.textContent ?? '').trim(),
      }))()`);
      steps.push({ step: 'applied', ok: canvas.blocks > 0, canvas });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    steps.push({ step: 'screenshot', path: OUT });

    const consoleErrors = await evaluate('(() => (window.__c2wErrors ?? []).length)()');
    process.stdout.write(`${JSON.stringify({ steps, consoleErrors }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ steps, error: String(error), chromeStderr: stderr.slice(-600) }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    chrome.kill('SIGTERM');
  }
}

void main();
