/**
 * P4 A 线纵向切片 · 第 4 段：verify-project
 *
 * 复用 verify-demo 的 jsdom + Blockly 装载手法，但对象是**多文件 project**（ProjectRecord.files[]）：
 *   1. 结构：files ≥ 2、entryFileId 指向真实文件、每个 workspace 反序列化块数与序列化树一致；
 *   2. 生成：extractProjectSymbols().errors 为空、两段代码非空；
 *   3. 执行：用 metadata.aiHelper.tests 的 driver 跑 python3 / node，比对 FIPS 180-4 B.2 向量；
 *   4. 类型：把活工作区转成 TreeLike 交给仓库的 checkTree（契约真值 BLOCK-IO-CONTRACT.json）。
 *
 * 用法：
 *   AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/p4 \
 *     npx vite build --config vite.verify.config.ts
 *   node dist-verify/p4/verify-project.js experiments/ai-helper-2026-11-14/p4/project/sha256-multiblock.project.json --exec [--out <json>]
 *
 * 这里只证明「工程能打开、能生成、这条向量跑通」；不证明块与标准语义等价（永远 unverified）。
 */
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import type { Block } from 'blockly/core';

import type { ProjectFileRecord, ProjectRecord } from '@/services/projects/ProjectStore';

const DRIVER_TIMEOUT_MS = 25_000;
const VALUE_INPUT = 1;

interface TestSpec { driver: string; expect: string }
interface ControlSpec { driver: string; mustDifferFrom: string }
interface AiHelperTests {
  py: TestSpec;
  js: TestSpec;
  vector?: Record<string, unknown>;
  control?: { note?: string; mustDifferFrom: string; py: ControlSpec; js: ControlSpec };
}

interface ProjectRecordWithMeta extends ProjectRecord<string> {
  metadata?: { aiHelper?: { tests?: AiHelperTests } & Record<string, unknown> };
}

type Globals = typeof globalThis & { document: unknown; window: unknown; DOMParser: unknown; XMLSerializer: unknown; Node: unknown; Element: unknown };

/** FNV-1a 64：只用于给生成代码留指纹（不是密码学摘要，构建脚本不引 node:crypto）。 */
function fnv1a64(text: string): string {
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function errorDetail(error: unknown, field: 'message' | 'stderr'): string {
  if (error instanceof Error && field === 'message') return error.message;
  if (typeof error === 'object' && error !== null && field in error) {
    return String((error as Record<string, unknown>)[field] ?? '');
  }
  return String(error);
}

/** 序列化树里的块数（不依赖 Blockly，用来和加载后的块数对账）。 */
function countSerializedBlocks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countSerializedBlocks(item), 0);
  if (typeof value !== 'object' || value === null) return 0;
  const record = value as Record<string, unknown>;
  const self = typeof record.type === 'string' ? 1 : 0;
  return self + Object.entries(record)
    .filter(([key]) => key !== 'extraState')
    .reduce((sum: number, [, item]) => sum + countSerializedBlocks(item), 0);
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const execMode = process.argv.includes('--exec');
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
  if (!file) {
    console.error('用法: node dist-verify/verify-project.js <project.json> [--exec] [--out <json>]');
    process.exit(1);
  }

  // headless DOM 桩（必须先于 import Blockly）
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const globals = globalThis as Globals;
  globals.document = dom.window.document;
  globals.window = dom.window;
  globals.DOMParser = dom.window.DOMParser;
  globals.XMLSerializer = dom.window.XMLSerializer;
  globals.Node = dom.window.Node;
  globals.Element = dom.window.Element;

  const Blockly = (await import('blockly/core')).default ?? (await import('blockly/core'));
  const { setLocale } = await import('blockly/core');
  setLocale(await import('blockly/msg/en'));
  await import('blockly/blocks');
  await import('@/blocks');
  await import('@/generators/python');
  await import('@/generators/javascript');
  const { extractProjectSymbols, generateProjectBundle } = await import('@/utils/projectCodegen');
  const { compatibility, inputCheck, loadContract, outputCheck } = await import('./ai-helper-contract');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const pythonCommand = process.env.CIPHER_CAT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

  const project = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectRecordWithMeta;
  const files = Array.isArray(project.files) ? project.files : [];
  const problems: string[] = [];
  const readings: Record<string, unknown> = { project: file.replace(`${process.cwd()}/`, ''), name: project.name, language: project.language };

  // 1. 结构
  const structure = {
    files: files.length,
    names: files.map((item: ProjectFileRecord) => item.name),
    entryFileId: project.entryFileId ?? null,
    entryMatches: files.some((item: ProjectFileRecord) => item.fileId === project.entryFileId),
    perFile: [] as Array<{ name: string; serializedBlocks: number; loadedBlocks: number; ok: boolean }>,
  };
  if (files.length < 2) problems.push(`files 少于 2 个（${files.length}）——不是多文件 project`);
  if (!structure.entryMatches) problems.push(`entryFileId「${project.entryFileId}」不在 files[] 里`);
  if (!project.metadata?.aiHelper?.tests) problems.push('metadata.aiHelper.tests 缺失，无法执行向量');

  if (!execMode) console.log(`== project: ${project.name}`);

  interface LiveWorkspace { getAllBlocks(ordered?: boolean): Block[]; getTopBlocks(ordered?: boolean): Block[]; dispose(): void }
  // 符号表必须先于任何工作区加载写入：call 块的下拉在反序列化时就要解析跨文件函数名。
  const symbols = extractProjectSymbols(files);
  for (const message of symbols.errors) problems.push(`符号表：${message}`);

  const workspaces: Array<{ file: ProjectFileRecord; workspace: LiveWorkspace }> = [];
  for (const item of files) {
    let workspace: LiveWorkspace | null = null;
    let loaded = 0;
    const expected = countSerializedBlocks(JSON.parse(String(item.workspace || '{}')));
    try {
      const raw = String(item.workspace || '').trim();
      if (!raw) throw new Error('工作区负载为空');
      const created = new Blockly.Workspace() as unknown as LiveWorkspace;
      workspace = created;
      Blockly.serialization.workspaces.load(JSON.parse(raw) as Record<string, unknown>, created as unknown as Blockly.Workspace);
      loaded = created.getAllBlocks(false).length;
      if (loaded !== expected) problems.push(`${item.name}: 加载后块数 ${loaded} ≠ 序列化树 ${expected}`);
      for (const node of created.getAllBlocks(false)) {
        if (node.type !== 'procedures_callreturn' && node.type !== 'procedures_callnoreturn') continue;
        const name = String(node.getFieldValue('NAME') || '');
        if (!name) problems.push(`${item.name}: call 块未解析到函数名（跨文件符号不可见）`);
      }
    } catch (error) {
      problems.push(`${item.name}: 工作区加载失败：${errorDetail(error, 'message')}`);
    }
    if (workspace) workspaces.push({ file: item, workspace });
    structure.perFile.push({ name: item.name, serializedBlocks: expected, loadedBlocks: loaded, ok: loaded === expected });
  }

  // 2. 生成
  const bundle = generateProjectBundle(files, project.entryFileId || '', '');
  for (const message of bundle.errors) problems.push(`代码生成：${message}`);

  const pyLines = bundle.python ? bundle.python.split('\n').length : 0;
  const jsLines = bundle.javascript ? bundle.javascript.split('\n').length : 0;
  if (!bundle.python.trim()) problems.push('Python 代码为空');
  if (!bundle.javascript.trim()) problems.push('JavaScript 代码为空');
  const iterationProof = {
    pythonLoop: /for i in range\(blocks\):/.test(bundle.python),
    javascriptLoop: /for \(let i = 0; i < blocks; i\+\+\)/.test(bundle.javascript),
    pythonChunk: /bytes_slice\(padded, offset, \(?offset \+ 64\)?\)/.test(bundle.python),
    javascriptChunk: /bytesSlice\(padded, offset, \(?offset \+ 64\)?\)/.test(bundle.javascript),
  };

  // 3. 类型（契约真值；逐个值输入配对判定，不用 checkTree——后者只走值输入树，
  //    而本工程的语句都在 STACK/DO 语句输入里，从顶层走会漏掉整条链）。
  const contract = loadContract();
  const typecheck = {
    pairs: 0, ok: 0, mismatch: 0, unknown: 0,
    unknownCauses: { coreBlockNoContract: 0, parentInputNoCheck: 0, childOutputNoCheck: 0 },
    findings: [] as Array<Record<string, unknown>>,
  };
  for (const entry of workspaces) {
    for (const node of entry.workspace.getAllBlocks(false)) {
      for (const input of node.inputList) {
        if (input.type !== VALUE_INPUT) continue;
        const child = input.connection?.targetBlock();
        if (!child) continue;
        const expected = inputCheck(contract, node.type, input.name);
        const actual = outputCheck(contract, child.type);
        const verdict = compatibility(expected, actual);
        typecheck.pairs += 1;
        if (verdict === 'ok') {
          typecheck.ok += 1;
          continue;
        }
        if (verdict === 'mismatch') {
          typecheck.mismatch += 1;
          typecheck.findings.push({ parent: node.type, input: input.name, child: child.type, expected, actual });
          continue;
        }
        typecheck.unknown += 1;
        if (!contract[child.type]) typecheck.unknownCauses.coreBlockNoContract += 1;
        else if (expected === null) typecheck.unknownCauses.parentInputNoCheck += 1;
        else typecheck.unknownCauses.childOutputNoCheck += 1;
      }
    }
  }
  if (typecheck.mismatch > 0) problems.push(`类型检查 mismatch ${typecheck.mismatch} 处`);

  readings.structure = structure;
  const symbolList = symbols.symbols.map((symbol) => ({ name: symbol.name, params: symbol.params, path: symbol.path, fileId: symbol.fileId }));
  readings.symbols = symbolList;
  readings.generation = {
    pythonLines: pyLines,
    javascriptLines: jsLines,
    pythonFnv1a64: fnv1a64(bundle.python),
    javascriptFnv1a64: fnv1a64(bundle.javascript),
    iterationProof,
  };
  readings.typecheck = typecheck;

  if (!execMode) {
    console.log(`\n== structure: files=${structure.files} entry=${structure.entryFileId} entryMatches=${structure.entryMatches}`);
    for (const item of structure.perFile) console.log(`   ${item.name}: blocks=${item.loadedBlocks}/${item.serializedBlocks}`);
    console.log(`\n== symbols: ${JSON.stringify(symbolList)}`);
    console.log(`\n== generation: python=${pyLines} 行 / js=${jsLines} 行  loop=${iterationProof.pythonLoop}/${iterationProof.javascriptLoop}`);
    console.log(`\n== typecheck: pairs=${typecheck.pairs} ok=${typecheck.ok} mismatch=${typecheck.mismatch} unknown=${typecheck.unknown} causes=${JSON.stringify(typecheck.unknownCauses)}`);
    console.log('\n===== PYTHON =====\n' + bundle.python);
    console.log('\n===== JAVASCRIPT =====\n' + bundle.javascript);
    for (const message of problems) console.error(`PROBLEM: ${message}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }

  // 4. 双语言执行
  const spec = project.metadata?.aiHelper?.tests as AiHelperTests;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ciphercat-project-'));
  const results: Array<{ lang: string; pass: boolean; got: string; expect: string }> = [];
  const execDriver = (lang: 'py' | 'js', code: string, driver: string): { got: string; error: string } => {
    try {
      if (lang === 'py') {
        const target = `${tmpDir}/project.py`;
        fs.writeFileSync(target, `${code}\n${driver}\n`);
        return { got: execFileSync(pythonCommand, [target], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS }).trim(), error: '' };
      }
      const target = `${tmpDir}/project.js`;
      fs.writeFileSync(target, `${code}\n${driver}\n`);
      return { got: execFileSync(process.execPath, [target], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS }).trim(), error: '' };
    } catch (error) {
      return { got: '', error: `${errorDetail(error, 'message')} | stderr: ${errorDetail(error, 'stderr')}` };
    }
  };
  const run = (lang: 'py' | 'js', code: string): void => {
    const driver = spec[lang];
    const outcome = execDriver(lang, code, driver.driver);
    const name = lang === 'py' ? 'Python' : 'JS';
    results.push(outcome.error
      ? { lang: name, pass: false, got: `EXEC ERROR: ${outcome.error}`, expect: driver.expect }
      : { lang: name, pass: outcome.got === driver.expect, got: outcome.got, expect: driver.expect });
  };
  run('py', bundle.python);
  run('js', bundle.javascript);

  // 阴性对照：单分组压缩必须给出**不同**结果，否则「通过」可能只是碰巧。
  const control = spec.control;
  const controlResults: Array<{ lang: string; got: string; differ: boolean; error: string }> = [];
  if (control) {
    for (const lang of ['py', 'js'] as const) {
      const outcome = execDriver(lang, lang === 'py' ? bundle.python : bundle.javascript, control[lang].driver);
      controlResults.push({
        lang: lang === 'py' ? 'Python' : 'JS',
        got: outcome.got,
        differ: !outcome.error && outcome.got !== '' && outcome.got !== control.mustDifferFrom,
        error: outcome.error,
      });
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  readings.vector = {
    name: (spec.vector?.name as string) || 'FIPS 180-4 B.2',
    expect: spec.py.expect,
    python: results[0],
    javascript: results[1],
    control: control ? { note: control.note || '', mustDifferFrom: control.mustDifferFrom, results: controlResults } : null,
  };

  const controlPass = !control || controlResults.every((item) => item.differ);
  if (!controlPass) problems.push('阴性对照未开火：单分组压缩给出了与官方向量相同的结果');
  const allPass = results.every((item) => item.pass) && controlPass && problems.length === 0;
  readings.pass = allPass;
  readings.problems = problems;

  console.log(`\n== project: ${project.name}`);
  console.log(`== structure: files=${structure.files} entry=${structure.entryFileId} entryMatches=${structure.entryMatches} ` +
    `blocks=${structure.perFile.map((item) => item.loadedBlocks).join('+')}`);
  console.log(`== symbols: ${symbols.symbols.map((symbol) => symbol.name).join(',') || '(none)'} errors=${symbols.errors.length}`);
  console.log(`== generation: python=${pyLines} 行 / js=${jsLines} 行 loop=${iterationProof.pythonLoop}/${iterationProof.javascriptLoop} chunk=${iterationProof.pythonChunk}/${iterationProof.javascriptChunk}`);
  console.log(`== typecheck: pairs=${typecheck.pairs} ok=${typecheck.ok} mismatch=${typecheck.mismatch} unknown=${typecheck.unknown} causes=${JSON.stringify(typecheck.unknownCauses)}`);
  for (const item of results) {
    console.log(`\n[${item.lang}] ${item.pass ? 'PASS' : 'FAIL'}`);
    if (!item.pass) {
      console.log(`  expect: ${item.expect}`);
      console.log(`  got:    ${item.got}`);
    }
  }
  if (control) {
    for (const item of controlResults) {
      console.log(`[${item.lang}] 单分组对照 ${item.differ ? 'PASS' : 'FAIL'} got=${item.got || item.error} (必须 ≠ ${control.mustDifferFrom.slice(0, 16)}…)`);
    }
  }
  for (const message of problems) console.error(`PROBLEM: ${message}`);
  console.log(allPass ? `\n=== PROJECT VECTOR PASS (${spec.py.expect}) ===` : '\n=== PROJECT VECTOR MISMATCH ===');

  if (outPath) {
    fs.writeFileSync(resolve(process.cwd(), outPath), `${JSON.stringify(readings, null, 2)}\n`, 'utf8');
    console.log(`readings=${outPath}`);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
