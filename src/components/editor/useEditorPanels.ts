/**
 * 编辑器辅助面板：函数模板、文档检索，以及窄屏判定。
 *
 * 三者放一起是因为它们共享一条布局约束——窄屏（≤1200px）没有第三栏空间，
 * 函数模板必须退回归浮层，否则会把画布挤掉。判定和面板状态分开写，容易出现
 * 「面板还是停靠态但宽度已经不够」的半坏状态。
 */
import { onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ui } from '@/composables/locale';
import { planDocHit } from '@/services/ai-helper/doc-hit-target';
import type { DocHit } from '@/services/ai-helper/doc-search';

const NARROW_VIEWPORT_QUERY = '(max-width: 1200px)';

interface Options {
  notify: (message: string, duration?: number) => void;
}

export function useEditorPanels(options: Options) {
  const { notify } = options;
  const router = useRouter();

  const showCryptoPanel = ref(false);
  const showDocSearch = ref(false);

  const narrowQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
  const isNarrowViewport = ref(narrowQuery.matches);
  const syncNarrowViewport = (): void => {
    isNarrowViewport.value = narrowQuery.matches;
  };
  narrowQuery.addEventListener('change', syncNarrowViewport);
  onUnmounted(() => narrowQuery.removeEventListener('change', syncNarrowViewport));

  const toggleFunctionsPanel = (): void => {
    showCryptoPanel.value = !showCryptoPanel.value;
  };
  const closeFunctionsPanel = (): void => {
    showCryptoPanel.value = false;
  };
  const toggleDocSearch = (): void => {
    showDocSearch.value = !showDocSearch.value;
  };
  const closeDocSearch = (): void => {
    showDocSearch.value = false;
  };

  /**
   * 打开检索结果：决策在 `planDocHit`（纯函数、有单测），这里只产生副作用。
   * Markdown 命中优先新标签页（保留编辑器状态），被拦截时退回本页路由；
   * PDF 命中不跳转，只提示/复制「路径 + 页码」（原文不随应用分发）。
   */
  function onOpenDocHit(hit: DocHit): void {
    showDocSearch.value = false;
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
    showCryptoPanel,
    showDocSearch,
    isNarrowViewport,
    toggleFunctionsPanel,
    closeFunctionsPanel,
    toggleDocSearch,
    closeDocSearch,
    onOpenDocHit,
  };
}
