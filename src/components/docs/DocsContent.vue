<template>
  <main class="docs-content">
    <!-- Loading state -->
    <div v-if="loading" class="content-loading">
      <div class="loading-spinner" />
      <p>{{ ui('docsLoading') }}</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="content-error">
      <p>{{ error }}</p>
    </div>

    <!-- Doc content -->
    <template v-else-if="renderedHtml">
      <p v-if="isSourceLocaleFallback" class="locale-fallback">
        {{ ui('docsSourceFallback') }}
      </p>
      <div class="content-markdown" v-html="renderedHtml" />
    </template>

    <!-- Welcome screen -->
    <div v-else class="content-welcome">
      <svg
        class="welcome-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
      <h2>{{ ui('docsWelcome') }}</h2>
      <p>{{ ui('docsWelcomeDesc') }}</p>
      <div class="welcome-links">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="welcome-link"
          @click="emit('selectDoc', cat.files[0]?.path || '')"
        >
          {{ getCategoryLabel(cat.id, currentLocale) }}
        </button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ui } from '@/composables/locale';
import { getCategoryLabel, type DocCategory } from '@/utils/markdown';

defineProps<{
  loading: boolean;
  error: string;
  renderedHtml: string;
  isSourceLocaleFallback: boolean;
  categories: DocCategory[];
  currentLocale: 'zh' | 'en';
}>();

const emit = defineEmits<{
  selectDoc: [path: string];
}>();
</script>

<style scoped>
.docs-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  min-width: 0;
}

/* Loading */
.content-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 16px;
  color: var(--color-text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error */
.content-error {
  padding: 24px;
  color: var(--color-danger);
  background: rgba(211, 47, 47, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(211, 47, 47, 0.2);
}

.locale-fallback {
  margin: 0 0 16px;
  padding: 8px 12px;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
}

/* Welcome */
.content-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  gap: 16px;
  color: var(--color-text-secondary);
  text-align: center;
}

.welcome-icon {
  width: 64px;
  height: 64px;
  opacity: 0.3;
}

.content-welcome h2 {
  font-size: 20px;
  color: var(--color-text);
  margin: 0;
}

.content-welcome p {
  font-size: 14px;
  margin: 0;
  max-width: 400px;
}

.welcome-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  max-width: 100%;
}

.welcome-link {
  padding: 8px 20px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.12s;
}

.welcome-link:hover {
  border-color: var(--color-primary);
  background: rgba(25, 118, 210, 0.05);
}

/* Markdown content styling */
.content-markdown {
  max-width: 860px;
  line-height: 1.7;
  font-size: 15px;
}

.content-markdown :deep(h1) {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.content-markdown :deep(h2) {
  font-size: 20px;
  font-weight: 600;
  margin: 28px 0 12px 0;
}

.content-markdown :deep(h3) {
  font-size: 17px;
  font-weight: 600;
  margin: 20px 0 8px 0;
}

.content-markdown :deep(p) {
  margin: 0 0 12px 0;
}

.content-markdown :deep(strong) {
  font-weight: 600;
}

.content-markdown :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 13px;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 3px;
}

.content-markdown :deep(pre) {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  background: #282c34;
}

.content-markdown :deep(pre.doc-code) {
  position: relative;
  padding-top: 30px;
}

.content-markdown :deep(pre.doc-code::before) {
  content: attr(data-language);
  position: absolute;
  inset: 0 0 auto;
  height: 30px;
  padding: 7px 14px 0;
  box-sizing: border-box;
  color: #abb2bf;
  background: rgba(0, 0, 0, 0.18);
  font-family: var(--font-family);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.content-markdown :deep(pre code) {
  display: block;
  padding: 16px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
  background: none;
  color: #abb2bf;
}

.content-markdown :deep(table) {
  border-collapse: collapse;
  margin: 16px 0;
  width: 100%;
  font-size: 14px;
}

.content-markdown :deep(th) {
  background: var(--color-bg-hover, #f0f0f0);
  font-weight: 600;
  text-align: center;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
}

.content-markdown :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  text-align: center;
}

.content-markdown :deep(tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.02);
}

.content-markdown :deep(ul),
.content-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.content-markdown :deep(li) {
  margin: 4px 0;
}

.content-markdown :deep(blockquote) {
  margin: 16px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--color-primary);
  background: rgba(25, 118, 210, 0.05);
  border-radius: 0 4px 4px 0;
}

.content-markdown :deep(hr) {
  margin: 24px 0;
  border: none;
  border-top: 1px solid var(--color-border);
}

.content-markdown :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.content-markdown :deep(a:hover) {
  text-decoration: underline;
}

.content-markdown :deep(img) {
  display: block;
  max-width: 100%;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: #fff;
  box-shadow: 0 3px 12px rgba(32, 36, 43, 0.08);
  margin: 16px 0 8px;
}

.content-markdown :deep(p > em:only-child) {
  display: block;
  color: var(--color-text-secondary, #697586);
  font-size: 0.9em;
  margin-bottom: 16px;
}
</style>
