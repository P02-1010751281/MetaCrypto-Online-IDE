/**
 * 代码 → 工作区：反解析结果 → Blockly 序列化状态（用户侧 AI Helper · B 线 P1.2 之后）
 *
 * 前面三层（matchers → parser → layout）只把代码认成 `ParsedNode` 树，**还没有**回
 * 到 Blockly 能加载的东西。这一层补最后一步：把树写成 `Blockly.serialization` 的
 * 状态（块、字段、输入、变量表、procedure 定义），宿主再 `workspaces.load` 就能得到
 * 可编辑工作区。
 *
 * 三条纪律：
 *   - **不猜**：认不出的语句（`UNRESOLVED*`）不写成任何块，只记诊断，宿主必须把诊断
 *     显示给用户；宁可「这段没搭出来」，不可静默换一个意思相近的块。
 *   - **确定性**：块 id 与变量 id 都按出现顺序派生，同一段代码每次产出同一份 JSON，
 *     否则下游没法用快照比对。
 *   - **无 Blockly 依赖**：这一层只产出纯对象，`workspaces.load` 由宿主（浏览器）调用。
 */

import type { ProcedureSignature } from './layout';
import type { ParsedNode } from './parser';

/** 序列化后的块状态：Blockly `serialization.blocks.State` 的子集。 */
export interface SerializedBlock {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block: SerializedBlock }>;
  next?: { block: SerializedBlock };
  extraState?: Record<string, unknown>;
}

export interface SerializeDiagnostic {
  /** 认不出的原文（去缩进后的整段），用于面板上逐条显示。 */
  text: string;
  /**
   * 为什么没认出来：`unresolved` 是模板没匹上，`unsupported` 是这一层还没实现，
   * `foreign-code` 是「像外来实现、当前路径不支持」（此时不产出半成品，只给一句说明），
   * `semantic-drift` 是块出来了但块模型的语义与原文不同（按位 uint32、range 空区间）。
   */
  reason: 'unresolved' | 'unsupported' | 'foreign-code' | 'semantic-drift';
  /** 行号（1 基）：AST 路径逐节点报错，必须能指回用户看的那一行。 */
  line?: number;
  /** 补充说明（例如「不支持的表达式：ListComp」），面板可以跟在原文后面显示。 */
  detail?: string;
}

export interface SerializedWorkspace {
  blocks: { languageVersion: number; blocks: SerializedBlock[] };
  variables: Array<{ name: string; id: string }>;
  diagnostics: SerializeDiagnostic[];
}

/** 字段值是「变量名」而不是字面量的块：序列化时要换成 `{ id }` 引用。 */
const VARIABLE_FIELD_BLOCKS = new Set([
  'variables_get',
  'variables_set',
  'sbox_variables_get',
  'sbox_variables_set',
  // 循环变量的字段也是变量引用（AST 路径同样发 `{ id }`）。
  'controls_for',
  'controls_forEach',
]);

const UNRESOLVED_PREFIX = 'UNRESOLVED';

/** 顶层块的排布：只求不重叠、可读，不追求和原 demo 的坐标一致（坐标不是证据）。 */
const ROOT_X = 40;
const ROOT_Y = 40;
const ROOT_STEP_Y = 160;

/** 一条语句单元：原文 + 反解析结果。诊断要能指回用户看到的那一行。 */
export interface StatementNode {
  text: string;
  node: ParsedNode;
}

/** 一个 procedure：签名（含形参名与 Python 类型提示）+ 体内语句 + return 表达式。 */
export interface ProcedureNode {
  signature: ProcedureSignature;
  body: StatementNode[];
  returnNode: StatementNode | null;
}

export interface SerializeOptions {
  /** 变量名 → id 的既有映射；不给就按出现顺序派生。 */
  variableIds?: Map<string, string>;
  /** procedure 定义：序列化时排在顶层语句之前（生成器按坐标排序，def 通常在前）。 */
  procedures?: ProcedureNode[];
}

/**
 * 生成器写的 Python 类型提示是**有损**的：`key`/`seed`/`message` 都写 `bytes`，
 * `poly` 与 `int_list` 都写 `list[int]`。这里只回填提示能确定的那一档；生成代码
 * 不读类型标签，所以这不影响往返，影响的是编辑器里显示的标签精度。
 */
function typeOfHint(hint: string): string {
  const normalized = hint.trim();
  if (normalized === 'list[int]' || normalized === 'poly') return 'int_list';
  if (normalized === 'str') return 'string';
  // 其余按原样回填：生成器的 TYPE_MAP_PY 只翻译它认识的类型，不认识时就照打提示，
  // 所以 `string` 这类词回填成同名类型才能重新生成同样的签名（猜成 bytes 会改签名）。
  return normalized || 'bytes';
}

/**
 * 把一串语句节点写成工作区状态。
 *
 * 调用方负责先把代码切成语句单元再逐条 `parseStatement`：本层不做分词，也不判断
 * 「这是什么语言」——它只认 `ParsedNode` 的形状。
 */
export function toWorkspaceState(
  units: StatementNode[],
  options: SerializeOptions = {},
): SerializedWorkspace {
  const diagnostics: SerializeDiagnostic[] = [];
  const variables = new Map<string, string>(options.variableIds ?? []);
  let nextId = 0;

  const idOf = (): string => {
    nextId += 1;
    return `ai-helper-${nextId.toString(36)}`;
  };

  const variableId = (name: string): string => {
    const existing = variables.get(name);
    if (existing) return existing;
    const id = `ai-var-${variables.size + 1}`;
    variables.set(name, id);
    return id;
  };

  /** 形参先登记：体内 `variables_get` 必须引用同一个变量，不能各建一份。 */
  for (const procedure of options.procedures ?? []) {
    for (const param of procedure.signature.params) {
      if (!variables.has(param.name)) variables.set(param.name, `param-${param.name}`);
    }
  }

  /**
   * 沿着 `next` 走到链尾。
   *
   * 一条语句单元不一定是单块：推导式展开成「空列表 + 循环 + append」时，`toBlock` 返回的是
   * 链头。把链头当游标去接下一句，会覆盖掉中间那条 `next`（`table = []` 直接接上后一句，
   * 循环与 append 被静默吞掉）——所以串联一律用链尾。
   */
  const tailOf = (block: SerializedBlock): SerializedBlock => {
    let cursor = block;
    while (cursor.next) cursor = cursor.next.block;
    return cursor;
  };

  /** 一个节点 → 一个块；认不出的返回 null（并记诊断），不产出替代块。 */
  const toBlock = (node: ParsedNode, text: string): SerializedBlock | null => {
    // 诊断要指回原文：复合语句的子节点自带文本（核心语法层填的），没有就用外层。
    const source = node.text ?? text;
    if (node.type.startsWith(UNRESOLVED_PREFIX)) {
      // 核心语法层给出的原因与说明优先（`blocked`）：同一条语句只报一次，且能说清缺什么原语。
      diagnostics.push({
        text: source,
        reason: node.blocked?.reason ?? 'unresolved',
        detail: node.blocked?.detail,
      });
      return null;
    }
    if (node.type === 'EMPTY') return null;

    // 语句链是虚拟节点（`chain`）：它不出块，只把子语句串成 next 链。
    if (node.type === 'chain') {
      let head: SerializedBlock | null = null;
      let cursor: SerializedBlock | null = null;
      for (const child of node.children) {
        const childBlock = toBlock(child.node, source);
        if (!childBlock) continue;
        if (!head) head = childBlock;
        else if (cursor) cursor.next = { block: childBlock };
        cursor = tailOf(childBlock);
      }
      return head;
    }

    const block: SerializedBlock = { type: node.type, id: idOf() };
    if (node.extraState) block.extraState = node.extraState;
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(node.fields)) {
      fields[name] = VARIABLE_FIELD_BLOCKS.has(node.type) && name === 'VAR'
        ? { id: variableId(value) }
        : value;
    }
    if (Object.keys(fields).length) block.fields = fields;

    let dropped = false;
    const diagnosticsBefore = diagnostics.length;
    for (const child of node.children) {
      const childBlock = toBlock(child.node, text);
      if (!childBlock) {
        dropped = true;
        continue;
      }
      block.inputs ??= {};
      block.inputs[child.input] = { block: childBlock };
    }
    // 子块认不出时整块不写：留一个缺输入的空壳会生成一段残缺代码，比不搭更误导。
    // 诊断只记一条：子块自己已经记过（真实浏览器里曾因此把同一行报两次），只有当
    // 没有任何子块报过（例如空语句）时才由这一层补记，否则用户会以为有两处错误。
    if (dropped) {
      if (diagnostics.length === diagnosticsBefore) diagnostics.push({ text, reason: 'unresolved' });
      return null;
    }
    return block;
  };

  /** 把一串语句串成 `next` 链，返回链头（空语句返回 null）。 */
  const toChain = (list: StatementNode[]): SerializedBlock | null => {
    let head: SerializedBlock | null = null;
    let cursor: SerializedBlock | null = null;
    for (const unit of list) {
      const block = toBlock(unit.node, unit.text);
      if (!block) continue;
      if (!head) head = block;
      else if (cursor) cursor.next = { block };
      // 一条语句可能不是单块（`chain` 虚拟节点：推导式展开成「空列表 + 循环 + append」），
      // 此时 `block` 是链头，游标必须走到链尾，否则下一条语句会覆盖掉链中间的 `next`。
      cursor = tailOf(block);
    }
    return head;
  };

  const roots: SerializedBlock[] = [];
  for (const procedure of options.procedures ?? []) {
    const block: SerializedBlock = {
      type: procedure.returnNode ? 'procedures_defreturn' : 'procedures_defnoreturn',
      id: idOf(),
      // 函数名在 NAME 字段里，生成器只认它；漏了就退化成 unnamedN。
      fields: { NAME: procedure.signature.name },
      extraState: {
        params: procedure.signature.params.map((param) => ({
          name: param.name,
          id: variableId(param.name),
          type: typeOfHint(param.type),
        })),
        // hasStatements 不是装饰：false 时自定义 def 块会 removeInput('STACK')，
        // 而序列化状态里若还带 STACK，加载会报「missing a(n) STACK connection」。
        hasStatements: procedure.body.length > 0,
      },
    };
    const stack = toChain(procedure.body);
    if (stack) block.inputs = { STACK: { block: stack } };
    if (procedure.returnNode) {
      const diagnosticsBefore = diagnostics.length;
      const returned = toBlock(procedure.returnNode.node, procedure.returnNode.text);
      if (returned) {
        block.inputs ??= {};
        block.inputs.RETURN = { block: returned };
      } else if (diagnostics.length === diagnosticsBefore) {
        // 同上：`toBlock` 认不出时已记过，这里只补记「返回了空表达式」这一种没记过的情况。
        diagnostics.push({ text: procedure.returnNode.text, reason: 'unresolved' });
      }
    }
    roots.push(block);
  }

  for (const unit of units) {
    const block = toBlock(unit.node, unit.text);
    if (block) roots.push(block);
  }

  roots.forEach((block, index) => {
    block.x = ROOT_X;
    block.y = ROOT_Y + index * ROOT_STEP_Y;
  });

  return {
    blocks: { languageVersion: 0, blocks: roots },
    variables: [...variables.entries()].map(([name, id]) => ({ name, id })),
    diagnostics,
  };
}

/**
 * 状态里一共有多少个块（含嵌套子块与 next 链）。
 *
 * 面板要报的「将载入 N 个块」必须与载入后编辑器状态栏的数字一致：只数顶层根节点会少报
 * （AES 那段代码顶层 2 个、加载后画布 4 个），用户会以为有块被吞了。
 */
export function countStateBlocks(state: SerializedWorkspace): number {
  const walk = (block: SerializedBlock): number => {
    let total = 1;
    for (const input of Object.values(block.inputs ?? {})) total += walk(input.block);
    if (block.next) total += walk(block.next.block);
    return total;
  };
  return state.blocks.blocks.reduce((sum, block) => sum + walk(block), 0);
}
