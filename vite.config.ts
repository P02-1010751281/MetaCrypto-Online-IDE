import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // 包内别名（core 家庭之间只走 @cc/*，不依赖应用级 @/）
      '@cc/blocks': resolve(import.meta.dirname, 'src/blocks'),
      '@cc/generators': resolve(import.meta.dirname, 'src/generators'),
      '@cc/constants': resolve(import.meta.dirname, 'src/constants'),
      '@cc/migration': resolve(import.meta.dirname, 'src/utils/migration'),
      '@cc/locale': resolve(import.meta.dirname, 'src/composables/locale'),
      '@cc/runtime': resolve(import.meta.dirname, 'src/runtime'),
      '@cc/utils': resolve(import.meta.dirname, 'src/utils'),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
    open: true,
    cors: true,
  },
  clearScreen: false,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
      },
    },
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/blockly')) return 'blockly';
          if (
            id.includes('node_modules/marked') ||
            id.includes('node_modules/dompurify') ||
            id.includes('node_modules/highlight.js')
          )
            return 'docs-renderer';
          if (id.includes('node_modules/mermaid')) return 'mermaid';
          if (
            id.includes('node_modules/vue') ||
            id.includes('node_modules/@vue')
          )
            return 'vue-vendor';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['blockly', 'vue'],
  },
});
