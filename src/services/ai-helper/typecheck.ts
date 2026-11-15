/**
 * 工作区类型自洽检查（用户侧 AI Helper · 浏览器端内核）
 *
 * 从 scripts/ai-helper-typecheck.ts 移植的核心算法：只读 BLOCK-IO-CONTRACT.json 与工作区
 * 序列化 JSON，不读文件系统、不加载 Blockly、不依赖 DOM，因此可以在浏览器里先跑一遍类型检查。
 *
 * 判据：父块某值输入的 `check` + 子块的 `outputCheck`；子块没有 outputCheck（字面量、变量、调用）
 * 时按变量赋值/过程形参声明推断，仍推不出就记 unknown。
 *
 * 形参类型绑定按「变量 id ↔ 过程形参 id」，并限定在所属过程内：同一变量 id 在不同过程可以
 * 声明不同类型，按名字做全局匹配会造出假 mismatch。离线 JSON 里就有 id，所以不需要加载 Blockly。
 */

import { CONTRACT, compatibility, inputCheck, outputCheck } from './contract';
import { literalShapeType } from './literal-shape';
import type { Contract } from './contract';

export interface SerializedParam {
  name?: string;
  id?: string;
  type?: string;
}

export interface SerializedBlock {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: SerializedBlock }>;
  next?: { block?: SerializedBlock };
  extraState?: {
    params?: SerializedParam[];
    hasStatements?: boolean;
  };
}

export interface SerializedWorkspace {
  blocks: { blocks: SerializedBlock[] };
}

/** 一条可证不符的配对；`location` 形如 `sm4_round_func[X0]`，用于直接定位到槽位。 */
export interface TypeCheckIssue {
  parent: string;
  input: string;
  child: string;
  expected: string[];
  actual: string[];
  location: string;
  message: string;
}

export interface TypeCheckReport {
  pairs: number;
  ok: number;
  mismatch: number;
  unknown: number;
  /** unknown / pairs 的百分比，保留一位小数；pairs 为 0 时记 0。 */
  unknownRate: number;
  issues: TypeCheckIssue[];
  /** 靠「变量 id ↔ 过程形参 id」救回判定的 variables_get 数（无赋值、只有形参声明）。 */
  varByParamId: number;
}

/** 过程参数类型词表（CRYPTO_PARAM_TYPES）↔ setCheck 标签：poly/seed/key/message 无对应项，只能记 unknown。 */
const PARAM_TYPE_MAP: Record<string, string | null> = {
  bytes: 'Bytes',
  int: 'Number',
  int_list: 'IntList',
  string: 'String',
  poly: null,
  seed: null,
  key: null,
  message: null,
};

const UNKNOWN_VOCAB_PREFIX = 'UNKNOWN_VOCAB:';

type ParamScope = Map<string, string>;

const NO_SCOPE: ParamScope = new Map();

function isBlock(value: unknown): value is SerializedBlock {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** 收集一棵或多棵树里的全部块（含值输入与 next 链）。 */
function collectBlocks(roots: SerializedBlock[]): SerializedBlock[] {
  const all: SerializedBlock[] = [];
  const visit = (block: SerializedBlock | undefined): void => {
    if (!block) return;
    all.push(block);
    for (const value of Object.values(block.inputs ?? {})) visit(value.block);
    visit(block.next?.block);
  };
  roots.forEach(visit);
  return all;
}

/** 从调用方传来的任意 JSON 里取顶层块；形状不对时返回空数组，让调用方得到零计数而不是异常。 */
function readRoots(json: unknown): SerializedBlock[] {
  if (!isBlock(json) && (typeof json !== 'object' || json === null)) return [];
  const blocks = (json as { blocks?: { blocks?: unknown } }).blocks?.blocks;
  return Array.isArray(blocks) ? blocks.filter(isBlock) : [];
}

function normalizeParamType(paramType: string | undefined): string | null {
  const key = (paramType ?? '').trim();
  if (!key) return null;
  const mapped = PARAM_TYPE_MAP[key];
  return mapped === undefined ? `${UNKNOWN_VOCAB_PREFIX}${key}` : mapped;
}

/** 一个过程体内可见的形参声明：变量 id → setCheck 标签。 */
function paramScope(defBlock: SerializedBlock): ParamScope {
  const labels: ParamScope = new Map();
  for (const param of defBlock.extraState?.params ?? []) {
    const mapped = normalizeParamType(param.type);
    if (param.id && mapped && !mapped.startsWith(UNKNOWN_VOCAB_PREFIX)) labels.set(param.id, mapped);
  }
  return labels;
}

/**
 * 推导一个块的输出类型；变量与过程调用需要上下文，未命中就走契约。
 * `variableTypes` 是「变量 id → 由一次赋值能定下的类型」。
 */
function resolveOutputType(
  block: SerializedBlock,
  contract: Contract,
  variableTypes: Map<string, string[]>,
  procedureReturns: Map<string, string[] | null>,
  scope: ParamScope,
  nameLabels?: Map<string, string>,
): string[] | null {
  if (block.type === 'variables_get') {
    const id = (block.fields?.VAR as { id?: string } | undefined)?.id ?? '';
    const inferred = variableTypes.get(id);
    // 一次赋值的类型可能是一个标签集合（如数组字面量 → IntList|Bytes），
    // 推断时按 '|' 存成一个条目；这里必须还原成标签数组，否则与父槽取交集会失败。
    if (inferred && inferred.length === 1) return inferred[0].split('|');
    // 变量就是所属过程的形参时用形参声明的类型：先按 id 限定在所属过程内，再退回按名匹配。
    const name = String((block.fields?.VAR as { name?: string } | undefined)?.name ?? '');
    const declared = scope.get(id) ?? nameLabels?.get(name) ?? null;
    return declared ? [declared] : null;
  }
  if (block.type === 'procedures_callreturn') {
    return procedureReturns.get(String(block.fields?.NAME ?? '')) ?? null;
  }
  if (block.type === 'math_number') return ['Number'];
  if (block.type === 'data_value') {
    // 形状已知的字面量按「可表示它的类型」判定（与父槽期望取交集）；
    // 嵌套数组与任意表达式不猜，保持 unknown——矩阵由块的 shape 元数据承载。
    return literalShapeType(String((block.fields?.NUM as string | undefined) ?? ''));
  }
  return outputCheck(contract, block.type);
}

/** variables_get 的两个可查事实：按 id 的赋值推断、形参声明（所属过程内按 id）。 */
function variablesGetFacts(
  block: SerializedBlock,
  variableTypes: Map<string, string[]>,
  scope: ParamScope,
  nameLabels: Map<string, string>,
): { assigned: string | null; declared: string | null } | null {
  if (block.type !== 'variables_get') return null;
  const field = block.fields?.VAR as { id?: string; name?: string } | undefined;
  const assigned = variableTypes.get(field?.id ?? '') ?? [];
  const declared = scope.get(field?.id ?? '') ?? nameLabels.get(String(field?.name ?? '')) ?? null;
  return { assigned: assigned.length === 1 ? assigned[0] : null, declared };
}

/** 给每个块算出它所在过程内的形参作用域：过程定义块及其全部子孙块。 */
function buildScopes(roots: SerializedBlock[], all: SerializedBlock[]): Map<SerializedBlock, ParamScope> {
  const scopes = new Map<SerializedBlock, ParamScope>();
  const defScopes = new Map<SerializedBlock, ParamScope>();
  for (const block of all) if (block.type.startsWith('procedures_def')) defScopes.set(block, paramScope(block));
  const assign = (block: SerializedBlock, inherited: ParamScope): void => {
    const own = defScopes.get(block) ?? inherited;
    scopes.set(block, own);
    for (const value of Object.values(block.inputs ?? {})) if (value.block) assign(value.block, own);
    if (block.next?.block) assign(block.next.block, own);
  };
  for (const root of roots) assign(root, NO_SCOPE);
  return scopes;
}

function emptyReport(): TypeCheckReport {
  return { pairs: 0, ok: 0, mismatch: 0, unknown: 0, unknownRate: 0, issues: [], varByParamId: 0 };
}

/** 核心判定：输入一组顶层块，返回计数、比率为与可定位的 mismatch 清单。 */
export function analyzeBlocks(roots: SerializedBlock[], contract: Contract = CONTRACT): TypeCheckReport {
  const report = emptyReport();
  const all = collectBlocks(roots);

  // 变量类型推断：只看「一次赋值」能定的类型；多次赋值不同类时不猜。
  const variableTypes = new Map<string, string[]>();
  for (const block of all) {
    if (block.type !== 'variables_set') continue;
    const id = (block.fields?.VAR as { id?: string } | undefined)?.id ?? '';
    const value = block.inputs?.VALUE?.block;
    if (!id || !value) continue;
    const type = resolveOutputType(value, contract, variableTypes, new Map(), NO_SCOPE);
    if (!type) continue;
    const list = variableTypes.get(id) ?? [];
    list.push(type.join('|'));
    variableTypes.set(id, list);
  }

  // 形参名 → 标签：部分序列化里变量字段只有 id，这条作为按 id 匹配之外的兜底。
  const nameLabels = new Map<string, string>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    for (const param of block.extraState?.params ?? []) {
      const mapped = normalizeParamType(param.type);
      if (param.name && mapped && !mapped.startsWith(UNKNOWN_VOCAB_PREFIX)) nameLabels.set(param.name, mapped);
    }
  }

  const scopes = buildScopes(roots, all);

  // 过程返回类型：从 RETURN 子块的契约 outputCheck 推断，无需声明字段。
  const procedureReturns = new Map<string, string[] | null>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    const name = String(block.fields?.NAME ?? '');
    if (!name) continue;
    const returnChild = block.inputs?.RETURN?.block;
    if (returnChild) procedureReturns.set(name, outputCheck(contract, returnChild.type));
  }

  // 配对检查：只检查有明确 check 的值输入。
  for (const block of all) {
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      const child = value.block;
      if (!child) continue;
      const expected = inputCheck(contract, block.type, inputName);
      if (expected === null) continue;
      const scope = scopes.get(block) ?? NO_SCOPE;
      const actual = resolveOutputType(child, contract, variableTypes, procedureReturns, scope, nameLabels);
      report.pairs += 1;
      const facts = variablesGetFacts(child, variableTypes, scope, nameLabels);
      if (facts && !facts.assigned && facts.declared) report.varByParamId += 1;
      const verdict = compatibility(expected, actual);
      if (verdict === 'ok') report.ok += 1;
      else if (verdict === 'unknown') report.unknown += 1;
      else {
        report.mismatch += 1;
        const location = `${block.type}[${inputName}]`;
        report.issues.push({
          parent: block.type,
          input: inputName,
          child: child.type,
          expected,
          actual: actual ?? [],
          location,
          message: `${location} ← ${child.type}: 期望 ${expected.join('|')}，实得 ${(actual ?? []).join('|')}`,
        });
      }
    }
  }

  report.unknownRate = report.pairs ? Number(((report.unknown / report.pairs) * 100).toFixed(1)) : 0;
  return report;
}

/**
 * 检查一份 Blockly 序列化工作区（`Blockly.serialization.workspaces.save()` 的产物，
 * 或 demos/*.json 这种同形 JSON）。输入形状不合法时返回零计数，不抛异常。
 */
export function checkWorkspace(json: unknown, contract: Contract = CONTRACT): TypeCheckReport {
  return analyzeBlocks(readRoots(json), contract);
}

/** 已加载 Blockly Workspace 的最小结构；不引入 Blockly 运行时，也不要求 DOM。 */
export interface BlocklyFieldLike {
  name?: string;
  getValue(): unknown;
}

export interface BlocklyInputLike {
  name: string;
  fieldRow?: BlocklyFieldLike[];
}

export interface BlocklyBlockLike {
  type: string;
  id?: string;
  inputList?: BlocklyInputLike[];
  getInputTargetBlock(name: string): BlocklyBlockLike | null;
  getNextBlock(): BlocklyBlockLike | null;
  getParent?(): BlocklyBlockLike | null;
  saveExtraState?: () => unknown;
}

export interface BlocklyWorkspaceLike {
  getAllBlocks(ordered?: boolean): BlocklyBlockLike[];
}

function fieldValue(field: BlocklyFieldLike): unknown {
  const value = field.getValue();
  return value === null || value === undefined ? null : value;
}

function fromLoadedBlock(block: BlocklyBlockLike): SerializedBlock {
  const fields: Record<string, unknown> = {};
  for (const input of block.inputList ?? []) {
    for (const field of input.fieldRow ?? []) {
      if (!field.name) continue;
      const value = fieldValue(field);
      if (value === null) continue;
      // 变量字段的 getValue() 是变量 id；序列化 JSON 里形如 { id }，这里对齐成同一形状。
      fields[field.name] = field.name === 'VAR' ? { id: String(value) } : String(value);
    }
  }
  const inputs: Record<string, { block?: SerializedBlock }> = {};
  for (const input of block.inputList ?? []) {
    if (!input.name) continue;
    const target = block.getInputTargetBlock(input.name);
    if (target) inputs[input.name] = { block: fromLoadedBlock(target) };
  }
  const result: SerializedBlock = { type: block.type, fields, inputs };
  if (block.id) result.id = block.id;
  const next = block.getNextBlock();
  if (next) result.next = { block: fromLoadedBlock(next) };
  const extra = block.saveExtraState?.();
  if (extra && typeof extra === 'object') result.extraState = extra as SerializedBlock['extraState'];
  return result;
}

/**
 * 适配已经加载进 Blockly 的 Workspace：用 getAllBlocks() 遍历、用 getInputTargetBlock()/getNextBlock()
 * 还原树形，再走与 checkWorkspace 相同的判定。未定义 saveExtraState 的块拿不到形参声明，按未知处理。
 */
export function checkWorkspaceObject(workspace: BlocklyWorkspaceLike, contract: Contract = CONTRACT): TypeCheckReport {
  const roots = workspace
    .getAllBlocks(false)
    .filter((block) => (typeof block.getParent === 'function' ? !block.getParent() : false))
    .map(fromLoadedBlock);
  return analyzeBlocks(roots, contract);
}
