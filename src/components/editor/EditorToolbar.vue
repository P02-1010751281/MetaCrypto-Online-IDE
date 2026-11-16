<template>
  <!-- 文档级动作栏：保存、自动保存与保存状态。应用级动作（语言/文档/更多/代码栏开关）
       已移到顶栏的 EditorHeaderActions，这一行只留「对当前项目做的事」。 -->
  <div class="toolbar">
    <button
      class="toolbar-btn"
      :disabled="saving"
      :title="ui('save')"
      @click="$emit('save')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path
          d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
        />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
      <span>{{ ui("save") }}</span>
    </button>
    <label class="auto-toggle">
      <input
        type="checkbox"
        :checked="autoSaveEnabled"
        @change="onAutoSaveChange"
      />
      <span>{{ ui("autoSave") }}</span>
    </label>
    <span v-if="saveStatus === 'saved' && lastSaveTime" class="save-status ok"
      >{{ ui("saved") }} {{ lastSaveTime }}</span
    >
    <span v-if="saveStatus === 'unsaved'" class="save-status warn">{{
      ui("unsaved")
    }}</span>
    <span v-if="saveStatus === 'error'" class="save-status error">{{
      ui("saveError") || ""
    }}</span>
  </div>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';

defineProps<{
  saving: boolean;
  saveStatus: 'saved' | 'unsaved' | 'error';
  lastSaveTime: string;
  autoSaveEnabled: boolean;
}>();

const emit = defineEmits<{
  save: [];
  'update:auto-save-enabled': [value: boolean];
}>();

function onAutoSaveChange(event: Event): void {
  emit('update:auto-save-enabled', (event.target as HTMLInputElement).checked);
}
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
/* ---- 文档动作栏 ---- */
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-height: var(--editor-bar-h);
  padding: 2px var(--bar-pad-x);
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: 8px 12px;
  overflow: visible;
}

.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.auto-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.auto-toggle input {
  margin: 0;
}

.save-status {
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.save-status.ok {
  color: var(--color-success, #67c23a);
}

.save-status.warn {
  color: var(--color-warning, #e6a23c);
}

.save-status.error {
  color: var(--color-danger, #f56c6c);
}

/* 560px 级窄屏：允许换行，否则按钮会溢出工具栏右边界。 */
@media (max-width: 560px) {
  .toolbar {
    gap: 6px 8px;
    padding: 6px 8px;
  }
}
</style>
