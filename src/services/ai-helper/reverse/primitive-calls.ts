/**
 * 已知原语调用 → 块（用户侧 AI Helper · B 线 P2.3d）
 *
 * 模板路径认的是「块生成出来的代码形态」，AST 路径认的是「Python 语法结构」。两边各管
 * 一段输入时，同一段 LLM 代码里的 `sha3_squeeze(state, 32)` 在 AST 路径上会被当成
 * 「工作区里没有的函数」——明明对应块就在画布工具箱里。这里把两边的词汇表接上：
 *
 *   采集时记下每个块的**连接能力**（`field-templates.json` 的 `io`）与它吐出的代码模板；
 *   运行时只把「单行、纯位置槽位 + 字面量关键字参数」的模板读成调用签名
 *   （调用名 + 形参个数 → 块类型 + 输入名）。
 *
 * 三条纪律：
 *   - **只认逐字对得上的名字**：不做大小写/近义词/前缀猜测，猜错等于把别人的函数换成
 *     我们的块，比报「没有对应块」更糟。
 *   - **参数个数必须精确相等**：模板里带 `rate_bytes=136` 这类字面量关键字参数时，调用
 *     方可以省掉（Python 的默认值语义与块默认字段一致）；但调用方**多给**参数就不认，
 *     因为块没有地方放它。
 *   - **有歧义就整条丢掉**：同一个「名字 + 参数个数」对应两个块时，两个都不进索引，
 *     宁可让 AST 路径报「没有对应块」，也不随机挑一个。
 */

import type { BlockFieldTemplate, FieldPayload } from './matchers';

/** 块在代码里的调用形态：调用名 + 按模板顺序的输入名。 */
export interface PrimitiveCall {
  /** 块类型（序列化用的 `type`）。 */
  type: string;
  /** 该块生成代码时的函数名；与块类型不一定同名（`pq_byte_concat` 吐 `bytes_concat`）。 */
  call: string;
  /** 模板里 `valueToCode(block, NAME)` 的 NAME，顺序即实参顺序。 */
  inputs: string[];
  /** 有输出连接：可以放在值输入里。 */
  output: boolean;
  /** 有前驱/后继连接：可以作为语句串起来。 */
  statement: boolean;
}

export interface PrimitiveIndex {
  /** 精确查找：`${call}/${实参个数}`。 */
  lookup: (call: string, arity: number) => PrimitiveCall | null;
  /** 认识这个名字时，它有哪些已知的参数个数（用于「名字对、个数不对」的诊断）。 */
  arities: (call: string) => number[];
  /** 因为撞名被丢弃的条目，供门禁断言「没有歧义」。 */
  ambiguous: string[];
  /** 进索引的块数，供门禁与调试输出。 */
  size: number;
}

const CALL_HEAD = /^([A-Za-z_]\w*)\(/;
const VALUE_SLOT = /^zzsigv_([A-Za-z0-9_]+)$/;
const STATEMENT_SLOT = /^zzsigs_/;
const FIELD_SLOT = /^zzfield_/;
const KEYWORD_LITERAL = /^[A-Za-z_]\w*\s*=\s*[^,]+$/;

/** 按括号/引号深度切参数：模板里可能嵌着 `decodeHexBytes(x)` 这类调用。 */
export function splitCallArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((part) => part.trim());
}

/**
 * 模板 → 调用签名。返回 null 表示这个块的代码形态不适合「按调用还原」：
 * 多行、参数里嵌了别的调用、槽位是语句/字段、或带非默认取值的表达式。
 */
function readCallShape(
  block: BlockFieldTemplate,
): { call: string; inputs: string[] } | null {
  const template = block.template?.trim() ?? '';
  // 多行模板是「一条语句展开成几行」，单个调用表达式对不上它的边界。
  if (!template || template.includes('\n')) return null;
  const head = CALL_HEAD.exec(template);
  if (!head || !template.endsWith(')')) return null;

  // 开括号必须与末尾的闭括号配对，`f(a) + g(b)` 这种就不是单个调用。
  let depth = 0;
  let closeAt = -1;
  for (let index = head[0].length - 1; index < template.length; index += 1) {
    const ch = template[index];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        closeAt = index;
        break;
      }
    }
  }
  if (closeAt !== template.length - 1) return null;

  const inputs: string[] = [];
  for (const arg of splitCallArguments(template.slice(head[0].length, -1))) {
    const slot = VALUE_SLOT.exec(arg);
    if (slot) {
      // 同一个输入槽出现两次时，位置对应关系不再唯一。
      if (inputs.includes(slot[1])) return null;
      inputs.push(slot[1]);
      continue;
    }
    if (STATEMENT_SLOT.test(arg) || FIELD_SLOT.test(arg)) return null;
    // 字面量关键字参数（`rate_bytes=136`）：调用方省略即取块默认字段，不需要额外处理；
    // 但值里若还是槽位，就说明它是个需要回填的字段，v1 不认。
    if (KEYWORD_LITERAL.test(arg) && !arg.includes('zzsigv_') && !arg.includes('zzfield_')) continue;
    return null;
  }
  if (!inputs.length) return null;
  return { call: head[1], inputs };
}

function usableIo(block: BlockFieldTemplate): { output: boolean; statement: boolean } | null {
  // 老载荷没有 io：宁可整条索引不可用，也不猜连接能力，猜错会让 workspaces.load 失败。
  if (!block.io) return null;
  const output = block.io.output;
  const statement = block.io.previous || block.io.next;
  if (!output && !statement) return null;
  return { output, statement };
}

/** 载荷 → 原语调用索引。纯函数，可单测；同一份载荷每次构建结果相同。 */
export function buildPrimitiveIndex(payload: FieldPayload): PrimitiveIndex {
  const byArity = new Map<string, PrimitiveCall>();
  const arrays = new Map<string, number[]>();
  const ambiguous = new Set<string>();

  for (const block of payload.blocks ?? []) {
    const shape = readCallShape(block);
    if (!shape) continue;
    const io = usableIo(block);
    if (!io) continue;
    const key = `${shape.call}/${shape.inputs.length}`;
    const call: PrimitiveCall = {
      type: block.type,
      call: shape.call,
      inputs: shape.inputs,
      output: io.output,
      statement: io.statement,
    };
    const earlier = byArity.get(key);
    if (earlier && (earlier.type !== call.type || earlier.inputs.join(',') !== call.inputs.join(','))) {
      // 撞名：把已经进去的那条一起撤掉，避免「先到先得」引入随机性。
      ambiguous.add(key);
      byArity.delete(key);
      continue;
    }
    if (ambiguous.has(key)) continue;
    byArity.set(key, call);
    const list = arrays.get(shape.call) ?? [];
    if (!list.includes(shape.inputs.length)) list.push(shape.inputs.length);
    arrays.set(shape.call, list);
  }

  return {
    lookup: (call, arity) => byArity.get(`${call}/${arity}`) ?? null,
    arities: (call) => arrays.get(call) ?? [],
    ambiguous: [...ambiguous].sort(),
    size: byArity.size,
  };
}
