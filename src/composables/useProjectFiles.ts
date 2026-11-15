/**
 * 多文件项目的响应式状态。
 *
 * 职责边界：
 * - 这里只认「文件清单 + 当前文件 + 入口文件」，不碰 Blockly 实例；
 *   工作区内容由调用方通过 snapshot / loadInto 传进来（编辑器是异步加载的）。
 * - 持久化走 ProjectStore 端口，切换文件前必须由调用方先 syncActiveWorkspace，
 *   否则当前文件的改动只留在 Blockly 里，落库时会丢。
 */
import { computed, ref } from 'vue';
import type { ProjectFileRecord, ProjectRecord } from '@/services/projects/ProjectStore';
import {
  createProjectFile,
  markEntryFile,
  normalizeProjectFiles,
  pickEntryFileId,
  removeProjectFile,
  renameProjectFile,
  updateFileWorkspace,
} from '@/utils/projectFiles';

export function useProjectFiles() {
  const files = ref<ProjectFileRecord[]>([]);
  const activeFileId = ref<string>('');
  const entryFileId = ref<string>('');

  const activeFile = computed<ProjectFileRecord | undefined>(
    () => files.value.find((file) => file.fileId === activeFileId.value),
  );

  /** 用一条项目记录初始化（老项目在这里完成单文件 → 多文件迁移）。 */
  function applyProject(record: Pick<ProjectRecord, 'workspace' | 'files' | 'entryFileId' | 'format'>): void {
    const next = normalizeProjectFiles(record);
    files.value = next;
    entryFileId.value = pickEntryFileId(next, record.entryFileId);
    const entry = next.find((file) => file.fileId === entryFileId.value) ?? next[0];
    activeFileId.value = entry?.fileId ?? '';
  }

  /** 供 useEditorProject 落库：先把当前工作区内容写回活动文件。 */
  function snapshot(): { files: ProjectFileRecord[]; entryFileId: string } {
    return {
      files: files.value.map((file) => ({ ...file })),
      entryFileId: entryFileId.value || pickEntryFileId(files.value),
    };
  }

  /** 把活动文件的工作区负载替换为最新内容（切换/保存前调用）。 */
  function syncActiveWorkspace(workspace: string, format?: 'json' | 'xml'): void {
    if (!activeFileId.value) return;
    files.value = updateFileWorkspace(files.value, activeFileId.value, workspace, format);
  }

  function addFile(base = 'untitled'): ProjectFileRecord {
    const file = createProjectFile(files.value, base);
    files.value = [...files.value, file];
    return file;
  }

  function renameFile(fileId: string, nextName: string): void {
    files.value = renameProjectFile(files.value, fileId, nextName);
  }

  /** 删除文件；最后一个文件不允许删（返回 false 让调用方给出提示）。 */
  function removeFile(fileId: string): boolean {
    const next = removeProjectFile(files.value, fileId);
    if (!next) return false;
    files.value = next.files;
    entryFileId.value = next.entryFileId;
    if (activeFileId.value === fileId) {
      activeFileId.value = next.entryFileId || next.files[0]?.fileId || '';
    }
    return true;
  }

  function setEntry(fileId: string): void {
    files.value = markEntryFile(files.value, fileId);
    entryFileId.value = fileId;
  }

  function selectFile(fileId: string): boolean {
    if (!files.value.some((file) => file.fileId === fileId)) return false;
    activeFileId.value = fileId;
    return true;
  }

  return {
    files,
    activeFileId,
    entryFileId,
    activeFile,
    applyProject,
    snapshot,
    syncActiveWorkspace,
    addFile,
    renameFile,
    removeFile,
    setEntry,
    selectFile,
  };
}
