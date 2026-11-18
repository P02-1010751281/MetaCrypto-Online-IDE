<template>
  <!-- A 线「标准 → 工作区」的只读预览：标准切片 → 条款单元 → 三档判据 + 缺口 + 原文锚点。
       本轮只读：不生成工作区、不写签核状态。判据是机器候选（构建期产物），
       界面必须把「未验证 / 待签核」摆在判据旁边，而不是藏在脚注里。 -->
  <section
    v-if="visible"
    :class="docked ? 'stw-dock' : 'stw-overlay'"
    @click.self="docked ? undefined : emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="stw" role="dialog" :aria-modal="!docked" :aria-label="ui('standardsToWorkspace')">
      <div class="section-head section-head--divided">
        <span class="section-title">{{ ui('standardsToWorkspace') }}</span>
        <div class="section-actions">
          <button class="ghost-btn" :title="ui('closePanel')" :aria-label="ui('closePanel')" @click="emit('close')">×</button>
        </div>
      </div>

      <div class="stw-body">
        <p class="stw-lede">{{ ui('stwLede') }}</p>
        <p class="stw-signoff">{{ ui('stwSignoff') }}</p>

        <p v-if="error" class="stw-error">{{ uiFormat('stwError', { message: error }) }}</p>
        <p v-else-if="!index" class="stw-loading">{{ ui('loading') }}</p>

        <template v-else-if="standard">
          <!-- 标准切片：目前两份，切换只换数据，不换视图结构。 -->
          <div class="stw-standards" role="tablist" :aria-label="ui('standardsToWorkspace')">
            <button
              v-for="item in index.standards"
              :key="item.standard.id"
              type="button"
              role="tab"
              class="stw-standard"
              :class="{ active: item.standard.id === standard.standard.id }"
              :aria-selected="item.standard.id === standard.standard.id"
              @click="selectStandard(item.standard.id)"
            >
              <span class="stw-standard-name">{{ item.standard.name }}</span>
              <span class="stw-standard-meta">{{ item.standard.version ? `${item.standard.version} · ` : '' }}{{ item.standard.source_checked_at }}</span>
            </button>
          </div>

          <dl class="stw-counts">
            <div v-for="tier in TIERS" :key="tier" class="stw-count" :class="`stw-count--${tier}`">
              <dt>{{ tierLabel(tier) }}</dt>
              <dd>{{ summary[tier] }}</dd>
            </div>
            <div class="stw-count stw-count--gaps">
              <dt>{{ ui('stwGaps') }}</dt>
              <dd>{{ summary.gaps }}</dd>
            </div>
          </dl>

          <ul class="stw-clauses">
            <li v-for="clause in standard.clauses" :key="clause.clauseId" class="stw-clause">
              <button
                type="button"
                class="stw-clause-head"
                :aria-expanded="expandedClauseId === clause.clauseId"
                @click="toggleClause(clause.clauseId)"
              >
                <span class="stw-tier" :class="`stw-tier--${clause.tier}`">{{ tierLabel(clause.tier) }}</span>
                <span class="stw-clause-title">{{ clause.title }}</span>
                <span class="stw-clause-meta">
                  <span v-if="clause.standardPosition">{{ clause.standardPosition }}</span>
                  <span class="stw-sep">·</span>
                  <span>{{ uiFormat('stwStepCount', { count: clause.steps.length }) }}</span>
                </span>
              </button>

              <div v-if="expandedClauseId === clause.clauseId" class="stw-detail">
                <p class="stw-reason">{{ reasonLabel(clause.tierReason) }}</p>
                <p v-if="clause.evidenceLayer && clause.evidenceLayer !== 'none'" class="stw-evidence">{{ uiFormat('stwEvidence', { layer: clause.evidenceLayer }) }}</p>

                <ol class="stw-steps">
                  <li v-for="step in clause.steps" :key="step.id" class="stw-step">
                    <span class="stw-step-head">
                      <span v-if="step.section" class="stw-step-sec">{{ step.section }}</span>
                      <span class="stw-step-vis" :class="`stw-vis--${step.visibility}`">{{ visibilityLabel(step.visibility) }}</span>
                    </span>
                    <span class="stw-step-text">{{ step.text }}</span>
                    <span v-if="step.blocks.length" class="stw-blocks">
                      <code v-for="block in step.blocks" :key="block" class="stw-block">{{ block }}</code>
                    </span>
                    <span v-if="step.note" class="stw-step-note">{{ step.note }}</span>
                  </li>
                </ol>

                <section v-if="clause.gaps?.length" class="stw-section">
                  <h4 class="stw-h4">{{ ui('stwGaps') }}</h4>
                  <ul class="stw-list">
                    <li v-for="(gap, position) in clause.gaps" :key="position">{{ gap }}</li>
                  </ul>
                </section>

                <section v-if="clause.claimBoundaries?.length" class="stw-section">
                  <h4 class="stw-h4">{{ ui('stwClaimBoundaries') }}</h4>
                  <ul class="stw-list">
                    <li v-for="(item, position) in clause.claimBoundaries" :key="position">{{ item }}</li>
                  </ul>
                </section>

                <section v-if="clause.anchors.length" class="stw-section">
                  <h4 class="stw-h4">{{ ui('stwAnchors') }}</h4>
                  <div class="stw-anchors">
                    <button
                      v-for="anchor in clause.anchors"
                      :key="anchor.section"
                      type="button"
                      class="stw-anchor"
                      :title="anchor.click.doc"
                      @click="openAnchor(anchor)"
                    >{{ anchor.section }} · {{ anchorLineLabel(anchor) }}</button>
                  </div>
                </section>

              </div>
            </li>
          </ul>

          <p class="stw-provenance">
            {{ uiFormat('stwProvenance', { path: standard.inputs.anchorsSource?.path ?? '—', hash: sourceHash }) }}
          </p>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 只读预览的数据与交互都很薄：一次懒加载、一个展开中的条款、一份标准切换。
 * 所有判据文字都来自制品（tier / tierReason / gaps / claimBoundaries），组件不重新判定。
 */
import { computed, onMounted, ref } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import {
  anchorLineLabel,
  loadVerdictsIndex,
  summarizeStandard,
  type CoverageTier,
  type StandardVerdict,
  type StepVisibility,
  type VerdictAnchor,
  type VerdictsIndex,
} from '@/services/ai-helper/verdicts';

defineProps<{
  visible: boolean;
  /** docked：停靠进左栏；缺省（窄屏）是遮罩浮层。 */
  docked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-source', payload: { doc: string; line: number }): void;
}>();

const TIERS: readonly CoverageTier[] = ['build', 'partial', 'missing'];

const index = ref<VerdictsIndex | null>(null);
const error = ref('');
const activeStandardId = ref('');
const expandedClauseId = ref('');

const standard = computed<StandardVerdict | null>(() => {
  const loaded = index.value;
  if (!loaded) return null;
  return loaded.standards.find((item) => item.standard.id === activeStandardId.value) ?? loaded.standards[0];
});

const summary = computed(() =>
  standard.value ? summarizeStandard(standard.value) : { clauses: 0, build: 0, partial: 0, missing: 0, gaps: 0 },
);

const sourceHash = computed(() => standard.value?.inputs.anchorsSource?.sha256.slice(0, 12) ?? '—');

onMounted(async () => {
  try {
    const loaded = await loadVerdictsIndex();
    index.value = loaded;
    activeStandardId.value = loaded.standards[0].standard.id;
  } catch (loadError) {
    error.value = (loadError as Error).message;
  }
});

function selectStandard(id: string): void {
  activeStandardId.value = id;
  expandedClauseId.value = '';
}

function toggleClause(clauseId: string): void {
  expandedClauseId.value = expandedClauseId.value === clauseId ? '' : clauseId;
}

function openAnchor(anchor: VerdictAnchor): void {
  emit('open-source', { doc: anchor.click.doc, line: anchor.click.line_start });
}

const TIER_LABEL_KEYS: Record<CoverageTier, string> = {
  build: 'stwTierBuild',
  partial: 'stwTierPartial',
  missing: 'stwTierMissing',
};

const REASON_LABEL_KEYS: Record<string, string> = {
  'all-steps-canvas': 'stwReasonAllCanvas',
  'mixed-steps': 'stwReasonMixed',
  'internal-only': 'stwReasonInternalOnly',
  'non-executable': 'stwReasonNonExecutable',
};

const VISIBILITY_LABEL_KEYS: Record<StepVisibility, string> = {
  canvas: 'stwVisibilityCanvas',
  internal: 'stwVisibilityInternal',
  none: 'stwVisibilityNone',
};

function tierLabel(tier: CoverageTier): string {
  return ui(TIER_LABEL_KEYS[tier]);
}

/** 判据原因来自制品；新增枚举时退回原始串，而不是画成空白。 */
function reasonLabel(reason?: string): string {
  if (!reason) return '';
  return REASON_LABEL_KEYS[reason] ? ui(REASON_LABEL_KEYS[reason]) : reason;
}

function visibilityLabel(visibility: StepVisibility): string {
  return ui(VISIBILITY_LABEL_KEYS[visibility]);
}
</script>

<style scoped src="./standards-to-workspace.css"></style>
