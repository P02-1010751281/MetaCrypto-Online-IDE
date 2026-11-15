# CipherCat → metacrypt_server 编辑器壳对齐白名单

本页记录两仓编辑器壳与运行链的**对齐判定**：哪些文件可以机械同步、哪些必须适配移植、哪些必须排除。判定依据全部来自本页给出的可复跑命令，不采用目录名或印象推断。本页只给判定，不代表已经执行移植。

## 1. 结论先行

1. **两仓编辑器壳不是同一套结构。** CipherCat 的壳根是 `src/App.vue`（路由 `/editor/:id` 直接挂载），编排与组件放在 `src/components/editor/` 与 `src/composables/`；metacrypt_server 的壳根是 `frontend/src/features/blockly/views/EditorView.vue`，编排已拆成 `views/editor/` 下的 7 个模块与 5 个 CSS 分片（共 12 个文件）。
2. **因此没有可逐字节镜像的壳文件。** 两侧同名文件实测均不一致（见第 3 节 A 类）。
3. **可对齐的是运行链，且必须适配移植。** 四项差异见第 3 节 B 类；它们跨目录、跨别名，不能 `cp`。
4. **`scripts/sync-to-metacrypt.sh` 的范围是 Blockly 核心**（`blocks/`、`generators/`、`constants/`），编辑器壳不在其中，也不应直接并入——两侧壳的宿主依赖不同。

## 2. 两侧结构对照

| 职责 | CipherCat | metacrypt_server | 关系 |
|---|---|---|---|
| 壳根 | `src/App.vue`（487 行） | `views/EditorView.vue`（491 行） | 同源分叉，行数接近但拆分不同 |
| 侧栏/工具栏/状态栏 | `src/components/editor/*`（9 个文件） | `views/editor/*`（7 个模块 + 5 个 CSS，共 12 个文件） | 目录与粒度不同 |
| 项目数据 | `src/composables/useProjectDB.ts`、`useProjectFiles.ts`（IndexedDB） | `features/blockly/api/*`（6 个后端模块） | **存储模型不同** |
| 运行链 | `src/runtime/run-code.ts`、`python-runner.worker.ts`、`js-runner.worker.ts` | `utils/run-code.ts`、`python-runner.worker.ts` | 缺 JS worker |
| Pyodide 资源 | `devDependency pyodide ^0.25.1` + `scripts/copy-pyodide.mjs` + `predev`/`prebuild` | `frontend/public/pyodide/` 7 个文件入库 | 版本相同（0.25.1 / Python 3.11.3），管理方式不同 |
| 内容安全策略 | `index.html`：`script-src 'self'` | 无 CSP | metacrypt 缺策略 |

CipherCat 侧**没有 `src/api` 层**，壳文件对 `@/api`、`@/store`、`@/router`、`axios`、`element-plus` 的引用计数全部为 0；metacrypt 侧的壳文件引用了 `features/blockly/api/*`。

## 3. 三类判定

### A. 可机械镜像：现有壳文件 **0 个**，新增共享层 **4 个**

对两侧同名**壳**文件执行逐字节比较，全部不一致：

| 文件 | 结果 |
|---|---|
| `EditorSidebar.vue` | 482 行差异 |
| `EditorStatusBar.vue` | 107 行差异 |
| `editor-shell.css` 等 5 个 CSS 分片 | 只在 metacrypt 存在（CipherCat 用单个 `editor-sidebar.css`） |

结论不变：把壳整体拷过去不成立，改动必须按职责逐项适配。

不过第 1 步新增的共享层例外——它没有宿主依赖，可以整目录镜像。这也是让「可镜像文件数」从 0 变成正数的唯一办法：

| 文件 | 行数 | 说明 |
|---|---:|---|
| `runtime/contracts/run-chain.ts` | 70 | 纯类型，零依赖 |
| `runtime/run-code.ts` | 257 | 唯一注入点：`RuntimeAssets` |
| `runtime/python-runner.worker.ts` | 229 | 缺省回退同源 `/pyodide/` |
| `runtime/js-runner.worker.ts` | 81 | 同源 module worker |

### B. 需适配移植（运行链，4 项）

| 项 | CipherCat | metacrypt | 差异要点 | 移植动作 |
|---|---|---|---|---|
| 执行 JS 的线程 | `src/runtime/js-runner.worker.ts`（81 行） | 无；仍用 Blob worker + `new Function` | CipherCat 改同源 module worker，因为 `script-src 'self'` 会拦 Blob | 新增同名 worker，并调整调用方的 URL 构造 |
| 运行编排与进度 | `src/runtime/run-code.ts`（257 行） | `utils/run-code.ts`（227 行） | CipherCat 多出 `onProgress` 通道（加载字节进度）与 JS/Python 统一入口 | 移植进度通道，保留 metacrypt 现有的 `errorCode` + i18n 文案约定 |
| Python worker | `src/runtime/python-runner.worker.ts`（229 行） | 同名文件（104 行） | CipherCat 包装同源 `/pyodide/` 请求边读边计数，分母来自构建期 `manifest.json` | 需同时引入 `manifest.json`；否则进度只能退化为不定量 |
| Pyodide 资源管理 | `scripts/copy-pyodide.mjs`（65 行）+ `pyodide:copy` + `predev`/`prebuild`；`public/pyodide/` 已 gitignore | 7 个文件入库，无复制脚本、无 `predev`/`prebuild` | 版本同为 0.25.1，但 metacrypt 的版本只锁在入库文件里 | 改为出库 + 复制脚本，或保留入库但补 `manifest.json` 与版本校验 |

移植时的通用改动：`@/` 别名在 metacrypt 指向 `@/features/blockly/`，导入路径需改写；运行链不依赖 `core/`，但仍需避开 `api/`。

### C. 必须排除（绑定后端或结构不对应）

| metacrypt 文件 | 后端引用计数 | 排除理由 |
|---|---:|---|
| `views/editor/useEditorUiHost.ts` | 7 | 成员、分支、修订、协作全走后端接口 |
| `views/EditorView.vue` | 3 | 承载协作与修订编排，与 `App.vue` 职责不对应 |
| `views/editor/useEditorProjectActions.ts` | 3 | `renameProject` 等直接调 `api/project` |
| `views/editor/useEditorLifecycle.ts` | 1 | `ProjectFile` 类型来自 api 层 |
| `views/editor/editorProjectPresentation.ts` | 1 | 同上 |
| `views/editor/EditorSidebar.vue` | 1 | 同上 |
| `views/editor/useEditorCodeRunner.ts` | 1 | 类型依赖 api；但**运行逻辑本身可参考**，移植时按 B 类处理 |
| `features/blockly/api/*`（6 个模块） | — | CipherCat 无对应层（用 IndexedDB） |

`useEditorCodeRunner.ts` 归入此类是因为它的类型导入，不是因为它绑业务：移植运行链时应以它为宿主接入点，改写类型来源。

## 4. 前置顺序：先 worker，后 CSP

CipherCat 的 `index.html` 使用 `script-src 'self'`，Blob worker 会被直接拦下（依据是 `src/runtime/js-runner.worker.ts` 的注释与 CSP 规范：未声明 `worker-src` 时回退到 `script-src`，`blob:` 不在 `'self'` 内）。metacrypt 当前没有 CSP，所以 Blob worker 仍能运行。

因此顺序不能反：**先在 metacrypt 落地同源 module worker，再加入 CSP**。反向执行会让 metacrypt 的"运行 JS"在加上策略的瞬间失效，且症状是运行按钮无输出，容易被误判为生成器故障。

## 5. 复跑核对

```bash
# 两侧壳根规模
wc -l src/App.vue
wc -l ../metacrypt_server/frontend/src/features/blockly/views/EditorView.vue

# 同名文件是否逐字节一致（无输出即一致）
cmp src/components/editor/EditorSidebar.vue \
    ../metacrypt_server/frontend/src/features/blockly/views/editor/EditorSidebar.vue

# 后端耦合计数（CipherCat 应为 0）
grep -cE "from '@/(api|store|router)|axios|element-plus|/api/" src/App.vue

# Pyodide 版本
grep -n '"pyodide"' package.json
node -e 'const j=require("../metacrypt_server/frontend/public/pyodide/pyodide-lock.json");console.log(j.info)'
```

## 6. 未纳入本页范围

- metacrypt 专属目录（`features/blockly/algorithms/`、`generators/mcl/`、`utils/locale.ts`）不在镜像范围，本页不作判定。
- 两仓的项目存储模型差异（IndexedDB 与后端 API）属于架构差异，不通过文件同步解决。
- 本页不构成移植计划或排期，仅记录对齐判定的依据。

## 7. 当前进度（2026-11-15）

| 步骤 | 状态 | 证据 |
|---|---|---|
| 落契约（纯类型） | 已完成 | `src/runtime/contracts/run-chain.ts`；CipherCat `vue-tsc --noEmit` 通过 |
| 运行链移入共享目录 | 已完成 | `src/runtime/`：run-code 257 行 + 两个 worker；`useCodeRunner` 是唯一引用点，路径已改 |
| 注入 `RuntimeAssets` | 已完成 | 缺省仍取同源 `/pyodide/`；真浏览器实测默认 Python、默认 JS、显式注入三条路径均通过，0 控制台错误 |
| sync 白名单 | 已完成（隔离验证） | 新增 `[3.7]` 段；同一段逻辑连跑两次 md5 一致（`b937605d515e62cede20c61fe556179d`），目标内无 `@/runtime/` 残留 |
| metacrypt 侧就位 | 已完成（未切引用） | `features/blockly/runtime/` 写入 4 个文件；该仓库 `vue-tsc --noEmit` 0 错误、eslint 0 问题 |
| metacrypt 切引用 | 未执行（前置未清） | 镜像区仍有未提交改动，且是**静止堆积**而非当日新增：全 `features/blockly` 为 156 条目（含 22 个未跟踪条目，`git status -uall` 展开为 172 个文件）；已修改文件 mtime 集中在 2026-11-13（124 个）、11-14（6 个）、10-22（4 个） |
| sync 守卫加固 | 已完成 | 守卫从只查 `core` + `components` 扩到四个写入根（加 `services/projects`、`runtime`），实测 146 处（旧口径 144）；新增配对映射断言：配对目标落在同步不会写入的子树时 exit 1——旧版把 ProjectStore 指到 `core/services/`，这一对的导出预检一直被静默跳过；配对总数 343 → 347，跳过 3。变异验证：旧映射被拒，新映射、未同步的新文件、runtime 契约三条均通过 |
| 镜像区增量回填 | 无需处置（已核实） | 导出预检报的 `TYPE_MATRIX`/`TYPE_VECTOR` 是 CipherCat 本批**主动删除**的旧导出（`block-types.ts` 改为用 int_list 形状 + 契约表达域类型），不是 metacrypt 私自新增；下次同步删掉它们正是预期结果。该预检分不清「上游删了」与「下游加了」，命中这类导出要回权威源比 diff 再判定 |
| ProjectStore 去分叉 | 已完成 | 权威版已覆盖 metacrypt 副本，逐字节一致；`httpProjectStore.ts` 未改动 |
| 瘦壳（CipherCat 侧） | 已完成 | `App.vue` 487 → 376 行，编排移入 `src/components/editor/` 的 `useEditorFileActions` / `useEditorPanels` / `useEditorWorkspaceActions`，壳只留绑定；新增 13 条单测锁住「切换文件前必须先回写」的顺序；真浏览器验过导入 6 块 → 新增空文件 → 切回仍是 6 块 → 删除 → 拒删最后一文件 → 刷新后仍在 |
| 瘦壳（metacrypt 侧） | 未执行 | 与切引用同批，等其工作树清理 |

壳里有两处必须手动补一次派生状态刷新，原因同一个：Blockly 的载入路径把 `clear()` 与 `load()` 包在 `Blockly.Events.disable()` 里，**不会触发 change 事件**。所以导入工作区与切换文件之后，底部积木数不会自己更新；这两处分别由 `afterWorkspaceReplaced`（导入，同时置脏）与 `afterWorkspaceSwitch`（切换，只刷新不置脏）补上。分工刻意不同——单纯切换文件不是编辑，不该把项目标成未保存。

切引用时要一并处理的两件事：metacrypt 的 `utils/run-code.ts` 仍在且被 `useEditorCodeRunner` 引用，切换后应删除以免双份实现；JS 从 Blob worker 换成同源 module worker 属于行为变更，必须真浏览器复验后再加 CSP。

处置这批未提交改动前先分两类：镜像区（`core` + `components`）的改动按权威源规则处理——属于 metacrypt 专属逻辑的移到非镜像层，属于 CipherCat 已修好之处的反向补齐回 CipherCat，确认无用的丢弃；`views/editor/` 这类 metacrypt 本地重构（`views/EditorView.vue` 净减 1983 行 + 12 个新文件）与切引用无耦合，可独立提交。同步脚本已内置 fail-closed 预检：四个写入根任一有未提交改动就直接 exit 1，只有显式加 `--overwrite-local` 才会覆盖。
