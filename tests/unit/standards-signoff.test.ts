/**
 * A 线人签核的纯逻辑：记录、撤销、漂移识别、导出。
 *
 * 这里守的是四件「看起来对但会害人」的事：
 *   1. 同一条款只保留一条记录（签核是对当前状态的决定，不是流水账）；
 *   2. 产物重生成后条款变了，旧签核必须变成 stale，不能继续显示成「已签核」；
 *   3. 没有签核人就不许记录——没有人签核的记录不是签核；
 *   4. 导出件自带两枚指纹（导出时 / 记录时），别人拿到能核对它绑的是哪一版数据。
 */
import { describe, expect, it } from 'vitest';

import {
  buildSignoffExport,
  clauseFingerprint,
  clauseSignoffState,
  indexFingerprint,
  loadOperator,
  loadSignoffBook,
  recordDecision,
  revokeDecision,
  saveOperator,
  saveSignoffBook,
  summarizeSignoff,
  type SignoffBook,
  type StorageLike,
} from '@/services/ai-helper/signoff';
import type { ClauseVerdict, VerdictsIndex } from '@/services/ai-helper/verdicts';

const clause = (overrides: Partial<ClauseVerdict> = {}): ClauseVerdict => ({
  clauseId: '02-Formatting',
  entryPath: 'docs/standards/sp800-38c-ccm/00-Standard-Source.md',
  title: 'CCM Formatting',
  standardPosition: '§6.1',
  tier: 'partial',
  tierReason: 'mixed-steps',
  evidenceLayer: 'L1',
  anchors: [{ section: '6.1', click: { doc: 'docs/standards/sp800-38c-ccm/00-Standard-Source.md', line_start: 592, line_end: 644 } }],
  steps: [
    { id: 's1', text: 'B0 构造', blocks: ['ccm_b0'], visibility: 'canvas' },
    { id: 's2', text: 'AAD 拼接', blocks: ['ccm_cbc_mac'], visibility: 'internal' },
  ],
  stepCounts: { total: 2, canvas: 1, internal: 1, none: 0 },
  gaps: ['AAD 正文拼接在闭包里'],
  semantic_equivalence: 'unverified',
  ...overrides,
});

const INDEX: VerdictsIndex = {
  schemaVersion: 1,
  generatedBy: 'scripts/build-verdicts-index.mjs',
  generatedFrom: [
    { path: 'experiments/a.json', sha256: 'aaa', standardId: 'x', counts: { clauses: 1, build: 0, partial: 1, missing: 0, gaps: 1 } },
    { path: 'experiments/b.json', sha256: 'bbb', standardId: 'y', counts: { clauses: 1, build: 0, partial: 1, missing: 0, gaps: 1 } },
  ],
  totals: { standards: 1, clauses: 2, build: 0, partial: 2, missing: 0, gaps: 2 },
  standards: [
    {
      schemaVersion: 1,
      standard: { id: 'sp800-38c-ccm', name: 'NIST SP 800-38C' },
      inputs: {},
      counts: { clauses: 2, build: 0, partial: 2, missing: 0, gaps: 2 },
      clauses: [clause(), clause({ clauseId: '03-CBC-MAC', title: 'CCM CBC-MAC' })],
    },
  ],
};

const emptyBook = (): SignoffBook => ({ schemaVersion: 1, indexFingerprint: '', records: [] });

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

describe('签核记录', () => {
  it('记录一条签核，绑定当时的数据指纹与签核人', () => {
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: ' 张三 ',
      note: '  已核对 B0 构造 ',
      at: '2026-11-19T06:00:00.000Z',
      indexFingerprint: 'idx-1',
    });
    expect(book.indexFingerprint).toBe('idx-1');
    expect(book.records).toHaveLength(1);
    expect(book.records[0]).toMatchObject({
      standardId: 'sp800-38c-ccm',
      clauseId: '02-Formatting',
      decision: 'signed',
      operator: '张三',
      note: '已核对 B0 构造',
      at: '2026-11-19T06:00:00.000Z',
      fingerprint: clauseFingerprint(clause()),
    });
  });

  it('同一条款再签一次只保留最新一条（不是流水账）', () => {
    const first = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'rejected',
      operator: '李四',
      at: '2026-11-19T06:00:00.000Z',
      indexFingerprint: 'idx-1',
    });
    const second = recordDecision(first, {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: '张三',
      at: '2026-11-19T07:00:00.000Z',
      indexFingerprint: 'idx-1',
    });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({ decision: 'signed', operator: '张三' });
  });

  it('没有签核人时拒绝记录（空白也算没有）', () => {
    expect(() =>
      recordDecision(emptyBook(), {
        standardId: 'sp800-38c-ccm',
        clause: clause(),
        decision: 'signed',
        operator: '   ',
        indexFingerprint: 'idx-1',
      }),
    ).toThrowError(/签核人/);
  });

  it('撤销后回到没有记录', () => {
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    const after = revokeDecision(book, 'sp800-38c-ccm', '02-Formatting');
    expect(after.records).toEqual([]);
    expect(clauseSignoffState(after, 'sp800-38c-ccm', clause()).status).toBe('none');
  });
});

describe('数据漂移', () => {
  it('条款内容变了 → 旧签核变 stale，但仍带原记录（能看出谁在什么时候签的）', () => {
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    const drifted = clause({ gaps: ['AAD 正文拼接在闭包里', '零填充未表达'] });
    const state = clauseSignoffState(book, 'sp800-38c-ccm', drifted);
    expect(state.status).toBe('stale');
    expect(state.record?.operator).toBe('张三');
  });

  it('档位或步骤数变化同样算漂移（不只比 gaps）', () => {
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    expect(clauseSignoffState(book, 'sp800-38c-ccm', clause({ tier: 'build' })).status).toBe('stale');
    expect(
      clauseSignoffState(book, 'sp800-38c-ccm', clause({ steps: [clause().steps[0]] })).status,
    ).toBe('stale');
  });

  it('索引指纹与源文件顺序无关（排序后拼接）', () => {
    const reordered: VerdictsIndex = { ...INDEX, generatedFrom: [...INDEX.generatedFrom].reverse() };
    expect(indexFingerprint(reordered)).toBe(indexFingerprint(INDEX));
  });
});

describe('汇总', () => {
  it('签核 / 拒签 / 过期 / 待签核分别计数', () => {
    const standard = INDEX.standards[0];
    let book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: standard.clauses[0],
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    book = recordDecision(book, {
      standardId: 'sp800-38c-ccm',
      clause: { ...standard.clauses[1], gaps: ['漂移过了'] },
      decision: 'rejected',
      operator: '李四',
      indexFingerprint: 'idx-1',
    });
    expect(summarizeSignoff(book, standard)).toEqual({ signed: 1, rejected: 0, stale: 1, pending: 0 });

    const clean = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: standard.clauses[0],
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    expect(summarizeSignoff(clean, standard)).toEqual({ signed: 1, rejected: 0, stale: 0, pending: 1 });
  });
});

describe('持久化', () => {
  it('保存后能原样读回，签核人记忆独立于记录', () => {
    const storage = memoryStorage();
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause(),
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    saveSignoffBook(book, storage);
    saveOperator('张三', storage);
    expect(loadSignoffBook(storage)).toEqual({ book });
    expect(loadOperator(storage)).toBe('张三');
  });

  it('存储为空时返回空记录，不报错', () => {
    expect(loadSignoffBook(memoryStorage())).toEqual({ book: { schemaVersion: 1, indexFingerprint: '', records: [] } });
  });

  it('坏 JSON / 坏 schema 报错并退回空记录（不静默吞掉）', () => {
    const storage = memoryStorage();
    storage.setItem('ciphercat:standards-signoff:v1', '{oops');
    const broken = loadSignoffBook(storage);
    expect(broken.book.records).toEqual([]);
    expect(broken.error).toMatch(/JSON/);

    storage.setItem('ciphercat:standards-signoff:v1', JSON.stringify({ schemaVersion: 9, records: [] }));
    expect(loadSignoffBook(storage).error).toMatch(/schema/);
  });

  it('逐条丢弃字段不全的记录，保留合法项', () => {
    const storage = memoryStorage();
    storage.setItem(
      'ciphercat:standards-signoff:v1',
      JSON.stringify({
        schemaVersion: 1,
        indexFingerprint: 'idx-1',
        records: [
          { standardId: 'a', clauseId: 'c', decision: 'signed', operator: '张三', at: 't', fingerprint: 'f' },
          { standardId: 'a', clauseId: 'c2', decision: 'weird' },
          { clauseId: 'c3' },
        ],
      }),
    );
    const loaded = loadSignoffBook(storage);
    expect(loaded.book.records).toHaveLength(1);
    expect(loaded.book.records[0].clauseId).toBe('c');
  });

  it('localStorage 不可用（null）时读写都不抛错', () => {
    expect(() => saveSignoffBook(emptyBook(), null)).not.toThrow();
    expect(loadSignoffBook(null).book.records).toEqual([]);
    expect(loadOperator(null)).toBe('');
  });
});

describe('导出', () => {
  it('自带两枚指纹并逐条标注是否仍匹配', () => {
    const standard = INDEX.standards[0];
    let book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: standard.clauses[0],
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-recording',
    });
    book = recordDecision(book, {
      standardId: 'sp800-38c-ccm',
      clause: { ...standard.clauses[1], gaps: ['后来变了'] },
      decision: 'rejected',
      operator: '李四',
      indexFingerprint: 'idx-recording',
    });
    const payload = buildSignoffExport(book, INDEX, '2026-11-19T08:00:00.000Z');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.exportedAt).toBe('2026-11-19T08:00:00.000Z');
    expect(payload.recordedIndexFingerprint).toBe('idx-recording');
    expect(payload.indexFingerprint).toBe(indexFingerprint(INDEX));
    expect(payload.records).toHaveLength(2);
    const [first, second] = payload.records;
    expect(first).toMatchObject({ clauseId: '02-Formatting', fingerprintMatches: true, standardName: 'NIST SP 800-38C' });
    expect(second).toMatchObject({ clauseId: '03-CBC-MAC', fingerprintMatches: false });
    expect(second.currentFingerprint).not.toBe(second.fingerprint);
  });

  it('索引里已不存在的条款不进导出（不导出孤儿记录）', () => {
    const book = recordDecision(emptyBook(), {
      standardId: 'sp800-38c-ccm',
      clause: clause({ clauseId: '99-Removed' }),
      decision: 'signed',
      operator: '张三',
      indexFingerprint: 'idx-1',
    });
    expect(buildSignoffExport(book, INDEX).records).toEqual([]);
  });
});
