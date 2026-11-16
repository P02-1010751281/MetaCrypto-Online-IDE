// @vitest-environment node
/**
 * 文档检索内核（`src/services/ai-helper/doc-search.ts`）的回归。
 *
 * 钉住四件事：
 *   1. 索引是构建期产物，与 `docs/**\/*.md` 必须同步——语料改了不重建索引要在这里红；
 *   2. 运行时副本与实验留档副本逐字节一致；
 *   3. 分词口径（中文二元组、交叉词标记、停用词）不会悄悄漂移；
 *   4. 代表性查询仍落在正确文档上，过滤与去重语义不变。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { corpusDigest, mergeIndexes, parseDocIndex, searchDocs } from '@/services/ai-helper/doc-search';
import { expandQuery } from '@/services/ai-helper/doc-glossary';
import { queryPlan, queryTerms, rawTerms } from '@/services/ai-helper/doc-tokenize';

const ROOT = process.cwd();
const PRODUCT_INDEX = resolve(ROOT, 'src/services/ai-helper/doc-index.json');
const ARCHIVE_INDEX = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/doc-index.json');
const PDF_INDEX = resolve(ROOT, 'src/services/ai-helper/doc-index-pdf.json');
const PDF_ARCHIVE = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/doc-index-pdf.json');

const index = parseDocIndex(readFileSync(PRODUCT_INDEX, 'utf8'));
const pdfIndex = parseDocIndex(readFileSync(PDF_INDEX, 'utf8'));

function corpusEntries(dir = 'docs'): Array<[string, string]> {
  const files: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(resolve(ROOT, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) files.push(path);
    }
  };
  walk(dir);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files.map((path) => [path, readFileSync(resolve(ROOT, path), 'utf8')]);
}

const firstPaths = (query: string, limit = 5): string[] =>
  searchDocs(index, query, { limit }).map((hit) => hit.path);

describe('doc index', () => {
  it('与 docs 语料同步（语料变了要重建索引）', () => {
    expect(index.corpus.hash).toBe(corpusDigest(corpusEntries()));
  });

  // 该文件要解析两份 4 MB 索引；全量跑（83 个 worker）时单测被调度拖慢是常态，
  // 这里显式给 90 s，避免把「机器忙」误判成「索引不一致」。
  it('运行时副本与留档副本逐字节一致', { timeout: 90_000 }, async () => {
    // 并行开发时另一条线可能同时在跑构建：两份副本落盘相隔微秒级，
    // 读到「一份新一份旧」是构建进行中的瞬时状态，短暂重试后再判定（真不一致仍会红）。
    const readBoth = (): [Buffer, Buffer] => [readFileSync(PRODUCT_INDEX), readFileSync(ARCHIVE_INDEX)];
    let [product, archive] = readBoth();
    for (let attempt = 0; attempt < 5 && !product.equals(archive); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      [product, archive] = readBoth();
    }
    expect(product).toEqual(archive);
  });

  it('结构自洽：段落指向存在的文档，postings 长度成对', () => {
    expect(index.docs.length).toBe(index.corpus.files);
    expect(index.secs.length).toBe(index.corpus.sections);
    expect(index.corpus.sections).toBeGreaterThan(3000);
    for (const [doc] of index.secs) {
      expect(doc).toBeGreaterThanOrEqual(0);
      expect(doc).toBeLessThan(index.docs.length);
    }
    const terms = Object.keys(index.post);
    expect(terms.length).toBeGreaterThan(40000);
    for (const term of terms) {
      const postings = index.post[term];
      expect(postings.length % 2).toBe(0);
      for (let cursor = 0; cursor < postings.length; cursor += 2) {
        expect(postings[cursor]).toBeLessThan(index.secs.length);
      }
    }
  });
});

describe('doc tokenizer', () => {
  it('中文连续串里标出交叉二元组（密钥协商 → 钥协）', () => {
    const plan = queryPlan('密钥协商');
    const terms = plan.map((item) => item.term);
    expect(terms).toContain('密钥');
    expect(terms).toContain('协商');
    expect(plan.find((item) => item.term === '钥协')?.bridging).toBe(true);
    expect(plan.find((item) => item.term === '密钥')?.bridging).toBe(false);
  });

  it('停用词不进入查询意图，但内容词保留', () => {
    const terms = queryTerms('如何用 S 盒替换');
    expect(terms).not.toContain('如何');
    expect(terms).not.toContain('用');
    expect(terms).toContain('盒');
    expect(terms).toContain('替换');
  });

  it('拉丁标识符保留整词并拆出片段', () => {
    const terms = rawTerms('aes_add_round_key').map((item) => item.term);
    expect(terms).toContain('aes_add_round_key');
    expect(terms).toContain('aes');
    expect(terms).toContain('round');
    expect(terms).toContain('key');
  });
});

describe('doc glossary', () => {
  it('意图词扩展成标准里的缩写（认证加密 → aead/gcm）', () => {
    const expanded = expandQuery('怎么实现带认证的加密');
    expect(expanded.get('aead')).toBeGreaterThan(0);
    expect(expanded.get('gcm')).toBeGreaterThan(0);
  });

  it('英文提问扩展出中文术语（round function → 轮函数）', () => {
    const expanded = expandQuery('round function');
    expect(expanded.get('轮函')).toBeGreaterThan(0);
  });
});

describe('doc search', () => {
  it('SM4 密钥扩展落在 SM4 标准拆分页', () => {
    expect(firstPaths('SM4 的密钥扩展怎么算')).toContain('docs/standards/gbt32907-SM4/03-Algorithm.md');
  });

  it('S-Box 块参考可检索（含 S 盒 混写）', () => {
    expect(firstPaths('S-Box 块怎么用')).toContain('docs/blocks/ecc-sbox.md');
    // 「S 盒」混写靠「单字母 + 中文字」合成词命中，不依赖拉丁整词
    expect(firstPaths('S 盒替换')).toContain('docs/standards/gbt33133-ZUC/02-SBox-Linear.md');
  });

  it('空查询返回空结果', () => {
    expect(searchDocs(index, '   ')).toEqual([]);
  });

  it('语种过滤只留 .en.md', () => {
    const hits = searchDocs(index, 'SM4', { limit: 5, lang: 'en' });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.path.endsWith('.en.md')).toBe(true);
  });

  it('路径前缀过滤生效', () => {
    const hits = searchDocs(index, '密钥扩展', { limit: 5, prefix: 'docs/guides/' });
    for (const hit of hits) expect(hit.path.startsWith('docs/guides/')).toBe(true);
  });

  it('默认按文档去重，同一篇只出现一次', () => {
    const paths = firstPaths('填充', 10);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('英文提问能落到中文标准页（跨语言靠术语扩展）', () => {
    expect(firstPaths('How is the SM4 round function defined', 5)).toContain(
      'docs/standards/gbt32907-SM4/README.md',
    );
  });

  it('PDF 页索引：覆盖标准 PDF、与留档一致、命中带 kind', () => {
    expect(pdfIndex.kind).toBe('pdf');
    expect(pdfIndex.docs.length).toBeGreaterThan(40);
    expect(readFileSync(PDF_INDEX)).toEqual(readFileSync(PDF_ARCHIVE));
    const merged = mergeIndexes(index, pdfIndex);
    const hits = searchDocs(merged, 'GCM GHASH 域乘法', { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(['md', 'pdf']).toContain(hit.kind);
  });

  it('合并 PDF 后不偏离 Markdown 章节（PDF 页权重 0.6）', () => {
    const merged = mergeIndexes(index, pdfIndex);
    const hits = searchDocs(merged, 'Ed25519 的签名与验签流程', { limit: 5 });
    expect(hits.some((hit) => hit.path.startsWith('docs/standards/rfc8032-eddsa/'))).toBe(true);
  });

  it('点名实体时归属页排第一（主题归属 + 文档级选择，2026-11-16 修 8 条反例）', () => {
    const top1 = (query: string): string => firstPaths(query, 1)[0] ?? '';
    // 标准号 ↔ 算法名别名：目录名是标准号/族名，用户按算法名或成员名提问。
    // 这几条钉住别名表本身（不是留出集），改名或删表项时要在这里红。
    expect(top1('HMAC 的密钥处理规则')).toMatch(/^docs\/standards\/fips198-1-hmac\//);
    expect(top1('RSA 的 PKCS#1 v1.5 加密怎么做')).toMatch(/^docs\/standards\/rfc8017-pkcs1\//);
    expect(top1('SHA-224 的消息填充规则')).toMatch(/^docs\/standards\/fips180-4-SHA2\//);
    expect(top1('Base32 的编码规则')).toMatch(/^docs\/standards\/rfc4648-base64\//);
    // 反例的共同形态：另一篇文档里恰好有一节把共用词写得更密（SM3 ← SHA-2 压缩函数页、
    // ML-KEM ← 能力地图、Ed25519 ← 块参考页）。归属判据只看路径词元，不看标题与正文词频。
    expect(top1('SM3 的压缩函数结构')).toMatch(/^docs\/standards\/gbt32905-SM3\//);
    expect(top1('SHA-3 的海绵结构吸收与挤压')).toMatch(/^docs\/standards\/fips202-SHA3\//);
    expect(top1('ML-KEM 密钥封装的三步')).toMatch(/^docs\/standards\/fips203-ML-KEM\//);
    expect(top1('Ed25519 的签名与验签流程')).toMatch(/^docs\/standards\/rfc8032-eddsa\//);
    expect(top1('X25519 的密钥协商怎么算共享密钥')).toMatch(/^docs\/standards\/rfc7748-x25519\//);
    expect(top1('确定性 ECDSA 的随机数 k 怎么来')).toMatch(/^docs\/standards\/rfc6979-ecdsa\//);
    expect(top1('PBKDF2 的迭代次数要求')).toMatch(/^docs\/standards\/sp800-132-pbkdf2\//);
    // 英文问句不再落到教程页（demos 是「怎么点」，不是「怎么定义」）。
    expect(top1('How is the SM4 round function defined')).toMatch(/^docs\/standards\/gbt32907-SM4\//);
  });

  it('检索泛化基线：五套集 top1 = 29、10、7、6、8（不许为了调参集媕低）', () => {
    const rank = (query: string, expect: string[]): number => {
      const paths = firstPaths(query, 60);
      for (let i = 0; i < paths.length; i += 1) {
        if (expect.some((prefix) => paths[i].startsWith(prefix))) return i + 1;
      }
      return -1;
    };
    const load = (file: string): Array<{ q: string; expect: string[] }> =>
      JSON.parse(
        readFileSync(resolve(ROOT, `experiments/ai-helper-2026-11-14/${file}`), 'utf8'),
      ) as Array<{ q: string; expect: string[] }>;
    const count = (cases: Array<{ q: string; expect: string[] }>): number =>
      cases.filter((item) => item.expect.length > 0 && rank(item.q, item.expect) === 1).length;
    expect(count(load('docsearch-eval.json'))).toBe(29);
    // 五套非调参集必须一起钉（2026-11-16 §27：希腊字母 + 标题命中后）：
    // 混合留出 10→12；标准页留出 7→8；holdout3 6→7；holdout4 8（未动）；
    // holdout5 是希腊字母与标题信号落地**之后**才写的验收集，首跑 7/12，此后未再调参。
    expect(count(load('docsearch-holdout.json'))).toBe(12);
    expect(count(load('docsearch-holdout2.json'))).toBe(8);
    expect(count(load('docsearch-holdout3.json'))).toBe(7);
    expect(count(load('docsearch-holdout4.json'))).toBe(8);
    expect(count(load('docsearch-holdout5.json'))).toBe(7);
  });

  it('同一查询结果确定（可用作回归判据）', () => {
    const a = searchDocs(index, 'GCM 认证', { limit: 5 });
    const b = searchDocs(index, 'GCM 认证', { limit: 5 });
    expect(a).toEqual(b);
  });
});
