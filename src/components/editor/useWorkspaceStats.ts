/**
 * 状态栏积木数与「画布变了」的单一出口。
 *
 * 两条路径都要刷新这个数：用户拖块（change 事件）与画布被整块替换（切文件、导入、
 * 从代码载入）。后者不会发 change——Blockly 的载入把 clear + load 包在 Events.disable()
 * 里——所以必须有 `onWorkspaceChanged` 这个共同入口，不能各写一遍。
 */

import { ref, type Ref } from 'vue';

import type { WorkspaceReader } from './editor-handles';

interface Options {
  /** 当前画布（画布实例会随编辑器挂载/重建变化，所以传取函数）。 */
  workspace: () => WorkspaceReader | null;
  /** 画布内容确实变了：交给保存层置脏。 */
  markDirty: () => void;
}

export function useWorkspaceStats(options: Options) {
  const blockCount = ref(0) as Ref<number>;

  /** 只刷新底部积木数（切换文件 / 新建文件这类「画布被换掉」的场景）。 */
  function refreshBlockCount(): void {
    blockCount.value = options.workspace()?.getAllBlocks(false).length ?? 0;
  }

  /** 用户真的改了画布：刷新积木数并交给保存层置脏。 */
  function onWorkspaceChanged(): void {
    refreshBlockCount();
    options.markDirty();
  }

  return { blockCount, refreshBlockCount, onWorkspaceChanged };
}
