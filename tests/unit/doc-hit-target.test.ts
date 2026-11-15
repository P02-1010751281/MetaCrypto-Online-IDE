import { describe, expect, it } from 'vitest';
import { planDocHit } from '@/services/ai-helper/doc-hit-target';
import type { DocHit } from '@/services/ai-helper/doc-search';

function hit(overrides: Partial<DocHit> = {}): DocHit {
  return {
    path: 'docs/blocks/numtheory.md',
    title: '数论',
    heading: '数论',
    line: 78,
    score: 1,
    excerpt: '',
    kind: 'md',
    terms: [],
    ...overrides,
  };
}

describe('检索结果 → 目标界面', () => {
  it('Markdown 命中拼成带行号的文档深链（路径补前导斜杠并转义）', () => {
    const plan = planDocHit(hit(), '/editor/1');
    expect(plan.kind).toBe('navigate');
    if (plan.kind !== 'navigate') return;
    expect(plan.href).toBe('/editor/1#/docs?doc=%2Fdocs%2Fblocks%2Fnumtheory.md&line=78');
  });

  it('已带前导斜杠的路径不重复加斜杠', () => {
    const plan = planDocHit(hit({ path: '/docs/guides/ARCHITECTURE.md' }), '/#/');
    if (plan.kind !== 'navigate') throw new Error(plan.kind);
    expect(plan.href).toContain('doc=%2Fdocs%2Fguides%2FARCHITECTURE.md');
    expect(plan.href).not.toContain('%252F');
  });

  it('PDF 命中不跳转，只交回「路径 + 页码」（原文不随应用分发）', () => {
    const plan = planDocHit(
      hit({ path: 'docs/standards/randomness-certification-sources/GM-T-0105-2021.pdf', line: 18, kind: 'pdf' }),
      '/#/',
    );
    expect(plan.kind).toBe('pdf-reference');
    if (plan.kind !== 'pdf-reference') return;
    expect(plan.reference).toBe(
      '/docs/standards/randomness-certification-sources/GM-T-0105-2021.pdf#page=18',
    );
    // 提示文案由宿主按界面语言拼，决策层不产出中文
    expect(JSON.stringify(plan)).not.toMatch(/[\u4e00-\u9fff]/);
    expect('href' in plan).toBe(false);
  });
});
