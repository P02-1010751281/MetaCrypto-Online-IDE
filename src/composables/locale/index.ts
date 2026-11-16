// 界面文案与 Blockly 语言包按职责拆分：类型、覆盖表、中英文案、UI 文案、
// UI 访问器、语言运行时各一文件。对外仍从 `@/composables/locale` 取同样的导出。
export { MESSAGES_EN } from './messages-en';
export { MESSAGES_ZH_HANS } from './messages-zh';
export { useBlocklyLocale } from './runtime';
export { BLOCKLY_LOCALES, type BlocklyLocale } from './types';
export { ui, uiFormat, uiLocaleRef, useUILocale } from './ui';
