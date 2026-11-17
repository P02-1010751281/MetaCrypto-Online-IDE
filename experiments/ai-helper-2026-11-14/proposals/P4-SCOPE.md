# P4 范围提案：A 线「标准/论文 → 一整套可打开的 project」

> 2026-11-17　状态：方案（只读调查；未改 `src/`、未提交）　依据：`PLAN.md` §0/§3、`RESULTS.md` §40–§44、仓库实测
> 命令均在仓库根执行；标「预计」的是估计值（块数、工时），其余为实测。

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 语料 | `docs/standards/` 337 个 md：**230** 个中文结构化条目 + 10 个英文条目孪生；40 个 manifest 目录 + `papers/`；66 个 artifact 全带 sha256 |
| 锚点 | **221/230** 条目含 `#L` 行锚点；**173/230** 的 `原文位置` 本身可点（区间 55 + 单行 118）；9 条无行锚点且都写明原因 |
| 映射 | 182 个条目有「项目映射」小节，其中 **73** 个点名真实块；反向信号（块 tooltip 引标准号）只覆盖 **116/222** 块 → 必须三级证据 |
| 输出形态 | 复用 `ProjectRecord`/`ProjectFileRecord`；报告与锚点**不进 block 文件**，写 `metadata.aiHelper` |
| 试点 | FIPS 180-4 SHA-256 多分组摘要：5 条条款（1 能搭 / 3 部分 / 1 不能），预计 22–27 块，官方向量收尾 |
| 第一批 | 2 天：锚点抽取 → 三档判定 → 手工搭 2 个文件 → `verify-project` 出双语言读数 |
| 最大风险 | 语料自身有 **39 处**「项目状态」与「项目映射」互相矛盾；三档必须逐条带证据并交人签核 |

## 1. 对象定义

### 1.1 输入

| 输入类 | 接受条件 | 不接受 |
|---|---|---|
| 已结构化标准 | manifest 有 `id`；目录有 `00-Standard-Source.md`；条目页有 `条目元数据` 表 | 不解析任意 PDF |
| 用户临时投喂的 PDF/论文 | 先走维护者线建条目（拆页 + 锚点 + 映射），A 线只消费条目 | 不自动切条款、不猜条款号 |
| 来源钉死 | 原样复用 manifest 字段：`id` / `version` / `source_checked_at` / `artifacts[].sha256` | 不新造版本字段、不写「最新版」 |

理由（重述）：A 的原文没有可执行语义，是三条线里唯一没有确定性判据的；国内 NGCC 到 2026-11 仍无定稿标准，来源必须用「哈希 + 版本 + 获取日期」钉死，否则同一份「标准」在不同月份指向不同文本。

### 1.2 「完整 project」的最小可验收形态

一个 `ProjectRecord`（字段见 `src/services/projects/ProjectStore.ts:20-50`）：

| 字段 | 最小要求 | 验收 |
|---|---|---|
| `name` | 标准号 + 算法/步骤 + 来源短哈希（`FIPS 180-4 SHA-256 多分组（src 58d09d35）`） | 非空、含标准号 |
| `language` / `format` | `python` / `json` | 枚举 |
| `files[]` | ≥2 个 `ProjectFileRecord`（见 1.3），每个 `workspace` 是 Blockly 负载 | 逐个 `workspaces.load` 不抛错 |
| `entryFileId` | 指向 `main.block.json` | 决定原语注入与生成顺序（`projectCodegen.ts:249`） |
| `metadata.aiHelper` | 覆盖报告 + 锚点 + 测试规格（4.1） | 结构校验 + 锚点哈希复核 |
| `workspace` | 可留空（多文件项目里只兼容旧读取方） | — |

**结构约束**：`files[].workspace` 只能是 Blockly JSON/XML（`ProjectStore.ts:20-28`），所以覆盖报告与锚点**不能**塞进 block 文件；`metadata` 是 `Record<string, unknown>`（`:50`），IndexedDB 整条 `put`（`useProjectDB.ts:71`）不做字段白名单——这是唯一不改格式的落点。报告在应用内是视图，不是第 4 个文件。

### 1.3 文件清单（最小 2 个，试点 3 个）

| 文件 | 至少有什么 | 为什么必须有 |
|---|---|---|
| `algo.sha256.block.json` | 1 个 `procedures_defreturn`：`extraState.params` 带 `name/type`，body 由块组成，值接 `RETURN` | 生成代码要有可调用函数；跨文件符号靠它 |
| `main.block.json`（entry） | 顶层演示语句：官方向量常量 → 调用 → 结果变量 → 输出 | 入口是唯一注入 primitives 的文件，也是「能生成代码」的直接证据 |
| `steps.<n>.block.json`（可选） | 子过程（分组循环、密钥扩展） | 让「条款 ↔ procedure」逐条可核 |

### 1.4 什么不算完整 project

只有覆盖报告 + 空骨架（owner 2026-11-17 明确否掉）；只有一个工作区文件（那是 C 线导入）；报告写「已覆盖」但工程里没有对应块；用了 222 个活动块与原生核心块之外的新类型。

## 2. 语料盘点（实测）

### 2.1 文件与条目

| 读数 | 命令 | 值 |
|---|---|---|
| standards 下 md | `find docs/standards -type f -name '*.md' \| wc -l` | 337 |
| manifest 条目 | `python3 -c "import json;print(len(json.load(open('docs/standards/standards-manifest.json'))['entries']))"` | 40 |
| 中文条目页 | `grep -rl '条目元数据' docs/standards --include='*.md' \| wc -l` | **230** |
| 英文条目孪生 | 含 `## Entry Metadata` 的 `.en.md` | **10** |
| `.en.md` / 破对 | `find docs/standards -name '*.en.md' \| wc -l`；逐个查中文兄弟 | 25 / **0 破对** |

**成对规则**：`STRUCTURED-ENTRY-SCHEMA.md` 规定中文 `.md` + 同路径 `.en.md`；英文条目用 `## Entry Metadata` 作表头。只按中文表头数会漏 10 个英文条目，只按文件数会把 25 个译本当新条目 → **条目唯一性按中文页计 230**，英文是同一对象的第二语言视图，缺译按规范回退源语言不算缺陷。

### 2.2 锚点覆盖（决定「点回原文」能否落地）

| 形态 | 条目数 | 说明 |
|---|---|---|
| 页内任意 `#L` | **221 / 230** | 最宽口径 |
| `原文位置` 是区间链接 | 55 | `./00-Standard-Source.md#L705-L1043` |
| `原文位置` 是单行起点链接 | 118 | `#L652` |
| `原文位置` 是散文「第 N 行起」，`原文证据` 另有 `#L` | 46 | 点得动，但不在「原文位置」格 |
| 只有标题片段 | 6 | 滚到小节标题 |
| 无任何行锚点 | **9** | 见下 |

9 条无行锚点（均为合规降级，不是缺口）：`gbt17964-modes/01..04`、`gmt0091-kdf/01..02`（PDF 文本层字体映射损坏，只给 PDF 物理页）；`gbt15852-mac/01`（采标版权不提供文本）；`gbt36624-aead/01`（无可靠文本层，「不能伪造条款行号」）；`STRUCTURED-ENTRY-SCHEMA.md`（规范页）。

结论：条目级锚点覆盖 **96.1%**，其余 3.9% 是写明原因的降级——与「原文位置只有在唯一可验证时才写成行区间，否则保留章节级并写明原因」一致。

### 2.3 映射与状态（决定三档能否自动给）

| 读数 | 口径 | 值 |
|---|---|---|
| 有「映射」小节 | 标题含「映射」 | 182 / 230 |
| 其中点名真实块 | 反引号名 ∩ `block-index.blocks[].blockType` | **73** / 182 |
| 每条目映射块数 | 均值 / 中位 / 最大 | 0.57 / 0 / 5 |
| 块 tooltip 含标准号 | 正则 `FIPS\|SP 800\|RFC\|GB/T\|GM/T` | **116 / 222**，35 个标准号 |
| 状态与映射矛盾 | 「仅参考」却点名块，或「已实现」却无块名 | **39 处**（+1 规范页） |

矛盾样本：`fips180-4-SHA2/04-Compression.md:10` 写「仅参考（未映射为块实现）」，同页「项目映射」却详述 `hash_sha256_compress(V,W)` 的契约；`fips197-AES/04-KeyExpansion.md` 同样。

**这条读数直接决定机制**：`项目状态` 是自由文本（230 条里 47 条不以「已实现/部分实现/仅参考/缺项」开头），不能作三档判据；只作人工备注随报告展示。

### 2.4 可用件不止 222

| 读数 | 值 | 出处 |
|---|---|---|
| 活动块 | 222 | `BLOCK-IO-CONTRACT.json` / `block-index.stats` |
| 模板身份 | 29；其中**纯骨架 5**（`proc_pbkdf2`/`proc_hkdf`/`proc_aes_key_schedule`/`proc_sm4_key_schedule`/`proc_md_iterate`）、部分链 2（`proc_mode_gcm`/`proc_sponge_duplex`） | `TEMPLATE_PREFILL` 注释明写「不计算」「只是 CTR 核心」 |
| Demo | **60** = 顶层 6 + `procedures/` 54；`find demos -name '*.json'` 62 减去 `tests.json`/`evidence.json` | `verify-demos.mjs` |
| Demo 测试规格 | 60 条 `{py:{driver,expect},js:{…}}` | `demos/tests.json` |
| 原生核心块 | 变量/数学/逻辑/文本/列表/控制（`lists_getIndex`、`lists_create_with`、`text_print` 在工具箱） | `src/utils/toolbox-config.ts` |

所以「只能由现有块搭出」的准确表述：**222 个项目块 + 工具箱里的 Blockly 原生核心块**，不得新增类型。RESULTS §40.1 的 B 线已按此口径只用核心块 + procedure 块。

**可复用件（不重造）**：`projectCodegen.ts:196/249`（多文件生成，`tests/unit/project-codegen.test.ts` 5 条已锁跨文件符号/重名/入口顺序）、`typecheck.ts`（340 行类型检查）、`block-search.ts`（纯函数打分）、`doc-search.ts`（BM25 + 行号；索引覆盖 337/337 标准 md、2875 段落）、`injectPrefill`（模板注入）、`verify-demo.ts` + `verify-demos.mjs`（双语言执行，单文件版）。

## 3. 映射机制：条款 → 块

### 3.1 条款单元 = 一个结构化条目页（230 个）

理由：条目页自带 `标准定位`/`原文位置`/`项目状态`/`公式或伪代码`；doc-index 段落更细但没有「这条对应哪些块」字段，只当检索层；任意 PDF 自动切分不可靠，本提案不做。`clauseId` 用「目录名/文件名」（`fips180-4-SHA2/02-Padding`），与 manifest 的 `id` 加条目文件名对得上。

### 3.2 三级证据 + 模板

| 层 | 信号 | 方向 | 覆盖 | 用途 |
|---|---|---|---|---|
| **L1** | 条目「项目映射」点名的块 | 条款 → 块 | 73/230 条目 | **权威**（人工已核），可直接支撑「能搭」 |
| **L2** | 块 tooltip 的标准号 + 条款号 | 块 → 条款 | 116/222 块、35 个标准号 | 补 L1 漏写；同标准号才算命中 |
| **L3** | `block-search` BM25（标签/选项/签名） | 查询 → 块 | 30 题 recall@5 100%（RESULTS §12–13） | **只作候选**，须 L1/L2 或人工确认 |
| **T** | 29 个模板的 `returnChain`/`bodyState` | 模板 → 子图 | 29（5 骨架 / 2 部分） | 起步骨架；骨架只能判部分 |

L1 是「文档声称」，L2 是「块自述」，都不是执行证据；「能搭」必须再加一次机器执行（3.3 第 4 步）。

### 3.3 三档判定（顺序固定，不许跳步）

| 步 | 机器做什么 | 失败时 |
|---|---|---|
| 1 条款规范化 | 取同目录条目页（排除 `00-*`/`README*`/`guides/`），读 `标准定位`、`原文位置` 生成 anchor | 无行锚点 → 降级 `pdf-page`/`section`，判定仍可做 |
| 2 步 → 块命中 | L1 精确 > L2 同标准号 > T 模板链 > L3 候选 | 全不中 → `missing` |
| 3 拼装可行性 | 命中块的 `check` 与上游输出是否相容（`BLOCK-IO-CONTRACT.json`），是否有原生块补管道 | 不相容 → `partial`，缺口写「缺 X 类型适配」 |
| 4 执行证据 | 生成 Python/JS，跑登记 driver（复用 `demos/tests.json` 形状），比对期望 | 跑不过 → `partial`（不许静默升级为 `build`） |

| 档 | 定义 | 必备证据 |
|---|---|---|
| 能搭 `build` | 每一步都有块；typecheck 0 unknown/0 mismatch；示例输入执行通过；L1 或 L2 至少一处指向该条款 | entryPath + anchor + signals[]（层/块/出处）+ 执行结果 |
| 部分 `partial` | 至少一步有块、至少一步没有；或唯一覆盖是模板骨架/复合块（内部步骤无法在画布逐步核） | 同上 + `gaps[]` 逐条（缺哪步、缺什么块/类型） |
| 不能 `missing` | 无任何块映射；或要求本身不是可执行语义（长度上限、常量时间、密钥管理、合规） | entryPath + anchor + `reason`（`no-block`/`non-executable`） |

判定只回答「这一步能不能在画布搭出来、生成代码跑得动」，**不回答**「块与标准语义等价」——后者永远 `semantic_equivalence:'unverified'`。

### 3.4 拼装规则

一条能搭条款 → 一个 procedure 或一个顶层步骤；函数名项目内唯一（`extractProjectSymbols`）；entry 最后生成、原语只注入一次（`projectCodegen.ts:277-292`）；先建变量再连块（否则 Blockly 自动建错类型）；原子级与复合块两条路线分开记。

### 3.5 机制不能回答

伪代码逐行等价；参数值域（块契约只管类型）；常量时间/侧信道/密钥生命周期；未结构化 PDF。

## 4. 条款锚点

### 4.1 数据结构（`metadata.aiHelper.anchors[]`）

| 字段 | 来源 | 例 |
|---|---|---|
| `clauseId` / `entryPath` | 目录/文件名 | `fips180-4-SHA2/02-Padding` / `/docs/standards/…/02-Padding.md` |
| `standard.id/version/source_checked_at` | 抄 manifest | `fips180-4-SHA2` / `FIPS 180-4` / `2026-09-12` |
| `source.path/line_start/line_end`；`pdf.path/sha256` | 条目 `原文证据`/`原文位置`；manifest `artifacts[]` | 652 / null；`NIST.FIPS.180-4.pdf` / `0455b406…` |
| `slice_sha256` | 构建期自算（4.2） | `efea56d9…` |
| `click` / `anchorLevel` | 由 source 派生 / 判定降级 | `{doc,line}` / `line\|heading\|pdf-page\|section` |

### 4.2 证据哈希（钉死语料，失败即失败）

- **切片哈希** `sha256(join(lines[start-1..end],'\n'))`。样例：`fips180-4-SHA2/00-Standard-Source.md` 第 652–720 行 → `efea56d9a3b65930…`（文件 1325 行；652 行原文是 `5.1  Padding the Message`，可反证锚点指对了）。
- **原件哈希**：manifest 66 个 artifact 全有 sha256（PDF/CAVP zip/RFC txt），直接引用。
- **缺口**：`00-Standard-Source.md` **未**登记为 artifact（`extracted-text` 仅 SM2/ZUC 两个 `part1.txt`），切片哈希必须由 A 线自算写进锚点，不能引 manifest。
- **门禁**：语料重生成 → 切片哈希变 → 校验失败 → 构建失败；不自动改写锚点。

### 4.3 应用内「点回原文」（按代码）

| 形态 | 代码路径 | 行为 |
|---|---|---|
| 深链 `#/docs?doc=<path>&line=N` | `DocsView.vue:235 applyDeepLink` → `selectDoc` | 路径须在 `docLoaders`（`import.meta.glob('/docs/**/*.md')`，键带前导 `/`）；`renderMarkdown(content,line)` 在含该行的 token 前插 `<span id="source-line-N">`（`markdown.ts:145,163`），再 `scrollIntoView`（`DocsView.vue:139`） |
| 页内相对链接 `./00-Standard-Source.md#L652` | `DocsView.vue:216` 正则 `^#L(\d+)` | 同文件换行号也会重定位（`watch([doc,line])`，RESULTS §20.1 实测） |
| 只有 `#标题` | `DocsView.vue:212-224` | 滚到小节标题 |
| 仅 PDF 页 | `doc-hit-target.ts` → `{kind:'pdf-reference'}` | 文档中心不渲染 PDF，只给「路径 + 页码」提示/复制 |

结论：锚点优先写**深链**（`click.doc` + `click.line`），不要依赖条目页那行 Markdown——46 条把行号写成散文、9 条只有 PDF 页；深链由锚点数据生成，三种形态都能落地并如实降级。

报告本体在 `metadata.aiHelper`（`coverage` 计数 + `entries[]` 逐条判定/缺口/锚点），应用内由 assistant 面板渲染、每条一个「回原文」按钮；可另存 md 供审阅，但**不写进 `files[]`**。

## 5. 试点：FIPS 180-4 SHA-256 多分组摘要

### 5.1 选型（用读数选）

| 候选 | 条目/行锚点 | 引用该标准的块 | 现有 demo | 结论 |
|---|---|---|---|---|
| **SHA-256 多分组** | 5 / 5 | 3（全是 SHA-224/512 系列，`hash_sha256_*` 两个块无 tooltip 标准号） | 只有**单分组**（`'abc'`=1 块） | **选**：缺的正是 §6.2.2 迭代步，5/5 有锚点、5/5 有映射小节 |
| AES-128 全流程 | 11 / 11 | 4 | 单轮/末轮 | 不选：密钥扩展无块，`proc_aes_key_schedule` 是 10 次空循环 |
| ZUC 密钥流 | 5 / 5 | 5 | EEA3/EIA3 向量 | 不选：`zuc_keystream` 一个复合块覆盖全算法，展示不出条款→块 |
| ML-KEM-768 Encaps | 22 / 22 | 16 | 45 块 demo + 搭建指南 | 不选：超出 1–2 天预算，留作第二条 |

### 5.2 条款清单（5 条）

| clauseId | 定位 | 项目状态（原文） | 判定 | 依据 |
|---|---|---|---|---|
| `01-SHA2` | §6.1–§6.7 | 部分实现 | **不能** | 导航页，无可执行单元（`non-executable`） |
| `02-Padding` | §5.1、§5.2 | 填充路径已映射 | **能搭** | `hash_sha256_pad`（L1+L2）；单/多分组填充都由它完成 |
| `03-MessageExpansion` | §6.2.2 | 仅参考（未映射） | **部分** | 扩展封装在 `compress` 生成器内，无独立块，画布无法逐步核 |
| `04-Compression` | §6.2.2 | 仅参考（未映射） | **部分** | `hash_sha256_compress` 覆盖压缩步；「每组重复」不在块内，正是试点要补的循环 |
| `05-Digest` | §6 | 已覆盖；SHA-512/t 未覆盖 | **部分** | IV/输出用 `lists_create_with` + 变量表达，无专门块 |

计数：**能搭 1 / 部分 3 / 不能 1**。这不是「覆盖差」，而是把仓库现状摊开；`04` 的状态与映射自相矛盾（§2.3），试点正好钉成可复核判定。

### 5.3 工程形态（预计 22–27 块）

| 文件 | 内容 | 块数 |
|---|---|---|
| `algo.sha256.block.json` | `SHA256_Multi(msg)`：`h←8 个 IV`；`padded←pad(msg)`；`n←data_bit_length(padded)/512`；`ctrl_iterate(n)` 内 `h←compress(h, pq_bytes_slice(padded,i*64,i*64+64))`；`return h` | 18–22 |
| `main.block.json` | `msg←"abcdbcde…nopq"`（448-bit 向量）；`digest←SHA256_Multi(msg)`；`print(digest)` | 4–5 |

类型相容（按契约读，不猜）：`pad` 输出 `Bytes`；`pq_bytes_slice` 输入/输出 `Bytes`；`compress` 的 `W` 接受 64-byte 分组；`data_bit_length` 输出 `Number`，除 512 用原生 `math_arithmetic`。

### 5.4 预计缺口（逐条）

1. **缺通用字节切片块**：只有 `pq_bytes_slice`（FIPS 203 的块），跨标准复用要在报告标注；若类型检查拒绝，回流维护者线加通用 `bytes_slice`，本切片不做。
2. **消息扩展无独立块**：`03` 只能 `partial`，无法在画布逐步核（生成器内部实现）。
3. **2^64 比特上限不可执行**：`02` 的填充块不强制该上限（标准要求），判「不能」，报告写明。

### 5.5 验收命令与判据

| 判据 | 命令 | 期望 |
|---|---|---|
| 工程结构/生成/能打开 | 新增 `scripts/verify-project.ts`（复用 `verify-demo.ts` 的 jsdom+Blockly 装载，改调 `generateProjectBundle`）；`node dist-verify/verify-project.js …/sha256-multiblock.project.json --exec` | 每个 `files[].workspace` 逐个 `workspaces.load` 0 诊断；`extractProjectSymbols` errors=[]；两段代码都生成；Python 与 JS 输出同为 `248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1`（附录 B.2 的 448-bit 例） |
| 真实打开 | ProjectRecord 写 IndexedDB → 项目列表打开 → 底部块数 > 0 → 代码面板两段（RESULTS §33 的 CDP 配方） | 肉眼可见 + 0 控制台错误 |
| 既有门禁 | `npm run verify:build` | rc=0（按任务约束不跑 `verify:all`） |

driver/期望值形状复用 `demos/tests.json` 的 `{py:{driver,expect},js:{…}}`，写进 `metadata.aiHelper.tests`，不新造格式。

**试点不证明什么**：块与 FIPS 180-4 伪代码逐行等价；跨语言普适一致（只证明这条向量）；SHA-512/t；「SHA-256 已标准符合」（`PRODUCT-CERTIFICATION-FEASIBILITY.md` 明确整体不是认证对象）。

## 6. 判据与不可判定项

| 结论 | 谁给 | 判据 |
|---|---|---|
| 每个文件能被载入 | 机器 | `workspaces.load` 不抛错 |
| 跨文件符号、重名、能生成 Python/JS | 机器 | `extractProjectSymbols().errors`；`generateProjectBundle()` 非空 + errors=[] |
| 代码在给定输入跑出期望 | 机器 | `verify-project --exec` 比对 stdout |
| 条款→块命中（L1/L2） | 机器 + 语料 | 映射块名 / tooltip 标准号，逐条带出处 |
| 条款分档 | 机器建议 | 3.3 四步全过才 `build` |
| **块与标准语义等价** | **人签核** | 无机器判据；固定 `semantic_equivalence:'unverified'` |
| 参数值域/常量时间/密钥管理 | **人签核** | 标准要求但块模型不表达 |
| 来源是否当前有效版本 | **人签核** | manifest 只记 `source_checked_at` |

对外措辞统一：「覆盖报告说明哪些条款能搭、哪些部分、哪些不能；工程可打开、可生成代码；语义正确性由人签核」。**不写**「已实现标准」「符合标准」「自动生成正确实现」。

## 7. 工作量、第一批与不做

| 批次 | 内容 | 产出 | 预计 |
|---|---|---|---|
| D1 上午 | 锚点抽取器（只读 `docs/standards`，输出 `anchors.json` 含切片哈希） | fips180-4 的 5 条 + 全库 221 条基线 | 3h |
| D1 下午 | 三档判定器（L1/L2/T + typecheck → `verdicts.json`） | 5 条三档 + 证据 | 4h |
| D2 上午 | 手工搭 `algo`/`main`（模板 `proc_sha256_hash` 只给 pad 链，循环手工补） | `sha256-multiblock.project.json` | 4h |
| D2 下午 | `verify-project` + 双语言执行 + 真实浏览器打开 | 一组可复现读数 + 回填本报告 | 4h |

**不做**：任意 PDF 自动切条款；语义等价证明；常量时间检查；新增块类型（缺块记缺口）；A/B 单入口（P5）；多算法批量；接模型；改 `src/`；改语料（39 处矛盾只在报告点名）。

## 8. 风险

| 风险 | 读数 | 处置 |
|---|---|---|
| 语料自相矛盾导致误判 | 39 处状态/映射冲突 | 三档只认 L1/L2/执行证据，逐条带出处；冲突单列「语料待修」 |
| 反向映射覆盖不足 | tooltip 仅 116/222 块引标准号（SHA-2/SM3 为 0） | L3 只作候选，不升级为 `build` |
| 跨标准块复用被类型检查拒 / 锚点哈希随语料失配 | 未实测；目前无切片哈希登记 | 先跑 typecheck，拒了记缺口；哈希自算并门禁硬失败 |
| 缺产品级项目导入 | 现在只有单文件「导入工作区」 | 第一批到 harness + IndexedDB 注入；产品级导入单列工作项 |
| 模板=骨架被误当覆盖 | 29 个里 5 骨架 / 2 部分 | 骨架只能判 `partial` |

## 9. 复现命令（本次实际跑过）

```bash
find docs/standards -type f -name '*.md' | wc -l                  # 337
grep -rl '条目元数据' docs/standards --include='*.md' | wc -l      # 230
find docs/standards -name '*.en.md' | wc -l                       # 25
grep -rl '^## Entry Metadata' docs/standards --include='*.en.md' | wc -l   # 10
python3 - <<'EOF'   # 原文位置 分类 → 230 {'range': 55, 'single': 118, 'heading': 6, 'prose': 46, 'other': 5}
import glob,re
files=[p for p in glob.glob('docs/standards/**/*.md',recursive=True)
       if not p.endswith('.en.md') and '条目元数据' in open(p,encoding='utf-8').read()]
c={'range':0,'single':0,'heading':0,'prose':0,'other':0}
for p in files:
    m=re.search(r'^\| 原文位置 \|\s*(.*?)\s*\|\s*$',open(p,encoding='utf-8').read(),re.M)
    cell=m.group(1) if m else ''
    if re.search(r'#L\d+-L\d+',cell): c['range']+=1
    elif re.search(r'#L\d+',cell): c['single']+=1
    elif re.search(r'\]\(\./[^)]+#[^)]+\)',cell): c['heading']+=1
    elif re.search(r'第\s*\d+\s*行',cell): c['prose']+=1
    else: c['other']+=1
print(len(files),c)
EOF
# 映射小节：182 个有条目映射，其中 73 个点名真实块（同上脚本改判据即可复现）
find demos -name '*.json' | wc -l                                 # 62（60 工作区 + tests/evidence）
```

未做：没有跑 `npm run verify:all`、没有构建、没有改 `src/`、没有提交。
