/**
 * 浏览器内 Python 语法树解析（「代码 → 工作区」AST 路径的宿主）
 *
 * 与试运行共用同一个 worker 脚本，但走 `mode: 'ast'` 分支：只跑转储脚本
 * （内部只有 `ast.parse`，没有 exec/eval），不碰 stdout 通道，也不参与试运行的
 * busy 协议——解析和试运行可以同时进行，互不 terminate。
 *
 * 为什么不复用 `runPythonInBrowser`：那个入口的语义是「执行用户代码并收集输出」，
 * 把解析塞进去会让 busy 锁、输出上限、终止协议全部纠缠在一起。这里只借同一个
 * worker 文件，协议另开一种消息类型。
 */

import type { RuntimeAssets } from '@cc/runtime/contracts/run-chain';

const PARSE_TIMEOUT_MS = 45_000;

let parseWorker: Worker | null = null;

export function parsePythonAst(script: string, assets?: RuntimeAssets): Promise<string> {
  let worker: Worker;
  try {
    worker =
      parseWorker ??
      (parseWorker = new Worker(new URL('./python-runner.worker.ts', import.meta.url), {
        type: 'module',
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.reject(new Error(`解析 worker 起不来：${message}`));
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish();
      reject(new Error('语法树解析超时（45 秒）'));
    }, PARSE_TIMEOUT_MS);

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }

    function onError(event: ErrorEvent): void {
      finish();
      reject(new Error(event.message || '解析 worker 出错'));
    }

    function onMessage(event: MessageEvent): void {
      const data = event.data as { type?: string; json?: string; message?: string } | undefined;
      if (data?.type === 'ast' && typeof data.json === 'string') {
        finish();
        resolve(data.json);
        return;
      }
      if (data?.type === 'ast_error') {
        finish();
        reject(new Error(String(data.message ?? 'Pyodide 解析失败')));
      }
    }

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ mode: 'ast', code: script, assets });
  });
}
