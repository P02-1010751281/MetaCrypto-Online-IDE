/**
 * 多文件项目的文件清单纯函数。
 *
 * 状态放在 useProjectFiles 里，这里只做「给定输入算出新值」，
 * 便于单测覆盖迁移、重名、删入口等边界，视图层不重复这些判断。
 */
import type { ProjectFileRecord, ProjectRecord } from '@/services/projects/ProjectStore';

const DEFAULT_FILE_NAME = 'main.block.json';

/** 规范化文件名：去掉路径分隔与控制字符，补上 .block.json 后缀。 */
export function normalizeFileName(raw: string, fallback = DEFAULT_FILE_NAME): string {
  const trimmed = String(raw || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
  if (!trimmed) return fallback;
  return /\.(block\.)?(json|xml)$/i.test(trimmed) ? trimmed : `${trimmed}.block.json`;
}

/**
 * 取项目的文件清单：老项目只有 workspace，视为「单文件 + 入口」。
 * 迁移只发生在读取时，不写回旧记录，避免打开列表页就触发写库。
 */
export function normalizeProjectFiles(record: Pick<ProjectRecord, 'workspace' | 'files' | 'format'>): ProjectFileRecord[] {
  const stored = Array.isArray(record.files) ? record.files : [];
  const files = stored
    .filter((file) => file && typeof file.fileId === 'string' && file.fileId)
    .map((file) => ({
      fileId: file.fileId,
      name: normalizeFileName(file.name),
      workspace: typeof file.workspace === 'string' ? file.workspace : '',
      format: file.format ?? record.format ?? 'json',
      isEntry: Boolean(file.isEntry),
    }));
  if (files.length > 0) return files;
  return [
    {
      fileId: 'file-main',
      name: DEFAULT_FILE_NAME,
      workspace: typeof record.workspace === 'string' ? record.workspace : '',
      format: record.format ?? 'json',
      isEntry: true,
    },
  ];
}

/** 入口文件 id：显式指定 → isEntry 标记 → 第一个文件。 */
export function pickEntryFileId(files: ProjectFileRecord[], preferred?: string): string {
  if (preferred && files.some((file) => file.fileId === preferred)) return preferred;
  const marked = files.find((file) => file.isEntry);
  return (marked ?? files[0])?.fileId ?? '';
}

/** 生成不重名的文件名（helper.block.json → helper-2.block.json）。 */
export function uniqueFileName(files: ProjectFileRecord[], base: string): string {
  const target = normalizeFileName(base);
  const taken = new Set(files.map((file) => file.name.toLowerCase()));
  if (!taken.has(target.toLowerCase())) return target;
  const match = /^(.*?)(\.block\.(?:json|xml))$/i.exec(target);
  const stem = match ? match[1] : target;
  const ext = match ? match[2] : '';
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

let fileSeq = 0;

/** 新建一个空文件（不改变入口标记）。 */
export function createProjectFile(files: ProjectFileRecord[], base = 'untitled'): ProjectFileRecord {
  fileSeq += 1;
  return {
    fileId: `file-${Date.now().toString(36)}-${fileSeq}`,
    name: uniqueFileName(files, base),
    workspace: '',
    format: 'json',
    isEntry: false,
  };
}

/** 重命名：只改展示名，重名时自动加序号。返回新数组。 */
export function renameProjectFile(
  files: ProjectFileRecord[],
  fileId: string,
  nextName: string,
): ProjectFileRecord[] {
  const others = files.filter((file) => file.fileId !== fileId);
  const name = uniqueFileName(others, normalizeFileName(nextName));
  return files.map((file) => (file.fileId === fileId ? { ...file, name } : file));
}

/**
 * 删除文件后的新状态。入口文件被删时，入口顺延到第一个剩余文件。
 * 返回 null 表示这是最后一个文件，不允许删除。
 */
export function removeProjectFile(
  files: ProjectFileRecord[],
  fileId: string,
): { files: ProjectFileRecord[]; entryFileId: string } | null {
  if (files.length <= 1) return null;
  const next = files.filter((file) => file.fileId !== fileId);
  return { files: next, entryFileId: pickEntryFileId(next) };
}

/** 标记入口文件（同时清掉其它文件的 isEntry）。 */
export function markEntryFile(files: ProjectFileRecord[], fileId: string): ProjectFileRecord[] {
  return files.map((file) => ({ ...file, isEntry: file.fileId === fileId }));
}

/** 把某个文件的 workspace 负载替换为新内容。 */
export function updateFileWorkspace(
  files: ProjectFileRecord[],
  fileId: string,
  workspace: string,
  format?: 'json' | 'xml',
): ProjectFileRecord[] {
  return files.map((file) =>
    file.fileId === fileId
      ? { ...file, workspace, ...(format ? { format } : {}) }
      : file,
  );
}
