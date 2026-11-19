A3-SEAT objects=10

# A3 席（证伪者）报告 — 模块化插件契约组

只读审计。仓库 `/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server`，HEAD `17b36ac`。
本组对象 **10 笔**（原派 9 笔 + 主 Agent 补派 `f8010c0`）：`8fa8202 10c07f3 c788045 0de15a6 f7e6130 68d09d9 1b7ef44 a316ffc 72b11eb f8010c0`。

## 速查清单

| # | 等级 | 位置 | 现象（可复现） | 修完要达到的可验收结果 |
|---|---|---|---|---|
| 1 | 阻塞 | `8fa8202` 提交信息 | 标题声称 `freeze modular plugin workspace baseline`，但 10 笔提交正文全空（`%b` = 1 字节换行）；仓库内无任何 freeze/baseline 判据文件；且该树 `frontend/src/features/blockly/plugins` 文件数为 **0** | 或补出成文冻结判据（判据范围、验收命令、基线摘要），或把标题降为实际内容（125 文件 WIP 汇聚），二者取一 |
| 2 | 阻塞 | `docs/MODULAR-PLUGIN-ARCHITECTURE.md:169` | 「当前 `frontend/src` 没有超过 `RULES.md` 500 行上限的 `.ts`/`.vue` 文件」为假：HEAD 有 14 个文件超 500 行（`TaskDetailView.vue` 972、`RightPanel.vue` 939、`ui-messages.ts` 744 …），`RULES.md:29` 明文规定 ≤500 行 | 该句删除或改为实测计数；若坚持成立则先把 14 个文件拆到 ≤500 行 |
| 3 | 缺陷 | 同上 `:169` | 「`EditorView.vue` 已由 3028 行降到 496 行」数字错：HEAD 实测 **498** 行；`72b11eb` 只降到 2342 行，496 这个值在任何提交上都不存在 | 改为实测 498，或补出 496 所属的提交/树 |
| 4 | 缺陷 | 同上 `:55` 生命周期图 | 声称 `registered → validated → frozen → disposed ↘ failed` 五态；代码只有 `frozen`/`disposed` 两个布尔，`validated`/`failed` 不是状态（校验内联、失败即 throw） | 图改为代码真实形态（两标志位 + 抛错），或实现五态机 |
| 5 | 缺陷 | 同上 `:135` vs `algorithms/contracts/descriptor.ts:7` | 文档写「JavaScript/Python 生成器语言」两类，代码 `ALGORITHM_GENERATOR_LANGUAGES` 是三类（含 `'mcl'`） | 文档补 `mcl`，或从契约删掉无对应语义的项 |
| 6 | 缺陷 | `backend/owl_admin/tasks/randomness_tasks.py:659,696,763` | 文档 §6「显式请求 GPU 且不可用默认报错」在生产接线里不可达：`gpu_available=True if use_gpu is True else None` 使 `gpu_fallback` 恒为 `False`，`AnalysisRoutingError("GPU 检测提供者不可用")` 永不触发；`:696` 分支与 `:763` 字段恒假 | `gpu_available` 改由真实探测结果传入，或删掉恒假字段/分支并同步文档口径 |
| 7 | 缺陷 | `sbox.py:201,260` `bruteforce.py:649,796` | 「统一任务展示状态」（`a316ffc`）未覆盖这两处：`fail` 被映射成 `"done"`（与 `success` 同值），未知态被映射成 `"失败"`；同一 `success` 在 sbox 是「已完成」、在 bruteforce 是「成功」；`randomness.py:88-91` 又是第三套（`fail→error`，合契约） | 两处改走 `task_contracts.task_state.derive_task_display_state`，或明确声明它们不属该契约并记录理由 |
| 8 | 观察 | `plugins/ui/builtin/contributions.ts:33,48` | 4 个内置 contribution 的 `mount` 是 `() => ({ dispose: () => undefined })` 空实现；真实面板由 `BuiltinSidebarSlot.vue` 走 props 静态组合，且消费的是 `BuiltinUiHost`（多出契约里没有的 `services` 通道） | 文档 §2 的「资源 mount hook 和 dispose」改为「仅注册/排序/能力校验，挂载由宿主静态组合」，或让 registry 真正承载挂载 |
| 9 | 观察 | `backend/owl_admin/provider_contracts/analysis.py:61` | `AnalysisProviderRegistry` 在生产代码里 0 处实例化（仅测试）；消费方 `f8010c0` 用的是 `route_analysis_task` 纯函数 | 若保留 registry 抽象就接到生产路径，否则标注为「仅测试用契约」 |
| 10 | 观察 | `8fa8202` numstat | 声称「125 文件、10,378 增」正确，但省略了 **1,309 删**；且该笔内容与标题无关（project branch/member/comment 的 27 个 controller/mapper/service、13 个 SQL 迁移、9 页 `docs/standards`、6 个 PNG、`pnpm-lock.yaml`） | 提交信息补全删除行数与真实范围，或拆分提交 |

---

## 覆盖声明

**已核实（命令可复现）**：

- 10 笔提交的 `%b`（正文）全为空：`for c in …; do git show -s --format='%b' $c | wc -c; done` → 每笔 `1`。
- 10 笔 numstat 全部重算：`8fa8202` 125/10378+/1309-、`10c07f3` 4/550+/0-、`c788045` 3/870+/0-、`0de15a6` 7/780+/0-、`f7e6130` 3/679+/0-、`68d09d9` 3/379+/0-、`1b7ef44` 10/957+/300-、`a316ffc` 12/727+/96-、`72b11eb` 16/1735+/852-、`f8010c0` 6/511+/15-。
- 契约实现逐条对读：`plugins/ui/{contracts,registry}.ts`、`session/workspace/workspace-session.ts`、`task_contracts/task_state.py` 与 `assessment/domain/taskState.ts`、`algorithms/contracts/{descriptor,registry}.ts`、`algorithms/builtin/*`、`provider_contracts/analysis.py`、`utils/task_routing.py`、`utils/randomness_dispatch.py`、`tasks/randomness_tasks.py`。
- 测试抽样 6 个（见「面 5.2」），全部读过断言体。
- 文件行数用 `git show <c>:<path> | wc -l` 与工作区 `wc -l` 双路取数。

**未能核实 / 不可达环节**：

- **未运行任何测试**（硬规则禁止）。所有「测试是否真断言」结论来自读断言源码，不是执行结果；「通过/失败」一律不作声称。
- **未 build、未 install**，故 TS 类型层面的 `BuiltinUiHost` 与 `UiHostContext` 的可赋值性只做静态阅读，未由编译器确认。
- 面 2（若有「性能/资源」维度）本组未涉及，**不适用**。
- 外部行为（浏览器里面板是否真的渲染、GPU 路由在真实 worker 上的表现）**未实测**，只做静态结论。

---

## 面 5.1：声称强度（最高优先）

### 结论：`8fa8202` 的「基线冻结」声称 **不成立**（阻塞）

**判据一：仓库内不存在冻结判据。** 任务规定的判据检索面（`docs/`、`RULES.md`、`AGENTS.md`、`tests/`）零命中：

```
$ git grep -ln "freeze modular\|workspace baseline\|baseline freeze" -- docs RULES.md AGENTS.md tests
（空）
$ grep -n "冻结" RULES.md AGENTS.md
（空）
```

仓库里叫 `baseline` 的只有一个前端 lint 基线 `.codestable/work/frontend-lint-baseline.json`，与「模块化插件工作区基线」无关；`FREEZE*` 系列命中全部落在 `docs/design/mclprover/` 与 `docs/reviews/mclprover-design/`（另一条 MCL 线），不是本组对象。

**判据二：被「冻结」的东西不在这棵树里。** 基线应当含模块化插件契约，实测为 0：

```
$ git ls-tree -r --name-only 8fa8202 frontend/src/features/blockly/plugins | wc -l
0
```

契约是后续 8 笔才加进来的（`10c07f3` 起才有 `plugins/ui/`）。也就是说：**声称冻结的那份基线，恰恰是不含契约的那份。**

**判据三：该笔的真实内容是无关 WIP 汇聚。** 125 个文件里：

```
$ git show --numstat --format= 8fa8202 | awk '{print $3}' | cut -d/ -f1-2 | sort | uniq -c | sort -rn
     41 frontend/src
     27 backend/owl_admin
     13 backend/sql
     10 tests/backend
      9 docs/standards
      6 frontend/public
      5 tests/frontend
      …
```

逐字引用（`git show 8fa8202 --numstat --format= | grep backend/owl_admin`）：

```
311	0	backend/owl_admin/service/blockly/project_branch_service.py
583	0	backend/owl_admin/service/blockly/project_file_service.py
183	0	backend/owl_admin/controller/blockly/project_collaboration.py
```

这些是 project branch/member/comment/presence/revision 的 CRUD 与 13 个 `backend/sql/migrations/*.sql`，与「模块化插件工作区」不是同一对象；另有 6 个 `frontend/public/docs-assets/*.png` 二进制、`frontend/pnpm-lock.yaml`、`docker/backend.Dockerfile`。

**为什么是阻塞**：提交信息是本组唯一成文的声称载体（正文全空），它把「做了一次 WIP 汇聚」写成了「已经冻结基线」。规则要求「若仓库内找不到冻结判据，按规则判该声称不成立」——本条同时缺判据、缺对象、缺范围，三项皆空。

### 附：10 笔提交全部无正文

```
$ for c in 8fa8202 10c07f3 … f8010c0; do echo -n "$c body-bytes="; git show -s --format='%b' $c | wc -c; done
8fa8202 body-bytes=1
10c07f3 body-bytes=1
…（10 笔全部为 1，即仅一个换行）
```

后果：任务书要求「每笔抽出提交正文里的结论式断言」，该取证面**不存在**。本报告的断言源因此降级为「subject 一行 + `docs/MODULAR-PLUGIN-ARCHITECTURE.md`（由 `94de158` 引入、后续 7 笔修订，**不在本组 10 笔内**——`git show --numstat` 对 10 笔逐一 grep `MODULAR-PLUGIN` 全部 0 命中）」。这一点本身是流程缺陷：文档是唯一成文契约，却被派到本组之外。

---

## 面 1：契约与实现一致（逐条判 一致 / 不一致 / 找不到）

### 1.1 UI contribution registry（`10c07f3`）

| 断言（doc §2） | 实现 | 判定 |
|---|---|---|
| slot ∈ `left.sidebar`/`right.sidebar`/`bottom.panel`/`statusbar`/`overlay` | `contracts.ts:4-10` `UI_SLOTS` 五项全同 | 一致 |
| 字段 `schemaVersion`/`version`/`id`/`slot`/`order`/`requiredHostCapabilities` | `contracts.ts:23-31` 逐字段同名同型 | 一致 |
| `requiredHostCapabilities` 是宿主能力、非项目读权限 | `UI_HOST_CAPABILITIES = ['workspace.read','workspace.write','workspace.manage','analysis.run']`（`contracts.ts:12-17`），与 `UiAccessCapabilities.canRead/canWrite/canManage` 分开两型 | 一致 |
| 生命周期 `registered → validated → frozen → disposed ↘ failed`（`:55`） | 只有 `let frozen = false; let disposed = false`（`registry.ts:52-53`）；`validated` 无状态（校验内联于 `validateAndFreezeDescriptor`）、`failed` 无状态（直接 `throw`） | **不一致**（2/5 存在） |
| 「registry 负责 … 资源 mount hook 和 dispose」 | `contributions.ts:33,48` `mount: () => ({ dispose: () => undefined })`——4 个内置 contribution 的 mount 全是空实现 | **不一致**（挂载未由 registry 承担） |
| 排序按 `order` 再 `id` | `compareDescriptors`（`registry.ts:186-196`）确实先 `order` 再字典序 | 一致 |
| 能力校验 | `validateAndFreezeDescriptor` 拒绝未知能力与不可用能力（`registry.ts:171-180`） | 一致 |

补充（不判为缺陷，但需记录）：真实面板组件不经 `mount` 注入，而由 `BuiltinSidebarSlot.vue:31-33` 的 `COMPONENTS` 静态映射 + `:host` props 提供；该 `host` 类型是 `BuiltinUiHost`（`host.ts`），比契约的 `UiHostContext` **多一个 `services` 通道**（members/comments/versions 直连项目 API 的封装）。因此「内置 panel 不直接 import 项目 API」在**运行时**成立（仅 `import type`），但「只读取冻结快照并调用显式命令」不成立——`services` 是契约外的第三条通道。

### 1.2 workspace session 状态机（`c788045`）

文档 `:64-78` 给 8 个 `phase`、5 个 `SaveResult` + `null`、4 条保存迁移。逐条对读：

```
$ git show c788045:frontend/src/features/blockly/session/workspace/workspace-session.ts | sed -n '1,13p'
export type WorkspacePhase =
  | 'idle' | 'loading' | 'ready' | 'switching' | 'saving' | 'conflict' | 'partialFailure' | 'failed'
export type SaveResult = 'saved' | 'conflict' | 'partialFailure' | 'failed' | 'canceled'
```

| 断言 | 实现 | 判定 |
|---|---|---|
| phase 8 值 | 8 值全同，无多无漏 | 一致 |
| `lastSaveResult` = null + 5 值 | `SaveResult \| null`，5 值全同 | 一致 |
| 成功 → `ready` / dirty `false` | `phaseByResult.saved = 'ready'`；`dirty: result !== 'saved'` → `false` | 一致 |
| 版本冲突 → `conflict` / dirty `true` | `conflict: 'conflict'`，`dirty` 为 `true` | 一致 |
| 项目包失败 → `partialFailure` / dirty `true` | 同上 | 一致 |
| 文件更新失败 → `failed` / dirty `true` | 同上 | 一致 |
| 「已派发的保存不能伪装成取消；`cancelPendingSave` 只处理尚未派发的请求」 | `cancelQueuedSave`：`if (state.pendingSave.dispatched) return rejected(…'already dispatched')` | 一致 |
| 迁移边：`loadSucceeded` 仅从 `loading`/`switching` | `canCompleteLoad` 只允许这两态 | 一致 |
| 终端态不可再变 | 无「历史阶段」概念，状态机是纯函数，无隐式回退 | 一致 |

**结论：状态机是这组里唯一「正文-代码-测试」三方对得上的契约**，唯一瑕疵是文档没写 `pendingSave`/`pendingLoad`/`accessCapabilities` 两字段的迁移约束（`markSaveDispatched` 这个显式动作未进文档），属于文档欠描述而非实现错。

### 1.3 算法描述符 registry（`f7e6130`）

| 断言（doc §5 `:130-140`） | 实现 | 判定 |
|---|---|---|
| descriptor 声明算法身份与实现版本 | `descriptor.ts:29-32` `algorithm: { id, name }` + `version` | 一致 |
| block types | `blockTypes: readonly string[]`，`snapshotBlockTypes` 强制非空 + 去重 | 一致 |
| **JavaScript/Python 生成器语言** | `descriptor.ts:4-8` `['javascript','python','mcl']` | **不一致**（多 `mcl`） |
| 文档路径 | `documents: { id, path }[]` | 一致 |
| 标准/参考依据身份 | `standardEvidence: { id, citation }[]` | 一致 |
| toolbox contribution | 由 `builtin/catalog.ts` 的 `AlgorithmToolboxContribution` 承担 | 一致 |
| `schemaVersion` 只表契约版本、`version` 表实现版本 | 二者分列，`ALGORITHM_DESCRIPTOR_SCHEMA_MAJOR = 1` 只比主版本 | 一致 |

`mcl` 不是笔误：`frontend/src/features/blockly/core/generators/mcl/` 目录确实存在，所以是**文档少写一项**。

### 1.4 staged analysis provider 契约（`68d09d9`）与生产接线（`f8010c0`）

| 断言（doc §6 `:157-165`） | 实现 | 判定 |
|---|---|---|
| 阶段 `sample-generation` → `sample.sandbox` | `task_routing.py` `SAMPLE_SANDBOX_PROVIDER_ID = "sample.sandbox"`，`stage=ProviderStage.SAMPLE_GENERATION` | 一致 |
| 阶段 `detection` → `detection.cpu` / `detection.gpu` | 两常量 + 两 descriptor，capability 分别为 CPU/GPU | 一致 |
| 「queue 属于路由策略，不属于 Provider manifest」 | `ProviderDescriptor` 无 queue 字段；`AnalysisRoute.queue` 独立 | 一致 |
| **「显式请求 GPU 且不可用默认报错」** | `randomness_tasks.py:659` `gpu_available=True if use_gpu is True else None`——`use_gpu=True` 时恒传 `True`，报错分支不可达 | **不一致** |
| 「自动选择或允许回退时才降级 CPU，并在结果中记录 `gpuFallback=true`」 | `gpu_fallback` 仅在 `wants_gpu and gpu_available is False` 时置真；`gpu_available ∈ {True, None}` ⇒ 恒 `False`。`:763` 写进结果的 `"gpuFallback"` 因此恒为 `false` | **不一致**（字段恒假） |
| 路由策略与 registry 解耦 | `AnalysisProviderRegistry`（`analysis.py:61`）在生产代码 **0 处**实例化（`git grep -n "AnalysisProviderRegistry" -- backend` 只命中定义与 `tests/backend/unit/provider_contracts/test_analysis.py`） | 观察（抽象无消费者） |

逐字引用（`git show f8010c0:backend/owl_admin/tasks/randomness_tasks.py | sed -n '655,700p'`，行号为工作区实测）：

```
659:                gpu_available=True if use_gpu is True else None,
…
695:        if provider_route.detection_capability is ProviderCapability.CPU:
696:            detection_use_gpu = False
697:        elif provider_route.gpu_fallback:
698:            detection_use_gpu = False
```

`:697` 分支与 `:659` 的恒真断言互为因果：因为接线从不说「GPU 不可用」，回退永不发生，所以该分支是死代码。**行为等价性**：由于 `detection_use_gpu` 在可达路径上恒等于入参 `use_gpu`，`_stage_detect` 的入参与改造前相同，**没有引入回归**；但「契约声称的回退能力」是空的。

同时记录一个**既有**（非本组引入，`git blame` 落在 `b94e316`）的口径裂缝：`controller/blockly/randomness.py:315` `route_task(n_bits, m_seq, use_gpu=bool(dto.use_gpu))` 把三态 `None` 压成 `False`，于是 `task_routing.py` 文档里 `use_gpu=None → 不设（Go 默认 auto）` 的语义在 HTTP 路径上不可达。本组 `f8010c0` 没有修它，也没有声明它。

### 1.5 analysis task state 契约（`0de15a6`）

| 断言（doc §4 `:100-120`） | 实现（py / ts 双侧） | 判定 |
|---|---|---|
| PersistedTaskStatus = `pending/running/success/fail` | `PERSISTED_TASK_STATUSES` 两侧同 | 一致 |
| WorkerOutcome = `success/failed/error/timeout/skipped/canceled/unknown` | `WORKER_OUTCOME_KINDS` 7 值同 | 一致 |
| DisplayStatus = `queued/running/done/error/unknown` | `DISPLAY_STATUSES` 5 值同 | 一致 |
| `disposition` 四值 | `WORKER_DISPOSITIONS` 4 值同 | 一致 |
| `skipped` 的 active-claim/expired/deleted 不得误写终态 | `normalize_worker_outcome` 对 `skipped` + 终态 disposition 抛 `ValueError`；`persisted_writeback` 对 `skipped` 直接 `None` | 一致 |
| 未知 kind 保持原状态、前端显示 `unknown` | `_normalize_worker_outcome_kind` 兜底 `"unknown"`；`derive_task_display_state` 非持久值返回 `status="unknown"` | 一致 |
| 迁移边（`pending→running/success/fail`、`running→pending/success/fail`、终端不可变） | 两侧逐分支同构 | 一致 |
| 「持久化状态来自数据库；worker 返回值与前端展示状态不能写回数据库」 | 契约层只提供纯函数，无强制；实际写回点在 `maintenance_tasks.py` 经 `persisted_writeback` 取值 | 一致（弱约束，但未违反） |

**面 1 小结**：5 个契约里，**workspace session 状态机**与**analysis task state** 完全对得上；**UI contribution** 在 lifecycle 与 mount 两处不一致；**algorithm descriptor** 少写 `mcl`；**provider routing** 的 GPU 回退声称在接线上不可达。文档 `:169` 的两条数字/规模断言为假。

---

## 面 5.2：测试是否真断言（抽样 6 个）

判定口径：只断言「对象存在 / 不抛异常 / 快照相等」的记为弱；断言状态迁移、守卫拒绝、顺序、副作用、权限过滤的记为强。

| # | 文件 | 抽样断言 | 判定 |
|---|---|---|---|
| 1 | `tests/frontend/unit/blockly/plugins/ui/registry.test.ts` | `expect(mount).toHaveBeenCalledOnce()`；`Object.isFrozen(context.snapshot.accessCapabilities)`；重复 id 时 `expect(secondMount).not.toHaveBeenCalled()`；`expect(host.list('left.sidebar').map(id)).toEqual(['builtin.z','builtin.a','builtin.b'])`（order 20 同值时按 id 序）；`expect(disposed).toEqual(['second','first'])`（逆序 dispose）；mount 抛错后 `expect(host.list('left.sidebar')).toEqual([])` | **强**。10 个用例覆盖排序、冻结、去重、schema 主版本、能力缺失、逆序释放、失败不残留 |
| 2 | `tests/frontend/unit/blockly/session/workspace/workspace-session.test.ts` | 用 `expectAccepted` 逐步驱动 `reduceWorkspace`；`dispatchedSave` 后 `cancelPendingSave` 必须被拒；`phaseState('conflict')` 等 8 态逐一构造并断言 | **强**。是真正的状态机用例，非快照 |
| 3 | `tests/backend/unit/task_contracts/test_task_state.py` | 5 个 `test_persisted_statuses_match_shared_fixture` 逐元组等值；`@pytest.mark.parametrize("case", _FIXTURE["workerOutcomeCases"])` + `transitionCases` 逐条比对 `writeback`/`allowed`；`with pytest.raises(ValueError, match="illegal persisted task transition: …")` 精确到消息 | **强**。且与 #4 共用**同一份** fixture，是真正的跨语言单一来源 |
| 4 | `tests/frontend/unit/features/assessment/taskState.test.ts` | `expect([...PERSISTED_TASK_STATUSES]).toEqual(fixture.persistedStatuses)`；`it.each(fixture.workerOutcomeCases)` 断言 `{kind,reason,disposition}` 三字段 + `persistedWriteback` | **强**。与 #3 对同一 fixture 双语言对咬 |
| 5 | `tests/frontend/unit/blockly/plugins/ui/builtin/{contributions,commands}.test.ts` | contributions：`expect(registry.list('left.sidebar').map(id)).toEqual([...BUILTIN_SIDEBAR_IDS])`、dispose 后两 slot 均空、能力缺失抛 `unavailable host capability: workspace.read`；commands：`expect(ids).not.toContain('save')` / `not.toContain('rename-project')`（只读角色过滤）、`commands.find(id==='open-file-1')?.run()` 后 `expect(actions.openFile).toHaveBeenCalledWith(file)` | **中**。descriptor 顺序与权限过滤是真断言；但**没有任何用例断言 `mount` 的副作用**——与 `contributions.ts:33,48` 的空实现互为印证，测不到是因为没有可测行为 |
| 6 | `tests/backend/unit/utils/test_task_routing.py` | `assert route.sample_provider_id == "sample.sandbox"`；`assert route.detection_capability is ProviderCapability.GPU`；`assert route.gpu_fallback is True`（allow_gpu_fallback 场景）；`with pytest.raises(task_routing.AnalysisRoutingError, match="GPU")` | **强**。但注意：`test_analysis_route_rejects_unavailable_gpu_without_fallback` 测的报错路径**生产接线不可达**（见 1.4），属「测得到、用不上」 |

**面 5.2 结论**：6 个抽样**没有一个是「只断言对象存在」的空壳**，断言强度整体偏高，2 个还做了 fixture 双语言对咬。唯一系统性缺口是 UI contribution 的 mount/dispose 生命周期无副作用可测——这不是测试懒，而是实现本身是空壳（与面 1 第 5 条同源）。

---

## 面 3：数字复算

### 3.1 逐笔 numstat（全部重算，命令 `git show --numstat --format= <c> | awk`）

| 提交 | 文件 | 增 | 删 | 任务书给的口径 | 判定 |
|---|---|---|---|---|---|
| `8fa8202` | 125 | 10378 | 1309 | 「125 文件、10,378 增」 | **增数一致**，**删除数被省略**（1309） |
| `10c07f3` | 4 | 550 | 0 | — | 一致 |
| `c788045` | 3 | 870 | 0 | — | 一致 |
| `0de15a6` | 7 | 780 | 0 | — | 一致 |
| `f7e6130` | 3 | 679 | 0 | — | 一致 |
| `68d09d9` | 3 | 379 | 0 | — | 一致 |
| `1b7ef44` | 10 | 957 | 300 | — | 一致 |
| `a316ffc` | 12 | 727 | 96 | — | 一致 |
| `72b11eb` | 16 | 1735 | 852 | 「16 文件、1735 增 / 852 删」 | **完全一致** |
| `f8010c0` | 6 | 511 | 15 | 「6 文件」 | 一致（增删未给，实测 511/15） |

### 3.2 `72b11eb` 是否「只是抽取」（行为等价）

抽取的两条链逐项复算：

**hash 类目**。抽取前（`git show 72b11eb~1:…/toolbox-config.ts` 的 `contents`）：

```
HASH_BLOCK_TYPES (= SHA256, SM3, SHA3, SHAKE, HASHBASED, FORS, ADRS, WOTS, SLH_XMSS
                   ← git show 1b7ef44~1:core/blocks/hash/index.ts 的 ALL_BLOCK_TYPES)
+ SHA512 + HKDF + PBKDF2 + DRBG + ARGON2 + GMDRBG
```

抽取后（`algorithms/builtin/algorithm-groups.ts:73-95` 的 11 个 group，按 `HASH_ALGORITHM_BLOCK_GROUPS` 顺序拼接）：`sha-256, sm3, sha-3, shake, slh-dsa-components(= HASHBASED+FORS+ADRS+WOTS+SLH_XMSS), sha-512, hkdf, pbkdf2, hmac-drbg, argon2, gm-drbg`。**展平后与抽取前逐项同序同集**。

**post-quantum 类目**。抽取前 `postquantumBasic = PQ_BASIC`、`postquantumAdvanced = PQ_ADVANCED + MLDSA + MLDSA_PRIMITIVE`；抽取后 `post-quantum-packages.ts:79-92` 的 `postQuantumToolbox`：`ml-kem → 'post-quantum-basic' = PQ_BASIC`、`'post-quantum-advanced' = PQ_ADVANCED`，`ml-dsa → 'post-quantum-advanced' = MLDSA + MLDSA_PRIMITIVE`。拼接后 advanced = `PQ_ADVANCED, MLDSA, MLDSA_PRIMITIVE`，**同序**。

**判定**：就 toolbox 的块类型集合与顺序而言，**抽取是无损的**，「只是抽取」成立。

但有三处**不是纯抽取**，必须点明：

1. **分组语义变了**：`slh-dsa-components` 把 5 个算法族（HASHBASED/FORS/ADRS/WOTS/SLH_XMSS）并成 1 个 descriptor（`algorithm-groups.ts:79-88`）。块集合不变，但 registry 的去重/禁用/身份粒度从「7 组」变成「11 包」，其中 1 包跨 5 族。这是结构变化，不是回归。
2. **新增了一条抛错路径**：`catalog.ts:120-127` `getToolboxBlockTypes` 在 section 无启用包时 `throw new Error('algorithm toolbox section "…" has no enabled packages')`。默认路径（不传 `disabledPackageIds`）不触发，但这是抽取过程中新引入的失败面。
3. **`createToolboxConfig` 变签名**：`createToolboxConfig(options: CreateToolboxConfigOptions = {})`，默认内部 `createBuiltinAlgorithmPackageCatalog()`。调用方若不传参，行为等价；但每次调用都会**重建**一份 registry（无缓存），属实现细节变化。

### 3.3 文档 §8 的数字

```
$ wc -l < frontend/src/features/blockly/views/EditorView.vue
498
$ wc -l < frontend/src/features/blockly/composables/useMultiFileProject.ts
408
$ grep -n "496\|408\|3028" docs/MODULAR-PLUGIN-ARCHITECTURE.md
169:- `EditorView.vue` 已由 3028 行降到 496 行；`useMultiFileProject.ts` 当前为 408 行。…
```

- `useMultiFileProject.ts = 408` → **正确**。
- `EditorView.vue = 498` → 文档写 496，**差 2**。且 `git show <c>:… | wc -l` 逐提交实测为 `3028(8fa8202..1b7ef44) → 2342(72b11eb) → 2342(f8010c0) → 498(HEAD)`，**496 在任何提交上都不存在**。
- 「当前 `frontend/src` 没有超过 500 行的 `.ts`/`.vue` 文件」→ **假**：

```
$ git ls-tree -r --name-only 17b36ac frontend/src | grep -E '\.(ts|vue)$' | while read f; do n=$(git show 17b36ac:"$f" | wc -l); [ "$n" -gt 500 ] && echo "$n $f"; done | sort -rn
972 frontend/src/features/assessment/views/TaskDetailView.vue
939 frontend/src/views/tool/build/RightPanel.vue
744 frontend/src/features/blockly/core/utils/locale/ui-messages.ts
735 frontend/src/components/TreePanel/index.vue
704 frontend/src/features/assessment/components/BruteforcePanel.vue
667 frontend/src/layout/components/TagsView/index.vue
655 frontend/src/views/tool/build/index.vue
600 frontend/src/views/system/role/index.vue
596 frontend/src/features/assessment/views/TasksView.vue
582 frontend/src/views/index.vue
554 frontend/src/components/Crontab/result.vue
546 frontend/src/features/assessment/components/TaskTimingsPanel.vue
520 frontend/src/features/assessment/components/AiAssistPanel.vue
518 frontend/src/views/system/menu/index.vue
```

14 个文件超限，而 `RULES.md:29` 原文是 `| 单文件 ≤500 行 | 认知负荷可控 | \`wc -l\` |`。更刺眼的是 `TaskDetailView.vue`(972)、`BruteforcePanel.vue`(704)、`TasksView.vue`(596) 正是 `a316ffc` 自己改过的文件——该笔在同一个提交里既改这些文件，又（经文档）声称它们不存在超限。

---

## 面 4：权威冲突

### 4.1 判定：`DisplayStatus` 存在 **3 套并行口径**（缺陷）

契约（doc §4 `:108`）规定 `DisplayStatus = queued / running / done / error / unknown`，即 `fail → error`、未知 → `unknown`。实测：

**口径 A（合契约）** `backend/owl_admin/controller/blockly/randomness.py:85-92`：

```
85: def _randomness_task_status(status: str | None) -> dict[str, str]:
88:     if status == "success":
89:         return {"status": "success", "displayStatus": "done", ...}
90:     if status == "fail":
91:         return {"status": "fail", "displayStatus": "error", ...}
92:     return {"status": "unknown", "displayStatus": "unknown", ...}
```

**口径 B（塌缩）** `sbox.py:201` 与 `bruteforce.py:649`（两处逐字节相同）：

```
mapped = "done" if status_val in ("success", "fail") else "running"
```

`success` 与 `fail` 同映 `"done"`——失败在展示层与成功不可区分，且 `unknown`/`pending` 一律显示 `"running"`。这直接违反契约的 `fail → error`。

**口径 C（中文标签，两文件互不一致）**：

```
sbox.py:260:        display = {"running": "未完成", "success": "已完成", "fail": "失败", "pending": "排队中"}.get(st, "失败")
bruteforce.py:796:   display = {"running": "未完成", "success": "成功",   "fail": "失败", "pending": "排队中"}.get(st, "失败")
```

同一个 `success` 在 sbox 是「已完成」、在 bruteforce 是「成功」；未知态两处都兜底成「失败」（契约要求 `unknown`）。

**契约的实际采纳面只有 2 处**：

```
$ git grep -n "derive_task_display_state\|task_contracts" -- backend/owl_admin/controller backend/owl_admin/service backend/owl_admin/tasks
backend/owl_admin/tasks/maintenance_tasks.py:14:from owl_admin.task_contracts.task_state import (
```

即：`a316ffc`「统一任务展示状态」只统一了**前端 4 个组件/视图**（`TasksView.vue:268`、`TaskDetailView.vue:260`、`SboxPanel.vue:123`、`BruteforcePanel.vue:256` 均调 `deriveTaskDisplayState`）与后端 **1 个** task 模块，sbox/bruteforce 两个 controller 仍是自建映射。

**缓解事实（必须一并记录，否则会误判）**：列表端点同时下发 `rawStatus`（`sbox.py:268`、`bruteforce.py:804`、`randomness.py:745,846`），前端 `const raw = task.rawStatus ?? task.status ?? ''` 优先取 `rawStatus`，所以**列表页**显示是对的。冲突只发生在 `status` 字段的语义上：任何只读 `status` 的消费方（含单任务 status 端点 `sbox.py:201` 的返回值）会拿到 `done/running` 这种非持久状态词。这是「同一字段两套语义」的经典权威裂缝，不是当前可见的显示 bug。

### 4.2 「任务状态」的正面结论

`tests/fixtures/task-state-contract.json`（312 行）是**真正的单一来源**：

```
$ git grep -n "task-state-contract" -- tests backend frontend
tests/backend/unit/task_contracts/test_task_state.py:20:  (Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "task-state-contract.json").read_text(
tests/frontend/unit/features/assessment/taskState.test.ts:2:import fixture from '../../../../fixtures/task-state-contract.json'
```

Python 与 TS 两侧实现分别被同一份 fixture 驱动，字段集合、disposition 语义、迁移边 `allowed`、`writeback` 期望值全部逐条对咬。**这是本组唯一做到跨语言单一权威的契约，应作为其余三个契约的模板。**

### 4.3 「算法描述符」的权威分布

`AlgorithmDescriptor`（前端 TS）在后端**没有对应定义**——`backend/owl_admin/` 下无 algorithm descriptor 类型。这不构成冲突，但意味着「算法包」是纯前端概念，doc §5 的「标准/参考依据身份」只在前端 `HASH_PACKAGE_METADATA` 里，后端与 `docs/standards/` 无引用校验。若将来要求「文档/标准证据与实际块定义一致」，这条链是断的（当前无消费方，故记为观察，不判缺陷）。

---

## 一句话结论

**`8fa8202` 的「基线冻结」声称不成立（无判据、无对象、10 笔正文全空），`docs/MODULAR-PLUGIN-ARCHITECTURE.md:169` 关于 `frontend/src` 无线超 500 行文件与 `EditorView.vue` 496 行的两处断言均为假（实测 14 个超限、498 行），UI contribution 的 lifecycle/mount 与 provider 的 GPU 回退在代码中不可达或为空实现而文档照写，`DisplayStatus` 在 sbox/bruteforce 仍是第二、三套口径；正面的是 workspace session 状态机与 analysis task state（含跨语言 fixture 对咬）三方一致、6 个抽样测试全为真断言、`72b11eb` 的 toolbox 抽取就集合与顺序而言无损。**

---

报告落盘：`.codestable/audits/2026-11-19-gated-review-adversarial-r2/A3-report.md`
