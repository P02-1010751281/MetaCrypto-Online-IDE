/**
 * 代码 → 工作区（A/B 线入口）的壳层编排：打开面板、载入与否、回执。
 *
 * 为什么单拎出来：`App.vue` 是纯装配层，且有 500 行上限；这条路径要碰编辑器句柄、
 * Toast 与「画布已替换」补偿三样，写进 App 里只是把装配细节堆到壳上。
 * 载入必须走编辑器自己的 `loadWorkspace`（JSON 深嵌套检查、迁移、失败回滚都在那里），
 * 这里只做调用与回执，不直接碰 Blockly。
 *
 * 面板的可见性**不在这里**：A/B 线现在是左栏的第 5 个互斥面板，开关归 `useEditorPanels`
 * 的 `activePanel` 所有。这里只管「明确要打开」（菜单/快捷键入口）和「载入完收起」，
 * 因此不需要再维护一份 `visible`——两份状态迟早会不同步（浮层关掉、面板还亮着）。
 */

import { ui } from '@/composables/locale';
import type { SerializedWorkspace } from '@/services/ai-helper/reverse';

interface Options {
  /** 切到「从代码生成工作区」面板。 */
  openPanel: () => void;
  /** 载入完成后收起面板（回到缺省面板）。 */
  closePanel: () => void;
  /** 交给编辑器载入；返回 false 表示编辑器拒绝了这份状态（已自行回滚）。 */
  loadWorkspace: (state: SerializedWorkspace) => boolean;
  notify: (message: string, duration?: number) => void;
  /** 画布被整块替换后的补偿（刷新积木数、置脏）。 */
  afterApplied?: () => void;
  /** 打开面板前的收尾动作（例如收起顶栏下拉菜单）。 */
  beforeOpen?: () => void;
}

export function useCodeToWorkspaceImport(options: Options) {
  function openCodeToWorkspace(): void {
    options.beforeOpen?.();
    options.openPanel();
  }

  function onApplyReversedWorkspace(state: SerializedWorkspace): void {
    if (!options.loadWorkspace(state)) {
      options.notify(ui('codeToWorkspaceLoadFailed'), 6000);
      return;
    }
    options.afterApplied?.();
    options.closePanel();
    options.notify(ui('codeToWorkspaceLoaded'));
  }

  return { openCodeToWorkspace, onApplyReversedWorkspace };
}
