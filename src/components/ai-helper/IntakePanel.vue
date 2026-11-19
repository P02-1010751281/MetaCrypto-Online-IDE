<template>
  <!-- A/B 单入口（PLAN P5）：用户拿一份文件进来，先按扩展名/内容判别，判别结果
       **对用户可见且可改**——开关是预填，不是锁定。两条线各自的界面不改：
       这里只做判别与路由，选「代码」交给 B 线面板（带预填），选「文档」交给 A 线面板。 -->
  <div
    v-if="visible"
    :class="docked ? 'ip-dock' : 'ip-overlay'"
    @click.self="docked ? undefined : emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="ip" role="dialog" :aria-modal="!docked" :aria-label="ui('intakeTitle')">
      <div class="section-head section-head--divided">
        <span class="section-title">{{ ui('intakeTitle') }}</span>
        <div class="section-actions">
          <button
            class="ghost-btn"
            type="button"
            :title="ui('closePanel')"
            :aria-label="ui('closePanel')"
            @click="emit('close')"
          >×</button>
        </div>
      </div>

      <div class="ip-body">
        <p class="ip-intro">{{ ui('intakeIntro') }}</p>

        <div class="ip-source">
          <label class="ip-file">
            <input
              ref="fileInput"
              type="file"
              accept=".pdf,.md,.markdown,.txt,.tex,.docx,.rst,.c,.h,.cpp,.cc,.cxx,.hpp,.py,.js,.mjs,.ts,.tsx,.rs,.go"
              class="ip-file-input"
              @change="onFile"
            />
            <span class="ip-file-btn">{{ ui('intakePickFile') }}</span>
          </label>
          <span v-if="fileName" class="ip-file-name" :title="fileName">{{ fileName }}</span>
        </div>

        <textarea
          v-model="source"
          class="ip-text"
          spellcheck="false"
          :placeholder="ui('intakePlaceholder')"
          :aria-label="ui('intakePlaceholder')"
          @input="onText"
        />

        <p class="ip-verdict" role="status">
          <span class="ip-verdict-label">{{ ui('intakeVerdict') }}</span>
          <span class="ip-verdict-kind">{{ kindLabel }}</span>
          <span v-if="evidence" class="ip-verdict-evidence">{{ evidence }}</span>
          <span v-if="overridden" class="ip-verdict-note">{{ ui('intakeOverridden') }}</span>
        </p>

        <div class="ip-switch" role="group" :aria-label="ui('intakeSwitchLabel')">
          <button
            type="button"
            class="ip-choice"
            :class="{ 'ip-choice--on': kind === 'doc' }"
            :aria-pressed="kind === 'doc'"
            @click="choose('doc')"
          >{{ ui('intakeKindDoc') }}</button>
          <button
            type="button"
            class="ip-choice"
            :class="{ 'ip-choice--on': kind === 'code' }"
            :aria-pressed="kind === 'code'"
            @click="choose('code')"
          >{{ ui('intakeKindCode') }}</button>
        </div>

        <p v-if="kind === 'unknown'" class="ip-hint ip-hint--warn" role="alert">
          {{ ui('intakeUnknownHint') }}
        </p>
        <p v-else-if="kind === 'doc'" class="ip-hint">{{ ui('intakeDocHint') }}</p>
        <p v-else class="ip-hint">{{ ui('intakeCodeHint') }}</p>
        <p v-if="error" class="ip-error" role="alert">{{ error }}</p>

        <div class="ip-foot">
          <span class="ip-spacer" />
          <button type="button" class="ip-ghost" @click="emit('close')">{{ ui('cancel') }}</button>
          <button
            type="button"
            class="ip-primary"
            :disabled="!canContinue"
            @click="confirm"
          >{{ ui('intakeContinue') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A/B 单入口的面板（PLAN §3.1 / P5）。
 *
 * 三件事：
 *   1. 收一份输入（选文件，或直接粘贴）；
 *   2. 调 `detectIntake` 预填「文档 / 代码」开关——判别结果是**可见**的（给依据）；
 *   3. 用户确认后路由：代码 → B 线面板（带预填正文），文档 → A 线面板。
 *
 * 刻意不在这里做解析：B 线要等用户看过诊断才载入，A 线只处理已登记的标准。
 * 这一层只回答「这份东西该去哪条线」，越权做第二件事就会把两条线的判据搅在一起。
 */
import { computed, ref } from 'vue';

import { ui } from '@/composables/locale';
import { detectIntake, isBinaryDoc, type IntakeKind } from '@/services/ai-helper/intake';

defineProps<{
  visible: boolean;
  /** 停靠在左栏面板里（缺省）；false 时是中心浮层。 */
  docked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'route-code', payload: { source: string; name: string }): void;
  (e: 'route-doc', payload: { name: string }): void;
}>();

/** 与 B 线面板同一口径：参考实现通常几十 KB，超过 2 MB 多半是选错了文件。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const source = ref('');
const fileName = ref('');
const error = ref('');
/** 用户显式改过开关就以用户为准；只按判别结果预填（PLAN：判别不锁定）。 */
const chosen = ref<IntakeKind | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const verdict = computed(() => detectIntake({ name: fileName.value, text: source.value }));
/** 没被用户改过时跟着判别走；改过就固定。 */
const kind = computed<IntakeKind>(() => chosen.value ?? verdict.value.kind);

const kindLabel = computed(() => {
  if (kind.value === 'doc') return ui('intakeKindDoc');
  if (kind.value === 'code') return ui('intakeKindCode');
  return ui('intakeKindUnknown');
});

/** 依据按当前显示的类别取：用户改成代码后，展示的是「为什么像代码」。 */
const evidence = computed(() => {
  const items = verdict.value.evidence;
  if (!items.length) return '';
  return items.join(ui('intakeEvidenceJoin'));
});

/** 用户改判过：机器判的是另一类。界面上要能看出「这是你改的」，不是判别说的。 */
const overridden = computed(() => chosen.value !== null && chosen.value !== verdict.value.kind);

const hasInput = computed(() => fileName.value.length > 0 || source.value.trim().length > 0);
const canContinue = computed(() => {
  if (!hasInput.value) return false;
  if (kind.value === 'unknown') return false;
  // 走 B 线必须有正文；只选了 PDF/DOCX 不可能走代码，开关也不该给出这条假路。
  if (kind.value === 'code') return source.value.trim().length > 0;
  return true;
});

function onText(): void {
  chosen.value = null;
  error.value = '';
}

function choose(next: IntakeKind): void {
  if (next === 'unknown') return;
  chosen.value = next;
  error.value = '';
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  error.value = '';
  chosen.value = null;
  fileName.value = file.name;
  source.value = '';
  // 二进制文档不读正文：解出来是乱码，喂给内容判据只会误判（判别内核也只按扩展名）。
  if (isBinaryDoc(file.name)) return;
  if (file.size > MAX_FILE_BYTES) {
    error.value = ui('intakeFileTooLarge');
    return;
  }
  try {
    source.value = await file.text();
  } catch (readError) {
    error.value = `${ui('intakeReadFailed')}${readError instanceof Error ? readError.message : String(readError)}`;
  }
}

function confirm(): void {
  if (!canContinue.value) return;
  if (kind.value === 'code') {
    emit('route-code', { source: source.value, name: fileName.value });
    return;
  }
  emit('route-doc', { name: fileName.value });
}
</script>

<style scoped>
.ip-dock,
.ip-overlay {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ip-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 35%);
}
.ip {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  max-width: 520px;
  max-height: 100%;
  overflow: auto;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-panel, 6px);
  background: var(--color-surface, #fff);
}
.ip-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px var(--panel-pad-x, 12px) 12px;
  min-height: 0;
}
.ip-intro {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.ip-source {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ip-file-input {
  display: none;
}
.ip-file-btn {
  display: inline-block;
  padding: 4px 10px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  font-size: 12px;
  cursor: pointer;
}
.ip-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}
.ip-text {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  padding: 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  background: var(--color-surface-alt, #f7f8fa);
  color: inherit;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ip-verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.ip-verdict-label {
  color: var(--color-text-secondary);
}
.ip-verdict-kind {
  font-weight: 600;
}
.ip-verdict-evidence {
  color: var(--color-text-secondary);
}
.ip-verdict-note {
  color: var(--color-accent, #3b6ef5);
}
.ip-switch {
  display: flex;
  gap: 6px;
}
.ip-choice {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: var(--radius-control, 4px);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ip-choice--on {
  border-color: var(--color-accent, #3b6ef5);
  color: var(--color-text, #1f2430);
  background: var(--color-accent-soft, #eaf0ff);
}
.ip-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.ip-hint--warn,
.ip-error {
  color: var(--color-danger, #d14343);
}
.ip-error {
  margin: 0;
  font-size: 12px;
}
.ip-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}
.ip-spacer {
  flex: 1;
}
.ip-ghost,
.ip-primary {
  padding: 5px 12px;
  border-radius: var(--radius-control, 4px);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ip-ghost {
  border: 1px solid var(--color-border, #d0d3d9);
  background: none;
  color: var(--color-text-secondary);
}
.ip-primary {
  border: 1px solid var(--color-accent, #3b6ef5);
  background: var(--color-accent, #3b6ef5);
  color: #fff;
}
.ip-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
