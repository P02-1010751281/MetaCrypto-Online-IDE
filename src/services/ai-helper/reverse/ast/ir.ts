/**
 * Python AST → 白名单 IR（B 线 B2 / S3 第一段）
 *
 * 这一层是「不猜」原则的落点：只认下面列出的节点，其余一律记诊断并带行号，
 * 绝不换成意思相近的东西。IR 只描述**结构性**的东西（赋值、判断、循环、调用、
 * 返回、字面量），不携带任何密码学语义——语义由 `blocks.ts` 按块类型翻译。
 *
 * 与模板路径的分工：模板路径认的是「本平台生成器写出来的代码形态」，AST 路径认的是
 * 「Python 语法结构」。后者能处理 LLM 写的参考实现，代价是拿不到领域类型标签
 * （RESULTS §35.3 已确认生成器类型提示本身有损），所以本层不做类型推断。
 *
 * 文件切分：共用类型与节点工具在 `ir-shared.ts`，表达式在 `ir-expr.ts`，本文件只剩
 * 语句与模块组装（守住单文件 ≤ 500 行）。
 */

import type { AstNode } from './dump';
import { RANGE_ARITY, RANGE_STEP } from '../diagnostics';
import { desugarListComp } from './ir-comprehension';
import { callToIr, exprToIr } from './ir-expr';
import { child, children, integerValue, lineOf, nameOf, report, snippet } from './ir-shared';
import type { Ctx, IrBinOp, IrDiag, IrExpr, IrStmt } from './ir-shared';
import type { PrimitiveIndex } from '../primitive-calls';

// 桶：外部一直从 './ir' 取这些类型与函数，拆文件不改调用方。
export type { IrBinOp, IrCompareOp, IrDiag, IrExpr, IrStmt } from './ir-shared';

export interface IrProcedure {
  name: string;
  params: string[];
  body: IrStmt[];
  /** 唯一的返回值（块模型只有 `procedures_defreturn` 的 RETURN 口）。 */
  returns: IrExpr | null;
  line?: number;
}

export interface IrModule {
  procedures: IrProcedure[];
  topLevel: IrStmt[];
  diagnostics: IrDiag[];
}

const AUGASSIGN_OPS: Record<string, IrBinOp> = {
  Add: 'ADD',
  Sub: 'MINUS',
  Mult: 'MULTIPLY',
  Div: 'DIVIDE',
  Pow: 'POWER',
  Mod: 'MOD',
  BitAnd: 'BIT_AND',
  BitOr: 'BIT_OR',
  BitXor: 'BIT_XOR',
  LShift: 'SHL',
  RShift: 'SHR',
};

/** 列表字面量的上限：再长就不是在搭积木，而是在倒一张表。 */
/**
 * 语句序列 → IR 序列；不支持的单条记诊断后跳过，其余照常转换。
 *
 * `nested` 表示这段语句处在 if/for/while 的分支里：块模型只有一个返回值（defreturn 的
 * RETURN 口），分支里的 return 没有落点，必须显式报出来——静默丢掉会改变控制流语义。
 */
function bodyToIr(nodes: AstNode[], ctx: Ctx, nested = false): IrStmt[] {
  const out: IrStmt[] = [];
  nodes.forEach((node, index) => {
    // 文档串是注释，不是语句：函数体第一条字面量字符串直接跳过，不记诊断。
    if (index === 0 && node._ === 'Expr') {
      const value = child(node, 'value');
      if (value?._ === 'Constant' && typeof value.value === 'string') return;
    }
    if (node._ === 'Pass') return;
    if (nested && node._ === 'Return') {
      report(ctx, node, '分支里的 return 不支持（块模型只有一个返回值）');
      return;
    }
    // 一条源语句可能展开成多条 IR 语句（`target = [...]` 的推导式 → 空列表 + 循环）。
    const converted = stmtToIr(node, ctx);
    if (Array.isArray(converted)) out.push(...converted);
    else if (converted) out.push(converted);
  });
  return out;
}

function stmtToIr(node: AstNode, ctx: Ctx): IrStmt | IrStmt[] | null {
  const line = lineOf(node);
  switch (node._) {
    case 'Assign': {
      const targets = children(node, 'targets');
      if (targets.length !== 1 || targets[0]._ !== 'Name') {
        return report(ctx, node, '只支持单个变量赋值（a = b = c、元组赋值、下标赋值都翻不了）');
      }
      const target = nameOf(targets[0]);
      const valueNode = child(node, 'value');
      // 推导式落在赋值右侧时可能展开成「空列表 + 循环 + append」三条语句；静态可展开的
      // 形态返回 'static'，回落到下面的普通表达式转换（既有语义不变）。
      if (valueNode && valueNode._ === 'ListComp') {
        const planned = desugarListComp(target, valueNode, ctx, exprToIr);
        if (Array.isArray(planned)) {
          ctx.scope.add(target);
          return planned;
        }
        if (planned === null) return null;
      }
      const value = exprToIr(valueNode, ctx);
      if (!value) return null;
      ctx.scope.add(target);
      return { kind: 'assign', target, value, line };
    }
    case 'AugAssign': {
      const target = child(node, 'target');
      if (!target || target._ !== 'Name') {
        return report(ctx, node, '只支持对单个变量做复合赋值（s[i] ^= x 这类翻不了）');
      }
      const opNode = child(node, 'op');
      const op = opNode ? AUGASSIGN_OPS[opNode._] : undefined;
      if (!op) return report(ctx, node, '不支持的复合赋值运算符');
      const value = exprToIr(child(node, 'value'), ctx);
      if (!value) return null;
      ctx.scope.add(nameOf(target));
      return { kind: 'augassign', target: nameOf(target), op, value, line };
    }
    case 'Expr': {
      const value = child(node, 'value');
      if (value && value._ === 'Call') return callToIr(value, ctx, 'statement') as IrStmt | null;
      return report(ctx, node, '不支持单独的表达式语句');
    }
    case 'Return': {
      const valueNode = child(node, 'value');
      if (!valueNode) return { kind: 'return', value: null, line };
      const value = exprToIr(valueNode, ctx);
      if (!value) return null;
      return { kind: 'return', value, line };
    }
    case 'If': {
      const branches: Array<{ test: IrExpr; body: IrStmt[] }> = [];
      const firstTest = exprToIr(child(node, 'test'), ctx);
      if (!firstTest) return null;
      branches.push({ test: firstTest, body: bodyToIr(children(node, 'body'), ctx, true) });
      // elif 在 AST 里是「orelse 里只有一个 If」，逐层摊平成同一组分支。
      let orelseNodes = children(node, 'orelse');
      while (orelseNodes.length === 1 && orelseNodes[0]._) {
        if (orelseNodes[0]._ !== 'If') break;
        const next = orelseNodes[0];
        const test = exprToIr(child(next, 'test'), ctx);
        if (!test) return null;
        branches.push({ test, body: bodyToIr(children(next, 'body'), ctx, true) });
        orelseNodes = children(next, 'orelse');
      }
      return { kind: 'if', branches, orelse: bodyToIr(orelseNodes, ctx, true), line };
    }
    case 'For': {
      const target = child(node, 'target');
      const iterator = child(node, 'iter');
      if (!target || target._ !== 'Name') {
        return report(ctx, node, '只支持 for 单个循环变量');
      }
      if (!iterator) return report(ctx, node, 'for 缺少迭代器');
      // 非 range 迭代器：`for x in <列表表达式>` → 原生 controls_forEach（与模板路径同口径）。
      if (iterator._ !== 'Call' || nameOf(child(iterator, 'func')) !== 'range') {
        const variable = nameOf(target);
        const list = exprToIr(iterator, ctx);
        if (!list) return null;
        ctx.scope.add(variable);
        return {
          kind: 'forEach',
          variable,
          list,
          body: bodyToIr(children(node, 'body'), ctx, true),
          line,
        };
      }
      const args = children(iterator, 'args').map((arg) => exprToIr(arg, ctx));
      if (args.some((arg) => !arg)) return null;
      const values = args as IrExpr[];
      if (values.length < 1 || values.length > 3) {
        return report(ctx, node, RANGE_ARITY);
      }
      const variable = nameOf(target);
      // 循环变量在体内可见：先登记，体内再出现同名推导式时才会改名。
      ctx.scope.add(variable);
      // 一参数 `range(n)` 与 Python 的「执行 n 次」逐字对应：落到 ctrl_iterate（TIMES 是值输入），
      // 既没有空区间倒序问题，也不需要按字面量分档。
      if (values.length === 1) {
        return {
          kind: 'iterate',
          variable,
          times: values[0],
          body: bodyToIr(children(node, 'body'), ctx, true),
          line,
        };
      }
      if (values.length === 3) {
        const step = integerValue(values[2]);
        if (step !== BigInt(1)) {
          return report(ctx, node, RANGE_STEP);
        }
      }
      // 两/三参（步长 1）：`ctrl_range` 的 TO 是**独占**终点，与 Python 的 range(a, b) 逐字对应，
      // 常量空区间（a >= b）也精确（一次不执行），不再需要空区间/端点的漂移诊断。
      return {
        kind: 'range',
        variable,
        from: values[0],
        to: values[1],
        body: bodyToIr(children(node, 'body'), ctx, true),
        line,
      };
    }
    case 'While': {
      const test = exprToIr(child(node, 'test'), ctx);
      if (!test) return null;
      return { kind: 'while', test, body: bodyToIr(children(node, 'body'), ctx, true), line };
    }
    case 'Break':
      return { kind: 'flow', flow: 'BREAK', line };
    case 'Continue':
      return { kind: 'flow', flow: 'CONTINUE', line };
    default:
      return report(ctx, node, `不支持的语句：${node._}`);
  }
}

/** 函数体里的 return：只有「唯一一个且在末尾」能对上块模型，其余要报出来。 */
function extractReturn(body: IrStmt[], ctx: Ctx, procedure: AstNode): IrExpr | null {
  const returns = body.filter((stmt) => stmt.kind === 'return');
  if (returns.length === 0) return null;
  const last = body[body.length - 1];
  if (returns.length > 1 || last.kind !== 'return') {
    returns.forEach((stmt) => {
      ctx.diagnostics.push({
        text: snippet(ctx, procedure),
        line: stmt.line,
        detail: '一个函数里有多个/非末尾 return，块模型只有一个返回值',
      });
    });
    return null;
  }
  const value = (last as { value: IrExpr | null }).value;
  body.pop();
  return value;
}

/** 顶层与函数体里的 def 分流：两条路径共用同一份「闭包名单之外才是 procedure」的判据。 */
export function astToIr(module: AstNode, source: string, primitives?: PrimitiveIndex): IrModule {
  const ctx: Ctx = {
    procedures: new Set<string>(),
    primitives,
    diagnostics: [],
    lines: source.split('\n'),
    scope: new Set<string>(),
  };

  const defs = children(module, 'body').filter(
    (node) => node._ === 'FunctionDef' || node._ === 'AsyncFunctionDef',
  );
  for (const def of defs) {
    const name = nameOf(def);
    if (!name) {
      report(ctx, def, '函数缺少名字');
      continue;
    }
    ctx.procedures.add(name);
  }

  const procedures: IrProcedure[] = [];
  const topLevelNodes: AstNode[] = [];
  for (const node of children(module, 'body')) {
    if (node._ === 'FunctionDef') {
      const name = nameOf(node);
      const args = child(node, 'args');
      const params = args ? children(args, 'args').map((arg) => nameOf(arg)) : [];
      if (params.some((param) => !param)) {
        report(ctx, node, '形参缺少名字');
        continue;
      }
      if (args && (child(args, 'vararg') || child(args, 'kwarg'))) {
        report(ctx, node, '不支持 *args / **kwargs');
        continue;
      }
      // 每个函数一份作用域：形参先算「已出现过的名字」。Python 函数没有块级作用域，
      // 分支/循环里的赋值都加进同一个集合。
      ctx.scope = new Set(params);
      const body = bodyToIr(children(node, 'body'), ctx);
      const returns = extractReturn(body, ctx, node);
      procedures.push({ name, params, body, returns, line: lineOf(node) });
      continue;
    }
    if (node._ === 'AsyncFunctionDef' || node._ === 'ClassDef') {
      report(ctx, node, `${node._} 不支持（只认普通函数）`);
      continue;
    }
    topLevelNodes.push(node);
  }

  // 顶层是另一份作用域：上一个函数的局部名字不能影响顶层的推导式改名。
  ctx.scope = new Set<string>();
  const topLevel = bodyToIr(topLevelNodes, ctx);

  return { procedures, topLevel, diagnostics: ctx.diagnostics };
}
