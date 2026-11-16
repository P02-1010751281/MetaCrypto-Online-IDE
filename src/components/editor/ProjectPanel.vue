<template>
  <!-- 窄屏浮层：点卡片外部关闭；卡片在遮罩上层，点卡片本身不会冒到遮罩。 -->
  <div
    v-if="overlay"
    class="panel-backdrop"
    :style="{ top: `${popoverTop - 4}px` }"
    @click.self="emit('close')"
  ></div>
  <section
    class="project-panel"
    :class="{ 'project-panel--popover': overlay }"
    :style="overlay ? { top: `${popoverTop}px` } : undefined"
  >
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
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ui } from '@/composables/locale';
import { projectStore } from '@/services/projects';
import type { ProjectRecord } from '@/services/projects';
import { useProjectList } from './useProjectList';

const props = defineProps<{ currentId: number | null; overlay?: boolean }>();
const emit = defineEmits<{ (_e: 'close'): void }>();

/**
 * 窄屏浮层的纵向位置：横条高度随断点变（≤1200px 单行 43px，≤560px 折成两行），
 * 写死像素会在折行时压住横条第二行，所以按侧栏实际底边算，并在窗口尺寸变化时重算。
 */
const popoverTop = ref(47);
function syncPopoverTop(): void {
  const bar = document.querySelector('.editor-sidebar');
  popoverTop.value = bar ? Math.round(bar.getBoundingClientRect().bottom + 4) : 47;
}
function onWindowResize(): void {
  if (props.overlay) syncPopoverTop();
}
// 只用得到 key，写成结构类型：KeyboardEvent 没进仓库 eslint 的 globals 白名单。
function onKeydown(event: { key: string }): void {
  if (props.overlay && event.key === 'Escape') emit('close');
}

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
  if (props.overlay) emit('close');
}

function openProject(id: number): void {
  if (id !== props.currentId) void router.push(`/editor/${id}`);
  // 浮层盖在画布上，选完就收起；宽屏是常驻面板，保持展开。
  if (props.overlay) emit('close');
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

onMounted(() => {
  syncPopoverTop();
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('keydown', onKeydown);
  void refresh();
});

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('keydown', onKeydown);
});
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
/* 面板头 / 标题 / 图标按钮由 styles/panel-chrome.css 统一提供，
   这里不再各写一份——之前的副本把字重写成 600 且漏了 .ghost-btn。 */
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
/* 项目行是两行（名称 + 修改时间）：用单行 --row-h(28px) 装两行文字会把时间
   溢出到行外（实测内容 32.5px > 28px，时间压到下一行上），改用两行行高 token。 */
.project-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: var(--row-h-2l);
  padding: 3px 8px;
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
  /* 显式行高：不给的话浏览器按「正常」算出 19.5px，两行合计会超出行高。 */
  line-height: 18px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-row-meta {
  font-size: 10px;
  line-height: 14px;
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

/* 窄屏（≤1200px）把项目面板改成下拉浮层；宽屏仍是常驻面板。 */
@media (max-width: 1200px) {
  /* 这些规则必须写在组件自身：面板是 App 传进 EditorSidebar 的 slot 内容，
     拿不到侧栏的 scoped 哈希，写在 editor-sidebar.css 里匹配不到。 */
  /* 窄屏把「项目」做成下拉浮层而不是铺进横条：铺进横条时横条会随项目数变高
     （实测 11 个项目 421px），开合面板还会让画布重排。浮层用 fixed 脱离布局，
     横条恒为一行，画布不动。 */
  /* 遮罩从横条下沿开始：横条里的活动条必须仍可点，否则开面板时点「函数」会被
     遮罩吞掉，只剩「回到文件面板」这一个结果。 */
  .panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
  }

  .project-panel--popover {
    position: fixed;
    left: 8px;
    width: min(360px, calc(100vw - 16px));
    max-height: 60vh;
    overflow-y: auto;
    padding: 0 var(--panel-pad-x) 6px;
    background: var(--color-bg-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 28px rgb(0 0 0 / 18%);
    z-index: 401;
  }
}
</style>
