/**
 * 工作区类型门禁（用户侧 AI Helper · B 线闭环）
 *
 * 把已在 60 demo 上验证过的类型检查器做成产品可调用的一道门：给一份工作区 JSON，
 * 返回结构化判定与退出码。纯 JSON 静态分析——不加载 Blockly。直接插错类型的
 * 工作区在 `Blockly.serialization.workspaces.load` 会整批抛 `Connection checks failed`，
 * 所以门禁不能依赖加载，只能读 JSON + 读契约。
 *
 * 单一真值：docs/blocks/BLOCK-IO-CONTRACT.json（`npm run block-io:write` 生成、
 * `contract:check` 校验漂移）。判定三值：ok / mismatch / unknown；unknown 单列并报比率，
 * 「对一切返回 unknown」的检查器也是零误报，不能算通过。
 *
 * 用法（构建见 task 说明，需在仓库根目录运行，契约与 demo 路径都按 cwd 解析）：
 *   node dist-verify/track-validate/ai-helper-validate.js validate <workspace.json> [--json] [--max-report N]
 *   node dist-verify/track-validate/ai-helper-validate.js validate demos/AES-Atomic-Round.json
 *
 * 退出码（真实语义，不用 0 兜底异常）：
 *   0 = 全部文件 mismatch 0
 *   1 = 至少一个 mismatch
 *   2 = 文件不存在 / JSON 解析失败 / 参数错误（无法判定）
 *
 * 反向门禁：roundtrip 的 `reverse --gate` 调用本模块导出的 gateParsedEquivalents，
 * 对反解析结果 W'（表达式树形态）跑同一套配对判定。
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { compatibility, inputCheck, loadContract, outputCheck } from './ai-helper-contract';
import { literalShapeType } from '@/services/ai-helper/literal-shape';
import { auditShape, parseShape } from '@/constants/grid-shape';
import type { Contract } from './ai-helper-contract';

export interface RawBlock {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: RawBlock }>;
  next?: { block?: RawBlock };
  extraState?: { params?: Array<{ name?: string; id?: string; type?: string }> };
}

export interface WorkspaceJson {
  blocks: { blocks: RawBlock[] };
}

/** 反解析结果 W' 的表达式树（ai-helper-reverse 的 ParsedNode 结构上兼容）。 */
export interface ParsedNodeLike {
  type: string;
  fields: Record<string, string>;
  children: Array<{ input: string; node: ParsedNodeLike }>;
}

export interface Finding {
  path: string;
  parent: string;
  input: string;
  child: string;
  expected: string[];
  actual: string[];
}

export interface CheckReport {
  blocks: number;
  pairs: number;
  ok: number;
  mismatch: number;
  unknown: number;
  unknownRate: number;
  findings: Finding[];
  unknownByChild: Record<string, number>;
  variableConflicts: string[];
  /** `data_int_list` 的形状自洽问题（prod(shape) ≠ 单元格数等）；与类型 mismatch 分列。 */
  shapeErrors: string[];
}

export interface FileReport extends CheckReport {
  file: string;
}

/** 过程参数类型词表（CRYPTO_PARAM_TYPES）↔ setCheck 标签；poly/seed/key/message 无对应项，只能记 unknown。 */
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

type ParamScope = Map<string, string>;

const NO_SCOPE: ParamScope = new Map();

function normalizeParamType(paramType: string | undefined): string | null {
  const key = (paramType ?? '').trim();
  if (!key) return null;
  const mapped = PARAM_TYPE_MAP[key];
  return mapped === undefined ? `UNKNOWN_VOCAB:${key}` : mapped;
}

/** 变量字段的两种形态：工作区 JSON 是 {id,name}，反解析 W' 是名字字符串。 */
function varField(block: RawBlock): { key: string; name: string } {
  const field = block.fields?.VAR;
  if (field && typeof field === 'object') {
    const record = field as { id?: string; name?: string };
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    return { key: id || name, name };
  }
  const name = typeof field === 'string' ? field : '';
  return { key: name, name };
}

/** 过程名：契约外的块（procedures_def*）只出现在工作区 JSON 里。 */
function procedureName(block: RawBlock): string {
  const name = block.fields?.NAME;
  return typeof name === 'string' ? name : '';
}

interface LocatedBlock {
  block: RawBlock;
  path: string;
}

/** 全部块（含语句链），带可比对的路径；顺序与 typecheck 的 collectBlocks 一致（先子后 next）。 */
function collectBlocks(roots: RawBlock[]): LocatedBlock[] {
  const all: LocatedBlock[] = [];
  const visit = (block: RawBlock, path: string): void => {
    all.push({ block, path });
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      if (value?.block) visit(value.block, `${path}.${block.type}[${inputName}]`);
    }
    if (block.next?.block) visit(block.next.block, `${path}/next`);
  };
  roots.forEach((root, index) => visit(root, `#${index}`));
  return all;
}

/** 一个过程体内可见的形参声明：变量 id → setCheck 标签（限定在所属过程内）。 */
function paramScope(defBlock: RawBlock): ParamScope {
  const labels: ParamScope = new Map();
  for (const param of defBlock.extraState?.params ?? []) {
    const mapped = normalizeParamType(param.type);
    if (param.id && mapped && !mapped.startsWith('UNKNOWN_VOCAB')) labels.set(param.id, mapped);
  }
  return labels;
}

/** 推导输出类型；变量与过程调用需要上下文（变量赋值推断 / 形参声明 / 过程返回），未命中走契约。 */
function resolveOutputType(
  block: RawBlock,
  contract: Contract,
  variableTypes: Map<string, string[]>,
  procedureReturns: Map<string, string[] | null>,
  scope: ParamScope = NO_SCOPE,
  nameLabels?: Map<string, string>,
): string[] | null {
  if (block.type === 'variables_get') {
    const field = varField(block);
    const inferred = variableTypes.get(field.key);
    // 一次赋值的类型可能是一个标签集合（如数组字面量 → IntList|Bytes），
    // 推断时按 '|' 存成一个条目；这里必须还原成标签数组，否则与父槽取交集会失败。
    if (inferred && inferred.length === 1) return inferred[0].split('|');
    const declared = scope.get(field.key) ?? nameLabels?.get(field.name) ?? null;
    return declared ? [declared] : null;
  }
  if (block.type === 'procedures_callreturn') {
    return procedureReturns.get(procedureName(block)) ?? null;
  }
  if (block.type === 'math_number') return ['Number'];
  if (block.type === 'data_value') {
    // 与 typecheck 共用同一份形状规则：形状已知的字面量按「可表示它的类型」判定，
    // 嵌套数组与任意表达式保持 unknown。
    return literalShapeType(String((block.fields?.NUM as string | undefined) ?? ''));
  }
  return outputCheck(contract, block.type);
}

function emptyReport(): CheckReport {
  return { blocks: 0, pairs: 0, ok: 0, mismatch: 0, unknown: 0, unknownRate: 0, findings: [], unknownByChild: {}, variableConflicts: [], shapeErrors: [] };
}

/**
 * 整棵树的配对判定。所有块先扁平化，再取全部「有声明 check 的值输入」配对：
 * 每一对儿都给 ok / mismatch / unknown 之一，unknown 不并进通过。
 */
export function analyze(roots: RawBlock[], contract: Contract): CheckReport {
  const report = emptyReport();
  const located = collectBlocks(roots);
  report.blocks = located.length;
  const all = located.map((item) => item.block);

  // 形状自洽（R5）：data_int_list 用 extraState 声明 shape 与扁平单元格，
  // 二者必须满足 prod(shape) == 单元格数；这是 3×3×3 只填 26 个值唯一能被抓到的地方。
  for (const { block, path } of located) {
    if (block.type !== 'data_int_list') continue;
    const state = (block.extraState ?? {}) as { shape?: unknown; data?: unknown };
    const shapeText = typeof state.shape === 'string' ? state.shape : '';
    const data = typeof state.data === 'string' ? state.data : '';
    const cells = data ? data.split(',') : [];
    const dims = parseShape(shapeText);
    const audit = dims
      ? auditShape(dims, cells)
      : { ok: false, reason: `形状非法：${shapeText || '(空)'}` };
    if (!audit.ok) report.shapeErrors.push(`${path}: ${audit.reason}`);
  }

  // 变量类型推断：只看「一次赋值」能定的类型；多次赋值不同类 → 冲突单列。
  const variableTypes = new Map<string, string[]>();
  for (const block of all) {
    if (block.type !== 'variables_set') continue;
    const key = varField(block).key;
    const value = block.inputs?.VALUE?.block;
    if (!key || !value) continue;
    const type = resolveOutputType(value, contract, variableTypes, new Map());
    if (!type) continue;
    const list = variableTypes.get(key) ?? [];
    list.push(type.join('|'));
    variableTypes.set(key, list);
  }
  for (const [key, list] of variableTypes) {
    const unique = [...new Set(list)];
    if (unique.length > 1) report.variableConflicts.push(`var ${key}: ${unique.join(' / ')}`);
  }

  // 形参声明：全局按变量名（离线 JSON 常见只有 name），过程内按变量 id（同 id 跨过程可不同）。
  const nameLabels = new Map<string, string>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    for (const param of block.extraState?.params ?? []) {
      const mapped = normalizeParamType(param.type);
      if (param.name && mapped && !mapped.startsWith('UNKNOWN_VOCAB')) nameLabels.set(param.name, mapped);
    }
  }
  const defScopes = new Map<RawBlock, ParamScope>();
  for (const block of all) if (block.type.startsWith('procedures_def')) defScopes.set(block, paramScope(block));
  const scopes = new Map<RawBlock, ParamScope>();
  const assign = (block: RawBlock, scope: ParamScope): void => {
    const own = defScopes.get(block) ?? scope;
    scopes.set(block, own);
    for (const value of Object.values(block.inputs ?? {})) if (value.block) assign(value.block, own);
    if (block.next?.block) assign(block.next.block, own);
  };
  for (const root of roots) assign(root, NO_SCOPE);

  // 过程返回类型：从 RETURN 子块推断（RETURN 是普通值输入，这里不跳过它）。
  const procedureReturns = new Map<string, string[] | null>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    const name = procedureName(block);
    if (!name) continue;
    const returnChild = block.inputs?.RETURN?.block;
    if (returnChild) procedureReturns.set(name, outputCheck(contract, returnChild.type));
  }

  for (const { block, path } of located) {
    const scope = scopes.get(block) ?? NO_SCOPE;
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      const child = value.block;
      if (!child) continue;
      const expected = inputCheck(contract, block.type, inputName);
      if (expected === null) continue;
      const actual = resolveOutputType(child, contract, variableTypes, procedureReturns, scope, nameLabels);
      report.pairs += 1;
      const verdict = compatibility(expected, actual);
      if (verdict === 'ok') report.ok += 1;
      else if (verdict === 'unknown') {
        report.unknown += 1;
        report.unknownByChild[child.type] = (report.unknownByChild[child.type] ?? 0) + 1;
      } else {
        report.mismatch += 1;
        report.findings.push({
          path: `${path}.${block.type}[${inputName}]`,
          parent: block.type,
          input: inputName,
          child: child.type,
          expected,
          actual: actual ?? [],
        });
      }
    }
  }

  // 调用点实参检查（语料里目前没有 procedures_call*，保留以覆盖 product 门禁的完整语义）。
  const procedureParams = new Map<string, Array<string | null>>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    const name = procedureName(block);
    if (!name) continue;
    procedureParams.set(name, (block.extraState?.params ?? []).map((param) => normalizeParamType(param.type)));
  }
  for (const { block, path } of located) {
    if (!block.type.startsWith('procedures_call')) continue;
    const params = procedureParams.get(procedureName(block)) ?? [];
    params.forEach((paramType, index) => {
      const child = block.inputs?.[`ARG${index}`]?.block;
      if (!child) return;
      const expected = paramType && !paramType.startsWith('UNKNOWN_VOCAB') ? [paramType] : null;
      const actual = resolveOutputType(child, contract, variableTypes, procedureReturns, NO_SCOPE, nameLabels);
      if (compatibility(expected, actual) !== 'mismatch') return;
      report.mismatch += 1;
      report.findings.push({
        path: `${path}.${block.type}[ARG${index}]`,
        parent: block.type,
        input: `ARG${index}`,
        child: child.type,
        expected: expected ?? [],
        actual: actual ?? [],
      });
    });
  }

  const judged = report.ok + report.mismatch + report.unknown;
  report.unknownRate = judged ? Number(((report.unknown / judged) * 100).toFixed(1)) : 0;
  return report;
}

/** 反解析结果 W'（表达式树）→ 工作区块树，交给同一个 analyze。 */
export function parsedToBlocks(nodes: ParsedNodeLike[]): RawBlock[] {
  const convert = (node: ParsedNodeLike): RawBlock => {
    const inputs: Record<string, { block?: RawBlock }> = {};
    for (const child of node.children) inputs[child.input] = { block: convert(child.node) };
    return { type: node.type, fields: { ...node.fields }, inputs };
  };
  return nodes.map(convert);
}

export function checkParsed(nodes: ParsedNodeLike[], contract: Contract = loadContract()): CheckReport {
  return analyze(parsedToBlocks(nodes), contract);
}

/**
 * 反向门禁：对 W' 跑同一判定。返回 true 表示 mismatch>0（门禁失败）。
 * 差异逐条打印（槽位 + 期望 + 实得），unknown 单列但不算失败——它没有可证的错。
 */
export function gateParsedEquivalents(label: string, nodes: ParsedNodeLike[], contract: Contract = loadContract()): boolean {
  const report = checkParsed(nodes, contract);
  const fail = report.mismatch > 0;
  console.log(
    `GATE ${label} blocks=${report.blocks} pairs=${report.pairs} ok=${report.ok} mismatch=${report.mismatch} ` +
      `unknown=${report.unknown} unknown_rate=${report.unknownRate}% ${fail ? 'FAIL' : 'PASS'}`,
  );
  for (const finding of report.findings.slice(0, 10)) {
    console.log(`    MISMATCH ${finding.path} parent=${finding.parent} input=${finding.input} ` +
      `expected=${finding.expected.join('|')} actual=${finding.actual.join('|')} child=${finding.child}`);
  }
  return fail;
}

/** 读工作区 JSON：文件不存在或不是合法 JSON 都不能当成「通过」。 */
function loadWorkspace(file: string): { json?: WorkspaceJson; error?: string } {
  const full = resolve(process.cwd(), file);
  if (!existsSync(full)) return { error: `文件不存在: ${file}` };
  let text: string;
  try {
    text = readFileSync(full, 'utf-8');
  } catch (error) {
    return { error: `读取失败: ${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const json = JSON.parse(text) as WorkspaceJson;
    if (!json || typeof json !== 'object' || !json.blocks || !Array.isArray(json.blocks.blocks)) {
      return { error: `不是 Blockly 工作区 JSON（缺 blocks.blocks）: ${file}` };
    }
    return { json };
  } catch (error) {
    return { error: `JSON 解析失败: ${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const USAGE = [
  '用法: node dist-verify/track-validate/ai-helper-validate.js validate <workspace.json...> [--json] [--max-report N]',
  '退出码: 0=无 mismatch / 1=有 mismatch / 2=文件缺失或解析失败或参数错误',
].join('\n');

interface Cli {
  files: string[];
  json: boolean;
  maxReport: number;
}

function parseArgs(argv: string[]): Cli | null {
  const args = argv[0] === 'validate' ? argv.slice(1) : argv;
  const cli: Cli = { files: [], json: false, maxReport: 20 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') cli.json = true;
    else if (arg === '--max-report') {
      const raw = args[index + 1];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) return null;
      cli.maxReport = value;
      index += 1;
    } else if (arg.startsWith('--')) return null;
    else cli.files.push(arg);
  }
  return cli.files.length ? cli : null;
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli) {
    console.error(USAGE);
    process.exit(2);
  }
  let contract: Contract;
  try {
    contract = loadContract();
  } catch (error) {
    // 契约缺失/损坏属于「无法判定」，不是「有 mismatch」。
    console.error(`ERROR 契约读取失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const files: FileReport[] = [];
  const errors: string[] = [];
  const limit = cli.maxReport === 0 ? Number.POSITIVE_INFINITY : cli.maxReport;

  for (const file of cli.files) {
    const loaded = loadWorkspace(file);
    if (!loaded.json) {
      errors.push(loaded.error ?? `无法读取: ${file}`);
      continue;
    }
    try {
      files.push({ file, ...analyze(loaded.json.blocks.blocks, contract) });
    } catch (error) {
      errors.push(`分析异常: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const totals = emptyReport();
  for (const item of files) {
    for (const key of ['blocks', 'pairs', 'ok', 'mismatch', 'unknown'] as const) totals[key] += item[key];
    totals.variableConflicts.push(...item.variableConflicts);
    for (const [type, count] of Object.entries(item.unknownByChild)) totals.unknownByChild[type] = (totals.unknownByChild[type] ?? 0) + count;
  }
  const judged = totals.ok + totals.mismatch + totals.unknown;
  totals.unknownRate = judged ? Number(((totals.unknown / judged) * 100).toFixed(1)) : 0;
  totals.findings = files.flatMap((item) => item.findings);
  const shapeErrors = files.flatMap((item) => item.shapeErrors ?? []);
  const exitCode = errors.length ? 2 : totals.mismatch > 0 || shapeErrors.length > 0 ? 1 : 0;

  if (cli.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      argv: process.argv.slice(2),
      exitCode,
      files: files.map((item) => ({ ...item, findings: item.findings.slice(0, limit) })),
      totals: { ...totals, findings: totals.findings.slice(0, limit) },
      errors,
    }, null, 2));
  } else {
    for (const error of errors) console.error(`ERROR ${error}`);
    for (const item of files) {
      console.log(`VALIDATE ${relative(process.cwd(), resolve(process.cwd(), item.file))} blocks=${item.blocks} ` +
        `pairs=${item.pairs} ok=${item.ok} mismatch=${item.mismatch} unknown=${item.unknown} unknown_rate=${item.unknownRate}%`);
      for (const finding of item.findings.slice(0, limit)) {
        console.log(`    MISMATCH ${finding.path} parent=${finding.parent} input=${finding.input} ` +
          `expected=${finding.expected.join('|') || '-'} actual=${finding.actual.join('|') || '-'} child=${finding.child}`);
      }
      if (item.findings.length > limit) console.log(`    ... 另有 ${item.findings.length - limit} 条 mismatch 未列出（--max-report 0 看全部）`);
    }
    console.log(`VALIDATE_SUMMARY files=${files.length} blocks=${totals.blocks} pairs=${totals.pairs} ok=${totals.ok} ` +
      `mismatch=${totals.mismatch} unknown=${totals.unknown} unknown_rate=${totals.unknownRate}% ` +
      `shape_errors=${shapeErrors.length} errors=${errors.length}`);
    for (const issue of shapeErrors.slice(0, limit)) console.log(`    SHAPE ${issue}`);
    console.log(`VALIDATE_EXIT ${exitCode}`);
  }
  process.exit(exitCode);
}

// 本模块同时被 roundtrip 当库导入（`reverse --gate`），所以只有真的作为 validate 入口时才跑 CLI。
const entryName = (process.argv[1] ?? '').replace(/\\/g, '/');
if (process.argv[2] === 'validate') main();
else if (/ai-helper-validate\.(js|ts)$/.test(entryName)) {
  console.error(USAGE);
  process.exit(2);
}
