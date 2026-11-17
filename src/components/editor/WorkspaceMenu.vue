<template>
  <!-- 「更多」下拉：工作区文件级动作（导出/导入/新建/清空）。
       独立成组件后，顶栏动作组只负责摆放，菜单自己的开合、格式选择与键盘行为都在这里。 -->
  <div class="menu-group" @keydown.esc="onEscape">
    <button
      ref="moreBtnRef"
      type="button"
      class="toolbar-btn"
      :class="{ 'is-open': openMenu === MENU }"
      aria-haspopup="menu"
      :aria-expanded="openMenu === MENU"
      @click.stop="$emit('toggle-menu', MENU)"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="19" r="1" />
      </svg>
      <span>{{ ui("more") }}</span>
    </button>
    <Transition name="dropdown">
      <div v-if="openMenu === MENU" class="dropdown-menu" role="menu">
        <!-- 格式选择器与动作按钮平级：<select> 是交互内容，不能嵌在 <button> 里。 -->
        <div class="dropdown-row">
          <button type="button" class="dropdown-action" @click="$emit('export')">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{{ ui("exportWorkspace") }}</span>
          </button>
          <select
            :value="exportFormat"
            class="inline-select"
            :aria-label="ui('exportFormatLabel')"
            @click.stop
            @change="onExportFormatChange"
          >
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
        </div>

        <div class="dropdown-row">
          <button type="button" class="dropdown-action" @click.stop="triggerImport">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{{ ui("importWorkspace") }}</span>
          </button>
          <select
            :value="importFormat"
            class="inline-select"
            :aria-label="ui('importFormatLabel')"
            @click.stop
            @change="onImportFormatChange"
          >
            <option value="auto">{{ ui("autoDetect") }}</option>
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
        </div>

        <input
          ref="importInputRef"
          type="file"
          :accept="importAccept"
          class="sr-only-input"
          @change="onImportFile"
        />

        <!-- A/B 线入口：与「导入工作区」并列，不是同一条路径——导入的是既有工作区文件，
             这一项是从代码/文档反解析出新工作区。 -->
        <button type="button" class="dropdown-action" @click="$emit('code-to-workspace')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>{{ ui("codeToWorkspaceAction") }}</span>
        </button>

        <div class="dropdown-divider" />
        <button type="button" class="dropdown-action" @click="$emit('new-workspace')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{{ ui("newWorkspace") }}</span>
        </button>

        <div class="dropdown-divider" />
        <button type="button" class="dropdown-action danger" @click="$emit('clear')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path
              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            />
          </svg>
          <span>{{ ui("clearWorkspace") }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { ui } from '@/composables/locale';

/** 菜单标识，父组件按这个值判断当前展开的是哪一个菜单。 */
const MENU = 'workspace';

const props = defineProps<{
  openMenu: string;
  exportFormat: 'json' | 'xml';
  importFormat: 'auto' | 'json' | 'xml';
}>();

const emit = defineEmits<{
  'toggle-menu': [menu: string];
  'update:export-format': [value: 'json' | 'xml'];
  'update:import-format': [value: 'auto' | 'json' | 'xml'];
  export: [];
  'import-file': [file: File];
  'code-to-workspace': [];
  'new-workspace': [];
  clear: [];
}>();

const importInputRef = ref<HTMLInputElement | null>(null);
const moreBtnRef = ref<HTMLElement | null>(null);

const importAccept = computed(() =>
  props.importFormat === 'json'
    ? '.json'
    : props.importFormat === 'xml'
      ? '.xml'
      : '.xml,.json',
);

function onExportFormatChange(event: Event): void {
  emit(
    'update:export-format',
    (event.target as HTMLInputElement).value as 'json' | 'xml',
  );
}

function onImportFormatChange(event: Event): void {
  emit(
    'update:import-format',
    (event.target as HTMLInputElement).value as 'auto' | 'json' | 'xml',
  );
}

function triggerImport(): void {
  importInputRef.value?.click();
}

function onImportFile(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) emit('import-file', file);
  target.value = '';
}

/** Esc 关闭菜单并把焦点还给触发按钮（展开后焦点可能停在任意一项上）。 */
function onEscape(): void {
  if (props.openMenu !== MENU) return;
  emit('toggle-menu', MENU);
  moreBtnRef.value?.focus();
}
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
.menu-group {
  position: relative;
}

/* 菜单展开态是临时状态；常开的视图开关在顶栏动作组里另有 is-on，改一个不会带走另一个。 */
.toolbar-btn.is-open {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 240px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
  padding: 6px;
  z-index: 300;
  margin-top: 2px;
}

.dropdown-enter-active {
  transition: all 0.15s ease-out;
}

.dropdown-leave-active {
  transition: all 0.1s ease-in;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.dropdown-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dropdown-action {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.dropdown-action svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.6;
}

.dropdown-action:hover {
  background: var(--color-bg-hover);
}

.dropdown-action:hover svg {
  opacity: 1;
}

.dropdown-action.danger {
  color: #f56c6c;
}

.dropdown-action.danger:hover {
  background: rgba(245, 108, 108, 0.08);
}

.inline-select {
  height: 26px;
  min-width: 60px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 20px 0 6px;
  font-size: 11px;
  background: var(--color-bg-card)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23909399' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")
    no-repeat right 5px center;
  color: var(--color-text);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  transition: border-color 0.12s;
  flex-shrink: 0;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.dropdown-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}
</style>
