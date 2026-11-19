import { ref, type Ref } from 'vue';

import type { BlocklyLocale } from './types';

/** 当前界面语言。默认中文：加载完成前 `ui()` 会退回键名，因此挂载前必须先 `loadUIMessages()`。 */
export const uiLocaleRef: Ref<BlocklyLocale> = ref('zh-hans');

/**
 * 语言包按语言懒加载，**不进入口 chunk**。
 *
 * 为什么：整份文案表（中英各约 350 键）曾整块打进入口 chunk，把 64KiB 预算顶到
 * 65523/65536——加一句文案就红，等于用打包门禁冻结了界面文案的演进。现在两种语言
 * 各是一个动态 import 的 chunk，挂载前只加载当前语言（见 src/main.ts），另一种
 * 随后预取，切换语言时再次确认已加载。
 *
 * 代价与边界：
 * - 挂载前 `ui()` 未就绪会返回键名，所以 `main.ts` 必须先 await；
 * - 懒加载失败（网络/资源缺失）时 `ui()` 退回键名，界面可见而不是空白——与旧实现的缺键行为一致。
 */
const tables: Partial<Record<BlocklyLocale, Record<string, string>>> = {};

export async function loadUIMessages(locale: BlocklyLocale): Promise<void> {
  if (tables[locale]) return;
  if (locale === 'en') {
    const { UI_MESSAGES_EN } = await import('./ui-messages-en');
    tables.en = UI_MESSAGES_EN;
    return;
  }
  const { UI_MESSAGES_ZH_HANS } = await import('./ui-messages-zh');
  tables['zh-hans'] = UI_MESSAGES_ZH_HANS;
}

/** 供门禁/诊断用：某种语言的语言包是否已就绪。 */
export function isUIMessagesLoaded(locale: BlocklyLocale): boolean {
  return Boolean(tables[locale]);
}

export function ui(key: string): string {
  return tables[uiLocaleRef.value]?.[key] ?? tables['zh-hans']?.[key] ?? key;
}

/**
 * 取带占位符的文案并填充 `{name}` 形式的变量。
 * 未提供的占位符原样保留，便于在界面上暴露漏填，而不是静默丢字。
 */
export function uiFormat(key: string, vars: Record<string, string | number>): string {
  return ui(key).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function useUILocale() {
  return { ui, uiFormat, uiLocaleRef };
}
