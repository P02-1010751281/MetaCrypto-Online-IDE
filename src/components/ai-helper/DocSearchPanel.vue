<template>
  <div v-if="visible" :class="shellClass" @click.self="docked || embedded ? undefined : emit('close')">
    <div class="dsp">
      <!-- 头部只有「标题 + 图标动作」：样式取全局 panel-chrome.css 的 section-head
           一套（同侧栏其余面板），不再自带 dsp-header 副本。
           嵌进 检索助手（tab 容器）时头部由助手壳提供，这里让位。 -->
      <div v-if="!embedded" class="section-head section-head--divided">
        <span class="section-title">{{ ui('docSearch') }}</span>
        <div class="section-actions">
          <button class="ghost-btn" :title="ui('docSearchClose')" :aria-label="ui('docSearchClose')" @click="emit('close')">×</button>
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
        <!-- 「包含 PDF」是检索范围（查询条件），不是面板动作：从头部下沉到查询行，
             与查块面板把筛选折叠在面板体里是同一条规则。 -->
        <label class="dsp-pdf-toggle">
          <input v-model="withPdf" type="checkbox" />
          <span>{{ ui('docSearchIncludePdf') }}</span>
        </label>
      </div>

      <p v-if="status" class="dsp-hint">{{ status }}</p>
      <p v-else-if="!query.trim()" class="dsp-hint">
        {{ ui('docSearchIdleHint') }}
      </p>
      <!-- 空态只在「没有命中」时出现；答案卡与结果列表各用独立条件。
           这里曾经把 AnswerCard 插进 v-if/v-else 链中间，导致 `<ul v-else>` 绑到答案卡上——
           有答案时结果列表整块消失（真浏览器验收抓到的，单测看不到）。 -->
      <p v-else-if="!loading && !hits.length" class="dsp-hint">
        {{ ui('docSearchEmpty') }}
      </p>
      <!-- 答案层：有命中就先给「答案 + 出处」，答不出来时明说缺什么（不拿最近段落冒充答案）。 -->
      <AnswerSection
        v-if="!status && query.trim() && (answerResult || answerLoading)"
        :result="answerResult"
        :loading="answerLoading"
        :question="answeredQuery"
        @open="openAnswerEvidence"
      />
      <ul v-if="!status && hits.length" class="dsp-results">
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
            <!-- 跨域联动：只有能派生到积木词的文档才给这个动作（实测无交集的文档必然空点）。 -->
            <button
              v-if="linkFor(hit)"
              type="button"
              class="dsp-link"
              :title="ui('linkToBlocks')"
              @click.stop="emit('cross-search', linkFor(hit) as string)"
            >{{ ui('linkToBlocks') }}</button>
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
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import { ui } from '@/composables/locale';
import { useDocAnswer } from '@/composables/useDocAnswer';
import AnswerSection from './AnswerSection.vue';
import { mergeIndexes, parseDocIndex, searchDocs } from '@/services/ai-helper/doc-search';
import type { DocHit, DocIndex } from '@/services/ai-helper/doc-search';
import { createDocLinkResolver } from '@/services/ai-helper/linkage';

const props = defineProps<{
  visible: boolean;
  /** docked：停靠进某一栏；缺省是全屏遮罩。 */
  docked?: boolean;
  /** embedded：由宿主（检索助手）提供头部与 tab，本组件只保留查询行与结果。 */
  embedded?: boolean;
  /**
   * 宿主带过来的初始查询词：只在 `visible` 翻成 true 的那一次生效。
   * 用于跨域联动——另一侧点了「查积木」就把派生词灌进来，不用用户再打一遍。
   */
  seed?: string;
  /**
   * 块索引标识符词表（由宿主从 block-index.json 建一次传入）。
   * 缺省 null = 不提供跨域联动按钮，面板保持「查文档」单一职责。
   */
  blockVocabulary?: ReadonlySet<string> | null;
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
  /** 跨域联动：把派生好的积木查询词交给宿主，由宿主切到积木 tab 并灌进输入框。 */
  (e: 'cross-search', query: string): void;
}>();

/** 外层的三种形态：悬浮遮罩 / 停靠进栏 / 嵌进助手的 tab 容器（样式同停靠）。 */
const shellClass = computed(() => {
  if (props.embedded || props.docked) {
    return props.embedded ? 'dsp-host dsp-docked dsp-embedded' : 'dsp-host dsp-docked';
  }
  return 'dsp-overlay';
});

/** 两份索引都是构建期产物（Markdown 3.9 MB / PDF 3.4 MB），按需动态加载，不进主包。 */
let markdownIndex: DocIndex | null = null;
let pdfIndex: DocIndex | null = null;
/** 合并后的索引缓存：mergeIndexes 要遍历 7 MB postings，不能每次按键都重算。 */
let mergedIndex: DocIndex | null = null;

const query = ref('');
const withPdf = ref(false);
const hits = ref<DocHit[]>([]);
// 解构成顶层 ref：模板里只有顶层 ref 会被自动解包，挂在普通对象上的 ref 会露出 .value。
const {
  result: answerResult,
  loading: answerLoading,
  answer: runAnswer,
  clear: clearAnswer,
} = useDocAnswer();
const status = ref('');
/**
 * 产出当前答案的那个查询词（不是输入框里的实时文本）。
 *
 * 答案层的模型调用按「答案变了」触发：如果传实时 query，用户每敲一个字都会先用**旧答案**
 * 触发一次调用，等 120 ms 防抖跑完再按新答案触发第二次——一次提问两次计费
 * （2026-11-18 真浏览器验收实测 4 次请求打成 3 次预期）。这里只在真正发起答案计算时
 * 记下词，答案与问题因此成对，调用数跟答案数一致。
 */
const answeredQuery = ref('');
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
    answeredQuery.value = '';
    clearAnswer();
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
    answeredQuery.value = text;
    void runAnswer(text, index, hits.value);
  } finally {
    loading.value = false;
  }
}

// 组件卸载时把在途的答案作废（composable 用序号挡竞态，这里只兜底清状态）。
onUnmounted(() => clearAnswer());

let timer: ReturnType<typeof setTimeout> | null = null;
watch([query, withPdf], () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void run();
  }, 120);
});

/** 跨域联动按钮的查询词：只有与块词表有交集的文档才返回（`linked`），否则返回 undefined。 */
const linkFor = createDocLinkResolver(() => props.blockVocabulary);

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    // 先清空再灌种子：种子可能与上一次的查询词相同（反复点同一处联动），
    // 直接赋值不会触发防抖 watcher，面板会停在「有查询词但没有结果」的假空态。
    query.value = '';
    hits.value = [];
    status.value = '';
    active.value = 0;
    answeredQuery.value = '';
    clearAnswer();
    await nextTick();
    query.value = props.seed ?? '';
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

/** 答案卡里的出处：拼成一条最小可用的 DocHit，走宿主的 open 通道（不另开一套路由）。 */
function openAnswerEvidence(payload: {
  path: string;
  line: number;
  title: string;
  heading: string;
  kind: 'md' | 'pdf';
}): void {
  emit('open', {
    path: payload.path,
    title: payload.title,
    heading: payload.heading,
    line: payload.line,
    score: 0,
    excerpt: '',
    kind: payload.kind,
    terms: [],
  });
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
/* 嵌进 检索助手的 tab 容器：占满助手壳的剩余高度，头部由助手壳提供。 */
.dsp-host.dsp-embedded {
  display: flex;
  flex: 1;
  min-height: 0;
  /* 停靠态给的是 height:100%；在助手的 flex 列里改由 flex-grow 决定高度，
     否则 100% 解析到父级高度后会与 tab 栏叠加溢出。 */
  height: auto;
}
/* 头部（.section-head / .section-title / .section-actions / .ghost-btn）在全局
   panel-chrome.css：侧栏各面板共用一套，本组件不再维护 dsp-header/dsp-title 副本。 */
.dsp-query {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--panel-pad-x);
  border-bottom: 1px solid var(--color-border, #d0d3d9);
}
.dsp-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control);
  background: var(--color-bg-card);
  color: var(--color-text);
  font: inherit;
}
/* 检索范围开关：与输入框同一行右端，不占头部也不单起一行。 */
.dsp-pdf-toggle {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.dsp-pdf-toggle input {
  margin: 0;
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
/* 跨域联动动作：行内小按钮，靠右；点击只切到积木 tab，不打开这条文档。 */
.dsp-link {
  margin-left: auto;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-control, 4px);
  background: var(--color-bg-hover);
  color: var(--color-primary, #2563eb);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.dsp-link:hover {
  background: var(--color-primary, #2563eb);
  color: #fff;
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
