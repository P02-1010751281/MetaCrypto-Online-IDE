import { createApp, h } from 'vue';

import { RouterView } from 'vue-router';
import router from './router';
import { loadUIMessages, useBlocklyLocale } from '@/composables/locale';
import './styles/index.css';
import 'highlight.js/styles/github-dark.css';

/**
 * 启动顺序：语言包是懒加载的 chunk（见 composables/locale/ui.ts），
 * 必须在挂载前取回当前语言，否则首屏 `ui()` 会把键名画到界面上。
 * 另一种语言随后预取：`ui()` 的缺键兜底要退回中文，切换语言也不该再等一次网络。
 */
async function bootstrap(): Promise<void> {
  const blocklyLocale = useBlocklyLocale();
  const initialLocale = blocklyLocale.getBrowserLocale();
  await loadUIMessages(initialLocale);
  // 全局初始化 locale，确保所有页面 ui() 可用
  blocklyLocale.initLocale();
  void loadUIMessages(initialLocale === 'en' ? 'zh-hans' : 'en');

  const app = createApp({ render: () => h(RouterView) });
  app.use(router);
  app.mount('#app');
}

void bootstrap();
