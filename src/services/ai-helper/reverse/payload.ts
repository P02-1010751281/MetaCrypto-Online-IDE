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

/**
 * 文本 → 闭包名单。允许空数组（名单还没采过时，反解析退回「只认生成器题头」），
 * 但不允许结构不对：半份名单会让 procedure 分流把内嵌实现认成用户函数。
 */
export function parseClosureNames(text: string): string[] {
  const payload = JSON.parse(text) as { closures?: unknown };
  if (!Array.isArray(payload.closures) || payload.closures.some((name) => typeof name !== 'string')) {
    throw new Error('闭包名单载荷没有 closures 字符串数组');
  }
  return payload.closures as string[];
}

/** 幂等：同一页面只解析一次；两份载荷一起进缓存，避免分流时名单还没到。 */
export async function loadFieldPayload(): Promise<FieldPayload> {
  if (cached) return cached;
  const [templates, closures] = await Promise.all([
    import('./field-templates.json?raw') as Promise<{ default: string }>,
    import('./closure-names.json?raw') as Promise<{ default: string }>,
  ]);
  const payload = parseFieldPayload(templates.default);
  payload.closures = parseClosureNames(closures.default);
  cached = payload;
  return cached;
}
