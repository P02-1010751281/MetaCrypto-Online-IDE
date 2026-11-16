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

## 行内动作：改名 / 删除 / 设为入口（第三段）

面板头统一之后，行内操作仍是同一类问题的第二处：`.row-btn` 又有两份副本，且已经漂开。

| 观测点（真浏览器量） | 文件面板 | 项目面板（改前） |
|---|---|---|
| 静止颜色 | 次级色 `rgba(0,0,0,0.6)` | 正文色 `rgba(0,0,0,0.87)` |
| 浮出机制 | 容器绝对定位，`opacity 0→1` | 按钮自身 `opacity 0→0.7` |
| 隐藏时能否点 | `pointer-events: none` | **`pointer-events: auto`（看不见但点得到）** |
| 占位 | 绝对定位，不挤压文件名 | 在流内，恒定占 20px |
| 行内动作 | ◎ 设为入口 / ✎ 改名 / ✕ 删除 | 只有 ✕ |
| 项目名可用宽度 | — | 145px（改后 **171px**） |

第三列那条不是样式瑕疵而是隐患：项目行右端那颗**看不见的 ✕ 仍可点中**，误点会弹删除确认。

改法同头部：`.panel-row`（行容器标记）+ `.row-actions`（动作层）+ `.row-btn` 收进
`panel-chrome.css`，两面板共用；统一到安全的那一套语义——绝对定位浮出、`opacity` 与
`pointer-events` 同时关（只关透明度不够），`:focus-within` 保证键盘可达。

行底色继续由各面板自己决定（文件用的是主色 12%/18% 混合，项目用 `--color-bg-active`），
但都必须写进 `--row-bg`：动作层要盖在行上，底色没解析就等于文件名透出来。实测悬浮态
解析为 `rgb(240,241,242)` / `rgb(230,240,251)`，不是透明。

顺带删掉 `.icon-btn`：它是个全仓已无使用者的别名，留着只会成为下一份抄本的起点。

## 函数面板浮层头部：第五种头（第四段）

前一段统一的都是面板**停靠态**。窄屏（≤1200px）把面板切成浮层，函数面板在浮层里用的是
另写的 `.cfp-header`——同一个面板在两种形态下是两套头，且与另外四个面板都对不上
（真浏览器 1024×700 实测）：

| 观测点 | 函数面板浮层（改前） | 其余四个面板 |
|---|---|---|
| 头部高度 | **48px** | 38px |
| 标题 | `14px` / 600 / **不改大写** / 字距 normal / 正文色 | 11px / 600 / 大写 / 0.66px / 次级色 |
| 关闭按钮 | `✕` **25×27**、font 16px、**无 title 也无 aria-label** | 24×24 `.ghost-btn`，有可访问名称 |
| 横向内边距 | 10px / 14px | 0 / 8（`--divided` 取 `--panel-pad-x`） |

改法：停靠与浮层共用同一个 `.section-head`，浮层多一个 `--divided`。横向内边距仍要 14px
（对话框里的 `.cfp-actions` 是 14px、`.cfp-item` 是 12px），用双类规则
`.section-head.cfp-head { padding: 0 14px }` 覆盖 `--divided` 的 8px，而不是再复制一份头部。

有一处副作用是有意的：停靠态也拿到了同一个 ×（原来停靠态没有关闭按钮）。查文档 / 查块
的停靠态本来就有 ×，三者的 × 都发 `close`，父组件 `closePanel` 切回默认面板。

**为什么之前 49 条断言没抓到**：窄屏那一段只验了查文档浮层这一例。要证明「统一」，
窄屏必须五个面板都量一遍——补上之后，五面板窄屏断言共 9 条。



## 改名链路：项目靠面包屑、文件靠行内 ✎（第五段，已被第六段取代）

> 这一段记录的是当时的现状与验证方法；入口本身在第六段改掉了（项目改名移到面板行内 ✎，
> 面包屑改成只读）。下面「落库时机」与「面板行内没有 ✎」两处描述已是历史，读现状请看第六段。

owner 问「Projects 的改名呢？」，所以这一段把两条改名链路在真浏览器里跑通并固化成断言：

| 对象 | 入口 | 落库时机 | 真浏览器实测 |
|---|---|---|---|
| 项目 | 顶栏面包屑输入框（`.crumb-project-input`） | **点保存**（自动保存默认关闭） | 改名 + 保存后 IndexedDB 该记录 name 更新、`updatedAt` 前移、记录数不变；真刷新后仍在 |
| 项目 | 面板行内**没有** ✎（改名不走面板） | — | 行内只有 ✕（删除），与文件面板不同 |
| 文件 | 文件行悬浮 / 聚焦后 ✎ → 内联输入 → Enter | 同样要点保存 | 改名 + 保存后 `files[].name` 更新；真刷新后仍在 |

两个细节值得记住：

- **自动保存默认关闭**（`autoSaveEnabled = ref(false)`），所以「改完名直接关页面」不会保存，
  状态栏会显示 `· Unsaved`。这是既有设计，不是这次改动引入的。
- 保存后**面板列表会跟着更新**（保存层调 `useProjectList` 的刷新），不需要重开面板；
  改名前列表里仍是旧名字——列表展示的是已保存状态，不是输入框里的草稿。

### 顺带修掉的深链缺陷（我的新断言把它打出来了）

给门禁加「改名 + 保存后 IndexedDB 里只有一个项目」这条时，它第一次跑就是红的：

```
dbBefore:        [{ id: 1, name: 'Untitled', files: [] }]
dbAfterProject:  [{ id: 1, name: 'Untitled' }, { id: 2, name: '改名验收-项目' }]
```

复现条件是「路由停在 `/editor/1`、但编辑器里 `projectId` 还是 null」——典型场景是全页
加载时深链指向一个本地不存在的项目（新浏览器打开别人发来的 `/editor/1` 链接）。此时：

1. `loadProject` 找不到记录，走 catch，`projectId` 保持 null，状态栏显示 **`Save failed`**；
2. 用户点「＋ 新建项目」，自动增量拿到的 id 恰好是 1；
3. `router.push('/editor/1')` 与当前路由相同，被判成重复导航 → 参数没变化 → 那个
   `watch(route.params.id)` 不触发 → `projectId` 仍是 null；
4. 下一次保存按「新项目」处理，于是同一个项目在库里出现两份。

修法不是补丁式地改 push，而是在 `router.afterEach` 里做一次状态对账：路由落在 Editor 上、
而 `projectId` 与路由 id 不一致时兜底加载一次；相等时什么都不做，所以正常导航零开销。

```ts
const targetId = to.name === 'Editor' ? Number(to.params.id) : 0;
if (targetId && workspaceReady && !loadingProject && targetId !== projectId.value) {
  void loadProject(to.params.id);
}
```

变异验证：把这三行注释掉重跑，红的正是这两条（记录数 1→2、两个文件行都没有入口标记），
其余断言仍绿——说明它们咬的是这个缺陷。

**当时已知未改**：加载失败时状态栏写的是 `Save failed`（复用 `updateSaveStatus('error')`），
而实际失败的是**加载**。第六段已引入独立状态 `load-error` 修掉这一条。

## 改名入口收口到面板行内 ✎（第六段）

owner 在三选一里选了第三项：**项目行补 ✎、面包屑改只读**。改前同一个名字有两处可改，
而且语义相反——面包屑改完要按保存，面板（文件那侧）改名是直接写库。

| 事项 | 改前 | 改后 |
|---|---|---|
| 项目改名入口 | 面包屑输入框 `.crumb-project-input` | 项目行 ✎ → 内联输入框 |
| 落库时机 | 点「保存」（自动保存默认关闭） | 提交即写库（`projectStore.rename`） |
| 面包屑项目名 | 可编辑 `input` | 只读 `.crumb-project` 文本（超长截断 + `title` 全名） |
| 行内改名输入框样式 | `.rename-input` 在 `editor-sidebar.css`（只覆盖文件面板） | 移进全局 `panel-chrome.css`，两面板共用 |

一个必须一起做的联动：面板改名写库之后，编辑器手里的 `projectName` 还是旧值，
下一次保存会拿旧名字把刚写好的覆盖回去。所以 `App.vue` 收到 `renamed` 事件时，对当前项目调
`applyExternalRename(name)`——换名字 **并且** 把「已保存的名字版本」对齐，全程不标脏
（库里已经是新名字，不该再显示未保存）。两件事缺一不可：只换名字不对齐 → 下次保存覆盖；
只对齐不换名字 → 面包屑停在旧名。

### 加载失败不再冒充保存失败（同段）

`saveStatus` 从三值扩到四值：`saved / unsaved / error / load-error`。类型 `EditorStatus`
由 `useEditorProject` 导出，`EditorToolbar` 直接用它，不再各自写一份字面量联合。加载不到项目
报「加载失败 / Load failed」，保存失败仍是「保存失败 / Save failed」。

### 变异验证（每条新断言都证明会开火）

- 把 `App.vue` 里 `applyExternalRename(name)` 调用换成空操作 → 恰好 2 条红，且**库里名字真的被
  写回旧值**（`改名验收-项目` → `Untitled`）、面包屑与列表行停在旧名；其余 63 条仍绿。
- 把 `loadProject` 的 `'load-error'` 换回 `'error'` → 恰好 1 条红（状态栏报 `Save failed`）。

## 右栏：多了一个「收起」按钮 + 第二行差 11px（第七段）

owner 报「右侧栏是不是多了一个 hidepanel 按钮，行高是不是没对齐」。两件都是真的，量出来是：

| 观测点（真浏览器 1366×800，改前） | 实测 |
|---|---|
| 同一动作的开关数 | **2**：顶栏动作组的面板图标（`Hide code pane`）+ 代码栏栏头的 `»`（同 aria-label） |
| `»` 的来历 | `9d0ab43` 侧栏改 activity bar 时加的，与顶栏那颗都发 `toggleCodePane` |
| 右栏工具行高度 | **49px**（8px 内边距 + 32px 按钮） |
| 左栏保存行高度 | **38px** → 两栏第二行错开 **11px** |
| 栏头里 `Python` 的位置 | 语言标签与 `»` **都**写了 `margin-left: auto`，自由空间被劈成两半（各 105.5px），标签浮在中间偏左 |
| 栏头 / 面包屑 / 面板头高度 | 38 / 38 / 38（这一项本来是对的） |

改法三条，都是收口不是新增：

1. **删掉栏头那颗 `»`**（连 `emit('collapse')`、`.code-head-collapse` 两条规则、`App.vue` 的
   `@collapse` 一起删）。隐藏动作只留顶栏一处——理由不只是「重复」，而是**收起后栏头随面板一起
   消失**，栏头里那颗按钮等于「点完就再也找不到再打开的地方」，必须回顶栏。
2. **语言标签独占 `margin-left: auto`**，`Python` 贴回栏头右边缘（改后右边缘 1356 = 1366 − 10）。
3. **右栏工具行对齐到 38px**：`min-height: var(--editor-bar-h); padding: 2px 12px`（与左栏保存行
   同一套算法：2px 内边距 + 32px 按钮）。按钮本身仍是 32px，不靠压按钮凑高度。

### 变异验证

把 `»` 与 8px 内边距同时加回去重跑：**恰好 3 条红**——按钮数（1 而非 0）、语言标签贴右
（`lang.r 1270` 对 `head.r - padR 1356`）、右栏工具行等高（49 对 38）；其余 68 条仍绿。
恢复后 71/71。

## 验收

脚本：`scripts/verify-sidebar-chrome.mjs`（无头 Firefox + WebDriver BiDi，自起停）。
证据：本目录 `evidence/`（projects / files / functions / docSearch / blockSearch / docSearch-overlay / functions-overlay / row-actions-projects / row-actions-files 九张）。

改后实测：

| 断言 | 结果 |
|---|---|
| 五个面板都有 `.section-head`，高度 38px（与面包屑同基线） | 通过 |
| 五个面板标题计算样式**逐项相同**（11px / 600 / 0.06em / 大写 / 次级色） | 通过 |
| 五个面板头部都取 `.section-head`，`dsp-header` / `bsp-header` 副本已不存在 | 通过 |
| 五个面板标题都**贴左**（左边缘 = 头部左边缘 + 头部内边距） | 通过 |
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
| 行内动作层（两面板）是绝对定位，隐藏时 `opacity 0` 且 `pointer-events none` | 通过 |
| 行内动作层悬浮后浮出且可点，并盖在行文字上（不再挤压名称列） | 通过 |
| 两个面板的行内按钮外观一致（次级色 / 20×20 / 11px） | 通过 |
| 文件面板行内是 ◎ / ✎ / ✕；项目面板行内是 ✎ / ✕（改名入口唯一） | 通过 |
| 键盘聚焦到 ✎ 时动作层浮出（不只在悬浮时可用） | 通过 |
| ✎ 打开内联改名输入框且自动聚焦，Esc 取消后输入框消失 | 通过 |
| 窄屏：五个面板各自只有一个头部，且都取 `.section-head`（`cfp-header` 已不存在） | 通过 |
| 窄屏：四个浮层/弹出面板头部 38px；横条里的文件面板头收成 24px 不撑高横条 | 通过 |
| 窄屏：五个标题字体与停靠态逐项一致；四个可见标题贴左（文件面板按设计隐藏标题） | 通过 |
| 窄屏：五个头部各 1 个 24×24 图标按钮且都有可访问名称 | 通过 |
| 窄屏：函数面板浮层的 ✕ 点了真的关掉面板（换类名没断线） | 通过 |
| 项目行 ✎ 改名**直接**写进 IndexedDB（不点保存），且**不会多出第二个项目** | 通过 |
| 项目改名后再点保存，名字不会被编辑器里的旧值覆盖回去 | 通过 |
| 项目改名后列表行名与面包屑都跟着更新（不用重开面板、不用刷新） | 通过 |
| 面包屑的项目名是只读文本（`.crumb-project-input` 已不存在） | 通过 |
| 加载不存在的项目时状态栏报「加载失败」而不是「保存失败」 | 通过 |
| 代码栏栏头与左栏面包屑等高、同顶（38px） | 通过 |
| 代码栏栏头里没有第二个「收起」按钮（隐藏动作只在顶栏一处） | 通过 |
| 顶栏：代码栏开关恰好 1 个且带可访问名称 | 通过 |
| 代码栏栏头：语言标签贴右（右边缘 = 栏头右边缘 - 内边距） | 通过 |
| 右栏工具行与左栏保存行等高、同顶（38px），按钮仍是 32px | 通过 |
| 文件 ✎ 改名 + 保存写进 IndexedDB（`files[].name`） | 通过 |
| 文件行：非入口行是 ◎ / ✎ / ✕；入口行按设计不显示 ◎ | 通过 |

`SUMMARY total=71 pass=71 fail=0`。

## 回归：函数面板标题曾靠右（已修）

owner 报「Function Manager 怎么靠右了」，根因是全局层那条把动作按钮顶到最右的规则：

```css
.section-head > :last-child { margin-left: auto; }   /* 旧写法 */
```

函数面板停靠态的头部**只有一个子元素**（标题），它既是首元素也是尾元素，于是被这条规则
整条推到栏右边缘（实测头部左边缘 44 + 内边距 14 = 58，标题却在 263，右移 205px）。

修法是排除单子元素的情况：`.section-head > :last-child:not(:first-child)`。

**为什么上一轮 34 条断言没抓到**：断言只量了字体（`font-size` / `font-weight` / 字距 /
大写 / 颜色）与头部高度，没有量位置。尺寸对、样式对、位置可以完全错。已补一条位置断言
（标题左边缘 = 头部左边缘 + 头部内边距），并用变异验证证明它会开火：把规则改回旧写法，
只有函数面板这一项变红（`titleLeft 263 vs 期望 58`），其余四个面板仍绿——说明这条断言
咬的就是这个缺陷，不是恒真。

## 残留

- 两个面板的**行底色仍不同**（文件用主色 12%/18% 混合，项目用 `--color-bg-active`）：
  颜色表达的是各面板自己的状态语义，不属于本次统一的 chrome；动作层只约定「底色必须写进
  `--row-bg`」，不规定取什么颜色。


- 侧栏宽度仍是「按面板类型自动设宽」的启发式（`App.vue` 的 watch），不是按内容测量；
  用户手动拖过之后不再自动改（既有行为）；
- 面板头的「动作组」目前只用到关闭一种；若以后要加第二个动作（如刷新、全屏），
  按 `.section-actions` 的约定加 24×24 图标按钮即可，不需要再动布局。
