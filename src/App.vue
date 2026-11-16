<template>
  <div ref="editorViewRef" class="editor-view" :inert="navigationPending" @click="closeMenus">
    <!-- 窄屏侧栏被折成顶部横条：leftStyle 里的 `flex: 0 0 400px` 在纵向布局里
         会变成「高度 400px」，一开检索面板顶栏就长成一大块，所以只在宽屏钉宽度。 -->
    <EditorSidebar
      :style="isNarrowViewport ? undefined : leftStyle"
      :files="projectFileList"
      :active-file-id="activeProjectFileId"
      :entry-file-id="entryProjectFileId"
      :active-panel="activePanel"
      @back="goBack"
      @select-file="onSelectProjectFile"
      @add-file="onAddProjectFile"
      @rename-file="onRenameProjectFile"
      @delete-file="onDeleteProjectFile"
      @set-entry="onSetEntryFile"
      @toggle-panel="togglePanel"
    >
      <!-- 互斥面板：同一时刻只渲染一个，与 activity bar 的选中项一一对应。 -->
      <ProjectPanel
        v-if="activePanel === 'projects'"
        :current-id="currentProjectId"
        :overlay="isNarrowViewport"
        @close="closePanel"
      />
      <CryptoFunctionPanel
        v-else-if="activePanel === 'functions'"
        :visible="true"
        :workspace="currentWorkspace"
        :docked="!isNarrowViewport"
        @close="closePanel"
      />
      <DocSearchPanel
        v-else-if="activePanel === 'docSearch'"
        :visible="true"
        :docked="!isNarrowViewport"
        @close="closePanel"
        @open="onOpenDocHit"
      />
      <BlockSearchPanel
        v-else-if="activePanel === 'blockSearch'"
        :visible="true"
        :workspace="currentWorkspace"
        :docked="!isNarrowViewport"
        @close="closePanel"
      />
    </EditorSidebar>

    <div class="split-handle split-handle-left" @mousedown="onLeftDragStart">
      <div class="split-line" />
    </div>

    <div class="view-left" :style="editorStyle">
      <EditorBreadcrumb
        :project-name="projectName"
        :file-name="activeProjectFile?.name"
        :is-entry="activeProjectFileId === entryProjectFileId"
        @update:project-name="projectName = $event"
      />
      <EditorToolbar
        :saving="saving"
        :save-status="saveStatus"
        :last-save-time="lastSaveTime"
        :auto-save-enabled="autoSaveEnabled"
        :locale-label="localeLabel"
        :open-menu="openMenu"
        :export-format="exportFormat"
        :import-format="importFormat"
        @save="onManualSave"
        @update:auto-save-enabled="autoSaveEnabled = $event"
        :code-pane-visible="codePaneVisible"
        @toggle-locale="toggleBlocklyLocale"
        @toggle-code-pane="toggleCodePane"
        @toggle-menu="toggleMenu"
        @update:export-format="exportFormat = $event"
        @update:import-format="importFormat = $event"
        @export="handleExport"
        @import-file="onImportFile"
        @new-workspace="handleNewWorkspace"
        @clear="handleClear"
        @open-docs="openDocs"
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

    <CodePanel
      v-if="codePaneVisible"
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
      @collapse="toggleCodePane"
    />

    <EditorToast :visible="toastVisible" :message="toastMessage" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BlocklyEditor from '@/components/BlocklyEditor.vue';
import CryptoFunctionPanel from '@/components/CryptoFunctionPanel.vue';
import DocSearchPanel from '@/components/ai-helper/DocSearchPanel.vue';
import ProjectPanel from '@/components/editor/ProjectPanel.vue';
import BlockSearchPanel from '@/components/ai-helper/BlockSearchPanel.vue';
import EditorSidebar from '@/components/editor/EditorSidebar.vue';
import EditorToast from '@/components/editor/EditorToast.vue';
import EditorBreadcrumb from '@/components/editor/EditorBreadcrumb.vue';
import EditorStatusBar from '@/components/editor/EditorStatusBar.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import CodePanel from '@/components/editor/CodePanel.vue';
import { useEditorSplit } from '@/components/editor/useEditorSplit';
import { useEditorFileActions } from '@/components/editor/useEditorFileActions';
import { useEditorPanels } from '@/components/editor/useEditorPanels';
import { useEditorWorkspaceActions } from '@/components/editor/useEditorWorkspaceActions';
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
 * - useEditorPanels：函数模板与文档检索面板、窄屏判定
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
const blockCount = ref(0);

// Toast 先建立：面板与文件操作都靠它回执（保存提示、入口提示、删除拒绝）。
const {
  visible: toastVisible,
  message: toastMessage,
  show: showToast,
  showLater,
} = useEditorToast();

const toggleBlocklyLocale = (): void => {
  blocklyLocale.setLocale(
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
  onOpenDocHit,
} = useEditorPanels({ notify: showToast });

/** 项目 id 来自 /editor/:id；项目面板用它高亮当前项。 */
const route = useRoute();
const router = useRouter();

/** 文档中心是独立路由页（不是侧栏面板）：入口在工具栏「文档」。 */
function openDocs(): void {
  closeMenus();
  void router.push('/docs');
}
const currentProjectId = computed(() => Number(route.params.id) || null);

/** 检索面板需要读路径与摘录，248px 不够；进检索自动展宽，回文件/项目收窄。 */
watch(activePanel, (panel) => {
  const wide = panel === 'docSearch' || panel === 'blockSearch';
  setLeftWidth(wide ? 400 : undefined);
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
} = useEditorProject({
  getWorkspaceXml: () => blocklyEditor.value?.exportWorkspace('xml') || '',
  language: selectedLanguage,
  loadWorkspaceXml: (xml: string) =>
    blocklyEditor.value?.loadWorkspace(xml, 'xml') || false,
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

const currentWorkspace = computed(() => blocklyEditor.value?.workspaceRef || null);

const localeLabel = computed(() =>
  blocklyLocale.getCurrentLocale() === 'zh-hans' ? 'EN' : '中文',
);

/** 状态栏显示的语言名（与代码栏下拉一致的标签）。 */
const languageLabel = computed(
  () => LANGUAGE_LABELS[selectedLanguage.value] ?? selectedLanguage.value,
);

/** 只刷新底部积木数（切换文件 / 新建文件这类「画布被换掉」的场景）。 */
function refreshBlockCount(): void {
  blockCount.value = currentWorkspace.value?.getAllBlocks(false).length ?? 0;
}

/** 用户真的改了画布：刷新积木数并交给保存层置脏。 */
function onWorkspaceChanged(): void {
  refreshBlockCount();
  if (cleanupWorkspaceHandler) cleanupWorkspaceHandler();
}

async function onManualSave(): Promise<void> {
  if (!(await doSave())) return;
  showToast(ui('saved'));
}

function goBack(): void {
  // 项目列表已收进侧栏（与 metacrypt 一致），返回键展开「项目」面板而不是跳页。
  activePanel.value = 'projects';
}

// ---- 拖拽分割条 ----
const { editorViewRef, codeStyle, editorStyle, leftStyle, setLeftWidth, codePaneVisible, toggleCodePane, onSplitDragStart, onLeftDragStart } =
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
}

/* ---- 分割条 ---- */
/* 负 margin 向两侧面板各延伸 5px 点击热区，视觉宽度不变。
   即使 Blockly SVG 缩放后溢出，也无法盖住中心区域。 */
.split-handle {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 20;
  margin-left: -5px;
  margin-right: -5px;
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
    height: 6px;
    flex-shrink: 0;
    cursor: row-resize;
    margin: -5px 0;
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
