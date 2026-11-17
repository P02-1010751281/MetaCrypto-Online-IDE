/**
 * AST 序列化 · 表达式 → 值块。
 *
 * 只输出已注册的块；IR 已经把不支持的在 IR 层挡掉（带诊断），这里的 null 只可能出现在
 * 空表达式或 IR bug 上。与 `blocks.ts` 的语句序列化共用块上下文（`block-ctx.ts`）。
 */

import type { SerializedBlock } from '../serialize';
import type { IrBinOp, IrExpr } from './ir';
import { type Ctx, newId, numBlock, varField } from './block-ctx';

const BITWISE_OP: Partial<Record<IrBinOp, string>> = {
  BIT_AND: 'AND',
  BIT_OR: 'OR',
  BIT_XOR: 'XOR',
  SHL: 'LEFT_SHIFT',
  SHR: 'RIGHT_SHIFT',
};

const ARITHMETIC_OP: Partial<Record<IrBinOp, string>> = {
  ADD: 'ADD',
  MINUS: 'MINUS',
  MULTIPLY: 'MULTIPLY',
  DIVIDE: 'DIVIDE',
  POWER: 'POWER',
};


/** 表达式 → 值块。IR 已经把不支持的都挡掉了，这里的 null 只可能出现在空表达式上。 */
function exprBlock(expr: IrExpr, ctx: Ctx): SerializedBlock | null {
  switch (expr.kind) {
    case 'num':
      return numBlock(ctx, expr.value);
    case 'str':
      return { type: 'text', id: newId(ctx), fields: { TEXT: expr.value } };
    case 'bool':
      return {
        type: 'logic_boolean',
        id: newId(ctx),
        fields: { BOOL: expr.value ? 'TRUE' : 'FALSE' },
      };
    case 'none':
      return { type: 'logic_null', id: newId(ctx) };
    case 'name':
      return { type: 'variables_get', id: newId(ctx), fields: varField(ctx, expr.name) };
    case 'neg': {
      const operand = exprBlock(expr.operand, ctx);
      if (!operand) return null;
      return {
        type: 'math_single',
        id: newId(ctx),
        fields: { OP: 'NEG' },
        inputs: { NUM: { block: operand } },
      };
    }
    case 'not': {
      const operand = exprBlock(expr.operand, ctx);
      if (!operand) return null;
      return { type: 'logic_negate', id: newId(ctx), inputs: { BOOL: { block: operand } } };
    }
    case 'binop': {
      const left = exprBlock(expr.left, ctx);
      const right = left ? exprBlock(expr.right, ctx) : null;
      if (!left || !right) return null;
      const bitwise = BITWISE_OP[expr.op];
      if (bitwise) {
        return {
          type: 'bit_operation',
          id: newId(ctx),
          fields: { OP: bitwise },
          inputs: { A: { block: left }, B: { block: right } },
        };
      }
      if (expr.op === 'MOD') {
        return {
          type: 'math_modulo',
          id: newId(ctx),
          inputs: { DIVIDEND: { block: left }, DIVISOR: { block: right } },
        };
      }
      const op = ARITHMETIC_OP[expr.op];
      if (!op) {
        ctx.diagnostics.push({ text: '表达式', reason: 'unsupported', detail: `没有对应运算符块：${expr.op}` });
        return null;
      }
      return {
        type: 'math_arithmetic',
        id: newId(ctx),
        fields: { OP: op },
        inputs: { A: { block: left }, B: { block: right } },
      };
    }
    case 'compare': {
      const left = exprBlock(expr.left, ctx);
      const right = left ? exprBlock(expr.right, ctx) : null;
      if (!left || !right) return null;
      return {
        type: 'logic_compare',
        id: newId(ctx),
        fields: { OP: expr.op },
        inputs: { A: { block: left }, B: { block: right } },
      };
    }
    case 'boolop': {
      const left = exprBlock(expr.left, ctx);
      const right = left ? exprBlock(expr.right, ctx) : null;
      if (!left || !right) return null;
      return {
        type: 'logic_operation',
        id: newId(ctx),
        fields: { OP: expr.op },
        inputs: { A: { block: left }, B: { block: right } },
      };
    }
    case 'list': {
      const items: SerializedBlock[] = [];
      for (const item of expr.items) {
        const block = exprBlock(item, ctx);
        if (!block) return null;
        items.push(block);
      }
      if (!items.length) return { type: 'lists_create_empty', id: newId(ctx) };
      const inputs: Record<string, { block: SerializedBlock }> = {};
      items.forEach((block, index) => {
        inputs[`ADD${index}`] = { block };
      });
      return {
        type: 'lists_create_with',
        id: newId(ctx),
        extraState: { itemCount: items.length },
        inputs,
      };
    }
    case 'index': {
      const value = exprBlock(expr.value, ctx);
      const at = value ? exprBlock(expr.at, ctx) : null;
      if (!value || !at) return null;
      return {
        type: 'lists_getIndex',
        id: newId(ctx),
        fields: { MODE: 'GET', WHERE: 'FROM_START' },
        inputs: { VALUE: { block: value }, AT: { block: at } },
      };
    }
    case 'length': {
      // 原生列表长度块：Python 生成就是 `len(...)`，与 AST 里的 `len(x)` 逐字对应。
      const value = exprBlock(expr.value, ctx);
      if (!value) return null;
      return { type: 'lists_length', id: newId(ctx), inputs: { VALUE: { block: value } } };
    }
    case 'constrain': {
      // Blockly 原生钳位块：Python 生成 `min(max(v, low), high)`。切片长度用它钳到 [0, len]。
      const value = exprBlock(expr.value, ctx);
      const low = value ? exprBlock(expr.low, ctx) : null;
      const high = low ? exprBlock(expr.high, ctx) : null;
      if (!value || !low || !high) return null;
      return {
        type: 'math_constrain',
        id: newId(ctx),
        inputs: {
          VALUE: { block: value },
          LOW: { block: low },
          HIGH: { block: high },
        },
      };
    }
    case 'ifexp': {
      const test = exprBlock(expr.test, ctx);
      const then = test ? exprBlock(expr.then, ctx) : null;
      const otherwise = then ? exprBlock(expr.otherwise, ctx) : null;
      if (!test || !then || !otherwise) return null;
      return {
        type: 'logic_ternary',
        id: newId(ctx),
        inputs: { IF: { block: test }, THEN: { block: then }, ELSE: { block: otherwise } },
      };
    }
    case 'call': {
      const params = ctx.signatures.get(expr.name) ?? [];
      const inputs: Record<string, { block: SerializedBlock }> = {};
      for (let index = 0; index < expr.args.length; index += 1) {
        const block = exprBlock(expr.args[index], ctx);
        if (!block) return null;
        inputs[`ARG${index}`] = { block };
      }
      return {
        type: 'procedures_callreturn',
        id: newId(ctx),
        extraState: { name: expr.name, params },
        inputs,
      };
    }
    case 'primitive': {
      const inputs: Record<string, { block: SerializedBlock }> = {};
      for (let index = 0; index < expr.args.length; index += 1) {
        const slot = expr.primitive.inputs[index];
        const block = slot ? exprBlock(expr.args[index], ctx) : null;
        if (!slot || !block) {
          ctx.diagnostics.push({
            text: `${expr.primitive.call}()`,
            reason: 'unsupported',
            detail: `块的输入槽与实参个数对不上（模板只有 ${expr.primitive.inputs.length} 个）`,
          });
          return null;
        }
        inputs[slot] = { block };
      }
      return { type: expr.primitive.type, id: newId(ctx), inputs };
    }
    default:
      return null;
  }
}


export { exprBlock };