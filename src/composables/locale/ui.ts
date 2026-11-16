import { ref, type Ref } from 'vue';

import type { BlocklyLocale } from './types';
import { UI_MESSAGES } from './ui-messages';

export const uiLocaleRef: Ref<BlocklyLocale> = ref('zh-hans');

export function ui(key: string): string {
  const locale = uiLocaleRef.value;
  return UI_MESSAGES[locale]?.[key] || UI_MESSAGES['zh-hans'][key] || key;
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
