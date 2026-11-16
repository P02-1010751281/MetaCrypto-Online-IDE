<template>
  <!-- 工具栏右半边：语言（全局偏好）、代码栏开关、文档（跳路由）、更多（工作区动作）。
       从 EditorToolbar 里整段搬出，标记与行为保持不变。 -->
  <div class="toolbar-section">
    <div class="toolbar-divider" />

    <LocaleToggleButton
      class="toolbar-btn lang-btn"
      @toggle="$emit('toggle-locale')"
    />

    <button
      class="toolbar-btn"
      :class="{ active: codePaneVisible }"
      :aria-pressed="codePaneVisible"
      :title="codePaneVisible ? ui('collapseCodePane') : ui('expandCodePane')"
      @click="$emit('toggle-code-pane')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    </button>

    <div class="toolbar-divider" />

    <button
      class="toolbar-btn"
      :title="ui('docs')"
      @click="$emit('open-docs')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z" />
        <path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z" />
      </svg>
      <span>{{ ui("docs") }}</span>
    </button>

    <WorkspaceMenu
      :open-menu="openMenu"
      :export-format="exportFormat"
      :import-format="importFormat"
      @toggle-menu="$emit('toggle-menu', $event)"
      @update:export-format="$emit('update:export-format', $event)"
      @update:import-format="$emit('update:import-format', $event)"
      @export="$emit('export')"
      @import-file="$emit('import-file', $event)"
      @new-workspace="$emit('new-workspace')"
      @clear="$emit('clear')"
    />
  </div>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';

import LocaleToggleButton from './LocaleToggleButton.vue';
import WorkspaceMenu from './WorkspaceMenu.vue';

defineProps<{
  codePaneVisible: boolean;
  openMenu: string;
  exportFormat: 'json' | 'xml';
  importFormat: 'auto' | 'json' | 'xml';
}>();

defineEmits<{
  'toggle-locale': [];
  'toggle-code-pane': [];
  'toggle-menu': [menu: string];
  'update:export-format': [value: 'json' | 'xml'];
  'update:import-format': [value: 'auto' | 'json' | 'xml'];
  export: [];
  'import-file': [file: File];
  'new-workspace': [];
  clear: [];
  'open-docs': [];
}>();
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  flex-shrink: 0;
}

.toolbar-btn.active {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* 560px 级窄屏：分组内容也允许换行，否则按钮会溢出工具栏右边界。 */
@media (max-width: 560px) {
  .toolbar-section {
    flex-wrap: wrap;
    gap: 6px;
  }

  .toolbar-divider {
    display: none;
  }
}
</style>
