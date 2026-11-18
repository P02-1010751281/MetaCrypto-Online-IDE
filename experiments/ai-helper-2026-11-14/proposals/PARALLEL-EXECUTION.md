# A/B/D 并行执行、B 的 C/C++ 语料与缺块回流（2026-11-18 owner 裁决）

本文把 owner 2026-11-18 的四条裁决落成可执行的分工：D 先做但**不串行**、A/B/D 接模型、
缺块回流维护者线（后台提醒或自动工单）、B 的 C/C++ 样本从 GitHub 找。文中的外部仓读数与
本机构建结果都是 2026-11-18 当场实测，不是引用旧记录。

## 0. 裁决原文与其可执行含义

| owner 原话 | 落成什么 |
|---|---|
| 「D 可以先做，并行不行吗？」 | 三条线**同时**推进；D 不占前置位。串行只保留三处真正互斥的点（见 §1.3） |
| 「A/B/D 接模型」 | 三条线都允许调模型；接入形态与数据边界先定（§3），判据不被模型改写（§3.3） |
| 「缺块回流维护者线（后台提醒或自动工单）」 | 用户侧检出「现有块表达不了」时产出可复现 ticket，落维护者线收件箱（§4） |
| 「GitHub 上找一下有没有 C/C++ 样本」 | 候选与实测见 §2；首批取 tiny-AES-c + PQClean |

## 1. 并行可行性

### 1.1 三条线的瓶颈不同，因此可以真并行

| 线 | 现在的瓶颈 | 并行期间独占的写作用域 |
|---|---|---|
| **D** 检索 | 已结项（RESULTS §22：查块 30/30、查文档 30/30、留出集 18/20、查文献 16/16） | `src/services/ai-helper/doc-*.ts`、`doc-index*.json`、`src/components/ai-helper/` |
| **A** 标准/论文→工程 | 只有 FIPS 180-4 一条纵向切片；其余 39 个标准目录未切；两处判据要改（typecheck 的 0 unknown 不可达、L2 tooltip 证据对 SHA-256 是死的） | `scripts/p4-*`、`experiments/ai-helper-2026-11-14/p4/` |
| **B1** 本平台代码→工作区 | 主体完成（60/60 demo 往返）；剩多生成器非字面量与表达式位置只给点名诊断 | `src/services/ai-helper/reverse/`、`scripts/ai-helper-reverse*` |
| **B2** 外部 C/C++→工作区 | 只有第一步切片（3 份 ≤40 行自撰样本，V3 双侧差分 9/9）；带分支循环的函数体无读数 | `experiments/ai-helper-2026-11-14/p3/`、B2 新增脚本 |

四个作用域两两不重叠，所以「同时开」在工程上成立：它们不抢同一批文件，也不抢同一个门禁产物。

### 1.2 唯一的共享资源是 `verify:all`

任何人跑 `verify:all` 都会重写 `dist-verify/`、`BLOCK-IO-CONTRACT.json` 的校验读数与文档索引。
并行期间约定：**谁改产物谁跑门禁**，且不得在另一个作业用同一个 `TMPDIR` 时跑 vite
（2026-11-18 实测：`test:unit` 与 `verify:all` 共用 `TMPDIR=.tmp-build` 时互相清掉临时目录，
31 个测试文件报 `ENOENT …/brk…/client/…`，rc=1；给单测单独 `TMPDIR` 后 115 文件 1270 用例全过）。

### 1.3 真正串行的只有三处

1. **新增块类型**：必须在构建期改 `src/blocks` + 双生成器 + 注册链并重新打包，浏览器内做不到。
   这天然是维护者线，也是 §4 回流的落点。
2. **门禁全绿**：合并前由一人跑一次整树 `verify:all`，避免多人同时产生产物冲突。
3. **P5 单入口**：必须在 A、B 各有稳定输出之后才有意义（判别规则已定，但接口面要先稳）。

## 2. B 的 C/C++ 语料：GitHub 实测（2026-11-18）

### 2.1 候选读数

| 仓库 | star | 许可（GitHub API） | 最后推送 | 归档 | 本机可构建 |
|---|---|---|---|---|---|
| `kokke/tiny-AES-c` | 5028 | Unlicense | 2024-10-04 | 否 | **是（已跑通向量）** |
| `PQClean/PQClean` | 958 | 无 SPDX（逐文件公有领域/CC0） | 2026-08-04 | **是** | **是（ML-KEM-512 出静态库）** |
| `open-quantum-safe/liboqs` | 3130 | NOASSERTION（Apache-2.0 为主） | 2026-11-17 | 否 | **否：缺 cmake/ninja** |
| `mupq/pqm4` | 464 | 未查 | 2026-11-09 | 否 | **否：缺 arm-none-eabi-gcc** |
| `B-Con/crypto-algorithms` | 2057 | 公有领域 | 2020-12-28 | 否 | 未测（纯 C，无外部依赖） |

本机工具链实测：`gcc 16.2.1`、`clang 23.1.5`、`make 4.4.1` 在；`cmake`、`ninja`、`arm-none-eabi-gcc` **缺**。
这条读数直接决定哪些仓库能进 B2：cmake 工程在当前主机上进不来，必须先装工具链。

### 2.2 两个已跑通的证据

**tiny-AES-c**（对称，向量内嵌在自己的 `test.c` 里）：

```
gcc -O2 -o taes test.c aes.c          # build_rc=0
./taes                                # CBC/CTR/ECB × encrypt/decrypt 全 SUCCESS!
```

**PQClean**（PQC，KAT 摘要钉在 `META.yml`，不需要另外下载大向量文件）：

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/PQClean/PQClean.git
git sparse-checkout set crypto_kem/ml-kem-512 common
make -C crypto_kem/ml-kem-512/clean   # cc -O3 -Wpedantic -Werror … → ar libml-kem-512_clean.a
META.yml: nistkat-sha256: c70041a761e01cd6426fa60e9fd6a4412c2be817386c8d0f3334898082512782
```

`nistkat-sha256` 是这条线的关键：官方 KAT 的**摘要**而不是向量本体，所以语料体积小、判据仍是
官方的——把 C 侧算出的 KAT 摘要与「块搭出的工作区生成的 Python/JS 跑出的摘要」对齐即可差分。

### 2.3 首批取哪两个

取 **tiny-AES-c**（对称、向量内嵌、零依赖，先把 B2 的差分管线从「自撰样本」换成真外部仓）
与 **PQClean 的 ml-kem-512 clean 档**（PQC、make 构建、KAT 摘要官方）。liboqs 与 pqm4 记作
「装完工具链再进」，不作为首批——否则第一批样本的阻塞点会变成装 cmake，而不是差分本身。

## 3. 接模型：三种形态与必答项

### 3.1 形态

| 形态 | 数据边界 | 代价 |
|---|---|---|
| **A 本地模型**（Ollama / LM Studio，本机端口） | 不出境，不依赖网络 | 需要本机有可用模型与显存 |
| **B 云端 API**（用户自带 key） | 工作区内容会离开本机 | 需要 key 存放策略与出境评审 |
| **C 不接模型**（现状） | 无 | 生成式回答能力上限低 |

### 3.2 四项已定（owner 2026-11-18）

| 项 | 裁决 | 落成什么 |
|---|---|---|
| provider 与模型 id | **用户自己填**（BYOK） | 设置里填 base URL + 模型 id + key；仓库内不出现任何 provider 常量、默认值或 key |
| key 存放 | localStorage 可以，但要**默认更安全的档** | 默认 `sessionStorage`（关标签页即失）；勾「记住」才落 `localStorage`，并带显式风险提示与一键清除 |
| 数据出境 | **允许** | A/B 可以把工作区与上传的参考代码发给云端；界面上要有一句明示，且上传内容不含 key |
| 配额与超时 | 见 §3.4 | 每次用户操作只允许一次模型调用；超时与 token 上限按线定档 |

### 3.3 key 存哪儿：威胁模型（为什么默认不落 localStorage）

仓库现状（2026-11-18 实测）：CipherCat 是纯客户端，`localStorage` 只用于「上次打开的项目 id」
（`src/composables/useEditorProject.ts`），`index.html:8` 的 CSP 是
`default-src 'self'; script-src 'self'`（无 `unsafe-inline` / `unsafe-eval`）。
即便如此，**localStorage 里的 key 不设防**：

| 威胁 | 是否被挡住 | 说明 |
|---|---|---|
| 页面被注入脚本（XSS / 恶意依赖） | **挡不住** | 同源脚本能读 `localStorage`；CSP 只降低了注入面，不是隔离 |
| 浏览器扩展（有站点权限） | **挡不住** | 扩展可直接读页面存储 |
| 磁盘/配置文件被拿走（备份、同步盘、他人用同一账号） | **挡不住** | 浏览器存储明文落盘 |
| 关标签页后残留 | 用 `sessionStorage` 可避免 | 默认档 |
| 被写进项目文件 / 导出 JSON / 传给模型 | **设计上禁止** | key 只走请求头，不进行任何序列化路径 |

结论：想在浏览器里「安全存 key」是做不到的，只能缩小暴露窗口。四档按强度排：

1. **会话内存**（最严）：关页面即失，每次重开手填 —— 默认；
2. **`sessionStorage`**：同标签页内免重填，关标签页即失 —— 默认档的落点；
3. **`localStorage` + 显式勾选**：跨会话免填，代价是上面三条威胁全开 —— 用户自选；
4. **桌面版走 OS 钥匙串**（Tauri 侧）/ 或用户自建**本地中转**（key 在本地进程里，浏览器只连 `127.0.0.1`）。
   这两档是唯一「不把 key 交给页面 JS」的形态，但要等桌面封装或本地转发件落地，不作为当前默认。

不做的事：不给 key 做「前端加密后存 localStorage」——密钥也在同一个页面里，XSS 一样能拿到，
只是多一层自欺。

### 3.4 配额与超时：把「一次能花多少、等多久」写死

「配额」= 一次操作最多花多少 token / 多少钱；「超时」= 最多等多久；两者都为了**防误触重试把用户
自带额度烧光**——BYOK 下额度是用户自己的，代码不能悄悄重试。

| 线 | 一次操作 = 几次模型调用 | 输入上限 | 输出上限 | 超时 | 重试 |
|---|---|---|---|---|---|
| **D** 检索问答 | 1 | 候选句 ≤ 5 句（`limits.ts` 的 `DEFAULT_MAX_SELECTIONS`） | ≤ 300 token（只回候选 id + 可选 note） | 20 s | 0（失败就说失败） |
| **B** 代码解释/映射建议 | 1 | 单文件 ≤ 8k token | ≤ 4k token | 60 s | 0 |
| **A** 标准→工程 | 1（超长文档由用户分段，不自动续跑） | 单次 ≤ 60k token | ≤ 12k token（工作区 JSON） | 120 s | 0 |

界面上要显示：本次调用用了多少 token、估算费用（用户填了单价才算）、失败原因（超时 / 额度 / 格式不符）。
**不自动重试、不自动分段、不后台轮询**——这三件都会让「用户以为只点了一次」变成账单上的十几次。

### 3.5 强模型怎么选

先看代码已经把模型收窄到什么程度（这决定值不值得上强模型）：

- **D 线**：`model/types.ts` 里模型的输出类型**没有句子文本字段**，只能回候选句 `id` 的有序子集，
  空数组即拒答。选句这件事弱模型就够，上顶配是浪费——除非要写 `note`（解释文本，且必须有 `support`）。
- **B 线**：判据是 C 参考实现与本仓库生成代码的 KAT 差分，模型只做「解释这段代码在干什么 / 建议怎么拆成块」，
  错了不影响判据，所以中等档够用。
- **A 线**：唯一真正吃强模型的线——要读标准原文、产出一份能被 `Blockly.serialization` 载入的大 JSON。
  结构化输出稳定性、长上下文、少幻觉三件都要，值得上顶配。

按档位的建议（型号由用户填，这里只说该挑哪一档）：

| 线 | 档位 | 选择标准 |
|---|---|---|
| A | **顶配 reasoning/coding 档** | 单次能稳定吐出 10k token 合法 JSON；支持 60k+ 上下文；有 structured output / JSON mode |
| B | 中档 | 代码理解好、单价低；不需要长上下文 |
| D | 便宜快速档 | 延迟 < 3 s；输出被类型约束到「选 id」，能力过剩无收益 |

一点提醒：2026-11 的第三方「最强编程模型」榜单互相打架（同一周不同站点把冠军给不同家），
所以不要按榜单定型号，按上表的**能力项**（长上下文 / JSON 稳定性 / 延迟 / 单价）在用户自己的
provider 上试一轮再定。用户既然自填 provider，这条本来就该由他按手上的额度决定。

### 3.6 判据不被模型改写（硬约束）

模型的产出只能进「解释 / 建议 / 草稿」，不得进判据：A 的三档覆盖率、B 的 KAT 差分、
D 的 recall@5 都必须由确定性代码算出。否则「模型说能搭」会污染唯一的人签核依据。

## 4. 缺块回流维护者线

### 4.1 两条通道

| 通道 | 触发 | 落到哪 | 现在做不做 |
|---|---|---|---|
| **后台提醒**（轻） | 用户操作中检出「现有块类型表达不了」 | 本地 ticket JSON，攒到阈值或用户点「上报」后落维护者线收件箱 | 做 |
| **自动工单**（重） | 同上 | 远端 issue（需要服务与凭据） | 暂不做，先留接口 |

### 4.2 ticket 必须自带证据

一条 ticket 至少要有：缺失语义的一句话、来源（标准条款锚点 / 参考代码文件:行 / 用户原文片段）、
期望的块签名（输入输出类型与代码形态）、复现所需的最小工作区或代码片段、来源哈希。
没有这些的 ticket 只是「我觉得缺个块」，维护者无法据此动手。

### 4.3 落点

落点已实现为 `experiments/ai-helper-2026-11-14/inbox/<语义标签>@<来源哈希>.json`（仓库内、可 diff、
可被维护者 agent 定期取），去重键 = `语义标签 + 来源哈希`。用户侧不阻断、不弹窗阻塞，只在面板上显式计数
（计数接口 `summarizeInbox()` 已就绪，面板徽标未接）。

复跑（2026-11-18 实测）：

```
AIVERIFY_ENTRY=scripts/ai-helper-inbox.ts AIVERIFY_OUTDIR=dist-verify/inbox \
  npx vite build --config vite.verify.config.ts
node dist-verify/inbox/ai-helper-inbox.js            # ingest（幂等，只写新增）
node dist-verify/inbox/ai-helper-inbox.js --dry-run  # 只看会新增什么
node dist-verify/inbox/ai-helper-inbox.js --check    # 校验收件箱，坏文件 → rc=1
```

`source.hash` 的输入是 `kind|文件（或锚点）|规范化证据原文`，不是整文件哈希、也不含行号：
整文件哈希会让无关编辑反复生成新票，行号会随上游改动漂移。重复项保留已有 status 与 createdAt，
已 shipped 的票不会因为用户又触发一次退回 open。

## 5. 首批并行任务

| 序 | 任务 | 线 | 写作用域 | 依赖 | 状态 |
|---|---|---|---|---|---|
| 1 | tiny-AES-c 接入 B2 差分管线（替换自撰样本） | B2 | `p3/`、B2 脚本 | 无 | **已完成 2026-11-18**：2 份原样摘录样本走通 V0→V3，13/13 向量（RESULTS.md §50） |
| 2 | PQClean ml-kem-512 的 KAT 摘要对齐（C 侧摘要 vs 生成代码摘要） | B2 | 同上 | 1 的管线（已就绪） | **已完成 2026-11-18**：C 侧摘要复现 = `c70041a7…`；`pk/sk`（K-PKE.KeyGen，146 块 IR 组装）与 `ct/ss` 全部由生成代码产出、四项逐字节相同，六行组装摘要 = META（RESULTS.md §51–§52） |
| 3 | 缺块回流 channel 1：ticket 结构与本地收件箱 | 共享 | 新增 `inbox/`、面板计数 | 无 | **数据面完成 2026-11-18**：7 条 unsupported 诊断 → 7 条 ticket，幂等重跑新增 0，`--check` PASS，篡改 id 与已 shipped 不再触发两条对照都开火；面板徽标未接（RESULTS.md §53） |
| 4 | A 线第二份标准切片（换一个非哈希标准，验证三档判据可复用） | A | `p4/` | 两处判据修正 | **已完成 2026-11-18**：换 SP 800-38B CMAC，锚点 3/3 可点、专卡 2/2 复算通过、FIPS 产物逐字节未变（§54）；工程构建段补完后三档改为 **0 能搭 / 3 部分 / 0 不能**——02-Subkeys 初判「能搭」被画布类型门推翻（`Bytes→IntList` 无转换块，探针 2 拒 1 通），41 块 CMAC 试点工程双语言跑通 RFC 4493 §4 四条标签 + K1‖K2，typecheck 判据首次在非哈希语料上触达（32 对 0 mismatch / 32 unknown 归因）（RESULTS.md §55） |
| 5 | D 线接模型（检索增强回答），判据仍走 recall@5 | D | `components/ai-helper/` | §3.2 已定；限额按 §3.4 的 D 档 | 待做 |
| 6 | 合并前整树 `verify:all` | 共享 | 无（只读） | 1–5 | **已完成 2026-11-18 10:43**：先 `npm run docs:index` 追平 b54f5f0 的文档改动（437 篇 / `14a943a2…`），整树 `verify:all` **rc=0**（contract errors=0、`FIELD_CHECK ok blocks=224`、`CLOSURE_CHECK ok names=226`、模板 29/29、demos 60/60、`DOC_INDEX_CHECK ok`）；同轮 `test:unit` 117 文件 / 1303 通过 1 跳过（RESULTS.md §56） |
| 7 | AI Helper 是否镜像到 metacrypt_server | 共享 | `frontend/src/features/blockly/**`（跨仓） | 需 owner 裁决口径 | **未开始**：`sync-to-metacrypt.sh` 的写入前缀只有 `core/blocks`、`core/generators`、`core/constants`、`components`（Blockly 面板）、`services/projects`、`runtime`、`utils/{locale,migration}`；`src/services/ai-helper/`（47 个 ts）与 `src/components/ai-helper/`（5 个 vue）一条都不在镜像范围，metacrypt_server 侧实测 0 处 AI Helper 代码。最近一次跨仓动作是 `cfd2d13`（11-18 08:21）镜像 blockly core，与本线无关 |

**#2 已关闭的方式**（2026-11-18，RESULTS.md §52）：没有手工在画布里拼积木，而是让
`p3/lib/gen-mlkem-keygen-ws.mjs` 用 IR 组装 K-PKE.KeyGen（146 块）→ `assembleIr` → harness 出码。
六行里 `count`/`seed` 是 DRBG 输入（不是算法输出），其余四项全部取生成值，重算 sha256 才与 META 相等。
仍然没做的：`z` 之外的 KEM 封装/解封装侧（`crypto_kem_dec` 的隐式拒绝）未接；KAT 只覆盖第一条用例。

**#4 的半段边界**（2026-11-18，RESULTS.md §54）：判据本身可复用——档位规则、证据层优先级、
「语义等价 unverified」都没改，改的只是三处版式配置（标题识别 / § 出处 / L1 证据节标题词表）。
用「改回只管 FIPS」的副本量过代价：标题只认顶格 → 可点 3/3 变 0/3；§ 只从「标准定位」取 →
条款单元 3 变 0；L1 只认「…映射」→ 01/03 的 L1 证据掉到 L2（档位不变）。
仍未做：CMAC 没有第二个试点工程，所以 P4-SCOPE 记的 typecheck 判据（「0 unknown」不可达）
这轮没有被触达，仍是待办。

**#1 的已知上限**（先记下来，别在 #2 里当成已解决）：别名表 8/8 顶格；只覆盖「整函数被别名吸收」；
带分支/循环的第三方体仍未进 V3（tiny-AES-c 的 `Cipher`/`KeyExpansion` 就要它）。

## 6. 三线完成度（2026-11-18 实测口径，不是计划口径）

| 线 | 已完成（有读数） | 未做（明确挂着） | 判据 |
|---|---|---|---|
| **A** 标准/论文 → 工作区 | 两条纵向切片：FIPS 180-4（5 条目 / 14 条款单元 / 14 条全部可点、三档 1 能搭 3 部分 1 不能、33 块 SHA-256 试点跑通 B.2 向量）与 SP 800-38B CMAC（3 条目 / 3 单元全可点、专卡 2/2 复算、三档 **0 能搭 3 部分 0 不能**、缺口 6 条、41 块 CMAC 试点跑通 RFC 4493 §4 四条标签 + K1‖K2）；typecheck 判据首次在非哈希语料触达（32 对 0 mismatch / 32 unknown 逐条归因） | 第三条标准；`Bytes→IntList` 转换块缺位，使 §6.1 子密钥分解**没法在画布上表达**；CMAC 的 `Tlen` 截断与 VER 路径；语义等价永远 `unverified`（交人签核） | 能搭 / 部分 / 不能 + 锚点可点率；不读条目页的「项目状态」 |
| **B** 参考代码 → 工作区 | V0–V3 四段管线（V3 = 本机 gcc 编 C 与仓库生成器双侧差分）：自撰 3 份样本 3/3、kokke/tiny-AES-c 两份真实样本 13/13；PQClean ML-KEM-512 的 KAT 六行全部由生成代码产出（`pk`/`sk`/`ct`/`ss` 四项逐字节相同，六行组装摘要 = META） | 带分支/循环的第三方体（tiny-AES-c 的 `Cipher` / `KeyExpansion`）不进 V3；KEM 解封装侧（`crypto_kem_dec` 的隐式拒绝）未接；浏览器内没有编译器，真编译比对要桌面 sidecar；缺块回流只到 channel 1 数据面，面板徽标未接 | 编译跑向量 vs 生成代码跑向量，逐例差分 |
| **D** 检索助手 | 检索内核（块 / 文档 / 文献三索引）+ 查块、查文档面板；六套评测集：查块 30/30 与困难集 30/30、查文档 eval 30/30、holdout 18/20（90%）、文献 16/16；doc-answer 句子可回链 + 点名实体闸门（§29） | **D 线接模型（检索增强回答）未做**（本表第 5 行）——现在是纯检索，不是「模型答」 | 检索 recall@5 / 出处正确率 |

三线共同边界（写进合同，免得被当成「都做完了」）：A 的原文没有可执行语义，只能给档位再交人签核；
B 的差分只覆盖「整函数被别名吸收」与「纯原语调用链」两种形态；D 目前只到检索，没有生成式回答。

### 6.1 跨仓口径：这条线还没到 metacrypt_server

- 本线全部代码与证据都在 CipherCat：`src/services/ai-helper/` **47 个 ts**、`src/components/ai-helper/`
  **5 个 vue**、`scripts/ai-helper-*.ts` **14 个入口**、`experiments/ai-helper-2026-11-14/` 全部读数。
- `sync-to-metacrypt.sh` 的写入前缀只有 `core/blocks`、`core/generators`、`core/constants`、
  `components`（Blockly 面板三件）、`services/projects`、`runtime`、`utils/{locale,migration}`——
  AI Helper 的服务与面板一条都不在镜像范围；在 metacrypt_server 里 grep AI Helper 实测 **0 处**。
- 跨仓最近一次动作是 `cfd2d13`（11-18 08:21，镜像 blockly core 的 `arr_append` / `ctrl_range`
  与循环端点改造），属上一轮核心同步，与本线无关。
- 所以「回合到 metacrypt_server」**目前不成立**。要不要镜像属产品口径（D 是唯一现在就能做成产品的线，
  但「能做产品」不等于「要进 metacrypt_server」），已作为第 7 行挂起等 owner 拍板。
