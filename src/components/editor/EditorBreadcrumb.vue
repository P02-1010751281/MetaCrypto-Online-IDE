<template>
  <nav class="editor-breadcrumb" aria-label="breadcrumb">
    <input
      ref="projectInput"
      class="crumb-project-input"
      :value="projectName"
      :style="nameWidth ? { width: `${nameWidth}px` } : undefined"
      :placeholder="ui('projectName')"
      :title="ui('projectName')"
      @input="$emit('update:projectName', ($event.target as HTMLInputElement).value)"
    />
    <template v-if="fileName">
      <span class="crumb-sep">/</span>
      <span class="crumb-file" :title="fileName">{{ fileName }}</span>
      <span v-if="isEntry" class="crumb-badge">{{ ui("entryFile") }}</span>
    </template>
    <span v-if="dirty" class="crumb-dirty" :title="ui('unsaved')">●</span>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

import { ui } from '@/composables/locale';

const props = defineProps<{
  projectName: string;
  fileName?: string;
  isEntry?: boolean;
  dirty?: boolean;
}>();

defineEmits<{ (e: 'update:projectName', value: string): void }>();

const projectInput = ref<HTMLInputElement | null>(null);
const nameWidth = ref(0);

/** 输入框宽度按真实文本量出的像素走，不用 `size`——`size` 的单位是「平均字符宽」，
 *  不在该单位里的空白会留在名字和「/」之间，看着像凭空多出 20px 空隙，
 *  中文名还会截断（一个汉字远比一个平均字符宽）。 */
function measureName(): void {
  const el = projectInput.value;
  if (!el) return;
  // 走 window.* ：仓库 eslint globals 是白名单，getComputedStyle 不在里面。
  const style = window.getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  // 空名字时按占位文案量，否则空项目名会让输入框塌成最小值。
  const text = props.projectName || el.placeholder || '';
  const chrome =
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth);
  // +1px 余量：取整后别刚好差一像素把尾字裁掉；24px 是下限，保证空格子也点得中。
  nameWidth.value = Math.max(24, Math.ceil(ctx.measureText(text).width + chrome) + 1);
}

onMounted(() => {
  measureName();
  // 中文字体首次渲染可能还没就绪，量到的是回退字体宽度，就绪后再量一次。
  void document.fonts?.ready.then(() => nextTick(measureName));
});

watch(() => [props.projectName, props.fileName], () => nextTick(measureName));
</script>

<style scoped>
.editor-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: var(--editor-bar-h);
  padding: 0 var(--bar-pad-x);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-card);
  font-size: 12px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.crumb-project,
.crumb-file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 项目名就地可编辑：编辑态与显示态同一尺寸，避免点击时行高跳动。
   宽度由脚本按真实文本量出（见 measureName），CSS 只兜住上限。 */
.crumb-project-input {
  max-width: 40%;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
}

.crumb-project-input:hover {
  border-color: var(--color-border);
  background: var(--color-bg-hover);
}

.crumb-project-input:focus {
  outline: none;
  border-color: var(--color-primary);
  background: var(--color-bg-card);
  color: var(--color-text);
}

.crumb-file {
  font-family: var(--font-family-mono);
  color: var(--color-text);
}

.crumb-sep {
  color: var(--color-border-hover);
  flex-shrink: 0;
}

.crumb-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
}

.crumb-dirty {
  flex-shrink: 0;
  color: var(--color-warning, #f59e0b);
  font-size: 10px;
}
</style>
