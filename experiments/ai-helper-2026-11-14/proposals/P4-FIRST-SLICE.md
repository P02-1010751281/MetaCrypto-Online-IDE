# P4 第一条纵向切片：FIPS 180-4 → 可打开的 SHA-256 多分组 project

> 2026-11-17　状态：切片已跑通（四段都有真实输出）　依据：`proposals/P4-SCOPE.md`、`RESULTS.md` §37–§46
> 纪律：没改 `src/blocks/**`、`src/generators/**`；没跑 `verify:all`；没做任何 git 操作。
> 所有数字都是本机实跑，命令在 §7。产物在 `experiments/ai-helper-2026-11-14/p4/`。

## 0. 结论速览

| 段 | 产出 | 实测 |
|---|---|---|
| 1 锚点抽取器 | `scripts/p4-anchors.mjs` → `p4/anchors.json` | 5 个条目、**14** 个条款单元、**14/14 可点**（`#L` 行区间）、节级 0、声明锚点对账 0 处落空、**2** 处声明落在错的小节 |
| 2 三档判定器 | `scripts/p4-verdicts.ts` → `p4/verdicts.json` | 5 条条款：**能搭 1 / 部分 3 / 不能 1**；证据层 L1 5、L2 0、L3 0；缺口 11 条 |
| 3 试点工程 | `p4/build-project.py` → `p4/project/` | **33 块**（28 + 5）、**2 个 block 文件** + 1 个 `ProjectRecord`、12 种块类型、`entryFileId=file-main` |
| 4 verify-project | `scripts/verify-project.ts` → `p4/verify-project-readings.json` | Python **PASS**、JS **PASS**，均为 `248d6a61…19db06c1`；单分组阴性对照双语言 **PASS**（`85e655d6…` ≠ 期望） |

一句话：A 线从「标准条目」到「能打开、能生成、跑得动官方向量」的链路第一次闭合，且**多分组**这一段是新增覆盖
（现有 demo 只覆盖单分组 `'abc'`）。语义等价仍是 `unverified`，交人签核。

## 1. 锚点抽取器（第 1 段）

### 1.1 口径

- 只做 `docs/standards/fips180-4-SHA2/` 的 5 个结构化条目页（`01-SHA2` … `05-Digest`），不铺全语料。
- **条款单元 = 条目「标准定位」里的每个 § 号**；`§6.1–§6.7` 这类区间按同级编号展开。
- 每个 § 解析成 `#L` 行区间：起点 = 源文件里的小节标题行；终点 = 下一个「层级不深于它」的标题行 − 1。
  标题解析要剥分页控制符 `\f`、允许章号后的点（`6.        SECURE HASH ALGORITHMS`）、允许单空格
  （`6.2.2 SHA-256 Hash Computation`），并排除目录点线与正文里的编号步骤（带冒号/花括号、缩进行）。
- 切片哈希 `sha256(join(lines[start−1..end], '\n'))` 钉死语料；**不读 `项目状态` 字段**。

### 1.2 读数

| 项 | 值 |
|---|---|
| 条目页 | 5 |
| 「原文位置」里的锚点链接 | 8（单行 7 + 区间 1） |
| 条款单元 | 14（去重后 12 个 §：5.1、5.2、6、6.1–6.7、6.2.2、6.4.2） |
| 可点（唯一行区间） | **14 / 14** |
| 只有节级锚点 | **0**（本片全部解析到唯一标题行；语料全库的 9 条无行锚点不在本片范围，口径见 P4-SCOPE §2.2） |
| 声明锚点与标题行不符 | 0 |
| 声明锚点落在非本条目小节 | **2**（见 1.4） |
| 源文件 | `00-Standard-Source.md`，1325 行，`sha256=58d09d35…6db6cd` |
| 原件 | `NIST.FIPS.180-4.pdf` `0455b406d896…`；`vectors/shabytetestvectors.zip` `929ef80b7b34…` |

14 个条款单元（`p4/anchors.json` 里带 `click` 与 `slice_sha256`）：

| 条款单元 | § | 行区间 | 起始标题 | 切片哈希前 10 位 |
|---|---|---|---|---:|
| `01-SHA2#§6.1` | §6.1 | 886–1028 | SHA-1 | `82fe60e32d` |
| `01-SHA2#§6.2` | §6.2 | 1029–1115 | SHA-256 | `8f6fd95b07` |
| `01-SHA2#§6.3` | §6.3 | 1116–1129 | SHA-224 | `edfd26bf8c` |
| `01-SHA2#§6.4` | §6.4 | 1130–1215 | SHA-512 | `89f1335d02` |
| `01-SHA2#§6.5` | §6.5 | 1216–1226 | SHA-384 | `fb78460d0f` |
| `01-SHA2#§6.6` | §6.6 | 1227–1236 | SHA-512/224 | `cf6d919f12` |
| `01-SHA2#§6.7` | §6.7 | 1237–1250 | SHA-512/256 | `171349d205` |
| `02-Padding#§5.1` | §5.1 | 652–692 | Padding the Message | `77d65407b9` |
| `02-Padding#§5.2` | §5.2 | 693–707 | Parsing the Message | `32e1e6da01` |
| `03-MessageExpansion#§6.2.2` | §6.2.2 | 1052–1115 | SHA-256 Hash Computation | `2517ea9090` |
| `03-MessageExpansion#§6.4.2` | §6.4.2 | 1148–1215 | SHA-512 Hash Computation | `04cb533da9` |
| `04-Compression#§6.2.2` | §6.2.2 | 1052–1115 | SHA-256 Hash Computation | `2517ea9090` |
| `04-Compression#§6.4.2` | §6.4.2 | 1148–1215 | SHA-512 Hash Computation | `04cb533da9` |
| `05-Digest#§6` | §6 | 874–1250 | SECURE HASH ALGORITHMS | `33c1ef2c2c` |

### 1.3 为什么本片 100% 可点，而全库只有 221/230

两类读数不是同一口径：`221/230` 是**条目级**「页内有没有 `#L`」，本片是**条款级**「这个 § 在提取稿里有没有
唯一标题行」。FIPS 180-4 的 `00-Standard-Source.md` 保留了原文小节标题，所以 14 个 § 全部能落到唯一行区间；
`05-Digest` 的 `§6` 一开始找不到同名标题（提取稿的章标题是 `6. SECURE HASH ALGORITHMS`），修掉标题解析的
`\f` 与控制符问题后也解析到了 874 行——**这不是放宽，而是原先漏了行**。

### 1.4 抓到的两处语料问题（只记录，不改语料）

| 条目 | 声明 | 实际落在 | 影响 |
|---|---|---|---|
| `03-MessageExpansion` | SHA-512：第 1142 行 | `6.4.1 SHA-512 Preprocessing` | 指向「预处理」而不是「哈希计算」，应为 1148 |
| `04-Compression` | SHA-512：第 1142 行 | 同上 | 同上 |

`01-SHA2` 与 `02-Padding` 的声明起点与解析到的节标题逐字相同（886 = §6.1、652 = §5.1）；`05-Digest` 声明的是
§6 下的两个子节起点（1029 = §6.2、1130 = §6.4），都落在 §6 的跨度（874–1250）内。

## 2. 三档判定器（第 2 段）

### 2.1 规则（脚本里可查，`p4/verdicts.json.rules`）

1. **不读「项目状态」**：脚本只读条目页的「标准定位」「项目映射」、块 tooltip 与 BM25 候选；状态字段连解析都不做。
2. 三级证据：**L1** = 「项目映射」里反引号点到的真实块（认 `` `hash_sha256_compress(V, W)` `` 这种带签名写法）；
   **L2** = tooltip 引 `FIPS 180-4` 且该块出现在同一查询的前 5 个 BM25 候选里；**L3** = `block-search` BM25 前 5。
   L3 只作候选，永不单独升级档位。
3. 档位由**步骤表**算：每步标 `canvas`（画布上可见的块/块组合）、`internal`（只在生成器闭包里）或 `none`（没有块）。
   全 canvas → `build`；全 none 或不可执行 → `missing`；其余 → `partial`。步骤表是人工语义分解（依据条目页的
   「标准定义」「公式或伪代码」），**档位是机器按规则算的**，不是手写结论。

### 2.2 五条判定

| 条款 | 判定 | 证据层 | 步骤（canvas/总） | L1 点名的块 | 缺口数 |
|---|---|---|---|---:|---:|
| `01-SHA2`（§6.1–§6.7） | **不能** | L1 | 0 / 1 | `hash_sha256_pad`、`hash_sha256_compress`、`hash_sha224_hash`、`hash_sha512_hash` | 1 |
| `02-Padding`（§5.1、§5.2） | **能搭** | L1 | **4 / 4** | `hash_sha256_pad`、`hash_sha256_pad_text`、`hash_sha256_pad_hex`、`hash_sha512_pad` | 0 |
| `03-MessageExpansion`（§6.2.2、§6.4.2） | 部分 | L1 | 0 / 2 | `hash_sha256_compress`、`hash_sha512_compress` | 3 |
| `04-Compression`（§6.2.2、§6.4.2） | 部分 | L1 | 1 / 4 | `hash_sha256_compress`、`hash_sha224_hash` | 4 |
| `05-Digest`（§6） | 部分 | L1 | 1 / 3 | `hash_sha224_hash`、`hash_sha512_hash` | 3 |

计数：**能搭 1 / 部分 3 / 不能 1**，与 P4-SCOPE §5.2 完全一致。

`01` 判「不能」的理由是 `non-executable`：条目页自己写着「没有独立归属的公式或伪代码规范单元」，是导航页。
它的 L1 命中照样记录（4 个块），但**有块不等于有可执行条款**——这正是三档与「有没有映射」的区别。

### 2.3 证据层的实际覆盖（这是本轮最该被 owner 看到的一条）

| 层 | 覆盖条款 | 说明 |
|---|---|---|
| L1（映射） | **5 / 5** | 五个条目都有「项目映射」小节且点名真实块 |
| L2（tooltip 引标准号） | 0 条独立成立 | 222 个块里只有 **3** 个 tooltip 提到 FIPS 180-4：`hash_sha224_hash`、`hash_sha512_hash`、`hash_sha512_pad`；**没有任何 SHA-256 的 pad/compress 块** |
| L2 同变体命中 | **0** | `sameVariant` 全部为 false（命中的是 224/512 的块），对 SHA-256 条款等于没有 |
| L3（BM25） | 0 条独立成立 | `04` 的 top1 就是 `hash_sha256_compress`（76.46，有效）；`02` 前三名是三个 SHA-256 pad 块（有效，后两名是 SHA-512/SHA-3 pad 噪声）；`03` 的 top5 却是 `hash_hmac`/`pbkdf2`（噪声）——同一条流水线既能命中也能跑偏，所以 L3 只能作候选 |

结论：对本标准，**L2 不能替代 L1**；`项目映射` 写没写块名直接决定判定能否做。这与 P4-SCOPE §2.3
「tooltip 只覆盖 116/222」同源，但把它推到了更硬的说法：在 SHA-256 这条路径上是 0。

## 3. 试点工程（第 3 段）

### 3.1 文件与角色

| 文件 | 角色 | 块数 |
|---|---|---:|
| `project/algo.sha256.block.json` | procedure `SHA256_Multiblock(msg)`：填充 → 算分组数 → 分组迭代 → 返回链状态 | 28 |
| `project/main.block.json` | entry 顶层演示：B.2 消息字面量 → 调用 → `digest` 变量 | 5 |
| `project/sha256-multiblock.project.json` | `ProjectRecord`：`files[]` 里是上面两个负载的字符串，`entryFileId=file-main`，覆盖报告/锚点/测试规格在 `metadata.aiHelper` | — |
| `project/README.md` | 文件角色、生成代码形状、复现命令、边界 | — |

**P4-SCOPE 计划的第 3 个文件（`steps.<n>.block.json`）没有做**：迭代只有 4 步，单独拆一个文件只是多一层壳，
不符合「每个文件必须有真实角色」；这是有意偏离，不是漏做（见 §6 第 1 条）。

`files[]` 里**只有** Blockly 负载；`metadata.aiHelper` 里是 `standard` / `source`（含 1325 行切片源文件的
sha256）/ `anchors`（14 条）/ `coverage` / `verdicts`（5 条）/ `tests`（含 driver、向量元信息、阴性对照）。
`ProjectRecord` 顶层没有 `workspace`（多文件项目留空，兼容旧读取方）。

### 3.2 块图与两个真实坑

```
padded = SHA-256 Pad(msg)
state  = [8 个 IV 字面量]
blocks = floor(BitLength(padded) / 512)
for i in range(blocks):
    offset = i * 64
    state  = SHA-256 Compress(state, BytesSlice(padded, offset, offset + 64))
return state
```

| 坑 | 现象 | 处置 |
|---|---|---|
| 除法在 Python 里是浮点 | `data_bit_length(padded)/512` 生成 `1024 / 512 = 2.0`，`range(2.0)` 直接 TypeError | 中间插原生 `math_round(ROUNDDOWN)`，生成 `math.floor(...)`，两语言都是整数 |
| 8 个字 → 32 字节没有块 | `bytes_to_hex` 只收 `Bytes`，`compress` 输出 `IntList`（8 个 32-bit 字），画布上没有大端打包块 | **不在画布上伪造**：`digest` 保留 8 字，由验证 driver 格式化成 hex（记入 `tests.formattingGap` 与缺口清单） |

另外一处**没有修、只记录**的：形参声明是 `message`，生成的头注释写 `@param {Uint8Array} msg`、Python 注解写
`msg: bytes`，而 entry 传的是字符串字面量（两语言的 pad 都接受 UTF-8 文本）。运行时正确，但**类型标签与实参不一致**，
且 `procedures_callreturn` 的 `ARG0` 是 `setCheck(null)`，Blockly 不会拦——这是 §35.3「类型标签被抹平」的又一例。

## 4. verify-project（第 4 段）

`scripts/verify-project.ts` 复用 `verify-demo.ts` 的 jsdom + Blockly 装载，改调 `generateProjectBundle`；
构建走 `AIVERIFY_ENTRY` 单入口，**没有改 `vite.verify.config.ts`，也没有加 `package.json` script**。

### 4.1 结构 / 符号 / 生成

| 检查 | 读数 |
|---|---|
| `files[]` | 2；`entryFileId` 命中 `file-main` |
| 反序列化块数 | `algo` 28/28、`main` 5/5（加载后 ≠ 序列化树即报） |
| 跨文件符号 | `SHA256_Multiblock(msg)`，`errors=[]`；call 块 `NAME` 已解析（先写符号表再加载） |
| 生成 | Python 90 行 / JS 110 行；`for i in range(blocks)`、`bytes_slice(padded, offset, (offset + 64))` 双语言都在 |
| 代码指纹（FNV-1a 64，非密码学） | py `cfb33505b629c970`；js `1db9ee7fabd4f5cd` |
| 类型检查（契约真值） | 24 对配对：**0 mismatch**、0 ok、**24 unknown**（15 = 子块是核心块/无契约，9 = 父块输入 `setCheck(null)`） |

### 4.2 双语言读数

| 语言 | 向量 | 结果 |
|---|---|---|
| Python | FIPS 180-4 Appendix B.2（448-bit 消息，填充后 1024 bit = 2 分组） | **PASS** `248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1` |
| JavaScript | 同上 | **PASS** 同上 |

### 4.3 阴性对照（证明这条向量真走了两分组）

只对**第一个** 512-bit 分组调用一次 `compress`（现有单分组 demo 的形态）：

| 语言 | 单分组输出 | 判定 |
|---|---|---|
| Python | `85e655d6417a17953363376a624cde5c76e09589cac5f811cc4b32c1f20e533a` | ≠ 官方向量 → **PASS**（对照开火） |
| JavaScript | 同上（逐字相同） | ≠ 官方向量 → **PASS** |

这条对照同时证明两件事：这条向量确实需要 `N=2` 的迭代；同一工作区在两语言下的原语输出一致。

### 4.4 没证明什么

- 没在**应用界面**里打开（只到 jsdom 的 `workspaces.load` + 代码生成）。产品级「项目导入 / IndexedDB 注入」仍缺入口
  （P4-SCOPE §8 已列为独立工作项），所以本轮不能说「浏览器里点开可见」。
- 没跑 `npm run verify:all`（按任务纪律由主线程统一跑）；没跑 `verify:demos` 的 60 条回归。
- 不证明块与伪代码逐行等价、不证明标准符合性、不证明 100 万分组（B.3）。
- 没测浏览器控制台错误数（没有真实浏览器会话）。

## 5. 缺口清单

| # | 缺口 | 影响条款 | 建议落点 |
|---|---|---|---|
| 1 | **缺 `words→bytes` 大端打包块**（8×32-bit → 32 字节；含变体截断） | `05-Digest` 永远到不了「能搭」；本轮 digest 只能由 driver 格式化 | 维护者线：`data_words_to_bytes` 或一键 `hash_sha256_digest`（SHA-224 的一键块是现成先例） |
| 2 | 消息扩展没有独立块（在 `hash_sha256_compress` 闭包里） | `03` 只能部分 | 维护者线：拆 `hash_sha256_expand`，或把 compress 拆成「扩展 / 轮函数」两块 |
| 3 | 压缩 64 轮在闭包里，画布无法逐步核 | `04` 只能部分 | 同上；若要逐步核还需 64 轮循环的模板表示 |
| 4 | `variables_get` 没有契约、多个块把输入声明成 `setCheck(null)` | typecheck 0 ok / 24 unknown，`0 unknown` 门槛不可达 | 块定义侧补 check，或类型检查器补「变量来源类型」推导 |
| 5 | 形参 `message` 生成 `bytes`/`Uint8Array` 注解，实参是字符串，连接时不校验 | 类型标签与实参不一致（§35.3 同源） | 类型系统层；不在本切片 |
| 6 | 2^64 比特长度上限、常量时间、密钥生命周期 | `02` 的 claim boundary | 只能人签核；块模型不表达 |
| 7 | 语料：`03`/`04` 的 SHA-512 锚点写 1142（实为 §6.4.1） | 锚点精度 | 语料待修（本切片未改） |
| 8 | P4-SCOPE 内部矛盾：§5.2 判 `02` 能搭，§5.4 缺口 3 又写「2^64 上限判不能」（见 §6 第 4 条） | 判定口径 | 方案待修：上限记 `claimBoundary`，不降档 |
| 9 | 「项目映射」的块名抽取有形态盲区（`name(args)` 曾漏认） | L1 覆盖偏低会误判 partial | 已在 `p4-verdicts.ts` 修；其它条目可能还有同类写法 |

## 6. 与 P4-SCOPE 的差异（逐条）

| # | P4-SCOPE | 实测 | 处置 |
|---|---|---|---|
| 1 | 试点 3 个文件（`algo` + `steps.<n>` + `main`） | 2 个 block 文件 + 1 个 record | 砍掉 `steps`：迭代只有 4 步，拆文件只是多一层壳，违背「每个文件有真实角色」 |
| 2 | 预计 22–27 块 | **33 块**（28 + 5） | 循环簿记比预估多：分组数要 3 块（bit_length / divide / floor），offset 与切片端点要 3 块 |
| 3 | §5.5 判据「typecheck 0 unknown / 0 mismatch」 | 0 mismatch、**24 unknown** | 门槛不可达：任何经 `variables_get` 传值的多步链都过不了。建议改成「0 mismatch + unknown 逐条归因」，否则每个切片都会卡在无法证明而非有错 |
| 4 | §5.2 判 `02` 能搭，但 §5.4 缺口 3 又写「2^64 上限判不能」 | 判 `02` 能搭，上限记为 `claimBoundaries` | 方案内部自相矛盾：上限是参数域约束、不是算法步骤，不该降档。已在 `verdicts.json` 里分栏记录 |
| 5 | `04` 判 partial 的理由是「每组重复不在块内」 | partial 仍成立，但理由换成「64 轮在闭包内」 | 迭代这一段**已经被 `ctrl_iterate` 组合出来**（B.2 两分组向量通过），原理由不再成立 |
| 6 | 锚点口径 221/230（条目级） | 本片条款级 14/14 可点 | 两者不冲突，口径不同；本片另外抓到 2 处声明锚点错小节 |
| 7 | L2 覆盖 116/222 块 | FIPS 180-4 只有 **3** 个块引标准号，SHA-256 pad/compress 为 0 | L2 对本标准不可用，判定只能靠 L1（§2.3） |
| 8 | 未提 `scripts/p4-*.ts` 放哪 | 放 `scripts/`（`no-console` 规则只对 `scripts/**` 放行，实验目录会出 lint 警告） | 三个脚本都在 `scripts/`，产物在 `experiments/.../p4/` |
| 9 | 未提构建位置 | 用 `AIVERIFY_ENTRY` 单入口构建到 `dist-verify/p4-*` | 不改 `vite.verify.config.ts`、不加 `package.json` script，符合「必须改共享文件时保持最小改动」 |

## 7. 复现命令（本机实跑，仓库根）

```bash
# 第 1 段
node scripts/p4-anchors.mjs
# ANCHORS ok entries=5 clauseUnits=14 clickable=14 sectionLevel=0 unresolved=0 mismatch=0 outsideSections=2
# ANCHORS source=docs/standards/fips180-4-SHA2/00-Standard-Source.md lines=1325 sha256=58d09d35fbc7…

# 第 2 段
AIVERIFY_ENTRY=scripts/p4-verdicts.ts AIVERIFY_OUTDIR=dist-verify/p4-verdicts \
  npx vite build --config vite.verify.config.ts
node dist-verify/p4-verdicts/p4-verdicts.js
# VERDICTS build=1 partial=3 missing=1 layers={"L1":5,"L2":0,"L3":0,"none":0} gaps=11

# 第 3 段
python3 experiments/ai-helper-2026-11-14/p4/build-project.py
# PROJECT files=2 algo_blocks=28 main_blocks=5 total=33
# PROJECT blockTypes=12 unknown=0 duplicateIds=0
# PROJECT entryFileId=file-main vector=248d6a61…19db06c1

# 第 4 段
AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/p4-project \
  npx vite build --config vite.verify.config.ts
node dist-verify/p4-project/verify-project.js \
  experiments/ai-helper-2026-11-14/p4/project/sha256-multiblock.project.json \
  --exec --out experiments/ai-helper-2026-11-14/p4/verify-project-readings.json
# == structure: files=2 entry=file-main entryMatches=true blocks=28+5
# == symbols: SHA256_Multiblock errors=0
# == generation: python=90 行 / js=110 行 loop=true/true chunk=true/true
# == typecheck: pairs=24 ok=0 mismatch=0 unknown=24 causes={"coreBlockNoContract":15,"parentInputNoCheck":9,"childOutputNoCheck":0}
# [Python] PASS  [JS] PASS
# [Python]/[JS] 单分组对照 PASS got=85e655d6…e533a (必须 ≠ 248d6a61…)
# === PROJECT VECTOR PASS (248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1) ===
```

> `dist-verify/` 是**临时**构建产物：另一条线跑 `npm run verify:build` 会清空整个目录。跑本片之前若报
> `Cannot find module .../dist-verify/p4-project/verify-project.js`，重跑上面两条 `AIVERIFY_ENTRY=... vite build` 即可，
> 不是代码问题（本轮已复现一次）。

新增/改动文件（全部新文件，未改任何既有源码）：

| 文件 | 行数 | 作用 |
|---|---:|---|
| `scripts/p4-anchors.mjs` | 308 | 第 1 段锚点抽取（纯 Node，无 Blockly） |
| `scripts/p4-verdicts.ts` | 343 | 第 2 段三档判定（复用 `block-search` BM25 与块索引） |
| `scripts/verify-project.ts` | 321 | 第 4 段 verify-project（jsdom + Blockly + 双语言执行 + 阴性对照） |
| `experiments/.../p4/build-project.py` | 316 | 第 3 段工程生成（可重复构建，字节稳定） |
| `experiments/.../p4/anchors.json` / `verdicts.json` / `verify-project-readings.json` | — | 机器读数（报告里的数字均出自它们） |
| `experiments/.../p4/project/*` | — | 试点工程（2 个 block 文件 + ProjectRecord + README） |

## 8. 边界与遗留

- `ProjectRecord` 只是**生成**并**在脚本里写入/读取**演示了一遍（`metadata.aiHelper` 的写入口径就在
  `build-project.py`），没有走 IndexedDB 与 UI 打开；这条留给产品级导入工作项。
- 判定器的步骤表是**人写的语义分解**，脚本只按规则算档位；换一个评审者可能对「哪步算 canvas」有不同意见，
  所以 `verdicts.json` 把步骤、可见性、缺口逐条落盘，便于逐条推翻。
- 本片没有验证 SHA-512 路径（`03`/`04` 的 §6.4.2）能否搭出工程；`hash_sha512_compress` 的 `W` 输入是
  80 个字而非 128 字节分组，块契约与 SHA-256 不同，第二条切片应先看它。
- 60 条既有 demo 回归与 `verify:all` 由主线程统一跑；本片只保证新文件 lint 0 error 0 warning、`vue-tsc` 0。
