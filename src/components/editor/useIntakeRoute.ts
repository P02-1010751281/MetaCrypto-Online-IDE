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

export interface IntakePayload {
  readonly kind: 'doc' | 'code';
  readonly source: string;
  readonly name: string;
}

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

  function onIntakeRoute(payload: IntakePayload): void {
    options.showSidebar();
    if (payload.kind === 'code') {
      codeIntake.value = { source: payload.source, name: payload.name };
      options.openPanel('code');
      return;
    }
    codeIntake.value = null;
    options.openPanel('standards');
    options.notify(ui('intakeDocHint'), 6000);
  }

  return { codeIntake, onIntakeRoute };
}
