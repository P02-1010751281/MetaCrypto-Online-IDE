import { computed, ref } from 'vue';
import { ui } from '@/composables/locale';
import type { CodeLanguage } from '@/constants/code-languages';
import {
  runJavaScriptInBrowser,
  runPythonInBrowser,
  type RunProgress,
  type RunResult,
} from '@/runtime/run-code';

/** 运行器错误码 → 界面文案键；未覆盖的走通用 runErrorRunFailed。 */
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  busy: 'runErrorBusy',
  timeout: 'runErrorTimeout',
  run_timeout: 'runErrorRunTimeout',
  load_timeout: 'runErrorLoadTimeout',
  output_limit: 'runErrorOutputLimit',
  worker_unavailable: 'runErrorWorkerUnavailable',
  worker_failed: 'runErrorWorkerFailed',
  load_failed: 'runErrorLoadFailed',
  run_failed: 'runErrorRunFailed',
};

/**
 * 代码试运行：把 CodePanel 当前的生成结果交给 run-code 的 worker 执行。
 * 本 composable 只负责状态与文案映射；执行细节（超时、输出上限、terminate）
 * 在 runtime/run-code 与 runtime/python-runner.worker。
 */
export function useCodeRunner() {
  const running = ref(false);
  const output = ref('');
  const hasRun = ref(false);
  const failed = ref(false);
  const outputVisible = ref(false);
  /** Python 运行时首次装载的字节进度；null 表示没有在装载 */
  const download = ref<{ loaded: number; total: number } | null>(null);
  /** 运行时已就绪，此后只是执行代码，不再显示下载进度 */
  const runtimeReady = ref(false);

  /** 0–99 的确定百分比；分母未知时为 null，界面显示不确定进度。 */
  const loadingPercent = computed<number | null>(() => {
    const info = download.value;
    if (!info || info.total <= 0) return null;
    return Math.max(0, Math.min(99, Math.round((info.loaded / info.total) * 100)));
  });

  /** 装载中的文案；运行中就绪后为空（此时只显示「运行中...」）。 */
  const loadingLabel = computed(() => {
    if (!running.value || runtimeReady.value) return '';
    const percent = loadingPercent.value;
    return percent === null
      ? ui('runLoadingRuntime')
      : `${ui('runLoadingRuntime')} ${percent}%`;
  });

  const statusText = computed(() => {
    if (running.value) {
      return runtimeReady.value ? ui('runningCode') : ui('runLoadingRuntime');
    }
    if (!hasRun.value) return ui('runOutputEmpty');
    return failed.value ? ui('runErrorRunFailed') : ui('runOutput');
  });

  function appendOutput(text: string): void {
    if (!text) return;
    output.value += text;
  }

  function clearOutput(): void {
    output.value = '';
    hasRun.value = false;
    failed.value = false;
  }

  /** 失败文案：统一走 i18n，运行器只回结构化的 errorCode / error 原文。 */
  function failureText(result: RunResult): string {
    const key = result.errorCode ? ERROR_MESSAGE_KEYS[result.errorCode] : undefined;
    const message = key ? ui(key) : ui('runErrorRunFailed');
    return result.error ? `${message}\n${result.error}` : message;
  }

  /** 没有可运行代码时，用同一个输出面给一句提示，而不是让按钮看起来没反应。 */
  function showHint(text: string): void {
    hasRun.value = true;
    failed.value = false;
    outputVisible.value = true;
    output.value = text;
  }

  /**
   * 只在装载阶段有意义的进度：ready 之后立刻收起，否则下载条会卡在
   * 「已下载 91%」（asm.js 走动态 import、不经 fetch）冒充执行进度。
   */
  function handleProgress(progress: RunProgress): void {
    if (progress.ready) {
      runtimeReady.value = true;
      download.value = null;
      return;
    }
    if (progress.loaded <= 0 && progress.total <= 0) return;
    download.value = { loaded: progress.loaded, total: progress.total };
  }

  async function run(code: string, language: CodeLanguage): Promise<void> {
    if (running.value) return;
    running.value = true;
    failed.value = false;
    hasRun.value = true;
    outputVisible.value = true;
    output.value = '';
    download.value = null;
    runtimeReady.value = false;
    try {
      const result =
        language === 'python'
          ? await runPythonInBrowser(code, appendOutput, handleProgress)
          : await runJavaScriptInBrowser(code, appendOutput);
      if (result.ok) {
        if (!output.value) output.value = ui('runNoOutput');
      } else {
        failed.value = true;
        appendOutput(`${output.value ? '\n' : ''}${failureText(result)}`);
      }
    } catch (error) {
      // run-code 内部已把可预期的失败转成 errorCode；这里兜住意外抛出，保证按钮状态复位。
      failed.value = true;
      appendOutput(failureText({ ok: false, error: String(error) }));
    } finally {
      running.value = false;
      download.value = null;
    }
  }

  return {
    running,
    output,
    hasRun,
    failed,
    outputVisible,
    loadingLabel,
    loadingPercent,
    statusText,
    run,
    showHint,
    clearOutput,
  };
}
