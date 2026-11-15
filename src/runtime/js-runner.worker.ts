/**
 * JavaScript 试运行 worker：在独立线程执行生成代码，死循环可被 terminate() 终止。
 *
 * 为什么是文件而不是 Blob：
 * - index.html 的 CSP 是 script-src 'self'，blob: worker 会被直接拦掉；
 * - 文件 worker 从同源 URL 加载，且不必把 console 重定向塞进模板字符串。
 *
 * 为什么用 new Function 而不是间接 eval：生成代码以顶层函数声明 + 末尾调用成对出现，
 * 包进一个函数体后声明与调用仍在同一作用域，语义不变，同时避免 eval 的间接作用域歧义。
 */

const OUTPUT_LIMIT_CHARS = 64 * 1024;
const OUTPUT_LIMIT_MESSAGES = 1000;

const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<{ code: string }>) => void) | null;
  console: Console;
};

let outputChars = 0;
let outputMessages = 0;
let limitSent = false;

function post(text: string): void {
  if (limitSent) return;
  const value = String(text);
  const remaining = OUTPUT_LIMIT_CHARS - outputChars;
  const bounded = value.slice(0, remaining);
  outputChars += bounded.length;
  outputMessages += 1;
  if (bounded) scope.postMessage({ type: 'output', text: bounded });
  if (value.length > remaining || outputMessages > OUTPUT_LIMIT_MESSAGES) {
    limitSent = true;
    scope.postMessage({ type: 'output_limit' });
  }
}

/** 多参数按空格拼接，并对单条消息做剩余额度截断。 */
function format(values: unknown[]): string {
  const limit = OUTPUT_LIMIT_CHARS - outputChars + 1;
  let output = '';
  let index = 0;
  for (const value of values) {
    if (output.length >= limit) break;
    const separator = index++ === 0 ? '' : ' ';
    const available = limit - output.length - separator.length;
    output += separator.slice(0, limit - output.length);
    if (available <= 0) break;
    output += String(value).slice(0, available);
  }
  return output;
}

scope.console = {
  ...console,
  log: (...args: unknown[]) => post(format(args)),
  warn: (...args: unknown[]) => post(format(args)),
  error: (...args: unknown[]) => post(`[Error] ${format(args)}`),
} as Console;

scope.onmessage = async (event: MessageEvent<{ code: string }>) => {
  outputChars = 0;
  outputMessages = 0;
  limitSent = false;
  try {
    // 间接调用：new Function 构造出的函数体在 worker 全局里求值，函数声明与末尾调用同域。
    const run = new Function(event.data.code) as () => unknown;
    const result = run();
    if (result instanceof Promise) await result;
    scope.postMessage({ type: 'done' });
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? (error as { message: unknown }).message
        : error;
    scope.postMessage({ type: 'error', error: String(message) });
  }
};
// 标记为模块：否则两个 worker 文件同处全局脚本作用域，顶层声明会互相冲突。
export {};
