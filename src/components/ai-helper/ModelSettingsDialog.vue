<template>
  <div v-if="open" class="msd-overlay" @click.self="emit('close')">
    <div class="msd" role="dialog" aria-modal="true">
      <div class="msd-head">
        <span class="msd-title">{{ ui('modelDialogTitle') }}</span>
        <button class="msd-x" type="button" :aria-label="ui('modelCancel')" @click="emit('close')">×</button>
      </div>

      <p class="msd-notice">{{ ui('modelDataNotice') }}</p>

      <label class="msd-field">
        <span class="msd-label">{{ ui('modelBaseUrl') }}</span>
        <input ref="baseUrlEl" v-model="baseUrl" class="msd-input" spellcheck="false" placeholder="https://…/v1" />
      </label>
      <label class="msd-field">
        <span class="msd-label">{{ ui('modelModelId') }}</span>
        <input v-model="modelId" class="msd-input" spellcheck="false" placeholder="model-id" />
      </label>
      <label class="msd-field">
        <span class="msd-label">{{ ui('modelApiKey') }}</span>
        <input v-model="apiKey" class="msd-input" type="password" spellcheck="false" autocomplete="off" />
      </label>

      <label class="msd-remember">
        <input v-model="remember" type="checkbox" />
        <span>{{ ui('modelRemember') }}</span>
      </label>
      <p class="msd-risk">{{ ui('modelRisk') }}</p>

      <p v-if="issues.length" class="msd-error">{{ issueText }}</p>

      <div class="msd-foot">
        <button class="msd-btn" type="button" @click="onClear">{{ ui('modelClear') }}</button>
        <span class="msd-spacer" />
        <button class="msd-btn" type="button" @click="emit('close')">{{ ui('modelCancel') }}</button>
        <button class="msd-btn msd-primary" type="button" @click="onSave">{{ ui('modelSave') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 模型设置对话框（BYOK）：用户填 base URL / 模型 id / key，勾不勾「记住」自己定。
 *
 * 对话框自己做必填校验（与服务层同一个 `checkConfig`），只在通过时把规范化后的配置
 * 抛给宿主去落存储；它不碰 storage，也不发任何请求——「填完就发一次」会让用户以为
 * 保存是免费的，而账是他自己的。
 *
 * 限额不开放编辑：D 档固定 20 s / ≤300 token / 不重试（§3.4），把三个数字摆出来，
 * 让用户知道一次点击最多值多少钱、最多等多久。
 */
import { computed, ref, watch } from 'vue';

import { ui } from '@/composables/locale';
import { checkConfig, type ConfigIssue, type ModelConfig } from '@/services/ai-helper/model/config';

const props = defineProps<{
  open: boolean;
  config: ModelConfig | null;
  remembered: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', payload: { config: ModelConfig; remember: boolean }): void;
  (e: 'clear'): void;
}>();

const baseUrl = ref('');
const modelId = ref('');
const apiKey = ref('');
const remember = ref(false);
const issues = ref<readonly ConfigIssue[]>([]);
const baseUrlEl = ref<HTMLInputElement | null>(null);

/** 每次打开都从当前已存的配置回填：用户看到的就是「现在真正在用的」。 */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    baseUrl.value = props.config?.baseUrl ?? '';
    modelId.value = props.config?.modelId ?? '';
    apiKey.value = props.config?.apiKey ?? '';
    remember.value = props.remembered;
    issues.value = [];
  },
  { immediate: true },
);

const issueText = computed(() => {
  const parts: string[] = [];
  if (issues.value.includes('base-url')) parts.push(ui('modelInvalidBaseUrl'));
  if (issues.value.includes('model-id')) parts.push(`${ui('modelModelId')}：${ui('modelRequired')}`);
  if (issues.value.includes('api-key')) parts.push(`${ui('modelApiKey')}：${ui('modelRequired')}`);
  return parts.join('；');
});

function onSave(): void {
  const { check, config } = checkConfig({ baseUrl: baseUrl.value, modelId: modelId.value, apiKey: apiKey.value });
  issues.value = check.issues;
  if (!check.ok) return;
  emit('save', { config, remember: remember.value });
}

function onClear(): void {
  baseUrl.value = '';
  modelId.value = '';
  apiKey.value = '';
  issues.value = [];
  emit('clear');
}
</script>

<style scoped>
.msd-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.2);
}
.msd {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(520px, 92vw);
  padding: 12px var(--panel-pad-x) 14px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  font-size: 13px;
}
.msd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.msd-title {
  font-weight: 600;
}
.msd-x {
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--color-text-secondary);
  font-size: 16px;
  cursor: pointer;
}
.msd-notice,
.msd-risk {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.msd-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.msd-label {
  flex: none;
  width: 92px;
  color: var(--color-text-secondary);
  font-size: 11px;
}
.msd-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.msd-remember {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.msd-error {
  margin: 2px 0 0;
  color: var(--color-danger, #d14343);
  font-size: 11px;
}
.msd-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.msd-spacer {
  flex: 1;
}
.msd-btn {
  padding: 3px 10px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.msd-primary {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary, #2563eb);
  color: #fff;
}
</style>
