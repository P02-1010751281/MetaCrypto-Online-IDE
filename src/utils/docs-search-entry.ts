/**
 * 文档中心第二入口的纯逻辑：侧栏过滤、?q= 预填决策、语言切换重判、宿主跳转目标。
 *
 * 从 views/DocsView.vue 与 App.vue 抽出，为的是能在 node 环境下直接单测
 * （仓库 vitest 是 node 环境、没装 @vue/test-utils，组件挂载测试会引入新依赖）。
 * 这里刻意不 import markdown.ts：那会把 marked / DOMPurify / highlight.js 一起拉进测试。
 */
import { getCategoryLabel, type DocCategory } from '@/utils/docs-catalog';

/** 文档中心的语言域：'zh' | 'en'。不是 BlocklyLocale（'en' | 'zh-hans'），后者在分类表里查不到。 */
export type DocsLocale = 'zh' | 'en';

export interface PrefillDecision {
  /** 要写进侧栏搜索框的词；空串表示清空。 */
  keyword: string;
  /** 非空则显示「未匹配任何分类或文档标题」说明行。 */
  notice: string;
}

/**
 * 侧栏过滤：与原 computed 逐字等价——不 trim、q 为空返回全部分类、
 * 分类名命中时保留该分类全部文件、空分类剔除。
 */
export function filterCategories(list: DocCategory[], q: string, locale: DocsLocale): DocCategory[] {
  if (!q) return list;
  const needle = q.toLowerCase();
  return list
    .map((cat) => ({
      ...cat,
      files: getCategoryLabel(cat.id, locale).toLowerCase().includes(needle)
        ? cat.files
        : cat.files.filter((f) => f.title.toLowerCase().includes(needle)),
    }))
    .filter((cat) => cat.files.length > 0);
}

/** URL 里的 q 只有字符串才算数（重复参数会解析成数组），并去掉首尾空白。 */
export function readQuery(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 预填决策：先试算，命中分类名或文档标题才把词写进搜索框；
 * 算不出内容就不预填、只留一行说明——预填一个必然筛空的词等于把用户送进空侧栏。
 */
export function decidePrefill(raw: unknown, list: DocCategory[], locale: DocsLocale): PrefillDecision {
  const q = readQuery(raw);
  if (q && filterCategories(list, q, locale).length > 0) return { keyword: q, notice: '' };
  return { keyword: '', notice: q };
}

/**
 * 语言切换后的重判：只接管「仍等于预填值」的搜索框（用户改过就不再管），
 * 并且只在切换后不再命中时清空并提示。返回 null 表示不动。
 */
export function decideLocaleSwitch(
  prefilled: string,
  current: string,
  list: DocCategory[],
  locale: DocsLocale,
): PrefillDecision | null {
  if (!prefilled || current !== prefilled) return null;
  if (filterCategories(list, prefilled, locale).length > 0) return null;
  return { keyword: '', notice: prefilled };
}

/** 宿主跳转目标：有词带 ?q=，无词就是 /docs。 */
export function buildDocsLocation(raw: unknown): { path: string; query: { q: string } } | string {
  const keyword = readQuery(raw);
  return keyword ? { path: '/docs', query: { q: keyword } } : '/docs';
}
