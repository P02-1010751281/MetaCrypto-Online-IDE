/** 查文档面板的真实浏览器验收：挂载组件 → 脚本化输入 → 记录命中/打开事件 → 写 DOM 供 --dump-dom 读取。 */
import { createApp, h } from 'vue';

import DocSearchPanel from '@/components/ai-helper/DocSearchPanel.vue';

interface OpenEvent { type: 'open'; path: string; line: number; kind: string }
const events: Array<OpenEvent | string> = [];

const app = createApp({
  render: () => h(DocSearchPanel, {
    visible: true,
    onClose: () => events.push('close'),
    onOpen: (hit) => events.push({ type: 'open', path: hit.path, line: hit.line, kind: hit.kind }),
  }),
});
app.mount('#app');
window.addEventListener('error', (event) => events.push(`pageerror: ${event.message}`));

const out = document.getElementById('out') as HTMLPreElement;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const input = (): HTMLInputElement => document.querySelector('.dsp-input') as HTMLInputElement;
const items = (): string[] => [...document.querySelectorAll('.dsp-item')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
const hint = (): string => (document.querySelector('.dsp-hint')?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function type(text: string): Promise<void> {
  const el = input();
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitForItems(min: number, timeoutMs = 15000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (items().length >= min) return true;
    await sleep(150);
  }
  return false;
}

async function run(): Promise<void> {
  await sleep(400);
  const report: Record<string, unknown> = {
    mounted: Boolean(document.querySelector('.dsp')),
    placeholder: input().placeholder,
  };

  await type('SM4 密钥扩展');
  report.zhHits = await waitForItems(1) ? items().length : 0;
  report.zhFirst = items()[0] ?? null;

  (document.querySelector('.dsp-item') as HTMLElement | null)?.click();
  await sleep(120);
  report.afterClick = [...events];

  await type('How is the SM4 round function defined');
  report.enHits = (await waitForItems(1)) ? items().length : 0;
  report.enFirst = items()[0] ?? null;

  // 打开 PDF 语料：勾选后要等 3.4 MB 索引加载 + 合并
  (document.querySelector('.dsp-pdf input') as HTMLInputElement | null)?.click();
  await sleep(1200);
  await type('GM/T 0105 熵源');
  await waitForItems(1, 20000);
  await sleep(800);
  report.pdfHits = items().length;
  report.pdfKinds = items().map((text) => (text.startsWith('PDF') ? 'pdf' : 'md'));
  report.pdfFirst = items()[0] ?? null;

  // 空结果：用真正不存在的拉丁串（中文二元组几乎总能命中真实语料）
  await type('qzxvbnmplkj');
  for (let i = 0; i < 40 && !hint(); i += 1) await sleep(100);
  report.emptyHint = hint();
  report.emptyItems = items().length;

  // 最后停在有结果的状态，方便截图目检
  await type('带认证的加密');
  await waitForItems(1);
  await sleep(400);
  report.intentFirst = items()[0] ?? null;

  report.pageErrors = events.filter((event) => typeof event === 'string' && event.startsWith('pageerror'));
  out.textContent = JSON.stringify(report, null, 1);
  (window as unknown as { __REPORT__: unknown }).__REPORT__ = report;
}

void run().catch((error: unknown) => {
  out.textContent = `HARNESS_FAIL ${String(error)}`;
});
