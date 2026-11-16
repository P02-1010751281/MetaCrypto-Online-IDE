/**
 * 代码 → 工作区：模板 → 段序列 → 匹配器（用户侧 AI Helper · A/B 线 P1.2）
 *
 * 浏览器可直接 import 的纯函数层：没有 fs / Blockly 依赖，只把采集器给的 FieldPayload
 * 读成「字面量与槽位交替」的段序列，再排出严格/宽松两档匹配器。
 * 关键约束：子块槽位的捕获必须在括号深度 0 才能被下一个字面量截断，`[\s\S]*?` 会在
 * 嵌套调用里切错（`arr_slice(gf2m_poly_xgcd(...), 0, 2)` 曾整段判成 UNRESOLVED）。
 */

const VALUE_PLACEHOLDER = 'zzsigv_';
const STATEMENT_PLACEHOLDER = 'zzsigs_';
const FIELD_PLACEHOLDER = 'zzfield_';
/** 采集器给「取值为空串的文本字段」写的占位符：它出现在模板里就说明那个位置是字段取值
 *  而不是固定字面量，必须当槽位捕获（ecc_load_curve_params 的 a/b/p 就是这样）。 */
const SCAN_FIELD = 'scan_out';
const SCAN_VARIABLE = 'scan_var_id';

interface FieldProbe {
  name: string;
  visible: boolean;
  constant: boolean;
  variants: Array<{ value: string; template: string }>;
  wildcard: string | null;
  emittedDefault: string | null;
  valueShape: string | null;
}

interface FieldDescriptor {
  name: string;
  kind: string;
  defaultValue: string;
  options: string[] | null;
}

export interface BlockFieldTemplate {
  type: string;
  template: string | null;
  fields: FieldDescriptor[];
  probes: FieldProbe[];
  /** 翻值后模板不变：代码里没有痕迹，不可回填。 */
  invisible: string[];
  /** 单选项下拉：值由块类型强制决定，无需比较。 */
  constant: string[];
}

export interface FieldPayload {
  blocks: BlockFieldTemplate[];
}

export type Segment = { kind: 'literal'; text: string } | { kind: 'child'; input: string } | { kind: 'field'; name: string };

export interface Matcher {
  type: string;
  literalChars: number;
  segments: Segment[];
  /** 模板占的行数：一个块可能一次吐出多行代码，行数就是块的边界。 */
  lineSpan: number;
  /** 布尔字面量被翻转的备选形态：默认形态优先，匹不上才用它。 */
  relaxed: boolean;
  /** 变体命中的字段取值（唯一时使用；不唯一为 null）。 */
  fields: Record<string, string> | null;
}

const TOKEN_RE = new RegExp(
  `(zzsigv_[A-Za-z0-9_]+|zzsigs_[A-Za-z0-9_]+|zzfield_[A-Za-z0-9_]+|${SCAN_VARIABLE}|${SCAN_FIELD})`,
);

/** 正则字面量转义（只用于把字段取值塞进 RegExp）。 */
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 模板 → 字面量与槽位交替的段序列。 */
function buildSegments(template: string): Segment[] {
  const source = template.replace(/\n$/, '');
  const segments: Segment[] = [];
  let rest = source;
  while (rest.length > 0) {
    const match = TOKEN_RE.exec(rest);
    if (!match) {
      segments.push({ kind: 'literal', text: rest });
      break;
    }
    if (match.index > 0) segments.push({ kind: 'literal', text: rest.slice(0, match.index) });
    const token = match[0];
    if (token.startsWith(VALUE_PLACEHOLDER)) segments.push({ kind: 'child', input: token.slice(VALUE_PLACEHOLDER.length) });
    else if (token.startsWith(STATEMENT_PLACEHOLDER)) segments.push({ kind: 'child', input: token.slice(STATEMENT_PLACEHOLDER.length) });
    else if (token.startsWith(FIELD_PLACEHOLDER)) segments.push({ kind: 'field', name: token.slice(FIELD_PLACEHOLDER.length) });
    else segments.push({ kind: 'field', name: token });
    rest = rest.slice(match.index + token.length);
  }
  return segments;
}

function buildMatcher(
  type: string,
  segments: Segment[],
  fields: Record<string, string> | null,
  relaxed = false,
): Matcher {
  const literalChars = segments
    .filter((segment) => segment.kind === 'literal')
    .reduce((sum, segment) => sum + (segment as { text: string }).text.length, 0);
  const newlines = segments.reduce(
    (sum, segment) => sum + (segment.kind === 'literal' ? (segment.text.match(/\n/g)?.length ?? 0) : 0),
    0,
  );
  return { type, literalChars, segments, lineSpan: newlines + 1, relaxed, fields };
}

/** 生成器按「某个输入有没有接上」决定吐 True/False（sm9_sign 第 5 参即如此，采集器只测
 *  得到默认形态）。这类字面量是同一块代码的两种互斥形态，故补一份翻转模板；默认优先。 */
function booleanVariants(segments: Segment[]): Segment[][] {
  const sites: Array<{ segment: number; offset: number; text: string }> = [];
  segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== 'literal') return;
    const pattern = /(?<![A-Za-z0-9_"'])True(?![A-Za-z0-9_"'])|(?<![A-Za-z0-9_"'])False(?![A-Za-z0-9_"'])/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(segment.text))) sites.push({ segment: segmentIndex, offset: match.index, text: match[0] });
  });
  if (!sites.length || sites.length > 3) return [];
  const variants: Segment[][] = [];
  for (let mask = 1; mask < 1 << sites.length; mask += 1) {
    const copy = segments.map((segment) => (segment.kind === 'literal' ? { ...segment } : segment));
    // 从右往左替换：True/False 长度不同，左边先换会让右边的偏移失效。
    const chosen = sites.filter((_, bit) => mask & (1 << bit)).reverse();
    for (const site of chosen) {
      const target = copy[site.segment] as { kind: 'literal'; text: string };
      target.text = target.text.slice(0, site.offset) + (site.text === 'True' ? 'False' : 'True') + target.text.slice(site.offset + site.text.length);
    }
    variants.push(copy);
  }
  return variants;
}

export const OPENERS = '([{';
export const CLOSERS = ')]}';

/**
 * 按括号深度扫描：子块槽位的捕获必须在深度 0 才允许被下一个字面量截断。
 * 直接用 `[\s\S]*?` 会在嵌套调用里切错（arr_slice(gf2m_poly_xgcd(...), 0, 2) 就是
 * 这样在 P1.2 首跑时整段判成 UNRESOLVED 的）。
 */
export function matchSegments(source: string, segments: Segment[]): string[] | null {
  const captures: string[] = [];
  let pos = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'literal') {
      if (!source.startsWith(segment.text, pos)) return null;
      pos += segment.text.length;
      continue;
    }
    if (segment.kind === 'field') {
      const match = /^[\w.+-]+/.exec(source.slice(pos));
      if (!match) return null;
      captures.push(match[0]);
      pos += match[0].length;
      continue;
    }
    // 子块槽位：找到下一个字面量在「深度 0」的首次出现。
    const next = segments.slice(index + 1).find((item) => item.kind === 'literal') as { text: string } | undefined;
    if (!next) {
      captures.push(source.slice(pos));
      pos = source.length;
      continue;
    }
    let depth = 0;
    let quote = '';
    let found = -1;
    for (let cursor = pos; cursor < source.length; cursor += 1) {
      const ch = source[cursor];
      if (quote) {
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (depth === 0 && source.startsWith(next.text, cursor)) {
        found = cursor;
        break;
      }
      if (OPENERS.includes(ch)) depth += 1;
      else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    }
    if (found < 0) return null;
    captures.push(source.slice(pos, found));
    pos = found;
  }
  return pos === source.length ? captures : null;
}

/** 把字段字面量换成 zzfield_ 槽（数字/标识符按词边界，避免 0 命中 0xFFFFFFFF）。 */
function fieldizeTemplate(template: string, emitted: string, shape: string, name: string): string {
  const token = `${FIELD_PLACEHOLDER}${name}`;
  if (shape === 'number' || shape === 'hex' || shape === 'identifier') {
    const boundary = shape === 'identifier' ? '(?<![\\w])' : '(?<![\\w.])';
    const tail = shape === 'identifier' ? '(?![\\w])' : '(?![\\w.])';
    return template.replace(new RegExp(`${boundary}${escaped(emitted)}${tail}`, 'g'), token);
  }
  return template.split(emitted).join(token);
}

/**
 * 采集器把「取值为空的文本字段」写成 scan_out；模板里每个占位符对应块自己声明的一个
 * text 字段。占位符个数与字段个数一致时按声明顺序还原字段名（ecc_multiply 的 times
 * 因此能回填；对 invisible 字段无所谓，仍保持同名捕获）。
 */
function nameScanFields(segments: Segment[], block: BlockFieldTemplate): Segment[] {
  const placeholders = segments.filter((segment) => segment.kind === 'field' && segment.name === SCAN_FIELD);
  const textFields = block.fields.filter((field) => field.kind === 'text');
  if (!placeholders.length || placeholders.length !== textFields.length) return segments;
  let cursor = 0;
  return segments.map((segment) =>
    segment.kind === 'field' && segment.name === SCAN_FIELD
      ? { kind: 'field', name: textFields[cursor++].name }
      : segment,
  );
}

export function buildMatchers(payload: FieldPayload): Matcher[] {
  const strict: Matcher[] = [];
  const relaxed: Matcher[] = [];
  const byKey = new Map<string, Matcher>();
  const keyOf = (matcher: Matcher): string =>
    `${matcher.type}\u0000${matcher.segments.map((segment) => (segment.kind === 'literal' ? segment.text : `\u0001${segment.kind}${segment.kind === 'child' ? segment.input : segment.name}`)).join('')}`;
  const add = (matcher: Matcher): void => {
    const key = keyOf(matcher);
    const existing = byKey.get(key);
    if (existing) {
      // 同一块同一形态由不同字段取值产生：字段不唯一，不能凭变体回填。
      existing.fields = null;
      return;
    }
    byKey.set(key, matcher);
    (matcher.relaxed ? relaxed : strict).push(matcher);
  };
  for (const block of payload.blocks) {
    if (!block.template) continue;
    // 默认模板是在字段取默认值时采到的，命中它即可推定这些字段等于默认值。
    const defaults: Record<string, string> = {};
    const defaultsByName = new Map(block.fields.map((field) => [field.name, field.defaultValue]));
    for (const probe of block.probes) {
      if (!probe.variants.length) continue;
      const defaultValue = defaultsByName.get(probe.name);
      if (defaultValue !== undefined) defaults[probe.name] = defaultValue;
    }
    const segments = nameScanFields(buildSegments(block.template), block);
    add(buildMatcher(block.type, segments, { ...defaults }));
    for (const variant of booleanVariants(segments)) {
      add(buildMatcher(block.type, variant, { ...defaults }, true));
    }
    for (const probe of block.probes) {
      for (const variant of probe.variants) {
        add(buildMatcher(block.type, nameScanFields(buildSegments(variant.template), block), { ...defaults, [probe.name]: variant.value }));
      }
    }
    // 通配槽版本负责「字段取值无法枚举」的块；纯槽模板（data_value）无字面量骨架，不参与匹配。
    let fieldized = block.template;
    for (const probe of block.probes) {
      if (!probe.wildcard || !probe.emittedDefault) continue;
      fieldized = fieldizeTemplate(fieldized, probe.emittedDefault, probe.valueShape ?? 'text', probe.name);
    }
    if (fieldized !== block.template) add(buildMatcher(block.type, nameScanFields(buildSegments(fieldized), block), null));
  }
  const order = (a: Matcher, b: Matcher): number => b.literalChars - a.literalChars;
  return [...strict.sort(order), ...relaxed.sort(order)];
}
