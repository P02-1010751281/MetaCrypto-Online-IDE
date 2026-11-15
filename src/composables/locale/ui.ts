import { ref, type Ref } from 'vue';

import type { BlocklyLocale } from './types';
import { UI_MESSAGES } from './ui-messages';

export const uiLocaleRef: Ref<BlocklyLocale> = ref('zh-hans');

export function ui(key: string): string {
  const locale = uiLocaleRef.value;
  return UI_MESSAGES[locale]?.[key] || UI_MESSAGES['zh-hans'][key] || key;
}

export function useUILocale() {
  return { ui, uiLocaleRef };
}
