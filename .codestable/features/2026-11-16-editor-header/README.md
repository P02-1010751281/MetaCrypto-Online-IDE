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

`lint:check` 0 error / 0 warning（未改规则、无 disable）· `type-check` · `test:unit` 86 文件 1004 通过 1 跳过 · `build` · `build:check-bundle` entry=41431 ≤ 65536 · `cycles:check` 0 违规 · `verify:all` 模板 29/29、demo 60/60。

## 残留

- 图标集未抽（见上）；
- 窄屏（≤1200px）下代码栏在底部，面板开关的图标仍按「右栏」语义画，未做朝向翻转；
- `useCodeRunner` 无 `onUnmounted`：收起不再丢状态，但若在运行中卸载组件（如切路由），worker 仍靠自身超时收尾——属既有问题，本次未动。
