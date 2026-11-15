/**
 * 查块面板的真实浏览器 harness。
 *
 * 为什么需要：面板的逻辑（打分/过滤）已有单测，但它「渲染成什么样、能不能把块插进画布」
 * 只能在真实浏览器里看。本页挂一个真实 Blockly 工作区 + 面板，脚本化地搜两次、点一次结果，
 * 把实测结果写进 `#out`，并留给 `--screenshot` 目检。
 *
 * 运行（dev server 已在 5199）：
 *   chrome --headless=new --no-sandbox --virtual-time-budget=20000 --dump-dom \
 *     http://127.0.0.1:5199/experiments/ai-helper-2026-11-14/search-harness/index.html
 */

import './locale';

import * as Blockly from 'blockly/core';
import { createApp, h, nextTick } from 'vue';

import '@/blocks';
import BlockSearchPanel from '@/components/ai-helper/BlockSearchPanel.vue';

const report: Record<string, unknown> = {};
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(`error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => errors.push(`rejection: ${String(event.reason)}`));

const host = document.getElementById('ws');
const out = document.getElementById('out');
if (!(host instanceof HTMLElement) || !(out instanceof HTMLElement)) throw new Error('缺少挂载点');

const workspace = Blockly.inject(host, {
  grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { controls: false, wheel: true, startScale: 1 },
});

const root = document.createElement('div');
document.body.appendChild(root);
let closeEvents = 0;
createApp({
  render: () => h(BlockSearchPanel, {
    visible: true,
    workspace,
    docked: false,
    onClose: () => { closeEvents += 1; },
  }),
}).mount(root);

function inputEl(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('.bsp-input');
  if (!element) throw new Error('面板没有渲染出输入框');
  return element;
}

async function typeQuery(text: string): Promise<void> {
  const element = inputEl();
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.bsp-item')];
}

async function run(): Promise<void> {
  report.mounted = Boolean(document.querySelector('.bsp'));
  report.placeholder = inputEl().getAttribute('placeholder');

  await typeQuery('S 盒');
  report.query1 = {
    text: 'S 盒',
    hits: items().length,
    firstLabel: items()[0]?.querySelector('.bsp-item-label')?.textContent?.trim(),
    firstType: items()[0]?.querySelector('.bsp-item-type')?.textContent?.trim(),
    firstReason: items()[0]?.querySelector('.bsp-reason')?.textContent?.trim(),
  };

  // 点第一条结果：应当把块真的插进画布
  items()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  const inserted = workspace.getAllBlocks(false);
  report.inserted = { count: inserted.length, type: inserted[0]?.type ?? null };

  // 遮罩形态点结果后应发出 close（本 harness 的父组件固定 visible=true，所以面板不消失）
  report.closeEvents = closeEvents;

  await typeQuery('按位与');
  report.query2 = { text: '按位与', hits: items().length, firstType: items()[0]?.querySelector('.bsp-item-type')?.textContent?.trim() };
  report.query2FirstLabel = items()[0]?.querySelector('.bsp-item-label')?.textContent?.trim();

  // 结构化筛选：清空文本后只看输出 IntList
  await typeQuery('');
  const select = document.querySelectorAll<HTMLSelectElement>('.bsp-select')[1];
  select.value = 'IntList';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  report.outFilterIntList = { hits: items().length, firstType: items()[0]?.querySelector('.bsp-item-type')?.textContent?.trim() };

  // 空态
  await typeQuery('zzzqqqnotexists');
  report.emptyState = {
    hits: items().length,
    hint: document.querySelector('.bsp-hint')?.textContent?.trim(),
  };

  // 截图停在一个有内容的状态（先把上一步的输出限制清掉）
  select.value = '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  await typeQuery('模幂');
  document.querySelector<HTMLSelectElement>('.bsp-select:nth-of-type(2)')?.blur();
}

run()
  .catch((error) => {
    report.failed = String(error);
  })
  .finally(() => {
    report.pageErrors = errors;
    report.blockly = Blockly.VERSION;
    out.textContent = JSON.stringify(report, null, 1);
  });
