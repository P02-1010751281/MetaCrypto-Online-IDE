/**
 * 浏览器内试运行生成的代码。
 *
 * 定位（与「生成代码」严格区分）：这里只做**用户自测**——把编辑器生成的
 * Python / JavaScript 拿去跑一遍看输出，不构成任何形式的密码学验证，也不是
 * 安全边界。Python 走 Pyodide worker（public/pyodide/），JS 走 js-runner worker；
 * 两者都用 terminate() 兜住死循环。
 */

import type { RunProgress, RunResult, RuntimeAssets } from '@/runtime/contracts/run-chain';

const PYTHON_LOAD_TIMEOUT_MS = 45_000;
const PYTHON_RUN_TIMEOUT_MS = 10_000;
const PYTHON_OUTPUT_LIMIT_CHARS = 64 * 1024;
const PYTHON_OUTPUT_LIMIT_MESSAGES = 1000;
const JS_OUTPUT_LIMIT_CHARS = 64 * 1024;
const JS_OUTPUT_LIMIT_MESSAGES = 1000;

// 契约的权威定义在 @/runtime/contracts/run-chain（与 metacrypt 逐字节一致）。
// 这里 re-export，既有调用方的 import 路径与类型名保持不变。
export type {
  RunErrorCode,
  RunProgress,
  RunResult,
} from '@/runtime/contracts/run-chain';

let pythonWorker: Worker | null = null;
let pythonBusy = false;

export async function runPythonInBrowser(
  code: string,
  onOutput: (text: string) => void,
  onProgress?: (progress: RunProgress) => void,
  assets?: RuntimeAssets,
  /**
   * 取消信号：调用方离开编辑器时用。取消走正常收尾路径（复位 busy、终止共享 worker），
   * 而不是把 worker 野杀——野杀不会让 Promise settle，busy 会永久卡住。
   */
  signal?: AbortSignal,
): Promise<RunResult> {
  if (pythonBusy) return { ok: false, errorCode: 'busy' };
  if (signal?.aborted) return { ok: false, error: 'cancelled' };
  pythonBusy = true;
  let worker: Worker;
  try {
    worker =
      pythonWorker ??
      (pythonWorker = new Worker(new URL('./python-runner.worker.ts', import.meta.url), {
        type: 'module',
      }));
  } catch (error) {
    pythonBusy = false;
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: 'worker_unavailable',
    };
  }

  return new Promise<RunResult>((resolve) => {
    let ready = false;
    let settled = false;
    let outputChars = 0;
    let outputMessages = 0;
    let pendingResult: RunResult | undefined;
    let pendingChallenge: string | undefined;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    const loadTimer = setTimeout(
      () => finish({ ok: false, errorCode: 'load_timeout' }, true),
      PYTHON_LOAD_TIMEOUT_MS,
    );

    const cleanup = (): void => {
      clearTimeout(loadTimer);
      if (runTimer) clearTimeout(runTimer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      pythonBusy = false;
    };

    const finish = (result: RunResult, resetWorker = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (resetWorker) {
        worker.terminate();
        if (pythonWorker === worker) pythonWorker = null;
      }
      resolve(result);
    };

    /** 取消：终止共享 worker 并置空，下次使用重新装载运行时（热缓存仍在浏览器里）。 */
    const onAbort = (): void => finish({ ok: false, error: 'cancelled' }, true);
    signal?.addEventListener('abort', onAbort);

    const onMessage = (event: MessageEvent): void => {
      const message = event.data as
        | {
            type?: string;
            text?: string;
            error?: string;
            errorCode?: string;
            challenge?: string;
            result?: string;
            loaded?: number;
            total?: number;
          }
        | undefined;
      const type = message?.type;
      if (type === 'progress') {
        onProgress?.({
          loaded: Number(message?.loaded ?? 0),
          total: Number(message?.total ?? 0),
          ready: false,
        });
        return;
      }
      if (type === 'output') {
        const text = String(message?.text ?? '');
        outputMessages += 1;
        const remaining = PYTHON_OUTPUT_LIMIT_CHARS - outputChars;
        if (outputMessages > PYTHON_OUTPUT_LIMIT_MESSAGES || text.length > remaining) {
          if (remaining > 0 && outputMessages <= PYTHON_OUTPUT_LIMIT_MESSAGES) {
            onOutput(text.slice(0, remaining));
          }
          finish({ ok: false, errorCode: 'output_limit' }, true);
          return;
        }
        outputChars += text.length;
        onOutput(text);
        return;
      }
      if (type === 'ready' && !ready) {
        ready = true;
        clearTimeout(loadTimer);
        onProgress?.({ loaded: 0, total: 0, ready: true });
        runTimer = setTimeout(
          () => finish({ ok: false, errorCode: 'run_timeout' }, true),
          PYTHON_RUN_TIMEOUT_MS,
        );
        return;
      }
      if (type === 'done') {
        verifyTerminal({ ok: true, result: message?.result });
        return;
      }
      if (type === 'output_limit') {
        finish({ ok: false, errorCode: 'output_limit' }, true);
        return;
      }
      if (type === 'error') {
        verifyTerminal({
          ok: false,
          error: String(message?.error || ''),
          errorCode: message?.errorCode === 'load_failed' ? 'load_failed' : 'run_failed',
        });
        return;
      }
      if (
        type === 'verified' &&
        message?.challenge === pendingChallenge &&
        pendingResult
      ) {
        finish(pendingResult, pendingResult.errorCode === 'load_failed');
      }
    };

    /** 终态消息不可直接采信：先让 worker 回 ACK，证明它真的回到了事件循环。 */
    const verifyTerminal = (result: RunResult): void => {
      if (pendingResult) return;
      const challenge = new Uint8Array(16);
      crypto.getRandomValues(challenge);
      pendingChallenge = Array.from(challenge, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      pendingResult = result;
      worker.postMessage({ type: 'verify_terminal', challenge: pendingChallenge });
    };

    const onError = (event: ErrorEvent): void =>
      finish({ ok: false, error: event.message, errorCode: 'worker_failed' }, true);

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ code, assets });
  });
}

/**
 * 浏览器内 JavaScript 试运行：同源模块 worker（见 js-runner.worker.ts）。
 * - 独立线程：terminate() 可终止死循环，编辑器不受影响
 * - worker 内重定向 console.log/warn/error → postMessage('output')
 * - async 生成器（WebCrypto 版 HMAC-SHA256）返回 Promise，worker 内 await
 * - 默认 10s 超时；网络不设限，仅作试运行
 */
export async function runJavaScriptInBrowser(
  code: string,
  onOutput: (text: string) => void,
  options?: {
    timeoutMs?: number;
    /** 取消信号：离开编辑器时终止当次 worker（每次运行各自一个，终止没有副作用）。 */
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const signal = options?.signal;
  if (signal?.aborted) return { ok: false, error: 'cancelled' };
  let worker: Worker;
  try {
    worker = new Worker(new URL('./js-runner.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: 'worker_unavailable',
    };
  }
  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let outputCount = 0;
    let outputChars = 0;
    let timer = 0;

    const finish = (result: RunResult): void => {
      if (settled) return; // 超时之后到达的消息一律丢弃
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve(result);
    };

    const onAbort = (): void => finish({ ok: false, error: 'cancelled' });
    signal?.addEventListener('abort', onAbort);

    timer = window.setTimeout(() => {
      finish({ ok: false, errorCode: 'timeout' });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; text?: string; error?: string } | undefined;
      // 只认运行器约定的消息类型；worker 仍只是试运行载体，不作安全边界。
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'output' && typeof data.text === 'string') {
        outputCount += 1;
        const remaining = JS_OUTPUT_LIMIT_CHARS - outputChars;
        if (outputCount > JS_OUTPUT_LIMIT_MESSAGES || data.text.length > remaining) {
          if (remaining > 0 && outputCount <= JS_OUTPUT_LIMIT_MESSAGES) {
            onOutput(data.text.slice(0, remaining));
          }
          finish({ ok: false, errorCode: 'output_limit' });
          return;
        }
        outputChars += data.text.length;
        onOutput(data.text);
        return;
      }
      if (data.type === 'output_limit') {
        finish({ ok: false, errorCode: 'output_limit' });
        return;
      }
      if (data.type === 'done') {
        finish({ ok: true });
        return;
      }
      if (data.type === 'error') {
        finish({ ok: false, error: String(data.error ?? '') });
      }
    };

    worker.onerror = (event: ErrorEvent): void => {
      finish({ ok: false, error: String(event.message || ''), errorCode: 'worker_failed' });
    };

    worker.postMessage({ code });
  });
}
