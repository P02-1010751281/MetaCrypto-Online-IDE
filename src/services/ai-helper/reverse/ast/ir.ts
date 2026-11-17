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
import { RANGE_ARITY, RANGE_EMPTY, RANGE_ENDPOINT, RANGE_STEP } from '../diagnostics';
import { callToIr, exprToIr } from './ir-expr';
import { child, children, integerValue, lineOf, minusOne, nameOf, report, reportDrift, snippet } from './ir-shared';
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
    const converted = stmtToIr(node, ctx);
    if (converted) out.push(converted);
  });
  return out;
}

function stmtToIr(node: AstNode, ctx: Ctx): IrStmt | null {
  const line = lineOf(node);
  switch (node._) {
    case 'Assign': {
      const targets = children(node, 'targets');
      if (targets.length !== 1 || targets[0]._ !== 'Name') {
        return report(ctx, node, '只支持单个变量赋值（a = b = c、元组赋值、下标赋值都翻不了）');
      }
      const value = exprToIr(child(node, 'value'), ctx);
      if (!value) return null;
      return { kind: 'assign', target: nameOf(targets[0]), value, line };
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
      if (!iterator || iterator._ !== 'Call' || nameOf(child(iterator, 'func')) !== 'range') {
        return report(ctx, node, '只支持 for ... in range(...)');
      }
      const args = children(iterator, 'args').map((arg) => exprToIr(arg, ctx));
      if (args.some((arg) => !arg)) return null;
      const values = args as IrExpr[];
      if (values.length < 1 || values.length > 3) {
        return report(ctx, node, RANGE_ARITY);
      }
      // 一参数 `range(n)` 与 Python 的「执行 n 次」逐字对应：落到 ctrl_iterate（TIMES 是值输入），
      // 既没有空区间倒序问题，也不需要按字面量分档。
      if (values.length === 1) {
        return {
          kind: 'iterate',
          variable: nameOf(target),
          times: values[0],
          body: bodyToIr(children(node, 'body'), ctx, true),
          line,
        };
      }
      const from: IrExpr = values[0];
      const toSource = values[1];
      if (values.length === 3) {
        const step = integerValue(values[2]);
        if (step !== BigInt(1)) {
          return report(ctx, node, RANGE_STEP);
        }
      }
      // 块模型的循环方向是自适应的（FROM > TO 时倒序执行），而 Python 的 range 在起点 ≥ 终点时
      // **一次也不执行**。两边只在这个「空区间」上不同：常量能判定的直接不产出块；非常量无法
      // 静态判定，只能照样出块并把差异标出来——这是差分执行判据抓到的第一个真问题。
      const fromValue = integerValue(from);
      const stopValue = integerValue(toSource);
      if (fromValue !== null && stopValue !== null) {
        if (fromValue >= stopValue) {
          return report(ctx, node, RANGE_EMPTY);
        }
      } else {
        reportDrift(ctx, node, RANGE_ENDPOINT);
      }
      return {
        kind: 'for',
        variable: nameOf(target),
        from,
        to: minusOne(toSource),
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

  const topLevel = bodyToIr(topLevelNodes, ctx);

  return { procedures, topLevel, diagnostics: ctx.diagnostics };
}
