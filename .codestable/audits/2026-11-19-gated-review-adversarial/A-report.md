A-SEAT md5check: 7b57abd=713a203ad8b0f68e5c6909f3a5363e3b(match) 1272230=0022112269d7ad015ed37ccc5fe3bd2d(match) bd0b09f=eb430e2f8c7b5f3f6981587f16f9b776(match) 917f16e=d7d1473b2c05b98d1fde12e064fd3b63(match) d7a02ea=91c321e65403d291b955ce5f038942cd(match)

复算命令（两个仓库各跑一次）：
```
cd /run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat
git diff 7b57abd^ 7b57abd | md5sum ; git diff 1272230^ 1272230 | md5sum
cd /run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server
git diff bd0b09f^ bd0b09f | md5sum ; git diff 917f16e^ 917f16e | md5sum ; git diff d7a02ea^ d7a02ea | md5sum
```

---

## 面1：编造裁定（结论式断言 → 出处 → 一致/不一致）

[面1][阻塞] RESULTS.md@7b57abd:4665 | 逐字引用：「费用估算：owner 已裁决**不做**（只显示 token 与耗时），所以 §3.4 的那条待办关闭，不再列为缺口。」 | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| sed -n '4665p'` 与 `git show 7b57abd:experiments/ai-helper-2026-11-14/proposals/PARALLEL-EXECUTION.md \| sed -n '130,141p'` 与 `git show 7b57abd:docs/guides/AI-HELPER.md \| sed -n '198p'` | 实测：同一棵树内无任何「owner 裁决不做费用估算」的记录；§3.4（PARALLEL-EXECUTION.md:130-141）仍写「界面上要显示：本次调用用了多少 token、估算费用（用户填了单价才算）」；AI-HELPER.md:198 仍写「费用估算尚未实现」。把「未落地/仍要求」写成「owner 已裁决不做」，是待定→已定，按规则阻塞。

[面1][缺陷] RESULTS.md@7b57abd:4631 | 逐字引用：「新增 `ai-helper-model-notes.test.ts`（8 组：依据存在、没依据不连累别人、依据越界整句丢、空白/重复、上限与覆盖、无自述/空候选、mock 自洽）。」 | 复现命令：`git show 7b57abd:tests/unit/ai-helper-model-notes.test.ts \| grep -c '  it('` 与 `git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| sed -n '4631,4632p;4645,4646p'` | 实测：`it(` 计数 = 7，describe = 1；括注本身只列 7 项；§67.5 又写「+1 文件 7 条」。三处对不上，「8 组」不成立（若把 describe 也算一组则括注应列 8 项）。

[面1][缺陷] commit-message@d7a02ea | 逐字引用：「DocsView.vue 原本 556 行的编排逻辑与 400 余行分类/标题表混在一处。」 | 复现命令：`git show d7a02ea^:frontend/src/features/docs/views/DocsView.vue \| wc -l` 与 `git diff --numstat d7a02ea^ d7a02ea -- frontend/src/features/docs/views/DocsView.vue` 与 `git show d7a02ea^:frontend/src/features/docs/utils/markdown.ts \| grep -n 'CATEGORY_LABELS\|TITLE_LABELS'` | 实测：父版 DocsView.vue = 913 行（不是 556；556 是 diff 的 3 增 + 553 删）；父版 DocsView.vue 内 `CATEGORY_LABELS`/`TITLE_LABELS` 出现 0 次，两张表在 markdown.ts（184 行、320 行），拆出后 docsTaxonomyLabels.ts = 241 行，不是「400 余行」。

[面1][缺陷] commit-message@917f16e | 逐字引用：「拉齐既有漂移 18 份：blocks/ 6 份（BLOCK-IO-CONTRACT.json 222 → 224 键，与 CipherCat 逐字节一致）、standards/ 10 份…、research/ 2 份」 | 复现命令：`git diff --name-only 917f16e^ 917f16e -- docs/blocks/ \| wc -l` 与 `git diff --name-only 917f16e^ 917f16e -- docs/blocks/` | 实测：docs/blocks/ 变更 7 个文件（BLOCK-IO-CONTRACT.json、INDEX.md/.en.md、data-encoding.md/.en.md、ecc-sbox.md/.en.md），不是 6；按同一「份=文件」口径，6+10+2 = 18 应为 7+10+2 = 19（doc/index 另计）。

[面1][缺陷] commit-message@bd0b09f（标题） | 逐字引用：「chore(blockly): 同步 MetaCrypto Online IDE 的界面文案（D 线模型面板 117 行）」 | 复现命令：`git show bd0b09f -- frontend/src/features/blockly/core/utils/locale/ui-messages.ts \| grep '^+' \| grep -v '^+++' > /tmp/bd.txt; wc -l /tmp/bd.txt; grep -c 'model[A-Z]' /tmp/bd.txt; grep -c 'stw[A-Z]\|standardsToWorkspace' /tmp/bd.txt` | 实测：117 行新增中 74 行是 `model*`（D 线），40 行是 `stw*`/`standardsToWorkspace`（A 线「标准 → 工作区」），1 行注释。标题把 A 线文案也算进「D 线模型面板」。

[面1][观察] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:39 | 逐字引用：「README 因此改为按「纯自带 / 混用 / 项目块」三类分述，不再使用单一数字。」 | 复现命令：`git show 7b57abd:README.zh-CN.md \| sed -n '109p;123p'` | 实测：README.zh-CN.md:123 仍写「17 个工具箱类目中有 5 个含 Blockly 内置积木」，即仍在使用单一数字「5」；「不再使用单一数字」不成立（三类分述与「5」并存）。

（已核对且一致的结论式断言：`verifyRewrite` 三类越界——`src/services/ai-helper/model/verify.ts:24` 的 `RewriteViolationCode = 'unknown-id' | 'duplicate-id' | 'too-many'`；`MAX_NOTE_SENTENCES = 4`——`notes.ts:30`；`planNotes` 五码——`notes.ts:33-38`；BLOCK-IO-CONTRACT 222→224——旧 blob 222 键、新 blob 224 键且 md5 与 CipherCat 相同；「AI-HELPER / METACRYPT-SYNC 落 user-guides / development-guides」——`markdown.ts@d7a02ea` 的 `GUIDE_CATEGORIES`。）

已执行：5 笔提交的 commit message + 全部新增/修改正文的「已/必须/不得/裁定」类断言抽取；关键断言逐条回源码行；`owner 已裁决` 类措辞回查 PLAN/PARALLEL-EXECUTION/RESULTS。未执行：仓库外对话记录（不可得，按规则不降级）。

---

## 面2：锚点逐条核

[面2][缺陷] RESULTS.md@7b57abd:4637 | 逐字引用：「入口 chunk 只剩 13 字节余量（§66.6：65523 / 65536）」 | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| grep -n '^### 66\.\|^## 66\.'` | 实测：§66.6 =「没做的（明确不在这轮）」（4557 行）；§66.7 =「一个真实约束：入口 chunk 只剩 13 字节」（4565 行），65523/65536 在 §66.7。锚点指错节。

[面2][缺陷] RESULTS.md@7b57abd:4665 | 逐字引用：「所以 §3.4 的那条待办关闭」 | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/proposals/PARALLEL-EXECUTION.md \| sed -n '130,141p'` | 实测：§3.4 确实存在（PARALLEL-EXECUTION.md:130「配额与超时」），但 141 行要求「界面上要显示：…估算费用」，内容不支持「待办关闭」；该锚点被用来支撑与原文相反的结论。

[面2][缺陷] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:17,25,41 | 逐字引用：「Demo 工作区 | 60 | [`demos/tests.json`](../../demos/tests.json)」；「来自 `src/utils/toolbox-config.ts`（源码路径：`src/utils/toolbox-config.ts`）」；「本口径由 `toolbox-category-taxonomy.test.ts`（源码路径：`tests/unit/toolbox-category-taxonomy.test.ts`） 机器校验」 | 复现命令：`cd ../metacrypt_server && for p in demos/tests.json src/utils/toolbox-config.ts tests/unit/toolbox-category-taxonomy.test.ts src/blocks/index.ts; do git cat-file -e 917f16e:$p 2>/dev/null && echo "EXISTS $p" || echo "MISSING $p"; done` | 实测：四条全部 MISSING（该文档在 metacrypt 提交内，但引用的路径只存在于 CipherCat）。按「文档所在仓库可枚举」口径，这四个锚点在目标仓不可解析。

[面2][观察] docs/guides/AI-HELPER.md@917f16e:5,215,216,217 | 逐字引用：「见[可行性调研](../research/AI-HELPER-RESEARCH-2026-11-13.md)」等 | 复现命令：`for f in docs/guides/AI-HELPER.md docs/guides/AI-HELPER.en.md; do git show 917f16e:$f \| grep -oE '\]\([^)#]+\)' \| wc -l; done` 与逐个 `git cat-file -e 917f16e:<target>` | 实测：4 个新增/修改文档共 10 条相对链接（与 1272230/917f16e 声称的「10 条」一致），目标 `./USER-GUIDE(-.en).md`、`./CAPABILITY-MAP(-.en).md`、`./METACRYPT-SYNC(-.en).md`、`../research/AI-HELPER-RESEARCH-2026-11-13.md` 全部 EXISTS。此锚点通过。

[面2][观察] 其余节锚点：`§59–§61`、`§60.8`、`§66.7`、`§7.7` | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| grep -n '^### 60\.8\|^## 59\.\|^## 66\.'`；`git show 7b57abd:docs/guides/AI-HELPER.md \| grep -n '^### 7\.7'` | 实测：均存在（4203、4085、4498、4565、194 行），通过。

已执行：正文内所有 `§N` 节锚点与所有 `path:line`/路径锚点的存在性核对；metacrypt 新文档 10 条相对链接逐个解析到磁盘。未执行：`docs:check-links` 门禁实跑（禁止跑门禁），以及非本批改动文件里的历史锚点。

---

## 面3：数字复算

| 声称 | 出处 | 声称值 | 复现命令 | 实测值 | 判定 |
|---|---|---|---:|---|---|
| 整笔 patch md5 ×5 | 冻结指纹 | 见首行 | `git diff <c>^ <c> \| md5sum` | 五值全同 | 一致 |
| 7b57abd 文件数 | OBJECTS/任务 | 18 | `git show --stat --oneline 7b57abd \| tail -1` | 18 files changed | 一致 |
| AI-HELPER 中英行数 | RESULTS:4633 | 各 218 | `git show 7b57abd:docs/guides/AI-HELPER.md \| wc -l`；`.en.md` | 218 / 218 | 一致 |
| doc-index 篇/段/hash | RESULTS:4644 | 439 / 4051 / 01709194689d5c17 | `git show 7b57abd:src/services/ai-helper/doc-index.json \| python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['docs']),len(d['secs']),d['corpus'])"` | docs 439、secs 4051、hash 01709194689d5c17 | 一致 |
| doc-titles 条数 | RESULTS:4645 | 439 | `git show 7b57abd:src/generated/doc-titles.json \| python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` | 439 | 一致 |
| 单测文件数 | RESULTS:4645 | 123 | `git ls-tree -r --name-only 7b57abd -- tests/unit \| grep -cE '\.test\.ts$'` | 123 | 一致 |
| 单测通过数 | RESULTS:4645 | 1369 通过 1 跳过 | 需运行 `vitest run`（本轮禁止跑测试；且只能测工作区非提交） | 静态 `it(`=942、`.each`=142，无法据此确认 1369 | 不可复现（见面5） |
| MAX_NOTE_SENTENCES | RESULTS:4602 | 4 | `git show 7b57abd:src/services/ai-helper/model/notes.ts \| grep -n 'MAX_NOTE_SENTENCES ='` | `= 4` | 一致 |
| notes 测试组数 | RESULTS:4631 | 8 组 | `git show 7b57abd:tests/unit/ai-helper-model-notes.test.ts \| grep -c '  it('` | 7 | 不一致 |
| BLOCK-IO-CONTRACT 键数 | 917f16e msg | 222→224 | `git show 917f16e^:docs/blocks/BLOCK-IO-CONTRACT.json \| python3 -c "import json,sys;print(len(json.load(sys.stdin)))"`；`git show 917f16e:…` | 222 → 224 | 一致 |
| 与 CipherCat 逐字节一致 | 917f16e msg | 一致 | `git cat-file blob 917f16e:docs/blocks/BLOCK-IO-CONTRACT.json \| md5sum` 与 `cd ../CipherCat && git cat-file blob 7b57abd:docs/blocks/BLOCK-IO-CONTRACT.json \| md5sum` | 均 87559f730c9f9880633eb35f776c3368 | 一致 |
| Demo 工作区数 | 917f16e msg / CONFORMANCE:17,167 | 60 | `git show 7b57abd:demos/tests.json \| python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` | 60 | 一致 |
| 工具箱可见类目 | CONFORMANCE:25 | 17 | `git show 7b57abd:src/utils/toolbox-config.ts \| grep -c "kind: 'category'"` | 17 | 一致 |
| 自带积木 43（11+10+11+11） | CONFORMANCE:37 | 43 | 逐类 grep：logic_* 6 + controls_* 5 = 11；math_* 10；lists_* 11；text + text_* 11 | 43 | 一致（注：11 个「text_*」含裸 `text` 块，措辞略松） |
| 无 Demo 的块 | CONFORMANCE:332/430 | 91 | 用 BLOCK-IO-CONTRACT 224 键减 demos/**/*.json 的 `"type"` 集（见复现脚本） | 91（缺集含 arr_append、ctrl_range） | 一致 |
| blocks/ 变更份数 | 917f16e msg | 6 | `git diff --name-only 917f16e^ 917f16e -- docs/blocks/ \| wc -l` | 7 | 不一致 |
| 拉齐漂移份数 | 917f16e msg | 18 | `git diff --name-only 917f16e^ 917f16e -- docs/blocks/ docs/standards/ docs/research/ \| wc -l` | 7+10+2 = 19 | 不一致 |
| docsCatalog.ts 行数 | d7a02ea msg | 175 | `git show d7a02ea:frontend/src/features/docs/utils/docsCatalog.ts \| wc -l` | 175 | 一致 |
| docsTaxonomyLabels.ts 行数 | d7a02ea msg | 241 | 同上 | 241 | 一致 |
| markdown.ts 行数 | d7a02ea msg | 557 → 320 | `git show d7a02ea^:…/markdown.ts \| wc -l`；`git show d7a02ea:…` | 557 → 320 | 一致 |
| DocsView.css 行数 | d7a02ea msg | 379 | 同上 | 379 | 一致 |
| DocsView.vue 原行数 | d7a02ea msg | 556 | `git show d7a02ea^:…/DocsView.vue \| wc -l` | 913 | 不一致 |
| 40 个分组 | d7a02ea msg | 40 | 以 `docs/**/*.md` 复刻 buildDocCategories（zh）：见脚本 | 40 | 一致（en=39，未声称） |
| bd0b09f 新增行 | bd0b09f msg | 117 | `git show --stat bd0b09f` / `grep '^+'` | 117 | 一致（构成 74 D + 40 A + 注释） |

复现脚本（91 个无 Demo 块）：
```
cd /run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat
python3 - <<'PY'
import json,subprocess,re
c=json.loads(subprocess.check_output(['git','show','7b57abd:docs/blocks/BLOCK-IO-CONTRACT.json']))
files=subprocess.check_output(['git','ls-tree','-r','--name-only','7b57abd','--','demos/']).decode().split()
blocks=set()
for f in files:
    if not f.endswith('.json') or f.endswith(('tests.json','evidence.json')): continue
    try: d=json.loads(subprocess.check_output(['git','show','7b57abd:'+f]))
    except Exception: continue
    for m in re.finditer(r'"type"\s*:\s*"([^"]+)"', json.dumps(d)): blocks.add(m.group(1))
print(len(c), len(set(c)-blocks))
PY
```

已执行：五笔 patch md5、文件数、行数、键数、条目数、分组数（复刻 buildDocCategories）、无 Demo 块数的命令重算。未执行：`vitest`/`vue-tsc`/`eslint`/`build:check-bundle` 的通过数（禁止跑 lint/build，且工作区非提交树）。

---

## 面4：权威冲突

[面4][观察] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:25-41 | 逐字引用：「运行时工具箱有 17 个可见类目，来自 `src/utils/toolbox-config.ts`…」；「静态清单里列出的自带积木共 **43** 个」；「含自带积木的类目是 **5 个**」 | 复现命令：`git show 917f16e:docs/standards/CONFORMANCE-INVENTORY.md \| sed -n '25,41p'`；`git show 7b57abd:README.zh-CN.md \| sed -n '109,123p'` | 实测：同一组派生计数（17/43/5/12 与 224/250）在 README.zh-CN.md 与本文档各写一遍；两处都指向 `toolbox-category-taxonomy.test.ts`，但文本本身是两份可独立漂移的定义，且已出现一处不一致（README 仍有「5」，文档称「不再使用单一数字」）。建议计数只留一处、另一处改为链接。

[面4][观察] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:57 | 逐字引用：「下表保留精确类型 ID，不复制一份可能漂移的 I/O 规格。」 | 复现命令：`git show 917f16e:docs/standards/CONFORMANCE-INVENTORY.md \| sed -n '57p'`；`git show 917f16e:docs/blocks/BLOCK-IO-CONTRACT.json \| python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` | 实测：文档没有复制端口/类型规格，224 键由 BLOCK-IO-CONTRACT.json 单点定义并声明 `verify:all` 逐字节比对。此点无冲突（正面结论）。

[面4][观察] frontend/src/features/docs/utils/docsTaxonomyLabels.ts@d7a02ea:1,54；markdown.ts@d7a02ea:4 | 逐字引用：「export const CATEGORY_LABELS…」；「export const TITLE_LABELS…」；「import { CATEGORY_LABELS, TITLE_LABELS } from './docsTaxonomyLabels';」 | 复现命令：`git show d7a02ea:frontend/src/features/docs/utils/docsTaxonomyLabels.ts \| grep -n '^export const'`；`git show d7a02ea:frontend/src/features/docs/utils/markdown.ts \| grep -n 'CATEGORY_LABELS\|TITLE_LABELS'` | 实测：两张表只在 docsTaxonomyLabels.ts 定义一次，markdown.ts 改为 import 且不再保留副本（删除 242 行）；CATEGORY_LABELS 管类目 id→标签、TITLE_LABELS 管文件名→标题，职责边界清楚，无重复定义。

[面4][缺陷] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:17,167 | 逐字引用：「Demo 工作区 | 60 | [`demos/tests.json`](../../demos/tests.json) 的键…」；「Demo 身份以 [`demos/tests.json`](../../demos/tests.json) 的 60 个键为准」 | 复现命令：`cd ../metacrypt_server && git cat-file -e 917f16e:demos/tests.json; echo rc=$?` | 实测：rc=1（MISSING）。该文档把 `demos/tests.json` 声明为 Demo 计数权威，但这份权威文件在文档所在的 metacrypt 仓库中不存在，文档内两处「60」在目标仓无法被该权威核验（镜像约定可解释为「权威在 CipherCat」，但文档未写明指向源仓）。

已执行：BLOCK-IO-CONTRACT / demos/tests.json / CATEGORY_LABELS / TITLE_LABELS / 工具箱类目计数 的重复定义检索；两仓同名文件比对。未执行：无（本节检查面已覆盖）。

---

## 面5：声称强度

[面5][阻塞] RESULTS.md@7b57abd:4652 | 逐字引用：「假回复里给两句自述：一句 `support:["s1"]`、一句 `support:[]`。**20/20**：」 | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| sed -n '4648,4662p'`；`ls -l .tmp-build/answer-note/answer-note.png`；`git check-ignore -v .tmp-build`；`git ls-tree -r --name-only 7b57abd \| grep -i answer-note` | 实测：探针「跑完即删」，仓库内无该 BiDi 脚本；唯一产物 `.tmp-build/answer-note/answer-note.png` 存在（186554 字节）但被 `.gitignore:17 .tmp-build/` 忽略、未进提交。20 条断言无法从仓库重跑，只能看一张图；按「肯定性声称须给可复现肯定性证据」判不成立（阻塞级）。

[面5][缺陷] RESULTS.md@7b57abd:4644-4646 | 逐字引用：「`vue-tsc` rc=0、`eslint` rc=0（0 error 0 warning）；…`test:unit` **123 文件 / 1369 通过 1 跳过**…；`build:check-bundle` **65523 ≤ 65536**。」 | 复现命令：不跑（任务禁止 lint/build；且工作区有并发未提交改动，跑出来也不是提交树）。可静态复算的部分：`git ls-tree -r --name-only 7b57abd -- tests/unit \| grep -cE '\.test\.ts$'`=123；doc-index corpus hash=01709194689d5c17。 | 实测：文件数 123 与 corpus 三元组属实；但 1369 通过/1 跳过、vue-tsc/eslint 退出码、65523 字节属运行期读数，仓库内无测试报告或构建产物可复核。声称强度应降为「当时实跑所得，未随提交归档」。

[面5][缺陷] RESULTS.md@7b57abd:4639 | 逐字引用：「build 后入口仍是 **65523 字节**，证明「本轮零文案增量」不是估计而是量出来的。」 | 复现命令：`git show 7b57abd --stat`（18 个文件，无 dist/ 或构建产物）；`git ls-tree -r --name-only 7b57abd \| grep -E 'dist/|bundle'` | 实测：提交未带任何 bundle/测量产物；「量出来的」只有文字记录。可静态确认的只有「本轮没有改 `ui-messages.ts`」（18 文件不含 locale），故「零文案增量」可由 diff 支持，但「65523 字节」不可复现。

[面5][观察] RESULTS.md@7b57abd:4662-4664 | 逐字引用：「真实 provider 仍未在仓库内验证（仓库不带 key）——与 §7.7 的口径一致，本轮不改变这条。」 | 复现命令：`git show 7b57abd:docs/guides/AI-HELPER.md \| sed -n '198,199p'` | 实测：AI-HELPER.md:199「真实 provider 未在仓库内验证（仓库不带 key）」一致。属正确降低声称强度（正面）。

[面5][缺陷] RESULTS.md@7b57abd:4665 | 逐字引用：「owner 已裁决**不做**」 | 复现命令：`git show 7b57abd:experiments/ai-helper-2026-11-14/RESULTS.md \| grep -n 'owner 已裁决'；git show 7b57abd:experiments/ai-helper-2026-11-14/proposals/PARALLEL-EXECUTION.md \| sed -n '141p'` | 实测：仓库内无该裁决记录，且 §3.4 原文要求显示估算费用。把未落地项写成已裁决关闭，按面5同样判不成立（与面1同一处，计一条根因）。

[面5][观察] docs/standards/CONFORMANCE-INVENTORY.md@917f16e:41 | 逐字引用：「本口径由 `toolbox-category-taxonomy.test.ts`… 机器校验」 | 复现命令：`cd ../CipherCat && git ls-tree -r --name-only 7b57abd \| grep toolbox-category-taxonomy`；`cd ../metacrypt_server && git ls-tree -r --name-only 917f16e \| grep toolbox-category-taxonomy` | 实测：CipherCat 存在，metacrypt 不存在。若按文档所在仓判，该「机器校验」在目标仓无可执行入口；若按源仓判则成立。文档未注明源仓，建议补一句。

已执行：每条肯定性声称回仓库枚举证据（doc-index 三元组、123 测试文件、合同 60/224/91、10 条链接、byte-identical md5、截图存在性）。未执行：运行期 pass 计数与 bundle 字节数（见缺口 1–2）。

---

## 缺口与不确定性

1. **运行期读数无法复核**：`1369 通过 1 跳过`、`vue-tsc rc=0`、`eslint rc=0`、`build:check-bundle 65523`、`verify:demos 60/60`、`verify:templates 29/29` 都需要跑测试/构建；任务禁止 lint（会 --fix）、build、install，且工作区有并发未提交改动，跑出来也不是冻结提交树。因此这些只能判「未随提交归档」，不能判「假」。要补的证据：把对应命令的原始输出或产物（bundle 字节数、vitest JSON reporter）随提交归档。
2. **§67.6 的 20/20**：探针脚本已删、截图被 gitignore。需要重新提供可复跑的探针脚本（或把脚本归档到 `experiments/ai-helper-2026-11-14/`）才能复核；当前只能确认截图文件在磁盘上存在（186554 字节）。
3. **owner 裁决**：`owner 已裁决不做费用估算` 可能发生在仓库外的对话里；按本次审查规则「不得以可能在仓库外降级」，判为无证据。需要 owner 的一句明确记录（写入 PLAN/RESULTS 或 DRAFT 决策行）才能转为有效。
4. **metacrypt 侧路径**：`demos/tests.json`、`src/blocks/index.ts`、`src/utils/toolbox-config.ts`、`tests/unit/toolbox-category-taxonomy.test.ts` 在 metacrypt 缺失，属镜像语义；需要文档显式标注「源码路径指 CipherCat」，否则目标仓读者无法解析。
5. **未提交文件不作证据**：`tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts` 只存在于 metacrypt 工作区（`git log --all --` 为空），不属本批冻结对象，未用于判定；bd0b09f 的门禁清单也未包含它。
6. **未核的范围**：RESULTS §67.5 的 `docs:check-links 445/0`、`docs:titles 439` 中，439 已由 `doc-titles.json` 复核；445 的「files」口径（含非 md/索引）未能在不跑门禁的情况下复算，记为未核。
