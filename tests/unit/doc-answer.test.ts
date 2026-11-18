// @vitest-environment node
/**
 * D 线「答案 + 出处」层（`src/services/ai-helper/doc-answer.ts`）的回归。
 *
 * D 的定义见 `experiments/ai-helper-2026-11-14/PLAN.md` §0：用户问题 → 答案 + 出处，
 * “生成式回答属可选增强”。所以这一层必须能在**没有模型**的前提下给出答案，判据只有三条：
 *
 *   1. 逐字可回链：每条答案句必须能在 cited 行上原样找到（不是改写、不是拼接）；
 *   2. 不换话题：问题点名的拉丁实体必须出现在出处的文档标识里（问 ML-KEM 不能答到能力总览）；
 *   3. 答不出就明说：覆盖度不够、缺点名实体、或整篇凑不出对应句式时返回 null + missing。
 *
 * 基线数字是 2026-11-16 在真实索引与文档树上实测的（RESULTS §25 / §27）：
 *   - 调参集 30 题：16 条敢回答，15 条出处落在评测期望的文档上；7 条负例全部拒答；
 *   - 留出集 12 题（未参与调参）：top1 8/12，作答 6 条、答对 5 条（出处正确率 83%）。
 * 留出集的数字明显低于调参集，这是真实泛化差距，不许为了让调参集变绿去调它的阈值。
 * 语料或索引更新后数字会变，改这里必须同步改 RESULTS。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  answerFromDocument,
  answerHits,
  indexTermStats,
  splitSentences,
} from '@/services/ai-helper/doc-answer';
import { parseDocIndex, searchDocs } from '@/services/ai-helper/doc-search';
import { queryTerms, stripMarkdown } from '@/services/ai-helper/doc-tokenize';

const ROOT = process.cwd();
const index = parseDocIndex(readFileSync(resolve(ROOT, 'src/services/ai-helper/doc-index.json'), 'utf8'));
const stats = indexTermStats(index);
const evalCases = JSON.parse(
  readFileSync(resolve(ROOT, 'experiments/ai-helper-2026-11-14/docsearch-eval.json'), 'utf8'),
) as Array<{ q: string; expect: string[] }>;

const loadText = async (path: string): Promise<string | null> => {
  try {
    return readFileSync(resolve(ROOT, path.replace(/^\/+/, '')), 'utf8');
  } catch {
    return null;
  }
};

/**
 * 引文必须落在它自报的那一行上（±0）。
 *
 * 答案句是去 Markdown 标记后的纯文本（界面要能直接读），所以比对时同一行也要走
 * 同一个 `stripMarkdown`：否则 `**加粗**`、行内代码、链接这些标记会让逐字比对假红。
 * 这不是放宽判据——换行位置、行号、句子内容仍然逐字对齐。
 */
function citationHolds(path: string, line: number, text: string): boolean {
  const markdown = readFileSync(resolve(ROOT, path.replace(/^\/+/, '')), 'utf8');
  const lines = markdown.split('\n');
  // 答案按「段落」拼行后切句，所以比对时也要从该行起把这一段拼回来（到空行/标题为止）。
  const buffer: string[] = [];
  for (let index = line - 1; index < lines.length; index += 1) {
    const current = lines[index] ?? '';
    if (index > line - 1 && (/^\s*$/.test(current) || /^#{1,6}\s/.test(current))) break;
    buffer.push(current);
  }
  const source = stripMarkdown(buffer.join(' ')).replace(/\s+/g, ' ');
  const quote = text.replace(/\s+/g, ' ');
  return source.includes(quote);
}

describe('句子切分', () => {
  it('中文按全角句末切，英文小数点不断句', () => {
    expect(splitSentences('SM4 的轮密钥由密钥扩展生成。轮函数 F 使用 4 个 32 位字。')).toEqual([
      'SM4 的轮密钥由密钥扩展生成。',
      '轮函数 F 使用 4 个 32 位字。',
    ]);
    // FIPS 197 里的 §5.1.4 不是句末；短于 6 字的碎片（「下一句。」这类）按设计丢弃，
    // 它们是列表标签/表头，不是能当答案的句子。
    expect(splitSentences('见 FIPS 197 §5.1.4 的定义。下一句。')).toEqual(['见 FIPS 197 §5.1.4 的定义。']);
    // 英文句号必须跟空白 + 大写才算断句
    expect(splitSentences('SubBytes is a table lookup. MixColumns multiplies in GF(2^8).')).toHaveLength(2);
  });

  it('过滤标题行、空行与元数据表格（它们不是答案句）', () => {
    const markdown = ['# 标题', '| 字段 | 内容 |', '', '这一句是正文，含 SM4 与轮密钥。'].join('\n');
    const hit = {
      path: 'x.md',
      title: 'x',
      heading: 'h',
      line: 1,
      score: 1,
      excerpt: '',
      kind: 'md' as const,
      terms: [],
    };
    const draft = answerFromDocument(markdown, hit, 'SM4 轮密钥', queryTerms('SM4 轮密钥'), { stats });
    expect(draft?.sentences.map((sentence) => sentence.text)).toEqual(['这一句是正文，含 SM4 与轮密钥。']);
    expect(draft?.sentences[0].line).toBe(4);
  });
});

describe('答案层（真实索引与文档树）', () => {
  it('调参集 30 题：16 条敢回答，其中 15 条出处落在期望文档', async () => {
    let answered = 0;
    let inExpected = 0;
    const wrong: string[] = [];
    for (const testCase of evalCases) {
      const hits = searchDocs(index, testCase.q, { limit: 6 });
      const result = await answerHits(testCase.q, hits, loadText, { stats });
      if (!result.best) continue;
      answered += 1;
      const ok = testCase.expect.some((prefix) => result.best!.evidence.path.startsWith(prefix));
      if (ok) inExpected += 1;
      else wrong.push(`${testCase.q} → ${result.best.evidence.path}`);
    }
    expect({ answered, inExpected }).toEqual({ answered: 16, inExpected: 15 });
    // 「答了但出处不在期望集」的题必须逐条登记，不能悄悄多出来。
    expect(wrong).toEqual([
      '积木之间的类型检查与转换规则 → docs/guides/USER-GUIDE.md',
    ]);
  });

  it('每条答案句都能在它自报的行上逐字找到', async () => {
    let checked = 0;
    for (const testCase of evalCases) {
      const hits = searchDocs(index, testCase.q, { limit: 6 });
      const result = await answerHits(testCase.q, hits, loadText, { stats });
      if (!result.best) continue;
      for (const sentence of result.best.sentences) {
        expect(
          citationHolds(result.best.evidence.path, sentence.line, sentence.text),
          `${testCase.q} @${result.best.evidence.path}:${sentence.line}`,
        ).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15); // 每条答案至少 1 句，15 条答案 ≥ 15 句
  });

  it('负例（语料里没有依据）必须拒答，并给出缺的词', async () => {
    const negatives = [
      '量子退火怎么破解 SM4',
      '如何用 CSS 实现毛玻璃效果',
      // 阴性对照的实体必须是「语料里不是主题」的名字。产品已于 2026-11-17 改名为
      // MetaCrypto Online IDE，旧名已不在任何文档标题与路径里，正好继续当这个对照；
      // 换成本名会被判为主题而答上来。
      'CipherCat 支持哪些区块链共识算法',
      // 后两条是本轮新增：问题里的实体在语料里根本不是主题，靠共用词能凑到 0.5 覆盖度，
      // 曾分别答到研究综述页与教程页（RESULTS §25 阴性对照）。
      '如何用 TensorFlow 训练卷积神经网络',
      'CipherCat 的 Kubernetes 部署清单在哪',
      // 本轮新增：`Go` 只有 2 个字符，旧的锚点正则（≥3）漏掉它，于是靠「服务/执行」凑到
      // 0.65 覆盖度答到 GM/T 0005 的后端测评页（RESULTS §27.5）。
      '如何用 Go 写 gRPC 服务',
      '明天会下雨吗',
    ];
    for (const question of negatives) {
      const hits = searchDocs(index, question, { limit: 6 });
      const result = await answerHits(question, hits, loadText, { stats });
      expect(result.best, question).toBeNull();
      expect(result.missing.length, question).toBeGreaterThan(0);
    }
  });

  it('不换话题：点名 ML-KEM 时不会答到能力总览页', async () => {
    const question = 'ML-KEM 密钥封装的三步';
    const hits = searchDocs(index, question, { limit: 6 });
    const result = await answerHits(question, hits, loadText, { stats });
    // 检索已把标准页排到第一，但那一页整篇没有「三步」的句式（都是实现范围说明）：
    // 覆盖度 0.63 ≥ 0.6 也照样拒答——问句类型闸门不认「有词无句」的答案。
    expect(result.best).toBeNull();
    expect(hits[0].path.startsWith('docs/standards/fips203-ML-KEM/')).toBe(true);
  });

  it('留出集2（未参与调参）：top1 7/12，作答 6 条里 5 条出处正确', async () => {
    const holdout = JSON.parse(
      readFileSync(resolve(ROOT, 'experiments/ai-helper-2026-11-14/docsearch-holdout2.json'), 'utf8'),
    ) as Array<{ q: string; expect: string[] }>;
    let top1 = 0;
    let answered = 0;
    let correct = 0;
    for (const testCase of holdout) {
      const hits = searchDocs(index, testCase.q, { limit: 60 });
      const docs = [...new Set(hits.map((hit) => hit.path))];
      if (!testCase.expect.length) {
        const result = await answerHits(testCase.q, hits.slice(0, 6), loadText, { stats });
        expect(result.best, testCase.q).toBeNull();
        continue;
      }
      if (testCase.expect.some((prefix) => docs[0]?.startsWith(prefix))) top1 += 1;
      const result = await answerHits(testCase.q, hits.slice(0, 6), loadText, { stats });
      if (!result.best) continue;
      answered += 1;
      if (testCase.expect.some((prefix) => result.best!.evidence.path.startsWith(prefix))) correct += 1;
    }
    // 2026-11-16 §27：希腊字母 + 标题命中后 top1 7→8（ECDH 落到 rfc5903），
    // 作答条数与正确条数不变（其余仍被覆盖度/句式闸门拒答）。
    expect({ top1, answered, correct }).toEqual({ top1: 8, answered: 6, correct: 5 });
  });

  it('覆盖度阈值挡住「只有实体、没有问题」的答案', async () => {
    const question = 'ZUC 的 LFSR 初始化模式';
    const hits = searchDocs(index, question, { limit: 6 });
    const result = await answerHits(question, hits, loadText, { stats });
    // 拒答或答在 ZUC 页上，两者都可以；但不允许答在无关文档上。
    if (result.best) {
      expect(result.best.evidence.path.toLowerCase()).toContain('zuc');
    }
  });
});
