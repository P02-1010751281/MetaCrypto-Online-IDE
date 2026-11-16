/**
 * 编辑器壳的工作区级动作：下拉菜单、导入 / 导出、清空、生成代码。
 *
 * 这里的每一步都要碰 Blockly 实例，所以只依赖 editor-handles 的两个最小句柄面；
 * 生成前必须先回写活动文件并等一次渲染，否则 CodePanel 拿到的是上一份快照。
 */
import { nextTick, ref, type Ref } from 'vue';
import type { CodeHandle, WorkspaceHandle } from '@/components/editor/editor-handles';
import { ui } from '@/composables/locale';

interface Options {
  editor: Ref<WorkspaceHandle | null>;
  codePanel: Ref<CodeHandle | null>;
  /** 生成 / 保存前把画布回写活动文件（多文件项目必需）。 */
  syncActiveFile: () => void;
  exportFormat: Ref<'json' | 'xml'>;
  notify: (message: string, duration?: number) => void;
  /**
   * 画布被整块替换后的补偿回调（导入工作区）。
   * Blockly 的载入路径把 clear + load 包在 Events.disable() 里，不会触发 change；
   * 不补这一次，底部积木数会停在导入前的值，保存层也不知道内容已变。
   */
  afterWorkspaceReplaced?: () => void;
}

export function useEditorWorkspaceActions(options: Options) {
  const { editor, codePanel, syncActiveFile, exportFormat, notify } = options;
  const { afterWorkspaceReplaced } = options;

  // ---- 下拉菜单 ----
  const openMenu = ref('');
  const toggleMenu = (menu: string): void => {
    openMenu.value = openMenu.value === menu ? '' : menu;
  };
  const closeMenus = (): void => {
    openMenu.value = '';
  };

  // ---- 导入 ----
  const onImportFile = (file: File): void => {
    if (!editor.value) return;
    editor.value
      .handleFileUpload(file)
      .then((success: boolean) => {
        if (!success) {
          console.error('文件导入失败:', file.name);
          return;
        }
        afterWorkspaceReplaced?.();
      })
      .catch((error: Error) => {
        console.error('文件导入错误:', error);
      });
  };

  // ---- 导出 ----
  async function handleExport(): Promise<void> {
    openMenu.value = '';
    if (!editor.value) return;
    const filename =
      exportFormat.value === 'xml'
        ? 'blockly_workspace.xml'
        : 'blockly_workspace.json';
    try {
      const savedTo = await editor.value.downloadWorkspace(filename);
      if (!savedTo) return;
      notify(`${ui('exported')}: ${savedTo}`, 4000);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notify(`${ui('exportError')}: ${detail}`, 6000);
    }
  }

  // ---- 清空 ----
  function handleClear(): void {
    openMenu.value = '';
    editor.value?.clearWorkspace();
    codePanel.value?.clearCode();
  }

  // ---- 生成代码 ----
  async function generateCode(): Promise<void> {
    // 多文件：先把画布最新内容回写活动文件，并等 Vue 把新 files 推给
    // CodePanel，否则生成的是上一次的快照。
    syncActiveFile();
    await nextTick();
    codePanel.value?.generateCode();
  }

  return {
    openMenu,
    toggleMenu,
    closeMenus,
    onImportFile,
    handleExport,
    handleClear,
    generateCode,
  };
}
