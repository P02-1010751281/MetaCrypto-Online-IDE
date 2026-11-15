/**
 * 工作区类型自洽检查器（用户侧 AI Helper · 类型检查器）
 *
 * 单一真值：docs/blocks/BLOCK-IO-CONTRACT.json（由 block-io:write 生成、contract:check 校验）。
 * 本脚本不重新解析块定义，只读契约 + 现有 setCheck 标签。
 *
 * 三值判定：ok（可证相容）/ mismatch（可证不符）/ unknown（有一侧没声明）。
 * unknown 必须单列并报比率——「对一切返回 unknown」的检查器也是零误报。
 *
 * 子命令：probe（Blockly 是否拦非法连线）/ check（离线读 demo JSON，输出是回归基线不得变化）/
 * check-loaded（装进 jsdom 活工作区后跑同一套配对逻辑）/ mutate（契约变异，期望被检出）/ params。
 * check 与 check-loaded 的差别只在类型事实来源：加载后 Blockly 按过程形参补齐变量名并按变量 id
 * 绑定形参声明；id 在离线 JSON 里就有，所以 check-loaded 报告里另列 offlineIdScoped 一列做对照。
 *
 * 复跑：AIVERIFY_ENTRY=scripts/ai-helper-typecheck.ts AIVERIFY_OUTDIR=dist-verify/track-loaded
 *   npx vite build --config vite.verify.config.ts && node dist-verify/track-loaded/ai-helper-typecheck.js check|-loaded
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { compatibility, inputCheck, loadContract, outputCheck } from './ai-helper-contract';
import type { Contract } from './ai-helper-contract';
import { loadLiveTrees, probeConnections } from './ai-helper-workspace-boot';
import { literalShapeType } from '@/services/ai-helper/literal-shape';

interface RawBlock {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: RawBlock }>;
  next?: { block?: RawBlock };
  extraState?: { params?: Array<{ name?: string; id?: string; type?: string }>; hasStatements?: boolean };
}

interface WorkspaceJson {
  blocks: { blocks: RawBlock[] };
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

/** unknown 成因，每条只落一档：无 check 的字面量 / 无来源的 variables_get / 词表未映射 / 过程返回未知 / 其它。 */
const UNKNOWN_CAUSES = [
  'literal_no_check', 'unassigned_variables_get', 'vocab_unmapped', 'unknown_procedure_return', 'other',
] as const;

type UnknownCause = (typeof UNKNOWN_CAUSES)[number];

/** 单条 unknown 的取证记录：报出位置、成因与两侧类型。 */
interface UnknownSample {
  cause: UnknownCause;
  file?: string;
  parent: string;
  input: string;
  child: string;
  expected: string[];
  actual: string[];
}

interface Audit {
  pairs: number; ok: number; mismatch: number; unknown: number;
  unknownByChild: Record<string, number>;
  unknownByCause: Record<UnknownCause, number>;
  unknownSamples: UnknownSample[];
  findings: string[]; variableConflicts: string[];
  inferredVariables: number; returnTypesInferred: number; paramUnmapped: number; callArgChecks: number;
  /** 靠形参声明（活工作区变量名 / 变量 id 绑定）救回的 variables_get 判定义数 */
  varByParamName: number;
}

const emptyAudit = (): Audit => ({
  pairs: 0, ok: 0, mismatch: 0, unknown: 0, unknownByChild: {},
  unknownByCause: Object.fromEntries(UNKNOWN_CAUSES.map((cause) => [cause, 0])) as Record<UnknownCause, number>,
  unknownSamples: [], findings: [], variableConflicts: [], inferredVariables: 0, returnTypesInferred: 0,
  paramUnmapped: 0, callArgChecks: 0, varByParamName: 0,
});

/** 每条成因最多留几个样本。 */
const SAMPLES_PER_CAUSE = 3;

function collectBlocks(roots: RawBlock[]): RawBlock[] {
  const all: RawBlock[] = [];
  const visit = (block: RawBlock | undefined): void => {
    if (!block) return;
    all.push(block);
    for (const value of Object.values(block.inputs ?? {})) visit(value.block);
    visit(block.next?.block);
  };
  roots.forEach(visit);
  return all;
}

function normalizeParamType(paramType: string | undefined): string | null {
  const key = (paramType ?? '').trim();
  if (!key) return null;
  const mapped = PARAM_TYPE_MAP[key];
  return mapped === undefined ? `UNKNOWN_VOCAB:${key}` : mapped;
}

/** 一个过程体内可见的形参声明：变量 id → setCheck 标签。
 *  必须按 id 且限定在所属过程内——同一变量 id 在不同过程可声明不同类型（PQC-Gaps 的 a 即如此），
 *  按名字全局匹配会把这类声明混成一个类型，制造假 mismatch。 */
type ParamScope = Map<string, string>;

const NO_SCOPE: ParamScope = new Map();

function paramScope(defBlock: RawBlock): ParamScope {
  const labels: ParamScope = new Map();
  for (const param of defBlock.extraState?.params ?? []) {
    const mapped = normalizeParamType(param.type);
    if (param.id && mapped && !mapped.startsWith('UNKNOWN_VOCAB')) labels.set(param.id, mapped);
  }
  return labels;
}

/** variables_get 的两个可查事实：按 id 的赋值推断、形参声明（所属过程内按 id，离线兼容按名）。 */
function variablesGetFacts(
  block: RawBlock,
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

/** 定 unknown 成因：只看确定事实（子块类型、契约 check、变量名是否命中形参）。 */
function classifyUnknown(
  child: RawBlock,
  contract: Contract,
  rawById: Map<string, string>,
  rawByName: Map<string, string>,
): UnknownCause {
  if (child.type === 'variables_get') {
    const field = child.fields?.VAR as { id?: string; name?: string } | undefined;
    // 形参声明对上了却没救回，只可能是词表未映射（poly/seed/key/message）
    if ((field?.id && rawById.has(field.id)) || rawByName.has(String(field?.name ?? ''))) return 'vocab_unmapped';
    return 'unassigned_variables_get';
  }
  if (child.type === 'procedures_callreturn') return 'unknown_procedure_return';
  if (outputCheck(contract, child.type) === null) return 'literal_no_check';
  return 'other';
}

/** 推导一个块的输出类型；变量与过程调用需要上下文，未命中就走契约。 */
function resolveOutputType(
  block: RawBlock,
  contract: Contract,
  variableTypes: Map<string, string[]>,
  procedureReturns: Map<string, string[] | null>,
  scope: ParamScope = NO_SCOPE,
  nameLabels?: Map<string, string>,
): string[] | null {
  if (block.type === 'variables_get') {
    const id = (block.fields?.VAR as { id?: string } | undefined)?.id ?? '';
    const inferred = variableTypes.get(id);
    // 一次赋值的类型可能是一个标签集合（如数组字面量 → IntList|Bytes），
    // 推断时按 '|' 存成一个条目；这里必须还原成标签数组，否则与父槽取交集会失败。
    if (inferred && inferred.length === 1) return inferred[0].split('|');
    // 变量就是所属过程的形参时用形参声明的类型；绑 id 这条离线 JSON 里也有，旧判据只按变量名匹配。
    const name = String((block.fields?.VAR as { name?: string } | undefined)?.name ?? '');
    const declared = scope.get(id) ?? nameLabels?.get(name) ?? null;
    return declared ? [declared] : null;
  }
  if (block.type === 'procedures_callreturn') {
    const name = String(block.fields?.NAME ?? '');
    return procedureReturns.get(name) ?? null;
  }
  if (block.type === 'math_number') return ['Number'];
  if (block.type === 'data_value') {
    // 形状已知的字面量按「可表示它的类型」判定（与父槽期望取交集）；
    // 嵌套数组与任意表达式不猜，保持 unknown——矩阵由块的 shape 元数据承载。
    return literalShapeType(String((block.fields?.NUM as string | undefined) ?? ''));
  }
  return outputCheck(contract, block.type);
}

function analyze(json: WorkspaceJson, contract: Contract, idScoped = false): Audit {
  const audit = emptyAudit();
  const all = collectBlocks(json.blocks.blocks);

  // 变量类型推断：只看「一次赋值」能定的类型；多次赋值不同类 → 冲突单列。
  const variableTypes = new Map<string, string[]>();
  for (const block of all) {
    if (block.type !== 'variables_set') continue;
    const id = (block.fields?.VAR as { id?: string } | undefined)?.id ?? '';
    const value = block.inputs?.VALUE?.block;
    if (!id || !value) continue;
    const type = resolveOutputType(value, contract, variableTypes, new Map());
    if (!type) continue;
    const list = variableTypes.get(id) ?? [];
    list.push(type.join('|'));
    variableTypes.set(id, list);
  }
  for (const [id, list] of variableTypes) {
    const unique = [...new Set(list)];
    if (unique.length === 1) audit.inferredVariables += 1;
    else audit.variableConflicts.push(`var ${id}: ${unique.join(' / ')}`);
  }

  // 离线兼容：形参名 → 标签（加载前变量字段常常只有 id，这条是原判据的唯一类型来源）
  const nameLabels = new Map<string, string>();
  const rawByName = new Map<string, string>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    for (const param of block.extraState?.params ?? []) {
      const mapped = normalizeParamType(param.type);
      if (param.name && param.type) rawByName.set(param.name, param.type);
      if (param.name && mapped && !mapped.startsWith('UNKNOWN_VOCAB')) nameLabels.set(param.name, mapped);
    }
  }
  // 按 id 的过程内形参作用域：只在 idScoped 时启用，同一变量 id 在不同过程可有不同声明。
  const scopes = new Map<RawBlock, ParamScope>();
  const rawById = new Map<string, string>();
  if (idScoped) {
    const defScopes = new Map<RawBlock, ParamScope>();
    for (const block of all) if (block.type.startsWith('procedures_def')) defScopes.set(block, paramScope(block));
    for (const block of all) {
      for (const param of block.extraState?.params ?? []) if (param.id && param.type) rawById.set(param.id, param.type);
    }
    const assign = (block: RawBlock, scope: ParamScope): void => {
      const own = defScopes.get(block) ?? scope;
      scopes.set(block, own);
      for (const value of Object.values(block.inputs ?? {})) if (value.block) assign(value.block, own);
      if (block.next?.block) assign(block.next.block, own);
    };
    for (const root of json.blocks.blocks) assign(root, NO_SCOPE);
  }

  // 过程：形参类型 + 返回类型（从 RETURN 子块推断，无需声明字段）
  const procedureParams = new Map<string, Array<string | null>>();
  const procedureReturns = new Map<string, string[] | null>();
  for (const block of all) {
    if (!block.type.startsWith('procedures_def')) continue;
    const name = String(block.fields?.NAME ?? '');
    if (!name) continue;
    const params = (block.extraState?.params ?? []).map((param) => normalizeParamType(param.type));
    procedureParams.set(name, params);
    for (const param of params) if (param === null || param.startsWith('UNKNOWN_VOCAB')) audit.paramUnmapped += 1;
    const returnChild = block.inputs?.RETURN?.block;
    if (returnChild) {
      const type = outputCheck(contract, returnChild.type);
      procedureReturns.set(name, type);
      if (type) audit.returnTypesInferred += 1;
    }
  }

  // 配对检查
  for (const block of all) {
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      const child = value.block;
      if (!child) continue;
      const expected = inputCheck(contract, block.type, inputName);
      if (expected === null) continue;
      const scope = scopes.get(block) ?? NO_SCOPE;
      const actual = resolveOutputType(child, contract, variableTypes, procedureReturns, scope, nameLabels);
      audit.pairs += 1;
      const facts = variablesGetFacts(child, variableTypes, scope, nameLabels);
      if (facts && !facts.assigned && facts.declared) audit.varByParamName += 1;
      const verdict = compatibility(expected, actual);
      if (verdict === 'unknown') {
        audit.unknown += 1;
        audit.unknownByChild[child.type] = (audit.unknownByChild[child.type] ?? 0) + 1;
        const cause = classifyUnknown(child, contract, rawById, rawByName);
        audit.unknownByCause[cause] += 1;
        const seen = audit.unknownSamples.filter((item) => item.cause === cause).length;
        if (seen < SAMPLES_PER_CAUSE) {
          audit.unknownSamples.push({ cause, parent: block.type, input: inputName, child: child.type, expected, actual: actual ?? [] });
        }
      }
      else if (verdict === 'ok') audit.ok += 1;
      else {
        audit.mismatch += 1;
        audit.findings.push(`${block.type}[${inputName}] ← ${child.type}: 期望 ${expected.join('|')}，实得 ${(actual ?? []).join('|')}`);
      }
    }
  }

  // 调用点实参检查（现有语料里没有 procedures_call*，保留逻辑供合成用例使用）
  for (const block of all) {
    if (!block.type.startsWith('procedures_call')) continue;
    const name = String(block.fields?.NAME ?? '');
    const params = procedureParams.get(name) ?? [];
    params.forEach((paramType, index) => {
      const child = block.inputs?.[`ARG${index}`]?.block;
      if (!child) return;
      const expected = paramType && !paramType.startsWith('UNKNOWN_VOCAB') ? [paramType] : null;
      const actual = resolveOutputType(child, contract, variableTypes, procedureReturns,
        NO_SCOPE, nameLabels);
      audit.callArgChecks += 1;
      const verdict = compatibility(expected, actual);
      if (verdict === 'mismatch') {
        audit.mismatch += 1;
        audit.findings.push(`${name}.ARG${index} ← ${child.type}: 期望 ${(expected ?? []).join('|')}，实得 ${(actual ?? []).join('|')}`);
      }
    });
  }
  return audit;
}

function listDemos(): string[] {
  const root = resolve(process.cwd(), 'demos');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json') && name !== 'tests.json' && name !== 'evidence.json') files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

function loadDemo(file: string): WorkspaceJson {
  return JSON.parse(readFileSync(file, 'utf-8')) as WorkspaceJson;
}

/** 契约自动变异：把某个值输入的子块换成类型不相容的来源，期望被检出。 */
function mutateOne(json: WorkspaceJson, contract: Contract): { fired: number; total: number } {
  let fired = 0;
  let total = 0;
  const all = collectBlocks(json.blocks.blocks);
  const candidates = Object.keys(contract).filter((type) => {
    const out = outputCheck(contract, type);
    return out !== null;
  });
  for (const block of all) {
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      const child = value.block;
      if (!child) continue;
      const expected = inputCheck(contract, block.type, inputName);
      if (expected === null) continue;
      const replacement = candidates.find((type) => {
        const out = outputCheck(contract, type);
        return out !== null && !out.some((item) => expected.includes(item));
      });
      if (!replacement) continue;
      total += 1;
      const original = child;
      value.block = { type: replacement, fields: {}, inputs: {} };
      const audit = analyze(json, contract);
      value.block = original;
      if (audit.mismatch > 0) fired += 1;
    }
  }
  return { fired, total };
}

async function probe(): Promise<void> {
  for (const result of await probeConnections()) {
    console.log(`PROBE ${result.name}: load_ok=${result.ok} error=${result.error ?? '-'}`);
  }
}

/** 一个 demo 的入口：文件名 + 待检查的树（离线读 JSON / 加载后读活工作区）。 */
type Entry = { file: string; json: WorkspaceJson };

/** 可直接相加的数值字段；unknownByChild / 成因 / 样本另按类型合并。 */
const SUM_KEYS = ['pairs', 'ok', 'mismatch', 'unknown', 'inferredVariables', 'returnTypesInferred',
  'paramUnmapped', 'callArgChecks', 'varByParamName'] as const;

/** 逐 demo 审计后汇总（check 与 check-loaded 共用）。 */
function summarize(entries: Entry[], contract: Contract, idScoped = false): Audit {
  const total = emptyAudit();
  for (const entry of entries) {
    const audit = analyze(entry.json, contract, idScoped);
    const where = relative(process.cwd(), entry.file);
    for (const key of SUM_KEYS) total[key] += audit[key];
    total.variableConflicts.push(...audit.variableConflicts);
    for (const [childType, count] of Object.entries(audit.unknownByChild)) {
      total.unknownByChild[childType] = (total.unknownByChild[childType] ?? 0) + count;
    }
    for (const cause of UNKNOWN_CAUSES) total.unknownByCause[cause] += audit.unknownByCause[cause];
    for (const sample of audit.unknownSamples) {
      const seen = total.unknownSamples.filter((item) => item.cause === sample.cause).length;
      if (seen < SAMPLES_PER_CAUSE) total.unknownSamples.push({ ...sample, file: where });
    }
    for (const finding of audit.findings.slice(0, 8)) total.findings.push(`${where}: ${finding}`);
  }
  return total;
}

/** 汇总行与 JSON 用的扁平数字，字段名与 TYPECHECK 行保持一致。 */
function brief(demos: number, audit: Audit): Record<string, number> {
  const rate = audit.pairs ? Number(((audit.unknown / audit.pairs) * 100).toFixed(1)) : 0;
  return { demos, pairs: audit.pairs, ok: audit.ok, mismatch: audit.mismatch, unknown: audit.unknown, unknown_rate: rate,
    var_inferred: audit.inferredVariables, var_conflicts: audit.variableConflicts.length,
    returns_inferred: audit.returnTypesInferred, param_unmapped: audit.paramUnmapped, call_args: audit.callArgChecks,
    var_by_param_name: audit.varByParamName };
}

/** 变量字段里「加载后才带名字」的比例：加载路线唯一多出来的类型事实来源。 */
function countVarFields(entries: Entry[]): { total: number; named: number } {
  const counts = { total: 0, named: 0 };
  const visit = (block: RawBlock): void => {
    const field = block.fields?.VAR as { name?: string } | undefined;
    if (field) { counts.total += 1; if (field.name) counts.named += 1; }
    for (const value of Object.values(block.inputs ?? {})) if (value.block) visit(value.block);
    if (block.next?.block) visit(block.next.block);
  };
  for (const entry of entries) for (const block of entry.json.blocks.blocks) visit(block);
  return counts;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'check';
  const targets = process.argv.slice(3);
  const contract = loadContract();

  if (mode === 'probe') {
    await probe();
    return;
  }

  const files = targets.length ? targets.map((file) => resolve(process.cwd(), file)) : listDemos();

  if (mode === 'mutate') {
    let fired = 0;
    let total = 0;
    for (const file of files) {
      const result = mutateOne(loadDemo(file), contract);
      fired += result.fired;
      total += result.total;
    }
    const rate = total ? ((fired / total) * 100).toFixed(1) : '0';
    console.log(`MUTATE_SUMMARY sites=${total} fired=${fired} detection_rate=${rate}%`);
    return;
  }

  if (mode === 'params') {
    const distribution: Record<string, number> = {};
    let defs = 0;
    let calls = 0;
    for (const file of files) {
      for (const block of collectBlocks(loadDemo(file).blocks.blocks)) {
        if (block.type.startsWith('procedures_def')) {
          defs += 1;
          for (const param of block.extraState?.params ?? []) {
            const key = param.type ?? '(空)';
            distribution[key] = (distribution[key] ?? 0) + 1;
          }
        }
        if (block.type.startsWith('procedures_call')) calls += 1;
      }
    }
    console.log(`PARAM_SUMMARY defs=${defs} calls=${calls} types=${JSON.stringify(distribution)}`);
    const unmapped = Object.keys(distribution).filter((key) => PARAM_TYPE_MAP[key] === null || PARAM_TYPE_MAP[key] === undefined);
    console.log(`PARAM_UNMAPPED ${unmapped.join(',') || '-'}`);
    return;
  }

  const entries: Entry[] = mode === 'check-loaded'
    ? [...(await loadLiveTrees(files, loadDemo))].map(([file, tree]) => ({
        file, json: { blocks: { blocks: tree as unknown as RawBlock[] } },
      }))
    : files.map((file) => ({ file, json: loadDemo(file) }));

  const total = summarize(entries, contract, mode === 'check-loaded');
  const rate = total.pairs ? ((total.unknown / total.pairs) * 100).toFixed(1) : '0';
  const prefix = mode === 'check-loaded' ? 'TYPECHECK_LOADED' : 'TYPECHECK';
  console.log(
    `${prefix} demos=${entries.length} pairs=${total.pairs} ok=${total.ok} mismatch=${total.mismatch} unknown=${total.unknown} ` +
      `unknown_rate=${rate}% var_inferred=${total.inferredVariables} var_conflicts=${total.variableConflicts.length} ` +
      `returns_inferred=${total.returnTypesInferred} param_unmapped=${total.paramUnmapped} call_args=${total.callArgChecks}`,
  );
  const topUnknown = Object.entries(total.unknownByChild).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`${prefix}_UNKNOWN_TOP ${topUnknown.map(([type, count]) => `${type}:${count}`).join(' ')}`);
  if (mode !== 'check-loaded') {
    for (const finding of total.findings.slice(0, 8)) console.log(`    ${finding}`);
    return;
  }
  console.log(`${prefix}_CAUSES ${UNKNOWN_CAUSES.map((cause) => `${cause}=${total.unknownByCause[cause]}`).join(' ')}`);
  for (const sample of total.unknownSamples) console.log(`    [${sample.cause}] ${sample.file ?? '-'}: ` +
    `${sample.parent}[${sample.input}] ← ${sample.child} 期望 ${sample.expected.join('|')} 实得 ${sample.actual.join('|') || '-'}`);
  // 对照列：同一份 JSON 只按变量 id 绑定形参（不加载）能拿到什么，用来判断加载是否必要。
  const raw = files.map((file) => ({ file, json: loadDemo(file) }));
  const [offline, idScoped, rawFields] = [summarize(raw, contract), summarize(raw, contract, true), countVarFields(raw)];
  console.log(`${prefix}_RESCUED var_by_param_name=${total.varByParamName} var_fields_named ` +
    `offline=${rawFields.named}/${rawFields.total} loaded=${countVarFields(entries).named}/${countVarFields(entries).total}`);
  const outFile = resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out/track-loaded.json');
  writeFileSync(outFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    command: 'node dist-verify/track-loaded/ai-helper-typecheck.js check-loaded',
    offline: brief(files.length, offline), loaded: brief(entries.length, total), offlineIdScoped: brief(files.length, idScoped),
    loadedCauses: total.unknownByCause, samples: total.unknownSamples, findings: total.findings,
  }, null, 2)}\n`);
  console.log(`${prefix}_REPORT ${relative(process.cwd(), outFile)}`);
}

void main();
