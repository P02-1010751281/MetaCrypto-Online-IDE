/**
 * 把「答案层」接到界面：命中段落 + 问题 → `answerHits`（纯函数）→ 抽取式答案。
 *
 * 正文按需加载（`useDocsCatalog` 的懒加载器），一次只读被选中的那几篇 Markdown：
 * 索引里的段落摘录被截到 140 字，撑不起答案，必须回原文取句。
 * 竞态用序号挡：连打两次查询时只认最后一次的结果，不让旧答案盖住新问题。
 */
import { ref } from 'vue';

import { docLoaders } from '@/composables/useDocsCatalog';
import { answerHits, indexTermStats } from '@/services/ai-helper/doc-answer';
import type { AnswerResult } from '@/services/ai-helper/doc-answer';
import type { DocHit, DocIndex } from '@/services/ai-helper/doc-search';

async function loadDocText(path: string): Promise<string | null> {
  const key = path.startsWith('/') ? path : `/${path}`;
  const loader = docLoaders[key];
  if (!loader) return null; // PDF 命中没有 Markdown 正文：答案层降级成页摘录
  try {
    return await loader();
  } catch {
    return null;
  }
}

export function useDocAnswer() {
  const result = ref<AnswerResult | null>(null);
  const loading = ref(false);
  let seq = 0;

  async function answer(question: string, index: DocIndex, hits: DocHit[]): Promise<void> {
    const text = question.trim();
    if (!text || !hits.length) {
      seq += 1;
      result.value = null;
      loading.value = false;
      return;
    }
    const current = (seq += 1);
    loading.value = true;
    try {
      const value = await answerHits(text, hits, loadDocText, { stats: indexTermStats(index) });
      if (current !== seq) return;
      result.value = value;
    } finally {
      if (current === seq) loading.value = false;
    }
  }

  function clear(): void {
    seq += 1;
    result.value = null;
    loading.value = false;
  }

  return { result, loading, answer, clear };
}
