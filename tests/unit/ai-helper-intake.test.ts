// @vitest-environment node
/**
 * A/B 单入口判别内核（`src/services/ai-helper/intake.ts`）的回归。
 *
 * PLAN §3.1 定的是「先看扩展名，扩展名缺失或与内容冲突时看内容；判不出来就交给用户」。
 * 这里钉住的是**判据本身**，不是面板：面板只需要把 `kind` 预填到开关上，用户改过以用户为准。
 *
 * 三条容易写错的边界：
 *   1. 二进制文档（PDF/DOCX）不读正文——读到的是乱码，拿它做内容判据只会误判；
 *   2. 「冲突」只由**另一侧**特征推翻扩展名，两侧都有特征时不算冲突（没有赢家）；
 *   3. 判不出来必须是 `unknown`，不能悄悄猜一侧（猜错会把标准原文送进反解析器）。
 */

import { describe, expect, it } from 'vitest';

import { detectIntake, extensionOf, isBinaryDoc } from '@/services/ai-helper/intake';

const PY = 'def sm4_key_expand(key):\n    return key\n';
const MD = '# SM4 密钥扩展\n\n第 1 章 范围\n\nGB/T 32907-2016 规定 SM4 的密钥扩展。\n';

describe('extensionOf / isBinaryDoc（判据的底座）', () => {
  it('取小写扩展名，路径与无扩展名都照顾到', () => {
    expect(extensionOf('src/main.PY')).toBe('py');
    expect(extensionOf('/tmp/a.b/标准.pdf')).toBe('pdf');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });

  it('只有 PDF/DOCX 算二进制文档（md/tex 是文本，能读内容）', () => {
    expect(isBinaryDoc('a.pdf')).toBe(true);
    expect(isBinaryDoc('a.docx')).toBe(true);
    expect(isBinaryDoc('a.md')).toBe(false);
    expect(isBinaryDoc('a.txt')).toBe(false);
  });
});

describe('detectIntake（扩展名优先）', () => {
  it('.py 是代码：basis=extension', () => {
    const verdict = detectIntake({ name: 'key_expand.py', text: PY });
    expect(verdict.kind).toBe('code');
    expect(verdict.basis).toBe('extension');
    expect(verdict.evidence[0]).toContain('py');
  });

  it('.md 是文档：basis=extension', () => {
    const verdict = detectIntake({ name: 'SM4.md', text: MD });
    expect(verdict.kind).toBe('doc');
    expect(verdict.basis).toBe('extension');
  });

  it('PDF 没正文也判文档（二进制不读正文）', () => {
    const verdict = detectIntake({ name: '标准.pdf' });
    expect(verdict.kind).toBe('doc');
    expect(verdict.basis).toBe('extension');
  });

  it('DOCX 即使传进来一段像代码的乱码也按扩展名判文档', () => {
    const verdict = detectIntake({ name: 'spec.docx', text: 'def f():\n    return 1\n' });
    expect(verdict.kind).toBe('doc');
    expect(verdict.basis).toBe('extension');
  });
});

describe('detectIntake（冲突时由内容推翻扩展名）', () => {
  it('.py 里装的是标准正文 → 文档，basis=conflict，并给出两侧证据', () => {
    const verdict = detectIntake({ name: 'misfiled.py', text: MD });
    expect(verdict.kind).toBe('doc');
    expect(verdict.basis).toBe('conflict');
    expect(verdict.evidence).toHaveLength(2);
    expect(verdict.evidence[0]).toContain('py');
    expect(verdict.evidence[1]).toContain('文档');
  });

  it('.md 里装的是 C 源码 → 代码，basis=conflict', () => {
    const c = '#include <stdio.h>\nint main(void) { return 0; }\n';
    const verdict = detectIntake({ name: 'spec.md', text: c });
    expect(verdict.kind).toBe('code');
    expect(verdict.basis).toBe('conflict');
  });

  it('两侧特征都有时不算冲突：扩展名仍然说话（没有赢家就不推翻）', () => {
    const mixed = '#include <stdio.h>\n\n第 1 章 范围\nGB/T 32907-2016\n';
    const verdict = detectIntake({ name: 'notes.py', text: mixed });
    expect(verdict.kind).toBe('code');
    expect(verdict.basis).toBe('extension');
  });
});

describe('detectIntake（没有可用扩展名时按内容）', () => {
  it('纯代码正文 → 代码，basis=content', () => {
    const verdict = detectIntake({ text: PY });
    expect(verdict.kind).toBe('code');
    expect(verdict.basis).toBe('content');
  });

  it('纯标准正文 → 文档，basis=content', () => {
    const verdict = detectIntake({ name: 'pasted', text: MD });
    expect(verdict.kind).toBe('doc');
    expect(verdict.basis).toBe('content');
  });

  it('两侧都不像 → unknown，并说明判断不了', () => {
    const verdict = detectIntake({ name: 'x.unknown', text: '随便一段话，没有结构也没有代码。' });
    expect(verdict.kind).toBe('unknown');
    expect(verdict.basis).toBe('none');
    expect(verdict.evidence).toEqual([]);
  });

  it('两侧都像 → unknown（不猜一侧）', () => {
    const verdict = detectIntake({ text: '#include <stdio.h>\n\n附录 A 公式\n$$x=1$$' });
    expect(verdict.kind).toBe('unknown');
    expect(verdict.basis).toBe('none');
    expect(verdict.evidence[0]).toContain('同时像');
  });

  it('空输入 → unknown，不抛异常', () => {
    expect(detectIntake({}).kind).toBe('unknown');
    expect(detectIntake({ name: '', text: '   ' }).basis).toBe('none');
  });
});
