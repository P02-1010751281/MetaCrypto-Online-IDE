<template>
  <!-- A/B 线入口（当前只开 B1：本平台生成的 Python 代码）。独立浮层，不并入检索助手：
       检索助手是 D 线，A/B 是另一条线，合成一个面板会让两条线共用一份外壳状态。 -->
  <div v-if="visible" class="c2w-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="c2w" role="dialog" aria-modal="true" :aria-label="ui('codeToWorkspaceTitle')">
      <div class="section-head section-head--divided">
        <span class="section-title">{{ ui('codeToWorkspaceTitle') }}</span>
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

      <div class="c2w-body">
        <p class="c2w-intro">{{ ui('codeToWorkspaceIntro') }}</p>

        <div class="c2w-source">
          <textarea
            v-model="source"
            class="c2w-text"
            spellcheck="false"
            :placeholder="ui('codeToWorkspacePlaceholder')"
            :aria-label="ui('codeToWorkspacePlaceholder')"
            @input="resetResult"
          />
          <div class="c2w-source-actions">
            <label class="c2w-file">
              <input
                ref="fileInput"
                type="file"
                accept=".py,.txt,.c,.h,.cpp,.js,.mjs,.ts,.md"
                class="c2w-file-input"
                @change="onFile"
              />
              <span class="c2w-file-btn">{{ ui('codeToWorkspacePickFile') }}</span>
            </label>
            <span v-if="fileName" class="c2w-file-name">{{ fileName }}</span>
            <span class="c2w-spacer" />
            <button
              type="button"
              class="c2w-primary"
              :disabled="parsing || !source.trim()"
              @click="parse"
            >{{ parsing ? ui('codeToWorkspaceParsing') : ui('codeToWorkspaceParse') }}</button>
          </div>
        </div>

        <p v-if="error" class="c2w-error" role="alert">{{ error }}</p>
        <p v-else-if="!source.trim()" class="c2w-hint">{{ ui('codeToWorkspaceEmpty') }}</p>

        <template v-if="result">
          <!-- 形态不支持是一句话能说清的事，不该伪装成一屏「未识别」：JS 的每条语句都不在
               Python 模板表里，逐条列只会让用户以为代码写错了。 -->
          <p v-if="unsupportedLanguage" class="c2w-hint c2w-hint--warn" role="alert">
            {{ ui('codeToWorkspaceUnsupportedJs') }}
          </p>

          <template v-else>
            <p class="c2w-summary">
              {{ uiFormat('codeToWorkspaceResult', {
                blocks: blockTotal,
                procedures: result.stats.procedures,
                topLevel: result.stats.topLevel,
                diagnostics: result.state.diagnostics.length,
              }) }}
            </p>

            <div v-if="shownDiagnostics.length" class="c2w-diagnostics">
              <p class="c2w-diagnostics-head">
                {{ uiFormat('codeToWorkspaceDiagnostics', {
                  shown: shownDiagnostics.length,
                  total: result.state.diagnostics.length,
                }) }}
              </p>
              <ul class="c2w-diagnostics-list">
                <li v-for="(diagnostic, index) in shownDiagnostics" :key="index">
                  <span class="c2w-reason">{{ ui('codeToWorkspaceUnresolved') }}</span>
                  <code class="c2w-code">{{ diagnostic.text }}</code>
                </li>
              </ul>
            </div>

            <p v-if="!blockTotal" class="c2w-hint c2w-hint--warn">{{ ui('codeToWorkspaceNoBlocks') }}</p>
          </template>

          <div class="c2w-foot">
            <span v-if="blockTotal" class="c2w-note">
              {{ currentBlockCount
                ? uiFormat('codeToWorkspaceReplaceWarn', { count: currentBlockCount })
                : ui('codeToWorkspaceReplaceEmpty') }}
            </span>
            <span v-else-if="!unsupportedLanguage" class="c2w-note">{{ ui('codeToWorkspaceHintOnlyGenerated') }}</span>
            <span class="c2w-spacer" />
            <button type="button" class="c2w-ghost" @click="emit('close')">{{ ui('cancel') }}</button>
            <button
              type="button"
              class="c2w-primary"
              :disabled="!blockTotal"
              @click="apply"
            >{{ ui('codeToWorkspaceApply') }}</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 代码 → 工作区（用户侧 AI Helper · B 线 B1 入口）。
 *
 * 三件事按顺序发生，每一步都可停：
 *   1. 粘贴 / 选文件 → 解析（`reverseCode`）：只产出状态与诊断，**不碰画布**；
 *   2. 诊断逐条列出：认不出的语句不会被换成意思相近的块，也就不会被静默丢掉；
 *      判成 JavaScript 形态时（当前不支持）换成一句可读说明，不列逐行噪音；
 *   3. 「载入工作区」是显式动作，并写明会替换当前画布多少块——不静默覆盖用户内容。
 *
 * 载荷（160 KB 模板表）在第一次解析时才拉，解析器本身不认识 Blockly。
 */

import { computed, ref } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import { countStateBlocks, loadFieldPayload, reverseCode } from '@/services/ai-helper/reverse';
import type { ReverseCodeResult, SerializedWorkspace } from '@/services/ai-helper/reverse';

defineProps<{
  visible: boolean;
  /** 当前画布已有多少块：只用于「将替换 N 块」的提示，不参与判定。 */
  currentBlockCount?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', state: SerializedWorkspace): void;
}>();

/** 一次最多列多少条诊断：再多也不适合在浮层里读，总数在标题里给。 */
const MAX_DIAGNOSTICS = 20;
/** 选文件的读取上限：参考实现通常几十 KB，超过 2 MB 多半是选错了文件。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const source = ref('');
const fileName = ref('');
const parsing = ref(false);
const error = ref('');
const result = ref<ReverseCodeResult | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

/** 要报的是「载入后画布上有多少块」，所以数嵌套，不数根节点（与状态栏口径一致）。 */
const blockTotal = computed(() => (result.value ? countStateBlocks(result.value.state) : 0));
const shownDiagnostics = computed(() => result.value?.state.diagnostics.slice(0, MAX_DIAGNOSTICS) ?? []);
/**
 * 判成 JavaScript 时，`reverseCode` 会短路成「零块 + 一条 unsupported 诊断」。
 * 面板必须换成一句可读说明：那条诊断的 text 是空的，列出来只会是一行空白。
 */
const unsupportedLanguage = computed(() => result.value?.language === 'javascript');

function resetResult(): void {
  result.value = null;
  error.value = '';
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  resetResult();
  if (file.size > MAX_FILE_BYTES) {
    fileName.value = file.name;
    error.value = uiFormat('codeToWorkspaceFileTooBig', {
      kb: Math.round(MAX_FILE_BYTES / 1024),
    });
    return;
  }
  try {
    source.value = await file.text();
    fileName.value = file.name;
  } catch (cause) {
    fileName.value = file.name;
    error.value = uiFormat('codeToWorkspaceParseFailed', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function parse(): Promise<void> {
  if (parsing.value || !source.value.trim()) return;
  parsing.value = true;
  resetResult();
  try {
    const payload = await loadFieldPayload();
    result.value = reverseCode(source.value, payload);
  } catch (cause) {
    error.value = uiFormat('codeToWorkspaceParseFailed', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    parsing.value = false;
  }
}

function apply(): void {
  if (!result.value || !blockTotal.value) return;
  emit('apply', result.value.state);
}
</script>

<style scoped>
.c2w-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
  background: rgba(0, 0, 0, 0.18);
}
.c2w {
  display: flex;
  flex-direction: column;
  width: min(720px, 94vw);
  max-height: 78vh;
  overflow: hidden;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  font-size: 13px;
}
.c2w-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 12px var(--panel-pad-x, 12px);
  overflow: auto;
}
.c2w-intro,
.c2w-hint,
.c2w-note {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.c2w-hint--warn {
  color: #f56c6c;
}
.c2w-source {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.c2w-text {
  width: 100%;
  min-height: 180px;
  padding: 8px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
}
.c2w-source-actions,
.c2w-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.c2w-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.c2w-file {
  position: relative;
  cursor: pointer;
}
.c2w-file-btn,
.c2w-ghost,
.c2w-primary {
  padding: 5px 12px;
  border: 1px solid var(--color-border, #d0d3d9);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.c2w-primary {
  border-color: var(--color-primary, #409eff);
  background: var(--color-primary, #409eff);
  color: #fff;
}
.c2w-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.c2w-file-name {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c2w-spacer {
  flex: 1;
}
.c2w-error {
  margin: 0;
  color: #f56c6c;
}
.c2w-summary {
  margin: 0;
  font-weight: 600;
}
.c2w-diagnostics-head {
  margin: 0 0 4px;
  color: var(--color-text-secondary);
}
.c2w-diagnostics-list {
  margin: 0;
  padding-left: 16px;
  max-height: 160px;
  overflow: auto;
}
.c2w-diagnostics-list li {
  margin-bottom: 4px;
  line-height: 1.4;
}
.c2w-reason {
  margin-right: 6px;
  color: #e6a23c;
}
.c2w-code {
  word-break: break-all;
  color: var(--color-text);
}
</style>
