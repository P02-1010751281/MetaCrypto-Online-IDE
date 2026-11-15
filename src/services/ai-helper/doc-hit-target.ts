/**
 * 检索结果 → 目标界面的**决策层**（纯函数，不碰 window/router，便于单测）。
 *
 * 两类命中走两条路：
 * - Markdown：`#/docs?doc=…&line=…` 深链，DocsView 会渲染并按行定位。
 * - PDF：原文是第三方标准稿，**不随应用分发**，文档页没有可渲染内容。
 *   直接跳过去只会得到一张空白页，所以只交回「路径 + 页码」让宿主提示/复制。
 */
import type { DocHit } from './doc-search';

export type DocHitPlan =
  | { kind: 'navigate'; href: string }
  | { kind: 'pdf-reference'; reference: string };

/**
 * @param hit 检索命中
 * @param basePath 当前页面路径（深链要拼在 pathname 后面，避免带进旧 hash）
 */
export function planDocHit(hit: DocHit, basePath: string): DocHitPlan {
  const path = hit.path.startsWith('/') ? hit.path : `/${hit.path}`;
  if (hit.kind === 'pdf') {
    // 页码措辞与提示文案由宿主按当前界面语言拼，决策层只管「位置在哪」。
    // `#page=N` 是 PDF 阅读器通用的页码锚点；用 `:N` 会和 Markdown 的行号混淆。
    return { kind: 'pdf-reference', reference: `${path}#page=${hit.line}` };
  }
  return {
    kind: 'navigate',
    href: `${basePath}#/docs?doc=${encodeURIComponent(path)}&line=${hit.line}`,
  };
}
