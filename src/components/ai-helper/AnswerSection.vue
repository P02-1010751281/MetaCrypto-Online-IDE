<template>
  <div class="as">
    <AnswerCard :result="displayResult" :loading="loading" @open="(payload) => emit('open', payload)" />

    <div class="as-bar">
      <label class="as-toggle" :class="{ 'as-toggle-off': !configured }">
        <input type="checkbox" :checked="enabled" @change="onToggle" />
        <span>{{ ui('modelSelectToggle') }}</span>
      </label>
      <button class="as-btn" type="button" @click="settingsOpen = true">{{ ui('modelSettings') }}</button>
      <span class="as-status" :class="{ 'as-status-error': failure }">
        <span>{{ statusText }}</span>
        <!-- 费用单独成元素：它能带悬浮说明（按你填的单价估算），拼进一串文字就没法解释口径。 -->
        <span v-if="costText" class="as-cost" :title="ui('modelCostHint')"> · {{ costText }}</span>
      </span>
    </div>

    <!-- 模型自述：与上面的「逐句引用原文」分区（左侧竖线 + 「不进答案证据」标签）。
         每句后面挂它自报依据的候选 id，悬浮给出 path:line；依据句本身的原文在上面的列表里。
         被丢弃的句子不显示正文，只给一个计数（-N），原因在悬浮说明里——没依据的说法不该占版面。
         全部被丢弃时这块仍要出现：否则「模型说了话但一句都没留下」会变成静默，
         用户看不到自己为哪几句话付了钱。 -->
    <div v-if="enabled && (notes.length || droppedNotes.length)" class="as-note">
      <p class="as-note-head">
        <span class="as-note-tag">{{ ui('modelNote') }}</span>
        <span v-if="droppedNotes.length" class="as-note-drop" :title="droppedTitle || undefined">−{{ droppedNotes.length }}</span>
      </p>
      <p v-for="(item, index) in notes" :key="index" class="as-note-line">
        {{ item.text }}
        <span v-for="cited in item.cited" :key="cited.id" class="as-note-cite" :title="`${cited.path}:${cited.line}`">{{ cited.id }}</span>
      </p>
    </div>
    <p v-else-if="enabled && !configured" class="as-hint">{{ ui('modelConfigureHint') }}</p>

    <ModelSettingsDialog
      :open="settingsOpen"
      :config="config"
      :remembered="remembered"
      :pricing="pricing"
      @close="settingsOpen = false"
      @save="onSave"
      @clear="onClear"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 答案区：检索答案卡 + 「让模型选句」开关 + 本次调用的 token/耗时/估算费用/失败原因。
 *
 * 四条界面纪律：
 *   1. 默认关。不勾就不发任何外部请求，用户的 key 也不用填。
 *   2. 模型只能**缩小/重排**同一段里的句子。卡片上的出处始终是那一段的 `path:line`，
 *      所以「选了哪几句」不会让出处指错文件（候选只从最佳段落摊出来，见 composable）。
 *   3. 失败不吞答案：检索结果照常显示，只多一行结构化原因（超时/额度/格式…）。
 *   4. 费用只在用户填了单价时出现，并标「≈」：没填价不等于免费，估算也不等于账单。
 */
import { computed, ref, watch } from 'vue';

import { ui, uiFormat, uiLocaleRef } from '@/composables/locale';
import { modelFailureTexts } from '@/composables/model-failure-text';
import { noteDropTexts } from '@/composables/model-note-text';
import { useModelAnswer } from '@/composables/useModelAnswer';
import type { AnswerResult } from '@/services/ai-helper/doc-answer';
import type { ModelFailure } from '@/composables/useModelAnswer';
import type { ModelConfig } from '@/services/ai-helper/model/config';
import { formatCost, type ModelPricing } from '@/services/ai-helper/model/pricing';

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
  pricing,
  configured,
  enabled,
  running,
  usage,
  elapsedMs,
  cost,
  notes,
  droppedNotes,
  failure,
  selected,
  save,
  clear,
  select,
  resetOutcome,
} = useModelAnswer();

/**
 * 丢弃计数的悬浮说明：五类丢弃各有文案，顺序按第一次出现的丢弃码。
 *
 * 文案映射放在 `composables/model-note-text.ts`（纯函数），这里只负责按当前语言取文案
 * 与拼接分隔符——映射本身要能被单测直接断言，且要守住「中英语言包都真实有键」
 * （`ui('字面量')` 的扫描器看不见动态 key）。
 */
const droppedTitle = computed(() =>
  noteDropTexts(droppedNotes.value, ui).join(uiLocaleRef.value === 'en' ? '; ' : '；'),
);

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

/**
 * 本次调用的读数：token 与耗时。provider 没回 usage 时不能显示「0 tokens」——
 * 那会让人以为自己没花钱；显示「未返回用量」才对得上「为什么没有费用」。
 */
const usageText = computed(() => {
  const current = usage.value;
  if (!current) return '';
  if (current.totalTokens <= 0) return ui('modelUsageMissing');
  return uiFormat('modelUsage', { total: current.totalTokens, ms: elapsedMs.value ?? 0 });
});

/** 估算金额：只有填了单价、且 provider 回了可拆分的用量时才有值。 */
const costText = computed(() => (cost.value ? uiFormat('modelCost', { cost: formatCost(cost.value) }) : ''));

const statusText = computed(() => {
  const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ');
  if (!enabled.value) return '';
  if (!configured.value) return ui('modelNotConfigured');
  if (running.value) return ui('modelRunning');
  if (failure.value) return join(`${ui('modelErrorPrefix')}${failureText(failure.value)}`, usageText.value);
  if (selected.value && selected.value.length === 0) return join(ui('modelDeclined'), usageText.value);
  if (selected.value?.length) return join(uiFormat('modelSelected', { n: selected.value.length }), usageText.value);
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

function onSave(payload: { config: ModelConfig; remember: boolean; pricing: ModelPricing | null }): void {
  // 对话框已用同一个 checkConfig / checkPricing 校验过，这里只负责落存储并关窗。
  save(payload.config, payload.remember, payload.pricing);
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
/* 费用是读数不是错误：调用失败时金额仍要看得清，别跟着整行变红。虚线提示它能悬浮看口径。 */
.as-cost {
  border-bottom: 1px dotted var(--color-border, #d0d3d9);
  color: var(--color-text-secondary);
  cursor: help;
}
/* 自述块：左侧竖线把它与「逐句引用原文」的答案卡分开——同一张卡里两种东西不能长得一样。 */
.as-note {
  margin: 0;
  padding: 4px var(--panel-pad-x) 6px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
  border-left: 3px solid var(--color-border, #d0d3d9);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.as-hint {
  margin: 0;
  padding: 4px var(--panel-pad-x) 6px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.as-note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 2px;
}
.as-note-tag {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--color-bg-hover);
}
/* 被丢弃的自述只留计数：正文不显示，原因放 title（细节在代码注释里解释为什么不新加文案键）。 */
.as-note-drop {
  margin-left: auto;
  font-family: var(--font-family-mono);
  cursor: help;
}
.as-note-line {
  margin: 0;
}
/* 依据 id：只是「这句自述靠哪几句撑着」，不是出处链接——原句在上面的答案列表里。 */
.as-note-cite {
  margin-left: 4px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--color-bg-hover);
  font-family: var(--font-family-mono);
  font-size: 10px;
}
.as-note-cite + .as-note-cite {
  margin-left: 2px;
}
</style>
