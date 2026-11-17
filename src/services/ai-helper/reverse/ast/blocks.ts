/**
 * IR → Blockly 序列化状态（B 线 B2 / S3 第一段）
 *
 * 只输出**已注册的块**：核心 Blockly 块（`variables_*` / `math_*` / `logic_*` /
 * `controls_*` / `lists_*` / `text`）与本项目覆盖的 procedure 块。核心块在工具箱的
 * 「控制流 / 数学 / 数组」类目里本来就有，用户点开画布能继续编辑，不是只能看的死块。
 *
 * 三条与模板路径一致的纪律：
 *   - **不猜**：认不出就不写块，交给诊断；不拿相近块顶替。
 *   - **确定性**：块 id 与变量 id 按出现顺序派生，同一段输入每次产出同一份 JSON。
 *   - **无 Blockly 依赖**：只产出纯对象，`workspaces.load` 由宿主调用。
 */

import type { SerializedBlock, SerializedWorkspace } from '../serialize';
import type { IrExpr, IrModule, IrStmt } from './ir';
import { type Ctx, newId, variableId, varField, numBlock } from './block-ctx';
import { exprBlock } from './expr-blocks';

/** 参数类型只能给块模型的默认值：AST 里没有任何类型标签（RESULTS §35.3）。 */
const DEFAULT_PARAM_TYPE = 'bytes';

/** 一条语句 → 一个块（不含 next）。 */
function stmtBlock(stmt: IrStmt, ctx: Ctx): SerializedBlock | null {
  switch (stmt.kind) {
    case 'assign': {
      const value = exprBlock(stmt.value, ctx);
      if (!value) return null;
      return {
        type: 'variables_set',
        id: newId(ctx),
        fields: varField(ctx, stmt.target),
        inputs: { VALUE: { block: value } },
      };
    }
    case 'augassign': {
      const target: IrExpr = { kind: 'name', name: stmt.target };
      const merged: IrExpr = { kind: 'binop', op: stmt.op, left: target, right: stmt.value };
      const value = exprBlock(merged, ctx);
      if (!value) return null;
      return {
        type: 'variables_set',
        id: newId(ctx),
        fields: varField(ctx, stmt.target),
        inputs: { VALUE: { block: value } },
      };
    }
    case 'call': {
      const params = ctx.signatures.get(stmt.name) ?? [];
      const inputs: Record<string, { block: SerializedBlock }> = {};
      for (let index = 0; index < stmt.args.length; index += 1) {
        const block = exprBlock(stmt.args[index], ctx);
        if (!block) return null;
        inputs[`ARG${index}`] = { block };
      }
      return {
        type: 'procedures_callnoreturn',
        id: newId(ctx),
        extraState: { name: stmt.name, params },
        inputs,
      };
    }
    case 'return':
      // 只可能出现在函数体末尾，由 procedure 组装时取走；这里出现说明 IR 有 bug。
      return null;
    case 'primitive': {
      const inputs: Record<string, { block: SerializedBlock }> = {};
      for (let index = 0; index < stmt.args.length; index += 1) {
        const slot = stmt.primitive.inputs[index];
        const block = slot ? exprBlock(stmt.args[index], ctx) : null;
        if (!slot || !block) return null;
        inputs[slot] = { block };
      }
      return { type: stmt.primitive.type, id: newId(ctx), inputs };
    }
    case 'if': {
      const inputs: Record<string, { block: SerializedBlock }> = {};
      for (let index = 0; index < stmt.branches.length; index += 1) {
        const branch = stmt.branches[index];
        const test = exprBlock(branch.test, ctx);
        const body = stmtChain(branch.body, ctx);
        if (!test || !body) return null;
        inputs[`IF${index}`] = { block: test };
        inputs[`DO${index}`] = { block: body };
      }
      if (stmt.orelse.length) {
        const otherwise = stmtChain(stmt.orelse, ctx);
        if (!otherwise) return null;
        inputs.ELSE = { block: otherwise };
      }
      return {
        type: 'controls_if',
        id: newId(ctx),
        extraState: { elseIfCount: Math.max(0, stmt.branches.length - 1), hasElse: stmt.orelse.length > 0 },
        inputs,
      };
    }
    case 'for': {
      const from = exprBlock(stmt.from, ctx);
      const to = from ? exprBlock(stmt.to, ctx) : null;
      const body = to ? stmtChain(stmt.body, ctx) : null;
      if (!from || !to || !body) return null;
      return {
        type: 'controls_for',
        id: newId(ctx),
        fields: varField(ctx, stmt.variable),
        inputs: {
          FROM: { block: from },
          TO: { block: to },
          BY: { block: numBlock(ctx, '1') },
          DO: { block: body },
        },
      };
    }
    case 'iterate': {
      // 循环变量登记成工作区变量：体内对它的 variables_get 用变量 id 引用。
      variableId(ctx, stmt.variable);
      const times = exprBlock(stmt.times, ctx);
      if (!times) return null;
      const body = stmtChain(stmt.body, ctx);
      const block: SerializedBlock = {
        type: 'ctrl_iterate',
        id: newId(ctx),
        fields: { VAR: stmt.variable },
        inputs: { TIMES: { block: times } },
      };
      if (body) block.inputs!.DO = { block: body };
      return block;
    }
    case 'range': {
      // ctrl_range：TO 是独占终点，`range(FROM, TO)` 逐字对应。VAR 是文本字段（与 ctrl_iterate 同）。
      variableId(ctx, stmt.variable);
      const from = exprBlock(stmt.from, ctx);
      const to = from ? exprBlock(stmt.to, ctx) : null;
      const body = to ? stmtChain(stmt.body, ctx) : null;
      if (!from || !to) return null;
      const block: SerializedBlock = {
        type: 'ctrl_range',
        id: newId(ctx),
        fields: { VAR: stmt.variable },
        inputs: { FROM: { block: from }, TO: { block: to } },
      };
      if (body) block.inputs!.DO = { block: body };
      return block;
    }
    case 'forEach': {
      // controls_forEach：VAR 是变量字段，必须是 `{ id }` 引用。
      variableId(ctx, stmt.variable);
      const list = exprBlock(stmt.list, ctx);
      const body = list ? stmtChain(stmt.body, ctx) : null;
      if (!list) return null;
      const block: SerializedBlock = {
        type: 'controls_forEach',
        id: newId(ctx),
        fields: varField(ctx, stmt.variable),
        inputs: { LIST: { block: list } },
      };
      if (body) block.inputs!.DO = { block: body };
      return block;
    }
    case 'append': {
      // arr_append：`LIST.append(VALUE)`，原地修改列表。LIST 接目标变量。
      const list = exprBlock(stmt.list, ctx);
      const value = list ? exprBlock(stmt.value, ctx) : null;
      if (!list || !value) return null;
      return {
        type: 'arr_append',
        id: newId(ctx),
        inputs: { LIST: { block: list }, VALUE: { block: value } },
      };
    }
    case 'while': {
      const test = exprBlock(stmt.test, ctx);
      const body = test ? stmtChain(stmt.body, ctx) : null;
      if (!test || !body) return null;
      return {
        type: 'controls_whileUntil',
        id: newId(ctx),
        fields: { MODE: 'WHILE' },
        inputs: { BOOL: { block: test }, DO: { block: body } },
      };
    }
    case 'flow':
      return {
        type: 'controls_flow_statements',
        id: newId(ctx),
        fields: { FLOW: stmt.flow },
      };
    default:
      return null;
  }
}

/** 语句序列 → `next` 链，返回链头。空序列返回 null（调用方决定是「空分支」还是「不支持」）。 */
function stmtChain(stmts: IrStmt[], ctx: Ctx): SerializedBlock | null {
  let head: SerializedBlock | null = null;
  let cursor: SerializedBlock | null = null;
  for (const stmt of stmts) {
    const block = stmtBlock(stmt, ctx);
    if (!block) continue;
    if (!head) head = block;
    else if (cursor) cursor.next = { block };
    cursor = block;
  }
  return head;
}

/**
 * 顶层布局：函数排一列、顶层语句排另一列。
 *
 * 函数块的高度随体内语句增长（实测这段示例就有 500px），把顶层语句接在它下面必然压块。
 * 分两列既不重叠，也符合「先看函数、再看顶层语句」的阅读顺序。坐标不是证据，只求可读。
 */
const PROCEDURE_X = 40;
const STATEMENT_X = 760;
const ROOT_Y = 40;
const ROOT_STEP_Y = 200;

/** IR 模块 → 工作区状态。IR 里剩下的诊断逐条带行号转给面板。 */
export function irToWorkspace(ir: IrModule): SerializedWorkspace {
  const ctx: Ctx = {
    variables: new Map<string, string>(),
    signatures: new Map(ir.procedures.map((procedure) => [procedure.name, procedure.params])),
    diagnostics: ir.diagnostics.map((diag) => ({
      text: diag.text,
      reason: diag.reason ?? ('unsupported' as const),
      line: diag.line,
      detail: diag.detail,
    })),
    nextId: 0,
  };

  // 形参先登记：体内的 variables_get 必须引用同一个变量，不能各建一份。
  for (const procedure of ir.procedures) {
    for (const param of procedure.params) variableId(ctx, param);
  }

  const roots: SerializedBlock[] = [];

  for (const procedure of ir.procedures) {
    const block: SerializedBlock = {
      type: procedure.returns ? 'procedures_defreturn' : 'procedures_defnoreturn',
      id: newId(ctx),
      fields: { NAME: procedure.name },
      extraState: {
        params: procedure.params.map((param) => ({
          name: param,
          id: variableId(ctx, param),
          type: DEFAULT_PARAM_TYPE,
        })),
        hasStatements: procedure.body.length > 0,
      },
    };
    const stack = stmtChain(procedure.body, ctx);
    if (stack) block.inputs = { STACK: { block: stack } };
    if (procedure.returns) {
      const returned = exprBlock(procedure.returns, ctx);
      if (returned) {
        block.inputs ??= {};
        block.inputs.RETURN = { block: returned };
      } else {
        ctx.diagnostics.push({
          text: `return（${procedure.name}）`,
          reason: 'unsupported',
          detail: '返回值翻不出来，函数已按无返回值生成',
        });
      }
    }
    roots.push(block);
  }

  const procedureCount = roots.length;
  for (const stmt of ir.topLevel) {
    const block = stmtBlock(stmt, ctx);
    if (block) roots.push(block);
  }

  roots.forEach((block, index) => {
    const isProcedure = index < procedureCount;
    const columnIndex = isProcedure ? index : index - procedureCount;
    block.x = isProcedure ? PROCEDURE_X : STATEMENT_X;
    block.y = ROOT_Y + columnIndex * ROOT_STEP_Y;
  });

  return {
    blocks: { languageVersion: 0, blocks: roots },
    variables: [...ctx.variables.entries()].map(([name, id]) => ({ name, id })),
    diagnostics: ctx.diagnostics,
  };
}
