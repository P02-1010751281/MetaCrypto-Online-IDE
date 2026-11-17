/**
 * 代码 → 工作区：运行时字段模板载荷的加载入口（用户侧 AI Helper · B 线 B1b）
 *
 * `field-templates.json` 由 `scripts/ai-helper-variants.ts` 采集，产物写两处（运行时 +
 * experiments 存档，内容逐字相同）。这里按需 `?raw` 动态载入：约 170 KB 只在用户真正
 * 使用反解析时才拉，不进主包；新鲜度由 `npm run reverse:templates:check` 守。
 *
 * 拆成 `parseFieldPayload` + `loadFieldPayload` 两个函数，是为了让单测能直接喂文本，
 * 不必依赖打包器的 `?raw` 行为。
 */

import type { FieldPayload } from './matchers';

let cached: FieldPayload | null = null;

/** 文本 → 载荷。结构不对就抛错：宁可整块功能不可用，也不让半份模板给出错答案。 */
export function parseFieldPayload(text: string): FieldPayload {
  const payload = JSON.parse(text) as { blocks?: unknown };
  if (!Array.isArray(payload.blocks) || payload.blocks.length === 0) {
    throw new Error('字段模板载荷没有 blocks 数组');
  }
  return payload as FieldPayload;
}

/** 幂等：同一页面只解析一次。 */
export async function loadFieldPayload(): Promise<FieldPayload> {
  if (cached) return cached;
  const module = (await import('./field-templates.json?raw')) as { default: string };
  cached = parseFieldPayload(module.default);
  return cached;
}
