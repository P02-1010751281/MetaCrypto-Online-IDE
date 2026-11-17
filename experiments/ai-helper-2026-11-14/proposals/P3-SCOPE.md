# P3 范围界定：B2 的 C/C++ 形态（外部参考实现 → 工作区）

> **结论先行**：P3 不能按「把 C 翻成积木」立范围。222 个块里算法体几乎都在生成器闭包里
> （采集时 121 个块带 `definitions_`，`out/code-signatures.json` 的 `stats.withDefinitionsPython`），
> C 参考实现能落到的只有「结构骨架 + 别名命中的原语调用」。P3 的真实产物是一份**可审计的
> C 名别名表 + 一套逐例差分判据**，不是通用 C→块 翻译器。第一步用本机 gcc 在 1–2 天内跑出
> 2 个样本的差分读数，再决定要不要做 Tauri sidecar。
>
> PLAN §3 的 P3 验收原文是「编译跑向量 vs 生成代码跑向量，逐例差分」
> （`experiments/ai-helper-2026-11-14/PLAN.md:69`）。本文第 4 节把它落成 V0–V5 六条。

## 0. 先纠正三处与实测不一致的地方

| 项 | 既有叙述 | 实测（本轮命令，见附录 A） | 影响 |
|---|---|---|---|
| 块面规模 | PLAN 写「221 个块」（`PLAN.md:18`、`:57` 的 `219/221`） | 契约 **222** 键；`src/blocks` 里唯一 `Blockly.Blocks[...]` 注册 **219** 个；双生成器各 **227** 条唯一 `forBlock` | 分母按 222 / 227 取，不按 221 |
| clang 版本 | PLAN 写 `clang 23.1.4`（`PLAN.md:91`） | `clang version 23.1.5` | 引用环境时用实测值 |
| 仓库有没有 C 样本 | 隐含「从现有产物挑样本」 | `find` 实测 **0** 个 `.c/.h/.cpp/.cc`；`docs/` 里 c 代码栅栏（三个反引号 + `c`）**0** 个 | 首批样本必须外部引入并钉哈希（同 A 线纪律） |

另外两处直接影响设计的实测事实：

- `detectInputLanguage()` 只返回 `python | javascript`，注释里明确「包括……C/C++ 片段」都落到
  `python`（`src/services/ai-helper/reverse/language.ts:13`、`:47`）——今天粘一段 C 进去，
  走的是 Python 反解析路径，产出的是逐条「未识别」。
- 前端唯一的桌面分支是「动态 import + try/catch 回退」
  （`src/utils/workspace/serialization.ts:153-175`）；`src` 里没有第二个平台判定点。
  P3 若上 sidecar，会成为**第二条**桌面专有路径。

## 1. 目标词汇表

### 1.1 分母怎么取

| 分母 | 值 | 取法 | 适用问题 |
|---|---|---|---|
| 契约键 | **222** | `docs/blocks/BLOCK-IO-CONTRACT.json` 顶层键数（`npm run contract:check` 守护） | 「块面有没有承接者」 |
| 生成器签名 | **227**（Python）/ **227**（JS） | `src/generators/{python,javascript}` 里唯一 `forBlock['x']` | 「代码形态能不能反向认」 |
| 可调用签名索引 | **66** | 用 `reverse/primitive-calls.ts` 的规则复算（单行、纯 `zzsigv_` 槽位 + 字面量关键字、有输出/前驱连接、至少 1 个位置参数） | 「C 里的原语调用能不能点名」 |
| C 侧构造类 | **21** | 本文 1.2 表 | P3 自己的词汇表 |

66 这个数本轮独立复算过，与 `tests/unit/ai-helper-reverse-primitives.test.ts:36` 的断言
`expect(index.size).toBe(66)` 一致。关键规则在 `primitive-calls.ts:129`（零参数不接受）、
`:133`（`io` 缺失整条索引不可用）；`io` 来自 `field-templates.json` 的每块 `io` 字段。

### 1.2 C/C++ 构造 → 块映射（21 类）

「完整」= 语义可直接对应；「部分」= 有块但要额外判据或会改变语义；「没有」= 无块可用，
只能诊断。

| # | C/C++ 构造 | 落到哪个块 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 函数定义 `T f(T a, …)` | `procedures_defreturn` / `procedures_defnoreturn`（本项目覆盖版） | 部分：类型只剩 `bytes`/`number` 标签 | `src/blocks/procedure/blocks/def-blocks.ts:189-190`；`reverse/ast/blocks.ts:406` 的 `procedure.returns` 分叉；§35.3 类型标签被抹平 |
| 2 | `return` | RETURN 槽 + `crypto_return` | 完整（仅单返回值） | `src/blocks/procedure/blocks/basic-blocks.ts:8`；§43.7 第 2 条：多 return 不支持 |
| 3 | 赋值 / 顺序语句 `x = e;` | `variables_set` | 完整 | `reverse/ast/blocks.ts`（`variables_set` 落地） |
| 4 | `if / else if / else` | `controls_if`（`elseIfCount`） | 完整 | `reverse/ast/blocks.ts:298` |
| 5 | `for (init; cond; incr)` | `controls_for`（FROM/TO 闭区间、方向自适应） | 部分：C 的 `i < n` 与块的闭区间不等价；`i++` 要折成 BY | `reverse/ast/blocks.ts:310`；§41.2 的 `range(0)` 空区间漂移是同源缺陷 |
| 6 | `while` | `controls_whileUntil` | 完整 | `reverse/ast/blocks.ts:341` |
| 7 | `do { } while()` | 无 | **没有**（只能用 while + 手工把体前置一次） | `src/blocks/ctrl` 只有 `iterate.ts` 与 `deprecated.ts` |
| 8 | `break` / `continue` | `controls_flow_statements` | 完整 | `reverse/ast/blocks.ts:349` |
| 9 | `switch/case/fallthrough` | 无 | **没有**（只能 if 链；fallthrough 与 `default` 落位无法表达） | 同上，无 switch 块 |
| 10 | `^` `&` `\|` `~` | `bit_operation` / `bit_expr_infix` / `bit_not32` | 部分：强制 `uint32` 语义 | `src/blocks/bitwise/operation.ts:10-19`、`expression.ts:11-18`、`not.ts:10`；生成端 `src/generators/python/bit/operation.ts:11,17-20` |
| 11 | `>>` `<<` | **只有** `bit_operation`（`bit_expr_infix` 下拉无移位） | 部分：左移带 `& 0xFFFFFFFF`、移位量 `& 31` | `src/generators/python/bit/operation.ts:11,17-18` |
| 12 | 循环移位 `rotl/rotr` | `bit_rotate_left` / `bit_rotate_right` | 完整（32 位） | `src/blocks/bitwise/rotate.ts:13,33` |
| 13 | 定长数组 `uint8_t a[16]` + `a[i]` 读 | `data_int_list` + `lists_getIndex`（0-based 覆盖） | 部分：无长度类型、无越界定义 | `src/blocks/data/int-list.ts:58`；`src/generators/python/array/lists.ts:4` |
| 14 | 下标赋值 `a[i] = x` | `lists_setIndex`（覆盖为 `list[at] = value`） | 完整 | `src/generators/python/array/lists.ts:14`；§44.3 说明没有 append |
| 15 | 指针 `*p` `&x` `p+i` | 无 | **没有** | 无对应块；AST 白名单也无 |
| 16 | `struct / union / enum / typedef` | 无 | **没有** | 同上 |
| 17 | `memcpy` / 字节拼接 | `pq_byte_concat`（两段 `A‖B`）、`pq_bytes_slice`（`[start:end)`） | 部分：无偏移写入、无长度参数 | `src/blocks/post-quantum/basic/operations.ts:30,46` |
| 18 | 宽度与截断 `uint8/16/32/64_t` | 无宽度块；只有 `uint32` 隐式 | **没有** | 宽度只以 `& 0xFFFFFFFF` 掩码隐式存在（`src/generators/python/bit/uint32.ts:30`） |
| 19 | 强转 `(uint8_t)x` | `data_convert_to_int`（语句块，转 int） | 部分：不是截断，是「变量 = 转整数」 | `src/blocks/data/convert.ts:11` |
| 20 | 三元 `a ? b : c` | `logic_ternary` | 完整 | `reverse/ast/blocks.ts:187` |
| 21 | `sizeof` / `#include` / 宏 | 无 | **没有** | `data_byte_length` 是运行期量值（`src/blocks/data/measurement.ts:27`），不是类型尺寸 |

**计数**（按行号复核 8 + 7 + 6 = 21）：

| 档 | 行号 | 数量 |
|---|---|---|
| 完整 | 2, 3, 4, 6, 8, 12, 14, 20 | **8** |
| 部分 | 1, 5, 10, 11, 13, 17, 19 | **7** |
| 没有 | 7, 9, 15, 16, 18, 21 | **6** |

- 结构可落地率 **8/21 = 38%**；含「部分」的可用率 **15/21 = 71%**。
- 契约侧可点名率 **66/222 = 29.7%**（227 生成器签名同一批 66）。

### 1.3 结构性限制：闭包吃掉算法体

这是 P3 最重要的一条，先说清楚再谈覆盖率。

`demos/procedures/SM4-Sbox.json` 的全部块是 `["procedures_defreturn","sm4_sbox","variables_get"]`——
S 盒表与查表逻辑不在块里，在生成器闭包里（`src/generators/python/symmetric/sm4/blocks.ts:29-42`，
256 项常量表 + `sm4_sbox_lookup`）。`AES-Round` 同理，是 4 个原子块 + `variables_get`。

后果：**C 参考实现里 `static const uint8_t S[256]` + `s[i]=S[s[i]]` 这段，没有任何块能承接**。
能承接的只有「这次调用整体等价于 `sm4_sbox`」这个判断——而那正是别名表要负责的事，
不是解析器能推出来的。

所以 P3 的产出形态应是：

```
C 源码 ──结构解析──> 骨架块（函数/循环/分支/下标/赋值）
      └─别名表命中─> 原语块（66 条索引 + 人工 C 名映射）
      └─其余──────> 带行号诊断（不静默丢）
```

## 2. 参考样本锚点（3–5 个）

仓库里没有 C，锚点只能取「有官方向量、有块面承接、能手写成 ≤40 行 C」的 demo，
并以其闭包 Python 作为转写底本。

| 候选 | 规模 | 官方向量 | 为什么选它 | 风险 |
|---|---|---|---|---|
| `demos/procedures/SM4-Sbox.json` | 3 块 | 有：`print(SM4_Sbox(1))` → `144`，来源 `demos/evidence.json`（GB/T 32907-2016 附录 A） | 最短闭环：1 字节进、1 字节出，可先验「别名 + 差分」这条链本身通不通 | 结构信息最少，只能验链路不能验结构映射 |
| `demos/procedures/Mode-ECB.json` | 4 块 | 有：`print(bytes(ECB()).hex())` → `3ad77bb4…ef97`（SP 800-38A F.1.1） | 16 字节向量、含 `AES-128` 全轮，是「多块串起来」的最小代表 | 算法体全在闭包，结构映射同样测不到 |
| `demos/procedures/AES-Round.json` | 7 块 | 无独立 expect（属过程库） | 4 个原子块（`aes_sub_bytes`/`shift_rows`/`mix_columns`/`add_round_key`）对应 FIPS-197 §5 的四步，是**别名表最该覆盖**的一组 | 无向量 → 只能做 V1/V2，做不了 V3 |
| `demos/procedures/ML-DSA-NTT.json` | 10 块 / 3 顶层 | 无 | 结构最丰富（数组 + 循环 + 模运算），能压 V1 结构保真判据 | 转写成 C 的工作量最大（>80 行），不适合作第一批 |
| `demos/procedures/X25519.json` | 4 块 | 有（多行驱动） | 位运算密集，最能暴露第 10/11 条 `uint32` 语义冲突 | 向量是驱动脚本形态，V3 需要新向量格式（见 §4.2） |

**建议第一批取 SM4-Sbox + Mode-ECB + AES-Round 三份**：前两份有向量、能立刻跑 V3；
第三份无向量但覆盖四个 AES 原子块，用来验别名表的覆盖面。

## 3. 架构边界：三个方案

### 3.1 方案表

| | (a) 纯前端静态解析 | (b) Tauri sidecar 编译 + 差分 | (c) 分层：Web 静态 + 桌面差分（推荐） |
|---|---|---|---|
| 解析器 | 自写 C 子集解析器（或 tree-sitter wasm） | `clang -Xclang -ast-dump=json`（真 AST） | Web 用子集解析器；桌面用 clang AST |
| 能回答 | 结构骨架、别名命中、逐条诊断；**不能**判定语义 | 一切：AST、编译、跑向量、逐字节差分 | Web 给结构与诊断；桌面给完整 V3 |
| 不能回答 | 语义等价、位宽/溢出、UB、编译期构造 | 只剩 UB/浮点（需 sanitizer 另立一档），但要处理 IPC 体积与三平台打包 | 各自边界写清，面板分档（同 §41.2 的 `semantic-drift` 做法） |
| 新增依赖/打包物 | 子集解析器（0 依赖）或 tree-sitter 的 wasm grammar（约百 KB 级，**未实测体积**） | `tauri-plugin-shell` + 每目标三元组一个二进制 + `externalBin` + 权限 | 两者之和，按构建开关裁剪 |
| Web 构建可用 | 是 | **否** | 是（降级：只有结构层） |
| 对 `verify:all` 影响 | 只加模块与单测时：0（`package.json:59` 的 22 步不含新脚本） | 不进 `verify:all`（Node 侧无 Tauri） | 同 (a) |
| 关键证据 | CSP 无 `wasm-unsafe-eval`（`index.html:8`）；入口预算 57,925/65,536 字节（`scripts/check-bundle-budget.mjs:5`） | `tauri.conf.json:30-32` 的 `bundle` 无 `externalBin`；`Cargo.toml:17-19` 只有 dialog/fs；`src-tauri/src/lib.rs` 全文 8 行 | 桌面分支的既有先例：`src/utils/workspace/serialization.ts:153-175` 动态 import + 回退 |

### 3.2 取舍

- **(a) 的诱惑**是「Web 也能用」。但它判不了 P3 的验收（逐例差分），只能给「结构上搭出来了」。
  如果只做 (a)，P3 的验收等于被降级成 A 线的「能搭/部分/不能 + 人签核」——那就该改 PLAN，
  不该假装 P3 完成了。
- **(b) 的诱惑**是「clang 已经在本机」。代价是：sidecar 是本项目**第一个**桌面专有条件编译路径，
  要三平台二进制、签名、权限清单；而且 `src-tauri/target/release` 下的二进制可能早于源码
  （既有坑 10f），验收前必须重编。
- **(c) 不必现在选边**：先按 (a) 的口径把「结构 + 诊断 + 别名表」做出来，V3 用
  **Node 脚本 + 本机 gcc** 跑（不进产品、不进 `verify:all`），拿到真实读数后再决定 sidecar
  值不值。

### 3.3 推荐

**推荐 (c)，但第一步只落地 (a) + 一个 Node 侧的 V3 脚本。** 理由按证据排：

1. 桌面路径的工程成本不在解析器，而在打包（无 `externalBin`、无 shell 插件）；
   先把「解析器 + 别名表 + 判据」这三件事的成本测出来，才知道要不要付打包的成本。
2. clang 的 JSON AST 体积可实测：30 行 C → **301 KB** JSON / **33 ms**
   （附录 A 的 `time` 读数）。200 行参考实现约 2 MB，跨 IPC 前必须裁剪——
   这是 (b) 的一笔隐藏成本，只有真跑过才知道。
3. Web 侧的降级是必须存在的：CSP（`index.html:8`）与入口预算都不允许把大解析器塞进主 chunk，
   真上 tree-sitter 也得动态 import 成独立 chunk，且要先验证 wasm 在现有 CSP 下能实例化。

## 4. 判据设计

### 4.1 V0–V5

| ID | 判据 | 输入 | 执行者 | 期望 | 失败长什么样 |
|---|---|---|---|---|---|
| V0 | 别名可审 | `c-alias-table.json`（C 名 → 块类型，含来源与首例） | `node` 脚本 | 每条 `块类型` 都在 222 键里；无重复 C 名；每条带 ≥1 个向量 ID | 别名指向不存在的块 / 同名两义 |
| V1 | 结构保真 | C 样本 + 生成的 `Blockly.serialization` 工作区 | 解析器 + 构造计数（同 §41.1 口径） | 函数/循环/分支/下标/位运算的**构造计数逐项相等** | 某计数少 1：静默丢构造（§41.1 已证明这类判据能开火） |
| V2 | 再生有效 | 工作区 JSON | `workspaces.load` + `python3 -c compile()` | 不抛；生成代码可编译 | 载入失败 / 生成代码语法错 |
| V3 | **逐例差分** | 向量（输入字节串 + 期望输出）+ C 源 + 工作区 | 本机 `gcc` 编 C；`python3` 跑生成代码 | 两侧输出**逐字节相等**，且都等于期望值 | 任一字节不等；或一侧编译/执行报错；或两侧相等但都不等于期望（说明别名与向量都错） |
| V4 | 诊断完备 | C 源 | 解析器 | 每个未映射构造 ≥1 条带行号诊断；`unsupported` 与 `semantic-drift` 分开标 | 有构造被静默吞掉；或诊断无行号（用户找不到原句） |
| V5 | 阴性对照 | 故意改坏的别名（如 `SubBytes → aes_shift_rows`） | 同 V3 | **必须红** | 仍然绿 → V3 没有牙，整条判据作废 |

V3 是 PLAN 验收的唯一实现；V1/V2/V4 是它的护栏（否则「差分过了」可能是两边都错得一样）。
V5 是 §41.1 与 §31 已经用过的手法，不新造。

### 4.2 向量形态是硬缺口（实测）

`demos/tests.json` 现有 60 条，形态是「代码驱动字符串 + 期望字符串」：

```json
{"py":{"driver":"print(SM4_Sbox(1))","expect":"144"},
 "js":{"driver":"console.log(SM4_Sbox(1));","expect":"144"}}
```

实测 60 条里只有 **5** 条是 `print(f(args))` 形态（SM4-Sbox、ML-KEM-Encaps、Mode-ECB、Mode-CBC、
Mode-CTR），其余 **55** 条是 Python 驱动脚本（`print(''.join(f'{x:02x}' …))`、多行、
`zfill(64)` 之类）。C 侧要跑同一条向量，必须要么给每条补一份 C driver，要么把向量重构成
**语言中立**形态：

```
{ id, call, inputs: [{name, hex}], expect_hex, source: {standard, appendix} }
```

重构会动 `verify:demos`（60/60）与 `verify:all`。建议**不为 P3 改现有 60 条**，而是新增
`experiments/.../out/p3-vectors.json`，只在 P3 的脚本里用；等 P3 定稿再谈是否回流 `demos/`。

### 4.3 明确「不能判定」的部分（不装作能判）

| 问题 | 没编译器（Web） | 有 gcc |
|---|---|---|
| C 与生成代码在同一组向量上是否一致 | **不能判定** | 能（V3） |
| 「一致」是否等于「映射保真」 | 不能判定 | 不能判定（只对给定向量成立，不构成证明） |
| 闭包内部实现是否与 C 实现同算法 | 不能判定 | 不能判定（映射没发生，没有可比对象） |
| 未定义行为（有符号溢出、越界、未初始化） | 不能判定 | 默认不能判定，需 `-fsanitize=undefined,address` 另立一档 |
| 位宽截断语义（`uint8_t` vs `uint32`） | 不能判定 | 能被 V3 抓到，但抓到时**不能自动修**，只能报 `semantic-drift` |
| 宏 / `#include` / 条件编译展开后语义 | 不能判定 | 能看展开结果，但展开后与块的对应关系不存在 |
| 浮点、结构体布局、AoS/SoA | 不能判定 | 需另立判据，P3 不做 |

## 5. 范围与工作量

### 5.1 第一步切片（目标：1–2 天在本机跑出真实读数）

| 步 | 做什么 | 产出（读数） |
|---|---|---|
| 1 | 手写 3 份 C 样本（SM4-Sbox、AES-ECB、AES-Round 的四步），每份 ≤40 行，钉 `sha256` + 来源附录号 | 3 个文件 + 3 条哈希 |
| 2 | 写 `c-alias-table.json` 初版 **≤8 条**（`sm4_sbox`、`aes_sub_bytes`、`aes_shift_rows`、`aes_mix_columns`、`aes_add_round_key` + 3 条控制流无关的原语） | 别名表 + V0 脚本通过 |
| 3 | 自写 C 子集解析器：函数定义、`for(init;cond;incr)`、`if`、赋值、下标读写、`^`/`&`/`<<`、`return`、`uint8_t*/uint8_t[]` 形参 | 解析器 + 单测 |
| 4 | 接 `ir.ts` 同构的 IR → 工作区（复用 `reverse/ast/blocks.ts` 的块集合，不新造块） | 工作区 JSON |
| 5 | Node 脚本跑 V1–V5：`gcc -O1` 编 C、`python3` 跑生成代码、逐字节比 | **差分读数：N 例 / 通过 M 例 / 诊断 K 条** |
| 6 | 阴性对照 V5 开火一次，记录失败信息长什么样 | 一条红的证据 |

预期读数（不预填结论）：结构可落地率按 §1.2 是 8/21 完整 + 7/21 部分；差分大概率在
**位运算样本**上先红（`uint32` 强制），这正是切片要暴露的东西。

### 5.2 明确不做

- 不做 C++（模板/类/重载/RAII）：无块承接，做了也只能全诊断。
- 不做指针、结构体、宏、`#include` 展开：第 15/16/21 条已是「没有」。
- 不新增块类型（属维护者线，改 `src/blocks` + 双生成器 + 契约，PLAN `:18`）。
- 不改 `demos/tests.json` 的 60 条向量（会动 `verify:all`）。
- 不在这一步做 Tauri sidecar 打包（先证明判据有读数，再谈分发）。
- 不把 C 解析器塞进主 chunk（预算 57,925/65,536 字节，`check-bundle-budget.mjs:5`）。

## 6. 风险

| # | 风险 | 证据 / 可验证假设 | 若成立会怎样 |
|---|---|---|---|
| R1 | **别名表是新增的人工真值，与生成器无机械联系**，会随块演进静默失效 | `verify:all` 的采集器已记录 `FIELD_COLLISIONS top: 2x{bit_expr_infix, bit_operation}`（§41.3）——两块对 XOR/AND/OR 生成的代码逐字相同，模板层本就不可判别 | 别名把 `SubBytes` 接到错块，V3 红但用户只看到「结果不对」；必须靠 V0 + V5 把别名钉住 |
| R2 | **位宽语义冲突**：块一律按 32 位算，C 按声明宽度截断 | `src/generators/python/bit/operation.ts:11,17-20`（左移 `& 0xFFFFFFFF`、移位量 `& 31`）、`bit/uint32.ts:30`（`& 0xFFFFFFFF`） | AES/SM4 的 `uint8_t` 表达式在 C 与块两侧给出不同值；V3 能抓到，但**不能自动修**，只能进 `semantic-drift` |
| R3 | **桌面 sidecar 今天不存在**，打包成本可能高于解析器本身 | `tauri.conf.json:30-32` 的 `bundle` 只有 `targets`，无 `externalBin`；`Cargo.toml:17-19` 只有 dialog/fs（无 shell 插件）；`src-tauri/src/lib.rs` 全文 8 行 | 方案 (b) 的工期主要在打包、权限、三平台二进制；且 `src-tauri/target/release` 二进制可能早于源码（既有坑 10f），验收必须重编 |
| R4 | **官方向量库语言不中立**，差分要另造向量 | 实测 60 条里只有 5 条是 `print(f(x))` 形态，55 条是 Python 驱动脚本（§4.2） | 直接改 `tests.json` 会波及 `verify:demos` 60/60 与 `verify:all`；只能先放 `out/p3-vectors.json` |
| R5 | **仓库没有 C 样本**，样本来源与版本会漂 | `find` 实测 0 个 `.c/.h/.cpp/.cc`；`docs/` 里 c 代码栅栏（三个反引号 + `c`）0 个 | 样本必须钉 `sha256` + 来源附录号（同 A 线 d6e 纪律），否则复现不了读数 |
| R6 | **解析器体积与 CSP 双重约束**，Web 侧可能装不下 | 入口预算 64 KB（`check-bundle-budget.mjs:5`，当前 57,925）；CSP `script-src 'self'` 无 `wasm-unsafe-eval`（`index.html:8`），仓库已有 Pyodide 走 `instantiateStreaming` 的代码路径（`src/runtime/python-runner.worker.ts:136` 注释），但「在现有 CSP 下真的实例化」本轮**未实测**，tree-sitter 是另一条加载路径 | 若 tree-sitter 走不通，Web 侧只剩自写子集解析器；这也正是推荐先写子集解析器的原因 |

## 附录 A 本轮实测命令（只读，复现用）

```bash
# 契约 / 注册 / 生成器签名
node -e 'const c=require("./docs/blocks/BLOCK-IO-CONTRACT.json");console.log(Object.keys(c).length)'   # 222
node -e '…遍历 src/blocks 唯一 Blockly.Blocks[…]…'                                                    # 219
grep -rho "forBlock\['[a-zA-Z0-9_]*'\]" src/generators/python | sort -u | wc -l                       # 227
grep -rho "forBlock\['[a-zA-Z0-9_]*'\]" src/generators/javascript | sort -u | wc -l                   # 227

# 原语调用索引（按 reverse/primitive-calls.ts 规则复算）
node -e '…单行 + 纯 zzsigv 槽位 + 字面量关键字 + 至少 1 位置参数…'                                    # 66

# demo 与向量
node -e 'const t=require("./demos/tests.json");console.log(Object.keys(t).length)'                    # 60
node -e '…统计 print(f(args)) 形态…'                                                                  # 5 / 60

# 环境与 C 样本存在性
gcc --version | head -1        # 16.2.1
clang --version | head -1      # 23.1.5
make --version | head -1       # 4.4.1
cmake --version                # 未找到
find . -path ./node_modules -prune -o -name '*.c' -print | wc -l                                      # 0
grep -rlE '^`{3}c' docs/ | wc -l   # 0

# clang JSON AST 可行性与体积（stdin，不落盘）
printf '…30 行 AES 片段…' | clang -x c - -Xclang -ast-dump=json -fsyntax-only | wc -c                # 301244
# 同一条命令加 time：real 0m0.033s
```

> 未执行：`npm run verify:all`、任何构建（按任务纪律）。本文所有「已通过/绿」类结论均未在
> 本轮重跑，只引用 RESULTS 的记录值并注明节号。
