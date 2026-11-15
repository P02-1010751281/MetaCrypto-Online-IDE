import * as Blockly from 'blockly/core';
import { ui } from '@/composables/locale';
import { errorHandler } from '@/utils/errorHandler';
import { collectSboxFieldValues, fixSboxFieldsAfterLoad, fixSboxFieldsAfterXmlLoad } from './sbox-migration';

const MAX_BLOCK_NESTING = 256;

function exceedsWorkspaceNesting(workspace: Blockly.WorkspaceSvg): boolean {
  const pending: { block: Blockly.Block; depth: number }[] = workspace
    .getTopBlocks(false)
    .map((block) => ({ block, depth: 1 }));
  const visited = new Set<Blockly.Block>();

  while (pending.length > 0) {
    const { block, depth } = pending.pop()!;
    if (depth > MAX_BLOCK_NESTING) return true;
    if (visited.has(block)) continue;
    visited.add(block);

    const next = block.nextConnection?.targetBlock();
    if (next) pending.push({ block: next, depth: depth + 1 });
    for (const input of block.inputList) {
      const child = input.connection?.targetBlock();
      if (child) pending.push({ block: child, depth: depth + 1 });
    }
  }

  return false;
}

function exceedsJsonNesting(state: unknown): boolean {
  const root = state as Record<string, unknown> | null;
  const blocksState = root?.blocks as Record<string, unknown> | undefined;
  const initial = [blocksState?.blocks, blocksState?.shadows]
    .filter(Array.isArray)
    .flat() as unknown[];
  const pending = initial.map((block) => ({ block, depth: 1 }));

  while (pending.length > 0) {
    const { block: value, depth } = pending.pop()!;
    if (depth > MAX_BLOCK_NESTING) return true;
    if (!value || typeof value !== 'object') continue;
    const block = value as Record<string, unknown>;
    const next = block.next as Record<string, unknown> | undefined;
    if (next?.block) pending.push({ block: next.block, depth: depth + 1 });
    if (next?.shadow) pending.push({ block: next.shadow, depth: depth + 1 });

    const inputs = block.inputs as Record<string, unknown> | undefined;
    for (const inputValue of Object.values(inputs ?? {})) {
      const input = inputValue as Record<string, unknown> | null;
      if (input?.block) pending.push({ block: input.block, depth: depth + 1 });
      if (input?.shadow) pending.push({ block: input.shadow, depth: depth + 1 });
    }
  }

  return false;
}

function exceedsXmlNesting(xml: Element): boolean {
  const pending = Array.from(xml.children, (element) => ({
    element,
    depth: element.localName === 'block' || element.localName === 'shadow' ? 1 : 0,
  }));

  while (pending.length > 0) {
    const { element, depth } = pending.pop()!;
    if (depth > MAX_BLOCK_NESTING) return true;
    for (const child of Array.from(element.children)) {
      const isBlock = child.localName === 'block' || child.localName === 'shadow';
      pending.push({ element: child, depth: depth + Number(isBlock) });
    }
  }

  return false;
}

function reportExcessiveNesting(message = ui('workspaceNestingLimit')): void {
  errorHandler.handleError('WORKSPACE_ERROR', message);
}
import { migrateXmlText, migrateJsonState } from '@/utils/migration';
import { closeAllSboxPopups } from '@/blocks/sbox/sbox';

export const jsonTypes = ['.json', '.txt', 'text/json', 'application/json'];
export const xmlTypes = ['.xml', '.txt', 'text/xml', 'application/xml'];
export const validTypes = [...jsonTypes, ...xmlTypes];

/** 导入文件大小上限（Blockly 教学工作区通常几 KB；5MB 防超大文件卡死/内存耗尽） */
export const MAX_IMPORT_SIZE = 5 * 1024 * 1024;

export async function handleFileUpload(
  file: File,
  workspace: Blockly.WorkspaceSvg | null,
  callback: (
    _workspace: Blockly.WorkspaceSvg | null,
    _content: string,
  ) => boolean,
): Promise<boolean> {
  if (!file) {
    console.error('文件不存在');
    return false;
  }

  if (!workspace) {
    console.error('工作空间不存在');
    return false;
  }

  if (file.size > MAX_IMPORT_SIZE) {
    console.error('文件过大，已拒绝导入（上限 5MB）:', file.name, file.size);
    return false;
  }

  const isValidType = validTypes.some(
    (type) =>
      file.name.toLowerCase().endsWith(type) || file.type.includes(type),
  );

  if (!isValidType) {
    console.error('不支持的文件类型:', file.type, file.name);
    return false;
  }

  try {
    const reader = new FileReader();
    const content = await new Promise<string>((resolve, reject) => {
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) =>
        reject(
          new Error(`文件读取失败: ${e.target?.error?.message || '未知错误'}`),
        );
      reader.readAsText(file);
    });

    return callback(workspace, content);
  } catch (error) {
    console.error('文件读取或处理失败:', error);
    return false;
  }
}

export async function downloadContent(
  content: string,
  filename: string,
): Promise<string | null> {
  if (!content) {
    throw new Error('没有可下载的内容');
  }

  if (!filename) {
    throw new Error('没有文件名');
  }

  // Tauri imports are optional in a browser build.
  let tauri: typeof import('@tauri-apps/plugin-dialog') | undefined;
  let tauriFs: typeof import('@tauri-apps/plugin-fs') | undefined;
  try {
    [tauri, tauriFs] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
  } catch {
    // Tauri plugins are not installed in a browser runtime.
  }

  if (tauri && tauriFs) {
    let filePath: string | null | undefined;
    try {
      filePath = await tauri.save({
        defaultPath: filename,
        filters: [{ name: 'Workspace', extensions: ['json', 'xml'] }],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      // A browser build may resolve the plugin package without having Tauri IPC.
    }
    if (filePath === null) return null;
    if (filePath) {
      await tauriFs.writeTextFile(filePath, content);
      return filePath;
    }
  }

  // 浏览器回退：showSaveFilePicker (File System Access API)
  // 让用户可以选择保存位置并替换已有文件
  // 注意：仅 Chromium 浏览器支持 (Chrome/Edge)，Firefox/Safari 不适用
  if ('showSaveFilePicker' in window) {
    const blob = new Blob([content], { type: 'text/plain' });
    type FileSystemWritable = { write: (_b: Blob) => Promise<void>; close: () => Promise<void> };
    type FileSystemFileHandle = { name?: string; createWritable: () => Promise<FileSystemWritable> };
    const win = window as unknown as { showSaveFilePicker?: (_o: { suggestedName?: string }) => Promise<FileSystemFileHandle> };
    let fileHandle: FileSystemFileHandle | undefined;
    try {
      fileHandle = await win.showSaveFilePicker!({ suggestedName: filename });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      // A picker failure can fall back to the ordinary download link.
    }
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return fileHandle.name || filename;
    }
  }

  // 浏览器回退：Blob URL 下载
  const blob = new Blob([content], { type: 'text/plain' });
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    return filename;
  } finally {
    if (url) {
      const objectUrl = url;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
    link?.remove();
  }
}

export function loadXml(
  workspace: Blockly.WorkspaceSvg | null,
  xmlText: string,
): boolean {
  if (!workspace) {
    console.error('工作空间不存在');
    return false;
  }
  if (!xmlText || xmlText.trim() === '') {
    console.error('XML 内容为空');
    return false;
  }

  if (exceedsWorkspaceNesting(workspace)) {
    reportExcessiveNesting(ui('workspaceCurrentNestingLimit'));
    return false;
  }

  let previousXml: Element | null = null;
  try {
    const migratedXml = migrateXmlText(xmlText);
    const xmlDom = Blockly.utils.xml.textToDom(migratedXml);
    if (exceedsXmlNesting(xmlDom)) {
      reportExcessiveNesting();
      return false;
    }
    previousXml = Blockly.Xml.workspaceToDom(workspace);

    closeAllSboxPopups();
    Blockly.Events.disable();
    try {
      workspace.clear();
      Blockly.Xml.domToWorkspace(xmlDom, workspace);
    } finally {
      Blockly.Events.enable();
    }

    fixSboxFieldsAfterXmlLoad(workspace, migratedXml);

    return true;
  } catch (error) {
    console.error('导入 XML 失败:', error);
    if (previousXml) {
      try {
        Blockly.Events.disable();
        workspace.clear();
        Blockly.Xml.domToWorkspace(previousXml, workspace);
      } catch (restoreError) {
        console.error('恢复 XML 工作空间失败:', restoreError);
      } finally {
        Blockly.Events.enable();
      }
    }
    return false;
  }
}

export function exportXml(workspace: Blockly.WorkspaceSvg | null): string {
  if (!workspace) {
    console.error('工作空间不存在');
    return '';
  }
  if (exceedsWorkspaceNesting(workspace)) {
    reportExcessiveNesting();
    return '';
  }
  try {
    const xmlDom = Blockly.Xml.workspaceToDom(workspace);
    const xmlText = Blockly.Xml.domToText(xmlDom);
    return xmlText;
  } catch (error) {
    console.error('导出 XML 失败:', error);
    return '';
  }
}

export function loadJson(
  workspace: Blockly.WorkspaceSvg | null,
  jsonText: string,
): boolean {
  if (!workspace) {
    console.error('工作空间不存在');
    return false;
  }

  if (!jsonText || jsonText.trim() === '') {
    console.error('JSON 内容为空');
    return false;
  }

  let state: object;
  try {
    state = JSON.parse(jsonText);
  } catch (error) {
    console.error('JSON 解析失败:', error);
    return false;
  }

  if (exceedsJsonNesting(state)) {
    reportExcessiveNesting();
    return false;
  }
  if (exceedsWorkspaceNesting(workspace)) {
    reportExcessiveNesting(ui('workspaceCurrentNestingLimit'));
    return false;
  }

  let migratedState: Record<string, unknown>;
  try {
    migratedState = migrateJsonState(state as Record<string, unknown>);
  } catch (error) {
    console.error('迁移 JSON 工作区失败:', error);
    return false;
  }

  let previousState: ReturnType<typeof Blockly.serialization.workspaces.save> | null = null;
  try {
    previousState = Blockly.serialization.workspaces.save(workspace);
    closeAllSboxPopups();
    Blockly.Events.disable();
    try {
      workspace.clear();
      Blockly.serialization.workspaces.load(migratedState, workspace);
    } finally {
      Blockly.Events.enable();
    }

    // 仅对旧格式（_sbx_def_）执行兼容修复；新格式 SBox_* 已在 fields 中由 Blockly 原生加载
    // 单次遍历同时完成检测与字段收集（不再 detect + collect 两次全树递归）
    const legacyFound = { value: false };
    const sboxFieldValues = collectSboxFieldValues(
      migratedState as Record<string, unknown>,
      new Map(),
      legacyFound,
    );
    if (legacyFound.value) {
      fixSboxFieldsAfterLoad(workspace, sboxFieldValues);
    }

    return true;
  } catch (error) {
    console.error('加载 JSON 到工作空间失败:', error);
    if (previousState) {
      try {
        Blockly.Events.disable();
        workspace.clear();
        Blockly.serialization.workspaces.load(previousState, workspace);
      } catch (restoreError) {
        console.error('恢复 JSON 工作空间失败:', restoreError);
      } finally {
        Blockly.Events.enable();
      }
    }
    return false;
  }
}

export function exportJson(workspace: Blockly.WorkspaceSvg | null): string {
  if (!workspace) {
    console.error('工作空间未初始化');
    return '';
  }
  if (exceedsWorkspaceNesting(workspace)) {
    reportExcessiveNesting();
    return '';
  }

  try {
    // 使用 Blockly 原生工作区序列化，保留 next、inputs、坐标和扩展状态。
    // 与手工拍平链不同，原生格式可被 loadJson 无损恢复。
    return JSON.stringify(Blockly.serialization.workspaces.save(workspace));
  } catch (error) {
    console.error('导出 JSON 失败:', error);
    return '';
  }
}
