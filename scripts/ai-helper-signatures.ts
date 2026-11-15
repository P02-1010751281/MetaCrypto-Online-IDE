/**
 * 块 ↔ 代码签名扫描（用户侧 AI Helper · A/B 线 P0）
 *
 * 目的：为「代码 → 工作区」的反向路径建立机器可复核的模板表。做法不是解析生成器源码，
 * 而是让生成器自己把每个块的代码形态吐出来：把 valueToCode / statementToCode 换成占位符，
 * 于是每个块的返回码就是一条「带槽位的模板」。
 *
 * 产物：experiments/ai-helper-2026-11-14/out/code-signatures.json
 * 用法：npm run verify:build && node dist-verify/ai-helper-signatures.js
 *
 * 说明：本脚本只读，不写 src/、不改契约、不参与 verify:all。
 */
import { JSDOM } from 'jsdom';

interface GeneratorLike {
  forBlock: Record<string, (block: unknown) => unknown>;
  definitions_: Record<string, unknown>;
  valueToCode: (block: unknown, name: string) => string;
  statementToCode: (block: unknown, name: string) => string;
  init: (workspace: unknown) => void;
}

type ScanGlobals = typeof globalThis & {
  document: unknown;
  window: unknown;
  DOMParser: unknown;
  XMLSerializer: unknown;
  Node: unknown;
  Element: unknown;
};

interface LangSignature {
  template: string | null;
  order: string | null;
  definitions: string[];
  error: string | null;
}

interface BlockSignature {
  type: string;
  python: LangSignature;
  javascript: LangSignature;
}

// 占位符必须是「合法标识符」：有 10 个块把输出目标写成变量名（requireVariableName），
// 用 @V:x@ 这类符号会让它们直接抛错。前缀刻意取得不可能与真实代码重名。
const PLACEHOLDER_VALUE = 'zzsigv_';
const PLACEHOLDER_STATEMENT = 'zzsigs_';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把生成器的取子块入口换成占位符，从而在无子块的情况下拿到该块的代码模板。 */
function withStubbedChildren<T>(generator: GeneratorLike, run: () => T): { result: T; definitions: string[] } {
  const before = { ...generator.definitions_ };
  const originalValue = generator.valueToCode.bind(generator);
  const originalStatement = generator.statementToCode.bind(generator);
  generator.valueToCode = (_block: unknown, name: string) => `${PLACEHOLDER_VALUE}${name || 'anon'}`;
  generator.statementToCode = (_block: unknown, name: string) => `${PLACEHOLDER_STATEMENT}${name || 'anon'}`;
  try {
    const result = run();
    const added = Object.keys(generator.definitions_).filter((key) => !(key in before));
    return { result, definitions: added };
  } finally {
    generator.valueToCode = originalValue;
    generator.statementToCode = originalStatement;
  }
}

function normalizeReturn(raw: unknown): { template: string | null; order: string | null } {
  if (typeof raw === 'string') return { template: raw, order: null };
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return { template: raw[0], order: typeof raw[1] === 'string' ? raw[1] : null };
  }
  return { template: null, order: null };
}

function scanLanguage(
  generator: GeneratorLike,
  type: string,
  makeBlock: (type: string) => unknown,
): LangSignature {
  const emit = generator.forBlock[type];
  if (typeof emit !== 'function') {
    return { template: null, order: null, definitions: [], error: 'no-generator' };
  }
  const block = makeBlock(type);
  try {
    const { result, definitions } = withStubbedChildren(generator, () => emit(block));
    const { template, order } = normalizeReturn(result);
    return { template, order, definitions, error: template === null ? 'no-code-returned' : null };
  } catch (error) {
    return { template: null, order: null, definitions: [], error: errorMessage(error) };
  }
}

async function main(): Promise<void> {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const scanGlobals = globalThis as ScanGlobals;
  scanGlobals.document = dom.window.document;
  scanGlobals.window = dom.window;
  scanGlobals.DOMParser = dom.window.DOMParser;
  scanGlobals.XMLSerializer = dom.window.XMLSerializer;
  scanGlobals.Node = dom.window.Node;
  scanGlobals.Element = dom.window.Element;

  const BlocklyModule = await import('blockly/core');
  const Blockly = BlocklyModule.default ?? BlocklyModule;
  const { setLocale } = await import('blockly/core');
  const enMsgs = await import('blockly/msg/en');
  setLocale(enMsgs);
  await import('blockly/blocks');

  const { ALL_BLOCK_TYPES } = await import('@/blocks');
  await import('@/generators/python');
  await import('@/generators/javascript');
  const { pythonGenerator } = await import('blockly/python');
  const { javascriptGenerator } = await import('blockly/javascript');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const pyGenerator = pythonGenerator as unknown as GeneratorLike;
  const jsGenerator = javascriptGenerator as unknown as GeneratorLike;

  const workspace = new Blockly.Workspace();
  // 有 10 个块把结果写进「变量字段」，工作区里没有任何变量时它们的生成器会直接抛
  // 「X must be a variable name」。先建一个探测变量，让这些块也能量到形态。
  workspace.getVariableMap().createVariable('scan_var', '', 'scan_var_id');
  // 生成器必须先 init：nameDB_/definitions_ 由 init 建立，否则 provideFunction_ 取不到去重名。
  pyGenerator.init(workspace);
  jsGenerator.init(workspace);
  Blockly.Events.disable();
  const signatures: BlockSignature[] = [];
  try {
    // 变量类块的字段默认为空，生成器会抛「X must be a variable name」；统一指向探测变量。
    const makeBlock = (type: string): unknown => {
      const block = workspace.newBlock(type) as unknown as {
        inputList: Array<{ fieldRow: Array<{ name?: string; constructor: { name: string } }> }>;
        setFieldValue: (value: string, field: string) => void;
      };
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          if (typeof field.name !== 'string' || !field.name) continue;
          const isVariableField = field.constructor.name === 'FieldVariable';
          const current = (field as unknown as { getValue?: () => unknown }).getValue?.();
          // 变量下拉：指向探测变量；文本类「输出变量名」字段：默认空串会让生成器
          // 抛「X must be a variable name」，这里统一填一个合法标识符。
          const isTextInput = field.constructor.name.includes('TextInput');
          const replacement = isVariableField ? 'scan_var_id' : isTextInput && current === '' ? 'scan_out' : null;
          if (replacement === null) continue;
          try {
            block.setFieldValue(replacement, field.name);
          } catch {
            // 该字段不接受此值时保持默认，错误会在 scanLanguage 里逐块记录
          }
        }
      }
      return block;
    };
    for (const type of [...ALL_BLOCK_TYPES].sort()) {
      signatures.push({
        type,
        python: scanLanguage(pyGenerator, type, makeBlock),
        javascript: scanLanguage(jsGenerator, type, makeBlock),
      });
    }
  } finally {
    Blockly.Events.enable();
    // Generator.finish(code) 只负责收尾字符串拼接，签名扫描不需要；
    // 但 nameDB_ 里会留下本次扫描生成的名字，dispose 前显式清掉避免污染后续调用。
    pyGenerator.definitions_ = {};
    jsGenerator.definitions_ = {};
    workspace.dispose();
  }

  // 统计口径：模板里出现占位符 = 该块需要子块；definitions 非空 = 该块捎带闭包。
  const stats = {
    total: signatures.length,
    pythonOk: signatures.filter((item) => item.python.template !== null).length,
    javascriptOk: signatures.filter((item) => item.javascript.template !== null).length,
    leafPython: signatures.filter(
      (item) => item.python.template !== null && !item.python.template.includes(PLACEHOLDER_VALUE) && !item.python.template.includes(PLACEHOLDER_STATEMENT),
    ).length,
    withDefinitionsPython: signatures.filter((item) => item.python.definitions.length > 0).length,
    withDefinitionsJavascript: signatures.filter((item) => item.javascript.definitions.length > 0).length,
    errors: signatures.filter((item) => item.python.error || item.javascript.error).length,
  };

  // 模板碰撞：不同块产出同一模板 → 反向解析多解，必须靠槽位/字段二级判别。
  const groups = new Map<string, string[]>();
  for (const item of signatures) {
    const template = item.python.template;
    if (!template) continue;
    const list = groups.get(template) ?? [];
    list.push(item.type);
    groups.set(template, list);
  }
  const collisions = [...groups.entries()]
    .filter(([, types]) => types.length > 1)
    .map(([template, types]) => ({ template, types }))
    .sort((a, b) => b.types.length - a.types.length);

  const outDir = path.resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out');
  fs.mkdirSync(outDir, { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), stats, collisions, signatures };
  fs.writeFileSync(path.join(outDir, 'code-signatures.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(
    `SIGNATURE_SUMMARY blocks=${stats.total} python=${stats.pythonOk} javascript=${stats.javascriptOk} ` +
      `leaf_python=${stats.leafPython} defs_python=${stats.withDefinitionsPython} ` +
      `defs_javascript=${stats.withDefinitionsJavascript} errors=${stats.errors} collisions=${collisions.length}`,
  );
  if (collisions.length) {
    const worst = collisions.slice(0, 5)
      .map((entry) => `${entry.types.length}x{${entry.types.slice(0, 4).join(',')}}`)
      .join(' ');
    console.log(`SIGNATURE_COLLISIONS top: ${worst}`);
  }
  const failing = signatures.filter((item) => item.python.error || item.javascript.error);
  if (failing.length) {
    console.log(`SIGNATURE_ERRORS ${failing.slice(0, 8).map((item) => `${item.type}:${item.python.error ?? item.javascript.error}`).join(' | ')}`);
  }
}

void main();
