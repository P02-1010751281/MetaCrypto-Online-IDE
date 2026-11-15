/**
 * 编辑器壳操作子组件所需的最小句柄面。
 *
 * 为什么不用 `InstanceType<typeof BlocklyEditor>`：那会把壳焊死在组件的完整
 * expose 面上——组件每加一个方法，壳的类型上下文都跟着变；更关键的是壳的
 * 编排逻辑（切换文件前必须回写画布、生成前必须等一次渲染）没法脱离真 Blockly
 * 验证。这里只声明壳真正用到的方法，BlocklyEditor / CodePanel 是它的结构化超集，
 * 测试可以用假句柄注入。
 */

/** 画布句柄：只保留壳用到的五个面。 */
export interface WorkspaceHandle {
  exportWorkspace: (format: 'json' | 'xml') => string;
  loadWorkspace: (workspaceText: string, type: 'json' | 'xml') => boolean;
  clearWorkspace: () => void;
  resizeWorkspace: () => void;
  handleFileUpload: (file: File) => Promise<boolean>;
  downloadWorkspace: (filename?: string) => Promise<string | null>;
  updateToolbox: () => void;
  refreshBlocks: () => void;
  /** 只读视图：状态栏要数积木个数，别的什么都不做。 */
  readonly workspaceRef: WorkspaceReader | null;
}

/** 画布只读面（Blockly.WorkspaceSvg 的结构子集）。 */
export interface WorkspaceReader {
  getAllBlocks: (ordered?: boolean) => readonly unknown[];
}

/** 代码面板句柄。 */
export interface CodeHandle {
  generateCode: () => void;
  clearCode: () => void;
}
