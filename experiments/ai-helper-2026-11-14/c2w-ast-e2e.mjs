/**
 * 一次性验收脚本：在真实无头 Chromium 里复验「外部 Python → 语法树（AST）→ 工作区」这条路。
 *
 * 判据：粘一段没有任何生成器题头的外部 Python（函数 + 分支 + range 循环 + 列表常量），
 * 解析后必须走 AST 路径——出现「语法树识别结果」、没有「未识别」诊断、载入按钮可用；
 * 点「载入工作区」后画布上真的出现积木，且函数块的 NAME 就是源码里的函数名。
 *
 * 这一段跑的是真 Pyodide（public/pyodide/，首次约 12 MB），所以等待窗口给到 90 秒。
 *
 * 跑法（先起干净的 vite --port 5199）：
 *   node experiments/ai-helper-2026-11-14/c2w-ast-e2e.mjs
 */
/* global Buffer, fetch, WebSocket */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME =
  '/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9335;
const URL = 'http://localhost:5199/#/editor/1';
const OUT = 'experiments/ai-helper-2026-11-14/out/c2w-ast.png';

/**
 * 外部实现：没有生成器题头，且带一条列表推导式——模板路径（含 P2.3c 的核心语法层）读不回
 * 推导式，仍会判成外来代码，这样这条脚本验的才是 AST 路径本身。
 */
const FOREIGN = [
  'def mix_columns(state, round_key):',
  '    mixed = state ^ round_key',
  '    if mixed > 255:',
  '        mixed = mixed - 256',
  '    for i in range(4):',
  '        mixed = mixed + i',
  '    return mixed',
  '',
  '',
  'TABLE = [1, 2, 3, 4]',
  '',
  'MASKED = [v ^ 1 for v in TABLE]',
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
      '--user-data-dir=experiments/ai-helper-2026-11-14/cdp-profile-c2w-ast',
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
      buttons.find((button) => /解析|Parse/.test(button.textContent ?? ''))?.click();
      return true;
    })()`);

    // 首次解析要下载并启动 Pyodide（12 MB）：窗口给 90 秒，中途读一次进度提示。
    let observed = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      observed = await evaluate(`(() => {
        const summary = (document.querySelector('.c2w-summary')?.textContent ?? '').trim();
        const warn = [...document.querySelectorAll('.c2w-hint--warn')].map((n) => (n.textContent ?? '').trim());
        const applyButton = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (!summary && !warn.length) return null;
        return {
          summary,
          warn,
          notes: [...document.querySelectorAll('.c2w-note')].map((n) => (n.textContent ?? '').trim()),
          diagnostics: [...document.querySelectorAll('.c2w-diagnostics-list li')].map((n) => (n.textContent ?? '').trim()),
          applyDisabled: applyButton ? Boolean(applyButton.disabled) : null,
          applyLabel: (applyButton?.textContent ?? '').trim(),
        };
      })()`);
      if (observed) break;
      await sleep(500);
    }

    const checks = {
      astSummary: /语法树识别结果/.test(observed?.summary ?? ''),
      applyEnabled: observed?.applyDisabled === false,
      // 这段里有 `^`：结构能出块，但 bit_operation 会把操作数强制成 uint32，必须标成不完整。
      flagsBitwise: (observed?.diagnostics ?? []).some((text) => /uint32/.test(text)),
      incompleteBanner: (observed?.warn ?? []).some((text) => /没能完整还原/.test(text)),
      // 块出来了、只是语义不同：标签必须与「未识别」分开，别让用户去找一块根本没搭出来的语句。
      driftLabel: (observed?.diagnostics ?? []).some((text) => /语义可能不同/.test(text)),
      noForeignNotice: !(observed?.warn ?? []).some((text) => /没有一个能映射成块/.test(text)),
      astNote: (observed?.notes ?? []).some((text) => /语法树（AST）/.test(text)),
    };
    steps.push({ step: 'parsed', ok: Object.values(checks).every(Boolean), checks, observed });

    if (observed && observed.applyDisabled === false) {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.c2w-foot .c2w-primary')][0];
        if (button) button.click();
        return Boolean(button);
      })()`);
      await sleep(1500);
      const canvas = await evaluate(`(() => ({
        dialogOpen: Boolean(document.querySelector('.c2w-overlay')),
        blocks: document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable').length,
        procedures: [...document.querySelectorAll('.blocklyBlockCanvas .blocklyDraggable')]
          .map((node) => (node.textContent ?? '').trim())
          .filter((text) => /mix_columns/.test(text)).length,
      }))()`);
      steps.push({ step: 'applied', ok: canvas.blocks > 0 && canvas.procedures > 0, canvas });
    }

    // 再生成一次代码：判据不是「块看起来像」，而是这些块重新生成的 Python 还是原来那套结构。
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
    // 结构层面的判据：函数签名、分支、循环、返回、顶层常量都在；
    // 按位运算那行按块生成器的真实输出核对（它会带 crypto_to_uint32，正是被标红的原因）。
    const expected = [
      'def mix_columns(state: bytes, round_key: bytes)',
      'crypto_to_uint32(state) ^ crypto_to_uint32(round_key)',
      'if mixed > 255:',
      'mixed = mixed - 256',
      'for i in range(4):',
      'mixed = mixed + i',
      'return mixed',
      'TABLE = [1, 2, 3, 4]',
    ];
    const missing = expected.filter((line) => !code.includes(line));
    steps.push({ step: 'regenerated', ok: missing.length === 0, missing, code });

    // 试运行回归：解析走的是同一个 worker 文件的新分支，必须证明默认分支（真执行）没坏。
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
        const running = Boolean(document.querySelector('.run-output-badge'));
        return {
          running,
          failed: panel.classList.contains('is-failed'),
          text: (panel.querySelector('.run-output-body')?.textContent ?? '').trim().slice(0, 200),
        };
      })()`);
      if (run && !run.running) break;
      await sleep(500);
    }
    steps.push({ step: 'run', ok: Boolean(run) && run.failed === false, run });

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    steps.push({ step: 'screenshot', path: OUT });

    process.stdout.write(`${JSON.stringify({ steps }, null, 2)}\n`);
    if (!steps.find((step) => step.step === 'parsed')?.ok) process.exitCode = 1;
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
