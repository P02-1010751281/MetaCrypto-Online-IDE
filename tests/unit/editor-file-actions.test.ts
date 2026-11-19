/**
 * 编辑器壳的多文件编排顺序。
 *
 * 这里锁的是一个「顺序不变量」：切换 / 新建 / 删除之前必须先把画布内容回写
 * 活动文件。把它写成单测的原因很实际——以前这条顺序只存在于 App.vue 的注释里，
 * 没有任何断言能挡住「先切换后回写」的回归，而那个回归的后果是用户改动静默丢失。
 */
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useEditorFileActions } from '@/components/editor/useEditorFileActions';
import { useEditorWorkspaceActions } from '@/components/editor/useEditorWorkspaceActions';
import type {
  CodeHandle,
  WorkspaceHandle,
} from '@/components/editor/editor-handles';
import { ui } from '@/composables/locale';

function createFakeEditor(initial = '<xml id="canvas">') {
  const calls: string[] = [];
  let content = initial;
  const handle: WorkspaceHandle = {
    exportWorkspace: (format) => {
      calls.push(`export:${format}`);
      return content;
    },
    loadWorkspace: (text, type) => {
      calls.push(`load:${type}:${text}`);
      content = text;
      return true;
    },
    clearWorkspace: () => {
      calls.push('clear');
      content = '';
    },
    resizeWorkspace: () => {
      calls.push('resize');
    },
    handleFileUpload: async () => {
      calls.push('upload');
      return true;
    },
    downloadWorkspace: async () => {
      calls.push('download');
      return '/tmp/workspace.xml';
    },
    updateToolbox: () => {
      calls.push('toolbox');
    },
    refreshBlocks: () => {
      calls.push('refresh');
    },
    workspaceRef: null,
  };
  return { handle, calls };
}

const TWO_FILE_PROJECT = {
  workspace: '<xml id="entry">',
  format: 'xml' as const,
  entryFileId: 'file-a',
  files: [
    {
      fileId: 'file-a',
      name: 'main.block.json',
      workspace: '<xml id="a">',
      format: 'xml' as const,
      isEntry: true,
    },
    {
      fileId: 'file-b',
      name: 'helper.block.json',
      workspace: '<xml id="b">',
      format: 'xml' as const,
      isEntry: false,
    },
  ],
};

function setup(project = TWO_FILE_PROJECT) {
  const { handle, calls } = createFakeEditor();
  const editor = ref<WorkspaceHandle | null>(handle);
  const markFilesChanged = vi.fn();
  const notify = vi.fn();
  const afterWorkspaceSwitch = vi.fn();
  const actions = useEditorFileActions({
    editor,
    markFilesChanged,
    notify,
    afterWorkspaceSwitch,
  });
  const entryWorkspace = actions.applyProject(project).workspace;
  return {
    actions,
    calls,
    notify,
    markFilesChanged,
    afterWorkspaceSwitch,
    entryWorkspace,
  };
}

describe('useEditorFileActions', () => {
  it('载入项目时返回入口文件负载，并把活动文件停在入口', () => {
    const { actions, entryWorkspace } = setup();
    expect(entryWorkspace).toBe('<xml id="a">');
    expect(actions.activeFileId.value).toBe('file-a');
    expect(actions.files.value).toHaveLength(2);
  });

  it('切换文件前先回写画布，再装载目标文件', () => {
    const { actions, calls, afterWorkspaceSwitch } = setup();
    calls.length = 0;

    actions.onSelectProjectFile('file-b');

    expect(calls).toEqual(['export:xml', 'load:xml:<xml id="b">']);
    expect(actions.activeFileId.value).toBe('file-b');
    // 载入路径不触发 change，派生状态（积木数）靠这个回调补。
    expect(afterWorkspaceSwitch).toHaveBeenCalledTimes(1);
  });

  it('切换文件只刷新派生状态，不置脏', () => {
    const { actions, markFilesChanged } = setup();

    actions.onSelectProjectFile('file-b');

    expect(markFilesChanged).not.toHaveBeenCalled();
  });

  it('选中的就是当前文件时不回写、不装载', () => {
    const { actions, calls } = setup();
    calls.length = 0;

    actions.onSelectProjectFile('file-a');

    expect(calls).toEqual([]);
  });

  it('新建文件先回写、再清空画布，并置脏标记', () => {
    const { actions, calls, markFilesChanged } = setup();
    calls.length = 0;

    actions.onAddProjectFile();

    expect(calls[0]).toBe('export:xml');
    expect(calls).toContain('clear');
    expect(markFilesChanged).toHaveBeenCalledTimes(1);
    expect(actions.files.value).toHaveLength(3);
    expect(actions.activeFile.value?.workspace).toBe('');
  });

  it('删除活动文件后装载新活动文件（入口）', () => {
    const { actions, calls } = setup();
    calls.length = 0;

    actions.onDeleteProjectFile('file-a');

    expect(actions.files.value).toHaveLength(1);
    expect(actions.activeFileId.value).toBe('file-b');
    expect(calls).toEqual(['load:xml:<xml id="b">']);
  });

  it('删除最后一个文件被拒绝：给提示且不置脏', () => {
    const { actions, notify, markFilesChanged } = setup({
      workspace: '<xml id="only">',
      format: 'xml',
      entryFileId: 'file-a',
      files: [
        {
          fileId: 'file-a',
          name: 'main.block.json',
          workspace: '<xml id="only">',
          format: 'xml' as const,
          isEntry: true,
        },
      ],
    });

    actions.onDeleteProjectFile('file-a');

    expect(notify).toHaveBeenCalledWith(ui('keepOneFile'));
    expect(markFilesChanged).not.toHaveBeenCalled();
    expect(actions.files.value).toHaveLength(1);
  });

  it('设入口置脏并提示', () => {
    const { actions, notify, markFilesChanged } = setup();

    actions.onSetEntryFile('file-b');

    expect(actions.entryFileId.value).toBe('file-b');
    expect(markFilesChanged).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(ui('entryFile'));
  });

  it('落库快照前先回写画布（保存不能丢最新改动）', () => {
    const { actions, calls } = setup();
    calls.length = 0;

    const files = actions.getFiles();

    expect(calls).toEqual(['export:xml']);
    expect(files.find((file) => file.fileId === 'file-a')?.workspace).toBe(
      '<xml id="canvas">',
    );
  });

  it('入口负载取自入口文件的最新内容', () => {
    const { actions } = setup();

    expect(actions.getEntryWorkspace()).toBe('<xml id="canvas">');
  });
});

describe('useEditorWorkspaceActions', () => {
  it('生成代码前先回写画布，再让代码面板生成', async () => {
    const { handle, calls } = createFakeEditor();
    const editor = ref<WorkspaceHandle | null>(handle);
    const panelCalls: string[] = [];
    const codePanel = ref<CodeHandle | null>({
      generateCode: () => panelCalls.push('generate'),
      clearCode: () => panelCalls.push('clearCode'),
    });
    const actions = useEditorWorkspaceActions({
      editor,
      codePanel,
      syncActiveFile: () => {
        calls.push('sync');
      },
      exportFormat: ref<'json' | 'xml'>('xml'),
      notify: () => {},
    });

    await actions.generateCode();

    expect(calls).toEqual(['sync']);
    expect(panelCalls).toEqual(['generate']);
  });

  it('导入成功后补一次画布替换回调（Blockly 载入不触发 change）', async () => {
    const { handle } = createFakeEditor();
    const editor = ref<WorkspaceHandle | null>(handle);
    const afterWorkspaceReplaced = vi.fn();
    const actions = useEditorWorkspaceActions({
      editor,
      codePanel: ref<CodeHandle | null>(null),
      syncActiveFile: () => {},
      exportFormat: ref<'json' | 'xml'>('json'),
      notify: () => {},
      afterWorkspaceReplaced,
    });

    actions.onImportFile(new File(['{}'], 'demo.json', { type: 'application/json' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(afterWorkspaceReplaced).toHaveBeenCalledTimes(1);
  });

  it('清空同时清画布与代码面板', () => {
    const { handle, calls } = createFakeEditor();
    const editor = ref<WorkspaceHandle | null>(handle);
    const panelCalls: string[] = [];
    const codePanel = ref<CodeHandle | null>({
      generateCode: () => panelCalls.push('generate'),
      clearCode: () => panelCalls.push('clearCode'),
    });
    const actions = useEditorWorkspaceActions({
      editor,
      codePanel,
      syncActiveFile: () => {},
      exportFormat: ref<'json' | 'xml'>('json'),
      notify: () => {},
    });

    actions.handleClear();

    expect(calls).toEqual(['clear']);
    expect(panelCalls).toEqual(['clearCode']);
  });
});
