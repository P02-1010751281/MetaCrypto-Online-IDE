# 侧栏面板 chrome 统一：字体 / 多余返回按钮 / ＋样式 / 函数面板

日期：2026-11-16
关联：`../2026-11-16-editor-header/`（同一轮界面对齐的上一段）

## 问题（owner 报的四条）

1. 「Projects 和 Files 的字体」不一致；
2. Files 的头部多了一个返回按钮；
3. Projects 的 ＋ 按钮样式异常、与 Files 不统一；
4. Functions 面板没有头，初始宽度也不够。

四条都先在真浏览器里量了计算样式再动手，改前实测：

| 观测点 | 改前 |
|---|---|
| Projects 标题 | 11px / **600** / 0.06em / 大写 / `rgba(0,0,0,.6)` |
| Files 标题 | 11px / **400** / 其余相同 |
| Files 头部子元素 | `[button ←][span FILES][button ＋]` |
| Projects 的 ＋ | **13×19**、背景 `rgb(233,233,237)`（浏览器默认按钮）、圆角 **0**、字号 13.33px |
| Files 的 ＋ | 24×24、透明底、圆角 4px、字号 14px |
| Functions 面板 | `.section-head` **不存在**、侧栏 248px、列表行宽 **191px**（31 行） |

## 根因

不是四件事，是一个结构问题：**`editor-sidebar.css` 是 `<style scoped>`，而面板是 slot 子组件**。
scoped 样式的作用域只覆盖本组件模板，跨不过 slot 边界——`EditorSidebar` 里的
`.section-head` / `.section-title` / `.ghost-btn` 到不了 `ProjectPanel` / `CryptoFunctionPanel`。

于是每个面板各自处理：`ProjectPanel` 抄了一份头部样式，抄的时候把字重写成 600 并**漏掉了
`.ghost-btn`**（它的 ＋ 因此退回浏览器默认按钮）；`CryptoFunctionPanel` 干脆只在自己的浮层
形态里画头（`v-if="!docked"`），停靠进左栏就没有头了。

## 改动

| 文件 | 动作 |
|---|---|
| `src/styles/panel-chrome.css` | **新增（全局）**：面板头 / 标题 / 提示 / 图标按钮的唯一一份定义，标题统一 11px **600** |
| `src/styles/index.css` | 挂载上面这份全局样式 |
| `src/components/editor/editor-sidebar.css` | 删掉已迁出的那份；只留窄屏（≤1200px）覆盖（标题隐藏、头部改 auto 高） |
| `src/components/editor/ProjectPanel.vue` | 删掉自己抄的头部样式，改吃全局（字重漂移与漏样式随之消失） |
| `src/components/editor/EditorSidebar.vue` | Files 头部去掉 `←` 返回按钮 |
| `src/App.vue` | 去掉 `@back` 接线与 `goBack()`；函数面板并入「按内容展宽」列表（400px） |
| `src/components/CryptoFunctionPanel.vue` | 停靠态补 `.section-head` 标题（`v-else`），横向内边距与 `.cfp-cat-header` 的 14px 对齐 |
| `src/components/ai-helper/DocSearchPanel.vue` | 头部并入 `.section-head`（第二段提交）：删 `dsp-header/dsp-title/dsp-actions/dsp-close`，「包含 PDF」从头部下沉到查询行 |
| `src/components/ai-helper/BlockSearchPanel.vue` | 同上：删 `bsp-header/bsp-title/bsp-close` |

为什么不把返回按钮改成别的位置：`goBack()` 原来的语义就是「切到项目面板」，而项目面板是
活动条第一格、恒可达，这颗 ← 是冗余入口；留着还会把 Files 的标题推离左边缘，正是第 2 条
观察到的错位。

## 查文档 / 查块的并入（第二段提交）

这两个面板是同一个问题的第二、三份抄本：`dsp-header` / `bsp-header` 各自写了一遍
`height: var(--panel-head-h)` + `0 var(--panel-pad-x)` + 底边线，结构已经同构，只有标题排版
没对齐（它们的 `.dsp-title` / `.bsp-title` 只写了 `font-weight: 600`，缺 11px 字号、0.06em
字距、大写与次级色，所以在同一列里比 Projects / Files 大一号）。

并入时先定了一条头部约定，写进 `panel-chrome.css` 的注释里：

> 头部只放「一个标题 + 一个动作组」；动作组里只放 24×24 图标按钮（`.ghost-btn`）；
> 带文字的条件类控件属于查询条件，放进面板体，不占头部。

按这条约定，「包含 PDF」是检索范围而不是面板动作，从头部移到查询行（与输入框同行右端），
跨查块面板已有的「筛选折叠在 body」是同一条规则。关闭按钮从 `font-size: 18px` 的无名按钮
改成 24×24 透明底的 `.ghost-btn`，并补上 `title`（原来只有 `aria-label`）。

新增两个样式件：`.section-head--divided`（检索面板直接坐在栏顶，没有 `.files-section` 那样
的外层留白，内边距与底边线得由头部自己给）与 `.section-actions`（动作组容器）。

## 验收

脚本：`scripts/verify-sidebar-chrome.mjs`（无头 Firefox + WebDriver BiDi，自起停）。
证据：本目录 `evidence/`（projects / files / functions / docSearch / blockSearch 五张）。

改后实测：

| 断言 | 结果 |
|---|---|
| 五个面板都有 `.section-head`，高度 38px（与面包屑同基线） | 通过 |
| 五个面板标题计算样式**逐项相同**（11px / 600 / 0.06em / 大写 / 次级色） | 通过 |
| 五个面板头部都取 `.section-head`，`dsp-header` / `bsp-header` 副本已不存在 | 通过 |
| Files 头部首元素是标题、只有 1 个按钮（无返回按钮） | 通过 |
| Projects 与 Files 的 ＋ 盒模型与背景一致，24×24 透明底圆角 4px | 通过 |
| Functions 有标题文本（`FUNCTION MANAGER`） | 通过 |
| Functions 侧栏 400px、列表行宽 343px（原 191px） | 通过 |
| Projects / Files 侧栏保持 248px | 通过 |
| 查文档 / 查块：头部只有 1 个按钮，24×24 透明底、有可访问名称 | 通过 |
| 查文档 / 查块：头部自带内边距与底边线（`--divided` 变体） | 通过 |
| 查文档：头部不含 checkbox，「包含 PDF」落在查询行、查询行仍是一行 | 通过 |
| 查文档 / 查块：侧栏展宽到 400px | 通过 |
| 查块的关闭按钮点了真的关掉面板（换类名没断线） | 通过 |

`SUMMARY total=30 pass=30 fail=0`。

## 残留

- 侧栏宽度仍是「按面板类型自动设宽」的启发式（`App.vue` 的 watch），不是按内容测量；
  用户手动拖过之后不再自动改（既有行为）；
- 面板头的「动作组」目前只用到关闭一种；若以后要加第二个动作（如刷新、全屏），
  按 `.section-actions` 的约定加 24×24 图标按钮即可，不需要再动布局。
