# v2.0.0 冻结记录（SoftwareX 更新稿对应版本）

日期：2026-11-16
冻结对象：tag `v2.0.0` → 提交 `f7f6bc0`
门禁：CipherCat type-check 0 / lint 0 / 单测 1018 通过 1 跳过 / `verify:all` RC=0
（metacrypt 镜像侧同期基线：type-check 0 / lint 0 / 单测 978 / build:prod 0）

## 1. 为什么重指 tag

冻结前实测：`v2.0.0` 原指 `3e95af1`（2026-11-13 13:59），而 HEAD 已在其后 **53 个提交**、另有 93 个未提交文件。稿件写的结构数字却是按 11-15 的工作树算的，两者不是一棵树：

| 项 | 旧 tag `3e95af1` | 冻结前工作树 | 稿件原写 |
|---|---|---|---|
| 演示工作区 | **59** | 60 | 60 |
| BLOCK-IO 积木键 | **220** | 222 | 222 |
| 单测文件 | 72 | 89 | — |
| 运行面板（`src/runtime/*`） | **不存在** | 存在 | 「v2.0.0 已内置」 |

第三行是最硬的一条：`src/runtime/python-runner.worker.ts` 等运行链是 11-15 才加的（`2ffbfe3`），旧 tag 树里没有。也就是说稿件 11-15 写的「v2.0.0 已内置运行面板」在旧 tag 上**不成立**，审稿人按 C2 链接复现会拿不到该面板。

处理：把未提交的 89 个文件按性质落成 4 个提交，`v2.0.0` 重指到这条链的末端。该 tag **从未推送**（`git ls-remote --tags origin` 空），重指不破坏任何外部引用。

## 2. 冻结提交链

```
f7f6bc0 docs(codestable): 归档包边界、chrome i18n 与发表版基线审计
db679bf test(locale): 覆盖 ui() 键引用与中英键集一致性
494a4b0 feat(locale): 导出 uiFormat，面板 chrome 文案统一走 ui()
3ee4c5a refactor(core): 核内导入统一走 @cc/* 包内别名，去掉应用级 @/ 依赖
```

`git describe --tags` = `v2.0.0`。旧指向 `3e95af1` 仍在历史里可达。

冻结当日随后还有三笔文档提交，一并纳入该 tag：

```
11b7b3d docs(provenance): 产品名统一为 MetaCrypto Online IDE，补来源与世系说明
eb7818c docs(audit): 记录 v2.0.0 冻结（tag→f7f6bc0）与 AE8 口径结构数字
f7f6bc0 docs(codestable): 归档包边界、chrome i18n 与发表版基线审计
```

tag 重指的判据始终是「与该 tag 树逐项可复现」：`git diff v2.0.0 HEAD` 为空即此刻成立。

## 3. 结构数字（AE8 口径，全部实跑）

| 项 | 实测值 | 来源 |
|---|---|---|
| 活动自定义积木 | **222** | `docs/blocks/BLOCK-IO-CONTRACT.json` 键数 222 + `contract:check` 绿 |
| 按身份去重类型 | **248** | 222 + 29 − 3（口径见 `docs/standards/CONFORMANCE-INVENTORY.md:21`） |
| 过程模板 | **29** | `verify:all`：模板 29/29 PASS |
| 演示工作区 | **60** | `DEMO_SUMMARY total=60 pass=60 fail=0` |
| 单元测试 | **1018 通过 / 1 跳过（89 文件）** | `npx vitest run` |
| `docs/` Markdown | **443** | `DOC_LINK_SUMMARY files=443 broken=0` |
| 标准目录 / 条目 / 制品 | **40 / 229 / 66** | `STANDARD_METADATA_SUMMARY entries=40 directories=40 artifacts=66 source_layers=27 structured=229 errors=0` |
| 行锚点 / PDF 页锚点 | **181 / 41** | `STANDARD_INVENTORY_CHECK_OK … line_anchors=181 pdf_page_anchors=41` |
| 源码文件（`src/`）| 444 | 现场统计 |
| 超 500 行源文件 | **0** | 拆分收尾后现场统计 |

## 4. 稿件待改清单（2026-11-16 20:46 已完成）

| 项 | 稿件现值（11-15 快照） | 冻结树实测 | 动作 |
|---|---|---|---|
| 单元测试 | 968（967 通过 1 跳过） | **1018（1017 通过 1 跳过）** | 改正文 + 表 1 + 图 1 `c_ev1` |
| `docs/` Markdown | 435 | **443** | 改正文 |
| 链接检查覆盖 | 441 | **443** | 改正文 |
| 演示工作区 / 积木 / 去重类型 / 模板 / 标准三项 | 60 / 222 / 248 / 29 / 40·229·66 | 同值 | 核对后不改 |
| 证据类别分布（原 32·13·12·3） | 32·13·12·3 | **待实测** | 重算后同步图 1 `c_ev2` |
| 未被 Demo 执行的块（原 89） | 89 | **待实测** | 重算 |
| 可复现性段落 | 「提交 3e95af1 + tag v2.0.0」 | 应为 `f7f6bc0` + `v2.0.0` | 改（在 DRAFT-NOTES 与正文如引用） |

## 5. 复跑命令

```bash
cd /run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat
git describe --tags                     # v2.0.0
npm run type-check && npm run lint:check
npx vitest run                          # 1018 passed | 1 skipped
npm run verify:all                      # 模板 29/29、demo 60/60、DOC_LINK_SUMMARY broken=0
git archive v2.0.0 | tar -x -C /tmp/v200 && cd /tmp/v200 && npm ci && npm run verify:all
```

## 6. 未决

- **推送**：本地领先 `origin/main` 15 个提交（含本次 4 个），tag 未推送；C2/C7 的 `/tree/v2.0.0`、`/blob/v2.0.0` 链接要推送后才生效。需 owner 批准。
- **版本号**：C1 现为 v2.0.0，冻结后未动；若 owner 决定改为 v2.1.0，需同改标题 / C1 / C2 / C7 / `package.json` / tag 六处。
- **证据类别与「未进 Demo 的块」两项**尚未重算，属论文数字同步的一步。

以上各项已于 2026-11-16 20:46 同步落地并重出四份产物（中 7 页 / 英 8 页，旧值 0 命中，DOCX 内嵌图与 `figures/` 逐字节一致），过程记录见 `paper/softwarex-update-2026-10/DRAFT-NOTES.md` 同日一节。

> **2026-11-16 23:2x 更名后重钉**：仓库更名为 `MetaCrypto-Online-IDE`（展示名 `MetaCrypto Online IDE`）后，
> `v2.0.0` 重钉到本提交——它等于原 `841bfee` 树 + 5 个身份文件改动（`package.json` 的 repository.url、
> `PROVENANCE.md` 的本仓库行、`README.en.md` 的产品名块、`index.html` 与 `tauri.conf.json` 的展示标题），
> **不含**冻结之后 ai-helper 线的任何提交，故本记录第 2 节的 222 / 60 / 89 / 1018 等数字全部不变。
> 当前指向以 `git rev-parse 'v2.0.0^{commit}'` 为准（本提交的哈希不能在自身内容里写死）。

> **2026-11-17 08:5x 第二次前移（品牌与文档统一）**：仓库更名后，`docs/` 82 篇文档的叙述名、
> 两份 `README` / `RULES` / `PROVENANCE` 的产品名、`productName`（`CipherCat` → `MetaCrypto Online IDE`）、
> 两份 `LICENSE` 的版权行、两处改名后失配的脚本配置（标准小节白名单、文档同步归一化规则），
> 以及随文档语料重建的检索索引，一并纳入 tag 树。本次仍**不含** ai-helper 线的任何提交：
> `tests/` 目录零改动，测试文件仍 **89** 个，222 / 60 / 1018 与 `docs/` 文件数 443 均不变；
> 改变的只是名称与产物元信息（`bundle` 增设 short/long description，deb `Description` 不再出现 `(none)`）。
> 当前指向仍以 `git rev-parse 'v2.0.0^{commit}'` 为准。

> **2026-11-17 09:4x 第三次前移（执行层命名）**：主二进制与桌面条目改名后，tag 树增加
> `mainBinaryName` = `metacrypto-online-ide`、`src-tauri/desktop/metacrypto-online-ide.desktop`
> （`Categories=Development;Education;`，`Exec` / `Icon` / `StartupWMClass` 走模板变量），
> 以及 `scripts/build-appimage.sh`、`docker/docker-build-windows.sh` 的同步改动。
> deb 实测 `usr/bin/metacrypto-online-ide`、`Package: meta-crypto-online-ide`、desktop 的 `Exec` 与 `Icon`
> 均为新名；启动后窗口标题 `MetaCrypto Online IDE`、WM Class `metacrypto-online-ide`。
> `identifier` 仍为 `com.ciphercat.editor`（数据目录不变）。`tests/` 仍 **89** 个文件，222 / 60 / 1018 不变。
> 为从旧包平滑升级，deb 另声明 `Provides` / `Conflicts` / `Replaces` = `cipher-cat`（旧包名），
> 使 `dpkg -i` 新包时自动移除 1.0.0 旧包，而不是并存两个图标。
> 当前指向仍以 `git rev-parse 'v2.0.0^{commit}'` 为准。
