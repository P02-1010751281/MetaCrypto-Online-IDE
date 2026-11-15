<template>
  <nav class="editor-breadcrumb" aria-label="breadcrumb">
    <span class="crumb-project" :title="projectName">{{ projectName || ui("unnamed") }}</span>
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
  padding: 4px 12px;
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

.crumb-project {
  max-width: 40%;
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
