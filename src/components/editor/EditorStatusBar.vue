<template>
  <footer class="editor-status">
    <span class="status-item">
      <span class="status-label">{{ ui("blocks") }}</span>
      <span class="status-value">{{ blockCount }}</span>
    </span>
    <span class="status-item">
      <span class="status-label">{{ ui("files") }}</span>
      <span class="status-value">{{ fileCount }}</span>
    </span>
    <span class="status-item status-lang">
      <span class="status-label">{{ ui("language") }}</span>
      <span class="status-value">{{ languageLabel }}</span>
    </span>
  </footer>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';

defineProps<{
  blockCount: number;
  fileCount: number;
  languageLabel: string;
}>();
</script>

<style scoped>
.editor-status {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  padding: 3px 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-card);
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  white-space: nowrap;
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.status-label {
  color: var(--color-text-secondary);
}

.status-value {
  color: var(--color-text);
  font-family: var(--font-family-mono);
}

.status-lang {
  margin-left: auto;
}
</style>
