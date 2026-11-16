#!/usr/bin/env node
/**
 * 一次性验收：编辑器顶栏改版（顶栏动作组 + v-show 保运行输出）的多宽度真实截图与度量。
 * 用法：node /tmp/header-shot.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const PORT = Number(process.env.BIDI_PORT || 9331);
const OUT = process.env.OUT_DIR || '.codestable/features/2026-11-16-editor-header/evidence';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'header-ff-'));
const ff = spawn('firefox', ['--headless', `--remote-debugging-port=${PORT}`, '--profile', profile, 'about:blank'], {
  stdio: 'ignore',
});

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const sock = new globalThis.WebSocket(`ws://127.0.0.1:${PORT}/session`);
      await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; sock.onclose = rej; });
      return sock;
    } catch { await sleep(300); }
  }
  throw new Error('no bidi');
}

const sock = await connect();
let id = 0;
const pending = new Map();
sock.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.type === 'error') p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
  else p.resolve(msg.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject, method });
  sock.send(JSON.stringify({ id: i, method, params }));
});

await send('session.new', { capabilities: { alwaysMatch: { browserName: 'firefox' } } });

const PROBE = `JSON.stringify((()=>{
  const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
  const head = document.querySelector('.editor-head');
  const acts = document.querySelector('.header-actions');
  const bar = document.querySelector('.toolbar');
  const btns = [...document.querySelectorAll('.header-actions .toolbar-btn')];
  const lang = document.querySelector('.header-actions .toolbar-btn[lang]');
  const pane = btns.find(b => b.getAttribute('aria-pressed') !== null);
  const more = btns.find(b => b.getAttribute('aria-haspopup') !== null);
  const codePane = document.querySelector('.view-right');
  const rows = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
  return {
    head: r(head), acts: r(acts), bar: r(bar),
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    btnCount: btns.length,
    btnRows: rows.size,
    btnLabels: btns.map(b => (b.innerText || '').trim() || '(icon)'),
    langTitle: lang?.getAttribute('title') ?? null,
    langAria: lang?.getAttribute('aria-label') ?? null,
    langTag: lang?.getAttribute('lang') ?? null,
    langText: lang?.innerText?.trim() ?? null,
    paneTitle: pane?.getAttribute('title') ?? null,
    paneAria: pane?.getAttribute('aria-label') ?? null,
    panePressed: pane?.getAttribute('aria-pressed') ?? null,
    paneClass: pane?.className ?? null,
    moreExpanded: more?.getAttribute('aria-expanded') ?? null,
    selectInButton: !!document.querySelector('.dropdown-menu button select'),
    dropdownRows: document.querySelectorAll('.dropdown-menu .dropdown-row').length,
    codePaneVisible: !!codePane && getComputedStyle(codePane).display !== 'none',
    codePaneH: codePane ? Math.round(codePane.getBoundingClientRect().height) : 0,
    outText: document.querySelector('.run-output, .code-output, pre')?.innerText?.slice(0, 60) ?? null,
  };
})())`;

async function shoot(width, height, name) {
  const { context } = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.setViewport', { context, viewport: { width, height } });
  await send('browsingContext.navigate', { context, url: `${BASE_URL}/#/editor/1`, wait: 'complete' });
  await sleep(6000);
  const probe = await send('script.evaluate', {
    expression: PROBE,
    target: { context },
    awaitPromise: true,
    resultOwnership: 'none',
  });
  const shot = await send('browsingContext.captureScreenshot', { context });
  writeFileSync(join(OUT, `${name}.png`), shot.data, 'base64');
  console.log(`--- ${name} ${width}x${height}`);
  console.log(probe.result?.value ?? '(probe failed)');
  await send('browsingContext.close', { context });
}

// ---------- 交互验收：菜单 a11y + v-show 保状态 ----------
async function interact() {
  const { context } = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.setViewport', { context, viewport: { width: 1366, height: 682 } });
  await send('browsingContext.navigate', { context, url: `${BASE_URL}/#/editor/1`, wait: 'complete' });
  await sleep(6000);
  const ev = async (expression) => {
    const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (r.type === 'exception') return `EXC ${JSON.stringify(r.exceptionDetails).slice(0, 160)}`;
    return r.result?.value;
  };
  const out = [];
  const mark = (name, value) => { out.push(`${name}=${String(value).slice(0, 200)}`); };

  // 1) 打开 More 菜单
  await ev('(()=>{const b=[...document.querySelectorAll(\'.header-actions .toolbar-btn\')].find(x=>x.getAttribute(\'aria-haspopup\')); b.click(); return true;})()');
  await sleep(500);
  const opened = await ev(`JSON.stringify((()=>{
    const menu=document.querySelector('.dropdown-menu');
    const more=[...document.querySelectorAll('.header-actions .toolbar-btn')].find(x=>x.getAttribute('aria-haspopup'));
    return { menu: !!menu, rows: document.querySelectorAll('.dropdown-menu .dropdown-row').length,
      selectInButton: !!document.querySelector('.dropdown-menu button select'),
      selects: document.querySelectorAll('.dropdown-menu .inline-select').length,
      expanded: more.getAttribute('aria-expanded'),
      menuClass: more.className };
  })())`);
  mark('MENU_OPEN', opened);
  {
    const shotOpen = await send('browsingContext.captureScreenshot', { context });
    writeFileSync(join(OUT, 'header-menu-open.png'), shotOpen.data, 'base64');
  }

  // 2) Esc 关闭并回焦
  await ev('(()=>{const g=document.querySelector(\'.menu-group\'); g.dispatchEvent(new KeyboardEvent(\'keydown\',{key:\'Escape\',bubbles:true})); return true;})()');
  await sleep(400);
  mark('MENU_ESC', await ev(`JSON.stringify({ menu: !!document.querySelector('.dropdown-menu'),
    expanded: [...document.querySelectorAll('.header-actions .toolbar-btn')].find(x=>x.getAttribute('aria-haspopup')).getAttribute('aria-expanded'),
    focusIsMore: document.activeElement === [...document.querySelectorAll('.header-actions .toolbar-btn')].find(x=>x.getAttribute('aria-haspopup')) })`));

  // 3) v-show：收起再展开，CodePanel 应是同一个 DOM 节点（未卸载）
  const before = await ev('(()=>{const el=document.querySelector(\'.view-right\'); el.dataset.probe=\'kept\'; return getComputedStyle(el).display;})()');
  await ev('(()=>{const b=[...document.querySelectorAll(\'.header-actions .toolbar-btn\')].find(x=>x.getAttribute(\'aria-pressed\')!==null); b.click(); return true;})()');
  await sleep(600);
  const hidden = await ev(`JSON.stringify((()=>{const el=document.querySelector('.view-right');
    const b=[...document.querySelectorAll('.header-actions .toolbar-btn')].find(x=>x.getAttribute('aria-pressed')!==null);
    return { display: el ? getComputedStyle(el).display : 'gone', still: !!el, probe: el?.dataset.probe ?? null, pressed: b.getAttribute('aria-pressed') };})())`);
  await ev('(()=>{const b=[...document.querySelectorAll(\'.header-actions .toolbar-btn\')].find(x=>x.getAttribute(\'aria-pressed\')!==null); b.click(); return true;})()');
  await sleep(600);
  const back = await ev(`JSON.stringify((()=>{const el=document.querySelector('.view-right');
    const b=[...document.querySelectorAll('.header-actions .toolbar-btn')].find(x=>x.getAttribute('aria-pressed')!==null);
    return { display: el ? getComputedStyle(el).display : 'gone', probe: el?.dataset.probe ?? null, pressed: b.getAttribute('aria-pressed') };})())`);
  mark('PANE_BEFORE', before);
  mark('PANE_HIDDEN', hidden);
  mark('PANE_BACK', back);

  // 4) 语言按钮点击切到中文
  await ev('(()=>{document.querySelector(\'.header-actions .toolbar-btn[lang]\').click(); return true;})()');
  await sleep(800);
  mark('LOCALE_AFTER', await ev(`JSON.stringify((()=>{const b=document.querySelector('.header-actions .toolbar-btn[lang]');
    return { text: b.innerText.trim(), lang: b.getAttribute('lang'), title: b.getAttribute('title') };})())`));
  await ev('(()=>{document.querySelector(\'.header-actions .toolbar-btn[lang]\').click(); return true;})()');
  await sleep(600);

  console.log('=== 交互');
  for (const line of out) console.log(line);
  await send('browsingContext.close', { context });
}

// ---------- 文档中心：共用语言按钮是否继承 .header-btn 外观 ----------
async function docsCheck() {
  const { context } = await send('browsingContext.create', { type: 'tab' });
  await send('browsingContext.setViewport', { context, viewport: { width: 1366, height: 682 } });
  await send('browsingContext.navigate', { context, url: `${BASE_URL}/#/docs`, wait: 'complete' });
  await sleep(3000);
  const r = await send('script.evaluate', {
    expression: `JSON.stringify((()=>{const b=document.querySelector('.docs-header button[lang]');
      if(!b) return {found:false};
      const cs=getComputedStyle(b);
      return {found:true, text:b.innerText.trim(), lang:b.getAttribute('lang'), title:b.getAttribute('title'),
        border:cs.borderTopColor+' '+cs.borderTopWidth, radius:cs.borderRadius, padding:cs.padding,
        height:Math.round(b.getBoundingClientRect().height)};})())`,
    target: { context }, awaitPromise: true, resultOwnership: 'none',
  });
  console.log('=== DOCS_LOCALE_BUTTON');
  console.log(r.result?.value ?? '(probe failed)');
  const shot = await send('browsingContext.captureScreenshot', { context });
  writeFileSync(join(OUT, 'docs-header-1366.png'), shot.data, 'base64');
  await send('browsingContext.close', { context });
}

await docsCheck();

await interact();

for (const [w, h, n] of [
  [1366, 682, 'header-1366'],
  [1024, 682, 'header-1024'],
  [900, 682, 'header-900'],
  [760, 682, 'header-760'],
]) {
  await shoot(w, h, n);
}

await send('session.end');
sock.close();
ff.kill('SIGTERM');
rmSync(profile, { recursive: true, force: true });
console.log('done');
