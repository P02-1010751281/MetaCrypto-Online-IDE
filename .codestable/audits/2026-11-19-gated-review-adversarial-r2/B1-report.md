B1-SEAT checks=17 holds=12 partially=5 does_not_hold=0

# B1 复核席报告 — A1（MCLProver 写路径 12 笔）+ A5（运维/安全/文档同步 5 笔）

| 项 | 内容 |
|---|---|
| 被审仓库 | `metacrypt_server`，分支 `codex/modular-plugin-workspace-architecture`，HEAD `17b36ac`（`git rev-parse` 实取） |
| 真源仓 | `CipherCat`，对照版本 `ef6e76f`（A5 报告声明值） |
| 复核对象 | A1-report.md 的全部「阻塞/缺陷」+ 1 条同源观察；A5-report.md 的全部「缺陷」+ 1 条同源观察 |
| 方法 | 只用只读命令：`git show / diff / log / ls-tree / cat-file / grep`、`sed -n`、`wc`、`md5sum`、`sha256sum`、`file`、`strings`；一次 `sh -xc` 的变量展开演示（未执行 nvcc，未 build） |
| 未做 | 未 build、未 install、未 docker/podman、未跑 pytest/迁移/门禁；两仓只改本文件 |
| 口径 | 一切结论按**已提交 blob**（`git show <rev>:<path>`）复算。两仓工作区均脏（`git status --porcelain`：metacrypt 179 条、CipherCat 35 条），工作区状态不作为判定依据 |
| 已知免复 | A4 无关（未读）；`SMOKE_PASSWORD` 条不在 A5（属 A4，已跳过）；A1「16–34 无执行入口」主线程已判，本席仍独立取证并记入 `[#2]` 作为确认 |

**速查（按硬规则逐条可勾销）**

- `[#1] holds` PG 30 号缺 `ix_gov_approval_scope_digest`；影响句所指查询在 HEAD 不存在
- `[#2] holds` init 46 行止于 09、runner 止于 14 —— 确认主线程结论
- `[#3] holds` `ef214c7` 树内 37 个单测文件，正文写 38
- `[#4] holds` 16/27/28/30/31 五份迁移 `information_schema` 计数为 0
- `[#5] partially` 接线门禁只钉 09 成立；但 A 的 `git grep '16_mclprover' ... 无命中` 是假阳
- `[#6] holds` 冻结面 14 条不含 code/SQL/tests
- `[#7] partially` 多架构取值必挂成立；同一建议在 Dockerfile:21 早已存在（A 漏）
- `[#8] partially` `.env.example`/DEPLOYMENT 未同步成立；「只落在 compose 里」不准
- `[#9] holds` `docs/audits/` 无前端分类分支，导航消失
- `[#10] holds` DOCUMENT-STATUS 依据列仍写旧同目录文件名
- `[#11] holds` CONFORMANCE 口径句在 metacrypt 描述了一张不存在的 README 表
- `[#12] holds` `af99af8` 引入 4 条在 metacrypt 必死的链接
- `[#13] holds` SETUP 链接标签与目标不符
- `[#14] partially` `data.bin` 无来源/哈希/许可成立；「它不是 NIST 素材」未证
- `[#15] holds` 二进制刷新无构建出处，go1.27.1 对 1.21.5；「两个大版本」措辞错
- `[#16] holds` `rddetector_linux` 成过期分叉 + PE objdump 过期
- `[#17] partially` `502ed90` diff 内确实无 `backend/` 删除；但「提交信息陈述不实」不成立

---

## 面 A1 — MCLProver 写路径（12 笔）

- [#1] A原判：缺陷 / A1 §2.1 — MySQL 30 号有 `ix_gov_approval_scope_digest`，PG 版没有 | 原文引用：`KEY \`ix_gov_approval_scope_digest\` (\`approval_scope_digest\`),`（`backend/sql/migrations/30_mclprover_approval_binding.sql:67`）；PG 侧仅 `CONSTRAINT uq_gov_approval_scope_binding` / `UNIQUE (approver_identity_digest, approval_action, approval_scope_digest),`（`postgres/30_...sql:45-46`） | 我的命令：`git show HEAD:backend/sql/migrations/30_...sql \| grep -n approval_scope_digest`；`git show HEAD:.../postgres/30_...sql \| grep -n 'approval_scope_digest\|CREATE INDEX'`；`wc -l` | 实测：MySQL 命中 `:67` 的 KEY；PG 全文件 154 行内 `grep 'CREATE INDEX\|CREATE UNIQUE INDEX'` **0 行**，`approval_scope_digest` 只出现在列定义 `:32`、UNIQUE `:46`、CHECK `:57`、触发器 `:132-133` | 判定：**holds** | 说明：事实与修法目标成立，属于「双方言同序镜像」断言被打破。**范围须收窄**：A 的影响句「同一条按 `approval_scope_digest` 的查询…走不同的计划」在 HEAD 找不到这样的查询——`git grep -n WHERE HEAD -- backend/sql/migrations \| grep approval_scope_digest` 与 `git grep -n 'SELECT.*approval_scope_digest' HEAD -- backend` 均 0 命中，该侧表在代码里只被 INSERT。故应写成「未来按该列单独检索时两方言计划不同」，等级保留但别当现有性能问题。非假阳。

- [#2] A原判：阻塞 / A1 §5.1 — 16–34 号迁移在 HEAD 无任何执行入口 | 原文引用：`source /docker-entrypoint-initdb.d/migrations/09_user_project_storage.sql;`（`backend/sql/00_init_all.sql:46`，全文件末行）；`os.path.join(_sql_dir, "14_project_branches.sql"),`（`backend/sql/migrations/run_migration.py:180` 一带） | 我的命令：`git show HEAD:backend/sql/00_init_all.sql \| wc -l`；`git show HEAD:backend/sql/00_init_all.sql \| sed -n '40,46p'`；`git show HEAD:backend/sql/migrations/run_migration.py \| sed -n '165,190p'` | 实测：init 共 **46** 行，40–45 为 `03..08` 号，46 为 `09`；runner 的 `_run_sql_file` 序列止于 `14_project_branches.sql`，其后直接 `conn.commit()` | 判定：**holds**（与主线程已复核结论一致；本席独立取证，非引用 A 输出） | 说明：无假阳、无漏报补充。级别「阻塞」成立：按 HEAD 建库不会创建任何 MCLProver 表。

- [#3] A原判：缺陷 / A1 §5.2 — `ef214c7` 正文写「38 文件」，该提交实为 37 | 原文引用：`- tests/backend/unit/mclprover（38 文件）：纯函数与载荷/摘要/成员集对咬，`（`git show -s --format=%b ef214c7` 第 3 行） | 我的命令：`git ls-tree -r --name-only ef214c7 -- tests/backend/unit/mclprover \| wc -l`；`git ls-tree -r --name-only HEAD -- tests/backend/unit/mclprover \| wc -l` | 实测：`ef214c7` = **37**；`HEAD` = **38** | 判定：**holds** | 说明：可复算的数字失实，A 的修法（改 37 或声明 38 是 HEAD 口径）正确。非假阳。

- [#4] A原判：缺陷 / A1 §5.3 — 「所有脚本自带 information_schema 存在性守卫」对 5 份不成立 | 原文引用：`所有脚本自带 information_schema 存在性守卫，可重复执行；29 必须早于 30、`（`git show -s --format=%b 753761f` 第 9 行） | 我的命令：`for n in $(seq 16 31); do f=$(git ls-tree -r --name-only HEAD -- backend/sql/migrations \| grep -E "/${n}_" \| grep -v postgres); git show "HEAD:$f" \| grep -c information_schema; done` | 实测：`16=0 17=1 18=1 19=8 20=11 21=19 22=71 23=16 24=9 25=26 26=1 27=0 28=0 29=4 30=0 31=0` —— 与 A 报的 16 个数逐位相同，零守卫的正是 16/27/28/30/31 五份 | 判定：**holds** | 说明：机理性断言的字面失实成立。A 补的「30/31 表已存在但 CHECK 缺项时 `CREATE TABLE IF NOT EXISTS` 不会补」与 32/34 的存在理由自洽，属有效补充而非编造。非假阳。

- [#5] A原判：缺陷 / A1 §5.4 — 接线门禁只钉 09 号，新增迁移「不加线也不红」 | 原文引用：`assert "migrations/09_user_project_storage.sql" in init_script` / `assert '"09_user_project_storage.sql"' in runner`（`tests/backend/unit/test_migration_runner.py:75-76`）；A 的支撑句「`git grep '16_mclprover' -- tests/backend/unit` 无命中」 | 我的命令：`git show HEAD:tests/backend/unit/test_migration_runner.py \| sed -n '55,76p'`；`git grep -c '16_mclprover' HEAD -- tests/backend/unit`；`git grep -n '00_init_all' HEAD -- tests` | 实测：该测试 66–76 行只对 09 做「init + runner 双登记」断言（且只读 `00_init_all.sql` 与 `run_migration.py` 两个文件）；**但 `16_mclprover` 在 `tests/backend/unit` 命中 2 个文件**：`mclprover/test_claim_event_digest.py:1`、`mclprover/test_key_derivation.py:1`；读 `00_init_all.sql` 的测试全树仅 `test_migration_runner.py:69` 一处 | 判定：**partially** | 说明：**结论成立**（没有任何门禁断言 16–34 的 init/runner 双登记，5.1 的缺失不会被单测抓到），修法目标正确。**但支撑证据是假阳**：`git grep '16_mclprover' -- tests/backend/unit` 明明有 2 处命中（用途是逐字解析 16 号 DDL 做摘要对咬，与接线无关）。正确写法应是「这些命中只读迁移正文、不读 `00_init_all.sql`/`run_migration.py` 的登记列表」。等级（缺陷）不变。

- [#6] A原判：观察（与 `[#5]` 同源）/ A1 §5.6 — 冻结面不含代码、SQL、测试与本组新增路径 | 原文引用：`# Aggregate: 3cb300383fcc9e5f782071f37ff7d0d5aaf820da5a78fdc40fe66914d6276c6b`（`docs/design/mclprover/FREEZE.sha256:1`）；其下 14 条为 `INDEX.md`…`70-INTEGRATION-SECURITY.md`、`EXEMPTIONS.sha256`、`vectors/*` 三件（`:6-19`）；`FILES = [` 后的 10 份 `.md`（`docs/design/mclprover/tools/mclgate.py:21-27`） | 我的命令：`git show HEAD:docs/design/mclprover/FREEZE.sha256 \| cat -n`；`git show HEAD:docs/design/mclprover/tools/mclgate.py \| sed -n '18,30p'` | 实测：FREEZE 19 行 = 4 行头 + 14 条 digest + 1 行注释头；聚合值与 A 报的 `3cb3003…` 逐字相同；`FILES` 恰为 10 份 `.md`，无 `backend/**`、`backend/sql/migrations/**`、`tests/**`、`docs/reviews/**`、`docs/design/mclprover-impl/**` | 判定：**holds** | 说明：边界陈述准确，「真正的锚是 git 历史」的判断成立。同源补充（本席独立核到）：A1 §1.4 的「claim 事件键 DB 侧只有形状 CHECK」为真——`ck_claim_draft_event_key_shape` 是 `REGEXP_LIKE(semantic_idempotency_key, CONCAT('^', event_type, ':claim-draft:[0-9a-f]{64}$'))`（`16_mclprover_claim_events.sql:87-89`），而 `trg_claim_draft_event_cas` 只比较 `expected_sequence` 与链头（`:134-148`），不重算键；「门禁面窄于自称」在两处同构。

---

## 面 A5 — 运维 / 安全 / 文档同步（5 笔）

- [#7] A原判：缺陷 / A5 §1.3 — 注释推荐的「多卡」取值会把构建打挂 | 原文引用：`# 只编宿主实际使用的 CUDA 架构（默认 sm_35 = GT 710/GK208）；多卡时在 docker/.env 里设 CUDA_ARCH="35;50;60"。`（`docker/docker-compose.yml:190`，`ced4568` 新增行）；`RUN nvcc -O3 -gencode arch=compute_${CUDA_ARCH},code=sm_${CUDA_ARCH} -shared -Xcompiler -fPIC \`（`docker/backend-gpu.Dockerfile:59`） | 我的命令：`git show ced4568 --format='%H%n%s%n%b' -- docker/docker-compose.yml`；`git show ced4568^:docker/backend-gpu.Dockerfile \| sed -n '19,23p'`；复现 Docker「先替 ARG、再交 sh」：`cmd='nvcc -O3 -gencode arch=compute_35;50;60,code=sm_35;50;60 -shared -Xcompiler -fPIC'; sh -xc "$cmd"` | 实测：diff 仅 5 行新增（注释 2 + `args:` 3），注释确为该提交引入；`sh` 输出 `+ nvcc -O3 -gencode arch=compute_35` / `+ 50` / `+ 60,code=sm_35` …（`;` 被当命令分隔符，nvcc 收到的第一条参数已残缺） | 判定：**partially** | 说明：技术结论成立（按该取值 `des_search.cu` 一步必失败，CMake 路径能过而 `verify-gpu.sh:38` 只走 CMake，故验证脚本过≠镜像能 build）。**漏报**：完全相同的建议在 `docker/backend-gpu.Dockerfile:21` 早已存在——`# 需要多架构时显式传入，例如：--build-arg CUDA_ARCH="35;50;60"`（`ced4568^` 已读，非本提交引入）。因此这不是本提交新造的坑，而是把既有坏建议复制进 compose；只按 A 的修法删 compose 注释会留下 Dockerfile:21 同一颗雷。归因与修法范围都需扩到两处。

- [#8] A原判：缺陷 / A5 §1.4 — 新变量没进 `.env` 模板 | 原文引用：`docker/.env.example` 全文（`git show HEAD:docker/.env.example \| wc -l` = 18 行，`grep CUDA` 无输出）；`docker/.env.example 仅是变量模板，不包含可用密钥。复制为 docker/.env 后填写本机值；该文件不得提交或公开。可选配置如下：`（`docs/DEPLOYMENT.md:143`） | 我的命令：`git show HEAD:docker/.env.example \| grep -n CUDA`（rc=1）；`grep -n CUDA docker/.env.example`（工作区，rc=1）；`git show HEAD:docs/DEPLOYMENT.md \| sed -n '143,168p'`；`git show HEAD:docs/DEPLOYMENT.md \| grep -n build-arg`（rc=1） | 实测：HEAD 与工作区的 `.env.example` 都没有 `CUDA_*`；DEPLOYMENT 143 起的「可选配置」代码块只有 MYSQL/密钥/Redis/Celery 四组，无 `CUDA_ARCH`；全文 `grep CUDA_ARCH` 0 命中 | 判定：**partially** | 说明：「`.env.example` 与部署手册未同步该旋钮」成立，属真实的参数化落点缺失。**范围不准**：A 的总结句「参数化只落在 compose 里」不成立——`docker/backend-gpu.Dockerfile:15/22` 的 `ARG CUDA_IMAGE`/`ARG CUDA_ARCH=35` 与 `docker/verify-gpu.sh:15/38` 的 `${CUDA_ARCH:-35}` 都在消费该变量，且 Dockerfile:21 已写 `--build-arg` 用法；「只有读过 compose 注释的人知道」过度。等级「缺陷（偏低）」可保留。

- [#9] A原判：缺陷 / A5 §2.3 — 搬进 `docs/audits/` 的审计文档在文档中心「消失」 | 原文引用：分类器分支全集 `if (parts.length === 1 \|\| (top === 'research' && parts.length >= 2))`（`docsCatalog.ts:46`）、`if (top === 'standards' && parts.length === 2)`（`:64`）、`guides`（`:79`）、`demos\|build`（`:95`）、`blocks`（`:111`）、`standards ≥3`（`:128`）；`const hiddenCategories = new Set(['audit-reports', 'research'])`（`:148`） | 我的命令：`git ls-tree -d --name-only 502ed90^:docs` / `502ed90:docs`；`git grep -rn 'audits' HEAD -- frontend/src`；`git show HEAD:frontend/src/features/docs/utils/docsCatalog.ts \| sed -n '43,145p'`；`git ls-tree -r --name-only HEAD:docs/audits \| grep -c '\.md$'`；`git show HEAD:backend/owl_admin/controller/docs.py \| sed -n '25,45p'` | 实测：docs 顶层由 6 个目录变 7 个（新增 `audits`）；`git grep -rn 'audits' HEAD -- frontend/src` **0 命中**；分支集合里无任何 `top === 'audits'`，且 `parts.length < 2` 只挡单段路径，`audits/README.md`（2 段）与 `audits/standards/*.md`（3 段）落不进任何 `if`，循环结束即丢弃；`docs/audits` 下共 **14** 份 md（README 中英 2 + project 2 + standards 10）；后端 `os.walk(DOCS_ROOT)` 全量入 `docFiles`，`DocsView.vue:326` 的 `docFiles.value.includes(docLink.path)` 内链仍可打开 | 判定：**holds** | 说明：结论与机制成立（不丢内容、丢导航）。两处口径需收紧：① 小节标题写「12 份」，自报验收却是 14 份，按树实测应统一写 14；② `AUDIT-REPORT` 的 `GUIDE_CATEGORIES` 映射为 `audit-reports`（`markdown.ts:231`），而 `audit-reports` 在 `hiddenCategories` 里，故 `docs/audits/project/AUDIT-REPORT.md` **搬移前就已不可见**，A「改前分别命中 guides 分支」只说明匹配、不说明可见；「现在全部 audits 页不在导航」仍成立。

- [#10] A原判：缺陷 / A5 §2.4 — `DOCUMENT-STATUS.md` 依据列仍写旧同目录文件名 | 原文引用：`| 含文本层的 PDF | … | \`SOURCE-QUALITY-AUDIT.md\`、\`pdftotext\`、渲染页复核 |`（`:21`）、`| 原文/研究证据层 | … | \`SOURCE-LAYERS.md\`、各目录的 \`00-*.md\` |`（`:23`）、`… \`SOURCE-QUALITY-AUDIT.md\`、\`SOURCE-SPLIT-COVERAGE.md\`、\`STRUCTURED-ENTRY-SCHEMA.md\` |`（`:25`）、`… \`FUNCTION-PRIMITIVE-INDEX.md\`、\`SOURCE-SPLIT-INVENTORY.md\`、\`SOURCE-SPLIT-COVERAGE.md\` |`（`:26`） | 我的命令：`git show HEAD:docs/standards/DOCUMENT-STATUS.md \| sed -n '18,30p'`；`git ls-tree -r --name-only HEAD:docs/standards \| grep -E 'SOURCE-'`；`git ls-tree -r --name-only HEAD:docs/audits/standards` | 实测：21/23/25/26 四行原文与 A 摘录逐字一致；`docs/standards` 下 `SOURCE-*` **0 行**；`SOURCE-LAYERS.md`、`SOURCE-QUALITY-AUDIT.md`、`SOURCE-SPLIT-COVERAGE.md`、`SOURCE-SPLIT-INVENTORY.md` 均在 `docs/audits/standards/`（各带 `.en.md`）；`FUNCTION-PRIMITIVE-INDEX.md` 确仍在 `docs/standards/`（混排成立） | 判定：**holds** | 说明：行内代码不是链接，`docs:check-links` 抓不到，读者按同目录落空——成立。非假阳。

- [#11] A原判：缺陷 / A5 §3.1 — CONFORMANCE 的新口径句在 metacrypt 描述了一张不存在的表 | 原文引用：`README 因此改为按「纯自带 / 混用 / 项目块」三类分述，并在类目表保留「5 个类目含自带积木」这一合计——分类明细与合计并存，合计口径即本节 2 + 3。`（`docs/standards/CONFORMANCE-INVENTORY.md:39`，`17b36ac` 新增行） | 我的命令：`git show 17b36ac --format='' -- docs/standards/CONFORMANCE-INVENTORY.md \| grep -n '^+.*README 因此改为'`；`git show HEAD:README.md \| grep -cE '自带积木\|混用\|纯自带\|项目块\|5 个类目'`；`git show HEAD:README.md \| grep -c '基础变量'`；`git show ef6e76f:README.zh-CN.md \| sed -n '121,125p'` | 实测：该句确由 `17b36ac` 加入（diff 第 10 条 `+` 行）；metacrypt README 两个计数均为 **0**，其类目表是 `### 积木块体系（17 类目）` 的 13 行「类目/目录/说明」按目录列举；CipherCat `README.zh-CN.md:123` 为 `| 函数与 Blockly 内置类目 | 29 个函数模板；17 个工具箱类目中有 5 个含 Blockly 内置积木 |`，`基础变量` 命中 1 次 | 判定：**holds** | 说明：断言「README 已经这样写」在本仓为假，成立。补：同一句在 CipherCat 侧也存在（`grep -c` = 1），故这是**同步保真**问题（整段搬入/未按本仓降级），不是本仓编造——修法应在同步规则或本仓 README/句子上二选一，A 的「两处任选其一」正确。

- [#12] A原判：缺陷 / A5 §4.2 — `af99af8` 新引入 4 条在 metacrypt 必然死掉的链接 | 原文引用：`| [\`npm run spec:validate\`](../guides/SPEC-CARDS.md) | 重算制品哈希、引文锚点、块与类型引用 |` 等三行（`SPEC-CARD-MATRIX.md` 新增行）；`… \`grid-harness\`](../../experiments/ai-helper-2026-11-14/grid-harness/index.html) …`（`CONFORMANCE-INVENTORY.md` 新增行） | 我的命令：`git show af99af8 --format='' -- docs/standards/SPEC-CARD-MATRIX.md \| grep -E '^\+.*SPEC-CARDS'`；`git cat-file -e HEAD:docs/guides/SPEC-CARDS.md`；`git cat-file -e ef6e76f:docs/guides/SPEC-CARDS.md`（CipherCat）；`ls -d experiments`；`git ls-tree -d --name-only HEAD \| grep -c experiments`；`git ls-tree -r --name-only af99af8^\|grep SPEC-CARD-MATRIX` | 实测：三行原文逐字相符；`HEAD:docs/guides/SPEC-CARDS.md` **不存在**（rc=128），CipherCat `ef6e76f` 存在（rc=0）；`experiments/` 在 metacrypt git 树 0 命中、磁盘亦无；`SPEC-CARD-MATRIX.md` 在 `af99af8^` 不存在（rc=128），确为本次新增页 | 判定：**holds** | 说明：4 条死链成立。同源观察（A5 §4.4）本席抽查两项：`/demos/` 在 `.gitignore:52` 且磁盘存在（`ls demos` 有 AES-Atomic-Round.json 等），`package.json` 在磁盘存在、`HEAD` 不含（`git cat-file -e HEAD:package.json` rc=128）——A 把这两类归为「同步产物不入库的既有设计、不计本轮缺陷」正确，未混入 4 条真死链。

- [#13] A原判：缺陷 / A5 §4.3 — `DOCUMENT-STATUS.md` 的 SETUP 链接两仓不一致 | 原文引用：`| [SETUP.md](../DEPLOYMENT.md) | 2 | 文档分组和开发模式验收 |`（`metacrypt HEAD:docs/standards/DOCUMENT-STATUS.md:58`） | 我的命令：`diff -u <(git show HEAD:docs/standards/DOCUMENT-STATUS.md) <(git -C CipherCat show ef6e76f:docs/standards/DOCUMENT-STATUS.md)`；`git ls-tree -r --name-only HEAD:docs/guides \| grep -i setup`；`git -C CipherCat ls-tree -r --name-only ef6e76f:docs/guides \| grep -i setup` | 实测：diff 只有三处，其中 `-| [SETUP.md](../DEPLOYMENT.md)` / `+| [SETUP.md](../guides/SETUP.md)`；metacrypt `docs/guides` 下 setup **无输出**；CipherCat 有 `SETUP.md`、`SETUP.en.md`；`HEAD:docs/DEPLOYMENT.md` 存在（rc=0） | 判定：**holds** | 说明：标签与目标不符、指向的文件存在不会 404——等级「偏低」准确。非假阳。

- [#14] A原判：缺陷 / A5 §5.2 — `data.bin` 无来源、无哈希、无许可，且「它不是 NIST 素材」 | 原文引用：`| \`data.bin\` | 原始字节 | 125,000 字节，正好 1,000,000 bit | \`rddetector --suite nist\` 的二进制输入回归 |`（`randomness/data/README.md:8`，全文件 22 行，无来源/哈希/许可行） | 我的命令：`git cat-file -s 08c936b:randomness/data/data.bin`；`git show 08c936b:randomness/data/data.bin \| sha256sum`；`\| md5sum`；`\| file -`；`git show 08c936b:randomness/data/README.md \| cat -n`；`git show HEAD:randomness/LICENSE \| head -5`；`git grep -n 'data\.bin' HEAD -- .` | 实测：125000 字节；`sha256=60d4948008872854431773cfd6ffd0e0024e74054d6e9f2cf13e72db833e6db2`（与 A 逐字同）；`md5=85b1d8fd63d7ffe44d44a89d8a87cb66`；`file` = `data`；README 22 行只有格式/规模/用途 + CLI 示例 + 免责句，**无来源、无哈希、无许可**；LICENSE 为 MIT（`Copyright (c) 2022 Quan Guanyu`）；全仓引用 `data.bin` 的只有 README 三处 + `overhead_profiler/main.go:13` 的注释 | 判定：**partially** | 说明：**成立部分**——入库 125 KB 二进制夹具没有可复核出处/哈希/许可，这是可审计性缺陷，修法（补来源 + SHA-256 + 许可，或改名去掉 NIST 暗示）合理。**不成立部分**——「而且它不是 NIST 素材」未被证明：A 的论据只是「≠ `data_e` 打包结果（125,611 字节）」，这不能排除 NIST STS 其它样本文件；提交主题 `add NIST fixture` 也可读作「给 NIST 套件加夹具」，把它读成「冒充 NIST 出处」是过度解读（A 自己也标了「推断」）。**验收不可执行**：要求「提交信息不再称其为 NIST 夹具」需要重写历史，不可作为验收项。**漏报查证（无）**：同目录另有 `randomness/tools/rddetector/tmp.dat` 同为 125,000 字节，本席比对 `md5=124c698a…` ≠ `85b1d8fd…`、git blob `ffdf3c…` ≠ `2e3379…`，确认不是重复入库——A 的「新入库二进制」判断正确，此项不算漏报。

- [#15] A原判：缺陷 / A5 §5.3 — 二进制刷新没有构建出处，且与仓库钉住的工具链不一致 | 原文引用：`go 1.18`（`randomness/go.mod:3`）；`goVer: ['1.18', '1.21']`（`randomness/.github/workflows/go.yml:18`）；`RUN wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz \`（`docker/backend-gpu.Dockerfile:34`）；`go build .`（`randomness/tools/rddetector/README.md:51`，README「编译」节全文无版本/摘要/源提交） | 我的命令：`git show 08c936b:.../rddetector \| strings -a \| grep -oE 'go1\.[0-9]+(\.[0-9]+)?' \| sort -u`；旧版同法；`git show HEAD:randomness/tools/rddetector/README.md \| grep -niE 'go1\.\|go 1\.\|sha256'` | 实测：新版 `go1.27.1`，旧版 `go1.25.4`；README 只有 `## 编译` / `go build .`，无 Go 版本、无源提交、无 sha256 | 判定：**holds** | 说明：「同一源码 + 不同工具链 → 字节不可复核」的结论成立，修法（README 记构建命令/版本/源提交/sha256）正确。三处需校正：① 「新两个大版本」措辞错——1.27.1 对钉住的 1.21.5 是 **6 个次版本**，Go 没有这种「大版本」说法；② 旧二进制也是 go1.25.4，故「与仓库钉住的工具链不一致」**改前已存在**，本提交只是继续偏离（A 的「2.1 MB 既有问题扩大版」在 §5.4 提到，但 §5.3 未点明）；③ 仓库里没有任何 README 记录该产物出处，本席复核确认（非漏报）。

- [#16] A原判：缺陷 / A5 §5.4 — 刷新只换了一个，`rddetector_linux` 成过期分叉（并含 PE 反汇编过期） | 原文引用：`100755 blob 9ffc43235db1327b78356ea3543cf5eeadce9488 2056376 randomness/tools/rddetector/rddetector_linux`；`tools\rddetector\rddetector.exe:     file format pei-x86-64`（`randomness/rddetector_objdump.txt` 第 1 行） | 我的命令：`git show 08c936b^:.../rddetector \| md5sum`；`git show HEAD:.../rddetector \| md5sum`；`git show HEAD:.../rddetector_linux \| md5sum`；`git ls-tree -r -l HEAD -- randomness/tools/rddetector`；`git cat-file -s HEAD:randomness/rddetector_objdump.txt`；`git show HEAD:randomness/rddetector_objdump.txt \| file -`；`git show HEAD:randomness/rddetector_objdump.txt \| grep -c '1\.5\.0'`；`git cat-file -e HEAD:.gitattributes`；`git grep -n 'rddetector_linux' HEAD -- randomness` | 实测：改前 `rddetector` md5 `0cd164fdd938a883105934f12cddf019` = 现 `rddetector_linux` 同值；改后 `rddetector` `e3f992fe89d5107d30e0498e13849666`；尺寸 2162848 / 2056376；objdump 831357 字节、`file` 判为 ASCII text、首行是 PE 符号转储、`1.5.0` 计数 0；`.gitattributes` 不存在（rc=128）；`rddetector_linux` 仅被 `build.bat`/`build.sh` 以 `target/rddetector_linux_amd64` 形式命名，**没有任何脚本或文档引用树里的 `rddetector_linux`** | 判定：**holds** | 说明：分叉与过期反汇编成立，且本席补强一点：`rddetector_linux` 是无人引用的孤儿文件（构建脚本输出名带 `_amd64`），比 A 写的「过期分叉」更明确。A 的「约 4.0 MB ELF + 0.83 MB 转储」复算相符（2162848+2056376=4219224）。

- [#17] A原判：观察（与 `[#9]`/`[#10]` 同源）/ A5 §2.1 — 「`502ed90` 没有删 `backend/docs`」，提交信息读起来像已统一清理（陈述不实） | 原文引用：`同时删除 backend/docs/（48MB / 419 文件，gitignored 未跟踪）：`（`git show -s --format=%b 502ed90` 第 11 行） | 我的命令：`git show 502ed90 --diff-filter=D --name-only --format=''`；`git show 502ed90 --format='' --name-only \| grep -c '^backend/'`；`git show HEAD:.gitignore \| grep -n 'backend/docs'`；`git log --oneline --diff-filter=D -- 'backend/docs/*'` | 实测：diff 删除 4 个文件，全是 `docs/standards/SOURCE-*`；`backend/` 路径 **0** 条；`.gitignore:50` 为 `/backend/docs/`；删除跟踪树的提交是 `c5d35cd`（2026-08-02） | 判定：**partially** | 说明：**成立部分**——该提交的 diff 里确实没有任何 `backend/` 删除，目录自 2026-08-02 起不在跟踪树、且被 `.gitignore:50` 忽略，故这笔「删除」无法随 clone 传播，A 的事实核对正确且有用。**不成立部分**——A 的定性「提交信息读起来像已经统一清理/陈述不实」是假阳：正文自己写了「gitignored 未跟踪」，是对删除对象的准确标注，不是把未跟踪副本说成版本库删除。另 A 的「任何旧副本的 clone 仍带着 `backend/docs`」表述不当：HEAD 的 clone 不含该目录，只有检出 2026-08-02 之前提交的树才含。等级「观察」可保留，但理由应改成「提交信息把工作区清理与版本库变更写在同一句，易被误读」，而不是「陈述不实」。

---

## 结算

**假阳（下了不成立/失实的结论或证据）**

1. `[#5]` A1 §5.4 的支撑句 `git grep '16_mclprover' -- tests/backend/unit 无命中` —— 实际 2 处命中；结论本身另证成立。
2. `[#17]` A5 §2.1 的定性「提交信息陈述不实」—— 正文已明确写 `gitignored 未跟踪`，属准确标注。
3. `[#14]` A5 §5.2 的「它不是 NIST 素材」—— 只证到 `≠ data_e` 打包结果，未排除其它 NIST 样本；且验收项「提交信息不再称其为 NIST 夹具」不可执行。
4. `[#15]` A5 §5.3 的「新两个大版本」—— 1.27.1 对 1.21.5 是 6 个次版本。

**漏报 / 范围不足（同一处还有更严重或更前置的问题）**

1. `[#7]` 同一条 `CUDA_ARCH="35;50;60"` 坏建议在 `docker/backend-gpu.Dockerfile:21` **先于** `ced4568` 存在；只改 compose 注释修不掉，A 未提。
2. `[#8]` 「参数化只落在 compose 里」不成立：Dockerfile 的 `ARG` 与 `verify-gpu.sh` 都在消费该变量；缺的只是 `.env.example`/DEPLOYMENT 的入口说明。
3. `[#9]` 「12 份」与自报 14 份口径冲突；且 `audit-reports` 类目在搬移前就把 `AUDIT-REPORT.md` 隐藏了，「改前可见」不成立。
4. `[#16]` `rddetector_linux` 不只是过期分叉，还是**无任何脚本/文档引用的孤儿文件**（构建脚本输出名是 `target/rddetector_linux_amd64`）。
5. `[#1]` 影响句所指的「按 `approval_scope_digest` 的查询」在 HEAD 不存在，等级可保留但影响须改写为前瞻性。

**本席未能核实（未降级为「基本没问题」）**

- 所有「实跑」数字：A1 的 unit 2754/2755/2789 passed、approval_binding 30 passed、freeze_binding 14 passed、`mclmutate caught=91 missed=0` 的执行结果；A5 的 `--profile gpu build`、`sha256sum -c`、`mclgate RESULT fails=0`。仓库内无 pytest 日志/JUnit XML/CI 产物，本轮又被禁止执行，故这些**未能核实**（静态只核到用例条数与文件数）。
- `[#7]` 的修法验证（按注释取值跑一次 GPU build）需构建，未执行；本席只复现了 shell 对 `;` 的拆分（等价于 Docker「ARG 先替换、再交 sh」）。
- 两仓工作区均脏（metacrypt 179 条、CipherCat 35 条），本报告所有判定只对提交树成立；工作区上的门禁结果不能复现 A 的 HEAD 结论，反之亦然。

**结论**：A1 的 12 笔里，`[#1]–[#4]`、`[#6]` 的阻塞/缺陷判定经逐字复核基本成立（`[#5]` 结论成立但证据失实）；「不可发布」的阻塞项（16–34 无执行入口）本席独立复现，与主线程一致。A5 的 10 条缺陷中 8 条成立、2 条需收窄（`[#7]` 归因、`[#14]` 框架），另有 `[#8]`、`[#9]` 需改口径；`[#17]` 的观察定性应予驳回，事实部分保留。**两份报告均无「结论方向完全相反」的条目（does_not_hold=0），但共有 4 处证据/定性假阳、5 处范围不足**，主线程分流时不应把 A 的支撑句直接当证据引用。
