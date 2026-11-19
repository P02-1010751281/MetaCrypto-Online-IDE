# 主线程裁决 — 对抗层（gated-review 步骤 4）

日期：2026-11-19｜裁决者：lead（生成者，按隔离规则不担任 A/B）
输入：`A-report.md`（A 席证伪）、`B-report.md`（B 席逐字复核）、本会话单遍审查的 6 条发现

## 0. 结算指纹（派单前 vs 结算时）

| 对象 | 派单时 md5 | 结算时 md5 | 结论 |
|---|---|---|---|
| `7b57abd` patch | `713a203ad8b0f68e5c6909f3a5363e3b` | 同 | 未被并发改动 |
| `1272230` patch | `0022112269d7ad015ed37ccc5fe3bd2d` | 同 | 同 |
| `bd0b09f` patch | `eb430e2f8c7b5f3f6981587f16f9b776` | 同 | 同 |
| `917f16e` patch | `d7d1473b2c05b98d1fde12e064fd3b63` | 同 | 同 |
| `d7a02ea` patch | `91c321e65403d291b955ce5f038942cd` | 同 | 同 |
| `OBJECTS.md5.txt` | `d60956e15ffdf3749c6fcf6f7ba11f1c` | 同 | 同 |

复算命令：`git diff <c>^ <c> | md5sum`（两仓各跑）、`md5sum OBJECTS.md5.txt`。

## 1. 门禁（组合任务必记：命令 + 退出码 + 未通过项）

| 门禁 | 命令 | 结果 |
|---|---|---|
| metacrypt 文档中心 + 语言包单测 | `cd metacrypt_server/frontend && npx vitest run ../tests/frontend/unit/features/docs ../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts` | rc=0，4 文件 / 29 用例通过 |
| CipherCat D 线单测 | `cd CipherCat && npx vitest run tests/unit/ai-helper-model-{failure-text,notes,provider,}.test.ts` | rc=0，4 文件 / 43 用例通过 |
| 文档相对链接（自建解析，非仓库门禁） | 见下 §3 D7 | 917f16e：21 份 md / 185 条相对链接 / **28 条在提交树内不可解析**；917f16e^ 同为 28 → 未新增 |
| 该仓是否有文档门禁 | `python3 -c "import json;print(json.load(open('frontend/package.json'))['scripts'])"` | **无** `docs:check-links` 一类命令，仅 lint:check / type-check / test:unit / verify:* |

## 2. 四分流

### 已核实为真（真缺陷）

| # | 位置 | 复现（可复制） | 实测 | 来源 |
|---|---|---|---|---|
| D1 | `metacrypt docs/guides/METACRYPT-SYNC.md:16-17` | `ls -1 frontend/src/features/blockly/views/editor/ \| grep -vc '\.css$'`；`grep -c '\.css$'`；`wc -l < views/EditorView.vue` | 文档写「7 模块 + 5 CSS = 12 文件」「491 行」；实测 **9 + 6 = 15 文件**、**498 行**；CipherCat 侧 `src/App.vue` 文档写 487，实测 **486** | 主线程 |
| D2 | `CipherCat experiments/.../RESULTS.md:4631` | `git show 7b57abd:.../RESULTS.md \| sed -n '4631p'`；`git show 7b57abd:tests/unit/ai-helper-model-notes.test.ts \| grep -c '  it('` | 写「8 组」，`it(` = **7**；同节 4646 自己写「+1 文件 7 条」，括号内也只列 7 项 | A#2（B: holds） |
| D3 | commit `d7a02ea` 正文 | `git show d7a02ea^:.../DocsView.vue \| wc -l`；`git diff --numstat d7a02ea^ d7a02ea -- .../DocsView.vue` | 写「DocsView.vue 原本 556 行」「400 余行分类/标题表」；实测父版 **913 行**（556 = 该文件 diff 变更行数 553+3），两张表在 `markdown.ts:184` 与 `:320`，拆出 **241 行** | A#3（B: holds） |
| D4 | commit `bd0b09f` 标题 | `git show bd0b09f --format='' \| grep '^+' \| grep -cE 'stw\|standardsToWorkspace'` | 标题写「D 线模型面板 117 行」；117 行中 **40 行**是 A 线 `stw*`/`standardsToWorkspace` 文案 | A#5（B: holds） |
| D5 | `RESULTS.md:4637` | `sed -n '4557p;4565p;4637p'` | 写「§66.6：65523 / 65536」；该数字在 **§66.7**（4565/4577），§66.6 是「没做的」 | A#6（B: holds） |
| D6 | `RESULTS.md:4665` ↔ `PARALLEL-EXECUTION.md:141` ↔ `AI-HELPER.md:198` | 三处 `git show ... \| sed -n` | RESULTS 说「owner 已裁决不做费用估算、§3.4 待办关闭」，但提案 §3.4 仍把「估算费用」列为必做 UI 项，使用页仍写「尚未实现」。三处口径不一，裁决未回写规格源 | A#1（B: holds；等级由「阻塞」降为「缺陷」） |
| D7 | `metacrypt docs/**` 28 条相对链接 | 见 §1 自建解析 | `../../demos/tests.json`、`../../demos/procedures/*.json`、`../../demos/evidence.json`、`../../package.json`、`../../experiments/...` 在提交树内均不可解析；**917f16e^ 同为 28 条**，且 `/demos/` 被 `.gitignore` 锚定为部署副本、根 `package.json` 因 `.gitignore` 首行 `/*` 未入库 | 主线程（A#7 只取到其中一部分） |
| D8 | `CONFORMANCE-INVENTORY.md:39` | `git show 917f16e:docs/standards/CONFORMANCE-INVENTORY.md \| sed -n '39p'`；`git show 7b57abd:README.zh-CN.md \| sed -n '123p'` | 写「README…不再使用单一数字」；README 仍写「17 个工具箱类目中有 5 个含 Blockly 内置积木」（英文孪生同句） | A#8（B: holds） |
| D9 | `metacrypt randomness/tools/rddetector/rddetector` | `git ls-files --stage ...`；`stat -c%s`；`git check-ignore -v ...` | **2,162,848 B 可执行二进制**已入库（同目录有 `build_linux.sh` 等构建脚本），`check-ignore` rc=1（未被忽略） | 主线程 |

### 算错（reviewer 的判定有偏差，按实测更正）

| # | A 的原判 | 出错点 | 更正 |
|---|---|---|---|
| E1 | A#7 判「CONFORMANCE 引用 CipherCat 路径 → 缺陷」 | 其中 `src/utils/toolbox-config.ts` 带「（源码路径：…）」标记（全文数十处同款），是镜像对不可达路径的**文本降级登记**，不是坏引用；`demos/tests.json` 被 `.gitignore` 锚定、工作区真实存在（108953 B），属同步脚本生成的部署副本 | 只保留「相对链接在干净克隆会 404」这一条（并入 D7） |
| E2 | A#10/#12 「运行期读数未归档 ⇒ 声称」 | 推论过强：`test:unit`、`build:check-bundle`、`vue-tsc` 都是**同树可复跑**的确定性门禁，任何人 checkout 即可核对；缺的是留痕不是真值 | 降为观察（见 O4） |

### 编造

**0 条。** A 报告的每条引用都能按其命令逐字定位到提交内原文；未发现凭空生成的引文、未发现把他人裁定写成本项目裁定。

### 无法判定

| # | 争点 | 两轮各判什么 | 缺哪件证据 |
|---|---|---|---|
| U1 | 「owner 已裁决不做费用估算」是否确有其事 | A：无仓库记录 → 阻塞；B：只能判三处口径不一，判不了裁决真假 | **2026-11-19 09:05 主线程补查（结案：无用户侧记录）**：扫 `.agents/memory/session-logs` 下 mtime ≥ 2026-11-12 的 **209 份 `session.jsonl`**（覆盖 ai-helper 全线窗口 2026-11-13 起），取 `user/message` 与 `ask_user_question` 应答两类事件、关键词 `费用`/`单价`：**真实命中 0 条**（唯一 2 处命中是 subagent 完成通知在转述 A 报告）。裁决文字只存在于助手自述——`RESULTS.md` §67.7（工作区行号 4840）与一份「四个裁决」汇总表。→ 结论：**目前没有任何用户侧记录能支撑这条裁决**，不是「取不到证」。确认前 `RESULTS.md:4840` 不得当作既定事实引用 |
| U2 | d7a02ea 正文「400 余行分类/标题表」是否指两张表本身 | A：指两表则假；B：对象未写，无法定论 | 提交正文未写对象，不可复原作者所指 |
| U3 | 干净克隆下 D7 的 28 条链接是否被仓库门禁拦 | 双方均未跑（本轮禁 build/install） | metacrypt 无 docs 链接门禁；需在只含 git 跟踪文件的树上自建检查 |

## 3. 观察（不改变结论，但需登记）

- **O1** 917f16e「18 份」口径未定义：按「目录内全部变更文件」= 7+10+2 = **19**；按「只计 .md」= 6+7+2 = **15**。提交信息只有混用单位时才自洽（B 席实测三种口径）。→ 建议后续提交把「份=文件」写死。
- **O2** bd0b09f 的 57 个镜像 locale 键（117 行 / 两语言）在 metacrypt `frontend/src` 里 `ui('<key>')` 命中 **0** 次（D 线面板未移植）；镜像按整文件同步属设计。
- **O3** `markdown.ts` 仍导出 `BLOCK_DOC_CATEGORIES`、`parseDocTitle`，外部引用 0；核对 `d7a02ea^` 同为 0 → **既存死代码**，不是拆分造成的。
- **O4** RESULTS 的运行期读数（1369 通过 / 1 跳过、`vue-tsc rc=0`、入口 65523 B）**未随提交归档**；本轮已在同一工作树复跑两份相关单测（§1），但 `git ls-tree 7b57abd` 无任何 dist/log 产物。
- **O5** 「20/20」浏览器探针：脚本未入库；本机 `.tmp-build/answer-note/summary.json` 记 `"ok": true` 20 条、`false` 0 条（186554 B 截图同目录），但 `.tmp-build/` 被 `.gitignore:17` 忽略。→ 属证据未归档，不是读数造假。
- **O6** 计数双源：README 与 CONFORMANCE-INVENTORY 各写一份「17/43/5/224/250」，两处都声称由 `toolbox-category-taxonomy.test.ts` 校验 → 单一权威未收敛。
- **O7** 中英双语漂移（既存）：`DOCUMENT-STATUS` 75/61、`PRODUCT-CERTIFICATION-FEASIBILITY` 183/185、`COVERAGE` 102/103；`917f16e^` 与 `917f16e` 四组行数完全相同 → 非本次同步引入。
- **O8** `docs/guides/AI-HELPER.md` 在 metacrypt 文档中心描述的是「MetaCrypto Online IDE 的 AI 助手」（页面首段已明示归属），但正文用「本页说明三个入口」；建议在该副本加一行「以下界面属 MetaCrypto Online IDE，本仓无该面板」。

## 4. 修复清单（本次**未**改动任何文件，按只审不改交付）

| 优先级 | 位置 | 最小修法 | 时机 |
|---|---|---|---|
| P1 | `METACRYPT-SYNC.md:16-17`（CipherCat 源） | 改 491→498、7+5=12→9+6=15、487→486；改完重跑 `sync-docs-to-metacrypt.sh` | 下一轮文档改动时一并 |
| P1 | `RESULTS.md:4631` | 「8 组」→「7 组」 | 下次动 RESULTS 时 |
| P2 | `RESULTS.md:4637` | 「§66.6」→「§66.7」 | 同上 |
| P2 | `PARALLEL-EXECUTION.md:141`、`RESULTS.md:4840`（工作区行号） | **U1 已结案：无用户侧记录**。二选一——(a) owner 现在补一句裁决，则按原方案在提案 §3.4 加一行、把 RESULTS 的「已裁决」改成引用该日期；(b) 裁决不成立，则 RESULTS:4840 改写为「费用估算仍未做，§3.4 待办继续挂着」，并恢复缺口口径 | 待 owner 一句确认（不再是「查不到」，而是「记录不存在」） |
| P2 | `CONFORMANCE-INVENTORY.md:39` | 改为「README 同时保留单一数字与三类分述」 | 源仓改动时 |
| P3 | `demos/*` 相对链接 | 与全文一致改成「源码路径」纯文本，或补「目标仓由同步脚本部署」一句 | 文档轮次 |
| P3 | `randomness/tools/rddetector/rddetector` | 出库 + `.gitignore` 加该产物（释放 2.1 MB 不透明二进制） | 需 owner 同意 |
| — | 三笔 commit message（D3/D4/D5 类） | 已推送，不重写历史；在上表文档更正处注明 | 不修 |

## 5. 未覆盖

- 分支其余 47 笔（MCLProver 写路径、blockly sync）未进本轮对象，只做过结构性扫描。
- 三份 `SPEC-CARD.json` 的漂移是否应计入「份」：取决于同步脚本对 json 的口径，本轮未跨仓读脚本。
- 干净克隆下的链接门禁（U3）：metacrypt 无该门禁，需自建后另跑。
