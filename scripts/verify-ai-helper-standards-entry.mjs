#!/usr/bin/env node
/**
 * A 线入口的真浏览器验收：不替用户选第一条、按编号匹配预选、文件哈希核对。
 *
 * 为什么必须在浏览器里验：匹配与核对的内核各有单测，但这三件事只在运行期成立——
 *   · 「进来不预选」是面板挂载后的渲染结果（原来无条件选中 standards[0]）；
 *   · 「匹配后预选」要穿过单入口 → 路由 → 异步面板三步，跨组件状态；
 *   · 「文件核对」用的是 WebCrypto 与真实的 File 对象，单测里造的是假摘要。
 *
 * 用法：
 *   npm run build && npm run preview -- --host 127.0.0.1 --port 5217 --strictPort
 *   BASE_URL=http://127.0.0.1:5217 node scripts/verify-ai-helper-standards-entry.mjs
 *
 * 退出码：0 = 全部通过；1 = 有断言失败；2 = 环境不满足（含核对样本与登记哈希不符）。
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5217';
const CDP_PORT = Number(process.env.CDP_PORT || 9364);
const CHROME =
  process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const APP = `${BASE_URL}/#/editor/1`;
const OUT = process.env.OUT_DIR || 'experiments/ai-helper-2026-11-14/out/standards-entry';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 核对样本：登记原文本身。哈希对不上就说明样本过期，不能拿它当「一致」的证据。 */
const SOURCE_PATH = 'docs/standards/sp800-38c-ccm/00-Standard-Source.md';
const SOURCE_BYTES = readFileSync(SOURCE_PATH);
const SOURCE_SHA = createHash('sha256').update(SOURCE_BYTES).digest('hex');
const INDEX = JSON.parse(readFileSync('src/services/ai-helper/verdicts-index.json', 'utf8'));
const CCM = INDEX.standards.find((item) => item.standard.id === 'sp800-38c-ccm');
if (!CCM || CCM.inputs?.anchorsSource?.sha256 !== SOURCE_SHA) {
  console.error(`verify-standards-entry ENV: ${SOURCE_PATH} 的 sha256 与登记值不符（样本过期，先跑 docs:index/verdicts:index）`);
  process.exit(2);
}

try {
  const response = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(String(response.status));
} catch (error) {
  console.error(`verify-standards-entry ENV: ${BASE_URL} 不可达（${String(error)}）`);
  process.exit(2);
}

// 配置目录放项目里：/tmp 是 tmpfs，几个 harness 连跑就会把它占满。
const PROFILE_ROOT = join(process.cwd(), '.tmp-build');
mkdirSync(PROFILE_ROOT, { recursive: true });
const profile = mkdtempSync(join(PROFILE_ROOT, 'chrome-standards-'));
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
  console.error(`verify-standards-entry ENV: 连不上 Chrome CDP（${String(error)}）`);
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
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
  return reply.result?.result?.value;
}

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

const CCM_TEXT = 'NIST SP 800-38C\n\n附录 A 生成 CCM 标签\n\nA.1 输入：K、N、A、P。\n';
const PLAIN_TEXT = '这是一份临时笔记：记了三件事，没有标准编号，也没有章节结构。\n';

const setTextarea = (selector, text) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const openIntake = () => js(`(() => {
  const button = [...document.querySelectorAll('.activity-btn')].find((el) => (el.title ?? '').includes('从文件开始'));
  if (!button) return false;
  button.click();
  return true;
})()`);

const continueToPanel = () => js(`(() => {
  const button = document.querySelector('.ip-primary');
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`);

const clickChoice = (kind) => js(`(() => {
  const buttons = [...document.querySelectorAll('.ip-choice')];
  const index = ${kind === 'doc' ? 0 : 1};
  if (!buttons[index]) return false;
  buttons[index].click();
  return true;
})()`);

const readPanel = () => js(`(() => {
  const panel = document.querySelector('.stw');
  if (!panel) return null;
  const tabs = [...panel.querySelectorAll('.stw-standard')];
  return {
    tabs: tabs.map((tab) => tab.querySelector('.stw-standard-name')?.textContent?.trim() ?? ''),
    activeTab: tabs.find((tab) => tab.classList.contains('active'))?.querySelector('.stw-standard-name')?.textContent?.trim() ?? '',
    note: panel.querySelector('.stw-entry-note--match')?.textContent?.trim() ?? '',
    noteTone: panel.querySelector('.stw-entry-note--match')?.className ?? '',
    pickHint: panel.querySelector('.stw-entry-empty')?.textContent?.trim() ?? '',
    emptyBody: panel.querySelector('.stw-empty')?.textContent?.trim() ?? '',
    clauses: panel.querySelectorAll('.stw-clause').length,
    verifyButton: panel.querySelector('.stw-verify button')?.textContent?.trim() ?? '',
    verifyResult: panel.querySelector('.stw-verify-result')?.textContent?.trim() ?? '',
    verifyTone: panel.querySelector('.stw-verify-result')?.className ?? '',
    overflow: panel.scrollWidth - panel.clientWidth,
    lastTabRight: Math.round(
      [...panel.querySelectorAll('.stw-standard')].reduce((max, tab) => Math.max(max, tab.getBoundingClientRect().right), 0),
    ),
    panelRight: Math.round(panel.getBoundingClientRect().right),
  };
})()`);

/** 把一段字节作为 File 塞进核对输入框并触发 change（走真实的 File + DataTransfer）。 */
const feedFile = (base64, name) => js(`(() => {
  const input = document.querySelector('.stw-verify-input');
  if (!input) return false;
  const raw = atob(${JSON.stringify(base64)});
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  const file = new File([bytes], ${JSON.stringify(name)}, { type: 'application/octet-stream' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

try {
  check('编辑器就绪', await waitFor('document.querySelector(\'.editor-view\') !== null', 90000));

  // 1. 带标准编号的正文：路由到 A 线并**按编号预选**（不是第一条 SHA-2）
  check('打开单入口', await openIntake() && await waitFor('document.querySelector(\'.ip\') !== null', 10000));
  check('粘贴带编号的正文', await setTextarea('.ip-text', CCM_TEXT));
  check('判别为文档', await waitFor('document.querySelector(\'.ip-verdict-kind\')?.textContent?.includes(\'文档\')', 5000));
  check('继续进入 A 线面板', await continueToPanel() && await waitFor('document.querySelector(\'.stw-entry\') !== null', 30000));

  let panel = await readPanel();
  check('条目列表就是三份登记标准', panel?.tabs.length === 3, panel?.tabs);
  check('预选的是 SP 800-38C（按编号认，不是第一条）', panel?.activeTab === 'NIST SP 800-38C', panel?.activeTab);
  check('给出匹配依据（说明只按编号认）', (panel?.note ?? '').includes('SP 800-38C'), panel?.note);
  check('匹配提示是「命中」样式而非报错', (panel?.noteTone ?? '').includes('--hit'), panel?.noteTone);
  check('预选后直接能看到判据条款', (panel?.clauses ?? 0) > 0, panel?.clauses);
  check('条目卡片不越出面板右边界', (panel?.lastTabRight ?? 0) <= (panel?.panelRight ?? 0), panel);
  check('面板内容不横向溢出', (panel?.overflow ?? 99) <= 1, panel?.overflow);
  await shoot('standards-01-matched');

  // 2. 手动换条目：匹配说明要让位给用户的选择
  check('点 FIPS 180-4 条目', await js(`(() => {
    const tab = [...document.querySelectorAll('.stw-standard')].find((el) => (el.textContent ?? '').includes('FIPS 180-4'));
    if (!tab) return false;
    tab.click();
    return true;
  })()`));
  panel = await readPanel();
  check('换条目后匹配说明消失', (panel?.note ?? '') === '', panel?.note);
  check('换条目后判据跟着换（仍是 FIPS 的条款）', (panel?.activeTab ?? '') === 'NIST FIPS 180-4', panel?.activeTab);

  // 3. 认不出来的正文：不预选，给空态 + 让用户自己选
  check('回到单入口', await openIntake() && await waitFor('document.querySelector(\'.ip\') !== null', 10000));
  check('粘贴没有编号的正文', await setTextarea('.ip-text', PLAIN_TEXT));
  check('判不出来时手动指定走文档', await clickChoice('doc'));
  check('继续回到 A 线面板', await continueToPanel() && await waitFor('document.querySelector(\'.stw-entry\') !== null', 30000));
  panel = await readPanel();
  check('没认出编号时不预选任何条目', (panel?.activeTab ?? '') === '', panel?.activeTab);
  check('给出「自己选」的引导', (panel?.pickHint ?? '').length > 0, panel?.pickHint);
  check('未选中时不渲染条款', (panel?.clauses ?? -1) === 0, panel?.clauses);
  check('没认出时也说明原因', (panel?.note ?? '').includes('没'), panel?.note);
  await shoot('standards-02-unmatched');

  // 4. 文件核对：不是登记原文 → 明确说不符
  check('有「选择文件核对」入口', (panel?.verifyButton ?? '').includes('核对'), panel?.verifyButton);
  check('喂一份不匹配的文件', await feedFile(Buffer.from('not the registered source', 'utf8').toString('base64'), 'other.md'));
  check('不符时有结果文案', await waitFor('document.querySelector(\'.stw-verify-result--mismatch\') !== null', 20000));
  panel = await readPanel();
  check('不符文案说明对不上', (panel?.verifyResult ?? '').includes('不符'), panel?.verifyResult);
  check('不符时不预选条目', (panel?.activeTab ?? '') === '', panel?.activeTab);
  await shoot('standards-03-verify-mismatch');

  // 5. 文件核对：登记原文 → 一致并自动选中
  check('喂登记原文本身', await feedFile(SOURCE_BYTES.toString('base64'), '00-Standard-Source.md'));
  check('一致时有结果文案', await waitFor('document.querySelector(\'.stw-verify-result--ok\') !== null', 30000));
  panel = await readPanel();
  check('一致文案说明判据对这份成立', (panel?.verifyResult ?? '').includes('一致'), panel?.verifyResult);
  check('核对通过后自动选中该条', (panel?.activeTab ?? '') === 'NIST SP 800-38C', panel?.activeTab);
  check('核对通过后能看到该条的判据', (panel?.clauses ?? 0) > 0, panel?.clauses);
  await shoot('standards-04-verify-ok');

  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2));
  check('控制台无 error', consoleErrors.length === 0, consoleErrors.slice(0, 2));
} catch (error) {
  console.error(`verify-standards-entry FAIL: ${String(error)}`);
  results.push({ name: '运行期异常', ok: false });
} finally {
  ws?.close();
  chrome.kill();
}

const failed = results.filter((item) => !item.ok);
console.log(`\nAI_HELPER_STANDARDS_ENTRY_SUMMARY total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
