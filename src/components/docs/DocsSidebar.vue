<template>
  <aside class="docs-sidebar">
    <div class="sidebar-search">
      <input
        v-model="search"
        type="text"
        :placeholder="ui('docsSearch')"
        class="search-input"
      />
    </div>
    <nav class="sidebar-nav">
      <div
        v-for="cat in categories"
        :key="cat.id"
        class="nav-category"
      >
        <button class="nav-category-title" @click="emit('toggleCategory', cat.id)">
          <span
            class="collapse-icon"
            :class="{ collapsed: !expandedCategories.has(cat.id) }"
            >▾</span
          >
          {{ getCategoryLabel(cat.id, currentLocale) }}
          <span class="doc-count">{{ cat.files.length }}</span>
        </button>
        <div v-show="expandedCategories.has(cat.id)" class="nav-items">
          <button
            v-for="file in cat.files"
            :key="file.path"
            class="nav-item"
            :class="{ active: activeDoc === file.path }"
            @click="emit('selectDoc', file.path)"
          >
            {{ file.title }}
          </button>
        </div>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ui } from '@/composables/locale';
import { getCategoryLabel, type DocCategory } from '@/utils/markdown';

const props = defineProps<{
  categories: DocCategory[];
  searchQuery: string;
  expandedCategories: Set<string>;
  activeDoc: string;
  currentLocale: 'zh' | 'en';
}>();

const emit = defineEmits<{
  'update:searchQuery': [value: string];
  toggleCategory: [id: string];
  selectDoc: [path: string];
}>();

const search = computed({
  get: () => props.searchQuery,
  set: (value: string) => emit('update:searchQuery', value),
});
</script>

<style scoped>
.docs-sidebar {
  width: 280px;
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-search {
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
}

.search-input:focus {
  border-color: var(--color-primary);
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.nav-category {
  margin-bottom: 4px;
}

.nav-category-title {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.nav-category-title:hover {
  background: var(--color-bg-hover, #f5f5f5);
}

.collapse-icon {
  font-size: 10px;
  transition: transform 0.15s;
  width: 12px;
  text-align: center;
}

.collapse-icon.collapsed {
  transform: rotate(-90deg);
}

.doc-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.nav-items {
  overflow: hidden;
}

.nav-item {
  display: block;
  width: 100%;
  padding: 6px 16px 6px 34px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: all 0.12s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item:hover {
  background: var(--color-bg-hover, #f5f5f5);
  color: var(--color-text);
}

.nav-item.active {
  color: var(--color-primary);
  background: rgba(25, 118, 210, 0.08);
  font-weight: 500;
}
</style>
