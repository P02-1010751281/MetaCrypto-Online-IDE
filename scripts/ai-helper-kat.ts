/**
 * 判据 B（独立判据）：换来源变异 → 生成 Python → 跑官方向量。上一版 mutate 的
 * detection_rate=100% 是自证循环；这里只有「检查器报警 且 官方向量不通过」才算真错。
 * a load_rejected=加载即拒/生成器产不出代码（不计检出）；b true_error=报警且 KAT 失败；
 * c false_positive=报警但 KAT 通过；d missed=未报警；e unconstructible=无来源/无向量。
 * 通道：变量中转（v ← 不兼容块；目标输入 ← variables_get(v)），直插会被 Blockly 硬拦。
 * 检查器只通过子进程调 dist-verify/track-kat/pinned/ai-helper-typecheck.js（bundle 与源
 * 文件 sha256 写进报告）。默认全量 60 个 demo；--demos N 才抽样，且报告写 seed。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { TYPE_BYTES } from '@/constants/block-types';

interface RawBlock {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: RawBlock; shadow?: RawBlock }>;
  next?: { block?: RawBlock };
}
interface WorkspaceJson { blocks: { languageVersion?: number; blocks: RawBlock[] }; variables?: Array<{ name?: string; id?: string }> }
interface ContractEntry { inputs: Array<{ name: string; type: number; check: string[] | null }>; outputCheck: string[] | null }
type Contract = Record<string, ContractEntry>;
interface TestSpec { py: { driver: string; expect: string } }
interface Site { demo: string; path: string[]; parentType: string; inputName: string; expected: string[]; originalChild: string; procedure: string | null }
interface Source { type: string; out: string[]; expr: string; make: () => RawBlock }
type Category = 'a' | 'b' | 'c' | 'd' | 'e';
interface Entry {
  demo: string; parentType: string; inputName: string; expected: string[]; originalChild: string; sourceType: string | null;
  sourceExpr: string | null; category: Category; reason: string; procedure: string | null; checkerMismatch: number | null;
  checkerError: string | null; katStatus: string | null; katReason: string | null; codeExcerpt: string[];
}
/** 一个 demo 的一次遍历结果：变异点 + 分母 + 过程调用图（可达性判定用）。 */
interface DemoFacts { sites: Site[]; withCheck: number; calls: Array<[string, string]>; defined: string[] }
interface BaselineRow { demo: string; status: string; reason: string; checkerMismatch: number | null; checkerError: string | null }
interface ProcResult { status: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: string | null }
interface BlockLike { type: string; outputConnection: { getCheck: () => string[] | null } | null }
interface WorkspaceLike { getAllBlocks: (ordered?: boolean) => BlockLike[]; dispose: () => void }
interface BlocklyApi { Workspace: new () => WorkspaceLike; serialization: { workspaces: { load: (json: unknown, ws: WorkspaceLike) => void } } }
type BlockFn = (block: unknown, generator: unknown) => unknown;
interface PythonGenerator { forBlock: Record<string, BlockFn>; workspaceToCode: (workspace: unknown) => string }

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out');
const OUT_FILE = join(OUT_DIR, 'track-kat.json');
const WORK_DIR = resolve(ROOT, 'dist-verify/track-kat/work');
const MUT_DIR = join(WORK_DIR, 'mut');
const PY_DIR = join(WORK_DIR, 'py');
const CHECKER = resolve(ROOT, 'dist-verify/track-kat/pinned/ai-helper-typecheck.js');
const CHECKER_SOURCE = resolve(ROOT, 'scripts/ai-helper-typecheck.ts');
const CONTRACT_FILE = resolve(ROOT, 'docs/blocks/BLOCK-IO-CONTRACT.json');
const TESTS_FILE = resolve(ROOT, 'demos/tests.json');
const PYTHON = process.env.CIPHER_CAT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const KAT_TIMEOUT_MS = 30_000;
const CHECKER_TIMEOUT_MS = 60_000;

/** 来源块只用两个、且都生成自包含字面量（不引用运行期环境变量，避免把 NameError 噪声当成
 *  类型错误的后果）：math_number → 0（Number）；keccak_state_init → [0] * 25（IntList）。
 *  两者合起来和 demo 里出现的四类期望类型（Bytes/IntList/Number/String）都不相交。 */
const SOURCES: Source[] = [
  { type: 'math_number', out: ['Number'], expr: '0', make: () => ({ type: 'math_number', fields: { NUM: 0 } }) },
  { type: 'keccak_state_init', out: ['IntList'], expr: '[0] * 25', make: () => ({ type: 'keccak_state_init' }) },
];

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
/** external 列表没有 node:crypto，静态 import 会被打包坏；用运行时内置模块取。 */
type HashLike = { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } };
const nodeCrypto = (process as unknown as { getBuiltinModule: (id: string) => { createHash: (algorithm: string) => HashLike } }).getBuiltinModule('node:crypto');
const sha256File = (file: string): string => nodeCrypto.createHash('sha256').update(readFileSync(file)).digest('hex');

/** 值输入（type=1）声明的 check；无声明返回 null。 */
function inputCheck(contract: Contract, blockType: string, inputName: string): string[] | null {
  const entry = contract[blockType];
  if (!entry) return null;
  const input = entry.inputs.find((item) => item.type === 1 && item.name === inputName);
  return input && input.check && input.check.length ? input.check : null;
}

/** 抽样用的固定种子 PRNG（mulberry32），保证可复现。 */
function shuffled<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

function listDemoFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json') && name !== 'tests.json' && name !== 'evidence.json') files.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(resolve(ROOT, 'demos'));
  return files.sort();
}

async function bootBlockly(): Promise<{ Blockly: BlocklyApi; pythonGenerator: PythonGenerator }> {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  globals.document = dom.window.document;
  globals.window = dom.window;
  globals.DOMParser = dom.window.DOMParser;
  globals.XMLSerializer = dom.window.XMLSerializer;
  globals.Node = dom.window.Node;
  globals.Element = dom.window.Element;
  const BlocklyModule = await import('blockly/core');
  const Blockly = (BlocklyModule.default ?? BlocklyModule) as unknown as BlocklyApi;
  const { setLocale } = await import('blockly/core');
  setLocale(await import('blockly/msg/en'));
  await import('blockly/blocks');
  await import('@/blocks');
  await import('@/generators/python');
  const { pythonGenerator } = await import('blockly/python');
  return { Blockly, pythonGenerator: pythonGenerator as unknown as PythonGenerator };
}

/** 与 verify-demo.ts 的 --exec 一致：给产出 Bytes 的块包一层运行期类型断言，避免「声明
 *  Bytes 实际返回 list」被放过。originals 是原实现快照，生成后必须还原，否则补丁逐轮嵌套。 */
function generatePython(
  Blockly: BlocklyApi, generator: PythonGenerator, originals: Map<string, BlockFn>, json: WorkspaceJson,
): { code: string; error: string | null } {
  const workspace = new Blockly.Workspace();
  const patched: string[] = [];
  try {
    Blockly.serialization.workspaces.load(json, workspace);
    const byteTypes = new Set<string>();
    for (const block of workspace.getAllBlocks(false)) {
      if (block.outputConnection?.getCheck()?.includes(TYPE_BYTES)) byteTypes.add(block.type);
    }
    for (const type of byteTypes) {
      const original = originals.get(type);
      if (!original) throw new Error(`Missing code generator for Bytes block ${type}`);
      generator.forBlock[type] = (block: unknown, inner: unknown): unknown => {
        const result = original(block, inner);
        if (!Array.isArray(result)) throw new Error(`Bytes block ${type} did not generate a value expression`);
        return [`_ciphercat_assert_bytes_output(${String(result[0])}, ${JSON.stringify(type)})`, result[1]];
      };
      patched.push(type);
    }
    let code = generator.workspaceToCode(workspace);
    if (byteTypes.size > 0) {
      const helper = 'def _ciphercat_assert_bytes_output(value, block_type):\n    if type(value) is not bytes:\n        raise TypeError(f"{block_type} declares Bytes but returned {type(value).__name__}")\n    return value\n\n';
      code = helper + code;
    }
    return { code, error: null };
  } catch (error) {
    return { code: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    for (const type of patched) {
      const original = originals.get(type);
      if (original) generator.forBlock[type] = original;
    }
    workspace.dispose();
  }
}

/** 一次遍历同时产出：分母（有 check 的值输入数）、可变异点（带结构路径，避开重复块 id）、
 *  以及过程调用图与定义名表，供可达性判定使用。 */
function analyzeDemo(demo: string, json: WorkspaceJson, contract: Contract): DemoFacts {
  const facts: DemoFacts = { sites: [], withCheck: 0, calls: [], defined: [] };
  const visit = (block: RawBlock | undefined, procedure: string | null, path: string[]): void => {
    if (!block) return;
    const scoped = block.type.startsWith('procedures_def') ? String(block.fields?.NAME ?? '') : procedure;
    if (block.type.startsWith('procedures_def') && scoped && !facts.defined.includes(scoped)) facts.defined.push(scoped);
    if (block.type.startsWith('procedures_call')) facts.calls.push([scoped ?? '', String(block.fields?.NAME ?? '')]);
    for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
      const expected = inputCheck(contract, block.type, inputName);
      if (expected) {
        facts.withCheck += 1;
        if (value.block) {
          facts.sites.push({ demo, path, parentType: block.type, inputName, expected, originalChild: value.block.type, procedure: scoped });
        }
      }
      visit(value.block, scoped, [...path, `in:${inputName}`]);
    }
    visit(block.next?.block, scoped, [...path, 'next']);
  };
  json.blocks.blocks.forEach((block, index) => visit(block, null, [String(index)]));
  return facts;
}

/** KAT 可达性判据（静态，非猜测）：driver 中以标识符边界出现的定义名、以及顶层块直接调用
 *  的过程是入口，沿 procedures_call* 的 NAME 做传递闭包；顶层块（procedure=null）总会在
 *  脚本加载时执行。因此「不可达」意味着 KAT 不可能执行到该过程——不是只看子串启发式。 */
function reachableProcedures(facts: DemoFacts, driver: string): Set<string> {
  const callees = new Map<string, string[]>();
  for (const [owner, callee] of facts.calls) {
    if (!callee) continue;
    callees.set(owner, [...(callees.get(owner) ?? []), callee]);
  }
  const queue = facts.defined.filter((name) => new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(driver));
  queue.push(...(callees.get('') ?? []));
  const reached = new Set<string>();
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (reached.has(name)) continue;
    reached.add(name);
    for (const callee of callees.get(name) ?? []) queue.push(callee);
  }
  return reached;
}

const pickSource = (expected: string[]): Source | null =>
  SOURCES.find((source) => !source.out.some((type) => expected.includes(type))) ?? null;

/** 结构路径定位：块 id 在 demo 里可能重复（ML-DSA-NTT 的 mul1_b 就重复），不能按 id 找。 */
function locateBlock(json: WorkspaceJson, path: string[]): RawBlock | undefined {
  let block: RawBlock | undefined = json.blocks.blocks[Number(path[0])];
  for (const step of path.slice(1)) {
    block = step === 'next' ? block?.next?.block : block?.inputs?.[step.slice(3)]?.block;
  }
  return block;
}

/** 变量中转构造：v ← 不兼容来源；目标输入 ← variables_get(v)。 */
function buildMutation(json: WorkspaceJson, site: Site, index: number, source: Source): WorkspaceJson | null {
  const clone = structuredClone(json);
  const parent = locateBlock(clone, site.path);
  if (!parent?.inputs?.[site.inputName]) return null;
  const variableId = `kat_mut_${index}`;
  const variableName = `kat_mut_${index}`;
  parent.inputs[site.inputName] = {
    block: { type: 'variables_get', id: `${variableId}_get`, fields: { VAR: { id: variableId, name: variableName } } },
  };
  clone.blocks.blocks.push({ type: 'variables_set', id: `${variableId}_set`, fields: { VAR: { id: variableId, name: variableName } }, inputs: { VALUE: { block: source.make() } } });
  clone.variables = [...(clone.variables ?? []), { name: variableName, id: variableId }];
  return clone;
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcResult> {
  return new Promise((settle) => {
    const child = spawn(command, args, { cwd: ROOT });
    const out: string[] = [];
    const err: string[] = [];
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const finish = (status: number | null, spawnError: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle({ status, stdout: out.join(''), stderr: err.join(''), timedOut, spawnError });
    };
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
    child.on('error', (error: Error) => finish(null, error.message));
    child.on('close', (code: number | null) => finish(code, null));
  });
}

/** 调冻结检查器；崩溃（无 TYPECHECK 行）不静默跳过，error 进报告并计入异常清单。 */
async function runChecker(file: string): Promise<{ mismatch: number; error: string | null }> {
  const result = await runProcess(process.execPath, [CHECKER, 'types', file], CHECKER_TIMEOUT_MS);
  const match = /TYPECHECK demos=\d+ pairs=\d+ ok=\d+ mismatch=(\d+)/.exec(result.stdout);
  if (!match) {
    const detail = `${result.stdout}${result.stderr}`.trim().slice(0, 300);
    return { mismatch: 0, error: `checker 无 TYPECHECK 行 (exit=${result.status}${result.timedOut ? ' timeout' : ''}): ${detail}` };
  }
  const noise = result.timedOut ? 'timeout' : result.stderr.trim().slice(0, 200);
  return { mismatch: Number(match[1]), error: noise ? `stderr: ${noise}` : null };
}

async function runPython(file: string, expect: string): Promise<{ status: string; reason: string }> {
  const result = await runProcess(PYTHON, [file], KAT_TIMEOUT_MS);
  if (result.spawnError) throw new Error(`无法启动 ${PYTHON}: ${result.spawnError}`);
  if (result.timedOut) return { status: 'fail', reason: `timeout>${KAT_TIMEOUT_MS}ms` };
  const stdout = result.stdout.trim();
  if (result.status !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-1)[0] ?? '';
    return { status: 'fail', reason: `exit=${result.status} ${tail}`.slice(0, 200) };
  }
  if (stdout === expect) return { status: 'pass', reason: 'stdout==expect' };
  return { status: 'fail', reason: `stdout=${stdout.slice(0, 80)}` };
}

const excerpt = (code: string, variableName: string): string[] =>
  code.split('\n').filter((line) => line.includes(variableName)).slice(0, 4).map((line) => line.trim());
function katMode(entry: Entry): string {
  if (entry.katStatus !== 'fail') return entry.katStatus ?? '-';
  const reason = entry.katReason ?? '';
  if (reason.startsWith('timeout')) return 'timeout';
  const error = /exit=\d+ ([A-Za-z]*Error)/.exec(reason);
  if (error) return error[1];
  return reason.startsWith('stdout=') ? 'wrong-output' : 'other-failure';
}
async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
function parseOptions(argv: string[]): { demoLimit: number; seed: number; concurrency: number } {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const demoLimit = Number(read('--demos') ?? process.env.KAT_DEMO_SAMPLE ?? 0);
  const seed = Number(read('--seed') ?? process.env.KAT_SEED ?? 20261114);
  const concurrency = Number(read('--concurrency') ?? process.env.KAT_CONCURRENCY ?? 4);
  return {
    demoLimit: Number.isFinite(demoLimit) && demoLimit > 0 ? demoLimit : 0,
    seed: Number.isFinite(seed) ? seed : 20261114,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
  };
}
async function main(): Promise<void> {
  const startedAt = Date.now();
  const options = parseOptions(process.argv.slice(2));
  const contract = readJson<Contract>(CONTRACT_FILE);
  const registry = readJson<Record<string, TestSpec>>(TESTS_FILE);
  const checker = {
    bundle: relative(ROOT, CHECKER),
    bundleSha256: sha256File(CHECKER),
    source: relative(ROOT, CHECKER_SOURCE),
    sourceSha256: sha256File(CHECKER_SOURCE),
  };
  for (const dir of [MUT_DIR, PY_DIR]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  const allDemos = listDemoFiles();
  const selected = options.demoLimit > 0 ? shuffled(allDemos, options.seed).slice(0, options.demoLimit) : allDemos;
  const sampled = selected.length < allDemos.length;
  const cache = new Map<string, WorkspaceJson>();
  const demoJson = (demo: string): WorkspaceJson => {
    const cached = cache.get(demo);
    if (cached) return cached;
    const json = readJson<WorkspaceJson>(resolve(ROOT, demo));
    cache.set(demo, json);
    return json;
  };
  const relOf = (demo: string): string => demo.replace(/^demos\//, '');
  const { Blockly, pythonGenerator } = await bootBlockly();
  const originals = new Map<string, BlockFn>(Object.entries(pythonGenerator.forBlock));

  // 1) 基线与分母：原件必须跑通官方向量，且检查器在原件上不得有既有 mismatch。
  const baseline: BaselineRow[] = [];
  for (const demo of selected) {
    const spec = registry[relOf(demo)];
    const check = await runChecker(resolve(ROOT, demo));
    const row = { demo, checkerMismatch: check.mismatch, checkerError: check.error };
    if (!spec) {
      baseline.push({ ...row, status: 'no-vector', reason: 'demos/tests.json 无条目' });
      continue;
    }
    const generated = generatePython(Blockly, pythonGenerator, originals, demoJson(demo));
    if (generated.error) {
      baseline.push({ ...row, status: 'generate-error', reason: generated.error });
      continue;
    }
    const file = join(PY_DIR, `baseline__${relOf(demo).replace(/[^\w]+/g, '_')}.py`);
    writeFileSync(file, `${generated.code}\n${spec.py.driver}\n`);
    const kat = await runPython(file, spec.py.expect);
    baseline.push({ ...row, status: kat.status, reason: kat.reason });
  }
  const baselinePass = baseline.filter((row) => row.status === 'pass').length;
  const baselineMismatch = baseline.reduce((sum, row) => sum + (row.checkerMismatch ?? 0), 0);
  console.log(`BASELINE demos=${baseline.length} pass=${baselinePass} fail=${baseline.length - baselinePass} checker_mismatch_on_originals=${baselineMismatch}`);
  for (const row of baseline.filter((item) => item.status !== 'pass').slice(0, 5)) {
    console.log(`    BASE_FAIL ${row.demo}: ${row.status} ${row.reason}`);
  }

  // 2) 全量枚举变异点 + 分母 + 过程调用图 + 可达性
  const facts = new Map(selected.map((demo) => [demo, analyzeDemo(demo, demoJson(demo), contract)]));
  const sites = [...facts.values()].flatMap((item) => item.sites);
  const withCheck = [...facts.values()].reduce((sum, item) => sum + item.withCheck, 0);
  const reach = new Map(selected.map((demo) => [demo, reachableProcedures(facts.get(demo) as DemoFacts, registry[relOf(demo)]?.py.driver ?? '')]));
  const constructible = sites.filter((site) => pickSource(site.expected) !== null);
  const baselineByDemo = new Map(baseline.map((row) => [row.demo, row.checkerMismatch ?? 0]));
  console.log(`SITES demos=${selected.length} sampled=${sampled} with_check=${withCheck} with_child=${sites.length} constructible=${constructible.length}`);

  // 3) 逐点变异 → 生成 → 检查器 → KAT
  const entries = await pool(constructible, options.concurrency, async (site, index): Promise<Entry> => {
    const source = pickSource(site.expected) as Source;
    const base: Entry = {
      demo: site.demo, parentType: site.parentType, inputName: site.inputName, expected: site.expected,
      originalChild: site.originalChild, sourceType: source.type, sourceExpr: source.expr, category: 'd',
      reason: '', procedure: site.procedure, checkerMismatch: null, checkerError: null, katStatus: null, katReason: null, codeExcerpt: [],
    };
    const spec = registry[relOf(site.demo)];
    const mutated = buildMutation(demoJson(site.demo), site, index, source);
    if (!mutated) return { ...base, category: 'e', reason: '结构路径定位失败' };
    const generated = generatePython(Blockly, pythonGenerator, originals, mutated);
    if (generated.error) return { ...base, category: 'a', reason: `generator: ${generated.error}` };
    const tag = `${relOf(site.demo).replace(/[^\w]+/g, '_')}__${index}`;
    const mutFile = join(MUT_DIR, `${tag}.json`);
    writeFileSync(mutFile, JSON.stringify(mutated));
    const codeExcerpt = excerpt(generated.code, `kat_mut_${index}`);
    const check = await runChecker(mutFile);
    const detected = check.error === null && check.mismatch > (baselineByDemo.get(site.demo) ?? 0);
    if (!spec) {
      return { ...base, category: 'e', reason: 'demos/tests.json 无条目，无法判定 KAT', checkerMismatch: check.mismatch, checkerError: check.error, codeExcerpt };
    }
    const pyFile = join(PY_DIR, `${tag}.py`);
    writeFileSync(pyFile, `${generated.code}\n${spec.py.driver}\n`);
    const kat = await runPython(pyFile, spec.py.expect);
    const evidence: Entry = { ...base, checkerMismatch: check.mismatch, checkerError: check.error, katStatus: kat.status, katReason: kat.reason, codeExcerpt };
    if (detected && kat.status !== 'pass') return { ...evidence, category: 'b', reason: '检查器报警且 KAT 失败' };
    if (detected) return { ...evidence, category: 'c', reason: '检查器报警但 KAT 通过' };
    if (check.error) return { ...evidence, category: 'd', reason: `检查器崩溃/无输出，按未报警计：${check.error}` };
    return { ...evidence, category: 'd', reason: '检查器未报警' };
  });
  const unconstructible: Entry[] = sites
    .filter((site) => pickSource(site.expected) === null)
    .map((site): Entry => ({
      demo: site.demo, parentType: site.parentType, inputName: site.inputName, expected: site.expected,
      originalChild: site.originalChild, sourceType: null, sourceExpr: null, category: 'e', procedure: site.procedure,
      reason: '没有与期望类型不相交的可用来源块', checkerMismatch: null, checkerError: null,
      katStatus: null, katReason: null, codeExcerpt: [],
    }));
  const allEntries = [...entries, ...unconstructible];

  const count = (category: Category): number => allEntries.filter((item) => item.category === category).length;
  const counts = { a: count('a'), b: count('b'), c: count('c'), d: count('d'), e: count('e') };
  const total = allEntries.length;
  const detected = counts.b + counts.c;
  const judged = counts.b + counts.c + counts.d;
  const checkerCrashes = allEntries.filter((item) => (item.checkerError ?? '').startsWith('checker'));
  const katModes = allEntries.reduce<Record<string, number>>((acc, item) => { const mode = katMode(item); acc[mode] = (acc[mode] ?? 0) + 1; return acc; }, {});
  const pick = (category: Category, limit: number): Entry[] => allEntries.filter((item) => item.category === category).slice(0, limit);
  // 可达性：driver 里出现的过程名 + 顶层调用 + 传递闭包；不可达即 KAT 不可能执行到该路径。
  const annotated = allEntries.map((item) => ({
    ...item,
    procedureReachable: item.procedure === null || (reach.get(item.demo)?.has(item.procedure) ?? false),
  }));
  const cSplit = annotated.filter((item) => item.category === 'c').reduce<Record<string, number>>((acc, item) => { const key = item.procedureReachable ? 'procedureReachable' : 'procedureUnreachable'; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const report = {
    generatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt,
    purpose: '判据 B：换来源变异 → 生成 Python → 跑 demos/tests.json 官方向量（独立于检查器契约表）',
    checker,
    sampling: sampled
      ? { sampled: true, seed: options.seed, demosTotal: allDemos.length, demosEnumerated: selected.length, demos: selected, note: `抽样：mulberry32(${options.seed}) 洗牌后取 ${selected.length}/${allDemos.length} 个 demo；数字不代表全量` }
      : { sampled: false, demosTotal: allDemos.length, demosEnumerated: selected.length, demos: selected, note: `全量：${allDemos.length} 个 demo 全部枚举，无抽样、无种子` },
    denominator: {
      valueInputsWithCheck: withCheck, valueInputsWithChild: sites.length, constructibleMutants: entries.length, unconstructible: withCheck - entries.length,
      note: '三档：有 check 的值输入数（含未连子块的槽）/ 已连子块可换来源数（与检查器 TYPECHECK 的 pairs 同口径）/ 实际构造出且被判定的变异数。a–e 之和 = constructibleMutants；空槽与无不相交来源的点计入 unconstructible。',
    },
    baseline: {
      demos: baseline.length, pass: baselinePass, fail: baseline.filter((row) => row.status !== 'pass'), checkerMismatchOnOriginals: baselineMismatch,
      note: '未变异工作区跑官方向量 + 检查器原件判定；只有全部 pass 且 mismatch=0，b 类的「KAT 失败」才可归因于变异',
    },
    sites: {
      total, constructible: entries.length, unconstructible: unconstructible.length, noVectorDemos: selected.filter((demo) => !registry[relOf(demo)]),
      expectedByType: allEntries.reduce<Record<string, number>>((acc, item) => { const key = item.expected.join('|'); acc[key] = (acc[key] ?? 0) + 1; return acc; }, {}),
    },
    counts,
    rates: {
      sumCheck: counts.a + counts.b + counts.c + counts.d + counts.e, detectionRateOverLoadable: judged > 0 ? (detected / judged) * 100 : 0,
      trueErrorRate: detected > 0 ? (counts.b / detected) * 100 : 0, falsePositiveRate: detected > 0 ? (counts.c / detected) * 100 : 0,
      missedRate: judged > 0 ? (counts.d / judged) * 100 : 0,
      note: '真错率 = b/(b+c)；误报率 = c/(b+c)；漏报率 = d/(b+c+d)；a 类不计入检查器检出',
    },
    katFailureModes: katModes,
    falsePositiveBreakdown: {
      ...cSplit, criterion: 'procedureReachable = 该输入所在过程的定义名以标识符边界出现在 spec.py.driver，或由这些入口（含顶层块直接调用）沿 procedures_call* 的 NAME 传递闭包可达；顶层块（procedure=null）视为总执行。procedureUnreachable 说明 KAT 不可能执行到该路径，不是检查器误报；procedureReachable 才是「报警但执行结果不变」。',
      note: '只做了静态可达性判定，未证明「可达过程中该值必然影响输出」；因此 c 仍是「报警但 KAT 通过」的机械计数。',
    },
    anomalies: {
      checkerCrashes: checkerCrashes.length, checkerCrashEntries: checkerCrashes.slice(0, 10), note: '检查器在变异件上无 TYPECHECK 输出（崩溃）时按「未报警」计入 d，并在此逐条列出，不静默跳过',
    },
    samples: { b: pick('b', 3), c: pick('c', 3), a: pick('a', 3), d: pick('d', 3), e: pick('e', 3) },
    entries: annotated,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `KAT_SUMMARY total=${total} a=${counts.a} b=${counts.b} c=${counts.c} d=${counts.d} e=${counts.e} ` +
      `true_error_rate=${report.rates.trueErrorRate.toFixed(1)}% false_positive_rate=${report.rates.falsePositiveRate.toFixed(1)}% ` +
      `elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  console.log(`KAT_MODES ${JSON.stringify(katModes)}`);
  console.log(`KAT_REPORT ${OUT_FILE}`);
}

void main();
