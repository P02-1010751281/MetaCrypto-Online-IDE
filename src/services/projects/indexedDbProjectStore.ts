/**
 * ProjectStore 的单机实现：浏览器 IndexedDB。
 *
 * 本文件只做语义映射，不搬动 IndexedDB 细节——细节仍在
 * src/composables/useProjectDB.ts（DB 名、版本、事务都在那里）。
 * 这里用薄箭头函数转发，保持导入绑定在调用时解析，测试仍可用
 * vi.mock('@/composables/useProjectDB') 整模块替换。
 */
import {
  closeDB,
  deleteProject,
  getAllProjects,
  getProject,
  saveProject,
} from '@/composables/useProjectDB';
import type { ProjectRecord, ProjectStore } from './ProjectStore';

export const indexedDbProjectStore: ProjectStore<number> = {
  list: () => getAllProjects(),
  get: (id) => getProject(id),
  save: (record) => saveProject(record),
  async rename(id, name) {
    const record = await getProject(id);
    if (!record) {
      throw new Error(`Project ${id} was not found`);
    }
    const next: ProjectRecord<number> = {
      ...record,
      name,
      updatedAt: new Date().toISOString(),
    };
    await saveProject(next);
  },
  remove: (id) => deleteProject(id),
  close: () => closeDB(),
};
