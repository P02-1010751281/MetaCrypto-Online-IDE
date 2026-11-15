<template>
  <section class="run-output" :class="{ 'is-failed': failed }">
    <header class="run-output-head">
      <span class="run-output-title">{{ ui("runOutput") }}</span>
      <span v-if="running" class="run-output-badge">{{
        loadingLabel || ui("runningCode")
      }}</span>
      <button
        class="run-output-btn"
        :title="ui('clearOutput')"
        :disabled="running || !output"
        @click="$emit('clear')"
      >
        {{ ui("clearOutput") }}
      </button>
      <button
        class="run-output-btn"
        :title="ui('closePanel')"
        @click="$emit('close')"
      >
        ✕
      </button>
    </header>
    <!-- 首次装载 Python 运行时时显示；分母未知时退化成不确定进度 -->
    <div
      v-if="loadingLabel"
      class="run-output-progress"
      :class="{ 'is-indeterminate': loadingPercent === null }"
      :title="ui('runPythonLoading')"
      role="progressbar"
      :aria-label="loadingLabel"
      :aria-valuenow="loadingPercent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="run-output-progress-fill"
        :style="loadingPercent === null ? undefined : { width: `${loadingPercent}%` }"
      />
    </div>
    <pre class="run-output-body">{{ output || ui("runOutputEmpty") }}</pre>
  </section>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';

defineProps<{
  output: string;
  running: boolean;
  failed: boolean;
  /** 装载中的文案；空字符串表示没在装载运行时 */
  loadingLabel: string;
  /** 0–99 的确定百分比；null 表示分母未知，显示不确定进度 */
  loadingPercent: number | null;
}>();

defineEmits<{
  clear: [];
  close: [];
}>();
</script>

<style scoped>
.run-output {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  max-height: 40%;
  min-height: 96px;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-bg-subtle, var(--color-bg-card));
}

.run-output-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.run-output-title {
  font-weight: 600;
  color: var(--color-text);
}

.run-output-badge {
  color: var(--color-primary, #3b82f6);
}

/* ---- 运行时装载进度条 ---- */
.run-output-progress {
  position: relative;
  flex: 0 0 auto;
  height: 3px;
  background-color: var(--color-bg-hover, rgba(0, 0, 0, 0.08));
  overflow: hidden;
}

.run-output-progress-fill {
  height: 100%;
  width: 0;
  background-color: var(--color-primary, #3b82f6);
  transition: width 0.15s linear;
}

.run-output-progress.is-indeterminate .run-output-progress-fill {
  width: 35%;
  animation: run-output-indeterminate 1.1s ease-in-out infinite;
}

@keyframes run-output-indeterminate {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(290%);
  }
}

.run-output-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
}

.run-output-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.run-output-btn:hover:not(:disabled) {
  background-color: var(--color-bg-hover, rgba(0, 0, 0, 0.06));
}

.run-output-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 12px;
  overflow: auto;
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.is-failed .run-output-body {
  color: var(--color-danger, #dc2626);
}
</style>
