<template>
  <div class="code-preview-container">
    <pre class="code-content"><code v-if="code" v-html="highlightedCode" /><code v-else>{{ dragHint }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import * as Blockly from 'blockly/core';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { type CodeLanguage } from '@/constants/code-languages';
import { generateCode as generateCodeFromWorkspace } from '@/composables/generator';
import { generateProjectBundle } from '@/utils/projectCodegen';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';
import { ui } from '@/composables/locale';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);

const props = defineProps<{
  workspace: Blockly.WorkspaceSvg | null;
  language: CodeLanguage;
  /** 多文件项目：传入文件清单时按项目级拼装生成；单文件仍走工作区直连生成。 */
  files?: ProjectFileRecord[];
  entryFileId?: string;
}>();

const code = ref<string>('');
const dragHint = computed(() => code.value ? '' : ui('dragHint'));

const highlightedCode = computed(() => {
  if (!code.value) return '';
  const result = hljs.highlight(code.value, { language: props.language });
  // replace \n with <br> for pre-wrap display, but keep pre format
  return result.value;
});

const generateCode = (): void => {
  const files = props.files ?? [];
  if (files.length > 1) {
    const bundle = generateProjectBundle(files, props.entryFileId || '', '');
    const body = props.language === 'python' ? bundle.python : bundle.javascript;
    // 跨文件重名、工作区解析失败等以注释形式写在代码最前面：预览区是用户唯一能看到的输出面。
    const prefix = bundle.errors.length > 0
      ? bundle.errors.map((item) => `${props.language === 'python' ? '#' : '//'} ${item}`).join('\n') + '\n\n'
      : '';
    code.value = prefix + body;
    return;
  }
  if (props.workspace) {
    code.value = generateCodeFromWorkspace(props.workspace, props.language);
  }
};

const clearCode = (): void => {
  code.value = ui('workspaceCleared');
};

watch(() => props.workspace, () => {
  generateCode();
});

watch(() => props.language, () => {
  generateCode();
});

/** 占位文案（清空后/未搭块）不是代码，运行前必须能区分，否则注释会被当 Python 执行。 */
const hasRunnableCode = computed(
  () => Boolean(code.value) && code.value !== ui('workspaceCleared'),
);

defineExpose({
  code,
  hasRunnableCode,
  generateCode,
  clearCode,
});
</script>

<style scoped>
.code-preview-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-card);
  overflow: hidden;
}

.code-content {
  flex: 1;
  padding: 12px 16px;
  margin: 0;
  overflow: auto;
  font-family: var(--font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text);
  /* 代码不折行：380px 栏宽下 pre-wrap + break-word 会把 0x01 拆成 0x0 / 1，
     把十六进制常量和长标识符切碎；改为横向滚动，保持每个 token 完整。 */
  white-space: pre;
  overflow-x: auto;
}

.code-content code {
  font-family: inherit;
}
</style>