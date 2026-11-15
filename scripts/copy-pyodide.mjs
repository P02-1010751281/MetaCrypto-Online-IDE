#!/usr/bin/env node
/**
 * 把 node_modules/pyodide 的浏览器运行时拷进 public/pyodide/。
 *
 * 为什么不在构建期直接引用 node_modules：Python 运行时必须能从同源 URL 取到
 * pyodide.mjs / .wasm / python_stdlib.zip（加载器内部按 indexURL 相对路径拼），
 * 而 Vite 不会把这些非导入文件带进产物。
 *
 * public/pyodide/ 已 gitignore：版本由 package.json 的 devDependency 钉死，
 * 需要时由本脚本（predev / prebuild 自动执行）从包内重建，避免 13MB 二进制进 git。
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 运行时实际会被加载的文件；其余（console.html、*.map、类型声明）不拷。 */
const RUNTIME_FILES = [
  'pyodide.mjs',
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'node_modules', 'pyodide');
const targetDir = join(root, 'public', 'pyodide');

if (!existsSync(sourceDir)) {
  console.error(
    `[copy-pyodide] 找不到 ${sourceDir}；先运行 npm install（pyodide 是 devDependency）。`,
  );
  process.exit(1);
}

const missing = RUNTIME_FILES.filter((name) => !existsSync(join(sourceDir, name)));
if (missing.length > 0) {
  console.error(`[copy-pyodide] pyodide 包内缺少运行时文件：${missing.join(', ')}`);
  process.exit(1);
}

// 目标目录里可能有旧版本残留（例如手工拷入的 pyodide-lock.json），先清空再重建。
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

let bytes = 0;
const fileSizes = {};
for (const name of RUNTIME_FILES) {
  const from = join(sourceDir, name);
  cpSync(from, join(targetDir, name));
  const size = statSync(from).size;
  fileSizes[name] = size;
  bytes += size;
}

// 加载进度的分母：worker 先把清单读回来，才能给出确定百分比而不是瞎猜。
// 清单本身不进 totalBytes（它只有几百字节，且由 worker 单独取）。
writeFileSync(
  join(targetDir, 'manifest.json'),
  `${JSON.stringify({ totalBytes: bytes, files: fileSizes }, null, 2)}\n`,
);

const megabytes = (bytes / 1024 / 1024).toFixed(1);
console.log(`[copy-pyodide] ${RUNTIME_FILES.length} 个文件、${megabytes}MB → public/pyodide/`);
