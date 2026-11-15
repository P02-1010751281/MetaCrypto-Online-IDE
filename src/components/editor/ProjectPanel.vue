<template>
  <section class="project-panel">
    <div class="section-head">
      <span class="section-title">{{ ui('projects') }}</span>
      <button class="ghost-btn" :title="ui('newProject')" @click="createProject">＋</button>
    </div>
    <input
      class="side-search"
      :value="query"
      :placeholder="ui('searchProjects')"
      @input="onSearch"
    />
    <p v-if="loading" class="section-hint">{{ ui('loading') }}</p>
    <p v-else-if="projects.length === 0" class="section-hint">{{ ui('noProjects') }}</p>
    <ul v-else class="project-list">
      <li
        v-for="project in filtered"
        :key="project.id"
        class="project-row"
        :class="{ active: project.id === currentId }"
        @click="openProject(project.id!)"
      >
        <span class="project-row-main">
          <span class="project-row-name" :title="project.name">
            {{ project.name || ui('unnamed') }}
          </span>
          <span class="project-row-meta">{{ formatDate(project.updatedAt) }}</span>
        </span>
        <button
          class="row-btn danger"
          :title="ui('deleteProject')"
          @click.stop="confirmDelete(project.id!, project.name)"
        >✕</button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ui } from '@/composables/locale';
import { projectStore } from '@/services/projects';
import type { ProjectRecord } from '@/services/projects';

const props = defineProps<{ currentId: number | null }>();

const router = useRouter();
const projects = ref<ProjectRecord[]>([]);
const query = ref('');
const loading = ref(true);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return projects.value;
  return projects.value.filter((p) => (p.name || '').toLowerCase().includes(q));
});

async function loadProjects(): Promise<void> {
  try {
    const all = await projectStore.list();
    projects.value = all.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch (err) {
    console.error('Failed to load projects:', err);
  } finally {
    loading.value = false;
  }
}

function onSearch(event: Event): void {
  query.value = (event.target as HTMLInputElement).value;
}

async function createProject(): Promise<void> {
  const now = new Date().toISOString();
  const record: ProjectRecord = {
    name: ui('unnamed'),
    workspace: '',
    format: 'xml',
    language: 'python',
    createdAt: now,
    updatedAt: now,
  };
  const id = await projectStore.save(record);
  void router.push(`/editor/${id}`);
}

function openProject(id: number): void {
  if (id === props.currentId) return;
  void router.push(`/editor/${id}`);
}

async function confirmDelete(id: number, name: string): Promise<void> {
  if (!window.confirm(`${ui('deleteConfirm')}\n\n"${name}"`)) return;
  try {
    await projectStore.remove(id);
    projects.value = projects.value.filter((p) => p.id !== id);
  } catch (err) {
    console.error('Failed to delete project:', err);
  }
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(loadProjects);
</script>

<style scoped>
.project-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  min-height: 0;
  overflow: auto;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title {
  font-size: var(--font-size-sm, 12px);
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.side-search {
  width: 100%;
  padding: 4px 8px;
  font-size: var(--font-size-sm, 12px);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-elevated, transparent);
  color: inherit;
}
.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.project-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.project-row:hover {
  background: var(--color-bg-hover);
}
.project-row.active {
  background: var(--color-bg-active);
}
.project-row-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.project-row-name {
  font-size: var(--font-size-sm, 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-row-meta {
  font-size: 10px;
  color: var(--color-text-tertiary, var(--color-text-secondary));
}
.row-btn {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 4px;
  font-size: 11px;
  opacity: 0.55;
}
.row-btn:hover {
  opacity: 1;
}
.row-btn.danger:hover {
  color: var(--color-danger, #d9534f);
}
.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}
</style>
