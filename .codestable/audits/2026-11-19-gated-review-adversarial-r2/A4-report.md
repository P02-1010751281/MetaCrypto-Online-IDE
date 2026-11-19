A4-SEAT objects=17

# A4 席（证伪者）报告：保存契约线与证据链

仓库：`/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server`
HEAD：`17b36ac`（分支 `codex/modular-plugin-workspace-architecture`）
对象：`214f7cc 94de158 5433eb1 c6d7506 82c5b33 ab4d88e 6f9e3fd 07c4fa6 4fac3d4 b8a4cb3 fbd3242 13b157a ccb1d82 25a1a93 3156575 13f413f 3b37da4`

## 覆盖声明

**已核实**（全部只读）：

- 17 笔对象均为 HEAD 祖先（`git merge-base --is-ancestor <c> HEAD`，逐笔 17/17）；
- `git show --numstat/--name-status`、`git show <c>:<path>`、`git diff`、`git log -S`、`git rev-parse <c>:<path>`、`git check-ignore -v`、`git grep`、`sed -n`、`grep`、`wc`、`md5sum`、`file`；
- HEAD 上保存契约的真实实现路径：`frontend/src/features/blockly/composables/multiFilePersistence.ts`（284 行）、`useMultiFileProject.ts`（408 行）、`session/workspace/workspace-session.ts`、`backend/owl_admin/{controller,service,mapper}/blockly/project*.py`；
- 唯一一份"证据"实体：`frontend/public/docs-assets/tutorials/14-workspace-session-save.png`，7 个版本全部 `git show` 落地到 `/tmp/a4png/` 并用 `read_image` 目视（1440×1000，7 个 md5 互不相同）；
- 工作区里未入库的 `tests/frontend/e2e/artifacts/`（8 次运行、`summary.log` + 32 个步骤日志）逐份读过。

**未能核实**（硬规则：不 build / 不 install / 不跑测试，这些只能静态核查）：

- `basedpyright` 通过、ESLint 0 errors / 0 warnings、"924 项单元测试"全绿、8 次 `run-modular-verification.sh` 之外的任何一次运行——均无现场证据，只能核对其声称与仓库文本是否自洽；
- 任何一次浏览器烟测的实时输出（`workspace-smoke.mjs` 的 JSON、`saveResponses`）不在仓库、也不在 artifacts 目录里，只能核对其脚本判据本身；
- 7 个 PNG 是否为"同一会话不同时刻重拍"只能由截图内状态栏时钟与提交时间做**一致性**推断，不能证明其对应某次具体构建（PNG 无 tEXt/iTXt 时间戳块，`grep -aoE 'tEXt|iTXt|zTXt'` 七个版本 0 命中）。

面号在本报告中按任务书的五条攻击面对应：面1 文档声称↔实现、面2 保存契约失败路径/回滚、面3 数字复算、面4 门禁绕过（`c6d7506`）、面5 证据链真伪与测试断言强度。

---

## 面 1：`docs/MODULAR-PLUGIN-ARCHITECTURE.md` 的声称 vs 实现

### 1.1【缺陷】`b8a4cb3` 写下的"避免文件与项目包内容交叉"在它自己的提交里并不成立，被 `fbd3242` 的同文件测试删除动作反证

`git show b8a4cb3:docs/MODULAR-PLUGIN-ARCHITECTURE.md | sed -n '170p'`：

```
- 自动保存关闭时仍会标记项目和文件为 dirty。保存期间继续编辑时，旧请求只清除其快照对应的状态，新编辑保持 dirty，并按当前快照自动重试；项目包保存使用发起请求时的文件快照，避免文件与项目包内容交叉。已有延迟保存回归测试覆盖。
```

而同一提交的测试断言的是相反事实——项目包**确实**带着陈旧内容落库。`git show b8a4cb3:tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts | sed -n '276p'`：

```
    expect(JSON.parse(bundlePayloads[0].metadata.workspace).blocks.blocks).toEqual([])
```

`[]` 就是"bundle 里的 workspace 不含用户刚编辑的 `edited` 块"。`fbd3242` 把这行连同整个用例删除，换成"flush 全部 dirty 文件后才生成 bundle"（见 `git show fbd3242 -- tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts`：原用例名 `keeps edits made during a save dirty and retries with the newer content` 被 `flushes every dirty file before retrying the bundle` 取代，并新增 `expect(bundlePayloads).toHaveLength(0)`）。

结论：`b8a4cb3`（22:33）时的实现在保存**非活动**文件时根本未刷新其 workspace，项目包用陈旧快照覆盖；文档提前 2 小时写下了 `fbd3242`（次日 00:28）才实现的保证。这不是措辞问题，是一句当时为假的契约陈述。

### 1.2【缺陷】"已验"语句唯一能指向的验证脚本，按它自己的 README，恰好不覆盖保存契约

`git show 17b36ac:tests/frontend/e2e/README.md | sed -n '15p'`：

```
便于把日志准确对应到候选提交。该脚本不运行 924 项单元测试或浏览器 E2E；
```

`run-modular-verification.sh` 的 `STEPS` 只有 `verify:templates`、`verify:demos`、`type-check`、`build:prod`（`git show 17b36ac:tests/frontend/e2e/run-modular-verification.sh | sed -n '13,18p'`）。保存契约的**全部**判据在单测（`tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts` 744 行）与浏览器烟测（`workspace-smoke.mjs`）里，二者都不在这 8 次被存档的运行中。因此 `07c4fa6`/`b8a4cb3`/`25a1a93`/`13f413f` 的 "persist / record / refresh verification evidence" 与保存行为之间没有证据通路。

### 1.3【缺陷】`13b157a` 写死的契约句在 HEAD 仍未与实现对齐的两处

`git show 17b36ac:docs/MODULAR-PLUGIN-ARCHITECTURE.md | sed -n '85p'` 声称"关闭自动保存会取消排队中的自动保存"，实现是 `watch(autoSaveEnabled)` → `clearAutoTimer()`（`multiFilePersistence.ts:62-66`），成立。但同一段声称 `cancelPendingSave` 是契约的一部分：`git grep -c cancelPendingSave 17b36ac -- frontend/src tests` 只在 `session/workspace/workspace-session.ts`（2 处定义）与其测试（3 处）出现，**生产代码 0 处调用**。同一文件里 `saveCurrentFile(isAuto, skipProjectCode)` 的 `skipProjectCode` 参数在 HEAD 的 6 处调用点全部走默认值（`git grep -n 'saveCurrentFile(' 17b36ac -- frontend/src`），也是死参数。文档把两条死路径写成"保存语义"。

### 1.4【缺陷】HEAD 文档的行数陈述已过期：`496` vs 实测 `498`

`git show 17b36ac:docs/MODULAR-PLUGIN-ARCHITECTURE.md | sed -n '169p'`：

```
- `EditorView.vue` 已由 3028 行降到 496 行；`useMultiFileProject.ts` 当前为 408 行。……
```

实测 `git show 17b36ac:frontend/src/features/blockly/views/EditorView.vue | wc -l` = **498**；`useMultiFileProject.ts` = 408（对）。`496` 由 `502ed90`（文档目录重组，不在 17 笔内）引入，因此不判这 17 笔的账，但它是"前一句已验证、后一次提交静默失效"的实例，HEAD 的可核查性已被破坏。

### 1.5【缺陷】这 17 笔"已验"所对应的实现，在 HEAD 已被镜像同步整体重写，且没有随附复验

`git show --numstat --format= 43b4e7c -- frontend/src/features/blockly/composables/useMultiFileProject.ts`：

```
26	271	frontend/src/features/blockly/composables/useMultiFileProject.ts
```

`git show --name-only --format= 43b4e7c | grep -E 'MODULAR|tests/'` → **0 行**：这次 -271/+26 的搬迁（保存逻辑迁入新文件 `multiFilePersistence.ts`）没有改动任何测试、也没有改动本线的文档。而绑定测试的 blob 一字未变：

```
git rev-parse 17b36ac:tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts   → 28ffed4f...
git rev-parse 43b4e7c^:tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts  → 28ffed4f...
```

即：`214f7cc`…`3b37da4` 验证的那份 `useMultiFileProject.ts`（653 行、内联保存逻辑）在 HEAD 已不存在于该文件；`ccb1d82`/`fbd3242` 的保证现在由未被这 17 笔验证过的新模块承载。**"已验"是时点性的，且没有任何提交记录这次改写后的重验。**

---

## 面 2：失败路径是否真的回滚（`5433eb1` / `ccb1d82`）

### 2.1【观察·成立】切换失败确实不改动工作区，回滚是真的（不是只加了测试）

`5433eb1` 的关键是把所有状态变更推迟到两次网络请求都成功之后（`#L131-L163`，`applyProjectSnapshot` 只在 try 尾部调用）：

```
      const snapshot = await fetchProjectSnapshot(pid)
      applyProjectSnapshot(pid, snapshot)
      identity.dispatchWorkspace({ type: 'loadSucceeded' })
```

失败时 `catch` 只发 `loadFailed`，`projectId/files/entryFileId/tabs` 全未触碰。测试不是 spy 计数，而是终态断言（`git show 3b37da4:tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts`，`preserves the current project when the %s request fails` 用例）：

```
    expect(context.identity.projectId.value).toBe(PROJECT_A)
    expect(localStorage.getItem('blockly-project-id')).toBe(PROJECT_A)
    expect(context.identity.workspacePhase.value).toBe('failed')
    expect(context.files.value.map((item) => item.fileId)).toEqual(beforeFiles)
    expect(context.activeFile.value?.fileId).toBe(FILE_A)
```

`toEqual(beforeFiles)` + `activeFile` 是"回滚到原项目"的直接判据，比"spy 调用次数"强。此条不是缺陷，记在这里是为了说明该组的失败路径并非幻灯片。

### 2.2【缺陷】"失败后仍可继续保存"这条唯一能防止丢数据的路径没有断言

`workspace-session.ts` 的 `canRequestSave` 明确把 `'failed'` 列入可保存相（`#L177-L185`），这是 `2.1` 的回滚能兑现成"用户还能救回编辑"的前提。但测试只断言 `workspacePhase === 'failed'`，**没有一条用例在 `failed` 相下再调一次 `saveCurrentFile` 并断言成功**。换言之：若 `canRequestSave` 少写一个 `'failed'`，全部现存测试仍然全绿，而用户切换失败后被保留的编辑将永远无法保存（丢数据）。这是静态可指出的断言空洞。

### 2.3【缺陷】`cancelQueuedSave` 会把 `conflict/partialFailure/failed` 抹成 `ready`

`git show 17b36ac:frontend/src/features/blockly/session/workspace/workspace-session.ts | sed -n '188,206p'`：

```
  return accepted({
    ...state,
    phase: 'ready',
    lastSaveResult: 'canceled',
    pendingSave: null,
  })
```

`phase:'ready'` 是写死的，不继承进入时的相。`applySaveResult` 却严格按结果映射（`conflict→'conflict'`，`partialFailure→'partialFailure'`）。当前因为 `cancelPendingSave` 生产 0 调用（见 1.3）而未触发，但只要接上命令面板的"取消保存"，一次冲突态的取消就会让状态机谎报 `ready`，并把 `dirty` 留在原值——与文档"已派发的保存不能伪装成取消"的语义相邻却相反。

### 2.4【观察】`selectProject` 的保存前置在"保存已在进行"时静默返回 false

`useMultiFileProject.ts:196-204`：`if ((await saveCurrentFile(true)) !== 'saved') return false`，`saveCurrentFile` 在 `requestSave` 未被接受时返回 `'canceled'`，调用方既不提示也不重试。用户在保存窗口里点切换项目，界面无任何反馈。不阻断正确性，但"切换无反应"在真实交互里等价于失灵。

### 2.5【观察】后端"干净契约"的实现是对的，但只覆盖了"项目已存在"这一侧

`ccb1d82` 的服务端分支（`project_service.py:67-75`）与 `3156575` 的顺序修正（先 `require(write=True)` 再判向量缺失）都成立且在 HEAD 仍在：

```
        existing = BlocklyProjectMapper.select_by_project_id_full(project_id)
        if existing:
            access = BlocklyProjectAccessService.require(project_id, user_id, write=True)
            owner_id = int(access["ownerId"])
            if expected_file_versions is None:
                raise ProjectFileVersionConflictError(
                    "已有项目的保存请求缺少文件版本向量，请刷新后重试"
                )
```

`3156575` 的动机（权限先于冲突，避免越权用户拿到"缺向量"这一内部状态）是对的，且测试补了 `require` 的 monkeypatch，属于真修正而不是绕过。

---

## 面 3：数字复算（`--numstat` 对照）

### 3.1【观察】任务书给出的数字全部复核通过，但**17 笔的提交正文里没有任何一个数字**

`git log -1 --format='%B' <c>` 对 17 笔逐条读：全部只有一行 subject，无 body（例：`test(workspace): refresh final save evidence`）。所以"文件数/行数"只存在于任务书与审计综述里，仓库内无可对照的声称。逐笔实测（`git show --numstat --format=`，二进制记为 `-`）：

| commit | 文件 | +/− | 备注 |
|---|---|---|---|
| 214f7cc | 9 | 768/60 | |
| 94de158 | 2 | 199/0 | 纯文档 |
| 5433eb1 | 9 | 419/232 | |
| c6d7506 | 4 | **17/6** | 与任务书一致 |
| 82c5b33 | 2 | 87/0 + 二进制 | |
| ab4d88e | 1 | 1/1 | 纯文档 |
| 6f9e3fd | 3 | 37/5 | |
| 07c4fa6 | 4 | 97/6 + 二进制 | |
| 4fac3d4 | 2 | 87/23 | |
| b8a4cb3 | 4 | 16/5 + 二进制 | |
| fbd3242 | 9 | 495/94 | |
| 13b157a | 3 | 8/3 + 二进制 | |
| ccb1d82 | 6 | 141/6 | |
| 25a1a93 | 3 | 6/4 + 二进制 | |
| 3156575 | 3 | 11/2 | |
| 13f413f | 1 | **二进制 0/0** | 与任务书一致 |
| 3b37da4 | 2 | 15/1 + 二进制 | |

`13f413f` 的"1 文件 / 0 增 0 删"成立，其对象为 `frontend/public/docs-assets/tutorials/14-workspace-session-save.png`（`git rev-parse 13f413f:frontend/public/docs-assets/tutorials/14-workspace-session-save.png` → `18bbd29...`）。该 blob 在 17 笔内被覆盖 **6 次**：`efeb4f0`(82c5b33) → `93fd514`(07c4fa6) → `e2ac044`(b8a4cb3) → `8f6b94c`(13b157a) → `24840d6`(25a1a93) → `18bbd29`(13f413f) → `80622da`(3b37da4)。

### 3.2【观察】文档里的行数复算逐笔**准确**（这一点不能造假）

```
07c4fa6 useMultiFileProject=563 EditorView=2470   ← 文档写 563/2470，对
b8a4cb3 useMultiFileProject=584 EditorView=2470   ← 文档写 584/2470，对
13b157a useMultiFileProject=649 EditorView=2470   ← 文档写 649/2470，对
25a1a93 useMultiFileProject=653 EditorView=2474   ← 文档写 653/2474，对
17b36ac useMultiFileProject=408 EditorView=498    ← 文档写 408/496，后者差 2（见 1.4）
```

### 3.3【缺陷】"918 → 922 → 924 项单元测试"没有任何运行记录支撑，且其中两次是**纯文档提交**在改这个数字

`git show 13b157a -- tests/frontend/e2e/README.md` 与 `git show 25a1a93 -- tests/frontend/e2e/README.md` 各自只有一行差异，分别把 `918` 改成 `922`、`922` 改成 `924`；而这两笔的 `--numstat` 分别是 `8/3`、`6/4`，**没有新增任何测试文件或用例**（新增测试在父提交 `fbd3242`、`ccb1d82` 里）。同时：

- `tests/frontend/e2e/artifacts/` 的 8 次运行全部没有单测步骤（见 5.2），仓库内不存在任何一次 vitest 运行的记录；
- 静态计数在 `25a1a93` 与 HEAD 都是 **813** 行 `it(`/`test(`（`git grep -hE "^\s*(it|test)(\.each)?[\(\[]" <c> -- tests/frontend | wc -l`），与 924 的差需由 `it.each` 展开解释，但没有任何一条记录固定这个展开数。

结论：`924` 是一个无法从仓库复现、无法从日志追溯、且由两次文档提交递增的"数字"。它不影响保存契约本身，但它和本组"每修一处就配一份已验"的叙事直接冲突。

---

## 面 4：`c6d7506`「satisfy full type-check gate」是否绕过门禁

### 4.1【观察·通过】没有 `# type: ignore` / `noqa` / `eslint-disable`，改动是真实类型修复

```
git show 17b36ac:backend/owl_admin/controller/blockly/bruteforce.py | grep -nE 'type: *ignore|noqa|pyright: *ignore'
→ 0 命中（四个文件同）
```

四处改动逐条读都是实质修复：

- `_select_owned_task` 补 `-> tuple[SysBruteforceTaskPo | None, AjaxResponse | None]`，并把 `blockly_bruteforce_resume` 改成解包 `(task, error_response)`，四处调用点（`#L643/L673/L747/L850`）全部同步；
- `generate_des_tables.py` 把 `assert spec.loader is not None` 换成 `raise ImportError(...)`（`assert` 在 `-O` 下会被剥掉，这是真修）；
- `differential_linear.py` 把 `choices: list[list[tuple[int,int]]]` 改为 `tuple[int,int,int]`——原注解与写入的 `(index, out, count)` 三元素确实不符；
- `mitm_2des.py` 在两个用 `_DES` 的函数前加 `if _DES is None: raise RuntimeError(...)`，消除 None 解引用。

唯一的逃逸是 `cast(Any, celery_app.control)`（1 处，`bruteforce.py:342`），属可接受的边界收敛，不构成"按缺陷报告"的门禁绕过。**此条不列为缺陷。**

### 4.2【观察】类型修复夹带了行为变化，提交信息未声明

改动前 `_select_owned_task` 在无权限时返回一个 `AjaxResponse`，调用方 `if not task: return AjaxResponse.from_error(msg="任务不存在或无权访问")` 把它丢弃并换成通用文案；改动后原响应被原样返回。这会让越权用户看到更精确的错误信息（安全上更差一点，可用性上更好一点）。它是否可接受应由作者判断，但"类型检查通过"这类提交不应静默改变对外错误文案。行数 17/6 与任务书、与 `--numstat` 三方一致。

---

## 面 5：证据链真伪与测试断言强度

### 5.1【缺陷】全部"证据"只有一张截图；它记录的是"保存按钮成功了一次"，不含任何判据

七个版本的截图目视结论（`read_image`）：

| 版本 | 状态栏时钟 | 提交时间 | 可见内容 |
|---|---|---|---|
| 82c5b33 | 已保存 8:05:46 PM | 20:13 | 顶部绿色「已保存」toast + 状态栏 |
| 13f413f | 已保存 2:30:06 AM | 02:33 | 仅状态栏「已保存」 |
| 3b37da4 | 已保存 10:19:26 AM | 10:27 | 仅状态栏「已保存」 |

三个版本时钟都早于各自提交时间 3–8 分钟，可以认定是现场重拍而不是复制粘贴；**但这张图在任何实现下都会长这样**：保存一个文件 + 两个 200 响应，就会显示「已保存」。它没有版本向量、没有冲突提示、没有 dirty 标记、没有阴性对照。除 5.4 的脚本判据外，这 17 笔里没有任何一份"证据"自带阈值、期望态或反例。

### 5.2【缺陷】"persist evidence" 实际未入库：被存档的只有 4 步构建日志，且它们被 gitignore 掉了

`ls tests/frontend/e2e/artifacts/` 有 8 个 run 目录，每份 `summary.log` 的步骤集合固定为：

```
step=01-verify-templates ... step=02-verify-demos ... step=03-type-check ... step=04-build-prod ... ok=true
```

`git check-ignore -v tests/frontend/e2e/artifacts/20261021T143437Z-100988/summary.log`：

```
.gitignore:38:**/*.log	tests/frontend/e2e/artifacts/20261021T143437Z-100988/summary.log
```

即这些日志只因后缀 `.log` 被忽略、从未被 `git add`；`07c4fa6`（提交名 `persist modular verification evidence`）入库的是 README 与脚本 + 一张 PNG，**证据本体一行都没进版本库**。这不只是洁癖问题：`07c4fa6` 的提交名与该提交的实际内容不符。

### 5.3【缺陷】来源追踪（provenance）自相矛盾：前 3 次运行没有 `git_head`，"6f9e3fd 基线"这句话无法成立

`summary.log` 里 `git_head_start/git_head_end/node_version/pnpm_version` 只在第 4 次（`20261021T143437Z-100988`）之后出现——正是 `b8a4cb3` 给脚本加的那些行。前三次全无。而 `07c4fa6` 的 README 写着：

```
git show 07c4fa6:tests/frontend/e2e/README.md | sed -n '14p'
2026-10-21 在实现基线 `6f9e3fd` 上实际运行通过：
```

时间线对不上：`6f9e3fd` 的作者/提交时间均为 `2026-10-21 20:53:43 +0800`（= 12:53:43Z），而最早一次运行 `run_id=20261021T124846Z-4158611` **开始于 12:48:46Z**，早于该提交 5 分钟；它跑的是更早的候选（`82c5b33`/`5433eb1` 之后）。`13:11Z` 那次才可能落在 `6f9e3fd` 上，但它没有记录 HEAD，无法证明。随后 `b8a4cb3` 把这句话改成了 `2026-10-21 在实际候选上运行通过`（`git show b8a4cb3 -- tests/frontend/e2e/README.md`），把唯一可核对的锚点**删掉**，而不是补上。

### 5.4【缺陷】`verify:demos 59/59` 无法从仓库复现，且 29/29 与 59/59 在 8 个不同候选上完全不变 → 对本线零辨别力

`frontend/scripts/verify-demos.mjs` 读 `../demos/tests.json`，而 `demos/` 被忽略：

```
git check-ignore -v demos/tests.json → .gitignore:53:/demos/	demos/tests.json
git ls-tree -r --name-only 17b36ac | grep -cE '^demos/|^frontend/demos/'  → 0
```

干净 checkout 里没有 `demos/`，`verify:demos` 会直接 `readFileSync` 失败。同时 8 次运行的末行**完全相同**：

```
模板: 29/29 PASS | DEMO_SUMMARY total=59 pass=59 fail=0      （8/8 次）
```

在一个专门修保存契约的候选集上，这两项数字一次都没变过——它们证明的是"镜像过来的模板/向量没被碰坏"，不是"保存契约被验过"。把它们写进"modular verification evidence"是在扩大证据的语义。

### 5.5【缺陷】后端测试断言强度：真实比较只有一处，且缺正样本；新增校验器 0 测试

`tests/backend/unit/services/test_project_save_conflict.py` 把 `select_by_project_id_full`、`BlocklyProjectAccessService.require`、`upsert_project` 全部 monkeypatch 掉，只断言"service 把 `conflict` 映射成异常"——**一行真实版本比较都没跑**。

唯一触到真实比较的是 `tests/backend/unit/mappers/test_project_bundle_versions.py`（`raw_upsert = BlocklyProjectMapper.upsert_project.__func__.__wrapped__`，绕过 `@Transactional`），断言：

```
    assert result == "conflict"
    assert calls == ["execute"]
```

这两条是有效断言（冲突时不执行 UPDATE），但**只有 `expected={"file-a":1}`、库中 `version=2` 的失配分支**，没有"匹配时返回 `saved`"的正样本。一个永远 `return "conflict"` 的实现能 100% 通过该用例——这正是 214f7cc 那批 416 行前端测试之外，后端最薄的一环。

`fbd3242` 新加的 `ProjectSaveBody.versions_within_project_limit`（>64 项、`version<1`、空 `file_id` 拒绝）在 `tests/backend/unit/controllers/test_project_save_body.py` 里 **0 覆盖**（该文件只有 utf8 字节上限、metadata、snake_case 别名、DDL 断言等用例，`grep -c '64'` = 0）。

### 5.6【缺陷】`3156575` 的"强化重试回归"只数调用次数，没有断言上限本身

`git show 3156575 -- tests/frontend/unit/blockly/composables/use-multi-file-project.test.ts` 的全部内容是三条：

```
      expect(bundleCalls).toBe(4)
      await vi.advanceTimersByTimeAsync(1_200)
      expect(bundleCalls).toBe(5)
      await vi.advanceTimersByTimeAsync(2_400)
      expect(bundleCalls).toBe(6)
```

它证明的是"新一轮编辑周期把重试预算重置了"，**没有**在 6 次之后再推进时间断言"不再有第 7 次"。真正的上限断言在另一个用例里（`advanceTimersByTimeAsync(5_000); expect(bundleCalls).toBe(3)`），所以限制本身是被覆盖的，但 `3156575` 这笔自称的"强化"并未强化上限；它把断言加在 `bundleCalls` 这类计数上，而不是最终状态（`lastSaveResult`、`hasUnsavedChanges`、`phase`）——后半段两者都没断言。

相对的，`4fac3d4`/`fbd3242` 的前端用例是这组里最强的：断言 `updatePayloads[0].workspace === WORKSPACE`（旧快照）、`updatePayloads[1].workspace === editedWorkspace`（新内容）、`bundlePayloads[0].expected_file_versions` 逐键相等、`localStorage` dirty 位为 `'1'`。这些是终态断言，不只是 spy 次数。**这条不是全盘否定：前端单测确实是本组唯一"真断言"的地方。**

### 5.7【缺陷】把可用口令写进版本库

`docs/MODULAR-PLUGIN-ARCHITECTURE.md:196` 与 `tests/frontend/e2e/README.md:29` 的复现命令里，`SMOKE_PASSWORD` 是**实际取值而非占位符**（本会话输出被宿主掩码为 `{{SECRET_...}}`），同段的验证码才是占位符：

```
SMOKE_PASSWORD=admin123 \
SMOKE_CAPTCHA_CODE=<当前验证码> \
```

`git show 17b36ac:tests/frontend/e2e/README.md | grep -c '{{SECRET'` → **0**（若仓库里写的是字面占位符，这个数字会是 1 或更多），且该字段值长度为 10 个字符（`awk -F= '{print length($2)}'`）。`SMOKE_USERNAME=admin` 同段给出，说明这是一个可用的管理员入口凭据。以"可复现验收"为名把口令固化进两个文档，代价远大于收益；这两处都是本组提交写进去的（`5433eb1` 首次写进 docs，`07c4fa6` 写进 README）。

### 5.8【观察】`13f413f` 与 `3b37da4` 的"证据刷新"与各自的代码改动无可推定的因果关系

- `13f413f` 只换图，图内容与上一版 `25a1a93` 唯一可见差别是状态栏时钟（2:2x → 2:30），**没有任何文本记录这次运行断言了什么**；
- `3b37da4` 的代码改动是"等工具箱就绪"（`waitForTimeout(1000)` → 等 `哈希与填充单元`/`后量子基础块` 文本），一个等待逻辑的改动不会改变截图内容，但截图确实又换了一次（113,584 字节，md5 `a904a52d`）。这两处的图更像"每次跑完就顺手覆盖"，而不是"针对本次改动出具判据"。

---

## 一句话结论

这条线**不是全假**：`fbd3242`/`4fac3d4`/`5433eb1`/`ccb1d82`/`3156575` 的实现分支在 HEAD 的 `multiFilePersistence.ts` 与 `project_mapper.py` 里逐条对得上，切换失败的回滚是真回滚、前端单测也是真终态断言；但"每修一处配一份已验"这个叙事站不住——17 笔里唯一的证据实体是一张**任何实现下都会显示「已保存」的截图**，被存档的 8 次运行只跑模板/Demo/类型检查/构建（自述"不运行 924 项单元测试或浏览器 E2E"），`persist evidence` 的证据本体从未入库，`6f9e3fd 基线` 那句话被时间戳和后续改写共同推翻，`59/59` 在 8 个不同候选上雷打不动且依赖被 gitignore 的 `demos/`，`b8a4cb3` 更写下了一句它自己的测试正在反证的"避免内容交叉"契约，而全部"已验"所对应的 653 行实现在 HEAD 已被 `43b4e7c` 整体搬迁却没有任何复验。

等级归集：**阻塞 0 条**；**缺陷 12 条**（1.1、1.2、1.3、1.4、1.5、2.2、2.3、3.3、5.1、5.2、5.3、5.5、5.6、5.7 中去重后按面计：面1 五条、面2 两条、面3 一条、面5 五条——面4 无缺陷）；**观察 6 条**（2.1 成立项、2.4、2.5、3.1、3.2、4.1、4.2、5.8）。真正会丢用户数据的具体入口只有一条：`5.7` 之外，`2.2` 的"失败相不可保存"若被改动则编辑不可挽回，当前实现是对的但无断言保护。
