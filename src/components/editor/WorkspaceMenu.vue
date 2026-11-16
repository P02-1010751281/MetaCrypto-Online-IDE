<template>
  <!-- 「更多」下拉：工作区文件级动作（导出/导入/新建/清空）。
       独立成组件后，动作组只负责摆放，菜单自己的格式选择与文件输入都在这里。 -->
  <div class="menu-group">
    <button
      class="toolbar-btn"
      :class="{ active: openMenu === MENU }"
      @click.stop="$emit('toggle-menu', MENU)"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="19" r="1" />
      </svg>
      <span>{{ ui("more") }}</span>
    </button>
    <Transition name="dropdown">
      <div v-if="openMenu === MENU" class="dropdown-menu">
        <button class="dropdown-item" @click="$emit('export')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{{ ui("exportWorkspace") }}</span>
          <select
            :value="exportFormat"
            class="inline-select"
            @click.stop
            @change="onExportFormatChange"
          >
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
        </button>
        <button class="dropdown-item" @click.stop="triggerImport">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{{ ui("importWorkspace") }}</span>
          <select
            :value="importFormat"
            class="inline-select"
            @click.stop
            @change="onImportFormatChange"
          >
            <option value="auto">{{ ui("autoDetect") }}</option>
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
        </button>
        <input
          ref="importInputRef"
          type="file"
          :accept="importAccept"
          @change="onImportFile"
          class="sr-only-input"
        />
        <div class="dropdown-divider" />
        <button class="dropdown-item" @click="$emit('new-workspace')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{{ ui("newWorkspace") }}</span>
        </button>
        <div class="dropdown-divider" />
        <button class="dropdown-item danger" @click="$emit('clear')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
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
  'new-workspace': [];
  clear: [];
}>();

const importInputRef = ref<HTMLInputElement | null>(null);

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
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
.menu-group {
  position: relative;
}

.toolbar-btn.active {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 220px;
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

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
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

.dropdown-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.6;
}

.dropdown-item:hover {
  background: var(--color-bg-hover);
}

.dropdown-item:hover svg {
  opacity: 1;
}

.dropdown-item.danger {
  color: #f56c6c;
}

.dropdown-item.danger:hover {
  background: rgba(245, 108, 108, 0.08);
}

.inline-select {
  margin-left: auto;
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
