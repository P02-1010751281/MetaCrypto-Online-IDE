import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  type CSSProperties,
  type ComputedRef,
  type Ref,
} from 'vue';

const MIN_RIGHT = 320;
const MIN_TOP = 160;
const MAX_RIGHT_RATIO = 0.55;

export interface EditorSplitOptions {
  /** 拖拽或断点切换后需要重绘画布时调用（BlocklyEditor.resizeWorkspace）。 */
  onResize?: () => void;
}

export interface EditorSplit {
  editorViewRef: Ref<HTMLElement | null>;
  codeStyle: ComputedRef<CSSProperties>;
  editorStyle: ComputedRef<CSSProperties>;
  onSplitDragStart: (event: MouseEvent) => void;
}

/**
 * 编辑器左右（宽屏）/上下（≤1200px 窄屏）拖拽分割逻辑。
 * 状态与 DOM 副作用从 App.vue 抽出，行为保持不变。
 */
export function useEditorSplit(options: EditorSplitOptions = {}): EditorSplit {
  const editorViewRef = ref<HTMLElement | null>(null);
  const rightWidth = ref<number | undefined>(undefined);
  const topHeight = ref<number | undefined>(undefined);

  let splitDragging = false;
  let rafId = 0;
  let dragRect: {
    top: number;
    right: number;
    width: number;
    height: number;
  } | null = null;
  let dragPos: { x: number; y: number } | null = null;
  const narrowMedia = window.matchMedia('(max-width: 1200px)');

  function isNarrowLayout(): boolean {
    return narrowMedia.matches;
  }

  const codeStyle = computed((): CSSProperties => {
    // NOTE: 必须在所有分支之前读取 topHeight/rightWidth，确保 Vue 正确追踪依赖
    // 否则从宽屏切到窄屏时，computed 依赖链断裂，永远返回 {}
    const _th = topHeight.value;
    const _rw = rightWidth.value;
    if (isNarrowLayout()) {
      if (_th !== undefined) {
        // 上下分栏：高度交给 flex 吃掉剩余空间。
        // 原来用 calc(100% - th)，百分比相对的是整块 editor-view（含工具栏），
        // 拖拽后代码栏会多出工具栏那一截并溢出视口底部。
        return { flex: '1 1 0%', minHeight: 0, width: '100%' };
      }
      // 未拖拽时不内联 flex，否则会盖掉 CSS 媒体查询里的 2:1 比例，退化成 1:1。
      return { width: '100%', minHeight: 0 };
    }
    if (_rw !== undefined) {
      return { width: `${_rw}px`, flex: 'none' };
    }
    return {};
  });

  const editorStyle = computed((): CSSProperties => {
    // NOTE: 必须在所有分支之前读取 topHeight/rightWidth，确保 Vue 正确追踪依赖
    const _th = topHeight.value;
    const _rw = rightWidth.value;
    const narrow = isNarrowLayout();
    if (narrow) {
      if (_th !== undefined) {
        return { height: `${_th}px`, flex: 'none', width: '100%' };
      }
      return { width: '100%' };
    }
    if (_rw !== undefined) {
      // 左栏宽度必须由 flex 计算：侧栏（248px）也在这个 flex 容器里，
      // calc(100% - 右栏) 会漏掉侧栏宽度，拖拽后左右两栏总和超出视口。
      return { flex: '1 1 0%', minWidth: 0 };
    }
    return {};
  });

  function applySplitDrag(): void {
    const pos = dragPos;
    const rect = dragRect;
    if (!pos || !rect) return;
    if (isNarrowLayout()) {
      const fromTop = pos.y - rect.top;
      const maxTop = rect.height * 0.7;
      topHeight.value = Math.max(MIN_TOP, Math.min(fromTop, maxTop));
    } else {
      const fromRight = rect.right - pos.x;
      const maxRight = rect.width * MAX_RIGHT_RATIO;
      rightWidth.value = Math.max(MIN_RIGHT, Math.min(fromRight, maxRight));
    }
    options.onResize?.();
  }

  function onSplitDragMove(event: MouseEvent): void {
    if (!splitDragging) return;
    event.preventDefault();
    // 记录最新位置，整个 handler 体 rAF 节流（每帧最多应用一次）
    dragPos = { x: event.clientX, y: event.clientY };
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applySplitDrag();
      });
    }
  }

  function onSplitDragEnd(): void {
    splitDragging = false;
    window.removeEventListener('mousemove', onSplitDragMove, { capture: true });
    window.removeEventListener('mouseup', onSplitDragEnd, { capture: true });
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    applySplitDrag();
    dragRect = null;
    dragPos = null;
  }

  function onSplitDragStart(event: MouseEvent): void {
    event.preventDefault();
    splitDragging = true;
    // 拖拽起点缓存容器 rect（期间不变），避免每次 mousemove 强制回流
    dragRect = editorViewRef.value?.getBoundingClientRect() ?? null;
    window.addEventListener('mousemove', onSplitDragMove, { capture: true });
    window.addEventListener('mouseup', onSplitDragEnd, { capture: true });
    document.body.style.cursor = isNarrowLayout() ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // 响应式布局切换时重置尺寸（nextTick 等 DOM 更新完）
  const onBreakpointChange = (): void => {
    if (narrowMedia.matches) {
      rightWidth.value = undefined;
    } else {
      topHeight.value = undefined;
    }
    nextTick(() => options.onResize?.());
  };
  narrowMedia.addEventListener('change', onBreakpointChange);

  onUnmounted(() => {
    if (splitDragging) {
      window.removeEventListener('mousemove', onSplitDragMove, {
        capture: true,
      });
      window.removeEventListener('mouseup', onSplitDragEnd, { capture: true });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    narrowMedia.removeEventListener('change', onBreakpointChange);
  });

  return {
    editorViewRef,
    codeStyle,
    editorStyle,
    onSplitDragStart,
  };
}
