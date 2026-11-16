<template>
  <nav class="editor-breadcrumb" aria-label="breadcrumb">
    <!-- 项目名在这里只读：改名入口统一收到侧栏「项目」面板的行内 ✎，
         同一个名字不再有两处可改（面包屑是可编辑输入框时，改完还要点保存，
         而面板行改名是直接写库，两者语义不同，容易改错一个）。 -->
    <span
      class="crumb-project"
      :class="{ 'crumb-project--empty': !projectName }"
      :title="projectName || ui('projectName')"
    >{{ projectName || ui('projectName') }}</span>
    <template v-if="fileName">
      <span class="crumb-sep">/</span>
      <span class="crumb-file" :title="fileName">{{ fileName }}</span>
      <span v-if="isEntry" class="crumb-badge">{{ ui("entryFile") }}</span>
    </template>
    <span v-if="dirty" class="crumb-dirty" :title="ui('unsaved')">●</span>
  </nav>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';

defineProps<{
  projectName: string;
  fileName?: string;
  isEntry?: boolean;
  dirty?: boolean;
}>();
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

/* 只读的项目名：宽度上限沿用原来输入框的 40%，超长仍截断并靠 title 显示全名。
   高度 24px 与原来输入框一致，顶栏基线不因为改成文本而变。 */
.crumb-project {
  max-width: 40%;
  height: 24px;
  line-height: 24px;
  padding: 0 4px;
  color: var(--color-text-secondary);
}

/* 空名字时用占位文案，颜色退化到三级色，与真名字区分开。 */
.crumb-project--empty {
  color: var(--color-text-tertiary);
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
