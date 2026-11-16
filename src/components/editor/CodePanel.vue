<template>
  <div class="view-right" :style="panelStyle">
    <div class="code-head">
      <span class="code-head-icon" aria-hidden="true">{ }</span>
      <span class="code-head-name" :title="activeFileName || ui('code')">
        {{ activeFileName || ui("code") }}
      </span>
      <span v-if="entryBadge" class="code-head-badge">{{ ui("entryFile") }}</span>
      <span class="code-head-lang">{{ languageLabel }}</span>
      <button
        class="code-head-collapse"
        :title="ui('collapseCodePane')"
        :aria-label="ui('collapseCodePane')"
        @click="emit('collapse')"
      >»</button>
    </div>
    <div class="code-toolbar">
      <div class="code-toolbar-left">
        <select
          :value="language"
          class="toolbar-select lang-select"
          @change="onLanguageChange"
        >
          <option
            v-for="(label, value) in LANGUAGE_LABELS"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select>
      </div>
      <button class="toolbar-btn primary" @click="$emit('generate')">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span>{{ ui("generateCode") }}</span>
      </button>
      <button
        class="toolbar-btn run-btn"
        :disabled="runner.running.value"
        :title="ui('runHint')"
        @click="runCode"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{{ runner.running.value ? ui("runningCode") : ui("runCode") }}</span>
      </button>
      <button class="toolbar-btn copy-btn" @click="copyCode">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <span>{{ ui("copyCode") }}</span>
      </button>
    </div>
    <CodePreviewer
      ref="codePreviewer"
      :workspace="workspace"
      :language="language"
      :files="files"
      :entry-file-id="entryFileId"
    />
    <RunOutputPanel
      v-if="runner.outputVisible.value"
      :output="runner.output.value"
      :running="runner.running.value"
      :failed="runner.failed.value"
      :loading-label="runner.loadingLabel.value"
      :loading-percent="runner.loadingPercent.value"
      @clear="runner.clearOutput"
      @close="runner.outputVisible.value = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import type { WorkspaceSvg } from 'blockly/core';
import CodePreviewer from '@/components/CodePreviewer.vue';
import RunOutputPanel from '@/components/editor/RunOutputPanel.vue';
import {
  LANGUAGE_LABELS,
  type CodeLanguage,
} from '@/constants/code-languages';
import { ui } from '@/composables/locale';
import { useCodeRunner } from '@/composables/useCodeRunner';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';

const props = defineProps<{
  workspace: WorkspaceSvg | null;
  language: CodeLanguage;
  files: ProjectFileRecord[];
  entryFileId: string;
  panelStyle: CSSProperties;
  /** 代码栏栏头显示的活动文件名；多文件时用户靠它判断代码属于哪个文件。 */
  activeFileName?: string;
  /** 活动文件是否为入口文件，栏头挂入口徽标。 */
  entryBadge?: boolean;
}>();

const emit = defineEmits<{
  'update:language': [value: CodeLanguage];
  generate: [];
  collapse: [];
}>();

const codePreviewer = ref<InstanceType<typeof CodePreviewer> | null>(null);
const runner = useCodeRunner();

const languageLabel = computed(() => LANGUAGE_LABELS[props.language] ?? props.language);

function onLanguageChange(event: Event): void {
  emit(
    'update:language',
    (event.target as HTMLInputElement).value as CodeLanguage,
  );
}

function generateCode(): void {
  codePreviewer.value?.generateCode();
}

function clearCode(): void {
  codePreviewer.value?.clearCode();
}

/** 运行当前预览里的代码；预览为空时先按当前工作区生成一次，避免点了没反应。 */
async function runCode(): Promise<void> {
  if (!codePreviewer.value?.hasRunnableCode) generateCode();
  if (!codePreviewer.value?.hasRunnableCode) {
    runner.showHint(ui('runNoCode'));
    return;
  }
  const code = codePreviewer.value?.code as string | undefined;
  if (!code) return;
  await runner.run(code, props.language);
}

const copyCode = async (): Promise<void> => {
  const code = codePreviewer.value?.code as string | undefined;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch (err) {
    console.error(ui('copyFailed'), err);
  }
};

defineExpose({
  codePreviewer,
  generateCode,
  clearCode,
  runCode,
});
</script>

<style scoped src="./editor-toolbar-button.css"></style>

<style scoped>
/* ---- 右侧代码区 ---- */
.view-right {
  width: 380px;
  min-width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-card);
}

/* ---- 栏头：文件身份 ---- */
.code-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--editor-bar-h);
  padding: 0 var(--bar-pad-x);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-hover);
  font-size: 12px;
  flex-shrink: 0;
  min-width: 0;
}

.code-head-icon {
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  flex-shrink: 0;
}

.code-head-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-family-mono);
  color: var(--color-text);
}

.code-head-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
}

.code-head-collapse {
  margin-left: auto;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
}
.code-head-collapse:hover {
  opacity: 1;
}
.code-head-lang {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.code-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: 8px;
  overflow: hidden;
}

.code-toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 基础外观（.toolbar-btn / svg / hover）来自共用样式，见文件末尾的 scoped src。 */
.toolbar-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.toolbar-btn.primary:hover {
  opacity: 0.9;
}

.toolbar-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.toolbar-btn:disabled:hover {
  background: var(--color-bg-card);
  border-color: var(--color-border);
}

.toolbar-select {
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 22px 0 8px;
  font-size: 12px;
  background: var(--color-bg-card)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23909399' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")
    no-repeat right 6px center;
  color: var(--color-text);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  transition: border-color 0.15s;
}

.toolbar-select:focus {
  border-color: var(--color-primary);
}

.copy-btn {
  margin-left: auto;
}

.toolbar-sep {
  color: var(--color-border-hover);
  font-size: 14px;
  flex-shrink: 0;
}

.lang-select {
  min-width: 64px;
}

@media (max-width: 1200px) {
  .view-right {
    width: 100% !important;
    flex: 1;
    min-width: 0;
    min-height: 180px;
    border-left: none;
    border-top: 1px solid var(--color-border);
  }
}

@media (max-width: 560px) {
  .code-toolbar {
    flex-wrap: wrap;
  }

  .copy-btn {
    margin-left: 0;
  }
}
</style>
