/**
 * 项目列表的单一数据源。
 *
 * 侧栏「项目」面板一直挂载着，改名/新建/删除都发生在别处（编辑器保存层、面板自身），
 * 各自调用一次 `projectStore.list()` 会得到互不相干的快照——这正是「改名后项目栏不变」
 * 的成因。这里用模块级 ref 保存一份列表，谁改动了项目就调 `refreshProjectList()`，
 * 面板只负责渲染这一份数据。
 */
import { ref } from 'vue';

import { projectStore } from '@/services/projects';
import type { ProjectRecord } from '@/services/projects';

const projects = ref<ProjectRecord[]>([]);
const loaded = ref(false);

function byUpdatedDesc(list: ProjectRecord[]): ProjectRecord[] {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/** 从存储重新读一遍项目列表；失败时保留上一份，只报错不抛。 */
export async function refreshProjectList(): Promise<void> {
  try {
    projects.value = byUpdatedDesc(await projectStore.list());
  } catch (err) {
    console.error('刷新项目列表失败:', err);
  } finally {
    loaded.value = true;
  }
}

/** 本地列表就地改名/改时间，省一次全量重读（保存成功后调用）。 */
export function patchProjectEntry(
  id: number | null,
  patch: Partial<Pick<ProjectRecord, 'name' | 'updatedAt'>>,
): void {
  if (id === null) return;
  const index = projects.value.findIndex((p) => p.id === id);
  if (index === -1) return;
  projects.value[index] = { ...projects.value[index], ...patch };
  projects.value = byUpdatedDesc(projects.value);
}

export function useProjectList() {
  return { projects, loaded, refresh: refreshProjectList, patch: patchProjectEntry };
}
