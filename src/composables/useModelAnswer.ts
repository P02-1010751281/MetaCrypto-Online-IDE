/**
 * D 线「让模型选句」的界面状态（一次用户操作 = 最多一次模型调用，§3.4）。
 *
 * 这一层只做三件事：把答案草稿摊成候选句、调一次适配器、把结果投影回原文句。
 * 它不判断「模型答得好不好」——那由 `verifyRewrite`/`applySelection` 与答案卡上的
 * 出处逐字校验兜底；界面只负责把「用了多少 token、等了多久、为什么失败」如实显示出来。
 *
 * 失败一律不吞：`error` 带稳定 code，卡片按 code 给一句人话；同时**保留检索答案**，
 * 用户的这次提问不会因为模型抽风而变成空白。
 */

import { computed, ref } from 'vue';

import type { AnswerResult } from '@/services/ai-helper/doc-answer';
import { applySelection } from '@/services/ai-helper/model/apply';
import {
  checkConfig,
  clearModelConfig,
  loadModelConfig,
  sameModelConfig,
  saveModelConfig,
  type ConfigIssue,
  type ModelConfig,
  type ModelConfigDraft,
  type StorageLike,
} from '@/services/ai-helper/model/config';
import { DEFAULT_MAX_SELECTIONS } from '@/services/ai-helper/model/limits';
import {
  estimateCost,
  loadModelPricing,
  saveModelPricing,
  type CostEstimate,
  type ModelPricing,
} from '@/services/ai-helper/model/pricing';
import { callModel, ModelCallError, type TokenUsage } from '@/services/ai-helper/model/provider';
import type { CandidateSentence, RewriteRequest } from '@/services/ai-helper/model/types';
import { planNotes, type AuditedNote, type NoteDrop } from '@/services/ai-helper/model/notes';
import type { RewriteViolationCode } from '@/services/ai-helper/model/verify';

export interface ModelFailure {
  readonly code: ModelCallError['code'] | 'verify';
  readonly status?: number;
  /** 诊断用原文（码与 id 的拼串）；界面文案走 `modelFailureTexts` 的分类，不读这一串。 */
  readonly message: string;
  /**
   * `code === 'verify'` 时被拒的越界类别（已去重、按出现顺序）。
   *
   * 五类越界的原因完全不同（编了 id / 重复选 / 超上限 / 说明没依据 / 说明引用了候选外），
   * 界面必须逐类说话——共用一个「选中句子不在候选里」会把「缺 support」说成另一回事。
   */
  readonly violations?: readonly RewriteViolationCode[];
}

export interface ModelOutcome {
  /** 通过校验的选择（按模型顺序，文本仍是原文）；null = 没有可用的模型结果。 */
  readonly sentences: CandidateSentence[] | null;
  readonly usage: TokenUsage | null;
  readonly elapsedMs: number | null;
  /**
   * 模型自述（逐句已核对依据）：只作界面提示，明确标注「不进答案证据」。
   *
   * 与答案句**分区显示**：自述没有出处、不能逐字回链，混在答案里会让人以为
   * 「原文就是这么写的」。`droppedNotes` 里是被丢弃的句子（没标依据 / 依据越界 / 重复）。
   */
  readonly notes: readonly AuditedNote[];
  readonly droppedNotes: readonly NoteDrop[];
  readonly failure: ModelFailure | null;
}

/**
 * 把答案草稿摊成候选句：**只取最佳答案那一段**，按行号去重，最多 5 句。
 *
 * 不把 `others`（其它文档的段落）混进来是刻意的：答案卡的出处锚点是「最佳段落」这一个
 * `path:line`，而模型能选中其它文档的句子时，卡片上的出处就会指错文件。候选只来自同一段，
 * 选谁都不改变出处，逐字校验才站得住。
 */
export function candidatesFromAnswer(result: AnswerResult): CandidateSentence[] {
  const best = result.best;
  if (!best) return [];

  const seen = new Set<number>();
  const candidates: CandidateSentence[] = [];
  for (const sentence of best.sentences) {
    if (seen.has(sentence.line)) continue;
    seen.add(sentence.line);
    candidates.push({
      id: `s${candidates.length + 1}`,
      path: best.evidence.path,
      line: sentence.line,
      text: sentence.text,
    });
    if (candidates.length >= DEFAULT_MAX_SELECTIONS) break;
  }
  return candidates;
}

/** 浏览器存储：取不到（SSR / 隐私模式）时落内存实现，面板照常可用但不跨刷新。 */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function browserStorages(): { session: StorageLike; local: StorageLike } {
  if (typeof window === 'undefined') return { session: memoryStorage(), local: memoryStorage() };
  try {
    return { session: window.sessionStorage, local: window.localStorage };
  } catch {
    // 隐私模式/禁用存储：降级到内存，不抛给界面
    return { session: memoryStorage(), local: memoryStorage() };
  }
}

export function useModelAnswer() {
  const storages = browserStorages();
  const loaded = loadModelConfig(storages.session, storages.local);
  const config = ref<ModelConfig | null>(loaded.config);
  const remembered = ref(loaded.remembered);
  /** 单价独立于 key 存储：不是密钥，没必要每开一个标签页重填。 */
  const pricing = ref<ModelPricing | null>(loadModelPricing(storages.local));
  /** 默认关：用户不勾就不发任何外部请求。 */
  const enabled = ref(false);
  const running = ref(false);
  const usage = ref<TokenUsage | null>(null);
  const elapsedMs = ref<number | null>(null);
  const notes = ref<AuditedNote[]>([]);
  const droppedNotes = ref<NoteDrop[]>([]);
  const failure = ref<ModelFailure | null>(null);
  const selected = ref<CandidateSentence[] | null>(null);

  const configured = computed(() => config.value !== null);
  /** 本次调用的估算金额；没填单价 / 没有用量时为 null（界面就不显示费用）。 */
  const cost = computed<CostEstimate | null>(() => estimateCost(usage.value, pricing.value));

  function adopt(next: { config: ModelConfig | null; remembered: boolean }): void {
    config.value = next.config;
    remembered.value = next.remembered;
  }

  /**
   * 保存配置。第三个参数缺省 = 「这次没改单价」，沿用当前值——
   * 单独保存 key 的路径不该顺手把用户的价目清掉。
   */
  function save(
    draft: ModelConfigDraft,
    remember: boolean,
    nextPricing: ModelPricing | null = pricing.value,
  ): { ok: boolean; issues: readonly ConfigIssue[] } {
    const { check, config: normalized } = checkConfig(draft);
    if (!check.ok) return { ok: false, issues: check.issues };
    saveModelConfig({ config: normalized, remember }, storages.session, storages.local);
    saveModelPricing(nextPricing, storages.local);
    pricing.value = nextPricing;
    // 内容没变就保留原对象引用：界面按 `config` 身份触发调用，换引用等于白烧一次额度
    // （「只改记住」也会走到这里，见 config.ts 的 sameModelConfig）。
    const unchanged = sameModelConfig(config.value, normalized);
    adopt({ config: unchanged ? config.value : normalized, remembered: remember });
    return { ok: true, issues: [] };
  }

  function clear(): void {
    clearModelConfig(storages.session, storages.local);
    adopt({ config: null, remembered: false });
    resetOutcome();
  }

  function resetOutcome(): void {
    usage.value = null;
    elapsedMs.value = null;
    notes.value = [];
    droppedNotes.value = [];
    failure.value = null;
    selected.value = null;
  }

  /**
   * 跑一次模型选句。
   *
   * 返回的 `sentences` 为 null 表示「这次不用模型结果」：没开、没配置、候选为空、
   * 调用失败或校验没过——四种都保留检索答案，卡片只多一行原因。
   */
  async function select(result: AnswerResult, question: string): Promise<ModelOutcome> {
    resetOutcome();
    const candidates = candidatesFromAnswer(result);
    const empty: ModelOutcome = {
      sentences: null,
      usage: null,
      elapsedMs: null,
      notes: [],
      droppedNotes: [],
      failure: null,
    };
    if (!enabled.value || !config.value || candidates.length === 0) return empty;

    running.value = true;
    const request: RewriteRequest = { question: question.trim(), candidates };
    try {
      const outcome = await callModel(config.value, request);
      usage.value = outcome.usage;
      elapsedMs.value = outcome.elapsedMs;
      // 自述先核：它只影响自己的显示，与选择能不能用无关（丢弃逐句进行，见 planNotes）。
      const plan = planNotes(request, outcome.result);
      notes.value = [...plan.kept];
      droppedNotes.value = [...plan.dropped];

      const applied = applySelection(request, outcome.result);
      if (!applied.ok) {
        failure.value = {
          code: 'verify',
          violations: [...new Set(applied.errors.map((error) => error.code))],
          message: applied.errors.map((error) => `${error.code}${error.id ? `(${error.id})` : ''}`).join(', '),
        };
        // 选择被拒则自述一并作废：它解释的是那份被拒的选择，留着会读成「模型给了答案」。
        notes.value = [];
        droppedNotes.value = [];
        return { sentences: null, usage: outcome.usage, elapsedMs: outcome.elapsedMs, notes: [], droppedNotes: [], failure: failure.value };
      }
      selected.value = [...applied.sentences];
      return {
        sentences: [...applied.sentences],
        usage: outcome.usage,
        elapsedMs: outcome.elapsedMs,
        notes: notes.value,
        droppedNotes: droppedNotes.value,
        failure: null,
      };
    } catch (error) {
      const failureValue: ModelFailure =
        error instanceof ModelCallError
          ? { code: error.code, ...(error.status === undefined ? {} : { status: error.status }), message: error.message }
          : { code: 'network', message: error instanceof Error ? error.message : String(error) };
      failure.value = failureValue;
      notes.value = [];
      droppedNotes.value = [];
      return { sentences: null, usage: null, elapsedMs: null, notes: [], droppedNotes: [], failure: failureValue };
    } finally {
      running.value = false;
    }
  }

  return {
    config,
    remembered,
    pricing,
    configured,
    enabled,
    running,
    usage,
    elapsedMs,
    cost,
    notes,
    droppedNotes,
    failure,
    selected,
    save,
    clear,
    select,
    resetOutcome,
  };
}
