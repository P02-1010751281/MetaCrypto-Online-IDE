/**
 * 编辑器壳的多文件操作编排。
 *
 * 抽出来的理由不是行数，是顺序：切换 / 新建 / 删除文件之前都必须先把画布里
 * 的最新内容写回活动文件，否则改动只活在 Blockly 内存里，一落库就丢。这条
 * 顺序以前散在 App.vue 的六个事件处理里、只靠注释维持；现在集中在这里，
 * 并由 tests/unit/editor-file-actions.test.ts 锁住。
 */
import type { Ref } from 'vue';
import type { WorkspaceHandle } from '@/components/editor/editor-handles';
import { ui } from '@/composables/locale';
import { useProjectFiles } from '@/composables/useProjectFiles';
import type {
  ProjectFileRecord,
  ProjectRecord,
} from '@/services/projects/ProjectStore';

interface Options {
  /** BlocklyEditor 实例（挂载前为 null）。 */
  editor: Ref<WorkspaceHandle | null>;
  /** 文件清单变化后置保存层的脏标记，由 useEditorProject 提供。 */
  markFilesChanged: () => void;
  /** 轻提示（如「至少保留一个文件」）。 */
  notify: (message: string) => void;
  /**
   * 画布内容被换掉后的刷新回调（切换文件、新建文件清空）。
   * Blockly 的载入路径在 Events.disable() 里，不会触发 change，壳里的派生状态
   * （底部积木数）必须在这里补一次；这里刻意不置脏——单纯切换文件不是编辑。
   */
  afterWorkspaceSwitch?: () => void;
}

export function useEditorFileActions(options: Options) {
  const { editor, markFilesChanged, notify, afterWorkspaceSwitch } = options;
  const projectFiles = useProjectFiles();
  const { files, activeFileId, entryFileId, activeFile } = projectFiles;

  /** 当前画布负载（XML）。 */
  const activeFileXml = (): string => editor.value?.exportWorkspace('xml') || '';

  /** 把画布最新内容写回活动文件；切换 / 新建 / 删除 / 保存前必须先调用。 */
  function syncActiveFile(): void {
    projectFiles.syncActiveWorkspace(activeFileXml(), 'xml');
  }

  /** 把某个文件的负载装进画布（空文件等价于清空）。 */
  function loadFileIntoWorkspace(fileId: string): void {
    const file = files.value.find((item) => item.fileId === fileId);
    if (!file) return;
    if (!file.workspace) {
      editor.value?.clearWorkspace();
      afterWorkspaceSwitch?.();
      return;
    }
    editor.value?.loadWorkspace(
      file.workspace,
      file.format === 'json' ? 'json' : 'xml',
    );
    afterWorkspaceSwitch?.();
  }

  function onSelectProjectFile(fileId: string): void {
    if (fileId === activeFileId.value) return;
    syncActiveFile();
    if (!projectFiles.selectFile(fileId)) return;
    loadFileIntoWorkspace(fileId);
  }

  function onAddProjectFile(): void {
    syncActiveFile();
    const file = projectFiles.addFile('untitled');
    projectFiles.selectFile(file.fileId);
    editor.value?.clearWorkspace();
    afterWorkspaceSwitch?.();
    markFilesChanged();
  }

  function onRenameProjectFile(fileId: string, name: string): void {
    projectFiles.renameFile(fileId, name);
    markFilesChanged();
  }

  function onDeleteProjectFile(fileId: string): void {
    const wasActive = fileId === activeFileId.value;
    if (!projectFiles.removeFile(fileId)) {
      notify(ui('keepOneFile'));
      return;
    }
    // removeFile 已把 activeFileId 挪到入口文件（或剩余第一个），这里照它装载。
    if (wasActive) loadFileIntoWorkspace(activeFileId.value);
    markFilesChanged();
  }

  function onSetEntryFile(fileId: string): void {
    projectFiles.setEntry(fileId);
    markFilesChanged();
    notify(ui('entryFile'));
  }

  // ---- 供 useEditorProject 的落库钩子（保存层不直接碰 useProjectFiles）----

  /**
   * 载入项目时初始化文件清单，返回要装进画布的入口负载**与格式**。
   *
   * 格式必须一起回传：JSON 工程按 XML 解析会失败（画布被清空、状态显示「加载失败」），
   * 而项目记录里的 `format` 是旧的单文件字段，多文件时以入口文件自己的 `format` 为准。
   */
  function applyProject(
    record: Pick<ProjectRecord, 'workspace' | 'files' | 'entryFileId' | 'format'>,
  ): { workspace: string; format?: 'json' | 'xml' } {
    projectFiles.applyProject(record);
    return {
      workspace: activeFile.value?.workspace ?? record.workspace ?? '',
      format: activeFile.value?.format ?? record.format,
    };
  }

  function getFiles(): ProjectFileRecord[] {
    syncActiveFile();
    return projectFiles.snapshot().files;
  }

  function getEntryFileId(): string {
    return entryFileId.value;
  }

  function getEntryWorkspace(): string {
    syncActiveFile();
    const entry = files.value.find(
      (file) => file.fileId === entryFileId.value,
    );
    return entry?.workspace || '';
  }

  return {
    files,
    activeFileId,
    entryFileId,
    activeFile,
    activeFileXml,
    syncActiveFile,
    loadFileIntoWorkspace,
    onSelectProjectFile,
    onAddProjectFile,
    onRenameProjectFile,
    onDeleteProjectFile,
    onSetEntryFile,
    applyProject,
    getFiles,
    getEntryFileId,
    getEntryWorkspace,
  };
}
