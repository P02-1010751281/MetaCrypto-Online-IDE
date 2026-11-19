/**
 * A 线面板的「单入口带进来的东西」：条目视图数据、匹配结论、以及挂载/更新时的应用。
 *
 * 为什么单独一个组合式函数：面板本体已经贴着 500 行上限，而这块逻辑与判据渲染无关——
 * 它只回答「你带来的东西像哪一份登记标准」和「认不出来时怎么说话」。
 *
 * 两条纪律：
 *   · 认出来就**预选**并说明依据，认不出来就明说，不拿第一条顶上；
 *   · 匹配不是核对：正文里出现编号只说明它提到了那份标准，字节是否相同由文件核对回答。
 */
import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';

import { ui, uiFormat } from '@/composables/locale';
import type { EntryNote, EntryStandard } from '@/services/ai-helper/standards-entry';
import { matchStandard } from '@/services/ai-helper/standards-match';
import type { VerdictsIndex } from '@/services/ai-helper/verdicts';

export interface StandardsIntakeInput {
  readonly name?: string;
  readonly text?: string;
}

interface Options {
  /** 已加载的判据索引；没加载完时先攒着，加载完再应用。 */
  index: Ref<VerdictsIndex | null>;
  /** 单入口带来的文档（A 线只用它匹配）。 */
  intake: () => StandardsIntakeInput | null | undefined;
  /** 命中时由面板把该条设为当前条目（面板负责收起展开中的条款）。 */
  onPick: (id: string) => void;
}

export function useStandardsIntake(options: Options) {
  const note = ref<EntryNote | null>(null);
  let pending: StandardsIntakeInput | null = options.intake() ?? null;

  const entryStandards = computed<EntryStandard[]>(() =>
    (options.index.value?.standards ?? []).map((item) => ({
      id: item.standard.id,
      name: item.standard.name,
      version: item.standard.version,
      checkedAt: item.standard.source_checked_at,
      sha256: item.inputs.anchorsSource?.sha256,
      path: item.inputs.anchorsSource?.path,
    })),
  );

  /** 索引加载完成后调用；没有待处理内容时是空操作。 */
  function applyIntake(): void {
    const loaded = options.index.value;
    const intake = pending;
    if (!loaded || !intake) return;
    pending = null;
    const match = matchStandard({ name: intake.name, text: intake.text }, loaded.standards.map((item) => item.standard));
    if (!match) {
      // 认不出就**清掉**上一条选中：留着上一份标准的判据等于让用户以为那就是他手上这份。
      options.onPick('');
      note.value = { tone: 'miss', text: ui('stwMatchMiss') };
      return;
    }
    options.onPick(match.id);
    note.value = { tone: 'hit', text: uiFormat('stwMatchHit', { token: match.token }) };
  }

  watch(options.intake, (value) => {
    pending = value ?? null;
    applyIntake();
  });

  /** 用户自己点了条目：之前的匹配说明不再成立。 */
  function clearNote(): void {
    note.value = null;
  }

  return { entryStandards, matchNote: note, applyIntake, clearNote };
}
