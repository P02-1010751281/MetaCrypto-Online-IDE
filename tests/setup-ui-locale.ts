/**
 * 语言包是懒加载 chunk（见 src/composables/locale/ui.ts），单测里没有 main.ts 的启动序，
 * 所以在这里把两种语言都预取到位：组件的 `ui()` 在断言前就必须拿到真文案，
 * 否则「缺键退回键名」会被误当成断言失败（或更糟：两边都退回键名而假装通过）。
 */
import { loadUIMessages } from '@/composables/locale/ui';

await loadUIMessages('zh-hans');
await loadUIMessages('en');
