/**
 * Python 试运行 worker：在独立线程里用 Pyodide 执行生成的代码。
 *
 * 为什么用 worker：Python 死循环不能卡住编辑器主线程；worker.terminate()
 * 是唯一可靠的强制终止手段。Pyodide 运行时由 public/pyodide/ 提供
 * （见 scripts/copy-pyodide.mjs），同源加载、不访问外部 CDN。
 *
 * 终止确认协议（verify_terminal）：worker 收到 runPython 后进入同步执行，
 * 期间无法处理任何消息。主线程在收到终态消息后发一个随机 challenge，
 * 只有 worker 真的从 runPython 返回、回到事件循环才会回 ACK——
 * 这样就排除了「崩溃前最后一帧消息」被误判为正常结束。
 */
import type { RuntimeAssets } from './contracts/run-chain';

const OUTPUT_LIMIT_CHARS = 64 * 1024;
const OUTPUT_CHUNK_CHARS = 4096;
/** 进度上报节流（毫秒）：12MB 分块上报，10ms 一次会把主线程刷爆。 */
const PROGRESS_INTERVAL_MS = 100;

// Pyodide 没有可用的类型包（0.25 的 d.ts 依赖 node 类型），运行时按最小面使用。
interface PyodideRuntime {
  setStdout: (options: { raw: (value: number) => void }) => void;
  setStderr: (options: { raw: (value: number) => void }) => void;
  runPython: (code: string) => unknown;
}
type PyodideModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<PyodideRuntime>;
};

const scope = self as unknown as {
  location: { origin: string };
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  postMessage: (message: unknown) => void;
  addEventListener: (type: string, handler: (event: MessageEvent) => void) => void;
  onmessage: ((event: MessageEvent<{ code: string; assets?: RuntimeAssets }>) => void) | null;
};

let pyodide: PyodideRuntime | undefined;
let outputChars = 0;
let outputLimitSent = false;
let outputBuffer = '';

scope.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string; challenge?: string } | undefined;
  if (data?.type === 'verify_terminal' && typeof data.challenge === 'string') {
    scope.postMessage({ type: 'verified', challenge: data.challenge });
  }
});

function postOutput(value: string): void {
  if (outputLimitSent) return;
  const text = String(value);
  const remaining = OUTPUT_LIMIT_CHARS - outputChars;
  if (text.length > remaining) {
    if (remaining > 0) scope.postMessage({ type: 'output', text: text.slice(0, remaining) });
    outputLimitSent = true;
    scope.postMessage({ type: 'output_limit' });
    return;
  }
  outputChars += text.length;
  scope.postMessage({ type: 'output', text });
}

function flushOutput(): void {
  if (!outputBuffer || outputLimitSent) return;
  const text = outputBuffer;
  outputBuffer = '';
  postOutput(text);
}

/** Pyodide 的 raw stdout/stderr 回调按单字节喂 UTF-8，这里流式解码后再分块上报。 */
function rawOutput(decoder: TextDecoder, byte: Uint8Array): (value: number) => void {
  return (value: number) => {
    if (outputLimitSent) return;
    byte[0] = value;
    outputBuffer += decoder.decode(byte, { stream: true });
    if (
      outputBuffer.length >= OUTPUT_CHUNK_CHARS ||
      outputChars + outputBuffer.length > OUTPUT_LIMIT_CHARS
    ) {
      flushOutput();
    }
  };
}

/**
 * 下载进度：Pyodide 0.25.1 的这份构建不暴露 progressCallback（三个产物里
 * 该选项出现 0 次），所以只能自己量——拦截 worker 内的 fetch，按实际读到的
 * 字节上报。分母来自构建期写入的 manifest.json（scripts/copy-pyodide.mjs）。
 * pyodide.asm.js 走动态 import、不经过 fetch，因此不会计入；
 * 缺清单时 total=0，上层退回不确定态，加载本身不受影响。
 */
let runtimeTotalBytes = 0;
let runtimeLoadedBytes = 0;
let lastProgressAt = 0;

async function loadRuntimeManifest(indexURL: string, manifestUrl?: string): Promise<void> {
  try {
    const response = await scope.fetch(manifestUrl ?? new URL('manifest.json', indexURL).href, {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const manifest = (await response.json()) as { totalBytes?: unknown };
    const total = Number(manifest.totalBytes);
    if (Number.isFinite(total) && total > 0) runtimeTotalBytes = total;
  } catch (error) {
    // 显式降级：没有分母就报 total=0，界面显示不确定进度。
    runtimeTotalBytes = 0;
    console.warn('[python-runner] 下载进度清单不可用，改用不确定进度', error);
  }
}

function reportDownloaded(bytes: number): void {
  runtimeLoadedBytes += bytes;
  const now = Date.now();
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
  lastProgressAt = now;
  scope.postMessage({
    type: 'progress',
    loaded: runtimeLoadedBytes,
    total: runtimeTotalBytes,
  });
}

/** 包装同源 /pyodide/ 请求：边读边计数，其余请求原样透传。 */
function withDownloadProgress(
  indexURL: string,
  fallback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const response = await fallback(input, init);
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(indexURL) || !response.ok || !response.body) return response;
    const reader = response.body.getReader();
    // 保留原 headers：wasm 的 Content-Type 决定 instantiateStreaming 是否接受。
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        reportDownloaded(value.byteLength);
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

async function getPyodide(assets?: RuntimeAssets): Promise<PyodideRuntime> {
  if (pyodide) return pyodide;
  // 缺省仍走同源 public/pyodide/：单机版行为不变，宿主可显式注入其它位置。
  const indexURL = assets?.pyodideIndexUrl ?? new URL('/pyodide/', scope.location.origin).href;
  await loadRuntimeManifest(indexURL, assets?.manifestUrl);
  const plainFetch = scope.fetch;
  scope.fetch = withDownloadProgress(indexURL, plainFetch);
  let moduleURL = '';
  try {
    const response = await scope.fetch(new URL('pyodide.mjs', indexURL), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Pyodide 加载失败：HTTP ${response.status}`);
    const source = await response.text();
    // 用 Blob URL 动态 import：Vite 不会把 worker 内的 CDN 式 import 打进 bundle。
    moduleURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const module = (await import(/* @vite-ignore */ moduleURL)) as PyodideModule;
    pyodide = await module.loadPyodide({ indexURL });
  } finally {
    if (moduleURL) URL.revokeObjectURL(moduleURL);
    scope.fetch = plainFetch;
  }
  return pyodide;
}

scope.onmessage = async (event: MessageEvent<{ code: string; assets?: RuntimeAssets; mode?: string }>) => {
  // 解析分支（代码 → 工作区 AST 路径）：只执行转储脚本，脚本里只有 ast.parse，
  // 不执行用户代码；输出走专用消息，不占用试运行的 stdout 通道。
  if (event.data?.mode === 'ast') {
    try {
      const runtime = await getPyodide(event.data.assets);
      const result = runtime.runPython(event.data.code);
      const json =
        typeof result === 'string'
          ? result
          : ((result as { toString?: () => string })?.toString?.() ?? String(result));
      scope.postMessage({ type: 'ast', json });
    } catch (error) {
      scope.postMessage({
        type: 'ast_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  outputChars = 0;
  outputLimitSent = false;
  outputBuffer = '';
  runtimeLoadedBytes = 0;
  lastProgressAt = 0;
  let ready = false;
  try {
    const runtime = await getPyodide(event.data.assets);
    const byte = new Uint8Array(1);
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    runtime.setStdout({ raw: rawOutput(stdoutDecoder, byte) });
    runtime.setStderr({ raw: rawOutput(stderrDecoder, byte) });
    scope.postMessage({ type: 'ready' });
    ready = true;
    const result = runtime.runPython(event.data.code);
    if (result !== undefined) {
      const text =
        typeof result === 'string' ? result : ((result as { toString?: () => string })?.toString?.() ?? String(result));
      if (text) {
        flushOutput();
        postOutput(text);
      }
    }
    const destroyable = result as { destroy?: () => void } | undefined;
    if (destroyable && typeof destroyable.destroy === 'function') destroyable.destroy();
    outputBuffer += stdoutDecoder.decode() + stderrDecoder.decode();
    flushOutput();
    if (!outputLimitSent) scope.postMessage({ type: 'done' });
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as { message: unknown }).message
        : error;
    flushOutput();
    scope.postMessage({
      type: 'error',
      // load_failed 让调用方区分「运行时没装上」和「用户代码报错」
      errorCode: ready ? 'run_failed' : 'load_failed',
      error: String(message).slice(0, 2048),
    });
  }
};
// 标记为模块：否则两个 worker 文件同处全局脚本作用域，顶层声明会互相冲突。
export {};
