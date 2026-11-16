# 编辑器顶栏改版：动作组上移 + 收起不销毁 + 组件提取

日期：2026-11-16
关联：`../2026-11-16-toolbar-layout-review/`（原始只读评审与三席强模型裁定）

## 问题

编辑器顶栏右半部分把三类东西塞进两条分隔线划出的两段：

```
[Save] [Auto Save] Saved 10:55   ┃ 中文 | <> ┃ Docs | More
                                 ↑全局偏好↑视图开关  ↑跳转 ↑工作区动作
```

三席独立评审（Claude Opus 5.5 / GPT-6.1 Sol / GLM-5.3）一致裁定：

1. 「`<>` 是冗余第二入口」是**误报**——`App.vue` 用 `v-if` 卸载 `CodePanel`，面板头部的 `»` 随之消失，工具栏这颗是**唯一**恢复入口；
2. 真问题是三类语义混排、`.active` 主色边框让常开视图开关比真正的主动作更抢眼、语言按钮缺可访问名称；
3. 语言不该塞进「更多」菜单（该菜单自身有 `<select>` 嵌 `<button>`、无 `aria-expanded`、Esc 关不掉三个缺陷）；
4. 更前置的问题是 **收起 = 卸载**：`useCodeRunner()` 的 `output`/`hasRun` 是组件局部 ref，收起代码栏会把刚跑出来的输出一起丢掉。

## 改动

| 文件 | 动作 | 行数 |
|---|---|---|
| `src/components/editor/EditorHeaderActions.vue` | 新增：顶栏动作组（语言 / 文档 / 更多 / 面板开关） | 137 |
| `src/components/editor/LocaleToggleButton.vue` | 新增：**共用**语言按钮（编辑器顶栏 + 文档中心） | 36 |
| `src/components/editor/WorkspaceMenu.vue` | 新增：从动作组里再拆出的「更多」下拉（含格式选择、Esc 与焦点归还） | 321 |
| `src/components/editor/editor-toolbar-button.css` | 新增：**共用**描边按钮外观，三个组件以 `<style scoped src>` 引入 | 29 |
| `src/components/editor/EditorToolbar.vue` | 只留文档动作（保存 / 自动保存 / 保存状态） | 483 → 127 |
| `src/App.vue` | 新增 `.editor-head` 包住面包屑 + 动作组；`CodePanel` 由 `v-if` 改 `v-show` | 440 → 465 |
| `src/components/editor/CodePanel.vue` | 删掉与共用样式重复的 `.toolbar-btn` 基础规则 | 370 → 345 |
| `src/views/DocsView.vue` | 语言按钮改用共用组件 | 369 → 368 |
| `src/composables/locale/ui-messages.ts` | 新增 `switchLanguageTo` / `exportFormatLabel` / `importFormatLabel` | +6 |
| `src/runtime/run-code.ts` | 两个运行器接受可选 `AbortSignal`，取消走与超时相同的收尾路径 | 257 → 278 |
| `src/composables/useCodeRunner.ts` | 作用域结束时取消当次运行，并挡住迟到输出写回已释放状态 | 147 → 174 |
| `tests/unit/run-code-cancel.test.ts` | 新增：取消后 Promise 必须 settle、Python 的 busy 必须复位 | 87 |
| `tests/unit/use-code-runner-cancel.test.ts` | 新增：作用域结束后交出取消信号、卸载后迟到输出被丢弃 | 96 |

布局结果（与左侧 `FILES` 头、右侧代码栏头同一条 38px 基线）：

```
Untitled / main.block.json Entry          [中文] │ [Docs] [More] │ [面板]
─────────────────────────────────────────────────────────────────────
[Save] [Auto Save] Saved 10:55
```

## 组件提取：抽了什么、为什么不抽更多

**抽了（两个真共用 + 一个过大的拆分）**

- `LocaleToggleButton`：编辑器与文档中心两处原本各写一遍「目标语言判断 + 文案」，现在只此一处，`lang`、`aria-label`、标题随之统一；
- `editor-toolbar-button.css`：`.toolbar-btn` 基础外观原在两个组件里逐字节重复，改为 scoped `src` 引入，不引入全局类；
- `WorkspaceMenu`：`EditorHeaderActions` 一度 427 行（大量内联 SVG），把下拉整块拆出后降到 137 行，菜单的开合/键盘/格式行为也各自归位。

**没抽（记账）**

- 内联 `<svg>` 图标共 17 枚分布在 4 个文件，其中 `<>` 一枚被「函数」「生成」「面板开关」三处复用。抽成 `AppIcon` 是值得的下一步，但它要逐枚目检字形与视觉重量，混在本次版式改动里回滚成本高，留作独立改动；
- `EditorToolbar` 与 `CodePanel` 的 `.toolbar-select` 等控件样式仍有小重复，未动。

## 收起 / 卸载时的运行器生命周期

三席原始建议是「给 `useCodeRunner` 加 `onUnmounted` 调 `terminate()`」。回代码核对后**否掉**这个写法：

- `pythonWorker` 是 `run-code.ts` 里的**模块级单例**，复用的是已装载的 Pyodide 运行时；卸载就 terminate，等于每次切路由都扔掉约 10MB 运行时，下次重下——那是回归，不是修复；
- 野杀 worker **不会**让 `run()` 的 Promise settle（`terminate()` 不触发任何事件），`finish()` 里的 `pythonBusy = false` 于是永远不执行 → 运行器**永久卡在 busy**，比原缺陷更严重；
- 真正的可观测缺陷是：**离开编辑器时 busy 不复位**，用户很快返回再点「运行」会拿到 `busy`，最长要等运行超时（10s）或装载超时（45s）。

因此做成**取消通道**而不是卸载即杀：两个运行器接受可选 `AbortSignal`，取消走与超时完全相同的 `finish` 路径（终止线程、复位 busy、resolve）。JS 侧每次运行本来就是一个独立 worker，终止无副作用；Python 侧终止后把单例置空，下次靠浏览器 HTTP 缓存重新装载。

接线在 `useCodeRunner`：`onScopeDispose` 里 `abort()`，并用 `disposed` 守卫挡住迟到的输出写回一个已经没人看的状态。`contracts/run-chain.ts`（与 metacrypt 逐字节一致）**未改**，取消语义只在宿主实现里，不动契约。

## 提交拆分

| 提交 | 性质 | 内容 |
|---|---|---|
| `3199731` | 等价重构 | 拆出 `EditorHeaderActions` / `WorkspaceMenu` / `LocaleToggleButton` / 共用 CSS；按钮位置、`v-if`、菜单行为一律不动 |
| `7655812` | 行为变化 | 动作组上移顶栏、`v-if`→`v-show`、a11y、激活态拆类、菜单三病 |
| 本提交 | 行为变化 | 收起 / 卸载时的运行器取消通道 |

顺序说明：原计划「先版式、再提取」做不出来——版式要求按钮搬到顶栏，而承载它们的组件必须先存在；`App.vue` 已 465 行，内联进顶栏会破 500 行死线（`e22`）。所以等价重构在前、行为变化在后，两个提交的对照关系不变。

## 验收

脚本：`scripts/verify-editor-header.mjs`（无头 Firefox + WebDriver BiDi，自起停、不抢桌面焦点）。
证据：本目录 `evidence/`。

| 断言 | 结果 |
|---|---|
| 1366 / 1024 / 900 / 760 四档：动作组 4 颗按钮**单行不换行**，顶栏 38px 与工具栏 38px 对齐 | 通过 |
| 语言按钮 `title`/`aria-label` 说明「切换到 …」、`lang` 随标签文字切换（`zh-CN`↔`en`） | 通过 |
| 面板开关 `aria-pressed` 随状态、标题在「收起/展开代码栏」间切换 | 通过 |
| 展开菜单：`aria-expanded=true`、2 个格式行、`select` **不在** `button` 内 | 通过 |
| Esc 关闭菜单并把焦点还给「更多」按钮 | 通过 |
| 收起代码栏：面板 `display:none` 但**节点未卸载**（打标记仍在），再展开标记仍在 → 运行输出不再丢 | 通过 |
| `/docs` 页语言按钮继承 `.header-btn` 外观（1px 边框、6px 圆角、32px 高） | 通过 |

## 门禁

`lint:check` 0 error / 0 warning（未改规则、无 disable）· `type-check` · `test:unit` 88 文件 1010 通过 1 跳过（新增 6 条取消语义断言） · `build` · `build:check-bundle` entry=41431 ≤ 65536 · `cycles:check` 0 违规 · `verify:all` 模板 29/29、demo 60/60。

## 残留

- 图标集未抽（见上）；
- 窄屏（≤1200px）下代码栏在底部，面板开关的图标仍按「右栏」语义画，未做朝向翻转；
- 取消通道只做了「离开即取消」；没有做「暂停/续跑」，也没有给运行中的输出加保留缓冲。
