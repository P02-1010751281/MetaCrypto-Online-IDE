// @vitest-environment jsdom
/**
 * 端口可替换性证明：编辑器只依赖 ProjectStore，
 * 注入一个内存实现即可工作——不 mock 模块，也不碰 IndexedDB
 * （jsdom 没有 indexedDB，若误用了默认实现这里会直接抛错）。
 */
import { createApp, h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  afterEach: vi.fn(() => () => {}),
  onError: vi.fn(() => () => {}),
}));
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  const route = reactive(routeState);
  return {
    useRoute: () => route,
    useRouter: () => routerMock,
    onBeforeRouteLeave: vi.fn(),
    onBeforeRouteUpdate: vi.fn(),
  };
});

import { useEditorProject } from '@/composables/useEditorProject';
import type { ProjectRecord, ProjectStore } from '@/services/projects/ProjectStore';

function createMemoryStore() {
  const records = new Map<number, ProjectRecord<number>>();
  let nextId = 1;
  const store: ProjectStore<number> = {
    list: async () => [...records.values()],
    get: async (id) => records.get(id),
    save: async (record) => {
      const id = record.id ?? nextId++;
      records.set(id, { ...record, id });
      return id;
    },
    rename: async (id, name) => {
      const current = records.get(id);
      if (current) records.set(id, { ...current, name });
    },
    remove: async (id) => {
      records.delete(id);
    },
  };
  return { store, records };
}

describe('ProjectStore 端口', () => {
  it('注入内存实现即可保存与读取项目', async () => {
    const { store, records } = createMemoryStore();
    let project!: ReturnType<typeof useEditorProject>;
    const app = createApp({
      setup() {
        project = useEditorProject({
          getWorkspaceXml: () => '<xml>seam</xml>',
          language: ref('python'),
          loadWorkspace: () => true,
          onWorkspaceChange: () => () => {},
          clearWorkspace: () => {},
          store,
        });
        return () => h('div');
      },
    });
    const host = document.createElement('div');
    app.mount(host);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(await project.doSave()).toBe(true);
    expect(project.projectId.value).toBe(1);
    expect(records.size).toBe(1);
    expect(records.get(1)?.workspace).toBe('<xml>seam</xml>');
    // 端口生效：路由被替换到新项目
    expect(routerMock.replace).toHaveBeenCalledWith('/editor/1');

    await store.rename(1, 'renamed');
    expect(records.get(1)?.name).toBe('renamed');
    await store.remove(1);
    expect(records.size).toBe(0);

    app.unmount();
  });
});
