export type BlocklyLocale = 'en' | 'zh-hans';

export const BLOCKLY_LOCALES: Record<
  BlocklyLocale,
  { name: string; label: string }
> = {
  en: { name: 'English', label: 'English' },
  'zh-hans': { name: '简体中文', label: '中文' },
};
