/**
 * useCodeRunner 的取消通道：离开编辑器时终止当次试运行。
 *
 * 为什么必须取消：运行器用模块级 `busy` 标志串行化执行。不取消的话，用户切走
 * 再回来点「运行」会一直撞 busy，最长要等到运行超时（10s）或装载超时（45s）。
 * 为什么不能只 terminate：野杀 worker 不会让 run 的 Promise settle，busy 会永久
 * 卡住——所以取消必须走 run-code 的正常收尾路径（信号 → finish → 复位 busy）。
 */
import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';

const runs = vi.hoisted(() => ({
  python: vi.fn(),
  js: vi.fn(),
}));

vi.mock('@/runtime/run-code', () => ({
  runPythonInBrowser: runs.python,
  runJavaScriptInBrowser: runs.js,
}));

import { useCodeRunner } from '@/composables/useCodeRunner';

/** 永不 settle 的 Promise：模拟一个还在跑（或死循环）的试运行。 */
function pending(): Promise<never> {
  return new Promise<never>(() => {});
}

/** 挂载一个独立作用域，作用域 stop 等价于组件卸载。 */
function mountRunner() {
  const scope = effectScope();
  const runner = scope.run(() => useCodeRunner());
  if (!runner) throw new Error('useCodeRunner 未在作用域内创建');
  return { scope, runner };
}

describe('useCodeRunner 卸载取消', () => {
  it('JavaScript：卸载时把取消信号交给运行器并置为已取消', () => {
    const captured: { signal?: AbortSignal } = {};
    runs.js.mockImplementation(
      (_code: string, _out: (text: string) => void, options?: { signal?: AbortSignal }) => {
        captured.signal = options?.signal;
        return pending();
      },
    );

    const { scope, runner } = mountRunner();
    void runner.run('while (true) {}', 'javascript');

    expect(captured.signal).toBeInstanceOf(AbortSignal);
    expect(captured.signal?.aborted).toBe(false);

    scope.stop();
    expect(captured.signal?.aborted).toBe(true);
  });

  it('Python：信号走第五个参数，取消后同样置为已取消', () => {
    const captured: { signal?: AbortSignal } = {};
    runs.python.mockImplementation(
      (
        _code: string,
        _out: (text: string) => void,
        _progress?: unknown,
        _assets?: unknown,
        signal?: AbortSignal,
      ) => {
        captured.signal = signal;
        return pending();
      },
    );

    const { scope, runner } = mountRunner();
    void runner.run('print(1)', 'python');

    expect(captured.signal).toBeInstanceOf(AbortSignal);

    scope.stop();
    expect(captured.signal?.aborted).toBe(true);
  });

  it('卸载后迟到的输出不再写进状态', () => {
    const captured: { output?: (text: string) => void } = {};
    runs.js.mockImplementation((_code: string, out: (text: string) => void) => {
      captured.output = out;
      return pending();
    });

    const { scope, runner } = mountRunner();
    void runner.run('console.log(1)', 'javascript');

    scope.stop();
    captured.output?.('迟到的输出');

    expect(runner.output.value).toBe('');
  });
});
