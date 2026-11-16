// @vitest-environment node
/**
 * D 线「答案 + 出处」层（`src/services/ai-helper/doc-answer.ts`）的回归。
 *
 * D 的定义见 `experiments/ai-helper-2026-11-14/PLAN.md` §0：用户问题 → 答案 + 出处，
 * “生成式回答属可选增强”。所以这一层必须能在**没有模型**的前提下给出答案，判据只有三条：
 *
 *   1. 逐字可回链：每条答案句必须能在 cited 行上原样找到（不是改写、不是拼接）；
 *   2. 不换话题：问题点名的拉丁实体必须出现在出处的文档标识里（问 ML-KEM 不能答到能力总览）；
 *   3. 答不出就明说：覆盖度不够或缺点名实体时返回 null + missing，不拿最近段落冒充答案。
 *
 * 基线数字是 2026-11-16 在真实索引与文档树上实测的（RESULTS §24）：30 条评测题里
 * 13 条敢回答、12 条的出处落在评测期望的文档上，3 条负例全部拒答。语料或索引更新后
 * 数字会变，改这里必须同步改 RESULTS，不许为了让测试变绿而放宽断言。
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
  it('30 条评测题：13 条敢回答，其中 12 条出处落在期望文档', async () => {
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
    expect({ answered, inExpected }).toEqual({ answered: 13, inExpected: 12 });
    // 唯一一条「答了但出处不在期望集」的题必须登记在案，不能悄悄多出来。
    expect(wrong).toEqual([
      'How is the SM4 round function defined → docs/demos/sm4.en.md',
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
    expect(checked).toBeGreaterThanOrEqual(13); // 每条答案至少 1 句，13 条答案 ≥ 13 句
  });

  it('负例（语料里没有依据）必须拒答，并给出缺的词', async () => {
    const negatives = [
      '量子退火怎么破解 SM4',
      '如何用 CSS 实现毛玻璃效果',
      'CipherCat 支持哪些区块链共识算法',
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
    // 期望文档排第 6 开外 → 宁可拒答，也不拿 guides/CAPABILITY-MAP 之类的页冒充答案。
    expect(result.best).toBeNull();
    expect(result.missing.join(' ')).toContain('ml-kem');
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
