#!/usr/bin/env node
/**
 * 「文档中心第二入口」的真浏览器专项验收（Firefox headless + WebDriver BiDi）。
 *
 * 为什么不用 vitest/jsdom：这条链的判据是真实路由、真实 localStorage/IndexedDB 与真实
 * 布局（窄屏下面板会变成浮层），jsdom 里既没有 history.state.back 也没有布局。
 * 仓库没装 playwright，本机 Firefox 自带 WebDriver BiDi，因此直接用它驱动：
 * 无头、独立 profile、不占用桌面焦点。
 *
 * 用法：
 *   npm run dev                     # 另开一个终端，vite 默认 3001
 *   npm run verify:docs-entry       # 本脚本；默认 http://localhost:3001
 *   BASE_URL=http://localhost:4173 BIDI_PORT=9333 npm run verify:docs-entry
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境不满足（文件不存在/没有 WebSocket/
 * 服务器不可达/浏览器起不来）。脚本自己起停 Firefox 与临时 profile，不依赖外部调试端口。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const PORT = Number(process.env.BIDI_PORT || 9223);
const FIREFOX = process.env.FIREFOX_BIN || 'firefox';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(code, msg) {
  console.error(`verify:docs-entry ${code === 2 ? 'ENV' : 'FAIL'}: ${msg}`);
  process.exit(code);
}

if (typeof globalThis.WebSocket !== 'function') die(2, `当前 node (${process.version}) 没有全局 WebSocket，需要 node >= 22`);
if (!existsSync('src/views/DocsView.vue')) die(2, '请在仓库根目录运行（找不到 src/views/DocsView.vue）');

// ---------- 1. 服务器可达性 ----------
try {
  const res = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!res.ok) die(2, `${BASE_URL} 返回 ${res.status}`);
} catch (e) {
  die(2, `${BASE_URL} 不可达（${e.message}）；先跑 npm run dev`);
}

// ---------- 2. 起一个无头 Firefox（独立 profile） ----------
const profile = mkdtempSync(join(tmpdir(), 'docs-entry-ff-'));
const ff = spawn(FIREFOX, ['--headless', `--remote-debugging-port=${PORT}`, '--profile', profile, 'about:blank'], {
  stdio: 'ignore',
  detached: false,
});
ff.on('error', (e) => die(2, `起不动 ${FIREFOX}：${e.message}`));

async function connectBidi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const sock = new globalThis.WebSocket(`ws://127.0.0.1:${PORT}/session`);
      await new Promise((res, rej) => {
        sock.onopen = res;
        sock.onerror = () => rej(new Error('ws error'));
        sock.onclose = () => rej(new Error('ws closed'));
      });
      return sock;
    } catch {
      await sleep(300);
    }
  }
  return null;
}

let client;
function makeClient(sock) {
  let id = 0;
  const pending = new Map();
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(`${p.method}: ${msg.error} ${msg.message || ''}`));
    else p.resolve(msg.result);
  };
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject, method });
      sock.send(JSON.stringify({ id: i, method, params }));
    });
}

// ---------- 3. 断言骨架 ----------
const results = [];
function check(group, name, cond, detail) {
  results.push({ group, name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${group}] ${name}${cond ? '' : `   <<< ${String(JSON.stringify(detail ?? null)).slice(0, 220)}`}`);
}

function makeTab(send, viewport) {
  return (async () => {
    const { context } = await send('browsingContext.create', { type: 'tab' });
    await send('browsingContext.setViewport', { context, viewport }).catch(() => {});
    const evaluate = async (expression) => {
      const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
      if (r.type === 'exception') throw new Error(`JS exception: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
      return r.result?.value;
    };
    const go = (url) => send('browsingContext.navigate', { context, url, wait: 'complete' });
    const json = async (expression) => JSON.parse(await evaluate(expression));
    return { context, evaluate, go, json };
  })();
}

const OPEN_PANEL = '(()=>{const b=[...document.querySelectorAll(\'.activity-bar button\')].find(x=>/^(Docs|查文档)$/.test((x.getAttribute(\'title\')||\'\').trim())); if(!b) return false; b.click(); return true;})()';
const TYPE_QUERY = (v) => `(()=>{const el=document.querySelector('.dsp-input'); if(!el) return false; el.value=${JSON.stringify(v)}; el.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`;
const CLICK_BROWSE = '(()=>{const b=document.querySelector(\'.dsp-browse\'); if(!b) return false; b.click(); return true;})()';
const OBS_DOCS = `JSON.stringify({
  hash: location.hash,
  input: document.querySelector('input.search-input')?.value ?? null,
  notice: document.querySelector('.docs-notice')?.innerText?.trim() ?? null,
  cats: document.querySelectorAll('.nav-category').length,
})`;

async function run() {
  const sock = await connectBidi();
  if (!sock) die(2, `Firefox 没有在 ${PORT} 上暴露 WebDriver BiDi`);
  client = makeClient(sock);

  await client('session.new', { capabilities: { alwaysMatch: { browserName: 'firefox' } } });

  // ===== 宽屏 1366x682 =====
  const wide = await makeTab(client, { width: 1366, height: 682 });
  await wide.go(`${BASE_URL}/`);
  await sleep(5000);
  const editorHash = await wide.evaluate('location.hash');

  await wide.evaluate(OPEN_PANEL);
  await sleep(800);
  check('G1', '面板底部入口存在', (await wide.evaluate('!!document.querySelector(\'.dsp-browse\')')) === true);
  const browseText = await wide.evaluate('document.querySelector(\'.dsp-browse\')?.innerText||\'\'');
  check('G1', '入口文案（中/英）', /浏览全部文档|Browse all docs/.test(browseText), browseText);

  await wide.evaluate(TYPE_QUERY('ML-KEM'));
  await sleep(1500);
  const withHits = await wide.json('JSON.stringify({browse:!!document.querySelector(\'.dsp-browse\'), items:document.querySelectorAll(\'.dsp-item\').length})');
  check('G1', '有结果时入口仍可见（落在 v-if 链外）', withHits.browse && withHits.items > 0, withHits);

  await wide.evaluate(CLICK_BROWSE);
  await sleep(1800);
  let d = await wide.json(OBS_DOCS);
  check('G2', '命中词带进 /docs 且搜索框预填', d.hash.includes('/docs') && d.hash.includes('q=ML-KEM') && d.input === 'ML-KEM', d);
  check('G2', '命中词侧栏非空、无说明行', d.cats > 0 && d.notice === null, d);

  await wide.evaluate(`location.hash=${JSON.stringify(editorHash)}`);
  await sleep(1800);
  await wide.evaluate(OPEN_PANEL);
  await sleep(800);
  await wide.evaluate(TYPE_QUERY('zzzqqqxx'));
  await sleep(1500);
  await wide.evaluate(CLICK_BROWSE);
  await sleep(1800);
  d = await wide.json(OBS_DOCS);
  check('G2', '无匹配词不预填（搜索框为空）', d.input === '' && d.hash.includes('q=zzzqqqxx'), d);
  check('G2', '无匹配词时侧栏为全部分类 + 说明行', d.cats > 5 && /未匹配任何分类或文档标题|matches no category or document title/.test(d.notice || ''), d);

  await wide.evaluate(`location.hash=${JSON.stringify(editorHash)}`);
  await sleep(1800);
  await wide.evaluate(OPEN_PANEL);
  await sleep(800);
  await wide.evaluate(TYPE_QUERY(''));
  await sleep(500);
  await wide.evaluate(CLICK_BROWSE);
  await sleep(1800);
  d = await wide.json(OBS_DOCS);
  check('G2', '没有查询词时不带 q、无说明行', !d.hash.includes('q=') && d.notice === null && d.cats > 5, d);

  await wide.evaluate('location.hash=\'#/docs?q=encapsulation\'');
  await sleep(2000);
  d = await wide.json(OBS_DOCS);
  check('G2', '英文词命中英文分类标签（预填成功）', d.input === 'encapsulation', d);
  await wide.evaluate('document.querySelector(\'.docs-header .lang-btn\')?.click()');
  await sleep(1800);
  d = await wide.json(OBS_DOCS);
  check('G2', '切语言后不再命中 → 清空 + 说明行', d.input === '' && (d.notice || '').length > 0, d);

  await wide.evaluate(`location.hash=${JSON.stringify(editorHash)}`);
  await sleep(1800);
  await wide.evaluate('(()=>{const b=document.querySelector(\'.toolbar-btn[title="Docs"], .toolbar-btn[title="文档"]\'); if(!b) return false; b.click(); return true;})()');
  await sleep(1800);
  check('G3', '工具栏进入 /docs', (await wide.evaluate('location.hash')).includes('/docs'));
  await wide.evaluate('document.querySelector(\'.docs-header .header-btn\')?.click()');
  await sleep(1800);
  const backHash = await wide.evaluate('location.hash');
  check('G3', '返回回到来源编辑器，项目 id 不变', backHash === editorHash && backHash.startsWith('#/editor/'), { backHash, editorHash });

  await wide.evaluate('location.hash=\'#/docs?q=ML-KEM\'');
  await sleep(2000);
  await wide.evaluate('location.hash=\'#/docs\'');
  await sleep(1800);
  d = await wide.json(OBS_DOCS);
  check('G2', '同一组件实例去掉 ?q= → 搜索框清空、侧栏恢复', d.input === '' && d.cats > 5, d);

  // ===== 窄屏 1024x682：面板变浮层 =====
  const narrow = await makeTab(client, { width: 1024, height: 682 });
  await narrow.go(`${BASE_URL}/`);
  await sleep(5000);
  await narrow.evaluate(OPEN_PANEL);
  await sleep(900);
  const shape = await narrow.json('JSON.stringify({overlay:!!document.querySelector(\'.dsp-overlay\'), browse:!!document.querySelector(\'.dsp-browse\'), w:document.querySelector(\'.dsp\')?.getBoundingClientRect().width})');
  check('窄屏', '面板为浮层且入口可见', shape.overlay === true && shape.browse === true, shape);
  await narrow.evaluate(TYPE_QUERY('FIPS 204'));
  await sleep(1500);
  await narrow.evaluate(CLICK_BROWSE);
  await sleep(1800);
  d = await narrow.json(OBS_DOCS);
  check('窄屏', '浮层入口带 q 进 /docs 且预填', d.hash.includes('q=FIPS') && d.input === 'FIPS 204' && d.cats > 0, d);

  // ===== 无历史直开 =====
  const fresh = await makeTab(client, { width: 1024, height: 682 });
  await fresh.go(`${BASE_URL}/#/docs`);
  await sleep(4500);
  const state = await fresh.evaluate('JSON.stringify(history.state)');
  check('无历史', '首屏 history.state.back 为 null', /"back":null/.test(state) || state === 'null', state);
  await fresh.evaluate('document.querySelector(\'.docs-header .header-btn\')?.click()');
  await sleep(2500);
  const freshHash = await fresh.evaluate('location.hash');
  check('无历史', '点返回不退出应用（停在应用内页面）', freshHash.startsWith('#/'), freshHash);
  check('无历史', '页面仍有内容渲染', (await fresh.evaluate('document.body.innerText.length')) > 100);
}

let exitCode;
try {
  await run();
  exitCode = results.some((r) => !r.ok) ? 1 : 0;
} catch (e) {
  console.error('verify:docs-entry ERROR:', e.message);
  exitCode = 2;
} finally {
  try { await client?.('session.end', {}); } catch {
    // 会话可能已经被浏览器回收，收尾失败不影响判定
  }
  try { ff.kill('SIGTERM'); } catch {
    // 进程可能已退出
  }
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {
    // 临时 profile 删不掉不是判定依据
  }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\nDOCS_ENTRY_BIDI_SUMMARY pass=${pass} fail=${results.length - pass} total=${results.length}`);
process.exit(exitCode);
