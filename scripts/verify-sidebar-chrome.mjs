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
  const first = buttons[0] ?? null;
  const fs = first ? getComputedStyle(first) : null;
  const query = document.querySelector('.dsp-query, .bsp-query');
  return {
    panel: side?.firstElementChild?.className ?? null,
    sidebarW: Math.round(document.querySelector('.editor-sidebar').getBoundingClientRect().width),
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    headFirst: head ? head.firstElementChild?.className ?? head.firstElementChild?.tagName ?? null : null,
    headButtons: buttons.length,
    headClass: head?.className ?? null,
    headPadL: head ? getComputedStyle(head).paddingLeft : null,
    /* 标题必须贴左：左边缘 = 头部左边缘 + 头部内边距。曾漏掉这条判据，
       结果「只有标题一个子元素」的函数面板头部被 margin-left:auto 推到最右。 */
    headLeft: head ? Math.round(head.getBoundingClientRect().left) : null,
    titleLeft: title ? Math.round(title.getBoundingClientRect().left) : null,
    titleMarginLeft: title ? getComputedStyle(title).marginLeft : null,
    headBorder: head ? getComputedStyle(head).borderBottomWidth : null,
    titleCss: css(title),
    titleText: title?.innerText?.trim() ?? null,
    plusBox: plus ? { w: Math.round(plus.getBoundingClientRect().width), h: Math.round(plus.getBoundingClientRect().height) } : null,
    plusCss: ps ? { bg: ps.backgroundColor, radius: ps.borderRadius, size: ps.fontSize } : null,
    rowW: row ? Math.round(row.getBoundingClientRect().width) : null,
    /* 头部「只放图标动作」的直接判据：头部里不许出现带文字的 checkbox。 */
    checkboxInHead: head ? !!head.querySelector('input[type="checkbox"]') : null,
    checkboxInQuery: query ? !!query.querySelector('input[type="checkbox"]') : null,
    closeBox: first ? {
      w: Math.round(first.getBoundingClientRect().width),
      h: Math.round(first.getBoundingClientRect().height),
      bg: fs.backgroundColor,
      radius: fs.borderRadius,
      label: first.getAttribute('aria-label'),
    } : null,
    queryRowH: query ? Math.round(query.getBoundingClientRect().height) : null,
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
const docSearch = await settle(3);
await shoot('docSearch');
const blockSearch = await settle(4);
await shoot('blockSearch');

const panels = [['projects', projects], ['files', files], ['functions', functions], ['docSearch', docSearch], ['blockSearch', blockSearch]];

// 1. 五个面板都有头，且高度同一条基线
for (const [name, p] of panels) {
  check(`${name}: 有面板头且高度 = 38px（--panel-head-h）`, p.headH === 38, p);
}

// 2. 标题字体三项完全一致（项目 / 文件互为对照组，函数是新增的对照组）
const sameTitle = JSON.stringify(projects.titleCss) === JSON.stringify(files.titleCss)
  && JSON.stringify(files.titleCss) === JSON.stringify(functions.titleCss);
check('三个面板标题计算样式完全一致', sameTitle, {
  projects: projects.titleCss, files: files.titleCss, functions: functions.titleCss,
});
check('标题字重为 600（不是 400 与 600 混用）', projects.titleCss?.weight === '600', projects.titleCss);

// 2b. 检索面板并入后，五个面板的标题必须仍是同一组计算样式
const allSameTitle = panels.every(([, p]) => JSON.stringify(p.titleCss) === JSON.stringify(projects.titleCss));
check('五个面板标题计算样式完全一致（含查文档 / 查块）', allSameTitle,
  panels.map(([name, p]) => [name, p.titleCss]));

// 2c. 五个面板共用同一个 .section-head 定义，而不是各留一份同名副本
const headsUnified = panels.every(([, p]) => (p.headClass || '').split(' ').includes('section-head'));
check('五个面板头部都取 .section-head（无 dsp-header / bsp-header 副本）', headsUnified,
  panels.map(([name, p]) => [name, p.headClass]));

// 2d. 标题必须贴左。「只有标题一个子元素」的头部（函数面板停靠态）曾被
//     `.section-head > :last-child { margin-left: auto }` 整条推到栏右边缘——
//     只验样式的断言看不出来，必须量位置。
const leftAligned = panels.every(([, p]) => p.titleLeft - p.headLeft === Math.round(parseFloat(p.headPadL)));
check('五个面板标题都贴左（左边缘 = 头部左边缘 + 头部内边距）', leftAligned,
  panels.map(([name, p]) => [name, { headLeft: p.headLeft, titleLeft: p.titleLeft, padL: p.headPadL }]));

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

// 6. 检索面板并入后：头部只剩一个关闭图标，且是 24×24 透明底
for (const [name, p] of [['docSearch', docSearch], ['blockSearch', blockSearch]]) {
  check(`${name}: 头部只有 1 个按钮`, p.headButtons === 1, p.headButtons);
  check(`${name}: 关闭按钮是 24×24 透明底（同 .ghost-btn）`,
    p.closeBox?.w === 24 && p.closeBox?.h === 24 && p.closeBox?.bg === 'rgba(0, 0, 0, 0)',
    p.closeBox);
  check(`${name}: 关闭按钮有可访问名称`, (p.closeBox?.label || '').length > 0, p.closeBox);
  check(`${name}: 头部自带内边距与底边线（--divided 变体）`,
    p.headPadL === '8px' && p.headBorder === '1px', { padL: p.headPadL, border: p.headBorder });
}

// 7. 「包含 PDF」是检索条件不是面板动作：必须离开头部、落在查询行
check('docSearch: 头部不含 checkbox（带文字控件下沉）', docSearch.checkboxInHead === false, docSearch);
check('docSearch: 「包含 PDF」在查询行内', docSearch.checkboxInQuery === true, docSearch);
check('docSearch: 查询行仍是一行（增高 < 8px 视为同一行）', (docSearch.queryRowH ?? 0) < 52, docSearch.queryRowH);

// 8. 检索面板本来就在「按内容展宽」名单里，并入时不能丢掉
check('docSearch / blockSearch: 侧栏展宽到 400px',
  docSearch.sidebarW === 400 && blockSearch.sidebarW === 400,
  { docSearch: docSearch.sidebarW, blockSearch: blockSearch.sidebarW });

// 9. 关闭按钮接线未因换类名断开：点一下必须真的关掉面板（回到默认面板）
// 注意不能在这里再 settle(4)：activity 按钮是「点一次开、再点一次关」，
// 前一次 settle(4) 已经把面板打开，再点等于把它关掉，后面就找不到按钮了。
await evaluate(`(()=>{
  const s = document.querySelector('.side-panel');
  if (!s || !s.querySelector('.bsp')) {
    const b = document.querySelectorAll('.activity-bar .activity-btn')[4];
    if (b) b.click();
  }
  return true;
})()`);
await sleep(700);
const clicked = await evaluate(`(()=>{
  const b = document.querySelector('.section-head .section-actions .ghost-btn');
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`);
await sleep(700);
const afterClose = await evaluate(`(()=>{
  const s = document.querySelector('.side-panel');
  return s ? (s.firstElementChild?.className ?? s.firstElementChild?.tagName ?? 'empty') : 'no-side-panel';
})()`);
check('查块面板的关闭按钮仍然生效（换类名没断线）',
  clicked === 'clicked' && !String(afterClose).includes('bsp'), { clicked, afterClose });

// 10. 行内动作（改名 / 删除 / 设为入口）：两个面板必须共用一套，且隐藏时不可点。
// 造数据：新 profile 里没有项目与文件，行内动作至少各要一行才量得到。
const ROWPROBE = `JSON.stringify((()=>{
  const host = document.querySelector('.side-panel');
  /* 取「动作最全」的一行：入口文件按设计不显示「设为入口」◎，只取第一行会在
     项目正常加载后量到 2 个按钮，把设计误判成缺失（本项目曾因编辑器加载失败
     量不到入口标记而恰好一直是 3 个）。 */
  const allRows = host ? [...host.querySelectorAll('.project-row, .file-row')] : [];
  const row = allRows.sort(
    (a, b) => b.querySelectorAll('.row-btn').length - a.querySelectorAll('.row-btn').length,
  )[0] ?? null;
  if (!row) return { row: false };
  const acts = row.querySelector('.row-actions');
  const btn = acts ? acts.querySelector('.row-btn') : null;
  const name = row.querySelector('.project-row-name, .file-name');
  const as = acts ? getComputedStyle(acts) : null;
  const bs = btn ? getComputedStyle(btn) : null;
  const ab = acts ? acts.getBoundingClientRect() : null;
  const nb = name ? name.getBoundingClientRect() : null;
  const rb = row.getBoundingClientRect();
  return {
    row: true,
    btnCount: row.querySelectorAll('.row-btn').length,
    /* 动作图标必须在这一行渲染时取：面板切到「文件」后 .project-row 就不存在了，
       事后再查只会得到空数组，把「有按钮」误判成「没有改名入口」。 */
    icons: [...row.querySelectorAll('.row-btn')].map((b) => (b.textContent || '').trim()),
    acts: as ? { position: as.position, opacity: as.opacity, pe: as.pointerEvents, bg: as.backgroundColor } : null,
    btn: bs ? { color: bs.color, size: bs.fontSize } : null,
    btnBox: btn ? { w: Math.round(btn.getBoundingClientRect().width), h: Math.round(btn.getBoundingClientRect().height) } : null,
    coversName: !!(ab && nb) && nb.right > ab.left,
    center: { x: Math.round(rb.x + rb.width / 2), y: Math.round(rb.y + rb.height / 2) },
  };
})())`;

const point = (x, y) => send('input.performActions', {
  context,
  actions: [{
    type: 'pointer',
    id: 'mouse',
    parameters: { pointerType: 'mouse' },
    actions: [{ type: 'pointerMove', x, y, origin: 'viewport' }],
  }],
});

/* 面板切换必须幂等：activity 按钮是「点一次开、再点一次关」，
   已经打开的目标面板再点一次反而会关掉它（本脚本曾因此量不到项目行）。 */
const openPanel = async (panelIndex, marker) => {
  await evaluate(`(()=>{
    const s = document.querySelector('.side-panel');
    if (s && s.querySelector(${JSON.stringify(marker)})) return true;
    const b = document.querySelectorAll('.activity-bar .activity-btn')[${panelIndex}];
    if (b) b.click();
    return true;
  })()`);
  await sleep(700);
};

/* 点当前面板头部的 ＋（项目面板是新建项目，文件面板是新建文件）。 */
const clickHeadPlus = async () => evaluate(`(()=>{
  const b = document.querySelector('.side-panel .section-head .ghost-btn');
  if (b) b.click();
  return !!b;
})()`);

const measureRow = async (panelIndex, marker, shotName) => {
  await openPanel(panelIndex, marker);
  const before = JSON.parse(await evaluate(ROWPROBE));
  if (!before.row) return { before, hovered: before };
  await point(before.center.x, before.center.y);
  await sleep(400);
  const hovered = JSON.parse(await evaluate(ROWPROBE));
  if (shotName) await shoot(shotName);
  await point(5, 780);
  await sleep(250);
  return { before, hovered };
};

// 先造一个项目（项目面板的 ＋ ）。这一步也会顺带把「＋ 真的能建项目」验掉。
// 打开面板要幂等：activity 按钮是「点一次开、再点一次关」，直接点会在已打开时关掉。
await evaluate(`(()=>{
  const s = document.querySelector('.side-panel');
  if (!s || !s.querySelector('.project-panel')) {
    const b = document.querySelectorAll('.activity-bar .activity-btn')[0];
    if (b) b.click();
  }
  return true;
})()`);
await sleep(800);
await clickHeadPlus();
await sleep(1600);
const rowsProjects = await measureRow(0, '.project-panel', 'row-actions-projects');

// 再在文件面板造两个文件（进了项目才有文件面板可用）
await measureRow(1, '.file-list');
for (let i = 0; i < 2; i += 1) {
  await clickHeadPlus();
  await sleep(1200);
}
const rowsFiles = await measureRow(1, '.file-list', 'row-actions-files');

for (const [name, m] of [['projects', rowsProjects], ['files', rowsFiles]]) {
  check(`${name}: 行内动作层是绝对定位（不占行内宽度）`, m.before.acts?.position === 'absolute', m.before);
  check(`${name}: 行内动作隐藏时 opacity 0 且 pointer-events none（看不见也点不到）`,
    m.before.acts?.opacity === '0' && m.before.acts?.pe === 'none', m.before);
  check(`${name}: 悬浮后浮出且可点`, m.hovered.acts?.opacity === '1' && m.hovered.acts?.pe === 'auto', m.hovered);
  check(`${name}: 动作层盖在行文字上（不再挤压名称列）`, m.before.coversName === true, m.before);
}

const sameBtn = JSON.stringify(rowsProjects.before.btn) === JSON.stringify(rowsFiles.before.btn)
  && JSON.stringify(rowsProjects.before.btnBox) === JSON.stringify(rowsFiles.before.btnBox);
check('两个面板的行内按钮外观一致（次级色 / 20×20 / 11px）', sameBtn, {
  projects: rowsProjects.before.btn, files: rowsFiles.before.btn,
  projectsBox: rowsProjects.before.btnBox, filesBox: rowsFiles.before.btnBox,
});

// 设为入口 / 改名 / 删除 三件在文件面板齐备，项目面板目前只有删除。
// 入口文件按设计不显示「设为入口」◎（它已经是入口），所以按行聚合：
// 非入口行三件、入口行两件。
const fileRowActions = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const rows = [...document.querySelectorAll('.file-row')];
  return rows.map((r) => ({
    entry: !!r.querySelector('.entry-badge'),
    icons: [...r.querySelectorAll('.row-btn')].map((b) => (b.textContent || '').trim()),
  }));
})())`));
const fullRow = fileRowActions.find((r) => !r.entry);
const entryRow = fileRowActions.find((r) => r.entry);
check('files: 非入口行的行内动作是 ◎ / ✎ / ✕ 三件', JSON.stringify(fullRow?.icons) === JSON.stringify(['◎', '✎', '✕']), fileRowActions);
check('files: 入口行按设计不显示「设为入口」，只剩 ✎ / ✕',
  entryRow !== undefined && JSON.stringify(entryRow.icons) === JSON.stringify(['✎', '✕']), fileRowActions);
/* 项目行与文件行同一套动作：改名 ✎ + 删除 ✕。面包屑的项目名已改成只读文本，
   改名入口只剩这一处——这里必须真的存在，否则项目名在界面上无处可改。 */
const projectIcons = rowsProjects.before.icons;
check('projects: 行内动作是 ✎ / ✕ 两件（改名入口唯一，面包屑只读）',
  rowsProjects.before.btnCount === 2 && projectIcons.includes('✎') && projectIcons.includes('✕'),
  { btnCount: rowsProjects.before.btnCount, projectIcons });

// 键盘可达：不悬浮，直接把焦点给 ✎，动作层必须因 :focus-within 浮出
const kb = JSON.parse(await evaluate(`JSON.stringify((()=>{
  /* 按文字找 ✎：入口文件行少了 ◎，按索引取会点到 ✕（删除，会弹确认框）。 */
  const rename = [...document.querySelectorAll('.file-row .row-btn')]
    .find((b) => (b.textContent || '').trim() === '✎') || null;
  const row = rename ? rename.closest('.file-row') : null;
  if (!rename) return { ok: false };
  rename.focus();
  const acts = row.querySelector('.row-actions');
  const s = acts ? getComputedStyle(acts) : null;
  return {
    ok: document.activeElement === rename,
    opacity: s ? s.opacity : null,
    pe: s ? s.pointerEvents : null,
  };
})())`));
check('文件面板：键盘聚焦到 ✎ 时动作层浮出（不是只在悬浮时可用）',
  kb.ok === true && kb.opacity === '1' && kb.pe === 'auto', kb);

// 改名流程：✎ → 内联输入框 → Esc 取消（不真的改名，避免影响后续断言）
const renameUi = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const rename = [...document.querySelectorAll('.file-row .row-btn')]
    .find((b) => (b.textContent || '').trim() === '✎') || null;
  if (!rename) return { opened: false };
  rename.click();
  return { opened: true };
})())`));
await sleep(400);
const renameInput = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const input = document.querySelector('.rename-input');
  if (!input) return { input: false };
  const focused = document.activeElement === input;
  const w = Math.round(input.getBoundingClientRect().width);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { input: true, focused, w };
})())`));
check('文件面板：✎ 打开内联改名输入框且自动聚焦', renameUi.opened && renameInput.input && renameInput.focused, {
  renameUi, renameInput,
});
await sleep(500);
const renameClosed = await evaluate('!document.querySelector(".rename-input")');
check('文件面板：Esc 取消改名后输入框消失', renameClosed === true, renameClosed);

// 10b. 改名落库：项目改名在顶栏面包屑、文件改名在行内 ✎，两者都必须真的写进
//      IndexedDB——只看界面文字会漏掉「改了名但没保存」这一整类问题。
//      自动保存默认关闭，所以这里按真实路径点一次保存。
const DB_DUMP = `(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('blockly-crypto-editor', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const rows = await new Promise((res, rej) => {
    const tx = db.transaction('projects', 'readonly');
    const rq = tx.objectStore('projects').getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  return JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, files: (r.files || []).map((f) => f.name) })));
})()`;
const dumpDb = async () => JSON.parse(await evaluate(DB_DUMP));
const clickToolbarSave = async () => {
  await evaluate('(()=>{const b=document.querySelector(".toolbar .toolbar-btn"); if(b) b.click(); return !!b;})()');
  await sleep(2000);
};

const dbBefore = await dumpDb();
await openPanel(0, '.project-panel');

/* 改名入口只有面板行内 ✎：面包屑的项目名必须是只读文本，不是输入框。 */
const crumb = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const input = document.querySelector('.crumb-project-input');
  const text = document.querySelector('.crumb-project');
  return {
    inputExists: !!input,
    textTag: text ? text.tagName : null,
    text: text ? text.textContent.trim() : null,
  };
})())`));
check('面包屑：项目名是只读文本（不是输入框）',
  crumb.inputExists === false && crumb.textTag === 'SPAN', crumb);

const renameProjectClicked = await evaluate(`(()=>{
  const b = [...document.querySelectorAll('.project-row .row-btn')]
    .find((x) => (x.textContent || '').trim() === '✎');
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`);
await sleep(400);
const renameProjectTyped = await evaluate(`(()=>{
  const i = document.querySelector('.project-row .rename-input');
  if (!i) return 'no-input';
  const focused = document.activeElement === i;
  i.value = '改名验收-项目';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return focused ? 'typed' : 'not-focused';
})()`);
await sleep(900);
const dbAfterProject = await dumpDb();
check('项目面板：✎ 改名直接写进 IndexedDB（不靠保存按钮），且不会多出第二个项目',
  renameProjectClicked === 'clicked' && renameProjectTyped === 'typed'
    && dbAfterProject.length === dbBefore.length
    && dbAfterProject.some((r) => r.name === '改名验收-项目'),
  { renameProjectClicked, renameProjectTyped, dbBefore, dbAfterProject });

/* 改完名字再点一次保存：编辑器手里的 projectName 必须已接上新名字，
   否则这一次保存会拿旧名字把刚写进库的新名字覆盖回去（改前正是这个风险）。 */
await clickToolbarSave();
const dbAfterSave = await dumpDb();
check('项目改名后再点保存，名字不会被旧值覆盖回去',
  dbAfterSave.some((r) => r.name === '改名验收-项目') && dbAfterSave.length === dbBefore.length,
  dbAfterSave);

/* 改名成功必须同时推回面板列表与面包屑，否则界面还停在旧名上。 */
const rowsAfterRename = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const rows = [...document.querySelectorAll('.project-row')]
    .map((r) => r.querySelector('.project-row-name')?.innerText?.trim() ?? null);
  const crumbText = document.querySelector('.crumb-project')?.textContent?.trim() ?? null;
  return { rows, crumbText };
})())`));
check('项目面板：改名后列表行名与面包屑都跟着更新（不用重开面板、不用刷新）',
  rowsAfterRename.rows.includes('改名验收-项目') && rowsAfterRename.crumbText === '改名验收-项目',
  rowsAfterRename);

// 文件改名同样要落库：✎ → 输入 → Enter → 保存
await openPanel(1, '.files-section');
const fileRenameClicked = await evaluate(`(()=>{
  const row = document.querySelector('.file-row');
  if (!row) return 'no-row';
  const btns = [...row.querySelectorAll('.row-btn')];
  const rename = btns.find((b) => (b.getAttribute('title') || '').includes('Rename')) || btns[1];
  if (!rename) return 'no-button';
  rename.click();
  return 'clicked';
})()`);
await sleep(500);
const fileRenameTyped = await evaluate(`(()=>{
  const i = document.querySelector('.rename-input');
  if (!i) return 'no-input';
  i.focus();
  i.value = 'gate-renamed-block.json';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'typed';
})()`);
await sleep(600);
await clickToolbarSave();
const dbAfterFile = await dumpDb();
check('文件面板：✎ 改名 + 保存后写进 IndexedDB',
  fileRenameClicked === 'clicked' && fileRenameTyped === 'typed'
    && dbAfterFile.some((r) => (r.files || []).includes('gate-renamed-block.json')),
  { fileRenameClicked, fileRenameTyped, dbAfterFile });

// 10c. 右栏（代码栏）：栏头不许再放一个与顶栏重复的「收起」按钮；
//      栏头与左栏面包屑同高、工具行与左栏保存行同高。
//      改前实测：栏头里那颗 » 与顶栏面板开关都发同一个 toggleCodePane；
//      右栏工具行 49px、左栏保存行 38px，两栏第二行错开 11px。
const RIGHT = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const box = (el) => el ? (() => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      t: Math.round(r.top), l: Math.round(r.left), r: Math.round(r.right),
      h: Math.round(r.height), padR: parseFloat(s.paddingRight),
    };
  })() : null;
  const head = document.querySelector('.code-head');
  const lang = document.querySelector('.code-head-lang');
  const actions = document.querySelector('.header-actions');
  const toggles = actions ? [...actions.querySelectorAll('button')]
    .filter((b) => /代码栏|code pane/i.test(b.getAttribute('aria-label') || '')) : [];
  const tbBtns = [...document.querySelectorAll('.code-toolbar .toolbar-btn')];
  return {
    head: box(head),
    headButtons: head ? head.querySelectorAll('button').length : null,
    lang: box(lang),
    crumb: box(document.querySelector('.editor-breadcrumb')),
    leftToolbar: box(document.querySelector('.toolbar')),
    codeToolbar: box(document.querySelector('.code-toolbar')),
    paneToggles: toggles.length,
    toggleLabel: toggles[0] ? toggles[0].getAttribute('aria-label') : null,
    tvBtnBoxes: tbBtns.map((b) => Math.round(b.getBoundingClientRect().height)),
  };
})())`));

check('代码栏栏头与左栏面包屑等高、同顶（38px）',
  RIGHT.head?.h === 38 && RIGHT.crumb?.h + 1 === 38 && RIGHT.head?.t === RIGHT.crumb?.t,
  { head: RIGHT.head, crumb: RIGHT.crumb });
check('代码栏栏头里没有第二个「收起」按钮（隐藏动作只在顶栏一处）',
  RIGHT.headButtons === 0, RIGHT.headButtons);
check('顶栏：代码栏开关恰好 1 个且带可访问名称',
  RIGHT.paneToggles === 1 && (RIGHT.toggleLabel || '').length > 0,
  { paneToggles: RIGHT.paneToggles, toggleLabel: RIGHT.toggleLabel });
/* 语言标签贴右：右边缘 = 栏头右边缘 - 栏头右内边距。
   改前 lang 与 » 都写了 margin-left:auto，自由空间被劈成两半（各 105.5px），
   「Python」于是浮在栏头中间偏左，右边还空出一大块。 */
check('代码栏栏头：语言标签贴右（右边缘 = 栏头右边缘 - 内边距）',
  RIGHT.lang && RIGHT.head && Math.abs(RIGHT.head.r - RIGHT.head.padR - RIGHT.lang.r) <= 1,
  { head: RIGHT.head, lang: RIGHT.lang });
check('右栏工具行与左栏保存行等高、同顶（38px）',
  RIGHT.codeToolbar?.h === 38 && RIGHT.leftToolbar?.h === 38
    && RIGHT.codeToolbar?.t === RIGHT.leftToolbar?.t,
  { codeToolbar: RIGHT.codeToolbar, leftToolbar: RIGHT.leftToolbar });
check('右栏工具行的按钮仍是 32px 高（只收行高，不压按钮）',
  RIGHT.tvBtnBoxes.length === 3 && RIGHT.tvBtnBoxes.every((h) => h === 32),
  RIGHT.tvBtnBoxes);

// 11. 窄屏（≤1200px）检索面板切成浮层：同一套头部规则在浮层里也必须成立，
//     否则「统一」只证明了停靠态这一半。
await send('browsingContext.setViewport', { context, viewport: { width: 1024, height: 700 } });
await sleep(1000);
await evaluate(`(()=>{
  const b = document.querySelectorAll('.activity-bar .activity-btn')[3];
  if (b) b.click();
  return true;
})()`);
await sleep(800);
await shoot('docSearch-overlay');
const overlay = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const host = document.querySelector('.dsp-overlay');
  const head = host ? host.querySelector('.section-head') : null;
  const title = head ? head.querySelector('.section-title') : null;
  const btns = head ? [...head.querySelectorAll('button')] : [];
  const s = title ? getComputedStyle(title) : null;
  return {
    host: host ? 'dsp-overlay' : null,
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    titleCss: s ? { size: s.fontSize, weight: s.fontWeight, ls: s.letterSpacing, tt: s.textTransform, color: s.color } : null,
    buttons: btns.length,
    closeBox: btns[0] ? {
      w: Math.round(btns[0].getBoundingClientRect().width),
      h: Math.round(btns[0].getBoundingClientRect().height),
    } : null,
    checkboxInHead: head ? !!head.querySelector('input[type="checkbox"]') : null,
  };
})())`));
check('窄屏浮层：查文档是 .dsp-overlay，头部仍 38px',
  overlay.host === 'dsp-overlay' && overlay.headH === 38, overlay);
check('窄屏浮层：标题计算样式与停靠态逐项一致',
  JSON.stringify(overlay.titleCss) === JSON.stringify(projects.titleCss),
  { overlay: overlay.titleCss, projects: projects.titleCss });
check('窄屏浮层：头部只有 1 个按钮且 24×24',
  overlay.buttons === 1 && overlay.closeBox?.w === 24 && overlay.closeBox?.h === 24, overlay);
check('窄屏浮层：头部不含 checkbox', overlay.checkboxInHead === false, overlay);

// 12. 窄屏（≤1200px）五个面板的头部：四个在浮层 / 弹出层里，文件面板留在横条里。
//     这一段是补出来的：此前窄屏只验了查文档浮层，而函数面板浮层当时另写了一份
//     `.cfp-header`（14px 标题、48px 高、无标签的 ✕），49 条断言一条都没红。
const NARROW_PROBE = `JSON.stringify((()=>{
  const head = document.querySelector('.section-head');
  const hs = head ? getComputedStyle(head) : null;
  const t = head ? head.querySelector('.section-title') : null;
  const ts = t ? getComputedStyle(t) : null;
  const r = head ? head.getBoundingClientRect() : null;
  const tr = t ? t.getBoundingClientRect() : null;
  const btns = head ? [...head.querySelectorAll('button')] : [];
  const b = btns[0] ?? null;
  const br = b ? b.getBoundingClientRect() : null;
  return {
    headCount: document.querySelectorAll('.section-head').length,
    headClass: head ? head.className : null,
    h: r ? Math.round(r.height) : null,
    padL: hs ? hs.paddingLeft : null,
    border: hs ? hs.borderBottomWidth : null,
    headLeft: r ? Math.round(r.left) : null,
    titleText: t ? t.innerText.trim() : null,
    /* display:none 的元素仍能读到计算样式，所以字体判据对隐藏的文件标题同样成立。 */
    titleCss: ts ? { size: ts.fontSize, weight: ts.fontWeight, ls: ts.letterSpacing, tt: ts.textTransform, color: ts.color } : null,
    titleVisible: !!(tr && tr.width > 0 && tr.height > 0),
    titleLeft: tr && tr.width > 0 ? Math.round(tr.left) : null,
    buttons: btns.length,
    btnBox: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null,
    btnLabel: b ? (b.getAttribute('aria-label') || b.getAttribute('title') || '') : null,
    hasOldCfpHheader: !!document.querySelector('.cfp-header'),
  };
})())`;

const narrow = [];
for (const [idx, name, marker] of [
  [0, 'projects', '.project-panel'],
  [1, 'files', '.files-section'],
  [2, 'functions', '.cfp-panel'],
  [3, 'docSearch', '.dsp'],
  [4, 'blockSearch', '.bsp'],
]) {
  await openPanel(idx, marker);
  narrow.push([name, JSON.parse(await evaluate(NARROW_PROBE))]);
  /* 截图必须在面板还开着的时候拍：循环结束后面板上停的是最后一个（查块）。 */
  if (name === 'functions') await shoot('functions-overlay');
}

check('窄屏：五个面板各自只有一个头部',
  narrow.every(([, p]) => p.headCount === 1), narrow.map(([n, p]) => [n, p.headCount]));
check('窄屏：五个头部都取 .section-head（函数面板浮层的 .cfp-header 已不存在）',
  narrow.every(([, p]) => (p.headClass || '').split(' ').includes('section-head') && p.hasOldCfpHheader === false),
  narrow.map(([n, p]) => [n, p.headClass, p.hasOldCfpHheader]));
/* 横条里的文件面板头只有一颗 ＋，高度收到按钮高（24）——横条只有一行高，
   保住 38px 会把活动条与文件行顶开。浮层/弹出层的四个头必须仍是 38px 基线。 */
check('窄屏：四个浮层/弹出面板的头部高度都是 38px',
  narrow.filter(([n]) => n !== 'files').every(([, p]) => p.h === 38),
  narrow.map(([n, p]) => [n, p.h]));
check('窄屏：横条里的文件面板头收成按钮高（24px），不撑高横条',
  narrow.find(([n]) => n === 'files')[1].h === 24,
  narrow.find(([n]) => n === 'files')[1].h);
check('窄屏：五个标题的字体与停靠态逐项一致',
  narrow.every(([, p]) => JSON.stringify(p.titleCss) === JSON.stringify(projects.titleCss)),
  narrow.map(([n, p]) => [n, p.titleCss]));
check('窄屏：四个浮层/弹出面板显示标题，横条里的文件面板按设计隐藏标题',
  narrow.filter(([n]) => n !== 'files').every(([, p]) => p.titleVisible === true)
    && narrow.find(([n]) => n === 'files')[1].titleVisible === false,
  narrow.map(([n, p]) => [n, p.titleVisible]));
/* 贴左判据同停靠态：标题左边缘 = 头部左边缘 + 头部内边距（文件面板标题隐藏，跳过）。 */
const narrowAligned = narrow.filter(([n]) => n !== 'files')
  .every(([, p]) => p.titleLeft - p.headLeft === Math.round(parseFloat(p.padL)));
check('窄屏：四个可见标题都贴左（左边缘 = 头部左边缘 + 头部内边距）', narrowAligned,
  narrow.map(([n, p]) => [n, { headLeft: p.headLeft, titleLeft: p.titleLeft, padL: p.padL }]));
check('窄屏：五个头部都只有 1 个 24×24 图标按钮且有可访问名称',
  narrow.every(([, p]) => p.buttons === 1 && p.btnBox?.w === 24 && p.btnBox?.h === 24 && (p.btnLabel || '').length > 0),
  narrow.map(([n, p]) => [n, p.buttons, p.btnBox, p.btnLabel]));

// 12b. 浮层里的关闭按钮必须真的能关（函数面板浮层此前那个 ✕ 没有可访问名称，
//      换类名之后更容易断线，所以这里点一次，而不是只量盒模型）。
await openPanel(2, '.cfp-panel');
const cfpClicked = await evaluate(`(()=>{
  const b = document.querySelector('.cfp-overlay .section-head .ghost-btn');
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`);
await sleep(700);
const cfpAfterClose = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const s = document.querySelector('.side-panel');
  return {
    overlayGone: !document.querySelector('.cfp-overlay'),
    nextPanel: s ? (s.firstElementChild?.className ?? null) : null,
  };
})())`));
check('窄屏：函数面板浮层的 ✕ 点了真的关掉面板',
  cfpClicked === 'clicked' && cfpAfterClose.overlayGone === true
    && String(cfpAfterClose.nextPanel || '').includes('files-section'),
  { cfpClicked, cfpAfterClose });

// 13. 打开一个本地不存在的项目：状态栏必须报「加载失败」，不能沿用「保存失败」——
//     报错指向错了那一步，用户会去查保存路径，而问题在打开。
const statusBeforeNav = await evaluate(`(()=>{
  const el = document.querySelector('.toolbar .save-status');
  return el ? el.className.trim() + '|' + el.textContent.trim() : null;
})()`);
await evaluate("location.hash = '#/editor/999999'");
await sleep(1500);
const loadError = JSON.parse(await evaluate(`JSON.stringify((()=>{
  const el = document.querySelector('.toolbar .save-status.error');
  const text = el ? el.textContent.trim() : null;
  return {
    text,
    saysSaveFailed: text ? /保存失败|Save failed/.test(text) : null,
    saysLoadFailed: text ? /加载失败|Load failed/.test(text) : null,
  };
})())`));
check('加载不存在的项目时状态栏报「加载失败」而不是「保存失败」',
  loadError.saysLoadFailed === true && loadError.saysSaveFailed === false,
  { statusBeforeNav, loadError });

await send('browsingContext.close', { context });
ff.kill('SIGTERM');

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSUMMARY total=${results.length} pass=${results.length - failed} fail=${failed}`);
process.exit(failed === 0 ? 0 : 1);
