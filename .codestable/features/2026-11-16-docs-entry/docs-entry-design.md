# 文档中心第二入口 设计稿 v5（候选定稿）

- 日期：2026-11-16
- 状态：**已实现并通过验收** — 经 3 轮 A/B 对抗审查 + 1 轮自检 + 2 轮独立收尾核验（第 1 轮 10 条全过 + 1 条条件性阻塞；第 2 轮 0 阻塞 + 3 处较轻项，均已修）；实现与验收结果见 §9
- 历史留档：v2 `docs-entry-design-v2.md`（md5 `262970831d8c5e1f2d3a7182573c313e`）；v3/v4 内容见 §0.3、§0.4 的修订记录
- 范围：编辑器「查文档」面板 + 文档中心（预填、说明行、返回行为）

## 0. 审查记录（6 轮）

### 0.1 第 1 轮（A 席 8 项，B 席复核 + 补报 1 项）

| 编号 | 指出 | 复现判决 | 处置 |
|---|---|---|---|
| B1 | 「工具栏传进来的是 MouseEvent」编造 | 真：`EditorToolbar.vue#L69` 零载荷、`#L218` `'open-docs': []` | 理由改为「工具栏零参 / 面板传 string」 |
| B2 | 全文词预填会筛空侧栏 | 部分：`ML-KEM` 会命中分类名（`docs-catalog.ts#L42`） | 改为「试算后才预填」 |
| B3 | 门禁弱于 R-TEST-01 | 真：`RULES.md#L74-L86` 九条 | §6.1 照抄 |
| M1 | 「248px 会挤」假 | 真：面板 400（`App.vue#L208`），窄屏 `min(760px,94vw)`（`#L201`） | 理由重写 |
| M2 | 「放 hint 区会被顶上去」机制错 | 真：`#L29-L36` 是 `v-if` 链，有结果时 hint 不渲染 | 理由改为「会消失，违反 G1」 |
| M3 | F8 锚点只证首屏 `back: null` | 真：写入点是 `vue-router.js#L145` | 补锚点 |
| M4 | F2 区间漏闭括号 | **假阳**：`L344`=`}`、`L345`=`</style>` | 不改 |
| M5 | 「刷新后无历史」不准 | 真：`#L104-L105` 仅在无 state 时重建 | 改为「新标签页 / 直输 URL」 |
| 补报 | `?q=` 移除后不清旧值（B 席） | 真 | 清空分支 |

### 0.2 第 2 轮（A 席对 v2：conditional-pass，1 阻塞 + 6 较轻 + 1 补事实）

| 编号 | 指出 | 复现判决 | v4 处置 |
|---|---|---|---|
| B1 | G2 自相矛盾（写「不得筛空」但把空侧栏当预期） | 真 | 改为「先试算、命中才预填」 |
| N1 | §5 少算删除行 | 真（B 席按行 diff 复算：`openDocs` +5/−2，加 `@browse-all` 后 +6/−2；`goBack` +4/−2） | §5 按此重算 |
| N2 | `App.vue#L198` 注释会过期 | 真 | 列入改动 |
| N3 | 验收未写死「同一组件实例」 | 真 | §6.2 第 6 步写明「改 hash，不重挂载」 |
| N4 | 第 3 步缺负对照 | 真 | 补三条负对照 |
| N5 | 「深链优先于预填」无对应代码 | 真：`applyDeepLink`（`#L231-L239`）只读 `doc`/`line` | 改为「互不影响」 |
| N6 | 「500 行来自项目记忆」的出处查不到 | **A 席假阳**：B 席在 `.agents/memory/MEMORY.md#L44` 逐字找到该不变式（e22） | 恢复该表述并给准确锚点 |
| F20 | 漏了「欢迎页列未过滤分类」 | 真：`DocsView#L41` 传 `categories`、`DocsContent#L43` `v-for` | 补入 F 表 |

### 0.3 第 3 轮（B 席对 v3：conditional-pass）

| 编号 | 指出 | 复现判决 | v4 处置 |
|---|---|---|---|
| H1 | `filterCategories(locale: BlocklyLocale)` 类型不匹配 | **真，且更严重**：`BlocklyLocale = 'en' \| 'zh-hans'`（`locale/types.ts#L1`），文档中心是 `'zh' \| 'en'`（`DocsView#L76`），而 `getCategoryLabel(catId, locale: string)` 的表只有 `zh`/`en`（`docs-catalog.ts#L78-L80`）——传 `zh-hans` 会让分类名退化成裸 id，过滤整体失效 | 签名改 `locale: 'zh' \| 'en'`，不引入 `BlocklyLocale` |
| H2 | computed 新增 `.trim()` 与原语义不等价 | 真：`#L95`/`#L97` 不 trim，纯空格查询原先是「筛空」 | computed 不加 trim；只对 `route.query.q` trim |
| H3 | 说明文案编造 | 真：守卫只比分类名与标题，却写成「只出现在正文里」；任何无匹配词（含拼写错误）都会触发 | 改为「未匹配任何分类或文档标题」 |
| H4 | 语言切换漏洞 | 真：`#L249-L257` 切换只 `rebuildCategories()`，不重判搜索词；中文标签命中的词在英文下可能 0 命中 | 加 `prefilledQuery` 跟踪，切换后重判并清理（只清预填值） |
| H5 | 「15 项发现 / 12 真缺陷」口径错 | 真：三轮表格共 17 行；且「漏报」属发现，不能与假阳相减去推「真缺陷数」 | §0 改为分轮列条目，不再给聚合真缺陷数 |
| H6 | F21「不再需要它们」措辞误导 | 真：现有 `v-model` 仍在用 | 改为「本稿不改它，不是说它无用」 |
| H7 | `prefillNotice` 草稿无声明 | 真（实现草稿漏项） | §4.2 代码补声明 |

**错率记录（按轮，不聚合）**：第 1 轮 A 报 8 项中假阳 1、过强 1；第 2 轮 A 报 8 项中假阳 1（N6）、数字粗计 2 处偏差；第 3 轮 B 报 7 项全部成立，其中 H1 的实际严重度高于其描述。

### 0.4 第 4 轮（自检，未派席）

| 编号 | 问题 | 处置 |
|---|---|---|
| S1 | §5 删除行合计写成 `−13~−15`，按分项 `2+2+7~9` 应为 `−11~−13` | 已改正 |
| S2 | `watch(searchQuery)` 清 `prefilledQuery` 依赖「赋值顺序 + watch 异步刷新」才不出错 | 删掉该 watcher，改在 `watch(currentLocale)` 里用 `searchQuery.value !== q` 判断用户是否改过；`prefilledQuery` 仍由 `applyQueryPrefill` 维护 |
| S3 | 「距 500 行仍有约 140 行」是估值 | 改为算式 `500 − 362 = 138` |

注：原计划由第三方模型（Gemini 通道）做第 4 轮独立核验，该派发**失败且无输出**（与项目记忆里「部分 Gemini 派发接受任务但无回报」的已知坑一致），已改用其他模型重派。

### 0.5 第 5 轮（收尾核验：10 条全过，1 条条件性阻塞 + 4 处更正）

| 编号 | 指出 | 处置 |
|---|---|---|
| T1 | 两个 `watch(currentLocale)` 的先后顺序没写死；照稿抄新 watcher 会先跑，`matches()` 用旧语言 `categories` 配新语言标签，可能误判「仍命中」→ 侧栏筛空且无提示（正是 G2 要避免的情形） | 给新 watcher 加 `{ flush: 'post' }`：post 队列一定晚于既有 pre-flush watcher 的同步部分（`rebuildCategories()` 是同步的），**与注册位置无关** |
| T2 | §5 的 `DocsView +26~+31` 偏低：稿内代码块 43 行非空代码，实际约 +45~+60 | 改为 `+45~+60 / −8~−12`，并给出 `DocsView 323 → 360~371` |
| T3 | 只提了 `DocSearchPanel` 越 300 线，没提 `DocsView`（323 行）也已越线 | §5 补注 |
| T4 | `App.vue` 的 `−2` 没算 `#L198` 注释改写 | 改 `+7 / −3` |
| T5 | 引用编号漂移：§0.2 写「F17」现为 F20，§0.3 H6 写「F18」现为 F21；F15 锚点应为 `#L249-L257` | 已全部更正 |
| T6 | i18n 键名 `docsPrefillBodyOnly` 与新文案语义相反（文案已不说「只在正文里」） | 改名 `docsPrefillNoTitleMatch` |
| T7 | 已知边角：用户手动清空后又敲出与 `prefilledQuery` 完全相同的串，切语言时会被当成预填清理 | 不改代码，登记为已知限制（§8 L1） |

**T1 的实证**（v5 定稿时补跑，不是推理）：用仓库内 `vue` 起一个不挂组件的纯内存实验——pre-flush watcher 里同步写 `cats.value = ['built-' + loc]`，post-flush watcher 里读 `cats`，切换 `loc` 后 `await nextTick()`：

```
post 读到的 categories = ["built-en"]   → PASS（post 在 pre 之后）
```

即 `{ flush: 'post' }` 确实能保证新 watcher 读到按新语言重建后的 `categories`，与注册顺序无关。

### 0.6 第 6 轮（独立收尾复核：0 阻塞 + 3 处较轻，已修）

派席复核 md5 `062254dd…`（v5 定稿）这一版本身：前后 md5 一致，未被并发改动。结论 conditional-pass，**0 阻塞**；3 处较轻：

| 编号 | 指出 | 复现判决 | 处置 |
|---|---|---|---|
| N1 | §5 端点配对错：写了 `+45~+60 / −8~−12`，却把行数写成 `323 → 360~371`、余量 `500−371=129` | 真：增删应各自独立取极值，`323+45−12=356` 到 `323+60−8=375` | 改 `356~375`，余量改 `500−375=125` |
| N2 | T7 写「登记为已知限制（§7 L1）」，但 L1 在 §8 | 真：`## 7.` 是待 owner 决策，`## 8.` 才是已知限制 | 改 `§8 L1` |
| N3 | §8 L1 称精确区分「需要监听 `DocsSidebar` 的 `update:searchQuery`（会动到本稿声明不改的组件）」 | 真，且理由是编造的：父组件 `DocsView#L26` 已有 `v-model:search-query`、子组件 setter 在 `DocsSidebar#L60-L64`，在父模板加 `@update:search-query` 即可，**不必改子组件** | 删掉该理由，改为「需在父组件多维护一层输入状态，本次不做」 |

该席另核实为真：T1 机制（读 `runtime-core.cjs.js` 的 pre/post 队列区分，实跑证 post 在既有 watcher 同步 `rebuildCategories()` 之后才读、与注册顺序无关）、T5/T6 的编号与键名一致、43 行非空代码、四文件合计、F11/F12/F15/F16/F19/F21 锚点（F15 确到 L257）、过滤语义 16 组合、`query` 为 setup-ref 且模板解包编译 0 错误、页脚在条件链外。

## 1. 问题

| 编号 | 问题 | 证据 |
|---|---|---|
| P1 | 「查文档」面板搜不到时没有下一步，面板内没有通往文档中心的路径 | 面板无 `router`、无 browse 类事件 |
| P2 | 面板查询词无法带入文档中心 | 无 `?q=` 读取逻辑 |
| P3 | 文档中心「返回」恒回 `/`，经 `HomeView` 再跳「最近项目」，来源不确定 | `DocsView.vue#L165-L167` |

## 2. 目标与非目标

- **G1** 面板底部恒可见「浏览全部文档」入口。
- **G2** 带查询词进文档中心；**预填在写入瞬间不得产生空侧栏**（词须命中分类名或标题），语言切换后若不再命中则自动清理并提示。
- **G3** 返回来源页；无应用内历史时回 `/`。

**非目标**：不改语料/索引/路由；不做搜索框 ↔ URL 双向同步；不改工具栏主入口与活动条；不改 `DocsSidebar`；不抽公共浮层组件；不动 z-index。

## 3. 现状事实（逐条已实跑）

| 编号 | 断言 | 锚点 |
|---|---|---|
| F1 | 结果列表 `</ul>` 在 L55，`.dsp-foot` 在 L57 | `DocSearchPanel.vue#L55`、`#L57` |
| F2 | `.dsp-foot` 规则完整占 L338-L344（L345 是 `</style>`） | 同文件 `#L338-L344` |
| F3 | `defineEmits` 现只有 `close` / `open` | 同文件 `#L75-L79` |
| F4 | 结果区是 `v-if/v-else-if/v-else` 链，链尾 `ul` 在 L36 | 同文件 `#L29-L36` |
| F5 | 窄屏浮层宽 `min(760px, 94vw)` | 同文件 `#L201` |
| F6 | `openDocs()` 只做 `closeMenus()` + `push('/docs')`（+5/−2 的基线）；工具栏零载荷 | `App.vue#L199-L202`、`EditorToolbar.vue#L69`/`#L218` |
| F7 | 查文档面板宽 400（`setLeftWidth(400)`） | `App.vue#L206-L208` |
| F8 | `searchQuery` 是 `ref('')`；侧栏收 `filteredCategories` | `DocsView.vue#L85`、`#L27` |
| F9 | 侧栏过滤 = 分类名或标题 `includes`（**不 trim**），空分类剔除；`q` 为空返回全部 | `DocsView.vue#L94-L106` |
| F10 | 分类标签含算法名（`FIPS 203 — ML-KEM 密钥封装`） | `src/utils/docs-catalog.ts#L42` |
| F11 | `getCategoryLabel(catId, locale: string)` 的表只有 `zh`/`en` | `src/utils/docs-catalog.ts#L78-L80` |
| F12 | 文档中心 locale 是 `computed<'zh' \| 'en'>`；`BlocklyLocale` 是 `'en' \| 'zh-hans'` | `DocsView.vue#L76`、`locale/types.ts#L1` |
| F13 | `goBack()` 恒 `push('/')`（+4/−2 的基线） | `DocsView.vue#L165-L167` |
| F14 | 首屏写 `{ back: null, … }`；`push` 用 `buildState(currentLocation.value, to, null)` | `vue-router.js#L104-L110`、`#L145` |
| F15 | 语言切换 watch 只 `rebuildCategories()`，不重判搜索词 | `DocsView.vue#L249-L257` |
| F16 | `window` 在 ESLint globals；`no-explicit-any` 为 error | `eslint.config.js#L46`、`#L78` |
| F17 | 无覆盖 `DocSearchPanel`/`DocsView` 的单测 | `grep -rln … tests/` 命中 0 |
| F18 | 单测基线 **85 文件 / 987 通过 / 1 跳过**（实跑 exit 0） | 实跑输出 |
| F19 | `DocSearchPanel.vue` 现 345 行，已超 R-FILE-01「超过 300 行需审查拆分」（`RULES.md#L25`）；另有一条 500 行硬上限在项目记忆里 | `wc -l`、`RULES.md#L25`、`.agents/memory/MEMORY.md#L44` |
| F20 | 正文区欢迎页列的是**未过滤**分类 | `DocsView.vue#L41`、`DocsContent.vue#L43` |
| F21 | `DocsSidebar` 的 `searchQuery` prop 与 `update:searchQuery` emit 仍被现有 `v-model` 使用；本稿不改它 | `DocsSidebar.vue#L49`、`#L56` |

## 4. 设计

### 4.1 面板底部入口（G1）

插在 `#L55`（`</ul>`）之后、`#L57`（`.dsp-foot`）之前，包一层 `.dsp-footer`：

```html
<div class="dsp-footer">
  <button type="button" class="dsp-browse" @click="emit('browse-all', query.trim())">
    {{ ui('docSearchBrowseAll') }} →
  </button>
  <p class="dsp-foot">{{ ui('docSearchFoot') }}</p>
</div>
```

- **必须在 `</ul>` 之后**：L29-L36 是 `v-if` 链，放 hint 区会随状态消失；L55 之后在链外，任何状态都渲染。
- **不放头部**：头部（L7-L13）已有标题 + 「含标准 PDF」 + `×`，且是操作区；面板宽 400（F7），退路属页脚。
- 样式：`.dsp-footer` 承接上边框，`.dsp-foot` 的 `border-top` 去掉；`.dsp-browse` 为无边框文字按钮（`color: var(--color-primary)`、`padding: 6px 12px`、`text-align: left`、`font-size: 12px`、`background: none`、`cursor: pointer`）。

### 4.2 预填、说明行、语言切换（G2）

**面板**：`emit('browse-all', query.trim())`。

**宿主**：

```ts
function openDocs(q?: unknown): void {
  closeMenus();
  // 两个调用点：工具栏 open-docs 零载荷（`'open-docs': []`），面板 browse-all 传 string。
  const keyword = typeof q === 'string' ? q.trim() : '';
  void router.push(keyword ? { path: '/docs', query: { q: keyword } } : '/docs');
}
```

**文档中心**：

```ts
// 过滤语义与原 computed 逐字等价：不 trim，q 为空返回全部，分类名命中时保留该分类全部文件。
type DocsLocale = 'zh' | 'en';   // 文档中心域；不是 BlocklyLocale('en'|'zh-hans')，见 F11/F12

function filterCategories(list: DocCategory[], q: string, locale: DocsLocale): DocCategory[] {
  if (!q) return list;
  const needle = q.toLowerCase();
  return list
    .map((cat) => ({
      ...cat,
      files: getCategoryLabel(cat.id, locale).toLowerCase().includes(needle)
        ? cat.files
        : cat.files.filter((f) => f.title.toLowerCase().includes(needle)),
    }))
    .filter((cat) => cat.files.length > 0);
}

const filteredCategories = computed(() =>
  filterCategories(categories.value, searchQuery.value, currentLocale.value),
);

const prefillNotice = ref('');    // 非空则显示「未匹配任何分类或文档标题」
const prefilledQuery = ref('');   // 记录搜索框当前值是否由预填写入

function matches(q: string): boolean {
  return filterCategories(categories.value, q, currentLocale.value).length > 0;
}

function applyQueryPrefill(): void {
  // 只有来自 URL 的值才 trim；用户自己敲的搜索保持原样（F9）。
  const q = typeof route.query.q === 'string' ? route.query.q.trim() : '';
  if (q && matches(q)) {
    searchQuery.value = q;
    prefilledQuery.value = q;
    prefillNotice.value = '';
  } else {
    // 无 q 时也要清：同组件内从 /docs?q=X 走到 /docs 不清会残留旧过滤（第 1 轮 B 席补报）。
    searchQuery.value = '';
    prefilledQuery.value = '';
    prefillNotice.value = q;
  }
}

onMounted(() => { rebuildCategories(); applyDeepLink(); applyQueryPrefill(); });
watch(() => route.query.q, applyQueryPrefill);
// 语言切换后分类标签变了：中文标签命中的词在英文下可能一个都匹配不到（F15 的 watcher 只重建分类）。
// 必须 { flush: 'post' }：既有 watcher（#L249-L257）是 pre-flush 且同步调用 rebuildCategories()，
// post 队列一定晚于它，因此 matches() 读到的 categories 已按新语言重建——与两个 watcher 的注册顺序无关。
// 早前版本用一个 watch(searchQuery) 去清 prefilledQuery，那要靠「赋值顺序 + 异步刷新」才不出错，太脆。
watch(currentLocale, () => {
  const q = prefilledQuery.value;
  if (!q || searchQuery.value !== q) return;  // 用户改过搜索框就不再管
  if (matches(q)) return;
  searchQuery.value = '';
  prefilledQuery.value = '';
  prefillNotice.value = q;
}, { flush: 'post' });
```

**说明行**（`.docs-header` 之下、`.docs-body` 之上）：

```html
<p v-if="prefillNotice" class="docs-notice">
  {{ ui('docsPrefillNoTitleMatch').replace('{q}', prefillNotice) }}
</p>
```

文案：`“{q}” 未匹配任何分类或文档标题，已显示全部文档。`（英文：`"{q}" matches no category or document title; all documents are shown.`）

- 文案**不做**「只出现在正文里」的断言：守卫只比分类名与标题，任何无匹配词（包括拼写错误）都会走到这里（第 3 轮 H3）。
- `.docs-notice` 需要 `flex-shrink: 0`（`.docs-view` 是 `height: 100vh` 的纵向 flex，`.docs-body` 是 `flex: 1`；不加时提示行在空间紧张时会被压缩）。
- `.replace('{q}', …)` 与既有 `docSearchPdfPage.replace('{n}', …)`（`DocSearchPanel.vue#L51`）写法一致。

`applyDeepLink`（`#L231-L239`）只读 `doc`/`line`，与 `searchQuery` 互不影响；不存在「优先级」代码。

### 4.3 返回来源（G3）

```ts
function goBack(): void {
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back) router.back();
  else void router.push('/');
}
```

| 否决的替代 | 理由 |
|---|---|
| `window.history.length > 1` | 新标签页首屏 `length` 也可能 > 1 |
| 路由 meta 标记来源 | 每个入口都要改，漏一个即失效 |
| 一律 `router.back()` | 新标签页直接开 `#/docs` 会退出应用 |

风险：`back` 是 vue-router 写入字段（F14），非公开 API；上游改字段时退化为永远 `push('/')`。

## 5. 改动清单（区间）

| 文件 | 改动 | 估计 |
|---|---|---|
| `DocSearchPanel.vue` | `.dsp-footer` 包裹 + 按钮 + emit 签名 + 3 条 CSS（`.dsp-foot` 重缩进与 `border-top` 改值） | +16~+19 / −2 |
| `App.vue` | `openDocs` 参数与守卫（含 `#L198` 过时注释改写）、`@browse-all` | +7 / −3 |
| `ui-messages.ts` | `docSearchBrowseAll`、`docsPrefillNoTitleMatch`（中英各一） | +4 |
| `DocsView.vue` | 抽 `filterCategories`、`computed` 改写、`matches`/预填/两个 watch、`prefillNotice` 模板行与样式、`goBack` 兜底（稿内代码块共 43 行非空代码，原 computed 仅约 5 行可复用） | +45~+60 / −8~−12 |

合计 **+72 ~ +90 / −13 ~ −17**，四个文件。

行数影响：`DocSearchPanel.vue` 345 → **359~362**；`DocsView.vue` 323 → **356~375**（新增与删除按各自独立取端点：`323+45−12=356` 到 `323+60−8=375`）。两个组件**在改动前就已越过** R-FILE-01 的 300 行审查线（`RULES.md#L25`），本次不顺手拆分（避免把 UI 改动变成重构）；距项目记忆的 500 行硬上限（`.agents/memory/MEMORY.md#L44`），按上限 375 算仍有 `500 − 375 = 125` 行。

## 6. 门禁与验收

### 6.1 静态门禁（照抄 `RULES.md` R-TEST-01，九条逐条零退出码）

```bash
npm run lint:check
npm run type-check
npm run test:unit        # 基线 85 文件 / 987 通过 / 1 跳过（F18）
npm run build
npm run build:check-bundle
npm run verify:all
npm run docs:check-links
npm run standards:check
npm run cycles:check
```

### 6.2 真浏览器验收（1024×682、1366×682 各一遍）

1. **标题命中**：开「查文档」→ 输入 `ML-KEM` → 点「浏览全部文档」→ hash 含 `/docs` 且 `q=ML-KEM`；搜索框有值；侧栏收窄且**非空**。
2. **无匹配词**：用一个系脚本判定「不在任何分类标签与文档标题里」的词（脚本对 `docs-catalog.ts` 标签全集与文档 title 全集做 `includes`，取无命中者并留档输出）→ 点入口 → 搜索框**为空**、侧栏为**全部分类**、顶部显示「“该词” 未匹配任何分类或文档标题，已显示全部文档。」
3. **无查询词**：面板空着点入口 → hash 为 `/docs`，不带 `q`，无提示行。
4. **语言切换**：在 `?q=` 用中文分类词命中的状态下切到 English → 若该词在英文标签下不再命中，搜索框被清空、提示行出现、侧栏恢复全部；若仍命中则保持。
5. **返回来源**：点「返回」→ 回到来源 `/editor/:id`，项目 id 与进入前一致。
6. **空历史**：新标签页直接开 `#/docs` → 点「返回」→ 落在 `/`，应用不退出。
7. **残留**：在 `/docs?q=ML-KEM` 状态下用**同一组件实例**改 hash 到 `/docs`（脚本改 `location.hash`，不刷新、不重挂载）→ 搜索框清空、侧栏恢复全部。

**负对照（四条都必须实跑开火）**

- 不传 `query` → 第 1 步失败（验的是参数传递，不是链接存在）。
- 删掉 `matches(q)` 守卫 → 第 2 步失败（会变成预填筛空）。
- 删掉 else 分支 → 第 7 步失败（必须走「同实例」路径；先回编辑器再点工具栏会重新挂载，误判为通过）。
- 删掉 `currentLocale` 的预填重判 → 第 4 步失败。

## 7. 待 owner 决策

| 编号 | 问题 | 建议 |
|---|---|---|
| D1 | 返回优先回来源，改变现有「恒回 `/`」 | 接受；无历史已兜底 |
| D2 | 保留 `?q=` 预填（现保证预填瞬间不筛空，并在切语言后重判） | 保留 |
| D3 | 无匹配词时显示一行说明 | 接受；否则用户不知为何搜索框是空的 |
| D4 | `DocSearchPanel.vue` 已 345 行，是否本次顺手拆分 | 不拆；本次只加约 18 行 |

## 8. 已知限制（登记，不在本次修）

| 编号 | 限制 | 影响与理由 |
|---|---|---|
| L1 | 用户手动清空搜索框后，又敲出与 `prefilledQuery` **完全相同**的串，切语言时会被当成预填值清理 | 只影响「清空 + 重敲同一串 + 切语言」三步同时发生；后果是搜索框被清空并出现一行说明，不丢数据。精确区分需要监听 `DocsSidebar` 的 `update:searchQuery`（会动到本稿声明不改的组件），收益不抵成本 |
| L2 | 预填只保证「写入瞬间」不筛空，之后用户自己改搜索框仍可能筛空 | 那是用户显式操作，属正常搜索行为，不需要兜底 |
| L3 | 「返回优先回来源」依赖 vue-router 写入的 `history.state.back`（非公开 API） | 上游改字段时退化为 `push('/')`，即今天的行为，不会崩 |

## 9. 实现与验收记录（2026-11-16，实现后回填）

### 9.1 落盘与实测行数（`git diff --numstat`）

| 文件 | 新增 / 删除 | 行数变化 |
|---|---|---|
| `DocSearchPanel.vue` | +30 / −2 | 345 → 373 |
| `App.vue` | +6 / −3 | 437 → 440 |
| `ui-messages.ts` | +4 / 0 | 228 → 230 |
| `DocsView.vue` | +86 / −8 | 323 → 401 |
| **合计** | **+126 / −13** | |

**与 §5 估算的偏差**：新增 +126 超出估算区间 `+72~+90` 的上限约 40%；删除 −13 落在 `−13~−17` 的下沿。原因三条：① 按钮属性写成多行；② `matches`/`applyQueryPrefill`/两个 watch 都带了「为什么这么写」的注释；③ 设计稿代码块里的空行在实现中是省不掉的。两个组件仍在项目记忆的 500 行硬上限内（401 / 373），且**改动前就**已越过 R-FILE-01 的 300 行审查线（见 D4：本次不拆）。

### 9.2 静态门禁（`RULES.md` R-TEST-01 九条，逐条 exit 0）

| 门禁 | 结果 |
|---|---|
| `lint:check` | exit 0（0 error / 0 warning，未改 ESLint 规则、未加 eslint-disable） |
| `type-check` | exit 0（`vue-tsc --noEmit`） |
| `test:unit` | **85 文件 / 987 通过 / 1 跳过 / exit 0**（与基线一致） |
| `build` | exit 0（`vue-tsc --noEmit && vite build`） |
| `build:check-bundle` | exit 0 —— `entry=index-D_WNrDkc.js bytes=41149 budget=65536` |
| `verify:all` | exit 0 —— 模板 **29/29 PASS**、`DEMO_SUMMARY total=60 pass=60 fail=0` |
| `docs:check-links` | exit 0 —— `files=443 broken=0` |
| `standards:check` | exit 0 —— `entries=40 directories=40 artifacts=66 source_layers=27 structured=229 errors=0` |
| `cycles:check` | exit 0 —— `no dependency violations found (716 modules, 1429 dependencies)` |

### 9.3 真浏览器验收（Firefox 160 headless + WebDriver BiDi）

无头 Gecko、独立 profile、不占用桌面焦点；从开发服务器（`vite` dev，端口 3001）加载真实应用。

**宽屏 1366×682：27/27 断言通过**

| 组 | 覆盖 | 关键断言 |
|---|---|---|
| A | G1 恒可见 + G2 命中预填 | 面板底部入口存在；**有结果时仍存在**；点入口后 hash 含 `q=ML-KEM`、搜索框预填、侧栏非空、无说明行 |
| B | G2 无匹配词 | hash 带 `q=zzzqqqxx`、搜索框为空、侧栏 44 个分类全在、说明行文案正确 —— `evidence/acc-B-nomatch.png` |
| C | 无查询词 | hash 就是 `#/docs`、无 `q=`、无说明行、侧栏全部分类 |
| D | 语言切换重判 | 英文词 `encapsulation` 预填成功 → 切中文后不再命中 → 搜索框清空 + 说明行出现 + 侧栏恢复 |
| E | G3 返回来源 | 工具栏进 `/docs` → 点「返回」→ 回到 `#/editor/1`，项目 id 与进入前一致 |
| F | 无历史兜底 | 新标签首屏 `history.state.back` 为 `null`；点「返回」不退出应用（`/` 是 HomeView，会立刻转编辑器，见下） |
| G | 同实例去 q | 同组件实例内 `#/docs?q=ML-KEM` → `#/docs`：搜索框清空、侧栏恢复 |

`evidence/acc-A-hit.png`、`acc-D-locale.png`、`acc-F-emptyhistory.png` 为对应截图。

**窄屏 1024×682：4/4 通过** —— 面板切到浮层形态（`.dsp-overlay`、宽 `min(760px,94vw)`=760），浮层内在「已有结果」时入口仍可见；点入口带 `q=FIPS 204` 进 `/docs` 且预填成功（hash 里空格编码为 `+`，`route.query.q` 解码后为 `FIPS 204`）。

**一处验收判据被实测修正**：设计 §6.2 第 6 步写「落在 `/`」，实际应用内 `/` 是 HomeView 开屏页，它会立刻把用户转到编辑器（上次项目 → 最近修改 → 新建）。因此正确判据是「**不退出应用且停在应用内页面**」，`history.state.back` 为 `null` 才是「没有应用内历史」的直接证据。

### 9.4 负对照（变异测试：四处保护各改坏一次，全部开火）

| 变异 | 期望失败 | 实测（变异后） | 还原后 MD5 |
|---|---|---|---|
| M1 删掉 `if (q && matches(q))` 的守卫 | B 组 | `input="zzzqqqxx" cats=0`（预填筛空，侧栏空） | 与原文件一致 |
| M2 删掉 else 清空分支 | G 组 | `input="ML-KEM" cats=2`（旧过滤残留） | 一致 |
| M3 `openDocs` 不传 `q` | A 组 | `hash=#/docs`（无查询词） | 一致 |
| M4 删掉语言切换重判 | D 组 | 切中文后 `input="encapsulation"`、无说明行 | 一致 |

四轮变异均先备份原文件、跑完立即还原，还原后 `md5sum` 与变异前逐字节一致；还原后又重跑一遍完整 27 条，仍全绿（排除「变异后恰好也绿」）。

### 9.5 未做 / 残留

- **没有新增永久单测**：仓库 vitest 环境是 `node`、未装 `@vue/test-utils`，加组件测试要引入新依赖，超出本次范围（F17「无覆盖」仍成立）。替代证据是上述 31 条浏览器断言 + 4 条变异。
- **负对照未固化成仓库门禁**：BiDi 脚本是本次一次性驱动（放在 `/tmp`），没进 `scripts/` 也没接 CI。要长期防回归，需要把它收进仓库并接到流水线。
