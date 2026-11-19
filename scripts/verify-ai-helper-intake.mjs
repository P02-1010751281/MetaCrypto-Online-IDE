#!/usr/bin/env node
/**
 * A/B 单入口（PLAN P5）的真浏览器验收。
 *
 * 为什么必须在浏览器里验：判别内核已有单测，但**路由**全在接缝上——
 *   · 「活动条只有一个入口」是渲染结果，不是文案；
 *   · 判别结果是否真的预填到开关、用户改判后是否有可见标记，只有真实渲染能证明；
 *   · 「继续」之后是否带着正文跳到 B 线面板、文档是否跳到 A 线面板，是跨组件的状态传递。
 *
 * 用法：
 *   npm run preview -- --host 127.0.0.1 --port 5216 --strictPort   # 先构建：npm run build
 *   BASE_URL=http://127.0.0.1:5216 node scripts/verify-ai-helper-intake.mjs
 *
 * 退出码：0 = 全部通过；1 = 有断言失败；2 = 环境不满足。
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5216';
const CDP_PORT = Number(process.env.CDP_PORT || 9363);
const CHROME =
  process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const APP = `${BASE_URL}/#/editor/1`;
const OUT = process.env.OUT_DIR || 'experiments/ai-helper-2026-11-14/out/intake-browser';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const response = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(String(response.status));
} catch (error) {
  console.error(`verify-ai-helper-intake ENV: ${BASE_URL} 不可达（${String(error)}）`);
  process.exit(2);
}

// 配置目录放项目里：/tmp 是 tmpfs，几个 harness 连跑就会把它占满（见 verify-ai-helper-model 的注释）。
const PROFILE_ROOT = join(process.cwd(), '.tmp-build');
mkdirSync(PROFILE_ROOT, { recursive: true });
const profile = mkdtempSync(join(PROFILE_ROOT, 'chrome-intake-'));
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
  console.error(`verify-ai-helper-intake ENV: 连不上 Chrome CDP（${String(error)}）`);
  chrome.kill();
  process.exit(2);
}

let seq = 0;
const pending = new Map();
const pageErrors = [];
const consoleErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 300));
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');

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

/** 截图存证：验收入口的关键三态（判别、路由到 B、路由到 A）。 */
async function shoot(name) {
  const reply = await send('Page.captureScreenshot', { format: 'png' });
  const data = reply.result?.data;
  if (!data) throw new Error(`screenshot failed: ${name}`);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}

async function waitFor(expression, timeoutMs = 30000) {
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

const PY = 'def sm4_key_expand(key):\n    return key ^ 0x1F\n';
const DOC = '# SM4 密钥扩展\n\n第 1 章 范围\n\nGB/T 32907-2016 规定了 SM4 的密钥扩展。\n';

/** 把文本塞进 textarea 并触发 input（Vue 的 v-model 只认原生 setter + input 事件）。 */
const setTextarea = (selector, text) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const clickChoice = (kind) => js(`(() => {
  const buttons = [...document.querySelectorAll('.ip-choice')];
  const index = ${kind === 'doc' ? 0 : 1};
  if (!buttons[index]) return false;
  buttons[index].click();
  return true;
})()`);

const openIntake = () => js(`(() => {
  const button = [...document.querySelectorAll('.activity-btn')].find((el) => (el.title ?? '').includes('从文件开始'));
  if (!button) return false;
  button.click();
  return true;
})()`);

const readVerdict = () => js(`(() => {
  const panel = document.querySelector('.ip');
  if (!panel) return null;
  return {
    kind: panel.querySelector('.ip-verdict-kind')?.textContent?.trim() ?? '',
    evidence: panel.querySelector('.ip-verdict-evidence')?.textContent?.trim() ?? '',
    overridden: panel.querySelector('.ip-verdict-note')?.textContent?.trim() ?? '',
    docOn: panel.querySelectorAll('.ip-choice')[0]?.getAttribute('aria-pressed') === 'true',
    codeOn: panel.querySelectorAll('.ip-choice')[1]?.getAttribute('aria-pressed') === 'true',
  };
})()`);

try {
  check('编辑器就绪', await waitFor('document.querySelector(\'.editor-view\') !== null', 90000));

  // 1. 活动条只有一个 A/B 入口
  const buttons = await js('(() => [...document.querySelectorAll(\'.activity-btn\')].map((el) => el.title))()');
  check('活动条上不再有独立的「从代码生成工作区」图标', !buttons.some((title) => title === '从代码生成工作区'), buttons);
  check('活动条上不再有独立的「标准 → 工作区」图标', !buttons.some((title) => title === '标准 → 工作区'), buttons);
  check('活动条只剩一个 A/B 单入口', buttons.filter((title) => (title ?? '').includes('从文件开始')).length === 1, buttons);

  // 2. 打开单入口：空输入时判不出来，继续按钮不可用
  check('单入口面板能打开', await openIntake() && await waitFor('document.querySelector(\'.ip\') !== null', 10000));
  check('空输入时判定为「判断不了」', (await js('document.querySelector(\'.ip-verdict-kind\')?.textContent?.trim()')) === '判断不了');
  check('空输入时「继续」不可用', await js('document.querySelector(\'.ip-primary\')?.disabled === true'));

  // 3. 粘贴代码：预填「代码（B 线）」且给出依据
  check('粘贴的内容进了输入框', await setTextarea('.ip-text', PY));
  let verdict = await readVerdict();
  check('代码正文被判别为「代码（B 线）」', verdict?.kind === '代码（B 线）', verdict);
  check('判别结果带依据（不是凭空的结论）', (verdict?.evidence ?? '').includes('正文像代码'), verdict?.evidence);
  check('判别结果预填到开关（代码侧按下）', verdict?.codeOn === true && verdict?.docOn === false, verdict);
  await shoot('intake-01-detect-code');

  // 4. 用户改判：可见、可改，且明确标出「这是你改的」
  check('可以改判成文档', await clickChoice('doc'));
  verdict = await readVerdict();
  check('改判后开关切到文档侧', verdict?.docOn === true && verdict?.codeOn === false, verdict);
  check('改判有可见标记（不是静默）', (verdict?.overridden ?? '').includes('已由你改判'), verdict?.overridden);
  check('可以再改回代码', await clickChoice('code'));
  verdict = await readVerdict();
  check('改回代码后标记消失（与机器判断一致）', verdict?.codeOn === true && verdict?.overridden === '', verdict);

  // 5. 继续 → B 线面板，正文被预填（不自动解析）
  await js('document.querySelector(\'.ip-primary\').click()');
  check('继续后切到 B 线面板', await waitFor('document.querySelector(\'.c2w\') !== null', 10000));
  const prefilled = await js('document.querySelector(\'.c2w-text\')?.value ?? \'\'');
  check('B 线面板拿到了正文（预填而不是空面板）', prefilled === PY, prefilled);
  check('预填不自动解析（等用户点「解析」）',
    await js('!document.querySelector(\'.c2w-diagnostics\') && !document.querySelector(\'.c2w-summary\')'));
  await shoot('intake-02-routed-code');

  // 6. 文档路由：粘贴标准正文 → 判文档 → 继续 → A 线面板
  check('回到单入口', await openIntake() && await waitFor('document.querySelector(\'.ip\') !== null', 10000));
  check('文档正文进了输入框', await setTextarea('.ip-text', DOC));
  verdict = await readVerdict();
  check('标准正文被判别为「文档（A 线）」', verdict?.kind === '文档（A 线）', verdict);
  check('文档判别带依据（标准编号/章节结构）', (verdict?.evidence ?? '').includes('正文像文档'), verdict?.evidence);
  await js('document.querySelector(\'.ip-primary\').click()');
  check('继续后切到 A 线面板', await waitFor('document.querySelector(\'.stw\') !== null', 15000));
  await shoot('intake-03-routed-doc');

  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2));
  check('控制台无 error', consoleErrors.length === 0, consoleErrors.slice(0, 2));
} catch (error) {
  check('脚本自身未抛异常', false, String(error).slice(0, 300));
} finally {
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\nAI_HELPER_INTAKE_SUMMARY total=${results.length} pass=${results.length - failed} fail=${failed}`);
  ws?.close();
  chrome.kill();
  process.exit(failed === 0 ? 0 : 1);
}
