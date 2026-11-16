<template>
  <div v-if="visible" :class="docked ? 'dsp-host dsp-docked' : 'dsp-overlay'" @click.self="docked ? undefined : emit('close')">
    <div class="dsp">
      <div class="dsp-header">
        <span class="dsp-title">{{ ui('docSearch') }}</span>
        <div class="dsp-actions">
          <label class="dsp-pdf">
            <input v-model="withPdf" type="checkbox" />
            {{ ui('docSearchIncludePdf') }}
          </label>
          <button class="dsp-close" :aria-label="ui('docSearchClose')" @click="emit('close')">×</button>
        </div>
      </div>

      <div class="dsp-query">
        <input
          ref="inputEl"
          v-model="query"
          class="dsp-input"
          type="text"
          :placeholder="ui('docSearchPlaceholder')"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="pickSelected"
          @keydown.esc.prevent="emit('close')"
        />
      </div>

      <p v-if="status" class="dsp-hint">{{ status }}</p>
      <p v-else-if="!query.trim()" class="dsp-hint">
        {{ ui('docSearchIdleHint') }}
      </p>
      <p v-else-if="!loading && !hits.length" class="dsp-hint">
        {{ ui('docSearchEmpty') }}
      </p>
      <ul v-else class="dsp-results">
        <li
          v-for="(hit, index) in hits"
          :key="`${hit.path}:${hit.line}`"
          :class="['dsp-item', { 'dsp-item-active': index === active }]"
          :title="hit.kind === 'pdf' ? ui('docSearchPdfItem') : ui('docSearchOpenMd')"
          @mouseenter="active = index"
          @click="open(hit)"
        >
          <div class="dsp-item-head">
            <span :class="['dsp-kind', `dsp-kind-${hit.kind}`]">{{ hit.kind === 'pdf' ? 'PDF' : 'MD' }}</span>
            <span class="dsp-item-title">{{ hit.title }}</span>
            <span v-if="hit.heading && hit.heading !== hit.title" class="dsp-item-heading">{{ hit.heading }}</span>
          </div>
          <div class="dsp-item-loc">
            {{ hit.path }}<template v-if="hit.kind === 'pdf'"> · {{ ui('docSearchPdfPage').replace('{n}', String(hit.line)) }}</template><template v-else>:{{ hit.line }}</template>
          </div>
          <div v-if="hit.excerpt" class="dsp-item-excerpt">{{ hit.excerpt }}</div>
        </li>
      </ul>

      <div class="dsp-footer">
        <button
          type="button"
          class="dsp-browse"
          @click="emit('browse-all', query.trim())"
        >
          {{ ui('docSearchBrowseAll') }} →
        </button>
        <p class="dsp-foot">{{ ui('docSearchFoot') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { ui } from '@/composables/locale';
import { mergeIndexes, parseDocIndex, searchDocs } from '@/services/ai-helper/doc-search';
import type { DocHit, DocIndex } from '@/services/ai-helper/doc-search';

const props = defineProps<{
  visible: boolean;
  /** docked：停靠进某一栏；缺省是全屏遮罩。 */
  docked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 选中一条结果：由宿主决定如何打开（路由到文档页并定位到 line/页码）。 */
  (e: 'open', hit: DocHit): void;
  /**
   * 底部第二入口（任何状态都可见）：把当前查询词交给宿主，由宿主带 ?q= 进文档中心。
   * 词为空也发——宿主据空串直接进 /docs，不带 q。
   */
  (e: 'browse-all', query: string): void;
}>();

/** 两份索引都是构建期产物（Markdown 3.9 MB / PDF 3.4 MB），按需动态加载，不进主包。 */
let markdownIndex: DocIndex | null = null;
let pdfIndex: DocIndex | null = null;
/** 合并后的索引缓存：mergeIndexes 要遍历 7 MB postings，不能每次按键都重算。 */
let mergedIndex: DocIndex | null = null;

const query = ref('');
const withPdf = ref(false);
const hits = ref<DocHit[]>([]);
const status = ref('');
/** PDF 索引缺失是可选降级：用标志位而不是比对提示文案前缀（文案已本地化）。 */
const pdfUnavailable = ref(false);
const loading = ref(false);
const active = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

async function loadMarkdown(): Promise<DocIndex | null> {
  if (markdownIndex) return markdownIndex;
  try {
    const module = (await import('@/services/ai-helper/doc-index.json?raw')) as { default: string };
    markdownIndex = parseDocIndex(module.default);
    return markdownIndex;
  } catch (error) {
    status.value = `${ui('docSearchIndexError')}${(error as Error).message}`;
    return null;
  }
}

async function loadPdf(): Promise<DocIndex | null> {
  if (pdfIndex) return pdfIndex;
  try {
    const module = (await import('@/services/ai-helper/doc-index-pdf.json?raw')) as { default: string };
    pdfIndex = parseDocIndex(module.default);
    return pdfIndex;
  } catch {
    // PDF 索引是可选的：缺失时降级为只查 Markdown，并把原因写进状态栏，不静默。
    pdfUnavailable.value = true;
    status.value = ui('docSearchPdfIndexMissing');
    return null;
  }
}

async function run(): Promise<void> {
  const text = query.value.trim();
  if (!text) {
    hits.value = [];
    return;
  }
  loading.value = true;
  if (!pdfUnavailable.value) status.value = '';
  try {
    const markdown = await loadMarkdown();
    if (!markdown) return;
    let index = markdown;
    if (withPdf.value) {
      if (!mergedIndex) {
        const pdf = await loadPdf();
        mergedIndex = pdf ? mergeIndexes(markdown, pdf) : markdown;
      }
      index = mergedIndex;
    }
    hits.value = searchDocs(index, text, { limit: 12 });
    active.value = 0;
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
watch([query, withPdf], () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void run();
  }, 120);
});

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    query.value = '';
    hits.value = [];
    status.value = '';
    active.value = 0;
    await nextTick();
    inputEl.value?.focus();
  },
);

function move(step: number): void {
  if (!hits.value.length) return;
  active.value = (active.value + step + hits.value.length) % hits.value.length;
}

function pickSelected(): void {
  const hit = hits.value[active.value];
  if (hit) open(hit);
}

function open(hit: DocHit): void {
  emit('open', hit);
  if (!props.docked) emit('close');
}
</script>

<style scoped>
.dsp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.dsp {
  display: flex;
  flex-direction: column;
  width: min(760px, 94vw);
  max-height: 72vh;
  overflow: hidden;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  font-size: 13px;
}
.dsp-docked {
  width: 100%;
  max-height: none;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* 同 BlockSearchPanel：内层 .dsp 默认悬浮宽度 min(760px, 94vw)，
 * 停靠时必须下传栏宽，否则内容被栏的 overflow 裁掉右半边。 */
.dsp-docked > .dsp {
  width: 100%;
  height: 100%;
  max-height: none;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.dsp-host.dsp-docked {
  height: 100%;
}
.dsp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--panel-head-h);
  padding: 0 var(--panel-pad-x);
  border-bottom: 1px solid var(--color-border);
}
.dsp-title {
  font-weight: 600;
}
.dsp-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dsp-pdf {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text);
  cursor: pointer;
}
.dsp-close {
  border: 0;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.dsp-query {
  padding: 6px var(--panel-pad-x);
  border-bottom: 1px solid var(--color-border, #d0d3d9);
}
.dsp-input {
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control);
  background: var(--color-bg-card);
  color: var(--color-text);
  font: inherit;
}
.dsp-hint {
  margin: 0;
  padding: 14px var(--panel-pad-x);
  color: var(--color-text-secondary);
}
.dsp-results {
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.dsp-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}
.dsp-item-active {
  background: var(--color-bg-hover);
}
.dsp-item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.dsp-kind {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 16px;
  color: #fff;
}
.dsp-kind-md {
  background: var(--color-primary);
}
.dsp-kind-pdf {
  background: var(--color-warning);
}
.dsp-item-title {
  font-weight: 600;
}
.dsp-item-heading {
  color: var(--color-text);
}
.dsp-item-loc {
  margin-top: 2px;
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
  word-break: break-all;
}
.dsp-item-excerpt {
  margin-top: 4px;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 页脚容器承接上边框；第二入口与说明文字同处页脚，落在 v-if 链之外所以恒可见。 */
.dsp-footer {
  border-top: 1px solid var(--color-border, #d0d3d9);
}
.dsp-browse {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  background: none;
  color: var(--color-primary, #2563eb);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsp-foot {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
