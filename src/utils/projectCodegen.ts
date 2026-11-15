import * as Blockly from 'blockly/core';

import { generateCode } from '@/composables/generator';
import { injectPrimitives } from '@/generators/python';
import {
  setProjectSymbols,
  type ProjectFunctionSymbol,
} from '@/utils/project-context';
import type { ProjectFileRecord } from '@/services/projects/ProjectStore';

export interface ProjectCodeBundle {
  python: string;
  javascript: string;
  symbols: ProjectFunctionSymbol[];
  errors: string[];
}

/**
 * 把单个 block 文件的负载反序列化成临时工作区。
 * CipherCat 的文件只有 JSON/XML 两种 block 负载，没有源码文件；
 * XML 以 `<` 开头，用 format 字段优先、内容特征兜底，兼容早期没有 format 的记录。
 */
function parseWorkspace(file: ProjectFileRecord): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  const raw = String(file.workspace || '').trim();
  if (!raw) return workspace;
  const isXml = file.format === 'xml' || raw.startsWith('<');
  if (isXml) {
    const dom = Blockly.utils.xml.textToDom(raw);
    Blockly.Xml.domToWorkspace(dom, workspace);
  } else {
    Blockly.serialization.workspaces.load(JSON.parse(raw), workspace);
  }
  return workspace;
}

/** 符号扫描结果先不带归属文件，等确定归属后再补 fileId/path。 */
type ScannedFunctionSymbol = Omit<ProjectFunctionSymbol, 'fileId' | 'path'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldText(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.name === 'string') return value.name;
  return '';
}

function collectSerializedBlocks(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSerializedBlocks(item, output);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.type === 'string') output.push(value);
  for (const child of Object.values(value)) collectSerializedBlocks(child, output);
}

function inferSerializedSymbol(
  block: Record<string, unknown>,
): ScannedFunctionSymbol | null {
  const type = String(block.type || '');
  const fields = isRecord(block.fields) ? block.fields : {};
  if (type === 'procedures_defreturn' || type === 'procedures_defnoreturn') {
    const name = fieldText(fields, 'NAME');
    if (!name) return null;
    const extraState = isRecord(block.extraState) ? block.extraState : {};
    const rawParams = Array.isArray(extraState.params) ? extraState.params : [];
    return {
      name,
      params: rawParams.flatMap((param) => {
        if (!isRecord(param) || !param.name) return [];
        return [{ name: String(param.name), type: String(param.type || 'bytes') }];
      }),
      hasReturn: type === 'procedures_defreturn',
    };
  }

  const name = fieldText(fields, 'FUNC_NAME');
  if (!name) return null;
  if (Object.hasOwn(fields, 'PARAM_NAME_0')) {
    const params: ScannedFunctionSymbol['params'] = [];
    for (let index = 0; Object.hasOwn(fields, `PARAM_NAME_${index}`); index += 1) {
      params.push({
        name: fieldText(fields, `PARAM_NAME_${index}`) || `arg${index}`,
        type: fieldText(fields, `PARAM_TYPE_${index}`) || 'bytes',
      });
    }
    return { name, params, hasReturn: true };
  }
  if (Object.hasOwn(fields, 'PARAM_NAME')) {
    return {
      name,
      params: [
        {
          name: fieldText(fields, 'PARAM_NAME') || 'param',
          type: fieldText(fields, 'PARAM_TYPE') || 'bytes',
        },
      ],
      hasReturn: true,
    };
  }
  return { name, params: [], hasReturn: true };
}

function scanSerializedWorkspace(raw: string): ScannedFunctionSymbol[] {
  const blocks: Record<string, unknown>[] = [];
  collectSerializedBlocks(JSON.parse(raw), blocks);
  return blocks.flatMap((block) => {
    const symbol = inferSerializedSymbol(block);
    return symbol ? [symbol] : [];
  });
}

function xmlField(block: Element, name: string): string {
  for (const child of Array.from(block.children)) {
    if (child.tagName === 'field' && child.getAttribute('name') === name) {
      return child.textContent || '';
    }
  }
  return '';
}

function xmlMutationArgs(block: Element): ScannedFunctionSymbol['params'] {
  const mutation = Array.from(block.children).find((child) => child.tagName === 'mutation');
  if (!mutation) return [];
  return Array.from(mutation.children)
    .filter((child) => child.tagName === 'arg')
    .flatMap((arg) => {
      const name = arg.getAttribute('name') || '';
      return name
        ? [{ name, type: arg.getAttribute('type') || 'bytes' }]
        : [];
    });
}

function scanXmlWorkspace(raw: string): ScannedFunctionSymbol[] {
  const root = Blockly.utils.xml.textToDom(raw);
  const blocks = Array.from(root.querySelectorAll('block'));
  if (root.tagName === 'block') blocks.unshift(root);
  return blocks.flatMap((block) => {
    const type = block.getAttribute('type') || '';
    if (type === 'procedures_defreturn' || type === 'procedures_defnoreturn') {
      const name = xmlField(block, 'NAME');
      return name
        ? [{ name, params: xmlMutationArgs(block), hasReturn: type === 'procedures_defreturn' }]
        : [];
    }
    const name = xmlField(block, 'FUNC_NAME');
    if (!name) return [];
    if (xmlField(block, 'PARAM_NAME_0')) {
      const params: ScannedFunctionSymbol['params'] = [];
      for (let index = 0; ; index += 1) {
        const paramName = xmlField(block, `PARAM_NAME_${index}`);
        if (!paramName) break;
        params.push({
          name: paramName,
          type: xmlField(block, `PARAM_TYPE_${index}`) || 'bytes',
        });
      }
      return [{ name, params, hasReturn: true }];
    }
    const paramName = xmlField(block, 'PARAM_NAME');
    return [
      {
        name,
        params: paramName
          ? [{ name: paramName, type: xmlField(block, 'PARAM_TYPE') || 'bytes' }]
          : [],
        hasReturn: true,
      },
    ];
  });
}

function scanWorkspaceFunctionSymbols(file: ProjectFileRecord): ScannedFunctionSymbol[] {
  const raw = String(file.workspace || '').trim();
  if (!raw) return [];
  const isXml = file.format === 'xml' || raw.startsWith('<');
  return isXml ? scanXmlWorkspace(raw) : scanSerializedWorkspace(raw);
}

/**
 * 从 block 文件工作区提取项目函数符号。
 * 平铺命名空间规则：函数名必须在项目内唯一，因为所有文件最终生成到同一个模块。
 * 符号表必须在加载任何工作区之前写入：call 块的下拉在反序列化时就要解析跨文件函数名，
 * 否则其他文件定义的函数会被判成不可用选项。
 */
export function extractProjectSymbols(files: ProjectFileRecord[]): {
  symbols: ProjectFunctionSymbol[];
  errors: string[];
} {
  const symbols: ProjectFunctionSymbol[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const ordered = files
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const scannableFiles: ProjectFileRecord[] = [];
  const addSymbol = (file: ProjectFileRecord, symbol: ScannedFunctionSymbol): void => {
    if (!symbol.name) return;
    if (seen.has(symbol.name)) {
      errors.push(`函数名重复：${symbol.name}（${seen.get(symbol.name)} 与 ${file.name}）`);
      return;
    }
    seen.set(symbol.name, file.name);
    symbols.push({ fileId: file.fileId, path: file.name, ...symbol });
  };

  for (const file of ordered) {
    try {
      const discovered = scanWorkspaceFunctionSymbols(file);
      scannableFiles.push(file);
      for (const symbol of discovered) addSymbol(file, symbol);
    } catch (error) {
      errors.push(`${file.name}: 工作区解析失败：${String(error)}`);
    }
  }

  setProjectSymbols(symbols);
  // 符号就位后再真正加载工作区：这一步只为让 call 块解析跨文件函数名并暴露结构错误，
  // 临时工作区用完即弃，不进入 UI。
  for (const file of scannableFiles) {
    let workspace: Blockly.Workspace | null = null;
    try {
      workspace = parseWorkspace(file);
    } catch (error) {
      errors.push(`${file.name}: 工作区解析失败：${String(error)}`);
    } finally {
      workspace?.dispose();
    }
  }
  return { symbols, errors };
}

/**
 * 生成项目级平铺代码包。
 * 非 entry 文件按文件名稳定排序后先出，entry 最后出：入口依赖其他文件的函数，
 * 生成顺序与阅读顺序一致；原语支撑代码只注入 entry 一次。
 */
export function generateProjectBundle(
  files: ProjectFileRecord[],
  entryFileId: string,
  algorithmType: string,
): ProjectCodeBundle {
  const { symbols, errors } = extractProjectSymbols(files);
  setProjectSymbols(symbols);

  const others = files
    .filter((file) => file.fileId !== entryFileId)
    .sort((left, right) => left.name.localeCompare(right.name));
  const entries = files.filter((file) => file.fileId === entryFileId);
  const ordered = others.concat(entries);

  const pythonParts: string[] = [];
  const javascriptParts: string[] = [];
  for (const file of ordered) {
    let workspace: Blockly.Workspace | null = null;
    try {
      workspace = parseWorkspace(file);
      const codeWorkspace = workspace as unknown as Blockly.WorkspaceSvg;
      let python = generateCode(codeWorkspace, 'python') || '';
      // CipherCat 没有算法类型概念：只有显式传入 algorithmType 时才注入 primitive/algo
      // 脚手架，否则输出与单文件生成保持一致。
      if (file.fileId === entryFileId && algorithmType) {
        python = injectPrimitives(python, algorithmType);
      }
      const javascript = generateCode(codeWorkspace, 'javascript') || '';
      pythonParts.push(`# file: ${file.name}\n${python}`);
      javascriptParts.push(`// file: ${file.name}\n${javascript}`);
    } catch (error) {
      errors.push(`${file.name}: 代码生成失败：${String(error)}`);
    } finally {
      workspace?.dispose();
    }
  }

  return {
    python: pythonParts.join('\n\n'),
    javascript: javascriptParts.join('\n\n'),
    symbols,
    errors,
  };
}
