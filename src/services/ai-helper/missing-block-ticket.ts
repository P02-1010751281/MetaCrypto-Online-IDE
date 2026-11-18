/**
 * 缺块回流 ticket（用户侧 AI Helper · 共享数据面 · channel 1「后台提醒」）
 *
 * 触发：A/B 线在用户操作里检出「现有块类型表达不了」。落点是维护者线的本地收件箱
 * （`experiments/ai-helper-2026-11-14/inbox/*.json`），不阻断用户、不弹窗；面板只读计数。
 * 远端自动工单（channel 2）需要服务与凭据，本模块只定义结构、不实现上报。
 *
 * 一条 ticket 必须自带维护者能动手的证据（见 proposals/PARALLEL-EXECUTION.md §4.2）：
 *   缺失语义的一句话 / 来源（标准锚点、参考代码 file:line、用户原文）/ 期望的块签名 /
 *   最小复现 / 来源哈希。缺任何一项都不是 ticket，只是「我觉得缺个块」。
 *
 * 去重键 = 语义标签 + 来源哈希（§4.3）。**来源哈希不是整文件 sha256**：整文件哈希会让
 * 每次无关编辑都生成一条新 ticket，而证据原文的哈希钉住的是「缺失构造本身」。哈希输入是
 * `kind|locator|规范化原文`，其中 locator 对 code-ref 只取文件（不取行号，行会漂），
 * 对 standard-anchor 取条款锚点，对 user-snippet 取调用方给的标签。
 *
 * 合并语义：重复项保留**已有**的 status 与 createdAt —— 已经 shipped 的 ticket 不会因为
 * 用户又触发一次就退回 open。
 *
 * 本模块只读字符串、不读文件系统、不依赖 DOM / Node API，因此浏览器与 Node 脚本共用。
 */

export const TICKET_SCHEMA_VERSION = 1;

export const TICKET_STATUSES = ['open', 'accepted', 'rejected', 'shipped'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const SOURCE_KINDS = ['standard-anchor', 'code-ref', 'user-snippet'] as const;
export type TicketSourceKind = (typeof SOURCE_KINDS)[number];

export const REPRODUCTION_KINDS = ['workspace', 'code', 'none'] as const;
export type ReproductionKind = (typeof REPRODUCTION_KINDS)[number];

/** 端口类型标签沿用块契约里的写法（`Bytes` / `IntList` / `Number` …），空数组表示不限。 */
export interface PortSpec {
  name: string;
  types: string[];
}

export interface ExpectedBlock {
  name: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** 期望生成的代码形态（一句话）。没有它维护者不知道该出 Python 还是 JS 的什么形状。 */
  codeShape: string;
}

export interface TicketSource {
  kind: TicketSourceKind;
  /** 证据原文（证据行 / 条款摘录 / 用户片段）。 */
  excerpt: string;
  /** `kind|locator|规范化原文` 的 sha256（64 位小写十六进制），由调用方计算。 */
  hash: string;
  /** standard-anchor 用：条款锚点，如 `FIPS 203 §5.1 Algorithm 13`。 */
  anchor?: string;
  /** code-ref 用：仓库内相对路径。 */
  file?: string;
  /** code-ref 用：证据所在行（人类可读定位，不进入去重键）。 */
  line?: number;
}

export interface Reproduction {
  kind: ReproductionKind;
  /** 最小工作区 / 代码片段的路径或标识。 */
  locator?: string;
  /** 行数很小、值得内联进 ticket 的片段。 */
  content?: string;
  note?: string;
}

export interface TicketDraft {
  semanticTag: string;
  summary: string;
  source: TicketSource;
  expectedBlock: ExpectedBlock;
  reproduction: Reproduction;
  /** 测试可注入；省略时用当前时间。 */
  createdAt?: string;
}

export interface MissingBlockTicket {
  schemaVersion: typeof TICKET_SCHEMA_VERSION;
  /** `语义标签@来源哈希`，同时是收件箱文件名与去重键。 */
  id: string;
  status: TicketStatus;
  createdAt: string;
  semanticTag: string;
  summary: string;
  source: TicketSource;
  expectedBlock: ExpectedBlock;
  reproduction: Reproduction;
}

export type TicketProblemCode =
  | 'tag-empty'
  | 'tag-invalid'
  | 'summary-empty'
  | 'summary-too-long'
  | 'source-kind-invalid'
  | 'source-excerpt-empty'
  | 'source-hash-invalid'
  | 'source-anchor-empty'
  | 'source-file-empty'
  | 'source-line-invalid'
  | 'expected-name-empty'
  | 'expected-code-shape-empty'
  | 'reproduction-kind-invalid'
  | 'reproduction-locator-empty'
  | 'schema-version-unsupported'
  | 'status-invalid'
  | 'id-mismatch'
  | 'not-an-object';

export interface TicketProblem {
  code: TicketProblemCode;
  field: string;
  message: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_LIMIT = 200;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 证据原文规范化：折叠连续空白、去掉首尾空白。用于哈希输入，不用于展示。 */
export function normalizeEvidence(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** 语义标签规范化：小写、空白与下划线成 `-`、折叠重复 `-`；不做同义改写。 */
export function normalizeSemanticTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

/** 去重键：`语义标签@来源哈希`。 */
export function ticketId(semanticTag: string, sourceHash: string): string {
  return `${normalizeSemanticTag(semanticTag)}@${sourceHash}`;
}

function validateTag(tag: string, problems: TicketProblem[]): void {
  if (!tag) {
    problems.push({ code: 'tag-empty', field: 'semanticTag', message: '语义标签不能为空' });
    return;
  }
  if (!TAG_PATTERN.test(tag)) {
    problems.push({
      code: 'tag-invalid',
      field: 'semanticTag',
      message: `语义标签必须是 kebab-case（实际 ${JSON.stringify(tag)}）`,
    });
  }
}

function validateSource(source: TicketSource | undefined, problems: TicketProblem[]): void {
  if (!isObject(source)) {
    problems.push({ code: 'source-kind-invalid', field: 'source', message: '缺少来源' });
    return;
  }
  if (!SOURCE_KINDS.includes(source.kind as TicketSourceKind)) {
    problems.push({
      code: 'source-kind-invalid',
      field: 'source.kind',
      message: `来源类型必须是 ${SOURCE_KINDS.join(' / ')}（实际 ${String(source.kind)}）`,
    });
  }
  if (!normalizeEvidence(String(source.excerpt ?? ''))) {
    problems.push({ code: 'source-excerpt-empty', field: 'source.excerpt', message: '证据原文不能为空' });
  }
  if (!HASH_PATTERN.test(String(source.hash ?? ''))) {
    problems.push({
      code: 'source-hash-invalid',
      field: 'source.hash',
      message: '来源哈希必须是 64 位小写十六进制 sha256',
    });
  }
  if (source.kind === 'standard-anchor' && !String(source.anchor ?? '').trim()) {
    problems.push({ code: 'source-anchor-empty', field: 'source.anchor', message: '标准锚点来源必须给 anchor' });
  }
  if (source.kind === 'code-ref') {
    if (!String(source.file ?? '').trim()) {
      problems.push({ code: 'source-file-empty', field: 'source.file', message: '代码来源必须给 file' });
    }
    if (source.line !== undefined && (!Number.isInteger(source.line) || (source.line as number) < 1)) {
      problems.push({ code: 'source-line-invalid', field: 'source.line', message: '行号必须是正整数' });
    }
  }
}

function validateExpectedBlock(block: ExpectedBlock | undefined, problems: TicketProblem[]): void {
  if (!isObject(block)) {
    problems.push({ code: 'expected-name-empty', field: 'expectedBlock', message: '缺少期望块签名' });
    return;
  }
  const name = String(block.name ?? '').trim();
  if (!name) {
    problems.push({ code: 'expected-name-empty', field: 'expectedBlock.name', message: '期望块必须有名字' });
  }
  if (!String(block.codeShape ?? '').trim()) {
    problems.push({
      code: 'expected-code-shape-empty',
      field: 'expectedBlock.codeShape',
      message: '期望块必须写清代码形态（没有它维护者不知道该出什么代码）',
    });
  }
}

function validateReproduction(reproduction: Reproduction | undefined, problems: TicketProblem[]): void {
  if (!isObject(reproduction)) {
    problems.push({ code: 'reproduction-kind-invalid', field: 'reproduction', message: '缺少最小复现' });
    return;
  }
  if (!REPRODUCTION_KINDS.includes(reproduction.kind as ReproductionKind)) {
    problems.push({
      code: 'reproduction-kind-invalid',
      field: 'reproduction.kind',
      message: `复现类型必须是 ${REPRODUCTION_KINDS.join(' / ')}（实际 ${String(reproduction.kind)}）`,
    });
    return;
  }
  if (reproduction.kind !== 'none' && !String(reproduction.locator ?? '').trim() && !String(reproduction.content ?? '').trim()) {
    problems.push({
      code: 'reproduction-locator-empty',
      field: 'reproduction.locator',
      message: '复现类型不是 none 时必须给 locator 或内联 content',
    });
  }
}

/** 校验 draft（build 之前与 parse 之后共用）。返回空数组表示可以入库。 */
export function validateDraft(draft: TicketDraft): TicketProblem[] {
  const problems: TicketProblem[] = [];
  if (!isObject(draft)) {
    return [{ code: 'not-an-object', field: '', message: 'ticket 必须是对象' }];
  }
  // 先规范化再校验：`Unsupported_Pointer` 这类写法规范后就是合法标签，不该被拒；
  // 规范化后仍不合法（含非法字符、空）才拒绝。
  validateTag(typeof draft.semanticTag === 'string' ? normalizeSemanticTag(draft.semanticTag) : '', problems);
  const summary = String(draft.summary ?? '').trim();
  if (!summary) {
    problems.push({ code: 'summary-empty', field: 'summary', message: '缺失语义的一句话不能为空' });
  } else if (summary.length > SUMMARY_LIMIT) {
    problems.push({
      code: 'summary-too-long',
      field: 'summary',
      message: `summary 超过 ${SUMMARY_LIMIT} 字（实际 ${summary.length}）`,
    });
  }
  validateSource(draft.source, problems);
  validateExpectedBlock(draft.expectedBlock, problems);
  validateReproduction(draft.reproduction, problems);
  return problems;
}

function formatProblem(problem: TicketProblem): string {
  return `${problem.code} @ ${problem.field || '(root)'}: ${problem.message}`;
}

/**
 * 构造 ticket。校验不过直接抛错（把全部问题一次列出来），不返回半成品——
 * 收件箱里不允许出现缺证据的条目。
 */
export function buildTicket(draft: TicketDraft): MissingBlockTicket {
  const problems = validateDraft(draft);
  if (problems.length) {
    throw new Error(`缺块 ticket 不合规：\n${problems.map(formatProblem).join('\n')}`);
  }
  const semanticTag = normalizeSemanticTag(draft.semanticTag);
  const source: TicketSource = {
    kind: draft.source.kind,
    excerpt: draft.source.excerpt.trim(),
    hash: draft.source.hash,
  };
  if (draft.source.anchor !== undefined) source.anchor = draft.source.anchor.trim();
  if (draft.source.file !== undefined) source.file = draft.source.file.trim();
  if (draft.source.line !== undefined) source.line = draft.source.line;

  return {
    schemaVersion: TICKET_SCHEMA_VERSION,
    id: ticketId(semanticTag, source.hash),
    status: 'open',
    createdAt: draft.createdAt ?? new Date().toISOString(),
    semanticTag,
    summary: draft.summary.trim(),
    source,
    expectedBlock: {
      name: draft.expectedBlock.name.trim(),
      inputs: draft.expectedBlock.inputs.map((port) => ({ name: port.name.trim(), types: [...port.types] })),
      outputs: draft.expectedBlock.outputs.map((port) => ({ name: port.name.trim(), types: [...port.types] })),
      codeShape: draft.expectedBlock.codeShape.trim(),
    },
    reproduction: {
      kind: draft.reproduction.kind,
      ...(draft.reproduction.locator !== undefined ? { locator: draft.reproduction.locator.trim() } : {}),
      ...(draft.reproduction.content !== undefined ? { content: draft.reproduction.content } : {}),
      ...(draft.reproduction.note !== undefined ? { note: draft.reproduction.note.trim() } : {}),
    },
  };
}

/** 已有收件箱 + 新到达的 ticket 合并；重复项保留已有状态，不覆盖。 */
export interface MergeResult {
  tickets: MissingBlockTicket[];
  added: string[];
  duplicates: string[];
}

export function mergeTickets(existing: MissingBlockTicket[], incoming: MissingBlockTicket[]): MergeResult {
  const byId = new Map<string, MissingBlockTicket>();
  for (const ticket of existing) {
    if (!byId.has(ticket.id)) byId.set(ticket.id, ticket);
  }
  const added: string[] = [];
  const duplicates: string[] = [];
  for (const ticket of incoming) {
    if (byId.has(ticket.id)) {
      duplicates.push(ticket.id);
      continue;
    }
    byId.set(ticket.id, ticket);
    added.push(ticket.id);
  }
  return {
    tickets: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    added,
    duplicates,
  };
}

export interface InboxSummary {
  total: number;
  open: number;
  byStatus: Record<TicketStatus, number>;
  byTag: Record<string, number>;
}

/** 面板计数用：只读统计，不改任何条目。 */
export function summarizeInbox(tickets: MissingBlockTicket[]): InboxSummary {
  const byStatus: Record<TicketStatus, number> = { open: 0, accepted: 0, rejected: 0, shipped: 0 };
  const byTag: Record<string, number> = {};
  for (const ticket of tickets) {
    byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;
    byTag[ticket.semanticTag] = (byTag[ticket.semanticTag] ?? 0) + 1;
  }
  return { total: tickets.length, open: byStatus.open, byStatus, byTag };
}

/**
 * 稳定序列化：键序固定、2 空格缩进、末尾换行。收件箱要进 git，同一条 ticket
 * 反复生成必须逐字节相同，否则 diff 会一直被污染。
 */
export function serializeTicket(ticket: MissingBlockTicket): string {
  const ordered = {
    schemaVersion: ticket.schemaVersion,
    id: ticket.id,
    status: ticket.status,
    createdAt: ticket.createdAt,
    semanticTag: ticket.semanticTag,
    summary: ticket.summary,
    source: {
      kind: ticket.source.kind,
      ...(ticket.source.anchor !== undefined ? { anchor: ticket.source.anchor } : {}),
      ...(ticket.source.file !== undefined ? { file: ticket.source.file } : {}),
      ...(ticket.source.line !== undefined ? { line: ticket.source.line } : {}),
      excerpt: ticket.source.excerpt,
      hash: ticket.source.hash,
    },
    expectedBlock: {
      name: ticket.expectedBlock.name,
      inputs: ticket.expectedBlock.inputs.map((port) => ({ name: port.name, types: port.types })),
      outputs: ticket.expectedBlock.outputs.map((port) => ({ name: port.name, types: port.types })),
      codeShape: ticket.expectedBlock.codeShape,
    },
    reproduction: {
      kind: ticket.reproduction.kind,
      ...(ticket.reproduction.locator !== undefined ? { locator: ticket.reproduction.locator } : {}),
      ...(ticket.reproduction.content !== undefined ? { content: ticket.reproduction.content } : {}),
      ...(ticket.reproduction.note !== undefined ? { note: ticket.reproduction.note } : {}),
    },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export type ParseResult = { ok: true; ticket: MissingBlockTicket } | { ok: false; problems: TicketProblem[] };

/** 读回归档的 ticket（收件箱文件）。schemaVersion 与 id 都要自洽。 */
export function parseTicket(raw: unknown): ParseResult {
  if (!isObject(raw)) {
    return { ok: false, problems: [{ code: 'not-an-object', field: '', message: 'ticket 必须是对象' }] };
  }
  const problems: TicketProblem[] = [];
  if (raw.schemaVersion !== TICKET_SCHEMA_VERSION) {
    problems.push({
      code: 'schema-version-unsupported',
      field: 'schemaVersion',
      message: `只支持 schemaVersion=${TICKET_SCHEMA_VERSION}（实际 ${String(raw.schemaVersion)}）`,
    });
  }
  if (!TICKET_STATUSES.includes(raw.status as TicketStatus)) {
    problems.push({
      code: 'status-invalid',
      field: 'status',
      message: `status 必须是 ${TICKET_STATUSES.join(' / ')}（实际 ${String(raw.status)}）`,
    });
  }
  const draft = raw as unknown as TicketDraft;
  problems.push(...validateDraft(draft));
  if (!problems.length) {
    const expectedId = ticketId(draft.semanticTag, draft.source.hash);
    if (raw.id !== expectedId) {
      problems.push({
        code: 'id-mismatch',
        field: 'id',
        message: `id 必须等于「语义标签@来源哈希」（期望 ${expectedId}，实际 ${String(raw.id)}）`,
      });
    }
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    ticket: {
      schemaVersion: TICKET_SCHEMA_VERSION,
      id: raw.id as string,
      status: raw.status as TicketStatus,
      createdAt: String(raw.createdAt ?? ''),
      semanticTag: normalizeSemanticTag(draft.semanticTag),
      summary: String(draft.summary).trim(),
      source: draft.source,
      expectedBlock: draft.expectedBlock,
      reproduction: draft.reproduction,
    },
  };
}
