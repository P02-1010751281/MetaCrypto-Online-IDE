<template>
  <aside class="editor-sidebar">
    <!-- activity bar 贴左满高（VS Code 模型）：图标从顶行开始，
         项目名这类「当前对象」信息留在右侧面板列，不再横跨整个侧栏。 -->
    <nav class="activity-bar" :aria-label="ui('panels')">
    <button
        class="activity-btn"
        :class="{ active: activePanel === 'projects' }"
        :title="ui('projects')"
        :aria-pressed="activePanel === 'projects'"
        @click="$emit('toggle-panel', 'projects')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
      </button>
      <button
        class="activity-btn"
        :class="{ active: activePanel === 'files' }"
        :title="ui('files')"
        :aria-pressed="activePanel === 'files'"
        @click="$emit('toggle-panel', 'files')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="14 3 14 9 20 9" />
        </svg>
      </button>
      <button
        class="activity-btn"
        :class="{ active: activePanel === 'functions' }"
        :title="ui('functionsPanel')"
        :aria-pressed="activePanel === 'functions'"
        @click="$emit('toggle-panel', 'functions')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>
      <!-- 问答助手：查文档 / 查积木两个 tab 共用这一个入口，图标用「放大镜 + 文本行」。 -->
      <button
        class="activity-btn"
        :class="{ active: activePanel === 'assistant' }"
        :title="ui('assistant')"
        :aria-pressed="activePanel === 'assistant'"
        @click="$emit('toggle-panel', 'assistant')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="M14.6 14.6 20 20" />
          <path d="M8 9h5M8 12h3" />
        </svg>
      </button>
      <!-- A/B 线入口（代码 → 工作区）：与另外四个一样是互斥面板，面板体是
           `CodeToWorkspaceDialog` 的停靠形态（由 App 经 slot 传进来）。 -->
      <button
        class="activity-btn"
        :class="{ active: activePanel === 'code' }"
        :title="ui('codeToWorkspaceAction')"
        :aria-label="ui('codeToWorkspaceAction')"
        :aria-pressed="activePanel === 'code'"
        @click="$emit('toggle-panel', 'code')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M3 6h7M3 12h5M3 18h7" />
          <rect x="14" y="3" width="7" height="6" rx="1" />
          <rect x="14" y="15" width="7" height="6" rx="1" />
        </svg>
      </button>
    </nav>

    <div class="sidebar-main">
      <div class="side-panel">
        <section v-if="activePanel === 'files'" class="files-section">
          <div class="section-head">
            <span class="section-title">{{ ui('files') }}</span>
            <button class="ghost-btn" :title="ui('newFile')" @click="$emit('add-file')">＋</button>
          </div>
          <ul class="file-list">
            <li
              v-for="file in files"
              :key="file.fileId"
              class="panel-row file-row"
              :class="{ active: file.fileId === activeFileId }"
              @click="$emit('select-file', file.fileId)"
            >
              <template v-if="editingId === file.fileId">
                <input
                  ref="renameInput"
                  v-model="editingName"
                  class="rename-input"
                  @keydown.enter.prevent="commitRename(file.fileId)"
                  @keydown.esc.prevent="cancelRename"
                  @blur="commitRename(file.fileId)"
                  @click.stop
                />
              </template>
              <template v-else>
                <span class="file-label">
                  <span class="file-name" :title="file.name">{{ file.name }}</span>
                  <span v-if="file.fileId === entryFileId" class="entry-badge">{{ ui('entryFile') }}</span>
                </span>
                <div class="row-actions" @click.stop>
                  <button
                    v-if="file.fileId !== entryFileId"
                    class="row-btn"
                    :title="ui('setEntryFile')"
                    @click="$emit('set-entry', file.fileId)"
                  >◎</button>
                  <button class="row-btn" :title="ui('renameFile')" @click="startRename(file.fileId, file.name)">✎</button>
                  <button
                    class="row-btn danger"
                    :title="pendingDeleteId === file.fileId ? ui('deleteFileConfirm') : ui('deleteFile')"
                    :class="{ confirming: pendingDeleteId === file.fileId }"
                    @click="requestDelete(file.fileId)"
                  >{{ pendingDeleteId === file.fileId ? '!' : '✕' }}</button>
                </div>
              </template>
            </li>
          </ul>
          <p v-if="fileCountHint" class="section-hint">{{ fileCountHint }}</p>
        </section>
        <slot v-else />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';
import { ui } from '@/composables/locale';
import type { EditorPanel } from './useEditorPanels';

const props = defineProps<{
  files: ProjectFileRecord[];
  activeFileId: string;
  entryFileId: string;
  activePanel: EditorPanel;
}>();

const emit = defineEmits<{
  (e: 'select-file', fileId: string): void;
  (e: 'add-file'): void;
  (e: 'rename-file', fileId: string, name: string): void;
  (e: 'delete-file', fileId: string): void;
  (e: 'set-entry', fileId: string): void;
  (e: 'toggle-panel', panel: EditorPanel): void;
}>();

const fileCountHint = computed(() =>
  props.files.length <= 1 ? ui('keepOneFile') : '',
);

const editingId = ref('');
const editingName = ref('');
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
const pendingDeleteId = ref('');
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function startRename(fileId: string, name: string): Promise<void> {
  editingId.value = fileId;
  editingName.value = name;
  await nextTick();
  const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  el?.focus();
  el?.select();
}

function commitRename(fileId: string): void {
  if (editingId.value !== fileId) return;
  const name = editingName.value.trim();
  editingId.value = '';
  if (name) emit('rename-file', fileId, name);
}

function cancelRename(): void {
  editingId.value = '';
}

/** 删除是两级确认：第一次点击进入待确认，3 秒内再点才真正删除。 */
function requestDelete(fileId: string): void {
  if (pendingDeleteId.value === fileId) {
    pendingDeleteId.value = '';
    if (pendingTimer) clearTimeout(pendingTimer);
    emit('delete-file', fileId);
    return;
  }
  pendingDeleteId.value = fileId;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingDeleteId.value = '';
  }, 3000);
}
</script>

<style scoped src="./editor-sidebar.css"></style>
