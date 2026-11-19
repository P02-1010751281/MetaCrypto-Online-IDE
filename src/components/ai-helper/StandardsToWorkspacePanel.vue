<template>
  <!-- A 线「标准 → 工作区」：标准切片 → 条款单元 → 三档判据 + 缺口 + 原文锚点 + 人签核。
       仍然不生成工作区；判据是机器候选（构建期产物），所以「未验证 / 待签核」必须摆在
       判据旁边而不是藏在脚注里。签核只记「谁在什么时候对哪一条签了什么」，并绑定数据
       指纹：产物重生成后条款变了，旧签核显示为「数据已变，需复核」。 -->
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

        <div class="stw-signoffbar">
          <span class="stw-signoff-summary">
            {{ uiFormat('stwSignoffSummary', signoffCounts) }}
            <span v-if="signoffSummary.stale" class="stw-signoff-stale">· {{ uiFormat('stwSignoffStale', { count: signoffSummary.stale }) }}</span>
          </span>
          <button
            type="button"
            class="stw-signoff-export"
            :disabled="!signoffTotal"
            :title="signoffTotal ? ui('stwSignoffExport') : ui('stwSignoffExportEmpty')"
            @click="exportSignoff"
          >{{ ui('stwSignoffExport') }}</button>
        </div>
        <p v-if="signoffError" class="stw-error">{{ signoffError }}</p>

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

          <!-- 试点工程：判据说「能搭」，这里给出同一份切片真搭出来的工程。
               打开只在本机复制一份可编辑记录，不生成工作区、也不改构建制品。 -->
          <section v-if="standard.pilot" class="stw-section stw-pilot">
            <h4 class="stw-h4">{{ ui('stwPilotTitle') }}</h4>
            <p class="stw-pilot-name">{{ standard.pilot.name }}</p>
            <p class="stw-pilot-meta">
              {{ uiFormat('stwPilotMeta', { files: standard.pilot.files.length, blocks: standard.pilot.blocks }) }}
              · <code class="stw-block">{{ standard.pilot.artifact }}</code>
            </p>
            <p class="stw-pilot-note">{{ ui('stwPilotNote') }}</p>
            <div class="stw-pilot-actions">
              <button type="button" class="stw-btn" :disabled="pilotBusy" @click="openPilot(false)">
                {{ pilotBusy ? ui('stwPilotOpening') : ui('stwPilotOpen') }}
              </button>
              <template v-if="pilotConfirm">
                <button type="button" class="stw-btn stw-btn--sign" :disabled="pilotBusy" @click="openPilot(true)">
                  {{ ui('stwPilotReplace') }}
                </button>
                <button type="button" class="stw-btn" @click="openExistingPilot">
                  {{ ui('stwPilotOpenExisting') }}
                </button>
                <button type="button" class="stw-btn" @click="dismissPilotConfirm">{{ ui('stwPilotCancel') }}</button>
              </template>
            </div>
            <p v-if="pilotConfirm" class="stw-signoff-hint">{{ ui('stwPilotReplaceConfirm') }}</p>
            <p v-if="pilotError" class="stw-error">{{ uiFormat('stwPilotOpenFailed', { message: pilotError }) }}</p>
          </section>

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

                <section class="stw-section stw-signoff-section">
                  <h4 class="stw-h4">{{ ui('stwSignoffSection') }}</h4>
                  <p class="stw-signoff-state">
                    <span class="stw-signoff-badge" :class="`stw-signoff-badge--${signoffOf(clause).status}`">
                      {{ signoffStatusLabel(signoffOf(clause).status) }}
                    </span>
                    <span v-if="signoffOf(clause).record" class="stw-signoff-meta">
                      {{ signoffMeta(signoffOf(clause).record as SignoffRecord) }}
                    </span>
                  </p>
                  <p v-if="signoffOf(clause).status === 'stale'" class="stw-signoff-stale">
                    {{ ui('stwSignoffStaleOne') }}
                  </p>
                  <p v-if="signoffOf(clause).record?.note" class="stw-signoff-note">
                    {{ signoffOf(clause).record?.note }}
                  </p>
                  <div class="stw-signoff-form">
                    <input
                      v-model="operatorDraft"
                      class="stw-input"
                      :placeholder="ui('stwSignoffOperatorPlaceholder')"
                      :aria-label="ui('stwSignoffOperator')"
                    />
                    <input
                      v-model="noteDraft"
                      class="stw-input"
                      :placeholder="ui('stwSignoffNotePlaceholder')"
                      :aria-label="ui('stwSignoffNote')"
                    />
                    <button type="button" class="stw-btn stw-btn--sign" :disabled="!operatorDraft.trim()" @click="decide(clause, 'signed')">
                      {{ ui('stwSignoffSign') }}
                    </button>
                    <button type="button" class="stw-btn stw-btn--reject" :disabled="!operatorDraft.trim()" @click="decide(clause, 'rejected')">
                      {{ ui('stwSignoffReject') }}
                    </button>
                    <button v-if="signoffOf(clause).record" type="button" class="stw-btn" @click="revoke(clause)">
                      {{ ui('stwSignoffRevoke') }}
                    </button>
                  </div>
                  <p v-if="!operatorDraft.trim()" class="stw-signoff-hint">{{ ui('stwSignoffNeedOperator') }}</p>
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
import { useRouter } from 'vue-router';

import { ui, uiFormat } from '@/composables/locale';
import { openPilotProject } from '@/services/ai-helper/pilotProjects';
import {
  buildSignoffExport,
  clauseSignoffState as readClauseSignoff,
  indexFingerprint as indexFingerprintOf,
  loadOperator,
  loadSignoffBook,
  recordDecision,
  revokeDecision,
  saveOperator,
  saveSignoffBook,
  summarizeSignoff,
  type ClauseSignoffState,
  type SignoffBook,
  type SignoffDecision,
  type SignoffRecord,
} from '@/services/ai-helper/signoff';
import {
  anchorLineLabel,
  loadVerdictsIndex,
  summarizeStandard,
  type ClauseVerdict,
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

/* 试点工程：制品只在点击后读入；「本机已有同一份」的覆盖确认与签核表单互不相干。 */
const router = useRouter();
const pilotBusy = ref(false);
const pilotConfirm = ref(false);
const pilotExistingId = ref<number | null>(null);
const pilotError = ref('');

/* 人签核：记录存本地（没有后端），界面只负责记录与展示，不因此把判据说成结论。 */
const signoff = ref<SignoffBook>({ schemaVersion: 1, indexFingerprint: '', records: [] });
const signoffError = ref('');
const operatorDraft = ref('');
const noteDraft = ref('');

const standard = computed<StandardVerdict | null>(() => {
  const loaded = index.value;
  if (!loaded) return null;
  return loaded.standards.find((item) => item.standard.id === activeStandardId.value) ?? loaded.standards[0];
});

const summary = computed(() =>
  standard.value ? summarizeStandard(standard.value) : { clauses: 0, build: 0, partial: 0, missing: 0, gaps: 0 },
);

const sourceHash = computed(() => standard.value?.inputs.anchorsSource?.sha256.slice(0, 12) ?? '—');

const signoffSummary = computed(() =>
  standard.value ? summarizeSignoff(signoff.value, standard.value) : { signed: 0, rejected: 0, stale: 0, pending: 0 },
);
const signoffTotal = computed(
  () => signoffSummary.value.signed + signoffSummary.value.rejected + signoffSummary.value.stale,
);
const signoffCounts = computed(() => ({
  signed: signoffSummary.value.signed,
  rejected: signoffSummary.value.rejected,
  pending: signoffSummary.value.pending,
}));

onMounted(async () => {
  const stored = loadSignoffBook();
  signoff.value = stored.book;
  if (stored.error) signoffError.value = stored.error;
  operatorDraft.value = loadOperator();
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
  dismissPilotConfirm();
  pilotError.value = '';
}

/**
 * 打开试点工程：读制品 → 写一条本机项目 → 导航过去。
 *
 * 已有同一份时**先不写库**，只回报 id 让用户选（覆盖 / 打开现有 / 取消）：
 * 覆盖会丢掉那份工程里的改动，不能由一次点击代用户决定。
 */
async function openPilot(replace: boolean): Promise<void> {
  const pilot = standard.value?.pilot;
  if (!pilot || pilotBusy.value) return;
  pilotBusy.value = true;
  pilotError.value = '';
  try {
    const outcome = await openPilotProject(pilot, { replace });
    if (outcome.status === 'needs-replace-confirm') {
      pilotExistingId.value = outcome.existingId;
      pilotConfirm.value = true;
      return;
    }
    pilotConfirm.value = false;
    pilotExistingId.value = null;
    await router.push(`/editor/${outcome.id}`);
  } catch (error) {
    pilotError.value = (error as Error).message;
  } finally {
    pilotBusy.value = false;
  }
}

/** 「打开现有」不重写内容，只导航——那份工程可能已经被用户改过。 */
function openExistingPilot(): void {
  const id = pilotExistingId.value;
  if (id === null) return;
  pilotConfirm.value = false;
  void router.push(`/editor/${id}`);
}

function dismissPilotConfirm(): void {
  pilotConfirm.value = false;
  pilotExistingId.value = null;
}

function toggleClause(clauseId: string): void {
  expandedClauseId.value = expandedClauseId.value === clauseId ? '' : clauseId;
}

function openAnchor(anchor: VerdictAnchor): void {
  emit('open-source', { doc: anchor.click.doc, line: anchor.click.line_start });
}

const SIGNOFF_STATUS_KEYS: Record<ClauseSignoffState['status'], string> = {
  none: 'stwSignoffPending',
  signed: 'stwSignoffSigned',
  rejected: 'stwSignoffRejected',
  stale: 'stwSignoffStaleBadge',
};

function signoffOf(clause: ClauseVerdict): ClauseSignoffState {
  return standard.value
    ? readClauseSignoff(signoff.value, standard.value.standard.id, clause)
    : { status: 'none' };
}

function signoffStatusLabel(status: ClauseSignoffState['status']): string {
  return ui(SIGNOFF_STATUS_KEYS[status]);
}

function signoffMeta(record: SignoffRecord): string {
  return uiFormat('stwSignoffMeta', { operator: record.operator, time: formatSignoffTime(record.at) });
}

/** 时间解析失败时原样显示 ISO 串——宁可难看，也不要把坏记录显示成「Invalid Date」。 */
function formatSignoffTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function decide(clause: ClauseVerdict, decision: SignoffDecision): void {
  const current = standard.value;
  const loaded = index.value;
  if (!current || !loaded) return;
  try {
    const next = recordDecision(signoff.value, {
      standardId: current.standard.id,
      clause,
      decision,
      operator: operatorDraft.value,
      note: noteDraft.value,
      indexFingerprint: indexFingerprintOf(loaded),
    });
    signoff.value = next;
    saveSignoffBook(next);
    saveOperator(operatorDraft.value.trim());
    noteDraft.value = '';
    signoffError.value = '';
  } catch (decideError) {
    signoffError.value = (decideError as Error).message;
  }
}

function revoke(clause: ClauseVerdict): void {
  const current = standard.value;
  if (!current) return;
  const next = revokeDecision(signoff.value, current.standard.id, clause.clauseId);
  signoff.value = next;
  saveSignoffBook(next);
}

/**
 * 导出签核记录：自带制品指纹（导出时的 + 记录当时的），别人拿到能核对它绑的是哪一版数据。
 * 走 Blob + 临时 <a download>，不请求任何后端。
 */
function exportSignoff(): void {
  const loaded = index.value;
  if (!loaded) return;
  const payload = buildSignoffExport(signoff.value, loaded);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `standards-signoff-${payload.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
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
