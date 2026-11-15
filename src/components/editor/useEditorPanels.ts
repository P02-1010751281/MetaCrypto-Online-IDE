/**
 * 编辑器辅助面板：侧栏 activity bar 的互斥面板状态、窄屏判定，以及文档命中的副作用。
 *
 * 对齐 metacrypt 的侧栏模型：左侧一条图标栏，点哪个在侧栏展开哪个面板，同一时刻只有一个。
 * 窄屏（≤1200px）判定单独放着，因为面板是否 docked 取决于它——窄屏没有第三栏空间，
 * 函数模板必须退回归浮层，否则会把画布挤掉。
 */
import { onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ui } from '@/composables/locale';
import { planDocHit } from '@/services/ai-helper/doc-hit-target';
import type { DocHit } from '@/services/ai-helper/doc-search';

const NARROW_VIEWPORT_QUERY = '(max-width: 1200px)';

/** 侧栏可展开的面板；`files` 是缺省页，再点一次当前图标回到它。 */
export type EditorPanel = 'projects' | 'files' | 'functions' | 'docSearch' | 'blockSearch';

const DEFAULT_PANEL: EditorPanel = 'files';

interface Options {
  notify: (message: string, duration?: number) => void;
}

export function useEditorPanels(options: Options) {
  const { notify } = options;
  const router = useRouter();

  const activePanel = ref<EditorPanel>(DEFAULT_PANEL);

  const narrowQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
  const isNarrowViewport = ref(narrowQuery.matches);
  const syncNarrowViewport = (): void => {
    isNarrowViewport.value = narrowQuery.matches;
  };
  narrowQuery.addEventListener('change', syncNarrowViewport);
  onUnmounted(() => narrowQuery.removeEventListener('change', syncNarrowViewport));

  /** 互斥切换：点当前面板回到缺省的文件页，点别的直接换过去。 */
  const togglePanel = (panel: EditorPanel): void => {
    activePanel.value = activePanel.value === panel ? DEFAULT_PANEL : panel;
  };
  const closePanel = (): void => {
    activePanel.value = DEFAULT_PANEL;
  };

  /**
   * 打开检索结果：决策在 `planDocHit`（纯函数、有单测），这里只产生副作用。
   * Markdown 命中优先新标签页（保留编辑器状态），被拦截时退回本页路由；
   * PDF 命中不跳转，只提示/复制「路径 + 页码」（原文不随应用分发）。
   */
  function onOpenDocHit(hit: DocHit): void {
    activePanel.value = DEFAULT_PANEL;
    const plan = planDocHit(hit, window.location.pathname);
    if (plan.kind === 'pdf-reference') {
      void navigator.clipboard
        ?.writeText(plan.reference)
        .then(() =>
          notify(`${ui('docSearchPdfCopied')}${plan.reference}`, 5000),
        )
        .catch(() =>
          notify(`${ui('docSearchPdfManual')}${plan.reference}`, 5000),
        );
      return;
    }
    const opened = window.open(plan.href, '_blank', 'noopener');
    if (!opened) {
      void router.push({
        name: 'Docs',
        query: {
          doc: hit.path.startsWith('/') ? hit.path : `/${hit.path}`,
          line: String(hit.line),
        },
      });
    }
  }

  return {
    activePanel,
    isNarrowViewport,
    togglePanel,
    closePanel,
    onOpenDocHit,
  };
}
