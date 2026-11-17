import { defineConfig } from 'vite';
import { basename, resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

/**
 * 并行开发隔离：设置 AIVERIFY_ENTRY 时只构建该入口，AIVERIFY_OUTDIR 另给输出目录，
 * 多人各自构建互不覆盖。两个变量都不设时行为与原先完全一致（verify:build 全量入口）。
 */
const onlyEntry = process.env.AIVERIFY_ENTRY;
const outDir = process.env.AIVERIFY_OUTDIR || 'dist-verify';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // 具体 alias 必须排在 '@' 通配之前（vite 按数组顺序匹配）
      // MetaCrypto Online IDE 无 features 目录（metacrypt 镜像版为 src/features/blockly/core/...）
      { find: '@/blocks', replacement: resolve(import.meta.dirname, 'src/blocks') },
      { find: '@/generators/python', replacement: resolve(import.meta.dirname, 'src/generators/python') },
      { find: '@/generators/javascript', replacement: resolve(import.meta.dirname, 'src/generators/javascript') },
      { find: '@cc/blocks', replacement: resolve(import.meta.dirname, 'src/blocks') },
      { find: '@cc/generators', replacement: resolve(import.meta.dirname, 'src/generators') },
      { find: '@cc/constants', replacement: resolve(import.meta.dirname, 'src/constants') },
      { find: '@cc/migration', replacement: resolve(import.meta.dirname, 'src/utils/migration') },
      { find: '@cc/locale', replacement: resolve(import.meta.dirname, 'src/composables/locale') },
      { find: '@cc/runtime', replacement: resolve(import.meta.dirname, 'src/runtime') },
      { find: '@cc/utils', replacement: resolve(import.meta.dirname, 'src/utils') },
      { find: '@', replacement: resolve(import.meta.dirname, 'src') },
    ],
  },
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: onlyEntry
        ? { [basename(onlyEntry, '.ts')]: resolve(import.meta.dirname, onlyEntry) }
        : {
            'verify-demo': resolve(import.meta.dirname, 'scripts/verify-demo.ts'),
            'verify-templates': resolve(import.meta.dirname, 'scripts/verify-templates.ts'),
            'ai-helper-signatures': resolve(import.meta.dirname, 'scripts/ai-helper-signatures.ts'),
            'ai-helper-roundtrip': resolve(import.meta.dirname, 'scripts/ai-helper-roundtrip.ts'),
            'ai-helper-variants': resolve(import.meta.dirname, 'scripts/ai-helper-variants.ts'),
            'ai-helper-closures': resolve(import.meta.dirname, 'scripts/ai-helper-closures.ts'),
            'ai-helper-typecheck': resolve(import.meta.dirname, 'scripts/ai-helper-typecheck.ts'),
            'ai-helper-kat': resolve(import.meta.dirname, 'scripts/ai-helper-kat.ts'),
            'ai-helper-validate': resolve(import.meta.dirname, 'scripts/ai-helper-validate.ts'),
            'ai-helper-blocksearch': resolve(import.meta.dirname, 'scripts/ai-helper-blocksearch.ts'),
            'ai-helper-docindex': resolve(import.meta.dirname, 'scripts/ai-helper-docindex.ts'),
          },
      formats: ['es'],
    },
    rollupOptions: { external: ['node:fs', 'node:child_process', 'node:os', 'node:path', 'jsdom'] },
  },
});
