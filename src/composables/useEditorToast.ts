import { onUnmounted, ref } from 'vue';
import { errorHandler } from '@/utils/errorHandler';

/** Toast 默认停留时长（毫秒）。 */
const DEFAULT_DURATION = 1500;

/**
 * 编辑器底部/顶部提示条。
 *
 * 从 App.vue 抽出：Toast 既要承接用户操作反馈（保存、设入口），
 * 又要承接工作区错误事件，两处都需要同一套「先清旧定时器再显示」的逻辑，
 * 分散在页面里容易漏清理导致提示互相覆盖。
 */
export function useEditorToast() {
  const visible = ref(false);
  const message = ref('');
  const timers = new Set<number>();

  function track(action: () => void, delayMs: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      action();
    }, delayMs);
    timers.add(id);
    return id;
  }

  function clearTimers(): void {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  /** 立即显示一条提示；duration 为 0 表示不自动隐藏。 */
  function show(text: string, duration = DEFAULT_DURATION): void {
    clearTimers();
    message.value = text;
    visible.value = true;
    if (duration > 0) track(() => (visible.value = false), duration);
  }

  /** 延迟显示：用于等语言覆盖生效后再提示（避免提示文案比界面先切）。 */
  function showLater(text: string, delayMs: number, duration = DEFAULT_DURATION): void {
    clearTimers();
    track(() => show(text, duration), delayMs);
  }

  function hide(): void {
    clearTimers();
    visible.value = false;
  }

  // 工作区错误（例如工作区块嵌套超限）统一走同一个提示面。
  const removeWorkspaceErrorListener = errorHandler.addListener((error) => {
    if (error.type !== 'WORKSPACE_ERROR') return;
    show(error.message, 6000);
  });

  onUnmounted(() => {
    clearTimers();
    removeWorkspaceErrorListener();
  });

  return { visible, message, show, showLater, hide };
}
