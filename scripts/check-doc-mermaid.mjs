/**
 * 文档 mermaid 语法门禁：让「图能渲染」变成可复核的事实，而不是作者的口头保证。
 *
 * 背景：docs:check-links 只检查链接，语法写坏的 mermaid 块在 Markdown 里完全合法，
 * 于是在文档站上表现为一块空白/报错框，而门禁全绿。本项目已真实踩过一次：节点标签里
 * 写 `artifacts[].sha256`，未加引号，`[]` 提前闭合了节点形状，整图解析失败。
 *
 * 本脚本用仓库已有的 mermaid 依赖逐个解析 ```mermaid 代码块（只解析、不渲染，不下载
 * 浏览器），并对解析器本身跑负控自检：一段已知非法的片段必须解析失败，否则说明校验器
 * 失效（例如依赖升级后 parse 变得宽松），门禁立即变红而不是假装通过。
 *
 * 用法：
 *   node scripts/check-doc-mermaid.mjs            # 校验并自检
 *   node scripts/check-doc-mermaid.mjs --no-selftest
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const SCAN_ROOTS = ['docs', 'README.md', 'README.zh-CN.md'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.agents', 'tmp', 'dist', 'dist-verify', 'paper']);
const BLOCK_PATTERN = /```mermaid\r?\n([\s\S]*?)```/g;

const args = new Set(process.argv.slice(2));
const runSelftest = !args.has('--no-selftest');

// 负控片段：正是本项目真实写坏过的那种标签（`[]` 未加引号会提前闭合节点形状）。
const NEGATIVE_CONTROL = 'flowchart LR\n  C[SpecCard<br/>artifacts[].sha256]\n';
const POSITIVE_CONTROL = 'flowchart LR\n  C["SpecCard<br/>artifacts[].sha256"]\n';

function collectMarkdown(target, out = []) {
  const path = resolve(root, target);
  if (!path.startsWith(root)) return out;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (path.endsWith('.md')) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    collectMarkdown(relative(root, join(path, entry.name)), out);
  }
  return out;
}

function extractBlocks(file) {
  const text = readFileSync(file, 'utf8');
  const blocks = [];
  let match;
  BLOCK_PATTERN.lastIndex = 0;
  while ((match = BLOCK_PATTERN.exec(text))) {
    const line = text.slice(0, match.index).split('\n').length;
    blocks.push({ line, code: match[1] });
  }
  return blocks;
}

/** mermaid 11 的 parse 需要 DOM 痕迹（内部用 DOMPurify）；给一个最小 jsdom 壳即可。 */
function installDomShim() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.Element = dom.window.Element;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
}

async function main() {
  installDomShim();
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

  const files = SCAN_ROOTS.flatMap((target) => collectMarkdown(target)).sort();
  let totalErrors = 0;
  let blockCount = 0;
  let fileCount = 0;

  for (const file of files) {
    const blocks = extractBlocks(file);
    if (!blocks.length) continue;
    fileCount += 1;
    blockCount += blocks.length;
    for (const block of blocks) {
      try {
        await mermaid.parse(block.code);
      } catch (error) {
        const reason = String(error?.message || error).replace(/\s*\n\s*/g, ' ').slice(0, 240);
        console.error(`DOC_MERMAID_ERROR ${relative(root, file)}:${block.line}: ${reason}`);
        totalErrors += 1;
      }
    }
  }

  if (totalErrors === 0 && runSelftest) {
    let positiveOk = true;
    let negativeFired = false;
    try {
      await mermaid.parse(POSITIVE_CONTROL);
    } catch {
      positiveOk = false;
    }
    try {
      await mermaid.parse(NEGATIVE_CONTROL);
    } catch {
      negativeFired = true;
    }
    if (!positiveOk) {
      console.error('DOC_MERMAID_SELFTEST_ERROR 合法片段未能通过解析，解析器不可用');
      totalErrors += 1;
    }
    if (!negativeFired) {
      console.error('DOC_MERMAID_SELFTEST_ERROR 已知非法片段竟然解析通过，校验器失效');
      totalErrors += 1;
    }
    if (positiveOk && negativeFired) {
      console.log('DOC_MERMAID_SELFTEST controls=2 fired=1');
    }
  }

  console.log(`DOC_MERMAID_SUMMARY files=${fileCount} blocks=${blockCount} failed=${totalErrors}`);
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
