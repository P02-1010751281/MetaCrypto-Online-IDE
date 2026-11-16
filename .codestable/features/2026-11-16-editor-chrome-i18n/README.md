# 编辑器壳层与侧栏 chrome 的双语文案：缺键、键名外露、开关到不了

日期：2026-11-16
关联：`../2026-11-16-sidebar-chrome/`（同一片界面的上一段：共享面板 chrome）、`../2026-11-16-editor-header/`

## 问题

右上角的语言开关（`FeaturesLayout.toggleDocsLang`）同时切文档语言与 Blockly 语言，
但编辑器壳层与侧栏面板不在它的覆盖范围内：

1. 面包屑、状态条、代码工具栏、侧栏六个面板的标题**永远是中文**；
2. 更糟的是有些位置把**键名本身**画了出来——`unnamedProject`、`noFileOpen`、
   `projectOverview`、`statusSaving` 之类直接出现在界面上；
3. 中文界面里导出工作区，提示是 `exported: /path/…`。

## 改前实测

对 `src/` 下所有 `ui('…')` 字面量引用做静态扫描（编辑器与侧栏相关文件）：

| 观测 | 改前 |
|---|---|
| `ui('…')` 字面量引用 | 100 处（全仓，无模板字面量键） |
| 引用但两个语言包都没有的键 | **27 个**（`unnamedProject`、`entryBadge`、`closeFile`、`noFileOpen`、`checkPassed/Failed`、`commandPalette`、`statusSaving/Unsaved/Ready`、`projectOverview`、`filesUnit`、`entryNotSet`、`openEntryFile`、`browseFiles`、`newBlockFile`、`copy`/`copied`、`clearConfirm`、`clearConfirmTitle`、`hash`、`blockCipher`、`streamCipher`、`xof`、`unknown`、`generate`、`functionManager`） |
| 语言包键数（HEAD） | zh **113** / en **115** |
| 只在 en 侧的键 | `exported`、`exportError` |
| 侧栏六个面板标题 | 全部硬编码中文（`项目`/`当前项目`/`项目评论`/`项目成员`/`版本历史`/`证据`） |

`ui()` 的实现是

```ts
UI_MESSAGES[locale]?.[key] || UI_MESSAGES['zh-hans'][key] || key
```

所以缺键既不报错也不空白，而是**把键名当文案返回**——这就是界面上出现
`noFileOpen` 的原因。`ui('exported') || 'Exported'` 这种"兜底"也永远触发不到，
因为 `ui()` 永远不会返回空串。

## 根因

三条，缺一条都不会有今天这个局面：

1. **语言包是 CipherCat → metacrypt 的单向镜像权威源**
   （`scripts/sync-to-metacrypt.sh` 的 `[3.8]`：`src/composables/locale/*.ts` 逐文件 `cp`
   到 `core/utils/locale/*.ts`）。metacrypt 编辑器拆分（`views/editor/*`）把原来的
   硬编码中文换成了 `ui()` 键，但这些键从未进过权威源——下次同步会被原样覆盖，
   所以键只能加在 CipherCat。
2. **三套门禁对缺键全部沉默**：`vue-tsc` 只要求 `ui()` 的参数是 `string`；eslint 不看
   字符串内容；此前的单测没有一条断言文案。缺键是"类型正确、构建通过、界面出错"。
3. **侧栏 chrome 是硬编码中文**，与键缺失是两件事：六个面板头各写各的 `<span>` 中文，
   语言开关根本没有接入点（上一段 `2026-11-16-sidebar-chrome/` 统一了它们的样式，
   但没统一文案来源）。

## 改动

### 1. 权威源补键（CipherCat）

`src/composables/locale/ui-messages.ts`：zh 113 → **148**，en 115 → **148**（+35 / +33），
两份键集完全一致。新增键按族分：

| 族 | 键 |
|---|---|
| 空态概览 | `projectOverview`、`unnamedProject`、`filesUnit`、`entryNotSet`、`openEntryFile`、`browseFiles`、`newBlockFile` |
| 状态条 | `noFileOpen`、`checkPassed`、`checkFailed`、`commandPalette`、`statusSaving`、`statusUnsaved`、`statusReady` |
| 代码栏 | `hash`、`blockCipher`、`streamCipher`、`xof`、`unknown`、`copy`、`copied` |
| 文件面板 | `projectFiles`、`fileActions`、`entryBadge`、`closeFile`、`noMatchingProjects`、`projectActions` |
| 侧栏面板标题 | `panelCurrentProject`、`panelProjectComments`、`panelProjectMembers`、`panelRevisionHistory`、`panelEvidence` |
| 清空确认 | `clearConfirm` |
| 补齐中文 | `exported`、`exportError`（原先只在英文侧） |

### 2. 不新增键、直接复用已有键

| 原引用 | 改为 | 理由 |
|---|---|---|
| `ui('functionManager')` | `ui('functionsPanel')` | 语义完全相同，已有键 |
| `ui('generate')` | `ui('generateCode')` | 同上 |
| `ui('clearConfirmTitle')` | 标题 `ui('clearWorkspace')` + 按钮 `ui('confirm')` | 原代码把**标题**同时当确认按钮文案（`confirmButtonText: ui('clearConfirmTitle')`），按钮与标题同文，语义错位 |

### 3. 组件接线

| 文件 | 动作 |
|---|---|
| `views/editor/EditorSidebar.vue` | 活动条 3 个 `title`、项目/文件两个面板头、搜索占位、空态、新建/导出/清空菜单项、文件区标题与计数、行内入口徽标、检查结果标题、文件行菜单 tooltip 全改走 `ui()` |
| `plugins/ui/builtin/BuiltinActivityBar.vue` | `labelFor()` 的三个硬编码标题改 `ui('panel…')` |
| `plugins/ui/builtin/{Comments,Members,RevisionHistory}Panel.vue` | 面板标题 + 关闭按钮 `title`/`aria-label` 走 `ui()` |
| `views/EditorView.vue` | 上面两处键名纠偏；`generate`/`functionManager` 归位 |
| `views/editor/useEditorProjectActions.ts` | 清空确认框的标题/按钮文案纠偏 |

### 4. 镜像

`cp` 到 `metacrypt_server/frontend/src/features/blockly/core/utils/locale/ui-messages.ts`
后 `cmp` **逐字节一致**（不跑整个 sync 脚本：`views/editor/` 侧仍是 owner 的未提交 WIP）。

## 门禁（可复跑）

| 门禁 | 位置 | 断言数 |
|---|---|---|
| `ui()` 键位契约（metacrypt） | `tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts` | 6 |
| 壳层文案真渲染（metacrypt） | `tests/frontend/unit/blockly/components/editor-chrome-locale.test.ts` | 4 |
| `ui()` 键位契约（CipherCat） | `tests/unit/locale-ui-messages.test.ts` | 6 |

覆盖的四件事：

1. 源码里每个 `ui('字面量')` 的键在 zh 与 en 里都存在（失败时给 `文件:行号`）；
2. 两个语言包的键集一致（否则某一边静默回退到中文或键名）；
3. 英文文案里不残留中文（中文侧允许保留拉丁术语，反向不成立）；
4. 组件真挂载后文案是译文且**不含键名**，切语言会逐项换。

### 变异验证

`evidence/reproduce-mutations.sh`（输出见 `evidence/mutation-log.txt`），四条：

| 变异 | 结果 |
|---|---|
| en 侧删掉 `filesUnit` | **2 红**：引用缺失（列出 `EditorProjectOverview.vue:8`、`EditorSidebar.vue:171`/`:246`）+ 键集不一致 |
| 源码引用字典里没有的 `bogusChromeKey` | **1 红**：`EditorView.vue:78 ui('bogusChromeKey') 缺 zh+en` |
| en 的 `statusReady` 写成中文 | **1 红**：英文残留中文 `['statusReady']` |
| 状态条文案退回硬编码中文 | **1 红**：渲染断言 `expected '文件未打开命令面板…' to contain '未打开文件'` |
| 还原后复跑 | 10/10 绿 |

## 验收

终态门禁输出见 `evidence/gate-output.txt`（两仓实跑）。

| 仓 | 结果 |
|---|---|
| CipherCat | `lint:check` 0 / `type-check` 0 / `test:unit` **1017 passed, 1 skipped**（89 文件）/ `verify:all` RC=0（模板 29/29、demo 60/60） |
| metacrypt_server | `lint:check` 0 / `type-check` 0 / `test:unit` **970 passed**（111 文件，较上轮 +10 即本轮两个文件）/ `build:prod` 0 / `verify:chrome` **6/6** |

行数预算：`EditorSidebar.vue` 363、`EditorView.vue` 498、三个贡献面板 248 / 284 / 342，
全部 ≤500。

## 残留（下一刀的精确清单）

1. ~~面板体与脚本区仍是硬编码中文~~ —— 已在「第二半」完成，见下节。
2. **侧栏本体没有组件级渲染断言**：`EditorSidebar` 的 import 链会带进 Element Plus 与
   `store/modules/settings`（读 `localStorage`、拉 `layout/components/Sidebar/Logo.vue`），
   在 jsdom 里挂载需要额外桩；本轮只做到「静态键位契约」+「两个纯展示组件（状态条、
   空态概览）的真渲染」。侧栏本体的真机验收仍需 metacrypt 后端栈起来后登录进
   `/blockly/index`。
3. metacrypt 侧改动仍未提交：`views/editor/` 整个目录在既有 WIP 里是 untracked，
   与本轮的语言包/三个已跟踪文件一起收在 owner 的 WIP 落地时最干净。

---

# 第二半：面板体与脚本区（同日 19:00–19:25）

## 问题

上一轮只做了「chrome 那一半」：活动条、面板头、状态条、空态概览。面板**体**里仍是
硬编码中文——本轮开工前实测（含脚本区、含注释）**174 行含中文**：

| 文件 | 含中文行 |
|---|---|
| `EditorSidebar.vue` | 18 |
| `CommentsPanel.vue` | 14 |
| `MembersPanel.vue` | 21 |
| `RevisionHistoryPanel.vue` | 30 |
| `useEditorProjectActions.ts` | 25 |
| `useEditorUiHost.ts` | 19 |
| `commands.ts` | 24 |
| `snapshot.ts` | 5 |
| `editorProjectPresentation.ts` | 4 |

其中约 1/3 是注释（保留中文），真正的界面文案约 100 处：文件区菜单、行内操作、
三个面板的正文与 `ElMessageBox`、命令面板 23 个条目、快照/分支/合并/恢复的确认框、
以及 17 条抛给用户的错误文案。

## 改动

| 位置 | 改动 |
|---|---|
| `src/composables/locale/ui-messages.ts`（权威源） | 148 → **249** 键（+101），中英键集仍逐键一致 |
| `src/composables/locale/ui.ts` + `index.ts` | 新增 `uiFormat(key, vars)`：填充 `{name}` / `{path}` / `{label}` / `{n}`，**未提供的占位符原样保留**（漏填会在界面上暴露，而不是静默丢字） |
| 9 个消费者文件 | 全部界面文案改走 `ui()` / `uiFormat()`；`commands.ts` 的 `keywords:` 保留中英双语（检索别名是数据，不是文案） |
| 镜像 | `cp` 后 `cmp`：`ui-messages.ts` / `ui.ts` / `index.ts` 三份逐字节一致 |

命名上刻意避开同义双键：侧栏菜单与命令面板共用 `createBlocklyFile` 等一批键（初版曾
写成 `newBlocklyFile`，两处文案不同就得两把键，已合并）。

## 门禁（本轮新增/扩展，均可复跑）

| 门禁 | 位置 | 断言数 |
|---|---|---|
| `ui()` 键位契约 | `metacrypt/tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts` | 6 → **11** |
| 编辑器壳层不许硬编码中文 | `metacrypt/tests/frontend/unit/blockly/locale/editor-chrome-no-hardcoded.test.ts` | **3**（新增） |
| 壳层文案真渲染 | `metacrypt/tests/frontend/unit/blockly/components/editor-chrome-locale.test.ts` | 4 |
| `ui()` 键位契约（权威源侧） | `CipherCat/tests/unit/locale-ui-messages.test.ts` | 6 → **7** |

新增的五条契约：

1. `uiFormat('键')` 的键同样必须中英都有——上一版只扫 `ui()`，`uiFormat` 是给缺键开后门；
2. 扫描确实覆盖到 `uiFormat` 调用（防止正则写错后这条恒绿）；
3. `ui()` 直接取的键里不许留 `{占位符}`（否则界面显示 `确定移除成员 {name}？`）；
4. `uiFormat` 的键必须真的带占位符，并验填充/保留未知占位符两种行为；
5. 同一个键在中英两侧的 `{占位符}` 集合必须一致（英文丢占位符会让变量静默消失）。

壳层扫描的豁免只到最小单位：HTML/块/行注释（中文注释保留），以及 `keywords:` 那一段
本身——**同一行若还有中文 `label:` 照样会红**（阴性对照里专门放了一条这样的样本）。

## 变异验证

`evidence/verify-mutations-panel-i18n.sh`（输出 `evidence/mutation-output.txt`），五条：

| 变异 | 结果 |
|---|---|
| 界面文案写回硬编码中文（`＋ 新建`） | **1 红**：`界面文案里没有硬编码中文（注释与 keywords 豁免）` |
| 从英文包删掉 `removeMemberConfirm` | **3 红**：引用缺失 + 键集不一致 + `uiFormat` 键缺失 |
| 用 `ui()` 直接取 `switchBranchConfirm` | **1 红**：`ui() 直接取的键里不许留 {占位符}` |
| 用 `uiFormat()` 取没有占位符的 `importWorkspace` | **1 红**：`uiFormat 的键必须真的带占位符` |
| 英文侧把 `Remove member {name}?` 改成 `Remove member?` | **1 红**：`{占位符} 集合必须一致` |
| 还原后复跑 | **18/18 绿**，五处均 `cmp` 逐字节还原 |

## 验收（终态实跑）

| 仓 | 结果 |
|---|---|
| CipherCat | `lint:check` 0 / `type-check` 0 / `test:unit` **1018 passed, 1 skipped**（89 文件） / `verify:all` RC=0（模板 29/29、demo 60/60） |
| metacrypt_server | `lint:check` 0 / `type-check` 0 / `test:unit` **978 passed**（112 文件）/ `build:prod` 0 / `verify:chrome` **6/6** |

行数：`EditorSidebar` 363、`EditorView` 498、`useEditorUiHost` 396、`useEditorProjectActions` 342、
三个面板 248 / 284 / 342、`commands` 101、`snapshot` 35，全部 ≤500。

## 残留

1. `useEditorCodeRunner.ts:114` 的 MCL 提示是**有意例外**：CipherCat 没有 MCL 语言，
   权威语言包没有对应键，而 `utils/locale` 是整体镜像（多余文件会被同步删掉），
   所以中英两版就地保存在该文件里，不进字典、不在扫描名单内。
2. 三个面板仍没有组件级渲染断言：`MembersPanel` / `RevisionHistoryPanel` 需要 mock
   `host.services`（成员、版本、分支），`CommentsPanel` 需要评论服务；本轮的保证来自
   「静态无中文 + 键位契约 + `ui()` 行为」三条，真机验收仍需 metacrypt 后端栈。
3. metacrypt 侧改动仍未提交（`views/editor/` 整个目录在既有 WIP 里是 untracked）。
