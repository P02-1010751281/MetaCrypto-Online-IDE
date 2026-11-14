# 规格卡（SpecCard）：把「标准说了什么」变成可机器复核的断言

**适用范围**：`docs/standards/<标准目录>/SPEC-CARD.json`、`spec-runs/<run-id>/manifest.json` 与五条门禁 `npm run spec:validate` / `npm run spec:anchors` / `npm run spec:runs` / `npm run spec:candidates` / `npm run spec:matrix`，以及生成物 [`SPEC-CARD-MATRIX.md`](../standards/SPEC-CARD-MATRIX.md)。
**状态**：v0 骨架 + 三张卡（SP 800-38B CMAC、SP 800-38C CCM、SP 800-38E XTS），12 个锚点全部 `anchor_grade: A`（引文可复核 + PDF 物理页由 `spec:anchors` 逐页重抽取确认）。P0 只固化证据与接口映射、不生成代码；P1 起 `spec:scaffold` 只往 `spec-runs/candidates/` 生成候选骨架，不合并、不改标准文档；候选再由 `spec:candidates` 复核形状、依据、语法、契约与双语言结构对齐。

## 1. 为什么需要它

把标准或论文转成积木与生成器时，最容易出的错不是「不会写算法」，而是三类无法靠读代码发现的错：

1. **锚点编造**：声称「§6.1 写着 K1 = L << 1」，但原文位置是模型编的；
2. **常量幻觉**：S 盒、轮常量、Rb 之类被「补全」成看起来合理但错误的值；
3. **接口漂移**：卡上写的块名或端口类型在仓库里不存在，下游照着做才发现。

这三类错都有共同点：**可以离线、确定性地复核**。SpecCard 就是把这些事实抽出来，让脚本重算，而不是让人或模型自述「我已经核对过」。

## 2. 卡片长什么样

字段契约在 [`scripts/spec-card.schema.json`](../../scripts/spec-card.schema.json)（JSON Schema 2020-12）。最小骨架：

```json
{
  "schema": "ciphercat.spec-card/v0",
  "id": "sp800-38b-cmac",
  "kind": "standard",
  "standard": { "name": "...", "version": "...", "source_url": "https://...", "dir": ".", "artifacts": [{ "path": "...pdf", "sha256": "<64 hex>" }] },
  "anchors": [{ "id": "A1-...", "source": "00-Standard-Source.md", "line_range": [586, 592], "quote": "...", "quote_sha256": "<64 hex>", "anchor_grade": "A", "pdf_pages": [12], "extractor": { "tool": "pdftotext", "version": "..." } }],
  "entries": [{ "key": "sp800-38b.cmac.subkey-generation", "type": "原语", "io": { "inputs": [], "outputs": [] }, "pseudocode": { "fidelity": "text-layer", "anchor": "A1-...", "text": "..." }, "blocks": { "existing": ["cmac_subkeys"] } }],
  "provenance": { "extracted_by": { "kind": "llm", "model": "..." }, "review": { "status": "draft" } }
}
```

卡片放在对应标准目录里（`dir: "."`），好处是锚点、PDF 与拆分页就在同一目录，路径不会漂。标准目录多一个 JSON 不影响 `standards:check`（它只要求 `.pdf`/`.txt` 登记进 manifest）。

## 3. 门禁重算什么（卡片自己说的不算）

`node scripts/check-spec-cards.mjs`（`npm run spec:validate`）：

| 检查 | 规则 | 失败示例 |
|---|---|---|
| 制品哈希 | `standard.artifacts[].sha256` 与磁盘文件逐字节一致 | PDF 换版后哈希变 |
| 引文锚点 | `quote` 规范化空白后必须真的出现在 `source` 的 `line_range` 内 | 行号漂移、引文被改写 |
| 引文摘要 | `quote_sha256` = 规范化引文的 SHA-256 | 有人只改引文不改哈希 |
| 块存在性 | `entries[].blocks.existing` 必须是 `docs/blocks/BLOCK-IO-CONTRACT.json` 里的真实块 | 写了 `cmac_not_a_real_block` |
| 类型标签 | 端口 `type` 必须是契约里实际出现过的 check 标签（或 `Any`） | 自造 `ByteArray` |
| 拆解层级 | `entries[].composes` 只能引用本卡条目，子级 `level` 必须严格更低，引用无环 | 让 L2 过程直接包含另一个 L2，或写成环 |
| 结构化 | 按 schema 严格校验；未声明的字段直接报错 | 加了 schema 没有的键 |

还有三条纪律：

- **`fidelity` 三档**：`verbatim`（与锚点引文逐字一致）、`text-layer`（与文本层一致，但文本层本身有已知失真，必须列 `known_defects`）、`paraphrase`（项目改写，只能当导航，不能进证据层）。前两档要求 `text` 与锚点引文规范化后完全相等。
- **`anchor_grade` 阶梯**：`A` = 行级引文可复核 **且** PDF 物理页由 `spec:anchors` 逐页重抽取确认（所以 A 必须给 `pdf_pages`，且页码要与提取稿换页位置一致）；`B` = 行级引文可复核但 PDF 页未核；`C` = 仅章节级定位。核对对象是文本层，不替代人工目视版式（见 §8）。
- **粒度阶梯（`level`）**：`L0` 运算/字面量、`L1` 原语块、`L2` 过程、`L3` 算法、`L4` 族/模式。声明 `composes` 的条目必须同时声明 `level`，子级必须严格更低且整体无环——这是「小块拼中块、中块拼大块」能被机器判定的前提（见调研报告 §4.3.1）。

门禁每轮都会跑**负控自检**：对首张卡做 12 种变异（改引文、改哈希、越界行号、把 B 标成 A、改制品哈希、verbatim 文本不符、写不存在的块、reviewed 却没签核人、composes 指向不存在的条目、自引用、子级层级不低于父级、composes 成环），每一种都必须让门禁变红。自检不过即视为门禁失效——自己不能开火的门禁不算门禁。

```
$ npm run spec:validate
SPEC_CARD_SELFTEST controls=12 fired=12
SPEC_CARD_SUMMARY cards=3 anchors=12 entries=11 artifacts=3 errors=0
```

## 4. 已落地的三张卡：CMAC 首例与 CCM/XTS 补卡

[`docs/standards/sp800-38b-cmac/SPEC-CARD.json`](../standards/sp800-38b-cmac/SPEC-CARD.json) 固化了 §6.1 子密钥生成与 §6.2 MAC 生成两块：2 个锚点（行 586–592、636–644）、2 个条目、1 个制品哈希，条目分别映射到 `cmac_subkeys`/`cmac_double` 与 `cmac_mac`；两张条目按粒度阶梯标了级——`cmac_subkeys` 是 `L1` 原语，`cmac_mac` 是 `L2` 过程并通过 `composes` 声明它由前者拼成。

它同时示范了**不装懂**：

- 两个锚点都是 `fidelity: text-layer` 且带 `known_defects`：提取稿把 `CIPH_K(0^b)` 拉平成 `CIPHK(0b)`，把 `n = ⌈Mlen/b⌉` 的 ceiling 括号丢了，还把脚注号混进正文；
- `Rb = 0x87` 没有逐字锚点（文本层把 `R128` 渲染成 `012010000111`），因此写进 `open_questions` 而不是硬凑一个；
- `cmac_mac` 的 `vectors.status` 已从 `missing` 改为 `wired`：RFC 4493 §4 的 0/16/40/64 字节四条向量由 `demos/procedures/CMAC-AES.json` 经 `verify:demos` 双语言执行；`cmac_subkeys` 也已从 `partial` 改为 `wired`——同一工作区新增的 `CMAC_SUBKEYS` 过程执行同节 K1‖K2，`tests/unit/demo-vector-crosscheck.test.ts` 另用 `cryptography` 独立复算该子密钥；
- `review.status: draft`：语义（位宽、端序、Rb 取值）还没有具名密码学审阅者签核——`decision: gated` 不等于签核。

同一快照（`spec-runs/2026-11-13-ccm-xts-extract`）又写了两张卡，用来检验「一次运行能产出几张」，也检验卡片契约在**没有本地算法原文**时会不会装懂：

| 卡 | 锚点 / 条目 | 标准文本能证明什么 | 不能证明什么 |
|---|---|---|---|
| [SP 800-38C CCM](../standards/sp800-38c-ccm/SPEC-CARD.json) | 7 / 7 | §6.1 generation-encryption 的 8 个步骤（含 PDF 页码混入、上标拉平等 `known_defects`）、§6.2 decryption-verification 的 10 个步骤、A.2.1 的 B0 位域、A.2.2 的长度编码三档、A.3 的计数器块格式 | 七条条目现均由同一工作区的过程逐块执行（`vectors.status=wired`），但只覆盖 Example 1/2 的参数与 Example 1 的中间值；不覆盖全部 nonce/tag 长度组合，且 §6.2 的 INVALID 只表达为抛错，不含标准的 MaxErrs 计数与密钥退役策略 |
| [SP 800-38E XTS](../standards/sp800-38e-xts/SPEC-CARD.json) | 3 / 2 | §3 的 XEX + ciphertext stealing 定义、§4 的 2^20 个 AES 块上限、§5 的最后完整块/部分块排序约定 | **标准本身不含 XTS-AES-Enc 的算法步骤**：§3 把算法委托给 IEEE Std 1619-2007，仓库未分发该付费文档，因此两条目只能是 `fidelity=paraphrase` 的项目实现摘要；`xts_tweak_mul` 虽已由工作区过程执行，仍只是项目实现，不是标准原文证据 |

XTS 这张卡的重点就是「不装懂」：它把「本地没有算法原文」写进 `limits` 与 `open_questions`，而不是把项目实现冒充逐字引文。两张卡落地的同一轮、同一快照里，六条原语的 `vectors.status` 从 `partial` 接成 `wired`（复用 `CCM-Encrypt.json` 与 `XTS-Encrypt.json`，新增六个过程，不新增工作区），`spec:plan` 由 `gaps=6` 变为 `cards=3 gaps=0`。

## 5. 一次运行改了什么：运行清单

卡片证明「标准写了什么」，但证明不了「这份卡片是哪次运行、读了哪些字节、门禁当时退没退 0」。补齐它的是运行清单 `spec-runs/<run-id>/manifest.json`（契约见 [`scripts/spec-run.schema.json`](../../scripts/spec-run.schema.json)），门禁 `npm run spec:runs`。

```json
{
  "run_id": "2026-11-13-cmac-extract",
  "inputs": [{ "path": "docs/standards/sp800-38b-cmac/NIST.SP.800-38B.pdf", "sha256": "<64 hex>", "role": "standard-source" }],
  "extractor": { "tool": "pdftotext -layout", "version": "未记录（…）" },
  "outputs": [{ "path": "docs/standards/sp800-38b-cmac/SPEC-CARD.json" }],
  "shared": [{ "path": "demos/tests.json" }],
  "gates": [{ "cmd": "npm run verify:all", "exit": 0, "summary": "DEMO_SUMMARY total=60 pass=60 fail=0" }],
  "decision": "gated"
}
```

`node scripts/check-spec-runs.mjs` 只重算确定性的部分：

| 检查 | 规则 |
|---|---|
| `run_id` | 必须等于目录名（清单被复制到别处就红） |
| 输入哈希 | `inputs[].sha256` 与磁盘逐字节一致；产出与共享文件只检查存在 |
| 记账唯一 | 同一路径不得同时出现在 `inputs`/`outputs`/`shared` |
| 门禁名真实 | `gates[].cmd` 必须是 `package.json` 里存在的脚本，或仓库内已存在的脚本 |
| 决策自洽 | `gated` 要求至少一次门禁且全为 0；`halted`/`rejected` 要求至少一次非 0 |
| 结构 | schema 严格校验，未声明字段直接报错 |

四条设计取舍，前三条是被上一轮修正过的：

1. **只冻结输入**：源 PDF / 文本层写哈希——源变了，这次运行的结论不再成立。产出一律只列路径：SpecCard 与 Demo 工作区会被后续评审改写，冻结它们的哈希会让每次正常修订都把历史清单拖红，最后只能靠「顺手改哈希」绕过，等于没有证据。
2. **哈希不重复存**：源 PDF 与文本层的摘要已经写在卡片的 `standard.artifacts[].sha256` 与 `anchors[].quote_sha256` 里；清单里再存一份就会两处漂移。
3. **共享文件只列路径**：`demos/tests.json`、`demos/evidence.json` 这类登记文件会被后续每个 Demo 改动。若把它们也哈希进清单，加第 61 个 Demo 就会把所有历史清单拖红。它们的一致性由 `spec:validate`、`verify:all` 自己保证。
4. **没调用模型就不写 `model`**：离线模板路径整段省略，`provider: offline` 一类占位值会被门禁判红；`prompt_sha256` 只在提示词真的归档后出现。

```
$ npm run spec:runs
SPEC_RUN_SELFTEST controls=10 fired=10
SPEC_RUN_SUMMARY runs=4 inputs=14 outputs=10 shared=24 gates=10 decision=gated errors=0
```

第三个清单 `2026-11-13-ccm-xts-wiring` 是同一批卡的接线运行：输入仍是那两份文本层，产出换成两个 Demo 工作区——提取与接线分开记账，谁改了什么不会混在一次运行里。

第四个清单 `2026-11-13-anchor-pages` 记的是锚点页签核这一轮：输入同时冻结三份文本层与三份 PDF（`spec:anchors` 用它们重算页码），产出是三条回填 `pdf_pages` 后的卡片与 `scripts/check-spec-anchors.mjs`。

**它不能证明什么**：清单里的 `exit: 0` 是声明的证据基础，脚本只能保证清单内部自洽、且它引用的字节还在磁盘上；它不证明那条命令真的跑过。这一点与 `demos/evidence.json` 同性质，不要拿 `decision: gated` 越过 §6 的边界去声称「正确」「安全」或「已签核」。

## 6. 它不能用来声称什么

- 不能声称「AI 已核对标准」——门禁只复核**卡片写下的字**，不复核人对规范的理解；
- 不能声称「实现符合标准」或「通过认证」——`vectors.status=wired` 只表示有回归入口接在 Demo 或单测上，`partial` 表示只有一侧证据；它既不是官方向量覆盖证明，也不是完整测试集；
- `anchor_grade: C` 只是定位，不是引文证据；`fidelity: paraphrase` 只是导航，不能当原文；
- `anchor_grade: A` 只说明「这段引文出现在 PDF 这一页」，不说明「这一页就是标准第几节」；页签核是文本层重抽取，不是人工目视版式，也不覆盖扫描件与字形失真；
- 卡片不替代 `docs/standards` 的条目元数据表，也不替代 `verify:all` 的向量回归。

## 7. 生产者入口：`spec:plan`、`spec:scaffold` 与 `spec:candidates`

P0 只做证据层。要把「卡片」变成「真能开工的候选」，需要三个入口，各自只做一件事。

### 7.1 `spec:plan`：只读地把缺口算成工作项

```bash
npm run spec:plan -- sp800-38b-cmac     # 单张卡
npm run spec:plan -- --all --json       # 全部卡，机器可读
```

```text
SPEC_PLAN card=sp800-38b-cmac entries=2 anchors=2 registered=4 unregistered=0 planned=0 vectors_open=0 anchors_open=0 gaps=0
SPEC_PLAN_SUMMARY cards=1 gaps=0
```

存在缺口时每条另起一行：`  GAP <kind> <entry key> (<detail>)`（例：把某条的 `vectors.status` 改回 `partial` 再跑）。

四类缺口：

| kind | 含义 | 去处 |
| --- | --- | --- |
| `register-block` | 条目引用的积木不在 `BLOCK-IO-CONTRACT.json` | 卡片与代码脱节，先修一侧 |
| `implement-block` | 条目 `blocks.planned` 里的积木 | 走 `spec:scaffold` |
| `wire-vectors` | `vectors.status` 不是 `wired` | 接官方向量并改卡片 |
| `refine-anchor` | 锚点缺 `quote_sha256` 或 `line_range` | 回原文补证据 |

「已注册积木」以 `docs/blocks/BLOCK-IO-CONTRACT.json` 的键为准：它由 `npm run block-io:write` 从真实块定义生成，`verify:all` 校验它与代码一致。缺口不是错误，脚本退出码恒为 0；它只把「差什么」摆出来。

### 7.2 `spec:scaffold`：只往候选目录写

```bash
npm run spec:scaffold -- sp800-38b-cmac --block cmac_mac
npm run spec:scaffold -- --selftest          # 5 条控制：4 条拒绝 + 1 条产出
```

四道硬前提，缺一条就拒绝产出候选：

1. 卡片存在且能解析；
2. 目标积木出现在该卡片的 `entries[].blocks`（`existing` 或 `planned`）里——不许凭算法名随手生成；
3. 输出目录在 `spec-runs/candidates/` 内（`--skip-gates` 只允许 `.selftest` 子目录）；
4. `npm run spec:validate` 与 `npm run spec:runs` 都 exit 0。

产物固定 5 个：`plan.json`、`block.ts`、`generator.python.ts`、`generator.javascript.ts`、`REVIEW-PACKET.md`。积木骨架按契约的输入类型（Blockly 的 VALUE / STATEMENT / DUMMY）、`getCheck()` 与字段类生成，填充物一律留成 `TODO`。

**边界**：不写 `src/`、不改 `docs/standards` 的证据页、不合并、不调用模型。候选目录同时被 `.gitignore` 与 ESLint 排除——它是产物不是源码，这不是放宽 lint 规则。契约只能给出 `getCheck()`，无法区分「无连接」与「任意类型」，所以语句连接必须人工确认，这条写进了审核包第 2 条。

### 7.3 `spec:candidates`：候选的三层验证

```bash
npm run spec:candidates              # 扫描全部候选目录并跑 16 条自检控制
npm run spec:candidates -- --json    # 机器可读
```

候选产出时门禁是绿的，但产出之后依据可能漂移、骨架可能被改坏、两个生成器可能指向不同的块。这条门禁逐目录重算五件事：

| 层 | 重算什么 | 失败示例 |
| --- | --- | --- |
| 形状 | `plan.json` 可解析、schema 正确、5 个必备文件齐、`files` 清单与磁盘一致、目录名 = `<card>-<block>` | 手工删了 `REVIEW-PACKET.md` |
| 依据仍在 | 卡片与条目仍存在、条目的 `blocks.existing/planned` 仍含该块、`level`/`normative_level` 与卡片一致、`contract` 标记与契约自洽 | 卡片改了条目 key，候选成孤儿 |
| 语法与注册 | 三个 TS 文件通过 TypeScript 语法解析；import 只来自 `blockly/core`、`blockly/javascript`、`blockly/python`（不得用 `@/` 别名）；`Blockly.Blocks[...]` 与两个 `forBlock[...]` 的键都等于 `plan.block` | 生成器注册成了别的块名 |
| 契约一致 | `appendValueInput(...).setCheck([...])`、`setOutput(true, [...])` 与 `BLOCK-IO-CONTRACT.json` 的 `check`/`outputCheck` 逐项相同 | 把 `Bytes` 写成 `Number` |
| 双语言对齐 | 只在候选去掉 `TODO(候选)` 之后判定：两个生成器读取的输入与字段集合必须相同，且输入名都在契约里 | JavaScript 读 `MSG`，Python 只读 `KEY` |

```text
$ npm run spec:candidates
SPEC_CANDIDATE_SELFTEST controls=16 fired=16
SPEC_CANDIDATE_SUMMARY candidates=1 shape_ok=1 parse_ok=1 parity_ok=0 parity_stub=1 vectors_wired=0 vectors_pending=1 errors=0
```

自检是 16 条控制：2 条正控（未变异副本、已实现形态）必须通过，14 条负控（删文件、坏 JSON、改 schema、改卡名或条目、积木漂移、清单缺项、语法错、`setCheck`/`setOutput` 与契约不符、生成器注册错块、`@/` 别名、契约标记反了、去掉 TODO 却不读输入）必须各自变红。正控不是形式：只有负控的话，「parity 永远失败」或「vectors 永远 pending」的坏实现会被一片全绿掩盖。

**一处失败关闭的取舍**：契约一致按候选骨架的链式写法解析（`appendValueInput(...).setCheck([...])`、`setOutput(true, [...])`）。手写实现若换成别的写法（例如先建局部变量再设 check），会被判「未在 block.ts 里声明」而不是静默通过——先改回可解析的写法或同步改检查，不要让门禁猜。

**它不能证明什么**：候选不在 `src/` 注册链里，跑不了 Blockly 生成，所以本门禁不证明双语言**输出**相同，也不证明候选实现了算法——仍是 TODO 骨架时 `parity` 记为 `stub`、汇总里计 `pending`，不算 verified；`vectors=card-wired` 只表示卡片声明了回归入口，不表示候选代码通过了那个向量。真正的输出等价与向量执行，要等候选并入 `src/` 后由单测与 `verify:demos` 完成。

## 8. 锚点的 PDF 页签核：`spec:anchors`

`pdf_pages` 曾经是卡片里唯一「人手填、没有任何脚本复核」的字段：`spec:validate` 只要求 `anchor_grade=A` 时它非空，填哪一页都不会红。现在由 `node scripts/check-spec-anchors.mjs`（`npm run spec:anchors`）重算。

```bash
npm run spec:anchors              # 校验 + 11 条自检控制
npm run spec:anchors -- --write   # 先核验再按提取稿回填 pdf_pages
npm run spec:anchors -- --debug   # 逐条打印控制项实际触发的原因
```

它重算三层：

| 层 | 重算什么 | 失败示例 |
| --- | --- | --- |
| 提取稿换页位置 | `00-Standard-Source.md` 里保留着 `-layout` 的换页符（`\f`），锚点 `line_range` 首行/末行落在第几页是确定的；`pdf_pages` 必须与这个区间逐页相同 | 引文只在第 12 页，卡上写成 `[13]` 或 `[12,13]` |
| PDF 真实页内容 | 用 `pdftotext -layout` 逐页重抽取同目录 PDF，把 `pdf_pages` 所列各页按顺序拼接后必须真的包含 `quote` | 引文被改写、提取稿与 PDF 漂移、页码填错 |
| 页存在性 | `pdf_pages` 必须是整数、从 1 起、严格递增且不超过 PDF 页数 | 写 `["12"]`、写 `[22]`（PDF 只有 21 页） |

```text
$ npm run spec:anchors
SPEC_ANCHOR card=sp800-38b-cmac anchors=2 grade_a=2 verified=2 pages=12,13 errors=0
SPEC_ANCHOR card=sp800-38c-ccm anchors=6 grade_a=6 verified=6 pages=15,16,19,20 errors=0
SPEC_ANCHOR card=sp800-38e-xts anchors=3 grade_a=3 verified=3 pages=9,10,11 errors=0
SPEC_ANCHOR_SELFTEST controls=11 fired=11
SPEC_ANCHOR_SUMMARY cards=3 anchors=12 grade_a=12 verified=12 pages=9 tool=pdftotext/26.10.0 errors=0
```

12 个锚点现全为 `anchor_grade: A`：CMAC §6.1/§6.2 在物理第 12/13 页；CCM 七个锚点在 15/16/19/20 页（其中 `A1-encrypt-steps` 跨 15–16 页，按相邻两页拼接后匹配，`A2-decrypt-steps` 的 §6.2 步骤在 16 页）；XTS 三个锚点在 9/10/11 页。

**`anchor_grade: A` 现在的含义**：行级引文可复核，且 PDF 物理页由这条门禁逐页重抽取确认。它**不是**人工目视版式——核对对象是文本层，扫描件或字形失真仍由 `anchors[].known_defects` 记录，也不证明「这一页就是标准第几节」。

**11 条自检控制**：1 条正控（未变异副本必须通过）+ 10 条负控（缺 `pdf_pages`、页码非整数、超出 PDF 页数、顺序颠倒、重复页、多报一页、页码错页、行号漂移到相邻页、PDF 不在、卡片没有 PDF 制品），每条都必须按预期原因变红——`--debug` 会打印它实际命中的那句错误。

**依赖**：poppler-utils 的 `pdftotext`（`-layout`）。缺工具时 fail closed 并给出安装提示，不静默跳过：核对不了页码就不该给出绿。CI 的 `verify:all` 前会先 `apt-get install poppler-utils`。

**它不能证明什么**：只证明「这段引文出现在这一页」。位宽/端序/Rb 之类的语义签核仍看 `provenance.review`——三张卡目前都是 `draft`，没有具名密码学审阅者签核。

## 9. 对照表：`spec:matrix`

卡片声明「`vectors.status: wired`」，但「这条标准义务到底被哪个工作区、哪个过程执行过」原先只写在 `vectors.detail` 的散文里。散文既不能被复核，也不能被比对。`npm run spec:matrix` 把这句话变成生成物 [`SPEC-CARD-MATRIX.md`](../standards/SPEC-CARD-MATRIX.md)，只做确定性连接：

| 连接 | 判定方式 | 数据来源 |
|---|---|---|
| 条目 → 声明积木 | 直接取卡片 `entries[].blocks.existing` | 三张 `SPEC-CARD.json` |
| 积木 → 工作区 | 把 `demos/tests.json` 登记的 60 个工作区拆成扁平 IR 后，看该工作区是否同时含该条目的全部声明积木 | `demos/**/*.json` + `scripts/lib/block-ir.mjs` |
| 积木 → 执行过程 | 过程体的块树里真的出现该积木（按块包含关系，不按过程名相似） | 同上 |
| 卡片 → 冻结运行 | `spec-runs/<run-id>/manifest.json` 的 `outputs` 里含该卡片路径 | `spec-runs/` |
| 积木是否存在 | 以 `BLOCK-IO-CONTRACT.json` 的键为准 | 由真实块定义生成 |

`npm run spec:matrix:write` 写盘，`npm run spec:matrix`（已并入 `verify:all`）重新生成并逐字节比对，手工改动直接失败。脚本自带 7 条负控：改 `vectors.status`、塞入不存在的积木、把 A 级锚点降为 B、删一个 Demo、清空全部过程、清空运行清单、倒置 `composes` 粒度——每条都必须让输出变化，否则视为该连接失效。

它现在暴露出的差集（写进表里，不抹平）：

- `cmac_subkeys` 条目声明了 `cmac_subkeys` 与 `cmac_double` 两个积木，但没有任何登记工作区同时含这两块——`cmac_double` 只由 `tests/unit/cmac-xts-primitives-contract.test.ts` 直接驱动，Demo 的 `CMAC_SUBKEYS` 过程用的是 `cmac_subkeys` 块；
- 因此该条目的「工作区覆盖」显示为「无」，而「执行过程」仍是 `CMAC_SUBKEYS`。这正是卡片的声明粒度与 Demo 的工作区粒度不吻合的地方：补一个最小工作区还是调整声明，属于要人来定的取舍，不是脚本能替它裁定的。

**它不能证明什么**：不判定条目实现是否符合标准语义、不判定 Demo 期望值是否来自官方测试集、不替代锚点签核。它只回答「有没有人执行过、在哪执行」。

## 10. 下一步

1. ~~按同一契约补 CCM（SP 800-38C）与 XTS（SP 800-38E）两张卡，检验「一个快照能写几张」~~ ——已由 `spec-runs/2026-11-13-ccm-xts-extract` 一次产出两张卡：3 卡 / 11 锚点 / 10 条目 / 0 错误；`spec:plan` 现报 6 条 `wire-vectors`（CCM 五条原语 + `xts_tweak_mul`），即下一步的接线清单；
2. ~~给 `cmac_subkeys` 接官方向量，把该条的 `vectors.status` 从 `partial` 改成 `wired`~~ ——已由 `CMAC_SUBKEYS` 过程接入 `verify:demos`，并用 `cryptography` 独立复算子密钥；下一步是给它单独建一个最小工作区，或接入 ACVP 级用例；
3. ~~让门禁在写候选前先跑 `spec:validate` 与 `spec:runs`~~ ——已由 `spec:scaffold` 内置（见 §7.2 第 4 条）。三段验证的第一段已由 `spec:candidates` 落地（见 §7.3）：形状、依据漂移、TypeScript 语法、契约一致性、双语言**结构**对齐，16 条自检控制。**仍缺**的是候选上的双语言**输出**等价与卡片锚点向量执行——两者都要求候选先并入 `src/` 注册链，`type-check`/`lint` 同理；在此之前只能按 `parity=stub` 记账，不能把候选说成已验证；
4. ~~按 `spec:plan` 的 6 条 `wire-vectors` 缺口，把 CCM 五条原语与 `xts_tweak_mul` 接进最小工作区~~ ——已复用 `CCM-Encrypt.json` 与 `XTS-Encrypt.json` 新增六个过程（不新增工作区，避免 Demo 计数连锁）：CCM 的 B0/AAD 长度前缀/计数器块/CBC-MAC/CTR 按 Example 1 参数逐块核对，XTS 的 α 加倍核对最高位进位；`spec:plan` 现为 `cards=3 gaps=0`，无 Demo 直接引用的块从 94 降到 88。若某条确实无法离线复核（如 IEEE 1619 向量），仍应在卡片的 `limits` 写明理由而不是把状态改成 `wired`。
5. ~~让 `anchor_grade: A` 有可复核的 PDF 页记录~~ ——已由 `spec:anchors` 落地（见 §8）：12 个锚点的 `pdf_pages` 由提取稿换页位置回填、并经 PDF 逐页重抽取核验，11 条控制全开火。**仍缺**的是语义签核：三张卡的 `provenance.review` 都是 `draft`，位宽/端序/`Rb`/B0 位域这些判断还没有具名密码学审阅者签字——这一层不是脚本能替代的。

---

相关：[AI Helper 调研（SpecCard 与门禁的设计依据）](../research/AI-HELPER-RESEARCH-2026-11-13.md)、[积木 I/O 契约](../blocks/BLOCK-IO-CONTRACT.json)、[结构化条目规范](../standards/STRUCTURED-ENTRY-SCHEMA.md)。
