<template>
  <div
    v-if="visible"
    :class="docked ? 'aip-host aip-docked' : 'aip-overlay'"
    @click.self="docked ? undefined : emit('close')"
  >
    <div class="aip">
      <!-- 助手壳只提供「标题 + 关闭 + tab」，面板体由 DocSearchPanel / BlockSearchPanel 各管一段：
           两个检索内核的打分、索引加载与结果渲染都不搬进这里，壳不重复实现检索。 -->
      <div class="section-head section-head--divided">
        <span class="section-title">{{ ui('assistant') }}</span>
        <div class="section-actions">
          <button
            class="ghost-btn"
            :title="ui('docSearchClose')"
            :aria-label="ui('docSearchClose')"
            @click="emit('close')"
          >×</button>
        </div>
      </div>

      <div class="aip-tabs" role="tablist" :aria-label="ui('assistant')">
        <button
          v-for="item in TABS"
          :key="item.id"
          type="button"
          role="tab"
          class="aip-tab"
          :class="{ 'aip-tab-active': activeTab === item.id }"
          :aria-selected="activeTab === item.id"
          @click="selectTab(item.id)"
        >{{ ui(item.labelKey) }}</button>
      </div>

      <div class="aip-body">
        <DocSearchPanel
          :visible="activeTab === 'docs'"
          :docked="true"
          :embedded="true"
          :seed="docSeed"
          :block-vocabulary="blockVocabulary"
          @close="emit('close')"
          @open="(hit) => emit('open', hit)"
          @browse-all="(query) => emit('browse-all', query)"
          @cross-search="onDocToBlocks"
        />
        <BlockSearchPanel
          :visible="activeTab === 'blocks'"
          :docked="true"
          :embedded="true"
          :workspace="workspace"
          :seed="blockSeed"
          @close="emit('close')"
          @cross-search="onBlocksToDocs"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 问答助手壳：把「查文档」与「查积木」合成一个面板，并做两个方向的结果联动。
 *
 * 为什么是一个壳而不是两个面板并排：两个内核共用一个入口后，用户一次提问可以先看文档、
 * 再一键看能搭的块（或反过来），不用在 activity bar 上换图标重打一遍查询。
 *
 * 联动词由命中所在的子面板派生（`services/ai-helper/linkage.ts`），壳只负责
 * 「把派生词当种子塞给另一个 tab」：派生规则与索引都在子面板侧，壳不认识 BM25 也不认识块契约。
 */
import * as Blockly from 'blockly/core';
import { ref } from 'vue';

import { ui } from '@/composables/locale';
import rawBlockIndex from '@/services/ai-helper/block-index.json?raw';
import { blockVocabulary as buildBlockVocabulary } from '@/services/ai-helper/linkage';
import type { DocHit } from '@/services/ai-helper/doc-search';
import BlockSearchPanel from './BlockSearchPanel.vue';
import DocSearchPanel from './DocSearchPanel.vue';

type AssistantTab = 'docs' | 'blocks';

const TABS: Array<{ id: AssistantTab; labelKey: string }> = [
  { id: 'docs', labelKey: 'docSearch' },
  { id: 'blocks', labelKey: 'blockSearch' },
];

defineProps<{
  visible: boolean;
  /** docked：停靠进某一栏；缺省是全屏遮罩。 */
  docked?: boolean;
  workspace: Blockly.WorkspaceSvg | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 文档命中：宿主决定怎么打开（路由到文档页并定位到 line/页码）。 */
  (e: 'open', hit: DocHit): void;
  /** 面板底部的「浏览全部文档」：宿主带 ?q= 进文档中心。 */
  (e: 'browse-all', query: string): void;
}>();

/**
 * 块词表在壳里建一次、下发给文档面板：文档 → 积木的派生要判断「这个词在积木世界里存不存在」，
 * 建在壳里的好处是两个子面板不各自解析一遍 288 KB 的块索引。
 */
const blockVocabulary = buildBlockVocabulary(
  JSON.parse(rawBlockIndex) as { blocks: Array<{ blockType: string; labels: { en: string[]; zh: string[] } }> },
);

const activeTab = ref<AssistantTab>('docs');
/** 联动种子：只在下一次「对面那份面板可见」时生效。 */
const docSeed = ref('');
const blockSeed = ref('');

/** 手点 tab：清空两个种子，回到干净输入（否则会带着上一次联动留下的查询词）。 */
function selectTab(tab: AssistantTab): void {
  docSeed.value = '';
  blockSeed.value = '';
  activeTab.value = tab;
}

function onDocToBlocks(query: string): void {
  blockSeed.value = query;
  activeTab.value = 'blocks';
}

function onBlocksToDocs(query: string): void {
  docSeed.value = query;
  activeTab.value = 'docs';
}
</script>

<style scoped>
.aip-overlay {
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
.aip {
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
.aip-docked {
  width: 100%;
  max-height: none;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* 内层 .aip 默认是悬浮宽度 min(760px, 94vw)，停靠时必须下传栏宽，
   否则内容会被栏的 overflow 裁掉右半边（同 dsp/bsp 的停靠规则）。 */
.aip-docked > .aip {
  width: 100%;
  height: 100%;
  max-height: none;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.aip-host.aip-docked {
  height: 100%;
}
.aip-tabs {
  display: flex;
  gap: 4px;
  padding: 4px var(--panel-pad-x);
  border-bottom: 1px solid var(--color-border, #d0d3d9);
}
.aip-tab {
  padding: 3px 10px;
  border: 0;
  border-radius: var(--radius-control, 4px);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}
.aip-tab-active {
  background: var(--color-bg-hover);
  color: var(--color-text);
  font-weight: 600;
}
.aip-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
</style>
