/**
 * D 线检索/答案层的复跑与取证：七套集（调参 + 六套留出）一次跑完。
 *
 * 为什么要有这条命令：`tests/unit/doc-search.test.ts` 只钉基线**数字**，看不见
 * 「哪一题掉到第几名」；每轮调参都要先看失败清单再决定改什么。之前这些是临时探针脚本，
 * 跑完就删，复跑结论只能回 RESULTS 里翻。
 *
 * 用法：
 *   npx tsx scripts/ai-helper-docsearch-eval.ts            # 七套集 top1 + 答案层
 *   npx tsx scripts/ai-helper-docsearch-eval.ts --detail "SHA-3 的 π 步怎么算"
 *                                                        # 单题 top5 分数与命中词
 *
 * 判据：top1 = 期望文档（含目录前缀匹配）排第一；recall@5 = 期望文档进前五；
 * 负例（`expect: []`）由答案层判，检索层不判。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { answerHits, indexTermStats } from '../src/services/ai-helper/doc-answer';
import { parseDocIndex, searchDocs } from '../src/services/ai-helper/doc-search';
import { queryTerms } from '../src/services/ai-helper/doc-tokenize';

interface Case {
  q: string;
  expect: string[];
}

const ROOT = process.cwd();
const EXPERIMENT = resolve(ROOT, 'experiments/ai-helper-2026-11-14');
const SETS = [
  'docsearch-eval.json',
  'docsearch-holdout.json',
  'docsearch-holdout2.json',
  'docsearch-holdout3.json',
  'docsearch-holdout4.json',
  'docsearch-holdout5.json',
  'docsearch-holdout6.json',
];
const index = parseDocIndex(readFileSync(resolve(ROOT, 'src/services/ai-helper/doc-index.json'), 'utf8'));
const stats = indexTermStats(index);
const loadText = async (path: string): Promise<string | null> => {
  try {
    return readFileSync(resolve(ROOT, path.replace(/^\/+/, '')), 'utf8');
  } catch {
    return null;
  }
};
const load = (file: string): Case[] => JSON.parse(readFileSync(resolve(EXPERIMENT, file), 'utf8')) as Case[];

async function main(): Promise<void> {
  const detailAt = process.argv.indexOf('--detail');
  if (detailAt >= 0) {
    const query = process.argv[detailAt + 1] ?? '';
    console.log(`query ${JSON.stringify(query)}`);
    console.log(`  terms ${JSON.stringify(queryTerms(query))}`);
    for (const [position, hit] of searchDocs(index, query, { limit: 5 }).entries()) {
      console.log(`  ${position + 1} ${hit.score} ${hit.path} [${hit.heading}] terms=${hit.terms.join(',')}`);
    }
    return;
  }

  for (const file of SETS) {
    const cases = load(file);
    const missed: string[] = [];
    let top1 = 0;
    let recall = 0;
    let answered = 0;
    let correct = 0;
    let rejected = 0;
    for (const testCase of cases) {
      const hits = searchDocs(index, testCase.q, { limit: 60 });
      const paths = hits.map((hit) => hit.path);
      const rank = paths.findIndex((path) => testCase.expect.some((prefix) => path.startsWith(prefix)));
      if (testCase.expect.length > 0) {
        if (rank === 0) top1 += 1;
        if (rank >= 0 && rank < 5) recall += 1;
        if (rank !== 0) missed.push(`  #${rank + 1} ${testCase.q} -> ${paths[0] ?? '(无)'}`);
      }
      // 答案层：负例（expect 为空）必须拒答；正例只统计「敢答 / 出处对」。
      const answer = await answerHits(testCase.q, hits.slice(0, 6), loadText, { stats });
      if (!answer.best) {
        rejected += 1;
        if (testCase.expect.length > 0) missed.push(`  拒答 ${testCase.q}`);
        continue;
      }
      if (testCase.expect.length === 0) {
        missed.push(`  负例被答 ${testCase.q} -> ${answer.best.evidence.path}`);
        continue;
      }
      answered += 1;
      if (testCase.expect.some((prefix) => answer.best!.evidence.path.startsWith(prefix))) correct += 1;
    }
    console.log(
      `${file}: top1=${top1} recall@5=${recall} answered=${answered} correct=${correct} rejected=${rejected}`,
    );
    for (const line of missed) console.log(line);
  }
}

void main();
