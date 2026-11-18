// @vitest-environment node
/**
 * 缺块回流 ticket 的回归基线（用户侧 AI Helper · channel 1 数据面）。
 *
 * 这一组用例守的是「ticket 必须自带证据」这条线：§4.2 要求的五件事（一句话、来源、
 * 期望块签名、最小复现、来源哈希）缺任何一项都必须被拒，且拒绝理由要能指到字段。
 *
 * 另外三条不是格式检查，是行为约定：
 *  1. 去重键 = 语义标签 + 来源哈希；标签规范化后相同即同一张票（`Preprocessor` 与
 *     `preprocessor` 不能各存一份）。
 *  2. 合并重复项时**保留已有状态**——已经 shipped 的票不会因为用户又触发一次退回 open。
 *  3. 序列化必须稳定：同一条 ticket 反复生成要逐字节相同，否则收件箱进 git 后 diff 一直脏。
 */
import { describe, expect, it } from 'vitest';
import {
  buildTicket,
  mergeTickets,
  normalizeEvidence,
  normalizeSemanticTag,
  parseTicket,
  serializeTicket,
  summarizeInbox,
  ticketId,
  validateDraft,
} from '@/services/ai-helper/missing-block-ticket';
import type { MissingBlockTicket, TicketDraft, TicketProblemCode } from '@/services/ai-helper/missing-block-ticket';

const HASH = 'a1'.repeat(32);

function goodDraft(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    semanticTag: 'unsupported-pointer',
    summary: 'kokke-shiftrows:11 不支持指针参数（state_t*）',
    source: {
      kind: 'code-ref',
      file: 'experiments/ai-helper-2026-11-14/p3/samples/kokke-shiftrows.c',
      line: 11,
      excerpt: 'static void ShiftRows(state_t* state)',
      hash: HASH,
    },
    expectedBlock: {
      name: 'pointer_param_ref',
      inputs: [{ name: 'TARGET', types: ['Bytes'] }],
      outputs: [],
      codeShape: '形参是指向定长数组的指针、函数体整段被吸收时按原地改写传参',
    },
    reproduction: { kind: 'code', locator: 'experiments/ai-helper-2026-11-14/p3/samples/kokke-shiftrows.c' },
    createdAt: '2026-11-18T00:00:00.000Z',
    ...overrides,
  };
}

function codesOf(draft: TicketDraft): TicketProblemCode[] {
  return validateDraft(draft).map((problem) => problem.code);
}

describe('缺块 ticket：证据必填', () => {
  it('合规 draft 构造出 open 票，id = 标签@来源哈希', () => {
    const ticket = buildTicket(goodDraft());
    expect(ticket.schemaVersion).toBe(1);
    expect(ticket.status).toBe('open');
    expect(ticket.id).toBe(ticketId('unsupported-pointer', HASH));
    expect(ticket.createdAt).toBe('2026-11-18T00:00:00.000Z');
    expect(ticket.source.line).toBe(11);
  });

  it.each<[string, Partial<TicketDraft>, TicketProblemCode]>([
    ['空标签', { semanticTag: '' }, 'tag-empty'],
    ['非 kebab-case 标签', { semanticTag: 'Bad Tag!' }, 'tag-invalid'],
    ['空 summary', { summary: '   ' }, 'summary-empty'],
    ['summary 超长', { summary: 'x'.repeat(201) }, 'summary-too-long'],
    ['未知来源类型', { source: { kind: 'blog' as never, excerpt: 'x', hash: HASH } }, 'source-kind-invalid'],
    ['空证据原文', { source: { kind: 'user-snippet', excerpt: '  ', hash: HASH } }, 'source-excerpt-empty'],
    ['哈希不是 sha256', { source: { kind: 'user-snippet', excerpt: 'x', hash: 'deadbeef' } }, 'source-hash-invalid'],
    [
      '标准锚点缺 anchor',
      { source: { kind: 'standard-anchor', excerpt: 'FIPS 203 §5.1', hash: HASH } },
      'source-anchor-empty',
    ],
    ['代码来源缺 file', { source: { kind: 'code-ref', excerpt: 'x', hash: HASH, line: 3 } }, 'source-file-empty'],
    [
      '行号不是正整数',
      { source: { kind: 'code-ref', excerpt: 'x', hash: HASH, file: 'a.c', line: 0 } },
      'source-line-invalid',
    ],
    ['期望块没有名字', { expectedBlock: { name: ' ', inputs: [], outputs: [], codeShape: 'x' } }, 'expected-name-empty'],
    [
      '期望块没写代码形态',
      { expectedBlock: { name: 'b', inputs: [], outputs: [], codeShape: '   ' } },
      'expected-code-shape-empty',
    ],
    ['未知复现类型', { reproduction: { kind: 'zulip' as never } }, 'reproduction-kind-invalid'],
    ['复现既无 locator 也无 content', { reproduction: { kind: 'code' } }, 'reproduction-locator-empty'],
  ])('%s → %s', (_name, overrides, code) => {
    expect(codesOf(goodDraft(overrides))).toContain(code);
  });

  it('reproduction.kind = none 时不需要 locator（「最小复现暂缺」是允许的）', () => {
    expect(codesOf(goodDraft({ reproduction: { kind: 'none' } }))).toEqual([]);
  });

  it('buildTicket 一次列出全部问题，不返回半成品', () => {
    expect(() => buildTicket(goodDraft({ semanticTag: '', summary: '' }))).toThrow(/tag-empty[\s\S]*summary-empty/u);
  });
});

describe('缺块 ticket：去重与状态', () => {
  it('同标签 + 同来源哈希 → 视为同一张票；标签规范化后相同也算同一张', () => {
    const first = buildTicket(goodDraft());
    const second = buildTicket(goodDraft({ semanticTag: 'UNSUPPORTED_Pointer' }));
    expect(second.id).toBe(first.id);
    const merged = mergeTickets([first], [second]);
    expect(merged.added).toEqual([]);
    expect(merged.duplicates).toEqual([first.id]);
    expect(merged.tickets).toHaveLength(1);
  });

  it('来源哈希不同 → 新的一张票', () => {
    const first = buildTicket(goodDraft());
    const other = buildTicket(
      goodDraft({
        source: { kind: 'code-ref', file: 'experiments/ai-helper-2026-11-14/p3/samples/kokke-mixcolumns.c', line: 14, excerpt: 'static void MixColumns(state_t* state)', hash: 'b2'.repeat(32) },
      }),
    );
    const merged = mergeTickets([first], [other]);
    expect(merged.added).toEqual([other.id]);
    expect(merged.tickets).toHaveLength(2);
  });

  it('重复项保留已有状态与 createdAt：shipped 不会退回 open', () => {
    const shipped: MissingBlockTicket = { ...buildTicket(goodDraft()), status: 'shipped', createdAt: '2026-01-01T00:00:00.000Z' };
    const incoming = buildTicket(goodDraft({ createdAt: '2026-11-18T09:00:00.000Z' }));
    const merged = mergeTickets([shipped], [incoming]);
    expect(merged.tickets[0]).toBe(shipped);
    expect(merged.tickets[0].status).toBe('shipped');
    expect(merged.tickets[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('合并结果按 id 排序，与输入顺序无关', () => {
    const a = buildTicket(goodDraft({ semanticTag: 'zzz', source: { kind: 'code-ref', file: 'a.c', excerpt: 'a', hash: 'c3'.repeat(32) } }));
    const b = buildTicket(goodDraft({ semanticTag: 'aaa', source: { kind: 'code-ref', file: 'b.c', excerpt: 'b', hash: 'd4'.repeat(32) } }));
    expect(mergeTickets([a, b], []).tickets.map((ticket) => ticket.id)).toEqual(
      mergeTickets([b, a], []).tickets.map((ticket) => ticket.id),
    );
  });
});

describe('缺块 ticket：存档格式', () => {
  it('序列化与对象的键插入顺序无关（逐字节稳定）', () => {
    const ticket = buildTicket(goodDraft());
    const shuffled = Object.fromEntries(Object.entries(ticket).reverse()) as MissingBlockTicket;
    expect(serializeTicket(shuffled)).toBe(serializeTicket(ticket));
  });

  it('序列化 → 解析往返等价', () => {
    const ticket = buildTicket(goodDraft());
    const parsed = parseTicket(JSON.parse(serializeTicket(ticket)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.ticket).toEqual(ticket);
  });

  it('id 与「标签@哈希」不自洽 → 拒收', () => {
    const ticket = buildTicket(goodDraft());
    const parsed = parseTicket({ ...ticket, id: 'unsupported-pointer@deadbeef' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.map((p) => p.code)).toContain('id-mismatch');
  });

  it('schemaVersion 不认识 / status 不认识 → 拒收', () => {
    const ticket = buildTicket(goodDraft());
    const badVersion = parseTicket({ ...ticket, schemaVersion: 2 });
    const badStatus = parseTicket({ ...ticket, status: 'wontfix' });
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) expect(badVersion.problems.map((p) => p.code)).toContain('schema-version-unsupported');
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.problems.map((p) => p.code)).toContain('status-invalid');
  });

  it('非对象输入拒收而不抛错', () => {
    expect(parseTicket(null).ok).toBe(false);
    expect(parseTicket([1, 2, 3]).ok).toBe(false);
  });
});

describe('缺块 ticket：计数与规范化', () => {
  it('面板计数只读汇总，按状态与语义标签分别统计', () => {
    const open = buildTicket(goodDraft());
    const shipped = buildTicket(goodDraft({ source: { kind: 'user-snippet', excerpt: 'x', hash: 'e5'.repeat(32) } }));
    const summary = summarizeInbox([open, { ...shipped, status: 'shipped' }]);
    expect(summary.total).toBe(2);
    expect(summary.open).toBe(1);
    expect(summary.byStatus).toEqual({ open: 1, accepted: 0, rejected: 0, shipped: 1 });
    expect(summary.byTag).toEqual({ 'unsupported-pointer': 2 });
  });

  it('标签规范化：大小写、空白、下划线与重复连字符合并', () => {
    expect(normalizeSemanticTag('  Unsupported__Pointer  ')).toBe('unsupported-pointer');
    expect(normalizeSemanticTag('a - b')).toBe('a-b');
  });

  it('证据规范化：折叠空白并去首尾，用于哈希输入而不是展示', () => {
    expect(normalizeEvidence('  static void  ShiftRows(state_t* state)\n')).toBe('static void ShiftRows(state_t* state)');
  });
});
