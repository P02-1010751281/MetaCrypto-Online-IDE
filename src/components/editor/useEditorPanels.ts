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
import { planDocHit, planDocLine } from '@/services/ai-helper/doc-hit-target';
import type { DocHit } from '@/services/ai-helper/doc-search';

const NARROW_VIEWPORT_QUERY = '(max-width: 1200px)';

/**
 * 侧栏可展开的面板；`files` 是缺省页，再点一次当前图标回到它。
 *
 * `assistant` 是 问答助手（查文档 / 查积木两个 tab 共用一个入口）：两个检索内核在壳里，
 * activity bar 上只留一个图标，切 tab 由 `AssistantPanel` 自己管。
 *
 * `code` 是 A/B 线的「从代码生成工作区」。它曾经是中心浮层 + 菜单项，现在也是左栏面板：
 * 同一份 `CodeToWorkspaceDialog` 加 `docked` 后停靠在栏里，不再盖住画布。面板可见性
 * 统一由这里拥有，`useCodeToWorkspaceImport` 只负责打开、载入与回执。
 *
 * `standards` 是 A 线「标准 → 工作区」的只读预览：标准切片 → 条款单元 → 三档判据。
 * 本轮只读（不生成工作区、不写签核）；数据来自构建期制品 `verdicts-index.json`。
 *
 * `intake` 是 A/B 单入口（PLAN P5）：activity bar 上只留一个图标，进来先判别文档/代码，
 * 判别结果可见可改，确认后路由到 `code` 或 `standards`。两个目标面板仍保留 id——
 * 菜单与路由都要能直接打开它们，只是不再各占一个图标。
 */
export type EditorPanel = 'projects' | 'files' | 'functions' | 'assistant' | 'intake' | 'code' | 'standards';

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
   * 明确要「打开」某个面板（菜单、文档命中等入口），不 toggle。
   * `togglePanel` 在「已经在这个面板」时会把面板收掉，从菜单点过去就会看起来没反应。
   */
  const openPanel = (panel: EditorPanel): void => {
    activePanel.value = panel;
  };

  /**
   * 打开某个 Markdown 的某一行：优先新标签页（保留编辑器状态），被拦截时退回本页路由。
   * 检索命中与 A 线条款锚点共用这一条，路径规则只在 `planDocLine` 里写一次。
   */
  function openDocLine(path: string, line: number): void {
    activePanel.value = DEFAULT_PANEL;
    const plan = planDocLine(path, line, window.location.pathname);
    if (plan.kind !== 'navigate') return;
    const opened = window.open(plan.href, '_blank', 'noopener');
    if (!opened) {
      void router.push({
        name: 'Docs',
        query: {
          doc: path.startsWith('/') ? path : `/${path}`,
          line: String(line),
        },
      });
    }
  }

  /**
   * 打开检索结果：决策在 `planDocHit`（纯函数、有单测），这里只产生副作用。
   * PDF 命中不跳转，只提示/复制「路径 + 页码」（原文不随应用分发）。
   */
  function onOpenDocHit(hit: DocHit): void {
    if (hit.kind !== 'pdf') {
      openDocLine(hit.path, hit.line);
      return;
    }
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
    }
  }

  return {
    activePanel,
    isNarrowViewport,
    togglePanel,
    closePanel,
    openPanel,
    openDocLine,
    onOpenDocHit,
  };
}
