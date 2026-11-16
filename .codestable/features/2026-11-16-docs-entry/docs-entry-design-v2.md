# 文档中心第二入口 设计稿 v2（草案）

- 日期：2026-11-16
- 状态：**草案 v2** — 依第 1 轮 A/B 对抗审查重写；v1 的 md5 为 `18335d59b3a288759276cda5b216cbf3`
- 范围：编辑器「查文档」面板 + 文档中心（筛选空态与返回行为）

## 0. 第 1 轮审查处置（谁说什么、我复现后怎么定）

| 编号 | 第 1 轮指出 | 我的复现 | 本稿处置 |
|---|---|---|---|
| B1 | v1 称「工具栏 `@open-docs` 传进来的是 MouseEvent」是编造 | **成立**：`EditorToolbar.vue#L69` 是 `@click="$emit('open-docs')"`，`#L218` 是 `'open-docs': [];`，零参数 | 理由改为「工具栏零参、面板传 string」，守卫保留作防御 |
| B2 | 全文查询词预填进「标题/分类名过滤」的搜索框，可能筛出空侧栏 | **部分成立**（B 席纠正 A 的「几乎必为空」）：过滤见 `DocsView.vue#L94-L105`（分类名或标题 `includes`），确实不含正文；但 `ML-KEM` 会命中分类名（`docs-catalog.ts#L42` = `'FIPS 203 — ML-KEM 密钥封装'`） | 保留 `?q=`，但**补空结果逃生**（§4.2），验收改用「只出现在正文里的词」 |
| B3 | v1 门禁弱于 `RULES.md` R-TEST-01 | **成立**：`RULES.md#L74-L86` 逐字列出九条 | §6 照抄九条，不再自拟 |
| M1 | v1「侧栏 248px 会挤」为假 | **成立**：`App.vue#L205-L208` 在 `docSearch` 时 `setLeftWidth(400)`；窄屏浮层 `DocSearchPanel.vue#L201` 是 `min(760px, 94vw)` | 理由重写 |
| M2 | v1「放 hint 区会被顶到列表顶」机制错 | **成立**：`DocSearchPanel.vue#L29-L36` 是 `v-if/v-else-if/v-else` 链，有结果时 hint **不渲染** | 理由改为「放 hint 区会随状态消失，违反 G1」 |
| M3 | F8 锚点只证明首屏 `back: null` | **成立**：真实写入点是 `vue-router.js#L145` 的 `buildState(currentLocation.value, to, null)`；首屏状态见 `#L104-L110`（含 `replaced: true`） | 两个锚点都补 |
| M4 | F2 区间 `L338-L344` 漏掉闭括号 `L345` | **不成立（A 席假阳）**：实测 `L344` 是 `}`、`L345` 是 `</style>`，`338-344` 已完整 | 不改，记入审查层错率 |
| M5 | v1「刷新后无应用内历史」不准 | **成立**：`vue-router.js#L104` 是 `const historyState = { value: history.state }`，`#L105` 仅在**无 state** 时重建；刷新保留 state | 改为「新标签页/直接输入 URL」 |
| 新 | B 席漏报：`?q=` 被移除时不清旧值 | **成立**：v1 的 `applyQueryPrefill` 只有 `if (有 q)` 分支，同组件内从 `/docs?q=X` 走到 `/docs` 会残留过滤 | §4.2 的 watch 补 else 清空 |

数字方面同时更正：v1 的 `+31/−5` 是手算，A 席复算 `+33~35`，B 席判「排版不确定、不能给唯一精确值」。本稿只给区间。

## 1. 问题

| 编号 | 问题 | 证据 |
|---|---|---|
| P1 | 「查文档」面板搜不到时没有下一步：面板内没有通往文档中心（按分类浏览）的路径 | 面板全文无 `router`、无 `browse` 类事件 |
| P2 | 面板查询词无法带入文档中心 | 无 `?q=` 读取逻辑 |
| P3 | 文档中心「返回」恒回 `/`，经 `HomeView` 再跳「最近项目」，来源不确定，且闪一次启动页 | `DocsView.vue#L165-L167` |

## 2. 目标与非目标

**目标**：G1 面板底部恒可见的「浏览全部文档」；G2 带查询词进文档中心（**且不得筛出空侧栏**）；G3 返回来源页（无应用内历史时回 `/`）。

**非目标**：不改语料/索引/路由；不做文档中心搜索框 ↔ URL 双向同步；不改工具栏主入口与活动条；不抽公共浮层组件；不动 z-index。

## 3. 现状事实（v2，逐条已由本轮实跑确认）

| 编号 | 断言 | 锚点 |
|---|---|---|
| F1 | 结果列表 `</ul>` 在 L55，`.dsp-foot` 在 L57 | `DocSearchPanel.vue#L55`、`#L57` |
| F2 | `.dsp-foot` 规则完整占 L338-L344（L344 是 `}`，L345 是 `</style>`） | 同文件 `#L338-L344`、`#L345` |
| F3 | `defineEmits` 现只有 `close` / `open` | 同文件 `#L75-L79` |
| F4 | 结果区是 `v-if/v-else-if/v-else` 链，链尾 `ul` 在 L36 | 同文件 `#L29-L36` |
| F5 | 窄屏浮层宽 `min(760px, 94vw)` | 同文件 `#L201` |
| F6 | `openDocs()` 只做 `closeMenus()` + `push('/docs')`；工具栏 `open-docs` 零载荷 | `App.vue#L199-L202`、`EditorToolbar.vue#L69`、`#L218` |
| F7 | 查文档面板宽 400（`setLeftWidth(400)`），不是 248 | `App.vue#L205-L208` |
| F8 | `searchQuery` 是 `ref('')`，侧栏收 `filteredCategories` | `DocsView.vue#L85`、`#L27` |
| F9 | 侧栏过滤 = 分类名或标题 `includes(q)`，空分类被剔除 | `DocsView.vue#L94-L105` |
| F10 | 分类标签含算法名（例：`FIPS 203 — ML-KEM 密钥封装`） | `src/utils/docs-catalog.ts#L42` |
| F11 | `goBack()` 恒 `push('/')` | `DocsView.vue#L165-L167` |
| F12 | 首屏 `history.state` 写 `{ back: null, …, replaced: true }`；`push` 前用 `buildState(currentLocation.value, to, null)` 写入后继条目 | `vue-router.js#L104-L110`、`#L145` |
| F13 | `window` 在 ESLint globals（`readonly`），`no-explicit-any` 为 error | `eslint.config.js#L46` |
| F14 | 无覆盖 `DocSearchPanel`/`DocsView` 的单测 | `grep -rln … tests/` 命中 0 |
| F15 | 现状单测基线：**987 通过 / 1 跳过 / 85 文件**（本轮实跑 `npx vitest run`，exit 0） | 实跑输出 |
| F16 | `DocSearchPanel.vue` 现 345 行，已超过 R-FILE-01 的「超 300 行需审查拆分」线；RULES 无 500 硬上限（500 线来自项目记忆，是另一条权威） | `wc -l`、`RULES.md#L24-L25` |

## 4. 设计

### 4.1 面板底部入口（G1）

插在 `DocSearchPanel.vue#L55`（`</ul>`）之后、`#L57`（`.dsp-foot`）之前，包一层 `.dsp-footer`：

```html
<div class="dsp-footer">
  <button type="button" class="dsp-browse" @click="emit('browse-all', query.trim())">
    {{ ui('docSearchBrowseAll') }} →
  </button>
  <p class="dsp-foot">{{ ui('docSearchFoot') }}</p>
</div>
```

- **为什么必须在这一层**：L29-L36 是 `v-if/v-else-if/v-else` 链，放 hint 区（L29-L35）等于让入口随状态消失；L55 之后已在链外，任何状态都渲染，满足 G1。
- **为什么不放头部**：头部（L7-L13）已有标题 + 「含标准 PDF」 + `×`；且查文档面板宽 400px（F7），头部是操作区，退路属页脚。
- 样式：`.dsp-footer` 承接上边框，`.dsp-foot` 的 `border-top` 改为 `none`（避免双线）；`.dsp-browse` 为无边框文字按钮（`color: var(--color-primary)`、`padding: 6px 12px`、`text-align: left`、`font-size: 12px`、`background: none`、`cursor: pointer`）。

### 4.2 带查询词 + 空结果逃生（G2）

**面板**：`emit('browse-all', query.trim())`（空串 = 无查询词）。

**宿主**：

```ts
function openDocs(q?: unknown): void {
  closeMenus();
  // 工具栏入口是零参数（EditorToolbar 的 `'open-docs': []`），面板入口传 string；
  // 这里用类型判断覆盖两种调用，顺带防住未来把事件对象直接绑上来的写法。
  const keyword = typeof q === 'string' ? q.trim() : '';
  void router.push(keyword ? { path: '/docs', query: { q: keyword } } : '/docs');
}
```

**文档中心**：

```ts
function applyQueryPrefill(): void {
  const q = route.query.q;
  // 无 q 时也要清：同组件内从 /docs?q=X 走到 /docs 不清会残留旧过滤（第 1 轮 B 席漏报项）。
  searchQuery.value = typeof q === 'string' ? q : '';
}
onMounted(() => { rebuildCategories(); applyDeepLink(); applyQueryPrefill(); });
watch(() => route.query.q, applyQueryPrefill);
```

**空结果逃生（本稿新增，回应 B2）**：预填的语义是「标题/分类名过滤」，正文词必然筛空。因此 `DocsSidebar` 在 `categories.length === 0` 且 `searchQuery` 非空时，于搜索框下方渲染：

```html
<p class="sidebar-empty">
  {{ ui('docsFilterEmpty') }}
  <button type="button" class="link-btn" @click="emit('update:searchQuery', '')">{{ ui('docsFilterClear') }}</button>
</p>
```

这样「搜不到 → 浏览全部」的路径即使筛空也有一步可退出，而不是把用户丢在空白侧栏。深链 `doc`/`line` 优先于预填，两者不冲突。

### 4.3 返回来源（G3）

```ts
function goBack(): void {
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back) router.back();
  else void router.push('/');
}
```

**否决的替代**

| 方案 | 否决理由 |
|---|---|
| `window.history.length > 1` | 新标签页首屏 `length` 也可能 > 1，误判成「有应用内历史」 |
| 路由 meta 标记来源 | 每个入口都要改，漏一个即失效 |
| 一律 `router.back()` | 新标签页直接开 `#/docs` 时无历史，会退出应用 |

**已知风险**：`back` 是 vue-router 写入的字段（F12），不是公开 API；上游若改字段，退化表现是永远走 `push('/')`，即今天的行为。

## 5. 改动清单（区间估计）

| 文件 | 改动 | 估计 |
|---|---|---|
| `DocSearchPanel.vue` | `.dsp-footer` 包裹 + 按钮 + emit 签名 + 3 条 CSS | +16 ~ +19 / −1 |
| `App.vue` | `openDocs` 参数与守卫；`@browse-all` | +5 / −2 |
| `ui-messages.ts` | 中英 `docSearchBrowseAll`、`docsFilterEmpty`、`docsFilterClear`（3 对） | +6 |
| `DocsView.vue` | `applyQueryPrefill` + 挂载/watch；`goBack` 兜底 | +10 / −2 |
| `DocsSidebar.vue` | 空态提示 + 清除按钮 + 2 条 CSS | +9 / −0 |

合计 **+46 ~ +49 / −5**，五个文件。`DocSearchPanel.vue` 将从 345 → 约 363 行：**改动前已越过 R-FILE-01 的 300 行审查线**，本稿不新增跨线，但需在实施时说明是否顺手拆（建议不拆，避免把 UI 改动变成重构）。

## 6. 门禁与验收

### 6.1 静态门禁（照抄 `RULES.md` R-TEST-01，逐条零退出码）

```bash
npm run lint:check        # eslint . --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx
npm run type-check        # vue-tsc --noEmit
npm run test:unit         # vitest run（基线 987 通过 / 1 跳过 / 85 文件，F15）
npm run build
npm run build:check-bundle
npm run verify:all
npm run docs:check-links
npm run standards:check
npm run cycles:check
```

### 6.2 真浏览器验收（1024×682 与 1366×682 各一遍）

1. 开「查文档」→ 输入关键词 → 出现「浏览全部文档」→ 点击 → hash 含 `/docs` 且 `q=` 等于该词。
2. 文档中心搜索框的值等于该词。
3. **空态逃生**：用一个**只出现在正文、不出现在任何分类标签与文档标题里**的词（选取方法：先用脚本对 `docs-catalog.ts` 的标签集合与文档 title 全量做 `includes` 判定，取判定为「无命中」的实词，脚本输出留档）→ 预填后侧栏应显示空态提示，点「清除筛选」→ 侧栏恢复全部分类。
4. 点「返回」→ 回到来源 `/editor/:id`，项目 id 与进入前一致。
5. 工具栏「文档」（无查询词）→ hash 为 `/docs` 且**不带** `q`。
6. 空历史对照：新标签页直接开 `#/docs` → 点「返回」→ 落在 `/`，应用不退出。
7. 残留对照：先 `/docs?q=某词` → 再跳到 `/docs`（不带 q）→ 搜索框应清空、侧栏恢复。

**负对照（必须实跑开火）**：临时把 `@browse-all` 改成不传 `query`，第 1 步应失败（证明验的是「参数真的传过去」而不是「链接存在」）。同样，临时删掉 `applyQueryPrefill` 的 else 分支，第 7 步应失败。

## 7. 待 owner 决策

| 编号 | 问题 | 建议 |
|---|---|---|
| D1 | 返回优先回来源，改变现有「恒回 `/`」 | 接受；无历史已用兜底覆盖 |
| D2 | 是否保留 `?q=` 预填（本稿已配套空态逃生） | 保留；否则从「搜不到」跳过去还要重输 |
| D3 | `DocSearchPanel.vue` 是 345 行（已超 R-FILE-01 审查线），是否本次顺手拆分 | 不拆；本稿只加约 18 行，拆分会把 UI 改动变成重构 |
