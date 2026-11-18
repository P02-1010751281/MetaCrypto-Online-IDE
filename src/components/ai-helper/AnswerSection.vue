<template>
  <div class="as">
    <AnswerCard :result="displayResult" :loading="loading" @open="(payload) => emit('open', payload)" />

    <div class="as-bar">
      <label class="as-toggle" :class="{ 'as-toggle-off': !configured }">
        <input type="checkbox" :checked="enabled" @change="onToggle" />
        <span>{{ ui('modelSelectToggle') }}</span>
      </label>
      <button class="as-btn" type="button" @click="settingsOpen = true">{{ ui('modelSettings') }}</button>
      <span class="as-status" :class="{ 'as-status-error': failure }">{{ statusText }}</span>
    </div>

    <p v-if="enabled && note" class="as-note">
      <span class="as-note-tag">{{ ui('modelNote') }}</span>{{ note }}
    </p>
    <p v-else-if="enabled && !configured" class="as-hint">{{ ui('modelConfigureHint') }}</p>

    <ModelSettingsDialog
      :open="settingsOpen"
      :config="config"
      :remembered="remembered"
      @close="settingsOpen = false"
      @save="onSave"
      @clear="onClear"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 答案区：检索答案卡 + 「让模型选句」开关 + 本次调用的 token/耗时/失败原因。
 *
 * 三条界面纪律：
 *   1. 默认关。不勾就不发任何外部请求，用户的 key 也不用填。
 *   2. 模型只能**缩小/重排**同一段里的句子。卡片上的出处始终是那一段的 `path:line`，
 *      所以「选了哪几句」不会让出处指错文件（候选只从最佳段落摊出来，见 composable）。
 *   3. 失败不吞答案：检索结果照常显示，只多一行结构化原因（超时/额度/格式…）。
 */
import { computed, ref, watch } from 'vue';

import { ui, uiFormat, uiLocaleRef } from '@/composables/locale';
import { modelFailureTexts } from '@/composables/model-failure-text';
import { useModelAnswer } from '@/composables/useModelAnswer';
import type { AnswerResult } from '@/services/ai-helper/doc-answer';
import type { ModelFailure } from '@/composables/useModelAnswer';
import type { ModelConfig } from '@/services/ai-helper/model/config';

import AnswerCard from './AnswerCard.vue';
import ModelSettingsDialog from './ModelSettingsDialog.vue';

const props = defineProps<{
  result: AnswerResult | null;
  loading: boolean;
  /** 产出当前答案的那个查询词（不是输入框实时文本）：作为模型提示词里的「问题」。 */
  question: string;
}>();

const emit = defineEmits<{
  (e: 'open', payload: { path: string; line: number; title: string; heading: string; kind: 'md' | 'pdf' }): void;
}>();

const {
  config,
  remembered,
  configured,
  enabled,
  running,
  usage,
  elapsedMs,
  note,
  failure,
  selected,
  save,
  clear,
  select,
  resetOutcome,
} = useModelAnswer();

const settingsOpen = ref(false);
/** 并发守卫：用户连点两次搜索时，只让最后一次的结果上屏。 */
let sequence = 0;

const displayResult = computed<AnswerResult | null>(() => {
  const base = props.result;
  if (!base?.best) return base;
  const chosen = selected.value;
  if (!enabled.value || !chosen || chosen.length === 0) return base;
  return {
    ...base,
    best: { ...base.best, sentences: chosen.map((item) => ({ text: item.text, line: item.line })) },
  };
});

const statusText = computed(() => {
  if (!enabled.value) return '';
  if (!configured.value) return ui('modelNotConfigured');
  if (running.value) return ui('modelRunning');
  if (failure.value) return `${ui('modelErrorPrefix')}${failureText(failure.value)}`;
  if (selected.value && selected.value.length === 0) return ui('modelDeclined');
  if (selected.value?.length) {
    const tokens = usage.value ? uiFormat('modelUsage', { total: usage.value.totalTokens, ms: elapsedMs.value ?? 0 }) : '';
    return [uiFormat('modelSelected', { n: selected.value.length }), tokens].filter(Boolean).join(' · ');
  }
  return '';
});

/** 失败原因按稳定 code 翻成人话；未知 code 原样给出，便于反馈问题而不是「失败了」。 */
function failureText(value: ModelFailure): string {
  const parts = modelFailureTexts(value, {
    text: ui,
    status: (status) => uiFormat('modelErrorStatus', { status }),
  });
  // 多条越界用当前语言的分号连起来：中英标点不同，不在纯函数里猜。
  return parts.join(uiLocaleRef.value === 'en' ? '; ' : '；');
}

function onToggle(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  enabled.value = checked;
  if (checked && !configured.value) settingsOpen.value = true;
  if (!checked) resetOutcome();
}

function onSave(payload: { config: ModelConfig; remember: boolean }): void {
  // 对话框已用同一个 checkConfig 校验过，这里只负责落存储并关窗。
  save(payload.config, payload.remember);
  settingsOpen.value = false;
  if (config.value && !enabled.value) enabled.value = true;
}

function onClear(): void {
  clear();
  enabled.value = false;
  settingsOpen.value = false;
}

/**
 * 每次「检索答案变了」「开关被打开」或「刚保存了配置」就最多调用一次。
 *
 * 依赖里**没有** `question`：查询词随每次按键就变，答案是 120 ms 防抖后才更新，
 * 盯 question 会先用旧答案触发一次、再按新答案触发一次——一次提问两次计费
 * （2026-11-18 真浏览器验收实测：预期 3 次请求，实际 4 次）。问题只作为调用参数，
 * 由宿主传入「产出这份答案的那个词」，见 DocSearchPanel 的 answeredQuery。
 *
 * `config` 必须在依赖里：首次使用的真实顺序是先开开关（没配置，这次只能空转）再填配置，
 * 只盯 `enabled` 的话「保存」不会触发任何调用，界面停在空状态、用户以为坏了。
 * 失败/拒答都不重试（§3.4）：要再来一次，用户重新提问即可。
 */
watch(
  () => [props.result, enabled.value, config.value] as const,
  async ([result, , on]) => {
    const question = props.question;
    const token = ++sequence;
    resetOutcome();
    if (!on || !result?.best || !question.trim()) return;
    const outcome = await select(result, question);
    if (token !== sequence) return;
    // 模型选了但结果为 0 句时保留检索答案；选择非空时由 displayResult 采用。
    void outcome;
  },
);
</script>

<style scoped>
.as {
  display: flex;
  flex-direction: column;
}
.as-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px var(--panel-pad-x) 6px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
  font-size: 11px;
  color: var(--color-text-secondary);
}
.as-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.as-toggle-off {
  opacity: 0.75;
}
.as-btn {
  padding: 1px 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}
.as-status {
  flex: 1;
  min-width: 0;
  text-align: right;
}
.as-status-error {
  color: var(--color-danger, #d14343);
}
.as-note,
.as-hint {
  margin: 0;
  padding: 4px var(--panel-pad-x) 6px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.as-note-tag {
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--color-bg-hover);
}
</style>
