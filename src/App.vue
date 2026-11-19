<template>
  <div ref="editorViewRef" class="editor-view" :inert="navigationPending" @click="closeMenus">
    <!-- 窄屏侧栏被折成顶部横条：leftStyle 里的 `flex: 0 0 400px` 在纵向布局里
         会变成「高度 400px」，一开检索面板顶栏就长成一大块，所以只在宽屏钉宽度。 -->
    <!-- 窄屏的侧栏是顶部横条，也是唯一的面板入口（活动条），没有「侧栏」可收：
         此时强制显示，不看 sidebarVisible，否则在宽屏收起后缩窄窗口会连入口一起没了。
         对应地，顶栏那颗左栏开关在窄屏隐藏（EditorHeaderActions 的媒体查询）。 -->
    <EditorSidebar
      v-show="isNarrowViewport || sidebarVisible"
      :style="isNarrowViewport ? undefined : leftStyle"
      :files="projectFileList"
      :active-file-id="activeProjectFileId"
      :entry-file-id="entryProjectFileId"
      :active-panel="activePanel"
      @select-file="onSelectProjectFile"
      @add-file="onAddProjectFile"
      @rename-file="onRenameProjectFile"
      @delete-file="onDeleteProjectFile"
      @set-entry="onSetEntryFile"
      @toggle-panel="togglePanel"
    >
      <!-- 互斥面板：同一时刻只渲染一个（链在 EditorSidePanels 里），与 activity bar 的选中项一一对应。 -->
      <EditorSidePanels
        :active-panel="activePanel"
        :narrow="isNarrowViewport"
        :current-project-id="currentProjectId"
        :workspace="currentWorkspace"
        :block-count="blockCount"
        :intake="codeIntake"
        :doc-intake="docIntake"
        @close="closePanel"
        @project-renamed="onProjectRenamed"
        @open-doc-hit="onOpenDocHit"
        @browse-all-docs="openDocs"
        @apply-workspace="onApplyReversedWorkspace"
        @open-source="openStandardSource"
        @intake-route="onIntakeRoute"
      />
    </EditorSidebar>

    <!-- 侧栏收起时这条分界也没有意义（左边已经没有面板可拖），一并撤掉。 -->
    <div
      v-if="isNarrowViewport || sidebarVisible"
      class="split-handle split-handle-left"
      @mousedown="onLeftDragStart"
    >
      <div class="split-line" />
    </div>

    <div class="view-left" :style="editorStyle">
      <!-- 顶栏基线（--editor-bar-h）：左面包屑 + 右应用级动作组，与左侧面板头、右侧代码栏头同高。 -->
      <div class="editor-head">
        <EditorBreadcrumb
          :project-name="projectName"
          :file-name="activeProjectFile?.name"
          :is-entry="activeProjectFileId === entryProjectFileId"
        />
        <EditorHeaderActions
          :code-pane-visible="codePaneVisible"
          :sidebar-visible="sidebarVisible"
          :open-menu="openMenu"
          :export-format="exportFormat"
          :import-format="importFormat"
          @toggle-locale="toggleBlocklyLocale"
          @toggle-code-pane="toggleCodePane"
          @toggle-sidebar="toggleSidebar"
          @toggle-menu="toggleMenu"
          @update:export-format="exportFormat = $event"
          @update:import-format="importFormat = $event"
          @export="handleExport"
          @import-file="onImportFile"
          @code-to-workspace="openCodeToWorkspace"
          @new-workspace="handleNewWorkspace"
          @clear="handleClear"
          @open-docs="openDocs"
        />
      </div>
      <EditorToolbar
        :saving="saving"
        :save-status="saveStatus"
        :last-save-time="lastSaveTime"
        :auto-save-enabled="autoSaveEnabled"
        @save="onManualSave"
        @update:auto-save-enabled="autoSaveEnabled = $event"
      />

      <BlocklyEditor
        ref="blocklyEditor"
        :read-only="navigationPending"
        @change="onWorkspaceChanged"
      />
      <EditorStatusBar
        :block-count="blockCount"
        :file-count="projectFileList.length"
        :language-label="languageLabel"
      />
    </div>

    <div v-if="codePaneVisible" class="split-handle" @mousedown="onSplitDragStart">
      <div class="split-line" />
    </div>

    <!-- 收起用 v-show 而不是 v-if：CodePanel 里的 useCodeRunner 把运行输出存在组件局部 ref，
         v-if 卸载会连刚跑出来的输出一起丢掉（收起 ≠ 清空）。 -->
    <CodePanel
      v-show="codePaneVisible"
      ref="codePanel"
      :workspace="currentWorkspace"
      :language="selectedLanguage"
      :files="projectFileList"
      :entry-file-id="entryProjectFileId"
      :panel-style="codeStyle"
      :active-file-name="activeProjectFile?.name"
      :entry-badge="activeProjectFileId === entryProjectFileId"
      @update:language="selectedLanguage = $event"
      @generate="generateCode"
    />

    <EditorToast :visible="toastVisible" :message="toastMessage" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BlocklyEditor from '@/components/BlocklyEditor.vue';
import EditorSidebar from '@/components/editor/EditorSidebar.vue';
import EditorSidePanels from '@/components/editor/EditorSidePanels.vue';
import EditorToast from '@/components/editor/EditorToast.vue';
import EditorBreadcrumb from '@/components/editor/EditorBreadcrumb.vue';
import EditorHeaderActions from '@/components/editor/EditorHeaderActions.vue';
import EditorStatusBar from '@/components/editor/EditorStatusBar.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import CodePanel from '@/components/editor/CodePanel.vue';
import { useEditorSplit } from '@/components/editor/useEditorSplit';
import { useEditorFileActions } from '@/components/editor/useEditorFileActions';
import { useEditorPanels } from '@/components/editor/useEditorPanels';
import { buildDocsLocation } from '@/utils/docs-search-entry';
import { useEditorWorkspaceActions } from '@/components/editor/useEditorWorkspaceActions';
import { useCodeToWorkspaceImport } from '@/components/editor/useCodeToWorkspaceImport';
import { useIntakeRoute } from '@/components/editor/useIntakeRoute';
import { useWorkspaceStats } from '@/components/editor/useWorkspaceStats';
// 编辑器专属注册只在 /editor 路由加载，避免污染项目列表首屏。
import '@/blocks';
import '@/generators/javascript';
import '@/generators/python';
import {
  CODE_LANGUAGES,
  LANGUAGE_LABELS,
  type CodeLanguage,
} from '@/constants/code-languages';
import { useBlocklyLocale, ui } from '@/composables/locale';
import { useEditorProject } from '@/composables/useEditorProject';
import { patchProjectEntry, refreshProjectList } from '@/components/editor/useProjectList';
import { useEditorToast } from '@/composables/useEditorToast';


/**
 * /editor 的壳：只做绑定与装配，编排在 src/components/editor/useEditor* 里。
 * - useEditorFileActions：多文件切换 / 新建 / 删除 / 入口（含回写顺序）
 * - useEditorPanels：侧栏面板（含 问答助手）、窄屏判定
 * - useEditorWorkspaceActions：菜单、导入导出、清空、生成
 * 壳里保留的是三者共享的引用（编辑器与代码面板实例）和路由级动作。
 */

const blocklyLocale = useBlocklyLocale();
blocklyLocale.initLocale();

const blocklyEditor = ref<InstanceType<typeof BlocklyEditor> | null>(null);
const codePanel = ref<InstanceType<typeof CodePanel> | null>(null);
const selectedLanguage = ref<CodeLanguage>(CODE_LANGUAGES.PYTHON);
const exportFormat = ref<'json' | 'xml'>('json');
const importFormat = ref<'auto' | 'json' | 'xml'>('auto');

const currentWorkspace = computed(() => blocklyEditor.value?.workspaceRef || null);

/** 状态栏积木数与「画布变了」的共同出口：文件操作、导入、代码载入都要经过它。 */
const { blockCount, refreshBlockCount, onWorkspaceChanged } = useWorkspaceStats({
  workspace: () => currentWorkspace.value,
  markDirty: () => cleanupWorkspaceHandler?.(),
});

// Toast 先建立：面板与文件操作都靠它回执（保存提示、入口提示、删除拒绝）。
const {
  visible: toastVisible,
  message: toastMessage,
  show: showToast,
  showLater,
} = useEditorToast();

const toggleBlocklyLocale = async (): Promise<void> => {
  await blocklyLocale.setLocale(
    blocklyLocale.getCurrentLocale() === 'zh-hans' ? 'en' : 'zh-hans',
  );
  blocklyEditor.value?.updateToolbox();
  blocklyEditor.value?.refreshBlocks();
  // 延迟到语言覆盖生效后再提示，避免文案比界面先切。
  showLater(ui('localeChanged'), 50, 2000);
};

const {
  activePanel,
  isNarrowViewport,
  togglePanel,
  closePanel,
  openPanel,
  openDocLine,
  onOpenDocHit,
} = useEditorPanels({ notify: showToast });

/** 项目 id 来自 /editor/:id；项目面板用它高亮当前项。 */
const route = useRoute();
const router = useRouter();

/** 文档中心是独立路由页（不是侧栏面板）：入口在工具栏「文档」与检索面板底部的「浏览全部文档」。 */
function openDocs(q?: unknown): void {
  closeMenus();
  // 两个调用点：工具栏 open-docs 零载荷（`'open-docs': []`），面板 browse-all 传 string。
  void router.push(buildDocsLocation(q));
}

/** A 线条款锚点：打开标准原文并定位到行（与检索命中共用 openDocLine 的新标签页/回退策略）。 */
function openStandardSource(payload: { doc: string; line: number }): void {
  closeMenus();
  openDocLine(payload.doc, payload.line);
}
const currentProjectId = computed(() => Number(route.params.id) || null);

/** 问答助手（文档/积木检索）要读路径与摘录、函数面板是「名字 + 参数 + 两枚动作」的密排行、
 *  代码面板要放粘贴框与诊断清单，248px 都不够用；进这些面板自动展宽，回文件/项目收回缺省宽度。 */
watch(activePanel, (panel) => {
  const wide = panel === 'assistant' || panel === 'functions' || panel === 'intake' || panel === 'code' || panel === 'standards';
  setLeftWidth(wide ? (panel === 'assistant' || panel === 'functions' ? 400 : 460) : undefined);
});

// 文件操作要置「有未保存改动」，而脏标记由保存层（useEditorProject）提供；
// 保存层反过来又要用文件操作落库。用一次性回填打破这个循环——markFilesChanged
// 只在用户事件里调用，setup 结束时已回填。
const saveHooks: { markFilesChanged: (() => void) | null } = {
  markFilesChanged: null,
};

const {
  files: projectFileList,
  activeFileId: activeProjectFileId,
  entryFileId: entryProjectFileId,
  activeFile: activeProjectFile,
  syncActiveFile,
  onSelectProjectFile,
  onAddProjectFile,
  onRenameProjectFile,
  onDeleteProjectFile,
  onSetEntryFile,
  applyProject: applyProjectFiles,
  getFiles,
  getEntryFileId,
  getEntryWorkspace,
} = useEditorFileActions({
  editor: blocklyEditor,
  markFilesChanged: () => saveHooks.markFilesChanged?.(),
  notify: showToast,
  afterWorkspaceSwitch: () => refreshBlockCount(),
});

/** 工作区 change 事件的处理函数，由 BlocklyEditor 在 change 时先请一次。 */
let cleanupWorkspaceHandler: (() => void) | null = null;

const {
  projectName,
  autoSaveEnabled,
  saving,
  saveStatus,
  lastSaveTime,
  navigationPending,
  doSave,
  handleNewWorkspace,
  markFilesChanged,
  applyExternalRename,
} = useEditorProject({
  getWorkspaceXml: () => blocklyEditor.value?.exportWorkspace('xml') || '',
  language: selectedLanguage,
  loadWorkspace: (payload: string, format?: 'json' | 'xml') =>
    blocklyEditor.value?.loadWorkspace(payload, format ?? 'xml') || false,
  onWorkspaceChange: (handler: () => void) => {
    cleanupWorkspaceHandler = handler;
    return () => {
      cleanupWorkspaceHandler = null;
    };
  },
  clearWorkspace: () => {
    blocklyEditor.value?.clearWorkspace();
    codePanel.value?.clearCode();
  },
  // 多文件钩子：载入时初始化文件清单并返回入口文件负载
  applyProject: (record) => applyProjectFiles(record),
  getFiles: () => getFiles(),
  getEntryFileId: () => getEntryFileId(),
  getEntryWorkspace: () => getEntryWorkspace(),
});
saveHooks.markFilesChanged = markFilesChanged;

// 侧栏「项目」面板是常驻组件：保存/切换不通知它，列表就会停在旧快照
// （典型症状：改了项目名，项目面板里还是旧名）。
watch(saveStatus, (status) => {
  if (status !== 'saved') return;
  patchProjectEntry(currentProjectId.value, {
    name: projectName.value || undefined,
    updatedAt: new Date().toISOString(),
  });
  void refreshProjectList();
});

watch(currentProjectId, () => {
  void refreshProjectList();
});

/** 侧栏「项目」面板行内改名已落库：只把名字接进编辑器，不再走一次保存。
 *  不这么做时，编辑器手里的 projectName 还是旧值，下次保存会把旧名字写回去，
 *  把用户刚改好的名字覆盖掉。 */
function onProjectRenamed(id: number, name: string): void {
  if (id === currentProjectId.value) applyExternalRename(name);
}

const {
  openMenu,
  toggleMenu,
  closeMenus,
  onImportFile,
  handleExport,
  handleClear,
  generateCode,
} = useEditorWorkspaceActions({
  editor: blocklyEditor,
  codePanel,
  syncActiveFile,
  exportFormat,
  notify: showToast,
  afterWorkspaceReplaced: onWorkspaceChanged,
});

/** 状态栏显示的语言名（与代码栏下拉一致的标签）。 */
const languageLabel = computed(
  () => LANGUAGE_LABELS[selectedLanguage.value] ?? selectedLanguage.value,
);

// ---- 代码 → 工作区（A/B 线入口；当前只开 B1：本平台生成的 Python）----
const { openCodeToWorkspace, onApplyReversedWorkspace } = useCodeToWorkspaceImport({
  openPanel: () => {
    sidebarVisible.value = true;
    openPanel('code');
  },
  closePanel,
  loadWorkspace: (state) => blocklyEditor.value?.loadWorkspace(JSON.stringify(state), 'json') ?? false,
  notify: showToast,
  afterApplied: onWorkspaceChanged,
  beforeOpen: closeMenus,
});

/** A/B 单入口（PLAN P5）：判别在面板里，这里只管路由与预填（细节在组合式函数里）。 */
const { codeIntake, docIntake, onIntakeRoute } = useIntakeRoute({
  openPanel,
  showSidebar: () => {
    sidebarVisible.value = true;
  },
  notify: showToast,
});


async function onManualSave(): Promise<void> {
  if (!(await doSave())) return;
  showToast(ui('saved'));
}

// ---- 拖拽分割条 ----
const { editorViewRef, codeStyle, editorStyle, leftStyle, setLeftWidth, codePaneVisible, toggleCodePane, sidebarVisible, toggleSidebar, onSplitDragStart, onLeftDragStart } =
  useEditorSplit({
    onResize: () => blocklyEditor.value?.resizeWorkspace(),
  });
</script>

<style scoped>
.editor-view {
  height: 100%;
  display: flex;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg-main);
  color: var(--color-text);
}

/* ---- 左侧区 ---- */
.view-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* Blockly 工具箱是 z-index:70 的绝对定位元素，与 .split-handle 的 z-index:20 在同一个
     层叠上下文里比大小——结果是工具箱压住分界条，hover 高亮永远不触发（实测
     elementFromPoint 在分界处命中 blocklyToolboxCategory）。这里建一个独立层叠上下文，
     把算法内部的 z-index 全关在中间栏里：应用自己的 chrome 永远在它上面。 */
  isolation: isolate;
}

/* 顶栏：面包屑占满剩余宽度，应用级动作组钉在右端（紧邻代码栏分隔线）。
   下边框放在这一层，面包屑自己的那条去掉，否则会画两条线。 */
.editor-head {
  display: flex;
  align-items: stretch;
  gap: 12px;
  min-width: 0;
  height: var(--editor-bar-h);
  padding-right: var(--bar-pad-x);
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.editor-head :deep(.editor-breadcrumb) {
  flex: 1;
  min-width: 0;
  height: auto;
  border-bottom: none;
}

/* ---- 分割条 ---- */
/* 负 margin 让 8px 的条子跨在边界两侧（每侧 4px 热区），但**左右必须对称**：
   写成 -5px/-5px 时净占位是 8-10=-2px，会把右邻栏往左拽进侧栏 2px，分割线也落在
   侧栏内部。对称值净占位为 0，边界位置不动，线正好画在边界上。 */
.split-handle {
  width: 8px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  /* 要压住 Blockly 工具箱（它是 z-index:70 的绝对定位元素），见 .view-left 的 isolation。 */
  z-index: 20;
  margin-left: -4px;
  margin-right: -4px;
  transition: background 0.15s;
}

.split-handle:hover {
  background: var(--color-primary-light);
}

/* 通高分隔线：三栏边界必须在正文里一直可见，不能只靠拖拽时的那一小段抓手。 */
.split-line {
  width: 1px;
  height: 100%;
  border-radius: 0;
  background: var(--color-border);
  transition: background 0.15s, width 0.15s;
}

.split-handle:hover .split-line {
  background: var(--color-primary);
}

/* ---- Toast 提示 ---- */
/* ---- 响应式 ---- */
@media (max-width: 1200px) {
  .editor-view {
    flex-direction: column;
  }

  /* 窄屏按 2:1 分配高度：积木分类有 17 组，画布太矮会直接丢掉分类。 */
  .view-left {
    width: 100% !important;
    flex: 2;
    height: auto;
    min-height: 0;
  }

  .split-handle {
    width: 100%;
    height: 8px;
    flex-shrink: 0;
    cursor: row-resize;
    /* 纵向同样是「对称负 margin」：净占位为 0，中间栏不会被拉进上/下邻栏。 */
    margin: -4px 0;
  }

  .split-line {
    width: 40px;
    height: 2px;
  }

  /* 窄屏侧栏是顶部横条，没有左右分栏，左侧拖拽条既没意义还会在顶栏残留一截短线。 */
  .split-handle-left {
    display: none;
  }
}
</style>
