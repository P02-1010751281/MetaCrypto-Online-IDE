#!/usr/bin/env node
/**
 * 侧栏面板 chrome 验收：项目 / 文件 / 函数三个面板的头部是否真的同一套样式。
 *
 * 为什么用真浏览器：这四条缺陷全部来自「scoped 样式穿不过 slot 边界」——
 * EditorSidebar 的面板是 slot 子组件，它自己那份 scoped CSS 到不了子组件。
 * 静态读代码只能看到「抄了一份」，判断不了实际算出来的字体与盒模型，
 * 而这里的判据恰恰是计算样式（font-weight / background / 24×24）。
 *
 * 用法：
 *   npm run dev                       # 另开终端，vite 默认 3001
 *   node scripts/verify-sidebar-chrome.mjs
 *   BASE_URL=http://localhost:4173 node scripts/verify-sidebar-chrome.mjs
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境不满足。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const PORT = Number(process.env.BIDI_PORT || 9334);
const OUT = process.env.OUT_DIR || '.codestable/features/2026-11-16-sidebar-chrome/evidence';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

try {
  const res = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
} catch (error) {
  console.error(`verify-sidebar-chrome ENV: ${BASE_URL} 不可达（${String(error)}），先起 npm run dev`);
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'sbchrome-ff-'));
const ff = spawn('firefox', ['--headless', `--remote-debugging-port=${PORT}`, '--profile', profile, 'about:blank'], {
  stdio: 'ignore',
});

let sock;
for (let i = 0; i < 60; i += 1) {
  try {
    const s = new globalThis.WebSocket(`ws://127.0.0.1:${PORT}/session`);
    await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; s.onclose = rej; });
    sock = s;
    break;
  } catch {
    await sleep(300);
  }
}
if (!sock) {
  console.error('verify-sidebar-chrome ENV: 连不上 WebDriver BiDi');
  process.exit(2);
}

let id = 0;
const pending = new Map();
sock.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.type === 'error') p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject, method });
  sock.send(JSON.stringify({ id: i, method, params }));
});

await send('session.new', { capabilities: { alwaysMatch: { browserName: 'firefox' } } });
const { context } = await send('browsingContext.create', { type: 'tab' });
await send('browsingContext.setViewport', { context, viewport: { width: 1366, height: 800 } });
await send('browsingContext.navigate', { context, url: `${BASE_URL}/#/editor/1`, wait: 'complete' });
await sleep(6000);

const evaluate = async (expression) => {
  const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
  if (r.type === 'exception') throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <<< ${String(JSON.stringify(detail ?? null)).slice(0, 260)}`}`);
};

const PROBE = `JSON.stringify((()=>{
  const css = (el)=>{ if(!el) return null; const s=getComputedStyle(el); return {
    size:s.fontSize, weight:s.fontWeight, ls:s.letterSpacing, tt:s.textTransform, color:s.color }; };
  const side = document.querySelector('.side-panel');
  const head = side?.querySelector('.section-head') ?? null;
  const title = head?.querySelector('.section-title') ?? null;
  const buttons = head ? [...head.querySelectorAll('button')] : [];
  const plus = buttons.find(b => (b.textContent||'').includes('＋')) ?? null;
  const ps = plus ? getComputedStyle(plus) : null;
  const row = side ? side.querySelector('.project-row, .file-row, .cfp-item') : null;
  return {
    panel: side?.firstElementChild?.className ?? null,
    sidebarW: Math.round(document.querySelector('.editor-sidebar').getBoundingClientRect().width),
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    headFirst: head ? head.firstElementChild?.className ?? head.firstElementChild?.tagName ?? null : null,
    headButtons: buttons.length,
    titleCss: css(title),
    titleText: title?.innerText?.trim() ?? null,
    plusBox: plus ? { w: Math.round(plus.getBoundingClientRect().width), h: Math.round(plus.getBoundingClientRect().height) } : null,
    plusCss: ps ? { bg: ps.backgroundColor, radius: ps.borderRadius, size: ps.fontSize } : null,
    rowW: row ? Math.round(row.getBoundingClientRect().width) : null,
  };
})())`;

const settle = async (index) => {
  await evaluate(`(()=>{const b=document.querySelectorAll('.activity-bar .activity-btn')[${index}]; if(b) b.click(); return !!b;})()`);
  await sleep(700);
  return JSON.parse(await evaluate(PROBE));
};

const shoot = async (name) => {
  const shot = await send('browsingContext.captureScreenshot', { context });
  writeFileSync(join(OUT, `${name}.png`), shot.data, 'base64');
};

const projects = await settle(0);
await shoot('projects');
const files = await settle(1);
await shoot('files');
const functions = await settle(2);
await shoot('functions');

// 1. 三个面板都有头，且高度同一条基线
for (const [name, p] of [['projects', projects], ['files', files], ['functions', functions]]) {
  check(`${name}: 有面板头且高度 = 38px（--panel-head-h）`, p.headH === 38, p);
}

// 2. 标题字体三项完全一致（项目 / 文件互为对照组，函数是新增的对照组）
const sameTitle = JSON.stringify(projects.titleCss) === JSON.stringify(files.titleCss)
  && JSON.stringify(files.titleCss) === JSON.stringify(functions.titleCss);
check('三个面板标题计算样式完全一致', sameTitle, {
  projects: projects.titleCss, files: files.titleCss, functions: functions.titleCss,
});
check('标题字重为 600（不是 400 与 600 混用）', projects.titleCss?.weight === '600', projects.titleCss);

// 3. 文件面板不再有返回按钮：头部只有一个按钮（＋），且首元素是标题
check('files: 头部无返回按钮（首元素是标题）', files.headFirst === 'section-title', files);
check('files: 头部只有 1 个按钮（＋）', files.headButtons === 1, files);

// 4. ＋ 按钮在两个面板上同一套盒模型与背景
const samePlus = JSON.stringify(projects.plusBox) === JSON.stringify(files.plusBox)
  && projects.plusCss?.bg === files.plusCss?.bg
  && projects.plusCss?.radius === files.plusCss?.radius;
check('projects / files 的＋按钮盒模型与外观一致', samePlus, { projects, files });
check('＋按钮是 24×24 透明底（不是浏览器默认按钮）',
  projects.plusBox?.w === 24 && projects.plusBox?.h === 24 && projects.plusCss?.bg === 'rgba(0, 0, 0, 0)',
  projects.plusCss);

// 5. 函数面板：有标题文本、侧栏按内容展宽、行不再被挤到 191px
check('functions: 面板头有标题文本', (functions.titleText || '').length > 0, functions.titleText);
check('functions: 侧栏展宽到 400px', functions.sidebarW === 400, functions.sidebarW);
check('functions: 列表行宽 >= 320px', (functions.rowW ?? 0) >= 320, functions.rowW);
check('projects / files: 侧栏保持 248px', projects.sidebarW === 248 && files.sidebarW === 248, {
  projects: projects.sidebarW, files: files.sidebarW,
});

await send('browsingContext.close', { context });
ff.kill('SIGTERM');

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSUMMARY total=${results.length} pass=${results.length - failed} fail=${failed}`);
process.exit(failed === 0 ? 0 : 1);
