<template>
  <section class="ac" :class="{ 'ac-miss': !answered && !loading }">
    <div class="ac-head">
      <span class="ac-title">{{ ui('answerTitle') }}</span>
      <span class="ac-note">{{ ui('answerExtractive') }}</span>
    </div>

    <!-- 有答案：逐句原样引用，每句带 [n]，出处清单在下面（可点开原文行）。 -->
    <template v-if="answered && result?.best">
      <ol class="ac-list">
        <li v-for="(sentence, index) in result.best.sentences" :key="`${sentence.line}:${index}`" class="ac-item">
          <span class="ac-mark">[{{ index + 1 }}]</span>
          <span class="ac-text">{{ sentence.text }}</span>
        </li>
      </ol>
      <div class="ac-source">
        <button
          type="button"
          class="ac-link"
          :title="ui('answerOpenSource')"
          @click="emit('open', evidenceTarget)"
        >
          {{ ui('answerSource') }} {{ result.best.evidence.path }}:{{ result.best.sentences[0]?.line ?? result.best.evidence.sectionLine }}
        </button>
        <span v-if="result.best.excerptOnly" class="ac-tag">{{ ui('answerPdfExcerpt') }}</span>
        <span class="ac-cov">{{ ui('answerCoverage') }} {{ Math.round(result.best.coverage * 100) }}%</span>
      </div>
    </template>

    <!-- 拒答：明说缺什么，并指向下面的最近段落；不把「最近的一段」包装成答案。 -->
    <template v-else-if="!loading">
      <p class="ac-miss-text">{{ ui('answerInsufficient') }}</p>
      <p v-if="result?.missing.length" class="ac-miss-terms">
        {{ ui('answerMissingPrefix') }} {{ result.missing.slice(0, 6).join(' · ') }}
      </p>
      <p class="ac-miss-hint">{{ ui('answerNearestHint') }}</p>
    </template>

    <p v-else class="ac-miss-text">{{ ui('answerLoading') }}</p>
  </section>
</template>

<script setup lang="ts">
/**
 * 「答案 + 出处」卡片（D 线的答案层，抽取式、不接模型）。
 *
 * 三条硬规矩落在模板上：
 *   1. 答案句原样展示，不改写、不拼接；
 *   2. 每句都有 [n] 与可点击的出处（真实文件行号），点开就是原文那一行；
 *   3. 答不出来时不给「最接近的一段」冒充答案，只列缺的词并指向下面最近段落。
 */
import { computed } from 'vue';

import { ui } from '@/composables/locale';
import type { AnswerResult } from '@/services/ai-helper/doc-answer';

const props = defineProps<{
  result: AnswerResult | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'open', payload: { path: string; line: number; title: string; heading: string; kind: 'md' | 'pdf' }): void;
}>();

const answered = computed(() => Boolean(props.result?.best));

/** 出处：优先用第一句的行号（能直接落到那一行），段落起始行只作兜底。 */
const evidenceTarget = computed(() => {
  const best = props.result?.best;
  if (!best) return { path: '', line: 1, title: '', heading: '', kind: 'md' as const };
  return {
    path: best.evidence.path,
    line: best.sentences[0]?.line ?? best.evidence.sectionLine,
    title: best.evidence.title,
    heading: best.evidence.heading,
    kind: best.evidence.kind,
  };
});
</script>

<style scoped>
.ac {
  padding: 8px var(--panel-pad-x) 10px;
  border-bottom: 1px solid var(--color-border, #d0d3d9);
  background: var(--color-bg-card);
}
.ac-miss {
  background: none;
}
.ac-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ac-title {
  font-weight: 600;
}
.ac-note,
.ac-cov {
  font-size: 11px;
  color: var(--color-text-secondary);
}
.ac-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.ac-item {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
  line-height: 1.55;
}
.ac-mark {
  flex: none;
  color: var(--color-primary, #2563eb);
  font-size: 11px;
  line-height: 1.9;
}
.ac-source {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
}
.ac-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary, #2563eb);
  font-family: var(--font-family-mono);
  font-size: 11px;
  word-break: break-all;
  cursor: pointer;
  text-align: left;
}
.ac-tag {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--color-warning);
  color: #fff;
  font-size: 10px;
}
.ac-miss-text {
  margin: 4px 0 0;
}
.ac-miss-terms {
  margin: 2px 0 0;
  font-family: var(--font-family-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  word-break: break-all;
}
.ac-miss-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}
</style>
