/**
 * jsdom + Blockly 引导（用户侧 AI Helper · 活工作区加载）
 *
 * 从 ai-helper-roundtrip.ts 的 bootBlockly() 复制而来，独立成文件以便类型检查器
 * 在「加载后的活工作区」上复用同一套块遍历，而不依赖 roundtrip 的其余逻辑。
 *
 * 只做三件事：
 *   1. bootBlockly()：注入 jsdom 全局并注册 Blockly 核心 / blocks / MetaCrypto Online IDE 块 / Python 生成器
 *   2. loadWorkspace()：把 demo JSON 装进一个活的 Blockly.Workspace
 *   3. readLiveTree()：把活工作区读回与 demo JSON 同形的树（字段取活值，变量补名字）
 *
 * 这里不允许推断：活工作区里拿不到的字段就留空，由调用方记 unknown。
 */
import { JSDOM } from 'jsdom';

type Globals = typeof globalThis & Record<string, unknown>;

/** 活工作区里我们真正用到的 Blockly 表面（结构化类型，不 import Blockly 类型）。 */
export interface LiveVariableModel {
  getId: () => string;
  getName: () => string;
}

export interface LiveField {
  name: string;
  getValue: () => unknown;
  getVariable?: () => LiveVariableModel | null;
}

export interface LiveConnection {
  targetBlock: () => LiveBlock | null;
}

export interface LiveInput {
  name: string;
  connection: LiveConnection | null;
  fieldRow: LiveField[];
}

export interface LiveBlock {
  type: string;
  inputList: LiveInput[];
  nextConnection?: LiveConnection | null;
  saveExtraState?: () => Record<string, unknown> | null;
}

export interface LiveWorkspace {
  getAllBlocks: () => LiveBlock[];
  getTopBlocks: (ordered: boolean) => LiveBlock[];
}

export interface LoadedBlockNode {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: LoadedBlockNode }>;
  next?: { block?: LoadedBlockNode };
  extraState?: { params?: Array<{ name?: string; id?: string; type?: string }>; hasStatements?: boolean };
}

export interface BlocklyHandle {
  Workspace: new () => LiveWorkspace;
  serialization: { workspaces: { load: (json: unknown, workspace: LiveWorkspace) => void } };
}

export async function bootBlockly(): Promise<BlocklyHandle> {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const globals = globalThis as Globals;
  globals.document = dom.window.document;
  globals.window = dom.window;
  globals.DOMParser = dom.window.DOMParser;
  globals.XMLSerializer = dom.window.XMLSerializer;
  globals.Node = dom.window.Node;
  globals.Element = dom.window.Element;

  const BlocklyModule = await import('blockly/core');
  const Blockly = BlocklyModule.default ?? BlocklyModule;
  const { setLocale } = await import('blockly/core');
  setLocale(await import('blockly/msg/en'));
  await import('blockly/blocks');
  await import('@/blocks');
  await import('@/generators/python');

  return Blockly as unknown as BlocklyHandle;
}

/** 读活工作区的一个字段：变量字段同时给出 id 与名字（名字是加载后才补齐的事实）。 */
function readField(field: LiveField): unknown {
  const variable = field.getVariable?.() ?? null;
  if (variable) return { id: variable.getId(), name: variable.getName() };
  return field.getValue();
}

/** 把活工作区读回 demo JSON 同形的树；变量字段带加载后的名字。 */
export function readLiveTree(workspace: LiveWorkspace): LoadedBlockNode[] {
  return workspace.getTopBlocks(false).map(readBlock);
}

function readBlock(block: LiveBlock): LoadedBlockNode {
  const node: LoadedBlockNode = { type: block.type };
  const fields: Record<string, unknown> = {};
  const inputs: Record<string, { block?: LoadedBlockNode }> = {};
  for (const input of block.inputList) {
    for (const field of input.fieldRow) fields[field.name] = readField(field);
    const child = input.connection?.targetBlock() ?? null;
    if (child) inputs[input.name] = { block: readBlock(child) };
  }
  if (Object.keys(fields).length) node.fields = fields;
  if (Object.keys(inputs).length) node.inputs = inputs;
  const saved = block.saveExtraState?.();
  if (saved && typeof saved === 'object') node.extraState = saved as LoadedBlockNode['extraState'];
  const next = block.nextConnection?.targetBlock() ?? null;
  if (next) node.next = { block: readBlock(next) };
  return node;
}

/** 逐文件把 demo JSON 装进活工作区并读回树；文件名 → 树。 */
export async function loadLiveTrees(
  files: string[],
  readJson: (file: string) => unknown,
): Promise<Map<string, LoadedBlockNode[]>> {
  const blockly = await bootBlockly();
  const trees = new Map<string, LoadedBlockNode[]>();
  for (const file of files) {
    const workspace = new blockly.Workspace();
    blockly.serialization.workspaces.load(readJson(file), workspace);
    trees.set(file, readLiveTree(workspace));
  }
  return trees;
}

/** probe 子命令的两个合成用例：直接非法连线 / 经变量中转。 */
export async function probeConnections(): Promise<Array<{ name: string; ok: boolean; error: string | null }>> {
  const blockly = await bootBlockly();
  const cases: Array<[string, unknown]> = [
    ['直接非法连线', { blocks: { languageVersion: 0, blocks: [
      { type: 'aes_sub_bytes', inputs: { STATE: { block: { type: 'seed_bytes' } } } }] } }],
    ['变量中转', { blocks: { languageVersion: 0, blocks: [
      { type: 'variables_set', fields: { VAR: { id: 'v1' } }, inputs: { VALUE: { block: { type: 'seed_bytes' } } } },
      { type: 'aes_sub_bytes', inputs: { STATE: { block: {
        type: 'variables_get', fields: { VAR: { id: 'v1' } } } } } }],
    variables: [{ name: 'buf', id: 'v1' }] } }],
  ];
  return cases.map(([name, json]) => {
    const workspace = new blockly.Workspace();
    try {
      blockly.serialization.workspaces.load(json, workspace);
      return { name, ok: true, error: null };
    } catch (caught) {
      return { name, ok: false, error: caught instanceof Error ? caught.message : String(caught) };
    }
  });
}
