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
import { useProjectList } from './useProjectList';

const props = defineProps<{ currentId: number | null }>();

const router = useRouter();
// 列表来自模块级单例：改名/新建后由保存层调 refresh/patch，这里跟着重渲染。
const { projects, loaded, refresh } = useProjectList();
const query = ref('');
const loading = computed(() => !loaded.value);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return projects.value;
  return projects.value.filter((p) => (p.name || '').toLowerCase().includes(q));
});

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
  // 面板不会因为路由参数变化重新挂载（onMounted 不再触发），必须自己把新记录读回列表，
  // 否则新建的项目在面板里看不到，用户会以为没建成功。
  await refresh();
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
    await refresh();
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

onMounted(refresh);
</script>

<style scoped>
/* 尺寸与 editor-sidebar.css 的 token 对齐：面板内头 32px、行 28px、控件圆角 6px。 */
.project-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 var(--panel-pad-x) 6px;
  min-height: 0;
  overflow: auto;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--panel-head-h);
  gap: 6px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.side-search {
  width: 100%;
  height: var(--control-h);
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg-card);
  color: inherit;
}
.side-search:focus {
  outline: none;
  border-color: var(--color-primary);
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
  gap: 6px;
  height: var(--row-h);
  padding: 0 8px;
  border-radius: var(--radius-control);
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
  justify-content: center;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.project-row-name {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-row-meta {
  font-size: 10px;
  line-height: 1.2;
  color: var(--color-text-tertiary);
}
.row-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}
.project-row:hover .row-btn,
.row-btn:focus-visible {
  opacity: 0.7;
}
.row-btn:hover {
  opacity: 1;
  background: var(--color-bg);
}
.row-btn.danger:hover {
  color: var(--color-danger);
}
.section-hint {
  margin: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
</style>
