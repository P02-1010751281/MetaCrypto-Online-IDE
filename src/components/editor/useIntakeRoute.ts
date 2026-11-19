/**
 * A/B 单入口（PLAN P5）的落点：判别在面板里做，这里只把用户确认过的选择送到对应面板。
 *
 * 为什么单拎出来：`App.vue` 是装配层且有 500 行上限，这条路径要碰面板状态、侧栏可见性、
 * 预填载荷与 Toast 四样，塞回装配层只是把细节堆到壳上（与 `useCodeToWorkspaceImport`
 * 同一个理由）。
 *
 * 代码带正文预填；文档**不预填任何标准**——A 线只处理已登记的标准与论文，预填一份
 * 「看起来像标准」的任意 PDF 会让人以为它已被收录。
 */
import { ref } from 'vue';

import { ui } from '@/composables/locale';

/**
 * 单入口路由的两种载荷。
 *
 * 代码带正文（B 线预填）；文档带文件名 + **可读正文**——A 线只用它按标准编号认条目，
 * 二进制（PDF/DOCX）在单入口里就没读正文，这里自然是空串，也就认不出条目。
 */
export type IntakeRoutePayload =
  | { readonly kind: 'code'; readonly source: string; readonly name: string }
  | { readonly kind: 'doc'; readonly name: string; readonly text: string };

interface Options {
  /** 切到目标面板（`code` / `standards`）。 */
  openPanel: (panel: 'code' | 'standards') => void;
  /** 展开侧栏：面板换个 id 但侧栏若收着，用户会以为按钮没反应。 */
  showSidebar: () => void;
  notify: (message: string, duration?: number) => void;
}

export function useIntakeRoute(options: Options) {
  /**
   * 路由过来的代码正文，只保留到 B 线面板挂载为止。
   * 不缓存到全局：留一份会让「上次导入的代码」在下次打开面板时阴魂不散。
   */
  const codeIntake = ref<{ source: string; name: string } | null>(null);

  /**
   * 路由过来的文档：同样只留到 A 线面板消费为止。
   * 不缓存「上次匹配到哪份标准」——那是面板的状态，留一份在这里迟早会和面板不同步。
   */
  const docIntake = ref<{ name: string; text: string } | null>(null);

  function onIntakeRoute(payload: IntakeRoutePayload): void {
    options.showSidebar();
    if (payload.kind === 'code') {
      codeIntake.value = { source: payload.source, name: payload.name };
      docIntake.value = null;
      options.openPanel('code');
      return;
    }
    codeIntake.value = null;
    docIntake.value = { name: payload.name, text: payload.text };
    options.openPanel('standards');
    options.notify(ui('intakeDocHint'), 6000);
  }

  return { codeIntake, docIntake, onIntakeRoute };
}
