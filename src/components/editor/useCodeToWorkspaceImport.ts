/**
 * 代码 → 工作区（A/B 线入口）的壳层编排：浮层开合、载入与否、回执。
 *
 * 为什么单拎出来：`App.vue` 是纯装配层，且有 500 行上限；这条路径要碰编辑器句柄、
 * Toast 与「画布已替换」补偿三样，写进 App 里只是把装配细节堆到壳上。
 * 载入必须走编辑器自己的 `loadWorkspace`（JSON 深嵌套检查、迁移、失败回滚都在那里），
 * 这里只做调用与回执，不直接碰 Blockly。
 */

import { ref, type Ref } from 'vue';

import { ui } from '@/composables/locale';
import type { SerializedWorkspace } from '@/services/ai-helper/reverse';

interface Options {
  /** 交给编辑器载入；返回 false 表示编辑器拒绝了这份状态（已自行回滚）。 */
  loadWorkspace: (state: SerializedWorkspace) => boolean;
  notify: (message: string, duration?: number) => void;
  /** 画布被整块替换后的补偿（刷新积木数、置脏）。 */
  afterApplied?: () => void;
  /** 打开浮层前的收尾动作（例如收起顶栏下拉菜单）。 */
  beforeOpen?: () => void;
}

export function useCodeToWorkspaceImport(options: Options) {
  const codeToWorkspaceVisible = ref(false) as Ref<boolean>;

  function openCodeToWorkspace(): void {
    options.beforeOpen?.();
    codeToWorkspaceVisible.value = true;
  }

  function closeCodeToWorkspace(): void {
    codeToWorkspaceVisible.value = false;
  }

  function onApplyReversedWorkspace(state: SerializedWorkspace): void {
    if (!options.loadWorkspace(state)) {
      options.notify(ui('codeToWorkspaceLoadFailed'), 6000);
      return;
    }
    options.afterApplied?.();
    codeToWorkspaceVisible.value = false;
    options.notify(ui('codeToWorkspaceLoaded'));
  }

  return {
    codeToWorkspaceVisible,
    openCodeToWorkspace,
    closeCodeToWorkspace,
    onApplyReversedWorkspace,
  };
}
