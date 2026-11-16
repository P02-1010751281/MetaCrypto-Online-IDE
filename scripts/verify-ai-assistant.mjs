#!/usr/bin/env node
/**
 * 问答助手（查文档 / 查积木合并入口 + 双向联动）的真浏览器验收。
 *
 * 为什么必须在浏览器里验：这次改动的判据全在「组件之间的接线」上——tab 切换后另一个面板
 * 是否真的收到种子查询词、联动按钮是否只在该显示的行上出现、关掉再开是否把上一次的种子
 * 清干净。单测只能覆盖 `services/ai-helper/linkage.ts` 的派生规则，接不上就会「单测全绿、
 * 界面点了没反应」。
 *
 * 用法：
 *   npm run dev -- --port 5240            # 另开终端（要干净的实例，见经验：dev server 会缓存已删模块）
 *   BASE_URL=http://localhost:5240 node scripts/verify-ai-assistant.mjs
 *
 * 退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境不满足。
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5240';
const PORT = Number(process.env.CDP_PORT || 9351);
const OUT = process.env.OUT_DIR || 'experiments/ai-helper-2026-11-14/out';
const CHROME =
  process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;

const APP = `${BASE_URL}/#/editor/1`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });

try {
  const response = await globalThis.fetch(BASE_URL, { signal: globalThis.AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(String(response.status));
} catch (error) {
  console.error(`verify-ai-assistant ENV: ${BASE_URL} 不可达（${String(error)}），先起 npm run dev -- --port 5240`);
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'aiassist-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,900', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, APP,
  ],
  { stdio: 'ignore' },
);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   <<< ${String(JSON.stringify(detail ?? null)).slice(0, 300)}`}`);
};

async function pageTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await globalThis.fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
  console.error(`verify-ai-assistant ENV: 连不上 Chrome CDP（${String(error)}）`);
  chrome.kill();
  process.exit(2);
}

let seq = 0;
const pendingCalls = new Map();
const pageErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
  }
  if (message.id && pendingCalls.has(message.id)) {
    pendingCalls.get(message.id)(message);
    pendingCalls.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pendingCalls.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (reply.result?.exceptionDetails) {
    throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
  }
  return reply.result?.result?.value;
}

async function waitFor(expression, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      /* 页面正在渲染，重试 */
    }
    await sleep(200);
  }
  return false;
}

async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
}

const tabInfo = `(() => {
  const tabs = [...document.querySelectorAll('.aip-tabs .aip-tab')];
  return tabs.map((tab) => ({ text: tab.textContent.trim(), active: tab.classList.contains('aip-tab-active') }));
})()`;

try {
  check('编辑器就绪', await waitFor('document.querySelector(\'.editor-view\') !== null', 90000));

  // 1. 合并入口：activity bar 上的问答助手按钮打开一个壳，壳里有 2 个 tab
  const buttons = await evaluate('[...document.querySelectorAll(\'.activity-bar .activity-btn\')].map((b) => b.title)');
  check('activity bar 只有一个问答助手入口（查文档/查块两个图标已合并）',
    buttons.filter((title) => /问答助手|查文档|查块/.test(title ?? '')).length === 1, buttons);

  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.activity-bar .activity-btn')].find((b) => b.title === '问答助手');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check('点击问答助手入口', opened);
  check('助手壳渲染', await waitFor('document.querySelector(\'.aip\') !== null', 15000));
  const tabs = await evaluate(tabInfo);
  check('壳里有文档/积木两个 tab，默认文档',
    tabs.length === 2 && tabs[0].active === true && tabs[1].active === false, tabs);
  check('助手头部只有一个标题与一个关闭按钮',
    await evaluate(`(() => {
      const head = document.querySelector('.aip .section-head');
      return !!head && head.querySelectorAll('button').length === 1
        && head.querySelector('.section-title')?.textContent.trim() === '问答助手';
    })()`));
  check('嵌进助手的面板不再自带重复头部',
    await evaluate('document.querySelectorAll(\'.aip .dsp .section-head, .aip .bsp .section-head\').length === 0'));

  // 2. 文档检索 → 命中的行带「查积木」按钮
  await evaluate(`(() => {
    const input = document.querySelector('.dsp-input');
    input.value = 'SM4 密钥扩展';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  check('文档检索命中', await waitFor('document.querySelectorAll(\'.dsp-item\').length > 0', 30000));
  const docHits = await evaluate('document.querySelectorAll(\'.dsp-item\').length');
  const linkRows = await evaluate('document.querySelectorAll(\'.dsp-item .dsp-link\').length');
  check('文档结果里有行带「查积木」联动按钮', docHits > 0 && linkRows > 0, { docHits, linkRows });

  // 2b. D 线的交付物是「答案 + 出处」：命中之后必须给答案卡，且出处可回链。
  // 卡片先以 loading 态出现，答案要等正文加载 + 取句；等它落成「句子」或「拒答」再读数。
  check('检索命中后落成答案卡（抽取式原文句）或明确拒答',
    await waitFor(
      `(() => {
        const card = document.querySelector('.dsp .ac');
        if (!card) return false;
        return card.querySelectorAll('.ac-item .ac-text').length > 0 || card.classList.contains('ac-miss');
      })()`,
      20000,
    ));
  await shoot('assistant-answer');
  const answerCard = await evaluate(`(() => {
    const card = document.querySelector('.dsp .ac');
    if (!card) return null;
    return {
      miss: card.classList.contains('ac-miss'),
      sentences: [...card.querySelectorAll('.ac-item .ac-text')].map((el) => el.textContent.trim()),
      source: card.querySelector('.ac-link')?.textContent?.trim() ?? null,
    };
  })()`);
  check('答案卡给了 ≥1 句原文，并标注出处路径:行号',
    !!answerCard && answerCard.miss === false && answerCard.sentences.length >= 1
      && /docs\/standards\/.+:\d+/.test(answerCard.source ?? ''), answerCard);

  // 3. 点联动按钮 → 切到积木 tab，输入框被灌入派生词，且积木侧有结果
  const derived = await evaluate(`(() => {
    const row = document.querySelector('.dsp-item .dsp-link');
    const button = row;
    const query = button.getAttribute('title');
    button.click();
    return query;
  })()`);
  check('联动后切到积木 tab', await waitFor('document.querySelector(\'.bsp-input\') !== null && document.querySelectorAll(\'.aip-tabs .aip-tab\')[1].classList.contains(\'aip-tab-active\')', 15000));
  const blockInput = await evaluate('document.querySelector(\'.bsp-input\')?.value ?? null');
  check('积木输入框收到派生查询词（非空且为小写标识符）',
    typeof blockInput === 'string' && blockInput.length > 0 && /^[a-z0-9 .+-]+$/.test(blockInput), blockInput);
  check('积木侧真的查到了结果（联动不是点了没反应）',
    await waitFor('document.querySelectorAll(\'.bsp-item\').length > 0', 15000),
    { blockInput, derived });
  await shoot('assistant-link-blocks');

  // 4. 反向联动：积木结果行点「查文档」→ 回到文档 tab 并带派生词
  await evaluate(`(() => {
    document.querySelector('.bsp-item .bsp-link').click();
    return true;
  })()`);
  check('反向联动切回文档 tab',
    await waitFor('document.querySelectorAll(\'.aip-tabs .aip-tab\')[0].classList.contains(\'aip-tab-active\')', 15000));
  const docInput = await evaluate('document.querySelector(\'.dsp-input\')?.value ?? null');
  check('文档输入框收到积木派生词（块标签，不是空串）',
    typeof docInput === 'string' && docInput.trim().length > 0, docInput);
  check('文档侧查到结果', await waitFor('document.querySelectorAll(\'.dsp-item\').length > 0', 30000));
  await shoot('assistant-link-docs');

  // 4b. 点命中行本身（不是联动按钮）必须仍然「打开文档」：合并入口后这条接线
  //     改走壳的 open 事件，最容易在重排中静默断掉（点了没反应，单测也看不出来）。
  const docOpen = await evaluate(`(() => {
    const original = window.open;
    let href = null;
    window.open = (target) => { href = target; return { closed: false }; };
    document.querySelector('.dsp-item').click();
    window.open = original;
    return href;
  })()`);
  check('点文档命中行仍然走「打开文档」（open 事件经助手壳中转没断）',
    typeof docOpen === 'string' && /docs/.test(docOpen), docOpen);

  // 打开文档会把宿主的面板打回文件页，重新开一个给后面的断言用（也顺带验一次重开态）
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.activity-bar .activity-btn')].find((b) => b.title === '问答助手');
    button?.click();
    return true;
  })()`);
  check('重新打开助手（打开文档后面板已被宿主收起）',
    await waitFor('document.querySelector(\'.aip\') !== null', 15000));
  const reopen = await evaluate(`({
    docsActive: document.querySelectorAll('.aip-tabs .aip-tab')[0].classList.contains('aip-tab-active'),
    docQuery: document.querySelector('.dsp-input')?.value ?? null,
  })`);
  check('重开回到文档 tab 且输入框是空的（不残留上一次查询）',
    reopen.docsActive === true && reopen.docQuery === '', reopen);

  // 5. 手点 tab 必须清掉种子：不能带着上一次联动留下的查询词
  await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.aip-tabs .aip-tab')];
    tabs[1].click();
    return true;
  })()`);
  await sleep(600);
  const clearedBlocks = await evaluate('document.querySelector(\'.bsp-input\')?.value ?? null');
  await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.aip-tabs .aip-tab')];
    tabs[0].click();
    return true;
  })()`);
  await sleep(600);
  const clearedDocs = await evaluate('document.querySelector(\'.dsp-input\')?.value ?? null');
  check('手点 tab 清空种子（两个方向都不残留上一次的查询词）',
    clearedBlocks === '' && clearedDocs === '', { clearedBlocks, clearedDocs });

  // 6. 「无交集的文档不空点」：指南类文档派生不出积木词，行上不该有联动按钮
  await evaluate(`(() => {
    const input = document.querySelector('.dsp-input');
    input.value = '环境搭建与验收';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  check('查「环境搭建与验收」有命中', await waitFor('document.querySelectorAll(\'.dsp-item\').length > 0', 30000));
  const guideRows = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.dsp-item')];
    const setupRow = items.find((item) => (item.textContent || '').includes('SETUP'));
    return {
      total: items.length,
      setupRow: !!setupRow,
      setupHasLink: setupRow ? !!setupRow.querySelector('.dsp-link') : null,
    };
  })()`);
  check('没有积木词交集的指南页不出「查积木」按钮（不制造必然落空的点击）',
    guideRows.setupRow && guideRows.setupHasLink === false, guideRows);

  // 6b. 负例：语料里没有依据的问题必须拒答（答案卡转成「找不到依据」，不拿最近段落冒充）
  await evaluate(`(() => {
    const input = document.querySelector('.dsp-input');
    input.value = '如何用 CSS 实现毛玻璃效果';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  check('无依据的问题落成「找不到依据」而不是编一个答案',
    await waitFor(`(() => {
      const card = document.querySelector('.dsp .ac');
      return !!card && card.classList.contains('ac-miss')
        && (card.textContent || '').includes('没有找到能直接回答这句的依据');
    })()`, 20000));

  // 7. 关闭按钮：壳关掉、回到默认文件面板
  await evaluate(`(() => {
    document.querySelector('.aip .section-head .ghost-btn').click();
    return true;
  })()`);
  await sleep(700);
  const closed = await evaluate(`({
    aip: !!document.querySelector('.aip'),
    panel: document.querySelector('.side-panel')?.firstElementChild?.className ?? null,
  })`);
  check('关闭按钮真的关掉助手壳并回到文件面板',
    closed.aip === false && String(closed.panel).includes('files-section'), closed);

  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3));
} catch (error) {
  check(`执行中断：${String(error).slice(0, 200)}`, false);
} finally {
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\nAI_ASSISTANT_SUMMARY total=${results.length} pass=${results.length - failed} fail=${failed}`);
  ws?.close();
  chrome.kill();
  process.exit(failed ? 1 : 0);
}
