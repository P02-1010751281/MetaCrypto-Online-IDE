/**
 * 一次性验收脚本：真实无头 Chromium 里的「外来代码」路径（RESULTS §39 → §40 之后改口径）。
 *
 * §39 时代的判据是「零块 + 没有一个能映射成块」；§40 把外来代码交给 AST 路径之后，这条
 * 判据被取代：现在要求的是**部分还原 + 逐条说清缺了什么**，而不是整份拒绝。本脚本因此
 * 验的是新口径（粘一段 LLM 风格 AES：有 for、助手函数、`out.append`、没有生成器题头）：
 *
 *   1. 不再出现「没有一个能映射成块」（那不是现在的行为）；
 *   2. 给出「语法树识别结果」的规模摘要；
 *   3. 出诊断：横幅「没能完整还原」+ 逐条带行号；
 *   4. 「载入工作区」可用，载入后画布有块。
 *
 * 旧口径的截图仍保留在 out/c2w-foreign.png（§39.8 的记录），本脚本写新文件，不覆盖证据。
 *
 * 跑法（先起干净的 vite --port 5199）：
 *   node experiments/ai-helper-2026-11-14/c2w-foreign-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9334;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-foreign-ast.png';

const SBOX = Array.from({ length: 16 }, (_, i) => `0x${(i * 17 + 99).toString(16)}`).join(', ');
const FOREIGN = [
  `SBOX = [${SBOX}]`,
  '',
  'def sub_byte(value):',
  '    return SBOX[value]',
  '',
  'def aes_round(state, key):',
  '    out = []',
  '    for i in range(16):',
  '        out.append(sub_byte(state[i] ^ key[i]))',
  '    return out',
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
      '--user-data-dir=experiments/ai-helper-2026-11-14/cdp-profile-c2w-foreign',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

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
      ready = await evaluate('Boolean(document.querySelector(\'.blocklyMainBackground\'))');
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

    // 外来代码要走 AST 路径：第一次会下载并启动 Pyodide（约 12 MB），窗口给 120 秒。
    let observed = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      observed = await evaluate(`(() => {
        const summary = (document.querySelector('.c2w-summary')?.textContent ?? '').trim();
        const hints = [...document.querySelectorAll('.c2w-hint')].map((node) => (node.textContent ?? '').trim());
        const warn = [...document.querySelectorAll('.c2w-hint--warn')].map((node) => (node.textContent ?? '').trim());
        const applyButton = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (!summary && !warn.some((text) => /还原|映射成块|语法树解析/.test(text))) return null;
        return {
          summary,
          hints,
          warn,
          diagnostics: [...document.querySelectorAll('.c2w-diagnostics-list li')].map((node) => (node.textContent ?? '').trim()),
          notes: [...document.querySelectorAll('.c2w-note')].map((node) => (node.textContent ?? '').trim()),
          applyDisabled: applyButton ? Boolean(applyButton.disabled) : null,
          applyLabel: (applyButton?.textContent ?? '').trim(),
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }

    const text = [...(observed?.warn ?? []), ...(observed?.hints ?? [])].join('\n');
    const checks = {
      astSummary: /语法树识别结果/.test(observed?.summary ?? ''),
      incompleteBanner: /没能完整还原/.test(text),
      noForeignNotice: !/没有一个能映射成块/.test(text),
      perLineDiagnostics: (observed?.diagnostics ?? []).length > 0 && (observed?.diagnostics ?? []).every((line) => /第 \d+ 行/.test(line)),
      applyEnabled: observed?.applyDisabled === false,
    };
    steps.push({ step: 'parsed', ok: Object.values(checks).every(Boolean), checks, observed });

    if (observed?.applyDisabled === false) {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        button?.click();
        return Boolean(button);
      })()`);
      await sleep(1500);
      const canvas = await evaluate(`(() => ({
        dialogOpen: Boolean(document.querySelector('.c2w-overlay')),
        blocks: document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length,
      }))()`);
      steps.push({ step: 'applied', ok: canvas.dialogOpen === false && canvas.blocks > 0, canvas });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    steps.push({ step: 'screenshot', path: OUT });

    process.stdout.write(`${JSON.stringify({ steps }, null, 2)}\n`);
    if (!steps.find((step) => step.step === 'parsed')?.ok) process.exitCode = 1;
  } finally {
    chrome.kill('SIGTERM');
  }
}

await main();
