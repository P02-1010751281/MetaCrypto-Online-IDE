# 对抗层第二轮裁决（metacrypt_server ae1e499..17b36ac，50 笔）

- 日期：2026-11-19
- 对象：50 笔提交（53 笔中除去第一轮已审的 `bd0b09f` / `917f16e` / `d7a02ea`）
- 席位：A1–A5 五席证伪（并发、互不重叠），B1–B2 两席逐字复核，主线程逐条复现
- 冻结：`OBJECTS.md5.txt`（50 行，自身 md5 `ab450721…`）

## 1. 席面与产量

| 席 | 覆盖 | 报告 | md5 | 结论条数 |
|---|---|---|---|---|
| A1 | MCLProver 写路径 + SQL + 测试（12 笔） | A1-report.md | `733537b9…` | 阻塞 1 / 缺陷 5 / 观察 2 |
| A2 | blockly 镜像保真 + lint 中立（6 笔） | A2-report.md | `4113d72f…` | 缺陷 7 |
| A3 | 模块化插件契约（10 笔） | A3-report.md | `be1d3ec8…` | 阻塞 2 / 缺陷 5 / 观察 2 |
| A4 | 保存契约与证据链（17 笔） | A4-report.md | `b0d30fc0…` | 缺陷 14（含误读） |
| A5 | 运维／安全／文档同步（5 笔） | A5-report.md | `e39acdc3…` | 缺陷 10 / 观察 2 |
| B1 | 复核 A1+A5 | B1-report.md | `e1e20a59…` | 17 条：holds 12 / partially 5 / does_not_hold 0 |
| B2 | 复核 A2+A3+A4 | B2-report.md | `62962ccb…` | 28 条：holds 19 / partially 6 / does_not_hold 3 |

## 2. 四分流（主线程复现后）

### 2.1 真缺陷（保留）

**阻塞级（3）**

| # | 位置 | 事实 | 复现 |
|---|---|---|---|
| R1 | `backend/sql/` | 16–34 号迁移在 HEAD **没有任何执行入口**：`00_init_all.sql` 46 行止于 `09_user_project_storage.sql`；`run_migration.py` 的 `_run_sql_file` 止于 `14_project_branches.sql`。按提交树交付时建不出库。`ee77619` 正文自己写了「登记留在工作区，随该会话提交入库」，但工作区那套未提交且引用未跟踪文件 | `git show HEAD:backend/sql/00_init_all.sql \| wc -l` = 46；`git show HEAD:backend/sql/migrations/run_migration.py \| grep -n '_sql'` |
| R2 | `docs/MODULAR-PLUGIN-ARCHITECTURE.md:169` | 「`frontend/src` 没有超过 500 行上限的 `.ts`/`.vue`」为假：实测 ≥8 个超限，最大 `TaskDetailView.vue` 972 行；同句「EditorView.vue 降到 496 行」实测 498，且 496 在任何提交上都不存在 | `git ls-tree -r --name-only HEAD frontend/src` 逐文件 `git show \| wc -l` |
| R3 | `8fa8202` | 「freeze modular plugin workspace baseline」无判据：仓库内无冻结定义/清单；被冻结对象（`frontend/src/features/blockly/plugins`）在该树为 0 文件；内容是 27 个后端 service、13 个迁移、9 页标准文档、6 张 PNG 的 WIP 汇聚 | `git ls-tree -r --name-only 8fa8202 frontend/src/features/blockly/plugins \| wc -l` = 0 |

**缺陷级（按主题归类，共 18 条）**

*MCLProver / SQL*
- R4 PG 30 号迁移缺 `ix_gov_approval_scope_digest`（MySQL 版 `:67` 有）——影响是前瞻性的：HEAD 无按该列的查询。
- R5 `ef214c7` 正文「38 文件」实测 37（HEAD 才是 38）。
- R6 「所有脚本自带 information_schema 守卫」不实：16/27/28/30/31 计数为 0。
- R7 接线门禁只钉 09 号，16–34 无人校验（`test_migration_runner.py`）。
- R8 `mclgate`/`FREEZE.sha256` 只覆盖 10 份语料 + EXEMPTIONS + vectors，不含代码/SQL/测试，且 FREEZE 无自锚。

*blockly 镜像*
- R9 三处 hand-edit：`core/constants/code-languages.ts` 长出 `MCL`；`components/BlocklyEditor.vue` 整文件分叉（props 不同）；`43b4e7c` 的 33 个文件对同步脚本完全隐形。
- R10 覆盖缺口：`grid-shape.ts`/`list-bridge.ts` 被 `cp` 却不在 `mirror_pairs()`，导出预检误报「未镜像」。
- R11 `cfd2d13` 正文「362 一致／27 差异」口径错，实为 379 一致 / 10 仅差目录改名。
- R12 `31dad11` lint 自动修复含 3 类源级改动（组件注册名 `svg-icon`→`SvgIcon`、`&quot;` 转义、25 处事件名 kebab 化）；经 Vue 回退解析后**渲染等价**，但与「纯格式」的叙述不符。

*插件契约*
- R13 UI lifecycle 文档称 5 态，代码只有 `frozen`/`disposed` 两个布尔。
- R14 生成器语言文档称 JS/Python 两种，代码是 3 类（含 `mcl`）。
- R15 `randomness_tasks.py:659` 的 GPU 回退分支不可达（`gpu_available` 恒 None），`gpu_fallback` 恒 False；无行为回归。
- R16 `DisplayStatus` 三套口径（`randomness.py` 合契约，`sbox.py`/`bruteforce.py` 把 success 与 fail 同映 done）。

*保存契约与证据*
- R17 唯一证据是一张任何实现下都会显示「已保存」的截图；`artifacts/` 8 次运行只跑四步门禁，不含单元测试与浏览器 E2E；`59/59` 依赖被 gitignore 的 `demos/`，干净 checkout 不可复现。
- R18 `07c4fa6` 的 provenance 自相矛盾（声称跑在 `6f9e3fd` 上，而那次运行早于该提交；前 3 次运行无 `git_head` 字段）。
- R19 后端冲突测试缺正样本（永远返回 conflict 的实现也能过）；`fbd3242` 新增的 64 项/version≥1 校验器 0 测试。
- R20 `3156575` 只计数 `bundleCalls`，未在 6 次后断言停止重试。

*运维／文档*
- R21 `af99af8` 引入 4 条在 metacrypt 必死的链接（`SPEC-CARDS.md`×3、`experiments/…/grid-harness/index.html`）。
- R22 `502ed90` 把 `docs/audits/` 引入本仓，但 `docsCatalog.ts` 无 `audits` 分支 → 14 份审计页从文档中心导航消失（正文内链仍可打开）。
- R23 `DOCUMENT-STATUS.md` 依据列仍写旧文件名；metacrypt 的 `SETUP.md` 标签指向 `../DEPLOYMENT.md`（CipherCat 已改 `../guides/SETUP.md`）。
- R24 `ced4568` 注释推荐 `CUDA_ARCH="35;50;60"`，该值进 Dockerfile 的 `nvcc -gencode` 会被 shell 拆开 → 按注释取值必挂（`backend-gpu.Dockerfile:21` 在本提交前已有同一条建议）；CUDA 旋钮未进 `.env.example`。
- R25 `08c936b`：新入库 `data.bin`（125,000 B）无来源/哈希/许可；新二进制 `go1.27.1` 与仓库钉的 `go 1.18`/CI `1.21`/镜像 `1.21.5` 不一致且无构建记录；`rddetector_linux` 成为无人引用的孤儿旧版（与改前 `rddetector` 同 md5）。

**主线程自查出的一条（已修）**
- R26 `17b36ac` 我写的那句「README 类目表保留 5 个类目这一合计」只在 CipherCat 成立、在 metacrypt 不成立（其 README 按目录列表，无该合计）。已改为点名两仓各自的写法，中英同步、两仓同步。

### 2.2 算错（reviewer 判定强于证据）

| # | A 的原判 | 反证 |
|---|---|---|
| E1 | A4：`SMOKE_PASSWORD` 是实际口令、管理员凭据进了版本库「代价远大于收益」 | 该字面值 8 字符，`md5 = 0192023a7bbd73250516f069df18b500` = RuoYi **默认种子口令**；首启 setup 成功即替换种子口令。属观察级 |
| E2 | A4：`b8a4cb3` 的测试反证文档「避免交叉」 | 断言的是「文件更新用当前快照、bundle 用发起时快照」，正好实现文档那句；该提交的真问题是「非活动 dirty 文件未 flush 就发 bundle」，证据在 `fbd3242` 的源码 diff |
| E3 | A4：删掉 `canRequestSave` 的 failed 用例仍全绿 | `workspace-session.test.ts:336` 的 `it.each(['conflict','partialFailure','failed'])` 直接断言 accepted，删掉必红 |
| E4 | A4：冲突态取消会谎报 ready | 该三态下 `applySaveResult` 已清空 `pendingSave`，`cancelQueuedSave` 走不到，场景不可构造 |
| E5 | A1：「`git grep '16_mclprover' tests/backend/unit` 无命中」 | 实有 2 处（`test_claim_event_digest.py`、`test_key_derivation.py`） |
| E6 | A5：`data.bin`「不是 NIST 素材」 | 只证到「≠ `data_e` 打包值」，不排除其它 NIST 样本 |
| E7 | A5：新旧二进制差「两个大版本」 | 1.27.1 对 1.21.5 是 6 个次版本；且旧二进制也已偏离，非本提交引入 |
| E8 | A5：`502ed90` 陈述「删除 backend/docs」不实 | 该提交正文自己写了「gitignored 未跟踪副本」，定性不成立 |
| E9 | A2：`31dad11` 含「语义变化」 | 三处源级改动经 Vue capitalize/kebab 回退后渲染等价；应表述为「与纯格式的叙述不符」而非「行为改变」 |
| E10 | A3：`8fa8202` 两条阻塞 | B2 判 partially：无判据成立，但「基线必须含契约」是假设（紧随其后的 `10c07f3` 表明它是开工前基线），等级应降为缺陷 |

### 2.3 编造

**0 条。** A 的每条引用都能按其命令逐字定位；被推翻的 10 条属「读法错误/等级过重」，不是凭空生成引文。

### 2.4 无法判定

| # | 争点 | 缺哪件证据 |
|---|---|---|
| U1 | 各笔提交里的运行期读数（pytest 2754/2789、`mclgate fails=0`、vitest 978、`vue-tsc`/`eslint` 0、`build:prod` rc=0、GPU 镜像真 build、截图拍摄时刻） | 仓库内无 CI 日志/JUnit/运行记录，本轮禁跑 build/test；只能证伪其可追溯性 |
| U2 | `8fa8202` 作者的真实意图（是否只是开工前快照） | 提交正文为空，无设计记录 |
| U3 | `rddetector` 新二进制出自哪份源码 | 无构建脚本记录、无源提交、stripped |

## 3. 口径与覆盖（必须连着结论一起读）

- **逐行读完的**：A1 读了 36k 行里的 4d364ba/1199395/ee77619/6a3a0e5 全部改动、SQL 16–34 双方言抽样 8 组索引、门禁脚本全文；A2 做了 389 对文件的机械比对（不是抽样）；A5 逐份读了 5 笔的全部改动。
- **抽样的**：A1 的 `6883f4c` 36k 行只做结构扫描 + 入口模块精读，其余 28 个 writer 模块未逐行；A4 的 17 笔里证据 JSON 全读、源码抽读。
- **没做的**：模型/GPU/浏览器任何运行时行为；`docs/design/mclprover` 十份语料只做了与代码的对照抽样。
- 因此本轮是「**结构性 + 证据级**」审查，不是「36k 行逐行对读」。任何「已复核」都不等于运行期已验证。

## 4. 修复清单（本轮只改了一条）

| 优先级 | 位置 | 最小修法 | 状态 |
|---|---|---|---|
| P0 | `backend/sql/00_init_all.sql`、`run_migration.py` | 把 16–34 号登记进执行入口（并把工作区那套未提交登记落库） | 待 owner/所属线 |
| P0 | `docs/MODULAR-PLUGIN-ARCHITECTURE.md:169` | 删掉「没有超过 500 行」的断言或改成「本项目新增代码」口径；496→498 | 待所属线 |
| P1 | `8fa8202` 相关文档 | 把「freeze baseline」改成事实描述（开工前快照/WIP 汇聚） | 待所属线 |
| P1 | PG `30_*.sql` | 补 `ix_gov_approval_scope_digest` | 待所属线 |
| P1 | `af99af8` 4 条死链 | 补同步 `SPEC-CARDS.md` 或把该行降级为文本 | 待所属线 |
| P1 | `docsCatalog.ts` | 给 `audits` 加分支（或明确隐藏并在说明页写清） | 待所属线 |
| P2 | 镜像 hand-edit 3 处 + `mirror_pairs` 2 处 | 在 CipherCat 侧改（单向镜像原则），或把差异登记为「本仓特有」 | 待所属线 |
| P2 | `ced4568` 注释 | 删掉带分号的 CUDA_ARCH 示例或改成 `$(...)` 安全写法；旋钮进 `.env.example` | 待所属线 |
| P2 | `08c936b` | `data.bin` 补来源/哈希/许可；`rddetector_linux` 删除或重建 | 需 owner 同意 |
| — | `CONFORMANCE-INVENTORY.md`（两仓） | 本轮已改：把「README 保留合计」收窄为点名两仓各自写法 | **已改** |
