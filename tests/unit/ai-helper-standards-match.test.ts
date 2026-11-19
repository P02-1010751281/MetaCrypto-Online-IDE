import { describe, expect, it } from 'vitest';

import { matchStandard, signalOf } from '@/services/ai-helper/standards-match';
import verdictsIndex from '@/services/ai-helper/verdicts-index.json';

const STANDARDS = [
  { id: 'fips180-4-SHA2', name: 'NIST FIPS 180-4', version: '180-4' },
  { id: 'sp800-38b-cmac', name: 'NIST SP 800-38B', version: '38B' },
  { id: 'sp800-38c-ccm', name: 'NIST SP 800-38C', version: '38C' },
];

describe('标准编号解析', () => {
  it('FIPS 名称解析出编号、数字部分与算法名', () => {
    expect(signalOf(STANDARDS[0])).toEqual({
      id: 'fips180-4-SHA2',
      designation: 'FIPS 180-4',
      bareNumber: '180-4',
      keyword: 'SHA2',
    });
  });

  it('SP 名称解析出 SP 编号与算法名', () => {
    expect(signalOf(STANDARDS[1])).toMatchObject({
      designation: 'SP 800-38B',
      bareNumber: '800-38B',
      keyword: 'cmac',
    });
  });

  it('末段是纯数字时不当作算法名', () => {
    expect(signalOf({ id: 'fips-204', name: 'NIST FIPS 204' }).keyword).toBeNull();
  });

  it('名称里没有编号族时 designation 为空', () => {
    expect(signalOf({ id: 'custom-thing', name: '内部规范' }).designation).toBeNull();
  });
});

describe('匹配已登记标准', () => {
  it('正文里的完整编号命中', () => {
    expect(matchStandard({ text: '见 FIPS 180-4 第 4 节。' }, STANDARDS)).toEqual({
      id: 'fips180-4-SHA2',
      token: 'FIPS 180-4',
      strength: 'designation',
    });
  });

  it('只写数字部分也命中', () => {
    expect(matchStandard({ text: 'ref: 800-38C appendix' }, STANDARDS)).toMatchObject({
      id: 'sp800-38c-ccm',
      strength: 'designation',
    });
  });

  it('只写算法名时退到弱信号', () => {
    expect(matchStandard({ text: 'AES-CMAC 的计算过程如下。' }, STANDARDS)).toMatchObject({
      id: 'sp800-38b-cmac',
      token: 'cmac',
      strength: 'keyword',
    });
  });

  it('文件名里的编号（带分隔符）也能命中', () => {
    expect(matchStandard({ name: 'NIST.SP.800-38C.pdf' }, STANDARDS)).toMatchObject({
      id: 'sp800-38c-ccm',
    });
  });

  it('SHA2 与 SHA-2 两种写法都认', () => {
    expect(matchStandard({ text: 'SHA-256 属于 SHA-2 家族' }, STANDARDS)).toMatchObject({
      id: 'fips180-4-SHA2',
      strength: 'keyword',
    });
  });

  it('编号比算法名强：同时出现时按编号选', () => {
    expect(matchStandard({ text: 'SP 800-38C 的实现可以复用 CMAC。' }, STANDARDS)).toMatchObject({
      id: 'sp800-38c-ccm',
      strength: 'designation',
    });
  });

  it('两份同分时不猜', () => {
    expect(matchStandard({ text: 'CMAC 与 CCM 都提到，但没有编号。' }, STANDARDS)).toBeNull();
  });

  it('无关正文不命中', () => {
    expect(matchStandard({ text: '这是一份临时笔记，记了三件事。' }, STANDARDS)).toBeNull();
  });

  it('空输入不命中', () => {
    expect(matchStandard({}, STANDARDS)).toBeNull();
    expect(matchStandard({ text: '   ' }, STANDARDS)).toBeNull();
  });

  it('编号不能被更长的编号前缀命中', () => {
    expect(matchStandard({ text: 'FIPS 180-40 不存在' }, STANDARDS)).toBeNull();
  });
});

describe('登记标准全都有信号', () => {
  it('verdicts 索引里每一份标准都能被匹配到（新增标准时必须补信号）', () => {
    const missing = verdictsIndex.standards
      .map((item) => signalOf(item.standard))
      .filter((signal) => !signal.designation && !signal.keyword);
    expect(missing).toEqual([]);
  });

  it('每一份登记标准用自己的编号都能被认出来，且只认出自己', () => {
    for (const item of verdictsIndex.standards) {
      const signal = signalOf(item.standard);
      const token = signal.designation ?? signal.keyword;
      expect(token).toBeTruthy();
      const match = matchStandard({ text: token as string }, verdictsIndex.standards.map((entry) => entry.standard));
      expect(match?.id).toBe(item.standard.id);
    }
  });
});
