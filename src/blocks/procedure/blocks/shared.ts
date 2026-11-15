import * as Blockly from 'blockly/core';
import { toolboxTemplates } from '../toolbox-state';
import { findProjectSymbol, getProjectSymbols, projectSymbolLabel } from '@/utils/project-context';

export const PROCEDURE_BLOCK_TYPES = [
  'crypto_return',
  'primitive_def',
  'crypto_encrypt_func',
  'crypto_decrypt_func',
  'crypto_hash_func',
] as const;

export type ProcedureBlockType = (typeof PROCEDURE_BLOCK_TYPES)[number];

export const CRYPTO_PARAM_TYPES: [string, string][] = [
  ['bytes', 'bytes'], ['int', 'int'], ['int_list', 'int_list'],
  ['poly', 'poly'], ['seed', 'seed'], ['key', 'key'], ['message', 'message'],
];

// ─────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlock = any;


// ─────────────────────────────────────────────────────────
// procedures_defreturn / procedures_defnoreturn
// 完整独立实现，legacy procedure 路径（getProcedureDef + mutateCallers）
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// procedure 块共享逻辑（makeDefBlock / makeCallBlock 去重，audit finding-18）
// 两工厂仅 init / 渲染（updateParams_ vs updateShape_）与 statements 处理不同，
// 参数解析 / 序列化 / 变量联动完全同构 —— 抽为共享 helper + 渲染回调注入。
// ─────────────────────────────────────────────────────────

/** 从 mutation DOM 解析 args → arguments_ / paramTypes_ / argumentVarModels_。 */
export function parseArgsFromDom(block: AnyBlock, xmlElement: Element): void {
  block.arguments_ = [];
  block.argumentVarModels_ = [];
  block.paramTypes_ = [];
  const children = Array.from(xmlElement.childNodes);
  for (const child of children) {
    if (child.nodeName.toLowerCase() !== 'arg') continue;
    const argEl = child as Element;
    const name = argEl.getAttribute('name') || '';
    const varId = argEl.getAttribute('varid') || argEl.getAttribute('varId') || '';
    const type = argEl.getAttribute('type') || 'bytes';
    block.arguments_.push(name);
    block.paramTypes_.push(type);
    const v = Blockly.Variables.getOrCreateVariablePackage(block.workspace, varId || null, name, '') as unknown as Blockly.VariableModel | null;
    if (v) block.argumentVarModels_.push(v);
    else console.warn(`Failed to create variable "${name}", ignoring.`);
  }
}

/** 把 args 序列化到 mutation DOM（def 可带 saveId/paramId，call 不带）。 */
export function serializeArgsToDom(block: AnyBlock, container: Element, includeParamId = false): void {
  for (let i = 0; i < block.argumentVarModels_.length; i++) {
    const arg = Blockly.utils.xml.createElement('arg');
    const v = block.argumentVarModels_[i];
    arg.setAttribute('name', v.getName());
    arg.setAttribute('varid', v.getId());
    if (includeParamId && block.paramIds_) arg.setAttribute('paramId', block.paramIds_[i]);
    arg.setAttribute('type', block.paramTypes_[i] || 'bytes');
    container.appendChild(arg);
  }
}

/** saveExtraState 的 params 部分（def 额外处理 hasStatements，call 直接返回）。 */
export function argsExtraState(block: AnyBlock): Record<string, unknown> | null {
  if (!block.argumentVarModels_.length) return null;
  return {
    params: block.argumentVarModels_.map((v: Blockly.VariableModel, i: number) => ({
      name: v.getName(),
      id: v.getId(),
      type: block.paramTypes_[i] || 'bytes',
    })),
  };
}

/** loadExtraState 的 name + params 部分（flyout 字符串数组 / 序列化对象数组兼容）。 */
export function loadArgsExtraState(block: AnyBlock, state: Record<string, unknown>): void {
  // flyout 传 {name, params}：name 应用到 NAME 字段（函数选择）
  if (typeof state.name === 'string' && state.name) {
    // 旧工作区可能没有对应字段：恢复名字失败时保留默认值即可，不属于错误。
    try {
      block.setFieldValue(state.name, 'NAME');
    } catch {
      /* 预期内：字段缺失或值不被接受 */
    }
  }
  const raw = (state.params as Array<{ name: string; id: string; type?: string } | string>) || [];
  block.arguments_ = [];
  block.argumentVarModels_ = [];
  block.paramTypes_ = [];
  for (const item of raw) {
    const p = typeof item === 'string' ? { name: item, id: '', type: 'bytes' } : item;
    block.arguments_.push(p.name);
    block.paramTypes_.push(p.type || 'bytes');
    const v = (block.workspace.getVariableMap().getVariable(p.name, '') ||
      block.workspace.getVariableMap().createVariable(p.name, '', p.id || undefined)) as unknown as Blockly.VariableModel;
    block.argumentVarModels_.push(v);
  }
}

/** renameVarById 共享逻辑（afterChange 注入 displayRenamedVar_+mutateCallers / updateShape_）。 */
export function renameVarByIdCommon(
  block: AnyBlock,
  oldId: string,
  newId: string,
  afterChange: (block: AnyBlock, oldName: string, newName: string) => void,
): void {
  const varmap = block.workspace.getVariableMap();
  const oldVar = varmap.getVariableById(oldId);
  if (!oldVar || oldVar.getType() !== '') return;
  const newVar = varmap.getVariableById(newId);
  if (!newVar) return;
  const idx = block.argumentVarModels_.findIndex((v: Blockly.VariableModel) => v.getId() === oldId);
  if (idx === -1) return;
  const oldName = oldVar.getName();
  const newName = newVar.getName();
  block.arguments_[idx] = newName;
  block.argumentVarModels_[idx] = newVar;
  afterChange(block, oldName, newName);
}

/** updateVarName 共享逻辑（afterChange 注入）。 */
export function updateVarNameCommon(
  block: AnyBlock,
  variable: Blockly.VariableModel,
  afterChange: (block: AnyBlock, oldName: string) => void,
): void {
  const name = variable.getName();
  let changed = false;
  let oldName = '';
  for (let i = 0; i < block.argumentVarModels_.length; i++) {
    if (block.argumentVarModels_[i].getId() === variable.getId()) {
      oldName = block.arguments_[i];
      block.arguments_[i] = name;
      changed = true;
    }
  }
  if (changed) afterChange(block, oldName);
}

/** getVarModels（def/call 完全相同，直接共享；getVars 在 Blockly 13 已移除，v13 内部统一走 getVarModels）。 */
export function procedureGetVarModels(this: AnyBlock): Blockly.VariableModel[] {
  return this.argumentVarModels_;
}


/** 函数名/参数名标识符校验（拒绝非法字符输入）。 */
export const identifierValidator = (value: string): string | null =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null;


/** 构建 call 块 NAME 下拉选项：工作区函数 + 拖出的模板 + Manager 添加到 toolbox 的模板。 */
/** 下拉选项缓存：按块缓存 + 模板集合 key；工作区函数变化时由 call 块 onchange 失效（防每次点开下拉全量扫描） */
const callOptionsCache = new WeakMap<
  AnyBlock,
  { key: string; options: Array<[string, string]> }
>();

export function invalidateCallOptions(block: AnyBlock): void {
  callOptionsCache.delete(block);
}

export function buildCallOptions(block: AnyBlock): Array<[string, string]> {
  try {
    // Manager 模板集合变化用廉价 key 表达（join 28 个名字 vs 全量扫描）
    const tplKey = toolboxTemplates.value.join(',');
    const symbolKey = getProjectSymbols()
      .map((symbol) => `${symbol.path}:${symbol.name}`)
      .join(',');
    const cacheKey = `${tplKey}|${symbolKey}`;
    const cached = callOptionsCache.get(block);
    if (cached && cached.key === cacheKey) return cached.options;

    const ws = (block.workspace as unknown as { targetWorkspace?: Blockly.Workspace }).targetWorkspace || block.workspace;
    const tuples = Blockly.Procedures.allProcedures(ws);
    const names = tuples[0].concat(tuples[1]).map((t) => t[0]);
    // 工作区中拖出的模板（有 FUNC_NAME 字段的模板块）
    const wsTemplateNames = ws.getAllBlocks(false)
      .filter(function (b: Blockly.Block) { return b.getField('FUNC_NAME') !== null && b.type !== 'procedures_defreturn' && b.type !== 'procedures_defnoreturn'; })
      .map(function (b: Blockly.Block) { return (b.getFieldValue('FUNC_NAME') as string) || b.type; });
    // Manager 添加到 toolbox 的模板
    const toolboxNames = toolboxTemplates.value;
    const all = Array.from(new Set(names.concat(wsTemplateNames, toolboxNames)));
    const localOptions: Array<[string, string]> = !all.length
      ? [[Blockly.Msg.PROCEDURES_UNNAMED || 'unnamed', '']]
      : all.map((n): [string, string] => [n, n]);
    const localNames = new Set(all);
    const externalOptions = getProjectSymbols()
      .filter((symbol) => !localNames.has(symbol.name))
      .map((symbol): [string, string] => [projectSymbolLabel(symbol), symbol.name]);
    const options = localOptions.concat(externalOptions);
    callOptionsCache.set(block, { key: cacheKey, options });
    return options;
  } catch (error) {
    console.warn('function dropdown options failed:', error);
    return [[Blockly.Msg.PROCEDURES_UNNAMED || 'unnamed', '']];
  }
}

/** call 块选择函数后同步参数行（支持工作区自定义函数 + 模板）。 */
export function syncCallParams(block: AnyBlock, funcName: string) {
  const ws = (block.workspace as unknown as { targetWorkspace?: Blockly.Workspace }).targetWorkspace || block.workspace;
  const def = Blockly.Procedures.getDefinition(funcName, ws);
  let args: string[] = [];
  let types: string[] = [];
  if (def) {
    const defRec = def as unknown as Record<string, unknown>;
    args = Array.isArray(defRec.arguments_) ? (defRec.arguments_ as string[]) : [];
    types = Array.isArray(defRec.paramTypes_) ? (defRec.paramTypes_ as string[]) : [];
  } else {
    // 模板函数：优先按工作区中模板块的实际字段（支持 FUNC_NAME 改名后按新名查找），再查注册表
    const wsTemplate = ws.getAllBlocks(false).find(function (b: Blockly.Block) {
      return b.getField('FUNC_NAME') !== null && (b.getFieldValue('FUNC_NAME') as string) === funcName;
    });
    if (wsTemplate) {
      // 多参数模板：探测 PARAM_NAME_i 字段（PARAM_NAME_0 存在即多参数）
      if (wsTemplate.getField('PARAM_NAME_0') !== null) {
        for (let i = 0; ; i++) {
          const n = wsTemplate.getFieldValue('PARAM_NAME_' + i);
          if (n === null || n === undefined) break;
          args.push(n as string);
          types.push((wsTemplate.getFieldValue('PARAM_TYPE_' + i) as string) || 'bytes');
        }
      } else {
        args = [(wsTemplate.getFieldValue('PARAM_NAME') as string) || 'param'];
        types = [(wsTemplate.getFieldValue('PARAM_TYPE') as string) || 'bytes'];
      }
    } else {
      const tpl = Object.values(TEMPLATE_REGISTRY).find(function (t) { return t.name === funcName; });
      if (tpl) {
        const params = tpl.params || [{ name: tpl.paramName, type: tpl.paramType }];
        args = params.map(function (param) { return param.name; });
        types = params.map(function (param) { return param.type; });
      } else {
        const projectSymbol = findProjectSymbol(funcName);
        if (projectSymbol) {
          args = projectSymbol.params.map(function (param) { return param.name; });
          types = projectSymbol.params.map(function (param) { return param.type; });
        }
      }
    }
  }
  block.arguments_ = args;
  block.paramTypes_ = types;
  block.argumentVarModels_ = [];
  args.forEach(function (name) {
    const v = block.workspace.getVariableMap().getVariable(name, '') || block.workspace.getVariableMap().createVariable(name, '');
    block.argumentVarModels_.push(v);
  });
  block.updateShape_!();
}


/** 模板注册表：type → 默认函数名 + 参数信息（供 call 块下拉和参数同步用）。
 * 同时是模板清单的唯一事实源（生成器/面板从此派生）。 */
export interface TemplateInfo {
  name: string; paramName: string; paramType: string; category: string;
  /** 多参数模板参数表（如 ML-KEM-Encaps：ek + m）。单参数模板缺省用 paramName/paramType。 */
  params?: { name: string; type: string }[];
}
export const TEMPLATE_REGISTRY: Record<string, TemplateInfo> = {};

