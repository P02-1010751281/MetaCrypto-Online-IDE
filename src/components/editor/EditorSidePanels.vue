<template>
  <!-- 左栏互斥面板链：同一时刻只渲染一个，与 activity bar 的选中项一一对应。
       从 App.vue 抽出来是为了两件事：App 保持 ≤500 行；新增 A 线面板只动这里，
       不必再往装配层塞第 6 个 import 与 8 行 slot 分支。 -->
  <ProjectPanel
    v-if="activePanel === 'projects'"
    :current-id="currentProjectId"
    :overlay="narrow"
    @close="emit('close')"
    @renamed="(id, name) => emit('project-renamed', id, name)"
  />
  <CryptoFunctionPanel
    v-else-if="activePanel === 'functions'"
    :visible="true"
    :workspace="workspace"
    :docked="!narrow"
    @close="emit('close')"
  />
  <AssistantPanel
    v-else-if="activePanel === 'assistant'"
    :visible="true"
    :workspace="workspace"
    :docked="!narrow"
    @close="emit('close')"
    @open="(hit) => emit('open-doc-hit', hit)"
    @browse-all="(query) => emit('browse-all-docs', query)"
  />
  <IntakePanel
    v-else-if="activePanel === 'intake'"
    :visible="true"
    :docked="!narrow"
    @close="emit('close')"
    @route-code="(payload) => emit('intake-route', { kind: 'code', ...payload })"
    @route-doc="(payload) => emit('intake-route', { kind: 'doc', source: '', ...payload })"
  />
  <CodeToWorkspaceDialog
    v-else-if="activePanel === 'code'"
    :visible="true"
    :current-block-count="blockCount"
    :docked="!narrow"
    :intake="intake"
    @close="emit('close')"
    @apply="(state) => emit('apply-workspace', state)"
  />
  <StandardsToWorkspacePanel
    v-else-if="activePanel === 'standards'"
    :visible="true"
    :docked="!narrow"
    @close="emit('close')"
    @open-source="(payload) => emit('open-source', payload)"
  />
</template>

<script setup lang="ts">
import * as Blockly from 'blockly/core';
import { defineAsyncComponent } from 'vue';

import AssistantPanel from '@/components/ai-helper/AssistantPanel.vue';
import CodeToWorkspaceDialog from '@/components/ai-helper/CodeToWorkspaceDialog.vue';
import IntakePanel from '@/components/ai-helper/IntakePanel.vue';
// A 线只读面板按需加载：它自带裁决数据加载器，且只有点第 6 个图标时才用得到；
// 静态 import 会把面板与 52 KB 索引一起塞进入口 chunk（实测顶破 64 KB 预算）。
const StandardsToWorkspacePanel = defineAsyncComponent(
  () => import('@/components/ai-helper/StandardsToWorkspacePanel.vue'),
);
import CryptoFunctionPanel from '@/components/CryptoFunctionPanel.vue';
import ProjectPanel from '@/components/editor/ProjectPanel.vue';
import type { DocHit } from '@/services/ai-helper/doc-search';
import type { SerializedWorkspace } from '@/services/ai-helper/reverse';
import type { EditorPanel } from './useEditorPanels';

defineProps<{
  activePanel: EditorPanel;
  narrow: boolean;
  currentProjectId: number | null;
  workspace: Blockly.WorkspaceSvg | null;
  blockCount: number;
  /** 单入口路由过来的代码正文：非空时 B 线面板预填它。 */
  intake: { source: string; name: string } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'project-renamed', id: number, name: string): void;
  (e: 'open-doc-hit', hit: DocHit): void;
  (e: 'browse-all-docs', query: string): void;
  (e: 'apply-workspace', state: SerializedWorkspace): void;
  (e: 'open-source', payload: { doc: string; line: number }): void;
  (e: 'intake-route', payload: { kind: 'doc' | 'code'; source: string; name: string }): void;
}>();
</script>
