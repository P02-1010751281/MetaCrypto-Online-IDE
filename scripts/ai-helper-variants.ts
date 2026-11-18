/**
 * 字段敏感度扫描（用户侧 AI Helper · A/B 线 P1.1）
 *
 * 目的：确定每个块的「哪些字段会改变生成代码」，从而回答两个问题：
 *   1. 反向解析时哪些字段可以从代码里回填（可见字段）；
 *   2. 哪些字段永远回填不了（不可见字段），必须排除在等价判据之外。
 *
 * 做法是差分：先采默认模板，再逐个字段翻转取值重新采集，模板变了就说明该字段可见。
 * 下拉字段顺带把每个选项各采一份，形成「变体表」——这解决的正是 ML-KEM 里
 * ETA=2 生成 sample_poly_cbd_eta2 而默认模板是 eta3 导致整条语句判不出的问题。
 *
 * 字段类型判定必须用 instanceof，不能用 constructor.name：vite 打包会把类名压缩掉，
 * 用名字判断会让 TextInput/Number 字段全部落进「未知类型」而被误记为不可见。
 *
 * 产物（同一份内容写两处）：
 *   - 运行时：src/services/ai-helper/reverse/field-templates.json（浏览器按需 ?raw 载入）
 *   - 存档：experiments/ai-helper-2026-11-14/out/field-templates.json
 * 用法：
 *   npm run reverse:templates                 # 重新采集并落两处产物
 *   npm run reverse:templates:check           # 只重算不落盘：与运行时产物逐字段比对，过期即失败
 *   单块排查：npm run verify:build && node dist-verify/ai-helper-variants.js <块类型>...
 *
 * 说明：本脚本只读 src/，check 档进 verify:all；采样档不参与门禁（改产物要显式跑）。
 */
import { JSDOM } from 'jsdom';

const VALUE_PLACEHOLDER = 'zzsigv_';
const STATEMENT_PLACEHOLDER = 'zzsigs_';
const FIELD_PLACEHOLDER = 'zzfield_';
/** 每个块最多采多少组合模板：目前最大的组合积只有 10，超限说明该块不适合全枚举。 */
const COMBO_LIMIT = 64;

interface GeneratorLike {
  forBlock: Record<string, (block: unknown) => unknown>;
  definitions_: Record<string, unknown>;
  valueToCode: (block: unknown, name: string) => string;
  statementToCode: (block: unknown, name: string) => string;
  init: (workspace: unknown) => void;
}

interface FieldLike {
  name?: string;
  getValue?: () => unknown;
  getOptions?: (useCache?: boolean) => unknown;
}

interface BlockLike {
  type: string;
  inputList: Array<{ fieldRow: FieldLike[] }>;
  setFieldValue: (value: string, field: string) => void;
  getFieldValue: (field: string) => unknown;
  /** 连接能力：AST 路径要靠它判断一个块能不能当值/当语句接上去。 */
  outputConnection?: unknown;
  previousConnection?: unknown;
  nextConnection?: unknown;
}

type Globals = typeof globalThis & Record<string, unknown>;

type FieldKind = 'dropdown' | 'text' | 'number' | 'checkbox' | 'variable' | 'other';

interface FieldDescriptor {
  name: string;
  kind: FieldKind;
  defaultValue: string;
  /** 下拉字段的全部选项值（含当前值）。 */
  options: string[] | null;
}

interface CollectResult {
  template: string | null;
  error: string | null;
}

/** 单个字段的可见性结论。 */
interface FieldProbe {
  name: string;
  kind: FieldKind;
  /** 翻值后模板是否改变 —— 即该字段是否写进了代码。 */
  visible: boolean;
  /** 无法翻值（单选项下拉）时，该值由块类型强制决定。 */
  constant: boolean;
  /** 该字段在默认模板里对应的字面量（verbatim 才能做通配槽）。 */
  emittedDefault: string | null;
  /** 下拉字段的取值变体（同一块的多条可识别形态）。 */
  variants: Array<{ value: string; template: string }>;
  /** 无法枚举取值的可见字段：匹配用通配正则。 */
  wildcard: string | null;
  valueShape: 'number' | 'hex' | 'identifier' | 'text' | null;
}

/**
 * 组合探测：两个及以上可见下拉同时取非默认值时的模板。
 *
 * 单字段变体只覆盖「其余字段取默认值」的形态。`sponge_pad` 的 RATE（5 档）与 SUFFIX
 * （2 档）各自都有变体，但 RATE=1344 × SUFFIX=0x1F 这个组合没有模板，平台自己生成的代码
 * 反解析时整条语句判不出，还会连锁出几十条诊断（RESULTS §36）。
 */
export interface FieldCombo {
  /** 只记与默认值不同的字段，避免把默认值写进两份结论。 */
  values: Record<string, string>;
  template: string;
}

/**
 * 块的连接能力。采集时从真实块对象读，而不是从代码猜：AST 路径把一个调用翻成块时，
 * 必须知道该块能不能接值、能不能进语句链，否则 `workspaces.load` 会在连接阶段报错。
 */
interface BlockIo {
  /** 有输出连接：可以放在值输入里。 */
  output: boolean;
  /** 有前驱连接：可以接在别的语句后面。 */
  previous: boolean;
  /** 有后继连接：后面还能挂语句。 */
  next: boolean;
}

interface BlockFieldTemplate {
  type: string;
  template: string | null;
  error: string | null;
  io: BlockIo;
  fields: FieldDescriptor[];
  probes: FieldProbe[];
  /** 多字段同时翻值的组合模板；单字段能表达的组合不重复记。 */
  combos: FieldCombo[];
  /** 翻值后模板不变：代码里没有该字段的痕迹。 */
  invisible: string[];
  /** 单选项下拉：值由块类型决定，无需回填也无需比较。 */
  constant: string[];
  /** 探测值被字段校验器拒绝，无法判定可见性。 */
  unprobed: string[];
  /** 可见字段换成 zzfield_<NAME> 后的匹配模板。 */
  fieldized: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 文本类取值的几种固定变换：布尔字段会把 TRUE 写成 True。 */
function valueForms(value: string): string[] {
  const title = value.length ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
  return [...new Set([value, value.toLowerCase(), title])];
}

/**
 * 找出「把默认模板逐字变成变体模板」的替换规则。只有精确重现才算成立：
 * 一个字段可能在模板里出现多次（如 bit 在 `<< 0` 与 `(32 - 0)` 各出现一次），
 * 用最长公共前后缀取差异段会把两次出现之间的整段代码误当成字段值。
 */
function buildSubstitution(
  base: string,
  alt: string,
  defaultValue: string,
  value: string,
): { emittedDefault: string; shape: 'number' | 'hex' | 'identifier' | 'text' } | null {
  const rules: Array<{ shape: 'number' | 'hex' | 'identifier' | 'text'; wrap: (text: string) => RegExp }> = [
    { shape: 'number', wrap: (text) => new RegExp(`(?<![\\w.])${escapeRegExp(text)}(?![\\w.])`, 'g') },
    { shape: 'hex', wrap: (text) => new RegExp(`(?<![\\w.])${escapeRegExp(text)}(?![\\w.])`, 'g') },
    { shape: 'identifier', wrap: (text) => new RegExp(`(?<![\\w])${escapeRegExp(text)}(?![\\w])`, 'g') },
    { shape: 'text', wrap: (text) => new RegExp(escapeRegExp(text), 'g') },
  ];
  for (const form of valueForms(value)) {
    for (const shape of ['number', 'hex', 'identifier', 'text'] as const) {
      const rule = rules.find((item) => item.shape === shape);
      if (!rule) continue;
      for (const defaultForm of valueForms(defaultValue)) {
        if (!defaultForm) continue;
        const replaced = base.replace(rule.wrap(defaultForm), form);
        if (replaced === alt) return { emittedDefault: defaultForm, shape };
      }
    }
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface PayloadComparable {
  stats: unknown;
  collisions: unknown;
  blocks: Array<{ type: string }>;
}

type FsLike = { readFileSync: (file: string, encoding: string) => string };

/**
 * 新鲜度判据：忽略 generatedAt，把重算结果与运行时产物逐字段比对。
 *
 * 为什么不用 mtime：产物在克隆/检出/打包时会被重写成「检出时间」，mtime 既可能漏报
 * （检出比块源码新）也可能误报；而重算一次只要 ~8 s，远小于误判代价。
 * stats 由 blocks 派生但仍单独比一次：它决定 FIELD_SUMMARY 那行数字是否可信。
 */
function compareWithRuntime(runtimePath: string, fresh: PayloadComparable, fs: FsLike): number {
  let previous: PayloadComparable;
  try {
    previous = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as PayloadComparable;
  } catch {
    console.error(`FIELD_CHECK 运行时产物缺失或不可读：${runtimePath} → npm run reverse:templates`);
    return 1;
  }
  const differences: string[] = [];
  const before = new Map(previous.blocks.map((block) => [block.type, block]));
  for (const block of fresh.blocks) {
    const earlier = before.get(block.type);
    if (!earlier) {
      differences.push(`${block.type}：运行时产物里没有这一块`);
      continue;
    }
    before.delete(block.type);
    if (JSON.stringify(earlier) !== JSON.stringify(block)) {
      differences.push(`${block.type}：模板或字段结论变了`);
    }
  }
  for (const type of before.keys()) differences.push(`${type}：块已不存在`);
  for (const key of ['stats', 'collisions'] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(fresh[key])) differences.push(`${key}：汇总不一致`);
  }
  if (differences.length) {
    console.error(`FIELD_CHECK 运行时产物过期（${differences.length} 处差异）→ npm run reverse:templates`);
    for (const line of differences.slice(0, 20)) console.error(`  ${line}`);
    return 1;
  }
  console.log(`FIELD_CHECK ok blocks=${fresh.blocks.length}`);
  return 0;
}

async function main(): Promise<void> {
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

  const { ALL_BLOCK_TYPES } = await import('@/blocks');
  await import('@/generators/python');
  const { pythonGenerator } = await import('blockly/python');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const FieldTextInput = (Blockly as unknown as { FieldTextInput: new (...a: unknown[]) => object }).FieldTextInput;
  const FieldNumber = (Blockly as unknown as { FieldNumber: new (...a: unknown[]) => object }).FieldNumber;
  const FieldVariable = (Blockly as unknown as { FieldVariable: new (...a: unknown[]) => object }).FieldVariable;
  const FieldCheckbox = (Blockly as unknown as { FieldCheckbox: new (...a: unknown[]) => object }).FieldCheckbox;

  const kindOf = (field: FieldLike): FieldKind => {
    const target = field as unknown as object;
    if (FieldVariable && target instanceof FieldVariable) return 'variable';
    if (FieldNumber && target instanceof FieldNumber) return 'number';
    if (FieldCheckbox && target instanceof FieldCheckbox) return 'checkbox';
    if (FieldTextInput && target instanceof FieldTextInput) return 'text';
    if (typeof field.getOptions === 'function') return 'dropdown';
    return 'other';
  };

  const pythonGen = pythonGenerator as unknown as GeneratorLike;
  const workspace = new Blockly.Workspace() as unknown as {
    getVariableMap: () => { createVariable: (n: string, t: string, id?: string) => unknown };
    newBlock: (type: string) => BlockLike;
    dispose: () => void;
  };
  workspace.getVariableMap().createVariable('scan_var', '', 'scan_var_id');

  /** 每次采集前重置生成器：nameDB_ 会为重复函数名加后缀，必须干净重来。 */
  const collect = (block: BlockLike): CollectResult => {
    pythonGen.init(workspace);
    pythonGen.definitions_ = {};
    const originalValue = pythonGen.valueToCode.bind(pythonGen);
    const originalStatement = pythonGen.statementToCode.bind(pythonGen);
    pythonGen.valueToCode = (_b: unknown, name: string) => `${VALUE_PLACEHOLDER}${name || 'anon'}`;
    pythonGen.statementToCode = (_b: unknown, name: string) => `${STATEMENT_PLACEHOLDER}${name || 'anon'}`;
    try {
      const emit = pythonGen.forBlock[block.type];
      if (typeof emit !== 'function') return { template: null, error: 'no-generator' };
      const raw = emit(block);
      if (typeof raw === 'string') return { template: raw, error: null };
      if (Array.isArray(raw) && typeof raw[0] === 'string') return { template: raw[0], error: null };
      return { template: null, error: 'no-code-returned' };
    } catch (error) {
      return { template: null, error: errorMessage(error) };
    } finally {
      pythonGen.valueToCode = originalValue;
      pythonGen.statementToCode = originalStatement;
      pythonGen.definitions_ = {};
    }
  };

  const makeBlock = (type: string): BlockLike => {
    const block = workspace.newBlock(type);
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (typeof field.name !== 'string' || !field.name) continue;
        // 变量字段指向探测变量；空文本字段默认空串会让生成器抛「must be a variable
        // name」，先填合法标识符，让每个块至少能量到形态。
        const current = field.getValue?.();
        const replacement = kindOf(field) === 'variable' ? 'scan_var_id' : kindOf(field) === 'text' && current === '' ? 'scan_out' : null;
        if (replacement === null) continue;
        try {
          block.setFieldValue(replacement, field.name);
        } catch {
          // 不接受该取值就保持默认，错误会在 collect 里记录
        }
      }
    }
    return block;
  };

  const describeFields = (block: BlockLike): FieldDescriptor[] => {
    const fields: FieldDescriptor[] = [];
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (typeof field.name !== 'string' || !field.name) continue;
        let options: string[] | null = null;
        try {
          const raw = field.getOptions?.(true);
          if (Array.isArray(raw) && raw.every((entry) => Array.isArray(entry))) {
            options = raw.map((entry) => String((entry as unknown[])[1]));
          }
        } catch {
          options = null;
        }
        fields.push({
          name: field.name,
          kind: kindOf(field),
          defaultValue: String(field.getValue?.() ?? ''),
          options,
        });
      }
    }
    return fields;
  };

  /** 给一个字段挑探测取值：下拉枚举全部其他选项，文本/数字给两个差异较大的候选。 */
  const probeValues = (field: FieldDescriptor): string[] => {
    if (field.kind === 'dropdown' && field.options && field.options.length > 1) {
      return field.options.filter((option) => option !== field.defaultValue);
    }
    if (field.kind === 'number') {
      const base = Number(field.defaultValue);
      return [String(Number.isFinite(base) ? base + 1 : 1)];
    }
    if (field.kind === 'text') {
      const numeric = /^-?\d+$/.test(field.defaultValue.trim());
      return numeric ? ['7', '12345'] : ['probe_a', 'probe_b'];
    }
    if (field.kind === 'checkbox') return [field.defaultValue === 'TRUE' ? 'FALSE' : 'TRUE'];
    return [];
  };

  /**
   * 组合探测：可见下拉做笛卡尔积。单字段变体只覆盖「其余字段取默认值」的形态，
   * 两个字段同时取非默认值时模板没人采过——`sponge_pad` 的 RATE=1344 × SUFFIX=0x1F
   * 就是这样，平台自己生成的代码反解析会对整条语句判不出（RESULTS §36）。
   * 只采差异 ≥2 个的组合：差异 1 个的已经是单字段变体。
   */
  const probeCombos = (
    block: BlockLike,
    fields: FieldDescriptor[],
    probes: FieldProbe[],
    base: CollectResult,
  ): FieldCombo[] => {
    const enumerable = probes.filter(
      (probe) => probe.kind === 'dropdown' && probe.visible && probe.variants.length > 0,
    );
    if (enumerable.length < 2) return [];
    const axes = enumerable.map((probe) => {
      const descriptor = fields.find((field) => field.name === probe.name);
      return [descriptor?.defaultValue ?? probe.variants[0].value, ...probe.variants.map((variant) => variant.value)];
    });
    const product = axes.reduce<string[][]>(
      (prefixes, axis) => prefixes.flatMap((prefix) => axis.map((value) => [...prefix, value])),
      [[]],
    );
    if (product.length > COMBO_LIMIT) return [];
    const restore = (): void => {
      enumerable.forEach((probe, index) => {
        try {
          block.setFieldValue(axes[index][0], probe.name);
        } catch {
          // 字段约束拒绝复原：组合已采到的照常返回，后续字段探测按当前值继续。
        }
      });
    };
    const combos: FieldCombo[] = [];
    try {
      for (const values of product) {
        if (values.filter((value, index) => value !== axes[index][0]).length < 2) continue;
        try {
          enumerable.forEach((probe, index) => block.setFieldValue(values[index], probe.name));
        } catch {
          continue;
        }
        const applied = enumerable.every(
          (probe, index) => String(block.getFieldValue(probe.name) ?? '') === values[index],
        );
        if (!applied) continue;
        const alt = collect(block);
        if (alt.template === null || alt.template === base.template) continue;
        const record: Record<string, string> = {};
        enumerable.forEach((probe, index) => {
          if (values[index] !== axes[index][0]) record[probe.name] = values[index];
        });
        combos.push({ values: record, template: alt.template });
      }
    } finally {
      restore();
    }
    return combos;
  };

  const argv = process.argv.slice(2);
  // `check` 是子命令而不是块类型：它要采全量，不接受类型清单。
  const checkMode = argv[0] === 'check';
  const targets = checkMode ? [] : argv;
  const types = targets.length ? targets : [...ALL_BLOCK_TYPES].sort();
  const results: BlockFieldTemplate[] = [];

  Blockly.Events.disable();
  try {
    for (const type of types) {
      const block = makeBlock(type);
      const base = collect(block);
      const fields = describeFields(block);
      const probes: FieldProbe[] = [];
      const invisible: string[] = [];
      const constant: string[] = [];
      const unprobed: string[] = [];

      for (const field of fields) {
        // 变量字段的取值是变量 id，代码里出现的是变量名；变量名由工作区决定，
        // 不属于「字段可见性」范畴，交给反解析器按标识符处理。
        if (field.kind === 'variable') continue;
        if (field.kind === 'dropdown' && field.options && field.options.length === 1) {
          constant.push(field.name);
          probes.push({
            name: field.name,
            kind: field.kind,
            visible: false,
            constant: true,
            emittedDefault: null,
            variants: [],
            wildcard: null,
            valueShape: null,
          });
          continue;
        }
        const values = probeValues(field);
        if (!values.length) {
          invisible.push(field.name);
          continue;
        }
        const variants: Array<{ value: string; template: string }> = [];
        let emittedDefault: string | null = null;
        let wildcard: string | null = null;
        let valueShape: FieldProbe['valueShape'] = null;
        let acceptedAny = false;
        for (const value of values) {
          try {
            block.setFieldValue(value, field.name);
          } catch {
            continue;
          }
          // 校验器可能静默拒绝探测值（如十六进制字段），此时不能据此判定「不可见」。
          if (String(block.getFieldValue(field.name) ?? '') !== value) continue;
          acceptedAny = true;
          const alt = collect(block);
          if (alt.template === null) continue;
          if (base.template !== null && base.template === alt.template) continue;
          const isDropdown = field.kind === 'dropdown' && field.options !== null;
          if (isDropdown) {
            variants.push({ value, template: alt.template as string });
          }
          if (base.template !== null && emittedDefault === null && !isDropdown) {
            // 只有能逐字重现变体模板的替换规则才被采用，避免多值字段取错差异段。
            const substitution = buildSubstitution(base.template, alt.template as string, field.defaultValue, value);
            if (substitution) {
              emittedDefault = substitution.emittedDefault;
              valueShape = substitution.shape;
              wildcard =
                substitution.shape === 'number' ? '-?\\d+'
                  : substitution.shape === 'hex' ? '0[xX][0-9a-fA-F]+'
                    : substitution.shape === 'identifier' ? '[A-Za-z_]\\w*'
                      : '\\S+';
            }
          }
        }
        // 复原默认值，避免影响后续字段的探测
        try {
          block.setFieldValue(field.defaultValue, field.name);
        } catch {
          // 回不到默认值说明该块定义了约束，后续探测按当前值继续
        }
        const visible = variants.length > 0 || wildcard !== null;
        if (!visible) {
          if (acceptedAny) invisible.push(field.name);
          else unprobed.push(field.name);
          continue;
        }
        probes.push({ name: field.name, kind: field.kind, visible, constant: false, emittedDefault, variants, wildcard, valueShape });
      }

      const combos = probeCombos(block, fields, probes, base);

      // 组装可匹配模板：可见的非下拉字段换成通配槽（其余字面量保持逐字匹配）。
      let fieldized = base.template;
      for (const probe of probes) {
        if (!fieldized || !probe.emittedDefault || probe.wildcard === null) continue;
        const index = fieldized.indexOf(probe.emittedDefault);
        if (index < 0) continue;
        const token = `${FIELD_PLACEHOLDER}${probe.name}`;
        fieldized = `${fieldized.slice(0, index)}${token}${fieldized.slice(index + probe.emittedDefault.length)}`;
      }

      results.push({
        type,
        template: base.template,
        error: base.error,
        io: {
          output: Boolean(block.outputConnection),
          previous: Boolean(block.previousConnection),
          next: Boolean(block.nextConnection),
        },
        fields,
        probes,
        combos,
        invisible,
        constant,
        unprobed,
        fieldized,
      });
    }
  } finally {
    Blockly.Events.enable();
    pythonGen.definitions_ = {};
    workspace.dispose();
  }

  // 变体模板与默认模板一起，构成「同一块的多条可识别形态」；用它复查歧义。
  const allTemplates = new Map<string, string[]>();
  const addTemplate = (template: string | null, type: string): void => {
    if (!template) return;
    const list = allTemplates.get(template) ?? [];
    if (!list.includes(type)) list.push(type);
    allTemplates.set(template, list);
  };
  for (const item of results) {
    addTemplate(item.template, item.type);
    for (const probe of item.probes) for (const variant of probe.variants) addTemplate(variant.template, item.type);
    for (const combo of item.combos) addTemplate(combo.template, item.type);
  }
  const collisions = [...allTemplates.entries()]
    .filter(([, typesWithTemplate]) => typesWithTemplate.length > 1)
    .map(([template, typesWithTemplate]) => ({ template, types: typesWithTemplate }));

  const stats = {
    blocks: results.length,
    withTemplate: results.filter((item) => item.template !== null).length,
    blocksWithVisibleFields: results.filter((item) => item.probes.some((probe) => probe.visible)).length,
    blocksWithVariants: results.filter((item) => item.probes.some((probe) => probe.variants.length > 0)).length,
    variantCount: results.reduce((sum, item) => sum + item.probes.reduce((n, probe) => n + probe.variants.length, 0), 0),
    blocksWithCombos: results.filter((item) => item.combos.length > 0).length,
    comboCount: results.reduce((sum, item) => sum + item.combos.length, 0),
    blocksWithWildcardFields: results.filter((item) => item.probes.some((probe) => probe.wildcard !== null)).length,
    blocksWithInvisibleFields: results.filter((item) => item.invisible.length > 0).length,
    invisibleFieldCount: results.reduce((sum, item) => sum + item.invisible.length, 0),
    unprobedFieldCount: results.reduce((sum, item) => sum + item.unprobed.length, 0),
    constantFieldCount: results.reduce((sum, item) => sum + item.constant.length, 0),
    collisionsAfterVariants: collisions.length,
    errors: results.filter((item) => item.template === null).length,
  };

  const archivePath = path.resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out/field-templates.json');
  const runtimePath = path.resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json');
  const debugPath = path.resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out/field-templates.debug.json');
  const payload = { generatedAt: new Date().toISOString(), stats, collisions, blocks: results };
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  if (checkMode) {
    process.exitCode = compareWithRuntime(runtimePath, payload, fs);
  } else if (targets.length) {
    // 单块排查只写调试副本。这里原来无条件覆盖两个发布产物：`ai-helper-variants.js sbox_variables_get`
    // 一次就把上表 224 块的 field-templates.json 换成只含 1 块的文件（2026-11-18 实测），
    // 运行时反解析会随之少掉几乎全部匹配器，且只有下一次 FIELD_CHECK 才报得出来。
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, text, 'utf-8');
    console.log(
      `FIELD_WRITE_DEBUG ${path.relative(process.cwd(), debugPath)}（只含点名的 ${results.length} 块，未覆盖发布产物）`,
    );
  } else {
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(archivePath, text, 'utf-8');
    fs.writeFileSync(runtimePath, text, 'utf-8');
    console.log(
      `FIELD_WRITE ${path.relative(process.cwd(), runtimePath)} + ${path.relative(process.cwd(), archivePath)}`,
    );
  }

  console.log(
    `FIELD_SUMMARY blocks=${stats.blocks} with_template=${stats.withTemplate} ` +
      `visible_field_blocks=${stats.blocksWithVisibleFields} variant_blocks=${stats.blocksWithVariants} ` +
      `variants=${stats.variantCount} wildcard_blocks=${stats.blocksWithWildcardFields} ` +
      `combo_blocks=${stats.blocksWithCombos} combos=${stats.comboCount} ` +
      `invisible_field_blocks=${stats.blocksWithInvisibleFields} invisible_fields=${stats.invisibleFieldCount} ` +
      `constant_fields=${stats.constantFieldCount} unprobed_fields=${stats.unprobedFieldCount} ` +
      `collisions_after_variants=${stats.collisionsAfterVariants} ` +
      `errors=${stats.errors}`,
  );
  if (targets.length) {
    for (const item of results.slice(0, 12)) {
      const visible = item.probes.filter((probe) => probe.visible).map((probe) => `${probe.name}${probe.variants.length ? `(${probe.variants.length}变体)` : '(*)'}`);
      console.log(
        `${item.type}: fieldized=${JSON.stringify(item.fieldized)} visible=[${visible.join(',')}] ` +
          `invisible=[${item.invisible.join(',')}] constant=[${item.constant.join(',')}] unprobed=[${item.unprobed.join(',')}]`,
      );
    }
  }
  if (collisions.length) {
    const worst = collisions.slice(0, 5).map((entry) => `${entry.types.length}x{${entry.types.slice(0, 4).join(',')}}`).join(' ');
    console.log(`FIELD_COLLISIONS top: ${worst}`);
  }
}

void main();
