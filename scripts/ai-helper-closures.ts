/**
 * 内嵌闭包名单采集（用户侧 AI Helper · B 线 B1d）
 *
 * 反解析要判断「哪些顶格 def 是 procedure」。首选痕迹是生成器题头 docstring
 * （`"""Crypto function: X"""`），但用户从 LLM 拿到的代码没有它；剩下的确定性判据只有一条：
 * **这个名字是不是我们生成器内嵌的闭包**。所以这里把全部 `provideFunction_` 名采下来，
 * 落成运行时名单，供 `reverseCode` 在「没有题头」时分流。
 *
 * 两条采集腿：
 *   1. 逐块跑 Python 生成器，把 emit 期间写进 `definitions_` 的闭包名收全（覆盖 222 个块类型）；
 *   2. 60 个 demo 的生成代码里，所有「无题头 def」也并进来兜底——有些闭包要子块串起来才注册，
 *      只跑单块会漏。
 * 名单里不含 procedure 名：demo 的 procedure 靠题头识别，没有题头的 def 才算闭包（两者交集为 0，
 * 采集时会核对并报错）。
 *
 * 产物（同一份内容写两处）：
 *   - 运行时：src/services/ai-helper/reverse/closure-names.json（浏览器按需 ?raw 载入）
 *   - 存档：experiments/ai-helper-2026-11-14/out/closure-names.json
 * 用法：
 *   npm run reverse:closures                 # 重新采集并落两处
 *   npm run reverse:closures:check           # 只重算不落盘：与运行时产物逐一比对，过期即失败
 *
 * 说明：本脚本只读 src/ 与 demos/，check 档进 verify:all；采样档不参与门禁。
 */
import { JSDOM } from 'jsdom';

interface Globals {
  document?: unknown;
  window?: unknown;
  DOMParser?: unknown;
  XMLSerializer?: unknown;
  Node?: unknown;
  Element?: unknown;
}

interface GeneratorLike {
  forBlock: Record<string, (block: unknown) => unknown>;
  definitions_: Record<string, unknown>;
  valueToCode: (block: unknown, name: string) => string;
  statementToCode: (block: unknown, name: string) => string;
  init: (workspace: unknown) => void;
}

interface Payload {
  generatedBy: string;
  closures: string[];
  stats: { blockTypes: number; fromBlocks: number; fromRaw: number; fromDemos: number; procedures: number };
}

const RUNTIME = 'src/services/ai-helper/reverse/closure-names.json';
const ARCHIVE = 'experiments/ai-helper-2026-11-14/out/closure-names.json';

async function collect(): Promise<Payload> {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const globals = globalThis as Globals;
  globals.document = dom.window.document;
  globals.window = dom.window;
  globals.DOMParser = dom.window.DOMParser;
  globals.XMLSerializer = dom.window.XMLSerializer;
  globals.Node = dom.window.Node;
  globals.Element = dom.window.Element;

  const BlocklyModule = await import('blockly/core');
  const Blockly = BlocklyModule.default ?? BlocklyModule;
  const { setLocale } = await import('blockly/core');
  setLocale(await import('blockly/msg/en'));
  await import('blockly/blocks');

  const { ALL_BLOCK_TYPES } = await import('@/blocks');
  await import('@/generators/python');
  const { pythonGenerator } = await import('blockly/python');
  const { isGeneratedProcedure, scanTopLevelDefs } = await import('@/services/ai-helper/reverse/layout');
  const fs = await import('node:fs');

  const pythonGen = pythonGenerator as unknown as GeneratorLike;
  const workspace = new Blockly.Workspace() as unknown as {
    getVariableMap: () => { createVariable: (n: string, t: string, id?: string) => unknown };
    newBlock: (type: string) => { type: string; inputList: unknown[]; setFieldValue: (v: string, f: string) => void; getFieldValue: (f: string) => unknown; getValue?: undefined };
    dispose: () => void;
  };
  workspace.getVariableMap().createVariable('scan_var', '', 'scan_var_id');

  /** 变量字段指向探测变量、空文本字段给个合法标识符，否则生成器会直接抛错。 */
  const makeBlock = (type: string): ReturnType<typeof workspace.newBlock> => {
    const block = workspace.newBlock(type);
    const fields = (block as unknown as { inputList: Array<{ fieldRow: Array<{ name?: string; getValue?: () => unknown }> }> }).inputList;
    for (const input of fields) {
      for (const field of input.fieldRow) {
        if (typeof field.name !== 'string' || !field.name) continue;
        const current = field.getValue?.();
        const isVariable = /variable/i.test(field.name);
        const replacement = isVariable ? 'scan_var_id' : current === '' ? 'scan_out' : null;
        if (replacement === null) continue;
        try {
          (block as unknown as { setFieldValue: (v: string, f: string) => void }).setFieldValue(replacement, field.name);
        } catch {
          // 字段不接受该取值就保持默认；闭包名与字段取值无关
        }
      }
    }
    return block;
  };

  /**
   * 单块 run：emit 期间注册进 definitions_ 的 `def X(` 就是该块内嵌的闭包。
   *
   * 跑两遍并取并集：stub 档把子输入换成占位符（模板采集同款，不会因缺输入抛错），raw 档让
   * 生成器走真实路径——有的闭包只有内层生成器跑到时才注册，只跑 stub 会漏。
   */
  const collectFromBlock = (type: string, mode: 'stub' | 'raw'): string[] => {
    pythonGen.init(workspace);
    pythonGen.definitions_ = {};
    const originalValue = pythonGen.valueToCode.bind(pythonGen);
    const originalStatement = pythonGen.statementToCode.bind(pythonGen);
    if (mode === 'stub') {
      pythonGen.valueToCode = () => 'zzsigv_probe';
      pythonGen.statementToCode = () => 'zzsigs_probe\n';
    }
    try {
      const emit = pythonGen.forBlock[type];
      if (typeof emit === 'function') emit(makeBlock(type));
    } catch {
      // 缺输入/校验拒绝：该块这一档采不到闭包，其余块不受影响
    } finally {
      pythonGen.valueToCode = originalValue;
      pythonGen.statementToCode = originalStatement;
    }
    const names = Object.keys(pythonGen.definitions_).filter((name) => {
      const text = pythonGen.definitions_[name];
      return typeof text === 'string' && new RegExp(`^def\\s+${name}\\s*\\(`, 'm').test(text);
    });
    pythonGen.definitions_ = {};
    return names;
  };

  const fromBlocks = new Set<string>();
  const fromRaw = new Set<string>();
  const types = [...ALL_BLOCK_TYPES].sort();
  try {
    for (const type of types) {
      for (const name of collectFromBlock(type, 'stub')) fromBlocks.add(name);
      for (const name of collectFromBlock(type, 'raw')) fromRaw.add(name);
    }
  } finally {
    workspace.dispose();
  }

  /** demo 兜底：生成一次代码，无题头的 def 名就是闭包，有题头的记作 procedure 用来核对不重叠。 */
  const fromDemos = new Set<string>();
  const procedures = new Set<string>();
  const files = [
    ...fs.readdirSync('demos').filter((n: string) => n.endsWith('.json')).map((n: string) => `demos/${n}`),
    ...fs.readdirSync('demos/procedures').filter((n: string) => n.endsWith('.json')).map((n: string) => `demos/procedures/${n}`),
  ].filter((file: string) => {
    const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as { blocks?: unknown };
    return json.blocks !== undefined;
  });
  for (const file of files) {
    const demo = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(JSON.parse(fs.readFileSync(file, 'utf-8')), demo);
      const code = pythonGenerator.workspaceToCode(demo);
      for (const def of scanTopLevelDefs(code.split('\n'))) {
        if (isGeneratedProcedure(def.body)) procedures.add(def.signature.name);
        else fromDemos.add(def.signature.name);
      }
    } finally {
      demo.dispose();
    }
  }

  for (const name of fromDemos) if (procedures.has(name)) throw new Error(`闭包名与 procedure 名冲突：${name}`);
  const closures = [...new Set([...fromBlocks, ...fromRaw, ...fromDemos])].sort();
  return {
    generatedBy: 'scripts/ai-helper-closures.ts',
    closures,
    stats: {
      blockTypes: types.length,
      fromBlocks: fromBlocks.size,
      fromRaw: fromRaw.size,
      fromDemos: fromDemos.size,
      procedures: procedures.size,
    },
  };
}

async function main(): Promise<void> {
  const fs = await import('node:fs');
  const fresh = await collect();
  const serialized = `${JSON.stringify(fresh, null, 2)}\n`;

  if (process.argv[2] === 'check') {
    let previous: Payload;
    try {
      previous = JSON.parse(fs.readFileSync(RUNTIME, 'utf-8')) as Payload;
    } catch {
      console.error(`CLOSURE_CHECK 运行时产物缺失或不可读：${RUNTIME} → npm run reverse:closures`);
      return 1;
    }
    if (JSON.stringify(previous) !== JSON.stringify(fresh)) {
      console.error('CLOSURE_CHECK 运行时产物过期 → npm run reverse:closures');
      const before = new Set(previous.closures);
      const added = fresh.closures.filter((name) => !before.has(name));
      const removed = previous.closures.filter((name) => !fresh.closures.includes(name));
      for (const name of added.slice(0, 10)) console.error(`  + ${name}`);
      for (const name of removed.slice(0, 10)) console.error(`  - ${name}`);
      if (!added.length && !removed.length) console.error('  （名单相同，差异在 stats 字段）');
      return 1;
    }
    console.log(`CLOSURE_CHECK ok names=${fresh.closures.length}`);
    return 0;
  }

  fs.writeFileSync(RUNTIME, serialized);
  fs.mkdirSync('experiments/ai-helper-2026-11-14/out', { recursive: true });
  fs.writeFileSync(ARCHIVE, serialized);
  const { stats } = fresh;
  console.log(
    `CLOSURE_WRITE ${RUNTIME} + ${ARCHIVE}\n` +
      `CLOSURE_SUMMARY block_types=${stats.blockTypes} names=${fresh.closures.length} from_blocks=${stats.fromBlocks} from_raw=${stats.fromRaw} from_demos=${stats.fromDemos} procedures=${stats.procedures}`,
  );
  return 0;
}

process.exitCode = await main();
