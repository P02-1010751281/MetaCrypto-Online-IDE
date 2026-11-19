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

      <!-- 费用估算用的单价：可选，留空就不显示费用。独立存储（不是密钥、也不随「记住」），
           所以「清除」只清上面三项，不会把这里的价目一起删掉。 -->
      <div class="msd-price-head">{{ ui('modelPriceTitle') }}</div>
      <label class="msd-field">
        <span class="msd-label">{{ ui('modelPriceInput') }}</span>
        <input
          v-model="priceInput"
          class="msd-input msd-price"
          inputmode="decimal"
          spellcheck="false"
          :placeholder="ui('modelPricePlaceholder')"
        />
      </label>
      <label class="msd-field">
        <span class="msd-label">{{ ui('modelPriceOutput') }}</span>
        <input
          v-model="priceOutput"
          class="msd-input msd-price"
          inputmode="decimal"
          spellcheck="false"
          :placeholder="ui('modelPriceSameAsInput')"
        />
      </label>
      <label class="msd-field">
        <span class="msd-label">{{ ui('modelPriceCurrency') }}</span>
        <input
          v-model="currency"
          class="msd-input msd-price"
          spellcheck="false"
          :maxlength="MAX_CURRENCY_LENGTH"
          :placeholder="DEFAULT_CURRENCY"
        />
      </label>
      <p class="msd-price-hint">{{ ui('modelPriceHint') }}</p>

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
 *
 * 单价（可选）与三项必填分开：它不是连上 provider 的前提，只是让状态位能换算金额。
 * 留空 = 不估价；填了就按「每百万 token」折算，界面上标「≈」，实际以 provider 账单为准。
 */
import { computed, ref, watch } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import { checkConfig, type ConfigIssue, type ModelConfig } from '@/services/ai-helper/model/config';
import {
  checkPricing,
  DEFAULT_CURRENCY,
  MAX_CURRENCY_LENGTH,
  type ModelPricing,
  type PricingIssue,
} from '@/services/ai-helper/model/pricing';

type DialogIssue = ConfigIssue | PricingIssue;

const props = defineProps<{
  open: boolean;
  config: ModelConfig | null;
  remembered: boolean;
  pricing: ModelPricing | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', payload: { config: ModelConfig; remember: boolean; pricing: ModelPricing | null }): void;
  (e: 'clear'): void;
}>();

const baseUrl = ref('');
const modelId = ref('');
const apiKey = ref('');
const remember = ref(false);
const priceInput = ref('');
const priceOutput = ref('');
const currency = ref(DEFAULT_CURRENCY);
const issues = ref<readonly DialogIssue[]>([]);
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
    priceInput.value = props.pricing ? String(props.pricing.inputPerMillion) : '';
    priceOutput.value = props.pricing?.outputPerMillion != null ? String(props.pricing.outputPerMillion) : '';
    currency.value = props.pricing?.currency ?? DEFAULT_CURRENCY;
    issues.value = [];
  },
  { immediate: true },
);

/** 用户一改输入就清掉上一次的报错：提示描述的是「上次提交」，不是当前内容。 */
watch([baseUrl, modelId, apiKey, priceInput, priceOutput, currency], () => {
  if (issues.value.length > 0) issues.value = [];
});

const issueText = computed(() => {
  const parts: string[] = [];
  if (issues.value.includes('base-url')) parts.push(ui('modelInvalidBaseUrl'));
  if (issues.value.includes('model-id')) parts.push(`${ui('modelModelId')}：${ui('modelRequired')}`);
  if (issues.value.includes('api-key')) parts.push(`${ui('modelApiKey')}：${ui('modelRequired')}`);
  if (issues.value.includes('price-input') || issues.value.includes('price-output')) {
    parts.push(ui('modelPriceInvalid'));
  }
  if (issues.value.includes('price-need-input')) parts.push(ui('modelPriceNeedInput'));
  if (issues.value.includes('price-currency')) {
    parts.push(uiFormat('modelPriceCurrencyInvalid', { max: MAX_CURRENCY_LENGTH }));
  }
  return parts.join('；');
});

function onSave(): void {
  const { check, config } = checkConfig({ baseUrl: baseUrl.value, modelId: modelId.value, apiKey: apiKey.value });
  const prices = checkPricing({
    inputPerMillion: priceInput.value,
    outputPerMillion: priceOutput.value,
    currency: currency.value,
  });
  issues.value = [...check.issues, ...prices.issues];
  if (!check.ok || prices.issues.length > 0) return;
  emit('save', { config, remember: remember.value, pricing: prices.pricing });
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
.msd-price-head {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border, #d0d3d9);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
}
.msd-price-hint {
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
