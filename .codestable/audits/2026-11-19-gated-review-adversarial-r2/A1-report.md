A1-SEAT objects=12

# A1 证伪席报告 — MCLProver 写路径组（12 笔）

仓库：`/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server`
分支 `codex/modular-plugin-workspace-architecture`，HEAD `17b36ac`。
对象：`6883f4c 753761f 6a3a0e5 ee77619 1199395 4d364ba 9778b27 e6417bb 2574493 ef214c7 5012546 3ab5106`（按主 Agent 更正，12 笔；`4d364ba` 兼作对照）。
本轮只读：`git show / diff / log / ls-tree`、`sed -n`、`grep`、`wc`、`sha256sum`、`python3 -c ast.parse`。未 build、未 install、未跑 pytest、未跑迁移、未写仓库文件（本报告除外）。

## 覆盖声明

**判定口径**：所有哈希、行数、成员数都按 **HEAD/指定提交的 blob** 复算，不按工作区文件。原因：工作区有另一会话的未提交改动（`git status --porcelain` 177 条；`docs/design/mclprover/` 下 13 个文件为 `M`，含 `FREEZE.sha256`、`expected_manifest.txt`、`derive-key-vectors.py`、`mclmutate.py`，另有未跟踪的 `15_secure_login_defaults.sql`、`35_mclprover_claim_revision_event.sql`）。工作区上的 `mclgate` 结果今天不可复现，本报告只对提交树负责。

**逐字/整文件读过**（小文件）：

| 文件 | 行数 | 读法 |
|---|---|---|
| `docs/design/mclprover/FREEZE.sha256` | 19 | 全文 |
| `docs/design/mclprover/EXEMPTIONS.sha256` | 61 | 全文 |
| `docs/design/mclprover/expected_manifest.txt` | 1 | 全文 |
| `tests/backend/mysql/mclprover_gate.py` | 191 | 全文（`sed -n '1,191p'`） |
| `tests/backend/mysql/test_mclprover_freeze_binding.py` | 154 | 全文 |
| `tests/backend/unit/test_migration_runner.py` | 76 | 全文 |
| `backend/sql/migrations/32_mclprover_approval_binding_claim_kind.sql` | 45 | 全文 |
| `backend/sql/migrations/postgres/32_...sql` | 28 | 全文 |
| `backend/sql/migrations/18_mclprover_assertions.sql` + PG 版 | 123 + 119 | 主体全读 |
| `backend/sql/migrations/34_...sql` + PG 版 | 60 + 60 | 全文 |
| `backend/sql/migrations/16_mclprover_claim_events.sql` | 164 | 1–164 关键段全读（建表/CHECK/触发器） |
| `backend/sql/migrations/30_...sql` MySQL / PG | 218 / 154 | MySQL 1–218、PG 1–154 全读 |
| `backend/sql/migrations/33_...sql` MySQL / PG | — | 建表/索引/约束段全读（MySQL 43–130、PG 23–105） |

**抽样读过**（按区间，不整文件打印）：

- `backend/owl_common/mclprover/`：`claim_revision_writer.py` 读 1–60/281–315/341–360/401–440/760–800/960–1035/1080–1205/1395–1500；`event_writer.py` 读 925–982；`operation_receipt.py` 读 1060–1210；`key_derivation.py` 读 231–379；`claim_revision.py` 常量区；`receipt_replay.py` 结构与 `receipt_replay` 注册点；`claim_revision.py`/`approval_digest.py` 的 `approval_scope_digest` 定义。其余 28 个模块（约 33k 行）只做了 `grep` 与 AST 汇总。
- `docs/design/mclprover/`：`05-CONTRACTS-COMMON.md` 的 §3/§5/§6.1/§6.2 相关行（89、98–100、311、320–333、368、387、395、412–421、485–509、536、553、557）；`10-CLAIM-SPEC.md` 的 47、60、62、106–107、557–579、649–653、716–720；`70-INTEGRATION-SECURITY.md` 的 §6.4 相关行（grep 定位，未逐节读）；`INDEX.md`/`00`/`20`/`30`/`40`/`50`/`60` 未逐字读。
- `tests/backend/`：`test_approval_scope_digest.py`（397 行，读 1–40、94–204 与 grep）；`test_request_members_parity.py`（122 行，读 1–60）；`test_operation_receipt.py`（读 30–90 与 grep）；`test_mclprover_approval_binding.py` 读 440–500；`test_mclprover_claim_revision_writer.py` 读 1–40 与 grep；`test_claim_revision.py` grep。
- SQL 双方言：完整对比 `18`、`30`、`33` 三组；另外用脚本对比了 `18/19/24/28/30/31/33/34` 的索引名与 `16–34` 的 DEFAULT。

**没读**（明确未覆盖）：`backend/owl_common/mclprover/` 其余 28 个模块正文（约 33k 行，仅 grep/AST）；`16–34` 中未列入上表的 13 份迁移正文；`tests/backend` 138 个文件中未点名的 133 个；`docs/reviews/mclprover-design/**`（`3ab5106` 的内容，0 行）；`docs/design/mclprover-impl/70-IMPLEMENTATION-ADVISORY.md`（`3ab5106`，0 行）；`docs/design/mclprover` 十份语料中除上述段落外的正文。

**结论速查**（详见各面）：

- 阻塞 1：HEAD 上 16–34 号迁移没有任何执行入口（init 止于 09、runner 止于 14），提交树不可建库。
- 缺陷 4：PG 30 缺 `ix_gov_approval_scope_digest`；`ef214c7` 的「38 文件」实为 37；`753761f` 的「所有脚本自带 information_schema 守卫」对 5 份脚本不成立；接线门禁只钉 09 号。
- 观察 5：`6a3a0e5` 的「幂等守卫」是 DDL 幂等；claim 事件键 DB 侧只有形状 CHECK；成员集/公式有「文档＋代码」双份定义但只有部分被逐字对咬；冻结面不含代码/SQL；工作区脏导致门禁不可现跑。
- 复算通过：34 模块/36423 行；向量 24→26→27；回执 kind 20→21、13 名；FREEZE 14 条＋聚合＋三门禁脚本摘要全部命中。

---

## 面 1 幂等（`6a3a0e5` 与其后的写路径）

### 1.1 [观察] `6a3a0e5` 的「守卫」是迁移 DDL 幂等，不是业务幂等

提交标题：「32 号族令牌 ALTER，补 claim 并带幂等守卫」。实际守卫位于 `backend/sql/migrations/32_...sql:13-45`：先读 `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`，只有缺 `claim` 时才 `DROP CHECK`/`ADD CONSTRAINT`；PG 版同构（用 `pg_get_constraintdef`）。它防的是「对已正确的库无条件先拆后建」和「重复执行报错」，不防业务重复写入。

业务幂等由三处承担，且都在：

1. 表级唯一键：`30_...sql:65-66` `UNIQUE KEY uq_gov_approval_scope_binding (approver_identity_digest, approval_action, approval_scope_digest)`；
2. 库内重算：`30_...sql:180-190` `BEFORE INSERT` 触发器按列值重建 canonical JSON 并比 `sha256:` 值，调用方自报无效；
3. 应用层回执去重：`claim_revision_writer.py:760-790` `find_receipt(resource_kind, scope_digest, idempotency_key)` → `request_digest` 不同即 `ReceiptConflict` → 同事务第二次调用直接报错 → `verify_replay_response` 重建比对。

复现：`git show 6a3a0e5 -- backend/sql/migrations/32_mclprover_approval_binding_claim_kind.sql | sed -n '1,45p'`。

### 1.2 [观察] 设计文档定义的公式在代码里有第二、第三份实现，但只有一处被逐字对咬

- `approval_scope_digest` 同时存在于：05 §3 的公式、`approval_digest.approval_scope_digest()`（Python）、`30` 号 MySQL 过程 `p_mclprover_scope_guard` 与 PG `fn_gov_approval_scope_guard`（SQL）。这是 30 号注释里明写的「重算在库内做」取舍，不是偷偷重复。
- 该重复有测试对咬：`tests/backend/mysql/test_mclprover_approval_binding.py:274` `assert stored == ad.approval_scope_digest(**scope_kwargs())`、`:293` 同行（base/revision 两形态各一次）。所以「两份公式漂移」在本组用例覆盖到的形态上会红。
- 但 `compiled_claim` 九名 / `protected_core_payload` 十名是另一类重复：`claim_revision.py:94-121` 定义常量，`10-CLAIM-SPEC.md:570/649` 定义同名封闭集；`tests/backend/unit/mclprover/test_claim_revision.py:70-71` 只断言 `len(PROTECTED_CORE_MEMBERS) == 10` 与 payload 集合等于常量减 `model_binding`，**没有**把十个名字与 10 §8.2 的表逐字对咬。名字级漂移（数量不变、改名一个）不会被这条测试抓到。13 名响应行同理：`operation_receipt.py:1144-1150` 与 `05-CONTRACTS-COMMON.md:387` 各一份，`test_operation_receipt.py` 只解析 §6.1 的 scope 表与 28 号 DDL 的 `ck_or_resource_kind_closed`，没有 claim_revision 响应行的文档对咬。

### 1.3 [观察] `frozen` 幂等键曾被写成自造格式，两笔后修回

`9778b27` 的正文自述 05 §6.1「幂等键 `"frozen:"+claim_draft_id+":"+draft_version`」；这与同一份语料 §6.2 的 `claim-draft-event-key` 公式及 `16_...sql:87-89` 的键形 CHECK（`^<event_type>:claim-draft:[0-9a-f]{64}$`）冲突。`1199395` 把 05 §6.1 与 10 §2.3 改回「按 §6.2 的 `claim-draft-event-key` 派生（V 取 CAS 前置 `draft_version`）」。HEAD 上是修好的：

- `10-CLAIM-SPEC.md:60`：「其语义幂等键按 [05 §6.2] 的 `claim-draft-event-key` 公式派生（`V` 取被冻结时读到的 CAS 前置 `draft_version`…）不得含随机量，也不得另立格式、前缀或第二套公式」。
- 实现按 §6.2：`event_writer.py:933-936` 调 `derive_claim_key`；`:975-980` 拒绝调用方自报值。

判定：按 HEAD 无缺陷；但这说明该系列在 9778b27 这一笔上曾把与自身冻结 CHECK 冲突的公式写进规范，靠后续审计才收回，属于过程观察而非 HEAD 缺陷。

### 1.4 [观察] claim 事件键在 DB 侧只有形状 CHECK，没有按锚点重算的触发器

`16_mclprover_claim_events.sql:87-89` 与 `:121-123` 只有 `REGEXP_LIKE(...)` 形状约束；`134-164` 的触发器只做链头 CAS（`expected_sequence` 必须等于当前 head），不重算键。也就是说：一个形状合法但摘要错误的键，只能靠应用层 `event_writer` 拦。对照 `17_mclprover_five_family_events.sql`，五族同样只有形状 CHECK（`replaced:` 行用 `CONCAT(...)` 等值，`391-398` 等），所以这不是 claim 独有，而是本组迁移统一的选择；但「DB 能独立验证键语义」这一层不存在，若应用层派生逻辑写错且测试没覆盖，库不会红。

---

## 面 2 双方言等价（`753761f`，抽样 3 组）

### 2.1 [缺陷] 30 号：MySQL 有 `ix_gov_approval_scope_digest`，PostgreSQL 没有

- MySQL `backend/sql/migrations/30_mclprover_approval_binding.sql:67`：``KEY `ix_gov_approval_scope_digest` (`approval_scope_digest`),``
- PG `backend/sql/migrations/postgres/30_mclprover_approval_binding.sql:44-51`：主键、`uq_gov_approval_scope_binding`、CHECK 全在，**无** 对应 `CREATE INDEX`（`grep -c 'approval_scope_digest'` 只命中唯一键与 CHECK）。

复现命令与输出（我自己跑的索引名对比脚本）：

```
== 30_mclprover_approval_binding.sql
  mysql keys: 2 pg indexes+uq constraints: 1
  only mysql: ['ix_gov_approval_scope_digest']
  only pg: []
```

影响：同一条按 `approval_scope_digest` 的查询（唯一键前缀是 `(approver_identity_digest, approval_action)`，不含单独 digest）在两种方言上走不同的计划；这是**模式面不等价**，不是语义错误。修法目标：PG 侧补同名 `CREATE INDEX IF NOT EXISTS ix_gov_approval_scope_digest ON governance_approval_binding (approval_scope_digest);`，或在两侧都删掉并说明不需要。

### 2.2 [观察] 18 号：语义等价

18 号 MySQL 与 PG 的 `review_policy_revision` 撤稿守卫与 `mcl_assert_rp_withdrawn` 提交前断言逐句同构：同样的「已设置不可改」「有未撤子行不得撤」「draft_withdrawn 事件至多一条且必须与 `withdrawn_by_event_id` 相等」。差异只在方言（`SIGNAL`→`RAISE`、过程→plpgsql 函数、`CREATE OR REPLACE`）。对照 `sed -n '43,72p'`（MySQL）与 `'45,66p'`（PG）逐行可比。

### 2.3 [观察] 33 号：索引/约束等价，JSON 检查的失败形态不同

- 三组索引列完全一致：`uq_claim_revision_scope (tenant_id, project_id, claim_revision_id)`、`uq_claim_revision_draft (tenant_id, claim_draft_id)`、`idx_claim_revision_claim (tenant_id, project_id, claim_id)`（MySQL `69-74`；PG `85-90` 用 `CREATE UNIQUE INDEX IF NOT EXISTS`，PG 允许以唯一索引作复合外键父键）。
- 13 个约束名两侧逐一相同（脚本比对 only mysql/only pg 均为空）。
- 差异：MySQL `ck_claim_revision_artifact_ref_object` 用 `JSON_VALID(...) AND JSON_TYPE(...)='OBJECT'`，PG 用 `json_typeof(col::json)='object'`。非法 JSON 时 MySQL 得到 CHECK violation，PG 得到 cast 异常；都拒绝，但错误类型不同。不影响等价性判定。

### 2.4 [观察] 32/34 号：守卫逻辑等价，事务边界不同且作者已登记

MySQL 版用 `DROP PROCEDURE IF EXISTS` + `CREATE PROCEDURE` + `CALL`，DDL 隐式提交；PG 版用 `DO $$ ... $$`，在调用方事务内。作者在 `32_...sql:12-16`、`34_...sql:16-18` 明写「MySQL 的 DDL 隐式提交，不做无条件先拆后建」，并用「先读定义、只缺才拆」缩小窗口。判定：语义等价，事务原子性不等价但已被承认，不是隐藏差异。

双方言 DEFAULT 抽查：`16` 号 `claim_compilation.event_sequence` 两侧都是 `NOT NULL DEFAULT 0`（MySQL `16:49`，PG `16:47`），无差异。

---

## 面 3 数字复算

| 声称 | 复算命令 | 结果 | 判定 |
|---|---|---|---|
| `6883f4c` 34 模块 / 36k 行 | `git ls-tree -r 6883f4c -- backend/owl_common/mclprover \| wc -l`；`git diff --numstat 6883f4c^ 6883f4c`；逐 blob `wc -l` 求和 | 34 个文件（全部 `.py`）；`34 files changed, 36423 insertions(+)`；逐 blob 行数和 = 36423 | **成立**（36k 是 36423 的约数） |
| `9778b27` 向量集 24→26 | `python3 -c` 解析 `vectors/conformance-vectors-v1-payload.json` 于 `9778b27^` 与 `9778b27` | `24 1.1.2` → `26 1.1.3`；新增 `v25 claim-interpretation-sample`、`v26 claim-assurance-tier-input-sample` | **成立** |
| `1199395` 26→27 / 1.1.4 | 同上，于 `1199395` | `27 1.1.4` | **成立** |
| `4d364ba` 回执第 21 个 kind | AST 读 `operation_receipt.py` 的 `RESPONSE_MEMBERS` 于 `4d364ba^` 与 `4d364ba` | `20 → 21`，新增键 `claim_revision` | **成立** |
| `4d364ba` 13 名响应行 | AST 数 `RESPONSE_MEMBERS["claim_revision"]`；对 `05-CONTRACTS-COMMON.md:387` | 13 名，逐字同名同序（`claim_revision_id … occurred_at`） | **成立** |
| `ef214c7` `tests/backend/unit/mclprover（38 文件）` | `git ls-tree -r --name-only ef214c7 -- tests/backend/unit/mclprover \| wc -l` | **37**（HEAD 才是 38） | **不成立**（差 1） |
| `4d364ba` `mclmutate caught=91 missed=0` | AST 数 `MUTATIONS` + `GATE_MUTATIONS` | `76 + 15 = 91` | 总数吻合；执行结果**未能核实** |
| `ee77619` 15 条真库表形用例 | `grep -c '^def test_' tests/.../test_mclprover_claim_revision_schema.py` | 15 | **成立**（执行未核实） |
| `ee77619` 34 条纯函数用例 | 同法数 `test_claim_revision.py` | 31 个 `def test_`；若靠 parametrize 补到 34 则可能成立，**未能核实** | 存疑（未定级） |

补充：`6883f4c` 的「34 模块」在 HEAD 已变成 36 个 `.py`、38539 行（`git ls-tree` + 逐 blob 求和），这是后续两笔新增，不是该笔虚报。

---

## 面 4 回执

### 4.1 [成立] 「第 21 个 kind 的 13 名响应行 + 三行重建」在代码里是实的

- 响应成员：`operation_receipt.py:1144-1150` 的 `frozenset` 恰好 13 名，与 `05:387` 的表格逐字一致；上一提交该表 20 个 kind，本提交 21 个（AST 实测）。
- 重建器：`claim_revision_writer.py:1137-1138` `@register_response_rebuilder(RESOURCE_KIND)`；`:1141` docstring「按**已持久化三行**重建 13 名响应：revision 行、种子 ACL 行、草稿 `frozen` 事件行」；随后三次查询分别取 `claim_revision`、`resource_acl_revision`（revision_number=1、resource_kind=acl）、`claim_draft_event`（event_type=frozen），任一缺行返回 `()`。
- 回执落库：`:1469-1471` 把 `visibility_scope`/`scope_facts` 交给 `insert_receipt`。

### 4.2 [观察] 回执层与事件层键的分工正确，但「21 个 kind」与「65 个 scope 行」两个口径容易混读

`operation_receipt.py:90` 的 `SCOPE_SPECS` 有 65 行（AST 实测 65），`RESPONSE_MEMBERS` 21 个。代码注释（`:1060`）写「本版 21 个已实现 `resource_kind`」，与 05 §6.1 的 65 行 scope 表不是同一计数对象；审计时不能把 21 当 scope 行数。这不是缺陷，但提交正文「回执第 21 个 kind」若不带上下文会被读成 scope 行。

### 4.3 [未能核实] 提交正文的通过数

`ef214c7`「unit 2754 passed / 4 skipped；approval_binding 30 passed；freeze_binding 14 passed」、`4d364ba`「mysql 10 passed / postgres 10 passed；claim 两族 56 passed」、`1199395`「unit 2755 passed」、`ee77619`「2789 passed」：仓库内没有 pytest 日志/JUnit XML/CI 产物（`git ls-tree -r HEAD | grep -iE 'pytest.*(log|xml)|\.junit'` 只命中两个 CSV 夹具），本轮又被禁止执行测试，因此这些数字**未能核实**。可静态核对的只有用例条数：`test_mclprover_freeze_binding.py` 14 个 `def test_`（与「14 passed」条数一致）、`test_mclprover_claim_revision_writer.py` 10 个 `def test_` 且按 `dialect.DIALECT` 参数化（与「mysql 10 / postgres 10」的说法相容）。

---

## 面 5 声称强度与门禁

### 5.1 [阻塞] 提交树上 16–34 号迁移没有任何执行入口，交付系列不可建库

- `backend/sql/00_init_all.sql`（HEAD）共 46 行，最后一行 `46  source /docker-entrypoint-initdb.d/migrations/09_user_project_storage.sql;`，16–34 一个都没有。
- `backend/sql/migrations/run_migration.py`（HEAD）的 `_run_sql_file` 列表止于 `14_project_branches.sql`（`170-183`）。
- `ee77619` 正文自己承认：「未随本笔入库：`00_init_all.sql` / `run_migration.py` / `test_migration_runner.py` 三处 33/34 登记——这三个文件正被另一路会话改写…登记改动留在工作区，随该会话的提交一起入库。」
- 工作区确实有这套登记（`git diff` 显示 init 追加到 35、runner 追加 16–34），但它是**未提交**的，且引用了未跟踪的 `15_secure_login_defaults.sql`、`35_mclprover_claim_revision_event.sql`（`git status --porcelain` 的 `??` 行）。按 HEAD 交付，没有任何路径会创建这些表。

影响：以「写路径落地」为名的 12 笔提交在提交树上无法部署；不是「测试没覆盖」，而是主任务入口缺失。修完要达到：HEAD 的 `00_init_all.sql` 与 `run_migration.py` 都包含 16–34（以及任何被引用的 15/35），或者明确把这批迁移交给一个已提交的独立 runner；并在 `test_migration_runner.py` 里对全部新增迁移做存在性断言。

### 5.2 [缺陷] `ef214c7` 的「38 文件」在该提交上是 37

命令与输出：

```
$ git ls-tree -r --name-only ef214c7 -- tests/backend/unit/mclprover | wc -l
37
$ git ls-tree -r --name-only HEAD -- tests/backend/unit/mclprover | wc -l
38
```

提交正文写「tests/backend/unit/mclprover（38 文件）」。差 1 不影响测试有效性，但这是可复算的数字断言，按「声称强度」面记为缺陷；修法：改成 37，或说明 38 是 HEAD 口径。

### 5.3 [缺陷] `753761f`「所有脚本自带 information_schema 存在性守卫」对 5 份脚本不成立

命令：`for n in $(seq 16 31); do git show HEAD:<该号迁移> | grep -c information_schema; done`

输出：`16=0, 17=1, 18=1, 19=8, 20=11, 21=19, 22=71, 23=16, 24=9, 25=26, 26=1, 27=0, 28=0, 29=4, 30=0, 31=0`。

16、27、28、30、31 五份没有 `information_schema` 守卫。它们靠 `CREATE TABLE IF NOT EXISTS` / `DROP TRIGGER IF EXISTS` / `DROP PROCEDURE IF EXISTS` 达成可重复执行，幂等性大体成立，但「所有脚本自带 information_schema 存在性守卫」是**字面不成立**的机制断言。修法目标：把正文改成「多数脚本用 information_schema 守卫，其余靠 IF NOT EXISTS / DROP IF EXISTS」，或给五份补同款守卫（30/31 若表已存在但 CHECK 缺项，`CREATE TABLE IF NOT EXISTS` 不会补，这正是 32/34 存在的理由，应在正文说清边界）。

### 5.4 [缺陷] 接线门禁只钉 09 号，新增迁移可以「不加线也不红」

`tests/backend/unit/test_migration_runner.py:66-76`：

```
66 def test_user_project_storage_migration_is_wired_for_fresh_and_existing_databases():
68     migration = root / "backend/sql/migrations/09_user_project_storage.sql"
75     assert "migrations/09_user_project_storage.sql" in init_script
76     assert '"09_user_project_storage.sql"' in runner
```

它只对 09 号做「init + runner 双登记」断言；`git grep '16_mclprover' -- tests/backend/unit` 无命中。因此 5.1 的缺失在提交时不会被任何单测抓到。修法目标：把该测试改成「枚举 `backend/sql/migrations/1[6-9]_*.sql`/`2*_*.sql`/`3*_*.sql`，逐文件断言 init 与 runner 都登记」，或维护一份两侧共享的清单常量。

### 5.5 [成立] 冻结绑定门禁是真的会开火，我复算通过

在 HEAD blob 上重算（不是工作区）：

- 14 条逐文件摘要：`diff <(git show HEAD:.../FREEZE.sha256 | grep -v '^#') <(逐 blob sha256sum)` → 无差异（`FREEZE_14_MATCH_AT_HEAD=yes`）。
- 聚合：把 14 行 `digest  name` 原样拼成流后 `sha256sum` → `3cb300383fcc9e5f782071f37ff7d0d5aaf820da5a78fdc40fe66914d6276c6b`，与 `FREEZE.sha256:1` 的 `# Aggregate:` 逐字相同。
- 三门禁脚本：`mclgate.py=684924fa…`、`mclrefute.py=23fabb0b…`、`mclmutate.py=383044f7…`，与 `FREEZE.sha256:5` 的 `# Gates:` 行逐字相同。
- manifest：`expected_manifest.txt` = `e28213e5…` = `derive-key-vectors.py:461` 的 `MANIFEST_DIGEST` = `mclprover_gate.py:80` 的 `FROZEN_VECTORS_MANIFEST`，三处一致。
- 门禁本体不是只 import：`mclprover_gate.verify_all()`（`176-191`）实际读文件、算哈希、重算聚合、跑向量脚本、比对 `=== PASS:`、比对脚本摘要；阴性对照在 `test_mclprover_freeze_binding.py` 里是 14 个用例，含「单条摘要篡改聚合变」「文件名篡改」「字节改」「硬编码桩被摘到」「脚本缺失/未冻结」。
- `mclgate.py` 的 `FILES` 是 10 份 `.md`（`21-26`），`FREEZE_FILES = FILES + ["EXEMPTIONS.sha256"] + VECTOR_FILES`（`429`），并校验 FREEZE 行集合与顺序（`478-511`）。

### 5.6 [观察] 冻结面不含代码、SQL、测试与本组新增路径；FREEZE 没有自锚

- 覆盖面只有 10 份语料 + `EXEMPTIONS.sha256` + `vectors/` 三件 = 14 条。谁改了 `backend/owl_common/mclprover/*`、`backend/sql/migrations/*`、`tests/backend/**`，`mclgate` 都不会红。
- `docs/design/mclprover-impl/70-IMPLEMENTATION-ADVISORY.md` 与 `docs/reviews/mclprover-design/**` 不在任何冻结面（`5012546`/`3ab5106` 新增）。
- `FREEZE.sha256` 的聚合值写在被同一文件枚举的 14 条之上，文件本身没有一个外部锚；能防「改了语料忘了改 FREEZE」，防不了「同时改语料、摘要与聚合」。真正的锚是 git 历史，不是这道门禁。这是设计边界，不是隐藏缺陷，但主 Agent 判「门禁是否真会开火」时应按这个边界写。
- 另：工作区 13 个语料文件未提交修改（含 `FREEZE.sha256` 自身），因此在**当前工作区**上跑 `mclgate` 不会是 `fails=0`；本报告的通过结论只属于 HEAD blob。

### 5.7 [未能核实] 其余「实跑」断言

- `4d364ba`「claim 两族既有真库用例 56 passed」、`ef214c7`「approval_binding 30 passed」：需要真 MySQL/PostgreSQL，本轮禁止执行；仓库内无用例运行记录。**未能核实**。
- `5012546`「mclgate RESULT fails=0（LINES 8811、MARKUP_PARITY 1422/0）」「sha256sum -c 14/14」：HEAD 的 `FREEZE.sha256:2` 写 `Lines: 8845`、`:3` 写 `lines=8845`，与正文的 8811 不是同一棵语料（后续 5 笔改过语料，属正常演进）；我没有执行 `sha256sum -c` 与 `mclgate`，只做了等价的手工复算（5.5）。**运行输出未能核实**。
- `3ab5106` 的评审记录内容未读，**未覆盖**。

---

## 一句话结论

这 12 笔里，回执与幂等的骨架、冻结门禁、双方言的主体都是真实现的，数字复算除「38 文件」外全部对得上；但按 HEAD 交付时 16–34 号迁移没有任何执行入口（阻塞），PostgreSQL 30 号少一个索引，且接线门禁与成员集门禁都盖不住新增路径——**不可发布**：先补迁移接线并让门禁对新增迁移开火，再补 PG 索引与 `ef214c7`/`753761f` 两处失实数字。
