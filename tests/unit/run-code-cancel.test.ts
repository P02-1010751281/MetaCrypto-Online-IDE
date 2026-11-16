// @vitest-environment jsdom
/**
 * run-code 的取消语义：走到 finish 的正常收尾路径，而不是野杀 worker。
 *
 * 关键断言有两条，缺一条这个修复就是假的：
 * 1. 取消后 Promise 必须 settle（野杀 worker 不触发任何事件，await 会永久挂起）；
 * 2. Python 的模块级 busy 标志必须复位，否则下一次运行直接返回 busy。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  runJavaScriptInBrowser,
  runPythonInBrowser,
} from '@/runtime/run-code';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(
    public readonly url: URL,
    public readonly options?: unknown,
  ) {
    FakeWorker.instances.push(this);
  }
  static instances: FakeWorker[] = [];
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

describe('run-code 取消', () => {
  it('JavaScript：中止信号让当次运行 settle，并终止它的 worker', async () => {
    const controller = new AbortController();
    const pending = runJavaScriptInBrowser('while (true) {}', () => {}, {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).resolves.toMatchObject({ ok: false, error: 'cancelled' });
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it('Python：取消后复位 busy，下一次运行不会直接返回 busy', async () => {
    const first = new AbortController();
    const firstRun = runPythonInBrowser(
      'print(1)',
      () => {},
      undefined,
      undefined,
      first.signal,
    );
    first.abort();
    await expect(firstRun).resolves.toMatchObject({ ok: false, error: 'cancelled' });

    // busy 若没被复位，这次会在创建 worker 之前就返回 errorCode: 'busy'。
    const second = new AbortController();
    const secondRun = runPythonInBrowser(
      'print(2)',
      () => {},
      undefined,
      undefined,
      second.signal,
    );
    second.abort();
    await expect(secondRun).resolves.toMatchObject({ ok: false, error: 'cancelled' });
  });

  it('已经是中止态的信号直接返回，不创建 worker', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runJavaScriptInBrowser('x', () => {}, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, error: 'cancelled' });
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
