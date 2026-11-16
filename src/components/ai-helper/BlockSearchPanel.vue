<template>
  <div v-if="visible" :class="shellClass" @click.self="docked || embedded ? undefined : emit('close')">
    <div class="bsp">
      <!-- 头部只有「标题 + 图标动作」，样式取全局 panel-chrome.css 的一套。
           嵌进 AI 助手（tab 容器）时头部由助手壳提供，这里让位。 -->
      <div v-if="!embedded" class="section-head section-head--divided">
        <span class="section-title">{{ t('CRYPTO_BLOCK_SEARCH_TITLE', '查块') }}</span>
        <div class="section-actions">
          <button class="ghost-btn" :title="t('CRYPTO_CLOSE', '关闭')" :aria-label="t('CRYPTO_CLOSE', '关闭')" @click="emit('close')">×</button>
        </div>
      </div>

      <div class="bsp-query">
        <input
          ref="inputEl"
          v-model="query"
          class="bsp-input"
          type="text"
          :placeholder="t('CRYPTO_BLOCK_SEARCH_PLACEHOLDER', '描述要做的事，例如「16 字节密钥算 MAC」')"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="pickSelected"
          @keydown.esc.prevent="emit('close')"
        />
      </div>

      <!-- 结构化筛选默认折叠：绝大多数查询一句话就够，两个下拉常驻会把输入框挤窄。 -->
      <details class="bsp-filters" :open="hasFilter">
        <summary class="bsp-filters-summary">
          {{ t('CRYPTO_BLOCK_SEARCH_FILTERS', '筛选') }}
          <span v-if="hasFilter" class="bsp-filters-tag">{{ filterSummary }}</span>
        </summary>
        <div class="bsp-filter-row">
          <select v-model="inType" class="bsp-select" :aria-label="t('CRYPTO_BLOCK_SEARCH_IN', '输入类型')">
            <option value="">{{ t('CRYPTO_BLOCK_SEARCH_ANY_IN', '输入不限') }}</option>
            <option v-for="type in TYPE_NAMES" :key="`in-${type}`" :value="type">{{ type }}</option>
          </select>
          <select v-model="outType" class="bsp-select" :aria-label="t('CRYPTO_BLOCK_SEARCH_OUT', '输出类型')">
            <option value="">{{ t('CRYPTO_BLOCK_SEARCH_ANY_OUT', '输出不限') }}</option>
            <option v-for="type in TYPE_NAMES" :key="`out-${type}`" :value="type">{{ type }}</option>
          </select>
        </div>
      </details>

      <p v-if="!query.trim() && !inType && !outType" class="bsp-hint">
        {{ t('CRYPTO_BLOCK_SEARCH_HINT', '写一句要做的事，或只选输入/输出类型做结构化筛选。') }}
      </p>
      <p v-else-if="!hits.length" class="bsp-hint">
        {{ t('CRYPTO_BLOCK_SEARCH_EMPTY', '没有匹配的块。换个说法，或去掉输入/输出限制。') }}
      </p>
      <ul v-else class="bsp-results">
        <li
          v-for="(hit, index) in hits"
          :key="hit.blockType"
          :class="['bsp-item', { 'bsp-item-active': index === active }]"
          @mouseenter="active = index"
          @click="insert(hit.blockType)"
        >
          <div class="bsp-item-head">
            <span class="bsp-item-label">{{ labelOf(hit) }}</span>
            <code class="bsp-item-type">{{ hit.blockType }}</code>
            <!-- 跨域联动：反查「文档里怎么说这个块」。积木侧不预判有没有文档页——
                 这类块多是共享数学原语，文档里本来就没有单独页面，空结果也是答案。 -->
            <button
              type="button"
              class="bsp-link"
              :title="ui('linkToDocs')"
              @click.stop="emit('cross-search', blockToDocQuery(hit))"
            >{{ ui('linkToDocs') }}</button>
          </div>
          <div class="bsp-item-meta">
            <span v-for="type in hit.outputCheck ?? []" :key="`out-${type}`" class="bsp-tag bsp-tag-out">→ {{ type }}</span>
            <span v-for="reason in hit.matched.slice(0, 2)" :key="reason.evidence" class="bsp-reason">{{ reason.evidence }}</span>
          </div>
        </li>
      </ul>

      <p class="bsp-foot">
        {{ t('CRYPTO_BLOCK_SEARCH_FOOT', '↑↓ 选择，Enter 插入，Esc 关闭。') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Blockly from 'blockly/core';
import { computed, nextTick, ref, watch } from 'vue';

// `?raw` + 手工解析：索引是构建期产物（288 KB），走 JSON 模块会让 vue-tsc 推断一个巨大的字面量类型。
import rawIndex from '@/services/ai-helper/block-index.json?raw';
import { ui } from '@/composables/locale';
import { search } from '@/services/ai-helper/block-search';
import type { BlockIndex, SearchHit } from '@/services/ai-helper/block-search';
import { blockToDocQuery } from '@/services/ai-helper/linkage';

const props = defineProps<{
  visible: boolean;
  workspace: Blockly.WorkspaceSvg | null;
  /** docked：停靠进某一栏（不遮挡画布）；缺省是全屏遮罩。 */
  docked?: boolean;
  /** embedded：由宿主（AI 助手）提供头部与 tab，本组件只保留查询行与结果。 */
  embedded?: boolean;
  /** 宿主带过来的初始查询词：只在 `visible` 翻成 true 的那一次生效（跨域联动用）。 */
  seed?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 跨域联动：把派生好的文档查询词交给宿主，由宿主切到文档 tab 并灌进输入框。 */
  (e: 'cross-search', query: string): void;
}>();

/** 外层的三种形态：悬浮遮罩 / 停靠进栏 / 嵌进助手的 tab 容器（样式同停靠）。 */
const shellClass = computed(() => {
  if (props.embedded || props.docked) {
    return props.embedded ? 'bsp bsp-docked bsp-embedded' : 'bsp bsp-docked';
  }
  return 'bsp-overlay';
});

const INDEX = JSON.parse(rawIndex) as BlockIndex;

/** 槽位类型词表（与 `BLOCK-IO-CONTRACT.json` 里实际出现的 check 一致）。 */
const TYPE_NAMES = ['Bytes', 'IntList', 'Bits', 'Number', 'String', 'Boolean', 'SBox'];

const msg = Blockly.Msg as Record<string, string>;
function t(key: string, fallback: string): string {
  return msg[key] || fallback;
}

const query = ref('');
const inType = ref('');
const outType = ref('');
const active = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

const hasFilter = computed(() => Boolean(inType.value || outType.value));
const filterSummary = computed(() => {
  const parts: string[] = [];
  if (inType.value) parts.push(`in:${inType.value}`);
  if (outType.value) parts.push(`out:${outType.value}`);
  return parts.join(' ');
});

const hits = computed<SearchHit[]>(() => {
  const text = query.value.trim();
  if (!text && !inType.value && !outType.value) return [];
  return search(INDEX, {
    inTypes: inType.value ? [inType.value] : [],
    outTypes: outType.value ? [outType.value] : [],
    text: text || null,
    limit: 12,
  });
});

/** 结果行标题：中文标签优先，没有中文标签时退回英文标签。 */
function labelOf(hit: SearchHit): string {
  const zh = hit.labels.zh.filter(Boolean).join(' ');
  if (zh) return zh;
  const en = hit.labels.en.filter(Boolean).join(' ');
  return en || hit.blockType;
}

function move(step: number): void {
  if (!hits.value.length) return;
  active.value = (active.value + step + hits.value.length) % hits.value.length;
}

function pickSelected(): void {
  const hit = hits.value[active.value];
  if (hit) insert(hit.blockType);
}

let insertSeq = 0;
function insert(type: string): void {
  const ws = props.workspace;
  if (!ws) return;
  const block = ws.newBlock(type);
  block.initSvg();
  block.render();
  const metrics = ws.getMetrics();
  // 连点插入时错开，避免叠成一块（与模板面板的 40px 起点一致）。
  block.moveBy(metrics.viewLeft + 40 + (insertSeq % 6) * 24, metrics.viewTop + 40 + (insertSeq % 6) * 24);
  insertSeq += 1;
  block.select();
  if (!props.docked) emit('close');
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    // 先清空再灌种子：种子可能与上一次的查询词相同（反复点同一处联动），
    // 直接赋值不会让 hits 计算属性重算。
    query.value = '';
    active.value = 0;
    await nextTick();
    query.value = props.seed ?? '';
    await nextTick();
    inputEl.value?.focus();
  },
);

watch(hits, () => {
  active.value = 0;
});
</script>

<style scoped>
.bsp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.bsp {
  display: flex;
  flex-direction: column;
  width: min(560px, 92vw);
  max-height: 68vh;
  overflow: hidden;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  font-size: 13px;
}
.bsp-docked {
  width: 100%;
  max-height: none;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* 停靠态外层是「栏容器」，内层 .bsp 才是有边框的面板。内层默认是悬浮宽度
 * min(560px, 92vw)，不显式下传就会被 355px 宽的栏 overflow 裁掉右半边
 * （表现为占位文案、输入框、结果行被切）。 */
.bsp-docked > .bsp {
  width: 100%;
  height: 100%;
  max-height: none;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* 嵌进 AI 助手的 tab 容器：占满助手壳的剩余高度，头部由助手壳提供。 */
.bsp-embedded {
  display: flex;
  flex: 1;
  min-height: 0;
  /* 停靠态给的是 height:100%；在助手的 flex 列里改由 flex-grow 决定高度，
     否则 100% 解析到父级高度后会与 tab 栏叠加溢出。 */
  height: auto;
}
/* 头部（.section-head / .section-title / .section-actions / .ghost-btn）在全局
   panel-chrome.css：侧栏各面板共用一套，本组件不再维护 bsp-header/bsp-title 副本。 */
.bsp-query {
  display: flex;
  gap: 6px;
  padding: 6px var(--panel-pad-x);
  border-bottom: 1px solid var(--color-border, #d0d3d9);
}
.bsp-input {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control);
  background: var(--color-bg-card);
  color: inherit;
  font: inherit;
}
.bsp-filters {
  padding: 0 var(--panel-pad-x) 6px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
}
.bsp-filters-summary {
  cursor: pointer;
  padding: 4px 0;
  font-size: 11px;
  color: var(--color-text-secondary);
  user-select: none;
}
.bsp-filters-tag {
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--color-bg-hover);
  font-family: var(--font-family-mono);
}
.bsp-filter-row {
  display: flex;
  gap: 6px;
  padding-top: 4px;
}
.bsp-select {
  max-width: 108px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control);
  background: var(--color-bg-card);
  color: inherit;
  font: inherit;
}
.bsp-hint {
  margin: 0;
  padding: 14px 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.bsp-results {
  flex: 1;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  list-style: none;
}
.bsp-item {
  padding: 6px 12px;
  border-left: 3px solid transparent;
  cursor: pointer;
}
.bsp-item-active {
  border-left-color: var(--color-primary);
  background: var(--color-bg-hover);
}
.bsp-item-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.bsp-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bsp-item-type {
  color: var(--color-text-secondary);
  font-size: 11px;
}
/* 跨域联动动作：行内小按钮，靠右；点击只切到文档 tab，不插入这个块。 */
.bsp-link {
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
.bsp-link:hover {
  background: var(--color-primary, #2563eb);
  color: #fff;
}
.bsp-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: 11px;
}
.bsp-tag-out {
  color: var(--color-success);
}
.bsp-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.bsp-foot {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border, #d0d3d9);
  color: var(--color-text-secondary);
  font-size: 11px;
}
</style>
