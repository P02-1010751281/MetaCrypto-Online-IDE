/**
 * 代码 → 工作区 反解析（用户侧 AI Helper · A/B 线 P1.1）
 *
 * 用法：
 *   node dist-verify/ai-helper-roundtrip.js dump   demos/AES-Atomic-Round.json
 *   node dist-verify/ai-helper-roundtrip.js stats
 *   node dist-verify/ai-helper-roundtrip.js reverse          # 树 + 字段级比较
 *
 * P1 只能比「块类型多重集」，因为默认模板认不出字段变体（ML-KEM 的 ETA=2 就是
 * 被 sample_poly_cbd_eta3 的默认字面量挡住的）。P1.1 补两件东西：
 *   1. 模板变体表：同一块按下拉选项各采一份模板，命中变体即直接得到字段值；
 *   2. 字段通配槽：文本/数字字段在模板里的字面位置换成捕获组，命中即回填字段。
 * 有了字段，判据从「类型多重集相同」升级为「规范化后的树相同」。
 *
 * 规范化排除的东西（代码里不存在，永远无法回填）：块坐标、disabled、注释、
 * 折叠状态、变量 id。各块另有「翻值不影响模板」的不可见字段，见 field-templates.json。
 */
import { JSDOM } from 'jsdom';

import {
  buildMatchers,
  locateBlockCode,
  parseExpression,
  parseStatement,
  splitCode,
  splitStatementUnits,
} from './ai-helper-reverse';
import type { FieldPayload, Matcher, ParsedNode, StatementUnit } from './ai-helper-reverse';
import { checkTree, loadContract, mergeResults } from './ai-helper-contract';
import { gateParsedEquivalents } from './ai-helper-validate';

/** jsdom 接管 globalThis 的那几个入口（与 ai-helper-variants.ts / workspace-boot.ts 同形）。 */
type Globals = typeof globalThis & Record<string, unknown>;

/**
 * 真值子树块数（不含 next 链）。语句链本身是一个数组，逐根调用会把链重复计数，
 * ML-KEM-Encaps 曾因此报出 33538 个块（真实 1494）。
 */
function countTruth(node: TruthBlock): number {
  let total = 1;
  for (const value of Object.values(node.inputs ?? {})) {
    if (value?.block) total += countTruth(value.block);
  }
  return total;
}

function flattenTypes(node: ParsedNode, out: string[] = []): string[] {
  out.push(node.type);
  for (const child of node.children) flattenTypes(child.node, out);
  return out;
}

interface TruthBlock {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: TruthBlock }>;
  next?: { block?: TruthBlock };
}

interface CanonNode {
  type: string;
  fields: Record<string, string>;
  inputs: Record<string, CanonNode>;
}

const VOLATILE_FIELDS = new Set(['id', 'x', 'y', 'disabled']);
const SKIP_FIELD_KEYS = new Set(['id', 'type']);

/**
 * 真值 → 规范形：只保留语义字段，变量字段换成变量名，坐标与 id 一律丢掉。
 * demo JSON 里 VAR 只存 id，名字在工作区 variables 段，必须查表才有名字可比。
 */
function canonicalTruth(block: TruthBlock, invisible: Map<string, Set<string>>, variableNames: Map<string, string>): CanonNode {
  const fields: Record<string, string> = {};
  const hidden = invisible.get(block.type) ?? new Set<string>();
  for (const [key, value] of Object.entries(block.fields ?? {})) {
    if (VOLATILE_FIELDS.has(key) || hidden.has(key)) continue;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const name = typeof record.name === 'string' && record.name ? record.name : variableNames.get(id) ?? '';
      if (name) fields[key] = name;
      continue;
    }
    if (typeof value === 'string') fields[key] = value;
  }
  const inputs: Record<string, CanonNode> = {};
  for (const [key, value] of Object.entries(block.inputs ?? {})) {
    if (SKIP_FIELD_KEYS.has(key)) continue;
    if (value?.block) inputs[key] = canonicalTruth(value.block, invisible, variableNames);
  }
  return { type: block.type, fields, inputs };
}

function canonicalParsed(node: ParsedNode, invisible: Map<string, Set<string>>): CanonNode {
  const hidden = invisible.get(node.type) ?? new Set<string>();
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.fields)) {
    if (hidden.has(key)) continue;
    fields[key] = value;
  }
  const inputs: Record<string, CanonNode> = {};
  for (const child of node.children) inputs[child.input] = canonicalParsed(child.node, invisible);
  return { type: node.type, fields, inputs };
}

interface CompareResult {
  differences: string[];
  fieldsCompared: number;
  /** 真值有、反解析没有的字段（含不可见字段），逐条列出便于判断可信范围。 */
  unfilled: string[];
}

/**
 * 代码层面不可区分的块对：`math_number` 与 `data_value` 的数字模板逐字相同，
 * 生成代码里没有任何线索能分辨它们，只能记作等价类而不是解析失败。
 */
const EQUIVALENT_TYPES = new Map<string, Set<string>>([
  ['math_number', new Set(['data_value'])],
  ['data_value', new Set(['math_number'])],
]);

function compareCanon(truth: CanonNode, parsed: CanonNode, path: string, result: CompareResult): void {
  const equivalent = EQUIVALENT_TYPES.get(truth.type)?.has(parsed.type) ?? false;
  if (truth.type !== parsed.type && !equivalent) {
    result.differences.push(`${path}: 类型 ${parsed.type} ≠ ${truth.type}`);
    return;
  }
  for (const [key, value] of Object.entries(truth.fields)) {
    if (!(key in parsed.fields)) {
      result.unfilled.push(`${truth.type}.${key}`);
      continue;
    }
    result.fieldsCompared += 1;
    if (parsed.fields[key] !== value) {
      result.differences.push(`${path}.${truth.type}.${key}: ${JSON.stringify(parsed.fields[key])} ≠ ${JSON.stringify(value)}`);
    }
  }
  for (const [key, value] of Object.entries(truth.inputs)) {
    const child = parsed.inputs[key];
    if (!child) {
      result.differences.push(`${path}.${truth.type}[${key}]: 子块缺失（反解析得 ${Object.keys(parsed.inputs).join(',') || '无'}）`);
      continue;
    }
    compareCanon(value, child, `${path}.${truth.type}[${key}]`, result);
  }
  for (const key of Object.keys(parsed.inputs)) {
    if (!(key in truth.inputs)) result.differences.push(`${path}.${truth.type}[${key}]: 多出子块 ${parsed.inputs[key].type}`);
  }
}

/** 过程体：去缩进 → 剥生成器自动写的 docstring → 切语句单元；`return` 行是 RETURN 槽。 */
function procedureUnits(
  bodyLines: string[],
  matchers: Matcher[],
): { units: StatementUnit[]; returnExpr: string | null } {
  const indents = bodyLines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const lines: string[] = [];
  let inDoc = false;
  for (const raw of bodyLines) {
    const line = raw.slice(indent);
    const trimmed = line.trim();
    if (!inDoc && trimmed.startsWith('"""')) {
      inDoc = !trimmed.endsWith('"""') || trimmed.length <= 3;
      continue;
    }
    if (inDoc) {
      if (trimmed.endsWith('"""')) inDoc = false;
      continue;
    }
    lines.push(line);
  }
  const units = splitStatementUnits(lines.join('\n'), matchers);
  const last = units[units.length - 1];
  const returnMatch = last ? /^return\s+([\s\S]+)$/.exec(last.text) : null;
  if (returnMatch) units.pop();
  return { units, returnExpr: returnMatch ? returnMatch[1] : null };
}

async function bootBlockly(): Promise<{
  Blockly: { Workspace: new () => unknown; serialization: { workspaces: { load: (json: unknown, ws: unknown) => void } } };
  pythonGenerator: { workspaceToCode: (ws: unknown) => string };
}> {
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
  const enMsgs = await import('blockly/msg/en');
  setLocale(enMsgs);
  await import('blockly/blocks');
  await import('@/blocks');
  await import('@/generators/python');
  const { pythonGenerator } = await import('blockly/python');

  return {
    Blockly: Blockly as unknown as {
      Workspace: new () => unknown;
      serialization: { workspaces: { load: (json: unknown, ws: unknown) => void } };
    },
    pythonGenerator: pythonGenerator as unknown as { workspaceToCode: (ws: unknown) => string },
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'stats';
  const { Blockly, pythonGenerator } = await bootBlockly();
  const fs = await import('node:fs');
  const path = await import('node:path');

  const outDir = path.resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out');
  const fieldPayload = JSON.parse(fs.readFileSync(path.join(outDir, 'field-templates.json'), 'utf8')) as FieldPayload;
  const invisible = new Map<string, Set<string>>();
  for (const block of fieldPayload.blocks) {
    invisible.set(block.type, new Set([...block.invisible, ...block.constant]));
  }

  if (mode === 'dump') {
    const file = process.argv[3];
    if (!file) throw new Error('dump 需要 demo 文件路径');
    const json = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(json, workspace);
    console.log(pythonGenerator.workspaceToCode(workspace));
    return;
  }

  if (mode === 'vars') {
    const file = process.argv[3];
    if (!file) throw new Error('vars 需要 demo 文件路径');
    const json = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(json, workspace);
    const ws = workspace as unknown as {
      getVariableMap: () => { getAllVariables: () => Array<{ name: string; id: string }> };
    };
    const vars = ws.getVariableMap().getAllVariables() as unknown as Array<{ name?: string; id?: string }>;
    console.log(JSON.stringify(vars.map((item) => ({ name: item?.name, id: item?.id })), null, 2));
    return;
  }

  if (mode !== 'reverse' && mode !== 'negate' && mode !== 'types') {
    console.log('用法: node dist-verify/ai-helper-roundtrip.js reverse | negate | vars | dump <demo>');
    return;
  }

  const matchers = buildMatchers(fieldPayload);
  // --gate 是开关不是 demo 路径：不进 explicit，否则会被当成待读文件。
  const gate = process.argv.includes('--gate');
  const explicit = process.argv.slice(3).filter((arg) => arg !== '--gate');

  interface ProcedureCase { name: string; bodyRoots: TruthBlock[]; returnBlock: TruthBlock | null }

  /** 一个 demo 的完整往返材料：代码、语句单元、真值链、变量名表、过程体。 */
  interface DemoCase {
    code: string;
    statements: StatementUnit[];
    truthRoots: TruthBlock[];
    variableNames: Map<string, string>;
    bodies: Map<string, string[]>;
    closureDefs: number;
    procedures: ProcedureCase[];
  }

  /** 把 statement 输入里的块链展开成数组。 */
  const chainOf = (first: TruthBlock | undefined, sink: TruthBlock[]): void => {
    let cursor = first;
    while (cursor) {
      sink.push(cursor);
      cursor = cursor.next?.block;
    }
  };

  const prepare = (file: string): DemoCase => {
    const json = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')) as {
      blocks: { blocks: TruthBlock[] };
      variables?: Array<{ name?: string; id?: string }>;
    };
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(json, workspace);
    const code = pythonGenerator.workspaceToCode(workspace);
    const truthRoots: TruthBlock[] = [];
    const procedures: ProcedureCase[] = [];
    for (const root of json.blocks.blocks) {
      if (root.type === 'procedures_defreturn' || root.type === 'procedures_defnoreturn') {
        const bodyRoots: TruthBlock[] = [];
        chainOf(root.inputs?.STACK?.block, bodyRoots);
        procedures.push({
          name: String(root.fields?.name ?? root.fields?.NAME ?? ''),
          bodyRoots,
          returnBlock: root.inputs?.RETURN?.block ?? null,
        });
        continue;
      }
      chainOf(root, truthRoots);
    }
    const names = new Set(procedures.map((item) => item.name));
    // 生成器会为「已声明但未赋值」的变量补 `X = None` 前导，它不是块结构。
    const lines = code.split('\n').filter((line) => !/^[A-Za-z_]\w*\s*=\s*None$/.test(line));
    // 内嵌实现（import/模块常量/class/helper 函数）整块排在块代码之前：块代码是文件后缀。
    const blockStart = locateBlockCode(lines, matchers, names);
    const layout = splitCode(lines, blockStart, names);
    const statements = splitStatementUnits(layout.topLevel.join('\n'), matchers);
    // demo JSON 通常不存变量名（只有 id），名字是 Blockly 加载时建出来的；
    // 真值工作区就是名字的权威来源，直接查它。
    const variableNames = new Map<string, string>();
    const loaded = (workspace as unknown as {
      getVariableMap: () => { getAllVariables: () => Array<{ name?: string; id?: string }> };
    }).getVariableMap().getAllVariables();
    for (const variable of loaded) {
      if (variable?.id && variable?.name) variableNames.set(variable.id, variable.name);
    }
    return {
      code,
      statements,
      truthRoots,
      variableNames,
      bodies: layout.bodies,
      closureDefs: layout.closureDefs,
      procedures,
    };
  };

  // 把反解析结果 W' 交给类型检查：用来回答「解析错的工作区，是类型不自洽，还是错但自洽」。
  if (mode === 'types') {
    const contract = loadContract();
    const files = explicit.length
      ? explicit
      : [
          'demos/procedures/Multivariate-Math.json',
          'demos/procedures/Goppa-Decode.json',
          'demos/procedures/SM2-PointMul.json',
          'demos/procedures/SM9-Sign.json',
        ];
    for (const file of files) {
      const demo = prepare(file);
      const parsedNodes = demo.statements.map((statement) => parseStatement(statement.text, matchers));
      const perNode = parsedNodes.map((node) => checkTree(node as unknown as ParsedNode, contract));
      for (const procedure of demo.procedures) {
        const { units, returnExpr } = procedureUnits(demo.bodies.get(procedure.name) ?? [], matchers);
        for (const unit of units) perNode.push(checkTree(parseStatement(unit.text, matchers) as unknown as ParsedNode, contract));
        if (returnExpr) perNode.push(checkTree(parseExpression(returnExpr, matchers) as unknown as ParsedNode, contract));
      }
      const merged = mergeResults(perNode);
      const total = merged.checked + merged.unknown;
      const unknownRate = total ? (merged.unknown / total) : 0;
      console.log(
        `${file}: pairs_checked=${merged.checked} ok=${merged.ok} mismatch=${merged.mismatch} ` +
          `unknown=${merged.unknown} unknown_rate=${(unknownRate * 100).toFixed(1)}%`,
      );
      for (const finding of merged.findings.slice(0, 5)) {
        console.log(`    ${finding.path}: ${finding.child}(${finding.actual.join('|')}) 进 ${finding.input}(${finding.expected.join('|')})`);
      }
    }
    return;
  }

  // 阴性对照：故意改掉代码里的字段值与块类型，比较器必须报差异。
  // 只靠全绿证明不了判据有牙，必须证明它在该报错的时会报错。
  if (mode === 'negate') {
    const demo = prepare('demos/AES-Atomic-Round.json');
    const texts = demo.statements.map((unit) => unit.text);
    const cases: Array<{ name: string; statements: string[] }> = [
      { name: '字段值改动', statements: texts.map((line) => line.replace('[0x00,', '[0x01,')) },
      { name: '块类型改动', statements: texts.map((line) => line.replace('aes_sub_bytes(', 'aes_shift_rows(')) },
      { name: '子块改动', statements: texts.map((line) => line.replace('aes_add_round_key(i, j)', 'aes_add_round_key(i, i)')) },
    ];
    let fired = 0;
    for (const item of cases) {
      const result: CompareResult = { differences: [], fieldsCompared: 0, unfilled: [] };
      const nodes = item.statements.map((statement) => parseStatement(statement, matchers));
      for (let index = 0; index < Math.min(demo.truthRoots.length, nodes.length); index += 1) {
        compareCanon(
          canonicalTruth(demo.truthRoots[index], invisible, demo.variableNames),
          canonicalParsed(nodes[index], invisible),
          `#${index}`,
          result,
        );
      }
      const ok = result.differences.length > 0;
      if (ok) fired += 1;
      console.log(`NEGATE ${item.name}: diffs=${result.differences.length} ${ok ? 'FIRED' : 'SILENT(判据失效)'} ${result.differences[0] ?? ''}`);
    }
    console.log(`NEGATE_SUMMARY fired=${fired}/${cases.length}`);
    return;
  }

  // 允许显式指定 demo：node ... reverse demos/procedures/CCM-Encrypt.json
  const targets = explicit.length
    ? explicit
    : [
        'demos/AES-Atomic-Round.json',
        'demos/SM4-Atomic-Round.json',
        'demos/SHA256-Atomic-Hash.json',
        'demos/ML-KEM-Atomic.json',
      ];
  let passCount = 0;

  for (const file of targets) {
    const demo = prepare(file);
    const parsedNodes = demo.statements.map((statement) => parseStatement(statement.text, matchers));
    const gateRoots: ParsedNode[] = [...parsedNodes];
    const result: CompareResult = { differences: [], fieldsCompared: 0, unfilled: [] };
    if (demo.truthRoots.length !== parsedNodes.length) {
      result.differences.push(`顶层语句数 ${parsedNodes.length} ≠ 真值 ${demo.truthRoots.length}`);
    }
    const limit = Math.min(demo.truthRoots.length, parsedNodes.length);
    for (let index = 0; index < limit; index += 1) {
      compareCanon(
        canonicalTruth(demo.truthRoots[index], invisible, demo.variableNames),
        canonicalParsed(parsedNodes[index], invisible),
        `#${index}`,
        result,
      );
    }

    // procedure 体：CCM 这类 demo 的块全在 def 体内，只比顶层语句会得出「空集合相等」的假绿。
    let procedureBlocks = 0;
    for (const procedure of demo.procedures) {
      // defreturn 的 `return expr` 是 RETURN 子块，不是体内语句。
      const { units, returnExpr } = procedureUnits(demo.bodies.get(procedure.name) ?? [], matchers);
      const parsedBody = units.map((unit) => parseStatement(unit.text, matchers));
      gateRoots.push(...parsedBody);
      procedureBlocks += parsedBody.reduce((sum, node) => sum + flattenTypes(node).length, 0);
      if (parsedBody.length !== procedure.bodyRoots.length) {
        result.differences.push(`${procedure.name}: 体内语句 ${parsedBody.length} ≠ 真值 ${procedure.bodyRoots.length}`);
      }
      const bodyLimit = Math.min(procedure.bodyRoots.length, parsedBody.length);
      for (let index = 0; index < bodyLimit; index += 1) {
        compareCanon(
          canonicalTruth(procedure.bodyRoots[index], invisible, demo.variableNames),
          canonicalParsed(parsedBody[index], invisible),
          `${procedure.name}#${index}`,
          result,
        );
      }
      if (procedure.returnBlock) {
        if (!returnExpr) {
          result.differences.push(`${procedure.name}: 缺少 return`);
        } else {
          const returnNode = parseExpression(returnExpr, matchers);
          gateRoots.push(returnNode);
          procedureBlocks += flattenTypes(returnNode).length;
          compareCanon(
            canonicalTruth(procedure.returnBlock, invisible, demo.variableNames),
            canonicalParsed(returnNode, invisible),
            `${procedure.name}:return`,
            result,
          );
        }
      }
    }

    const parsedTypes = parsedNodes.flatMap((node) => flattenTypes(node));
    const truthProcedureBlocks = demo.procedures.reduce(
      (sum, procedure) => sum + procedure.bodyRoots.reduce((n, root) => n + countTruth(root), 0) +
        (procedure.returnBlock ? countTruth(procedure.returnBlock) : 0),
      0,
    );
    // 空集合上的相等不算通过：必须真的比过东西。
    const vacuous = parsedNodes.length + procedureBlocks === 0 || demo.truthRoots.length + truthProcedureBlocks === 0;
    const treeEqual = !vacuous && result.differences.length === 0;
    if (treeEqual) passCount += 1;
    const verdict = vacuous ? 'VACUOUS(无可比对象)' : String(treeEqual);
    console.log(
      `${file}: defs=${demo.closureDefs} statements=${parsedNodes.length} procs=${demo.procedures.length} ` +
        `parsed_blocks=${parsedTypes.length + procedureBlocks} truth_blocks=${demo.truthRoots.length + truthProcedureBlocks} ` +
        `tree_equal=${verdict} fields_compared=${result.fieldsCompared} ` +
        `fields_unfilled=${result.unfilled.length} diffs=${result.differences.length}`,
    );
    for (const difference of result.differences.slice(0, 10)) console.log(`    ${difference}`);
    const unfilledUnique = [...new Set(result.unfilled)];
    if (unfilledUnique.length) console.log(`    未回填字段: ${unfilledUnique.slice(0, 10).join(', ')}`);
    if (process.env.DEBUG_RT === '1') {
      demo.statements.forEach((statement, index) => {
        console.log(`    STMT ${JSON.stringify(statement.text).slice(0, 80)} -> ${flattenTypes(parsedNodes[index]).join('|')}`);
      });
      for (const procedure of demo.procedures) {
        for (const unit of procedureUnits(demo.bodies.get(procedure.name) ?? [], matchers).units) {
          console.log(`    UNIT ${JSON.stringify(unit.text).slice(0, 70)} -> ${flattenTypes(parseStatement(unit.text, matchers)).join('|')}`);
        }
      }
    }
    if (gate && gateParsedEquivalents(file, gateRoots)) process.exitCode = 1;
  }
  console.log(`ROUNDTRIP_SUMMARY demos=${targets.length} tree_equal=${passCount}/${targets.length}`);
}

void main();
