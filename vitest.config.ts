import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 包内别名（与 vite.config.ts 保持一致）
      '@cc/blocks': fileURLToPath(new URL('./src/blocks', import.meta.url)),
      '@cc/generators': fileURLToPath(new URL('./src/generators', import.meta.url)),
      '@cc/constants': fileURLToPath(new URL('./src/constants', import.meta.url)),
      '@cc/migration': fileURLToPath(new URL('./src/utils/migration', import.meta.url)),
      '@cc/locale': fileURLToPath(new URL('./src/composables/locale', import.meta.url)),
      '@cc/runtime': fileURLToPath(new URL('./src/runtime', import.meta.url)),
      '@cc/utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 语言包是懒加载 chunk，单测靠这个 setup 预取两种语言（见该文件注释）。
    setupFiles: ['tests/setup-ui-locale.ts'],
    passWithNoTests: false,
    // 默认 5s 在多 worker 并行 + 外部盘 IO 下会偶发超时（已观察到 gmdrbg/hmac 用例）。
    // 统一给 30s 预算：只放宽“等待时间”，不放宽任何断言或期望值。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
