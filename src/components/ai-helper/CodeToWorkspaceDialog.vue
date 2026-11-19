<template>
  <!-- A/B 线入口（当前只开 B1：本平台生成的 Python 代码）。与检索助手是两个面板：
       检索助手是 D 线，A/B 是另一条线，合成一个面板会让两条线共用一份外壳状态。
       同一份内容支持两种形态：`docked`（缺省）停靠在左栏，否则是中心浮层。 -->
  <div
    v-if="visible"
    :class="docked ? 'c2w-dock' : 'c2w-overlay'"
    @click.self="docked ? undefined : emit('close')"
    @keydown.esc="emit('close')"
  >
    <div
      class="c2w"
      role="dialog"
      :aria-modal="!docked"
      :aria-label="ui('codeToWorkspaceTitle')"
    >
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
        <p v-else-if="parsing" class="c2w-hint">{{ ui('codeToWorkspaceAstLoading') }}</p>
        <p v-else-if="!source.trim()" class="c2w-hint">{{ ui('codeToWorkspaceEmpty') }}</p>

        <template v-if="result">
          <!-- 形态不支持是一句话能说清的事，不该伪装成一屏「未识别」：JS 的每条语句都不在
               Python 模板表里，逐条列只会让用户以为代码写错了。 -->
          <p v-if="unsupportedLanguage" class="c2w-hint c2w-hint--warn" role="alert">
            {{ ui('codeToWorkspaceUnsupportedJs') }}
          </p>

          <!-- 外来代码：识别到函数却拼不出块。逐条列「未识别」只会让用户以为自己写错，
               这里换成一句说明 + 函数名清单（§38 的结论：明确拒绝，不产半成品）。 -->
          <template v-else-if="foreignDefs.length">
            <p class="c2w-hint c2w-hint--warn" role="alert">
              {{ uiFormat('codeToWorkspaceForeignCode', { count: foreignDefs.length }) }}
            </p>
            <p class="c2w-hint">{{ uiFormat('codeToWorkspaceForeignDefs', { names: foreignNames }) }}</p>
            <p v-if="astError" class="c2w-error" role="alert">
              {{ uiFormat('codeToWorkspaceAstError', { message: astError }) }}
            </p>
          </template>

          <template v-else>
            <p v-if="astPath && astStats" class="c2w-summary">
              {{ uiFormat('codeToWorkspaceAstSummary', {
                blocks: blockTotal,
                functions: astStats.functions,
                statements: astStats.statements,
              }) }}
            </p>
            <p v-else class="c2w-summary">
              {{ uiFormat('codeToWorkspaceResult', {
                blocks: blockTotal,
                procedures: result.stats.procedures,
                topLevel: result.stats.topLevel,
                diagnostics: result.state.diagnostics.length,
              }) }}
            </p>

            <!-- 语法树路径必然是有损的：翻不出来的节点必须单独警告，不然用户会以为整段都还原了。 -->
            <p v-if="astIncomplete" class="c2w-hint c2w-hint--warn" role="alert">
              {{ uiFormat('codeToWorkspaceAstIncomplete', { count: astIncomplete }) }}
            </p>

            <div v-if="shownDiagnostics.length" class="c2w-diagnostics">
              <p class="c2w-diagnostics-head">
                {{ uiFormat(astPath ? 'codeToWorkspaceAstDiagnostics' : 'codeToWorkspaceDiagnostics', {
                  shown: shownDiagnostics.length,
                  total: result.state.diagnostics.length,
                }) }}
              </p>
              <ul class="c2w-diagnostics-list">
                <li v-for="(diagnostic, index) in shownDiagnostics" :key="index">
                  <span v-if="diagnostic.line" class="c2w-line">
                    {{ uiFormat('codeToWorkspaceLine', { line: diagnostic.line }) }}
                  </span>
                  <span class="c2w-reason">{{ diagnosticLabel(diagnostic) }}</span>
                  <code class="c2w-code">{{ diagnostic.text }}</code>
                  <span v-if="diagnostic.detail" class="c2w-detail">{{ diagnostic.detail }}</span>
                </li>
              </ul>
            </div>

            <p v-if="!blockTotal" class="c2w-hint c2w-hint--warn">{{ ui('codeToWorkspaceNoBlocks') }}</p>
          </template>

          <div class="c2w-foot">
            <!-- AST 路径的说明必须与「会替换几块」并列：它描述的是这次识别**有损**，
                 不能因为按钮区已有提示就被 v-else-if 吞掉。 -->
            <span v-if="astPath" class="c2w-note">{{ ui('codeToWorkspaceAstNote') }}</span>
            <span v-if="blockTotal" class="c2w-note">
              {{ currentBlockCount
                ? uiFormat('codeToWorkspaceReplaceWarn', { count: currentBlockCount })
                : ui('codeToWorkspaceReplaceEmpty') }}
            </span>
            <span v-else-if="!unsupportedLanguage && !foreignDefs.length" class="c2w-note">{{ ui('codeToWorkspaceHintOnlyGenerated') }}</span>
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

import { computed, ref, watch } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import { countStateBlocks, loadFieldPayload, reverseCodeAuto } from '@/services/ai-helper/reverse';
import type { ReverseCodeResult, SerializedWorkspace } from '@/services/ai-helper/reverse';
import { parsePythonAst } from '@/runtime/python-parse';

const props = defineProps<{
  visible: boolean;
  /** 当前画布已有多少块：只用于「将替换 N 块」的提示，不参与判定。 */
  currentBlockCount?: number;
  /** 停靠在左栏面板里（缺省入口）；false 时是中心浮层，窄屏与其它调用点仍可复用。 */
  docked?: boolean;
  /**
   * A/B 单入口路由过来的正文（非空时预填）。
   *
   * 用 prop 而不是 shared state：预填是一次性的输入，面板关掉就该消失；
   * 留一份全局状态会让「上次导入的代码」在下次打开时阴魂不散。
   */
  intake?: { source: string; name: string } | null;
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
/**
 * 外来代码：`reverseCode` 识别到函数却拼不出块时给 `foreignDefs`（而不是逐行诊断）。
 * 只列前 8 个名字——清单是「让你确认我们看到了哪些函数」，不是逐行报告。
 */
const foreignDefs = computed(() => result.value?.stats.foreignDefs ?? []);
/**
 * 这次结果由语法树（AST）路径产出：模板路径认的是生成器写出来的形态，AST 路径认的是
 * Python 语法结构。两条路的面板说明不同——AST 只能还原结构，类型标签与字段取值都可能缺。
 */
const astPath = computed(() => result.value?.path === 'ast');
const astStats = computed(() => result.value?.astStats ?? null);
/** 语法树也没走通时的原因（语法错误、运行时没加载起来）：照原样显示，不吞。 */
const astError = computed(() => result.value?.astError ?? '');
/** 有没有翻不出来的节点：有就必须在面板上明说「语义没还原」，不能只列在诊断里。 */
const astIncomplete = computed(() =>
  astPath.value ? result.value?.state.diagnostics.length ?? 0 : 0,
);
/**
 * 标签分两档：`semantic-drift` 是「块已经出来了、只是语义与原文不同」，与「未识别」
 * 不是一回事——混成同一句会让用户去找一块根本没搭出来的语句。
 */
function diagnosticLabel(diagnostic: { reason?: string }): string {
  return ui(diagnostic.reason === 'semantic-drift' ? 'codeToWorkspaceDrift' : 'codeToWorkspaceUnresolved');
}
const foreignNames = computed(() => {
  const names = foreignDefs.value;
  return `${names.slice(0, 8).join('、')}${names.length > 8 ? ' …' : ''}`;
});

function resetResult(): void {
  result.value = null;
  error.value = '';
}

/**
 * 单入口路由的预填：只覆盖正文与文件名，不自动解析。
 *
 * 不自动解析是刻意的——B 线的判据是「诊断先看、载入后点」，替用户按下解析
 * 等于替他跳过了一次检查。`immediate` 让「先路由、后挂载」也能生效。
 */
watch(
  () => props.intake,
  (value) => {
    if (!value) return;
    source.value = value.source;
    fileName.value = value.name;
    resetResult();
  },
  { immediate: true },
);

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
    // 模板优先、AST 兜底：见 reverseCodeAuto 的注释（模板能回填字段取值，AST 只还原结构）。
    result.value = await reverseCodeAuto(source.value, payload, {
      astRunner: (script) => parsePythonAst(script),
    });
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
/* 停靠形态：左栏面板里没有遮罩也没有居中，宽高跟随栏，边线/圆角/阴影交给栏本身，
   否则浮层那套 720px 宽与 78vh 高会把栏撑出横向滚动条。 */
.c2w-dock {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.c2w-dock > .c2w {
  width: 100%;
  max-height: none;
  height: 100%;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.c2w-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 12px var(--panel-pad-x, 12px);
  overflow: auto;
}.c2w-intro,
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
.c2w-line {
  margin-right: 6px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.c2w-detail {
  display: block;
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
