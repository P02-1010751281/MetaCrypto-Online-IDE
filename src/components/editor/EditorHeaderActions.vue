<template>
  <!-- 编辑器顶栏右侧的应用级动作组：语言（全局偏好）、文档（跳路由）、更多（工作区动作）、
       代码栏开关。与文档动作（保存/自动保存）分行，语义各归一层。 -->
  <div class="header-actions">
    <LocaleToggleButton class="toolbar-btn" @toggle="$emit('toggle-locale')" />

    <div class="actions-divider" />

    <button
      type="button"
      class="toolbar-btn"
      :title="ui('docs')"
      :aria-label="ui('docs')"
      @click="$emit('open-docs')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
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

    <div class="actions-divider" />

    <!-- 左栏开关：与右侧的代码栏开关并排，两颗成对——左栏在画面左边，所以放在前面。
         收起后不留在侧栏里的按钮（侧栏整个消失），重新展开的入口始终在顶栏，不会
         出现「点了以后找不到怎么开回来」。 -->
    <button
      type="button"
      class="toolbar-btn sidebar-toggle"
      :class="{ 'is-on': sidebarVisible }"
      :aria-pressed="sidebarVisible"
      :aria-label="sidebarLabel"
      :title="sidebarLabel"
      @click="$emit('toggle-sidebar')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
      </svg>
    </button>

    <button
      type="button"
      class="toolbar-btn"
      :class="{ 'is-on': codePaneVisible }"
      :aria-pressed="codePaneVisible"
      :aria-label="paneLabel"
      :title="paneLabel"
      @click="$emit('toggle-code-pane')"
    >
      <!-- 面板图标：右侧那一块是面板本体，与「函数」「生成」共用箭头图形的旧写法已拆开。 -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="15" y1="4" x2="15" y2="20" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { ui } from '@/composables/locale';

import LocaleToggleButton from './LocaleToggleButton.vue';
import WorkspaceMenu from './WorkspaceMenu.vue';

const props = defineProps<{
  codePaneVisible: boolean;
  sidebarVisible: boolean;
  openMenu: string;
  exportFormat: 'json' | 'xml';
  importFormat: 'auto' | 'json' | 'xml';
}>();

defineEmits<{
  'toggle-locale': [];
  'toggle-code-pane': [];
  'toggle-sidebar': [];
  'toggle-menu': [menu: string];
  'update:export-format': [value: 'json' | 'xml'];
  'update:import-format': [value: 'auto' | 'json' | 'xml'];
  export: [];
  'import-file': [file: File];
  'new-workspace': [];
  clear: [];
  'open-docs': [];
}>();

const paneLabel = computed(() =>
  props.codePaneVisible ? ui('collapseCodePane') : ui('expandCodePane'),
);
const sidebarLabel = computed(() =>
  props.sidebarVisible ? ui('sidebarCollapse') : ui('sidebarExpand'),
);
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 8px;
  flex-shrink: 0;
}

.actions-divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* 开关的「开」用浅底表达，不再用主色边框抢走真正的主动作。 */
.toolbar-btn.is-on {
  background: var(--color-bg-hover);
  border-color: var(--color-border-hover);
  color: var(--color-text);
}

/* 窄屏没有侧栏可收：侧栏已折成顶部横条，而横条里的活动条是唯一的面板入口，
   收掉它等于把所有面板入口一起藏了（实测 5 个活动条 → 0）。这颗开关只在宽屏有意义。 */
@media (max-width: 1200px) {
  .sidebar-toggle {
    display: none;
  }
}

/* 560px 以下动作组允许换行，避免溢出顶栏右边界。 */
@media (max-width: 560px) {
  .header-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .actions-divider {
    display: none;
  }
}
</style>
