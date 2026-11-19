import { ref } from 'vue';
import * as Blockly from 'blockly/core';

import * as en from 'blockly/msg/en';
import * as zhHans from 'blockly/msg/zh-hans';

import { MESSAGES_EN } from './messages-en';
import { MESSAGES_ZH_HANS } from './messages-zh';
import { BLOCKLY_OVERRIDES_ZH_HANS } from './overrides';
import { BLOCKLY_LOCALES, type BlocklyLocale } from './types';
import { loadUIMessages, uiLocaleRef } from './ui';

const currentLocale = ref<BlocklyLocale>('zh-hans');
const isLocaleInitialized = ref(false);

function applyLocale(locale: BlocklyLocale): void {
  const messages = LOCALE_MESSAGES[locale];
  const customMessages = CUSTOM_MESSAGES[locale];

  Blockly.setLocale(messages);

  // 仅在简体中文环境下覆盖 Blockly 核心消息为中文翻译
  if (locale === 'zh-hans') {
    Object.keys(BLOCKLY_OVERRIDES_ZH_HANS).forEach((key) => {
      (Blockly.Msg as Record<string, string>)[key] =
        BLOCKLY_OVERRIDES_ZH_HANS[key];
    });
  }

  Object.keys(customMessages).forEach((key) => {
    (Blockly.Msg as Record<string, string>)[key] = customMessages[key];
  });

  currentLocale.value = locale;
  uiLocaleRef.value = locale;
  isLocaleInitialized.value = true;
}

export function useBlocklyLocale() {
  const getBrowserLocale = (): BlocklyLocale => {
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith('zh')) {
      return 'zh-hans';
    }
    return 'en';
  };

  /**
   * 切换语言：语言包是懒加载的 chunk，先取回再应用，否则切换后 `ui()` 会退回键名。
   * 调用方需要 await（或 allow-floating），保证切换与重绘顺序可控。
   */
  const setLocale = async (locale: BlocklyLocale): Promise<void> => {
    await loadUIMessages(locale);
    applyLocale(locale);
  };

  const initLocale = (): void => {
    if (!isLocaleInitialized.value) {
      const browserLocale = getBrowserLocale();
      applyLocale(browserLocale);
    }
  };

  const getCurrentLocale = (): BlocklyLocale => currentLocale.value;

  const getLocaleLabel = (locale: BlocklyLocale): string =>
    BLOCKLY_LOCALES[locale].label;

  return {
    initLocale,
    setLocale,
    getCurrentLocale,
    getLocaleLabel,
    getBrowserLocale,
    BLOCKLY_LOCALES,
  };
}

export const LOCALE_MESSAGES: Record<BlocklyLocale, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  'zh-hans': zhHans as unknown as Record<string, string>,
};

export const CUSTOM_MESSAGES: Record<BlocklyLocale, Record<string, string>> = {
  en: MESSAGES_EN,
  'zh-hans': MESSAGES_ZH_HANS,
};
