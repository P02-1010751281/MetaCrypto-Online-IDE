A5-SEAT objects=5

## 覆盖声明

| 项 | 内容 |
|---|---|
| 被审仓库 | `metacrypt_server`（HEAD `17b36ac`） |
| 对照真源 | `CipherCat`（HEAD `ef6e76f`） |
| 对象 | `ced4568`（docker GPU 参数化）、`08c936b`（randomness 检测器刷新 + NIST 夹具）、`502ed90`（文档目录重组、backend/docs 清理声明）、`af99af8`（文档同步）、`17b36ac`（编辑器壳数字 + CONFORMANCE 口径句） |
| CipherCat 侧对照提交 | `fae2eb2`（= `502ed90` 的真源）、`8ad7187`（= `af99af8` 的真源）、`ef6e76f`（= `17b36ac` 的真源） |
| 方法 | 仅只读命令：`git show/diff/log/ls-tree/grep/cat-file`、`wc`、`md5sum`、`sha256sum`、`file`、`strings`、`xxd`、`sed`、`ls`；辅以 python3 做链接解析、位流换算与 YAML 解析（只读，不改仓库） |
| 未做 | 未 build、未 install、未 docker/podman、未执行任何入库二进制；未跑 `npm run *` 门禁（白名单只有只读命令）。因此凡涉及"构建能否成功""门禁是否绿"的结论都只给静态推断，并标注推断依据 |
| 环境事实 | 两仓工作区都带未提交改动（`git status --porcelain` 均有数十行），本报告只对**已提交树**下结论；grep 一律排除 `.codestable`（按日期的一次性审计快照）与 `.agents/memory/session-logs` |
| 行数口径 | `git show <rev>:<path> | wc -l`；已核对 `EditorView.vue` 与 `App.vue` 均以换行结尾，不存在少计 1 行 |

---

## 面 1 — docker GPU 参数化（`ced4568`）

### 1.1 改动实体

```
$ git -C metacrypt_server show ced4568 --numstat --format='%H%n%s%n'
ced45686d5c764591dc76cd049c816a11552ebed
build(docker): parameterize GPU build inputs

5	0	docker/docker-compose.yml
```

唯一改动：`docker/docker-compose.yml` 的 `gpu-worker` 服务 `build:` 下新增

```
      args:
        CUDA_ARCH: ${CUDA_ARCH:-35}
        CUDA_IMAGE: ${CUDA_IMAGE:-docker.io/nvidia/cuda:11.4.3-devel-ubuntu20.04}
```

YAML 解析实测（PyYAML，只读）：

```
$ python3 -c "...yaml.safe_load(git show HEAD:docker/docker-compose.yml)..."
YAML OK; gpu-worker build= {'context': '..', 'dockerfile': 'docker/backend-gpu.Dockerfile',
 'args': {'CUDA_ARCH': '${CUDA_ARCH:-35}', 'CUDA_IMAGE': 'docker.io/nvidia/cuda:11.4.3-devel-ubuntu20.04'}}
profiles= ['gpu']
```

### 1.2 缺省行为核对：**与改前一致，未引入必填变量**（通过项）

`docker/backend-gpu.Dockerfile` 在本提交前后完全一致（`git show ced4568 --name-only` 只有 1 个文件），其中已有同名默认值：

```
$ git show HEAD:docker/backend-gpu.Dockerfile | grep -nE 'ARG|FROM'
15:ARG CUDA_IMAGE=docker.io/nvidia/cuda:11.4.3-devel-ubuntu20.04
18:FROM ${CUDA_IMAGE} AS gpu-builder
22:ARG CUDA_ARCH=35
```

- 两个变量都是 `:-` 缺省展开，默认值与 Dockerfile `ARG` 默认值逐字相同 → 不设变量时 compose 传的 build-arg 等于 Dockerfile 自己的缺省，构建输入与改前等价；
- `gpu-worker` 只在 `profiles: ["gpu"]` 下启用，CPU 路径（`backend-worker` 等）不受影响；
- 没有 `${VAR:?}` 形式的强制变量，旧命令（`podman compose up -d`）不会因缺变量失败。

### 1.3 缺陷：注释推荐的"多卡"取值会把构建打挂

`docker/docker-compose.yml:190`（本提交新增注释）：

> `# 只编宿主实际使用的 CUDA 架构（默认 sm_35 = GT 710/GK208）；多卡时在 docker/.env 里设 CUDA_ARCH="35;50;60"。`

但 `CUDA_ARCH` 在 Dockerfile 里同时喂给两条**语义不同**的路径：

```
44:    -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCH}" \        # CMake：接受 "35;50;60" 列表
59:RUN nvcc -O3 -gencode arch=compute_${CUDA_ARCH},code=sm_${CUDA_ARCH} -shared -Xcompiler -fPIC \
                                           ^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^  # 单架构占位符
```

第 59 行是 **shell 里的** nvcc 调用，`;` 会被 `sh` 当命令分隔符。实测（只读 shell 演示，未执行 nvcc）：

```
$ CUDA_ARCH='35;50;60'; sh -xc "nvcc -O3 -gencode arch=compute_${CUDA_ARCH},code=sm_${CUDA_ARCH} -shared -Xcompiler -fPIC"
+ nvcc -O3 -gencode arch=compute_35
sh: 行 1: nvcc: 未找到命令
+ 50
sh: 行 1: 50: 未找到命令
+ 60,code=sm_35
sh: 行 1: 60,code=sm_35: 未找到命令
```

即：按注释设置 `CUDA_ARCH="35;50;60"` 后，lcplt（CMake 路径，第 44 行）会按列表编译，随后 DES 搜索库 `des_search.cu` 的 `nvcc -gencode` 一步必失败（先被 shell 拆成 `50`/`60,code=sm_35` 两条命令；即使加引号，nvcc 一条 `-gencode` 也只接受单架构）。`docker/verify-gpu.sh:38` 只走 CMake 路径，所以"验证脚本能过"不能证明镜像能 build。

- 等级：**缺陷**（默认路径无恙，但按本提交写下的文档取值构建必挂）。
- 修完要达到：要么把 `CUDA_ARCH` 的文档口径收成单架构（注释删掉 `"35;50;60"` 建议），要么给 DES 库另设单值变量/在 Dockerfile 里按列表循环 `-gencode`；验收方式：按注释给的取值走一次 `--profile gpu build`（本席按规则未执行），并确认 `des_search.cu` 的 nvcc 步骤收到的是合法的单架构参数。

### 1.4 缺陷：新变量没有进 `.env` 模板

`docker/.env.example`（含当前工作区版本）里没有任何 CUDA 变量：

```
$ git show HEAD:docker/.env.example | grep -n 'CUDA'    → （无输出）
$ grep -n 'CUDA' docker/.env.example                    → （无输出，工作区同样没有）
```

而 `docs/DEPLOYMENT.md:143` 明确把该文件当作"可选配置"的唯一模板：

> `docker/.env.example` 仅是变量模板，不包含可用密钥。复制为 `docker/.env` 后填写本机值；该文件不得提交或公开。可选配置如下：

compose 注释里"在 docker/.env 里设 CUDA_ARCH"只有读过 compose 注释的人知道；按 DEPLOYMENT.md 的操作顺序（`cd docker` → `cp .env.example .env` → `podman compose up -d`，见 `docs/DEPLOYMENT.md:76-80`）部署的人拿不到这个旋钮。

- 等级：**缺陷**（偏低；不阻塞，但"参数化"只落在 compose 里，模板与部署手册均未同步）。
- 修完要达到：`.env.example` 出现 `CUDA_ARCH`/`CUDA_IMAGE`（带默认值注释），`DEPLOYMENT.md` 的可选配置表同步一行。

---

## 面 2 — 删除的可达性（`502ed90`）

### 2.1 先证伪任务书的前提：`502ed90` 没有删 `backend/docs`

```
$ git -C metacrypt_server show 502ed90 --numstat --format='' | awk '$2+0>0' | sort -k2 -nr | head -5
0     445   docs/standards/SOURCE-SPLIT-INVENTORY.en.md
0     443   docs/standards/SOURCE-SPLIT-INVENTORY.md
0     116   docs/standards/SOURCE-QUALITY-AUDIT.en.md
0      69   docs/standards/SOURCE-LAYERS.md
$ git show 502ed90 --diff-filter=D --name-only --format='' | wc -l
4
$ git show 502ed90 --diff-filter=D --name-only --format=''
docs/standards/SOURCE-LAYERS.md
docs/standards/SOURCE-QUALITY-AUDIT.en.md
docs/standards/SOURCE-SPLIT-INVENTORY.en.md
docs/standards/SOURCE-SPLIT-INVENTORY.md
```

1,176 行删除全部来自 4 份**被搬到 `docs/audits/standards/` 的审计文档**（前四项共 1,073 行，其余为改动行），提交里**没有任何 `backend/` 路径的删除**。

`backend/docs` 的实际历史：

```
$ git log --oneline --diff-filter=D -- 'backend/docs/*' | head -2
c5d35cd docs: 散落文档归位 + 文档体系同步 — backend/docs 迁入 docs/ + docs-site 补页   # 2026-08-02
$ git ls-tree -r --name-only HEAD backend/docs | wc -l
0
$ git show HEAD:.gitignore | sed -n '50p'
/backend/docs/
$ ls -d backend/docs
ls: 无法访问 'backend/docs': 没有那个文件或目录
```

- 等级：**观察**（陈述不实但不造成回归）。`backend/docs` 早在 2026-08-02（`c5d35cd`）就迁走并删除，且目录自那时起被 `.gitignore:50` 忽略；`502ed90` 只是删掉了本机磁盘上残存的、**从未被 git 跟踪**的副本。
- 影响：这笔"删除"在 diff 里零痕迹、也无法随 clone 传播——任何旧副本的 clone 仍带着 `backend/docs`，而提交信息读起来像已经统一清理。修完要达到：提交信息区分"删除工作区未跟踪副本（git 不记录）"与"从版本库删除"，或干脆不写进提交信息（`AGENTS.md:77` 已有一句带日期的说明）。

### 2.2 旧路径引用：**没有死链接**（通过项）

```
$ for p in docs/standards/SOURCE-LAYERS docs/standards/SOURCE-SPLIT-INVENTORY \
           docs/standards/SOURCE-QUALITY-AUDIT docs/standards/BLOCK-IO-CONTRACT \
           docs/standards/ENDPOINT-MATRIX docs/guides/AUDIT-REPORT docs/standards/REEXTRACTION-REPORT; do
    git grep -n "$p" HEAD -- . ':!.codestable'; done
→ 全部 0 命中
```

机械复核（python3 解析本提交改动的 29 份 md 的全部相对链接、以 `git ls-tree -r -z` 建目标集合）：旧位置的链接 **0 条**。新位置的相对深度正确，例如
`docs/audits/standards/SOURCE-LAYERS.md` 用 `../../standards/fips180-4-SHA2/00-Standard-Source.md`，
`docs/standards/FUNCTION-PRIMITIVE-INDEX.md:62` 用 `../audits/standards/SOURCE-SPLIT-INVENTORY.md`。
搬移本身是干净的。

### 2.3 缺陷：搬走的 12 份审计文档在应用内文档中心"消失"

`502ed90` 把 `docs/audits/` 引入 metacrypt（该目录此前不存在）：

```
$ git ls-tree -d --name-only 502ed90^:docs
blocks build demos guides research standards
$ git ls-tree -d --name-only 502ed90:docs
audits blocks build demos guides research standards
```

但前端分类器没有 `audits` 分支（`git grep -rn "audits" HEAD -- frontend/src` → **0 命中**）：

```
$ git show HEAD:frontend/src/features/docs/utils/docsCatalog.ts | grep -nE "top ===|parts.length === 1"
46:    if (parts.length === 1 || (top === 'research' && parts.length >= 2)) {
64:    if (top === 'standards' && parts.length === 2) {
79:    if (top === 'guides' && parts.length === 2) {
95:    if ((top === 'demos' || top === 'build') && parts.length === 2) {
111:    if (top === 'blocks' && parts.length === 2) {
128:    if (top === 'standards' && parts.length >= 3) {
```

该函数只有这些分支：根级文件、`research/*`、`standards/`（2 层）、`guides/`（2 层）、`demos|build/`（2 层）、`blocks/`（2 层）、`standards/`（≥3 层）。`audits/README.md`（2 层，`top='audits'`）与 `audits/standards/*.md`（3 层）**不匹配任何分支**，不会进入 `catMap`，因此不出现在左侧导航类别里。改前它们在 `docs/guides/`、`docs/standards/` 下，分别命中 guides 分支与 standards 索引分支。

后端列目录是 `os.walk` 全量（`backend/owl_admin/controller/docs.py`），所以文件仍在 `docFiles` 里、靠正文内链仍可打开（`DocsView.vue:326` 会校验 `docFiles.value.includes(...)`），但导航里点不到，且 `hiddenCategories = new Set(['audit-reports','research'])` 说明曾有专门的审计类目概念，现无任何文件能落进去。

- 等级：**缺陷**（可达性回退；不丢内容，但审计页从导航消失，且没有任何门禁会红——metacrypt 没有 `docs:check-links`，`docs/INDEX.md:77` 明说那些命令属于 CipherCat 根仓库）。
- 修完要达到：`buildDocCategories` 增加 `audits` 分支（或在 `standards` 判定里接受 `audits/standards/*`），`docs/audits/README.md` 与 5 对审计页能在文档中心左侧列出；验收：启动应用打开文档中心，侧栏出现"审计报告"类目且条目数 = `git ls-tree -r --name-only HEAD:docs/audits | grep -c '\.md$'`（当前树内共 **14** 份 md：README 中英 2 + project 2 + standards 5 对 10）。

### 2.4 缺陷：`DOCUMENT-STATUS.md` 的依据列仍写旧同目录文件名

`502ed90` 没碰 `docs/standards/DOCUMENT-STATUS.md`（`--name-status` 里没有它），它的"依据"列仍以裸文件名指向已搬走的文件：

```
$ git show HEAD:docs/standards/DOCUMENT-STATUS.md | sed -n '21p;23p;25p;26p'
21: ... | `SOURCE-QUALITY-AUDIT.md`、`pdftotext`、渲染页复核 |
23: ... | `SOURCE-LAYERS.md`、各目录的 `00-*.md` |
25: ... | `SOURCE-QUALITY-AUDIT.md`、`SOURCE-SPLIT-COVERAGE.md`、`STRUCTURED-ENTRY-SCHEMA.md` |
26: ... | `FUNCTION-PRIMITIVE-INDEX.md`、`SOURCE-SPLIT-INVENTORY.md`、`SOURCE-SPLIT-COVERAGE.md` |
```

`SOURCE-QUALITY-AUDIT.md` / `SOURCE-LAYERS.md` / `SOURCE-SPLIT-INVENTORY.md` / `SOURCE-SPLIT-COVERAGE.md` 现都在 `docs/audits/standards/`（`git ls-tree -r --name-only HEAD:docs/standards | grep -E 'SOURCE-'` → 0 行）。这些是行内代码而非链接，`docs:check-links` 抓不到，读者按"同目录"去找会落空；同一份文件里 `FUNCTION-PRIMITIVE-INDEX.md` 却是有效的（它仍在 `docs/standards/`），混排更易误导。

- 等级：**缺陷**（偏低；同一状态在 CipherCat 也存在，不是本仓同步造成的漂移）。
- 修完要达到：依据列改写成带目录的相对链接（`../audits/standards/SOURCE-LAYERS.md` 一类）或至少写出目录前缀；验收：该表 4 行里每个文件名都能在同一目录或标注的目录下 `git cat-file -e` 命中。

---

## 面 3 — `17b36ac` 的数字（逐项重算）

被审文本：`docs/guides/METACRYPT-SYNC.md` 与 `.en.md` 第 1 节、第 3 节表，以及 `docs/standards/CONFORMANCE-INVENTORY.md` 的口径句。

| 声明 | metacrypt 侧实测 | CipherCat 侧实测 | 判定 |
|---|---|---|---|
| EditorView 498 行 | `git show 17b36ac:frontend/src/features/blockly/views/EditorView.vue \| wc -l` → **498**（磁盘 498） | —（该文件是 metacrypt 独有） | ✅ |
| views/editor 9 模块 + 6 CSS（15 文件） | `git ls-tree -r --name-only 17b36ac:frontend/src/features/blockly/views/editor/` → **15** 文件；`grep -c '\.css$'` → **6**；非 CSS → **9**（4 个 `.vue` + 5 个 `.ts`） | — | ✅ |
| components/editor 22 文件（12 Vue + 8 TS + 2 CSS） | — | `git ls-tree -r --name-only ef6e76f:src/components/editor/ \| sed 's/.*\.//' \| sort \| uniq -c` → **22 行**：`2 css / 8 ts / 12 vue` | ✅ |
| App.vue 486 行 | — | `git show ef6e76f:src/App.vue \| wc -l` → **486**（工作区同一文件 486） | ✅ |

补充核对：

- 两仓都不再残留旧值：`git grep -nE '491 行|487 行|7 个模块|（491|（487'` 在 metacrypt `17b36ac` 与 CipherCat `ef6e76f` 的 `docs/` 下均 **0 命中**；
- 中英同改：`17b36ac` 的 diff 里 `METACRYPT-SYNC.md` 与 `.en.md` 各 3 行一一对应（`498/486/15/22` 两侧一致）；
- 与真源逐字一致：`diff -u <(git show 17b36ac:docs/guides/METACRYPT-SYNC.md) <(git show ef6e76f:docs/guides/METACRYPT-SYNC.md)` → **无差异**（126 行 = 126 行），`.en.md` 同样无差异。

**结论：四个数字逐项复算全部正确，无漂移。**

### 3.1 缺陷：CONFORMANCE 的新口径句在 metacrypt 里描述了一张不存在的表

`17b36ac` 把口径句改成（中文侧）：

> README 因此改为按「纯自带 / 混用 / 项目块」三类分述，**并在类目表保留「5 个类目含自带积木」这一合计**——分类明细与合计并存，合计口径即本节 2 + 3。

这句话在 CipherCat 成立：

```
$ git show ef6e76f:README.zh-CN.md | sed -n '123p'
| 函数与 Blockly 内置类目 | 29 个函数模板；17 个工具箱类目中有 5 个含 Blockly 内置积木 |
```

但在 metacrypt 不成立——metacrypt 根 README 的类目表是按目录列的 13 行（`积木块体系（17 类目）`，行 111–123），既没有"自带积木"维度也没有该合计：

```
$ git show 17b36ac:README.md | grep -cE '自带积木|混用|纯自带|项目块|5 个类目'   → 0
$ git show 17b36ac:README.md | grep -c '基础变量'                              → 0
```

（对照 CipherCat 中文 README：`基础变量` 命中 1 次，即上表那一行。）

- 等级：**缺陷**（把真源仓库里对"另一份 README"成立的描述整段搬进镜像，读者在本仓按图索骥找不到那张表；数字本身没错，错的是"README 已经这样写"的断言）。
- 修完要达到：metacrypt 的同一句改为描述本仓 README 的实况（或把 README 类目表补上"纯自带/混用/项目块"三类与 5 个合计，两处任选其一但与文本一致）；验收：在 metacrypt 树内 `grep -c '5 个类目' README.md` 与文档里的断言一致，且中英两版同改。

---

## 面 4 — 同步保真（`af99af8` / `502ed90` / `17b36ac`）

### 4.1 抽样比对（10 份，读法：左=metacrypt，右=CipherCat 同路径）

| 文件 | 比对版本 | 行数 | 差异性质 | 判定 |
|---|---|---|---|---|
| `docs/guides/METACRYPT-SYNC.md` | 17b36ac / ef6e76f | 126 / 126 | 逐字节相同 | ✅ |
| `docs/guides/METACRYPT-SYNC.en.md` | 17b36ac / ef6e76f | — | 逐字节相同 | ✅ |
| `docs/standards/CONFORMANCE-INVENTORY.md` | 17b36ac / ef6e76f | 605 / 605 | 仅链接降级（`[X](../../src/...)` → `X（源码路径：`src/...`）`）；数字 224/29/60/17/5/43/68/59 两侧出现次数逐一相等 | ✅ |
| `docs/audits/standards/SOURCE-SPLIT-INVENTORY.md` | af99af8 / 8ad7187 | 443 / 443 | `diff` 0 行 | ✅ |
| `docs/audits/project/AUDIT-REPORT.md` | af99af8 / 8ad7187 | 60 / 60 | 相同 | ✅ |
| `docs/build/symmetric.md` | af99af8 / 8ad7187 | 549 / 549 | 相同 | ✅ |
| `docs/demos/ENDPOINT-MATRIX.md` | af99af8 / 8ad7187 | 68 / 68 | 相同 | ✅ |
| `docs/standards/COVERAGE.md` | af99af8 / 8ad7187 | 102 / 102 | 仅品牌降级：`CipherCat 积木体系`→`本项目积木体系`、`CipherCat 前端试运行`→`平台前端试运行` | ✅ |
| `docs/standards/sp800-38c-ccm/01-CCM.md` | af99af8 / 8ad7187 | 42 / 42 | 仅标题降级：`## CipherCat 覆盖边界`→`## 项目覆盖边界` | ✅ |
| `docs/audits/README.md`、`audits/standards/SOURCE-LAYERS.md`、`audits/project/AUDIT-REPORT.md` | 502ed90 / fae2eb2 | 34/34、69/69、60/60 | 全部 0 diff | ✅ |

结论：**主体同步无损**——移动的审计文档与真源逐字节相同，链接降级与品牌降级是有规则的（`scripts/sync-docs-to-metacrypt.sh` 的 `perl -0pi` 规则把 `../../(tests|src|scripts)/…` 降级、把 `MetaCrypto Online IDE` 改写为"本项目/平台"），没有内容缺失或数字不同。

### 4.2 缺陷：`af99af8` 新引入 4 条在 metacrypt 必然死掉的链接

同步脚本的降级正则只覆盖 `tests|src|scripts`（`scripts/sync-docs-to-metacrypt.sh`）：

```
perl -0pi -e 's/\[([^\]]*)\]\((?:\.\.\/)+((?:tests|src|scripts)\/[^)\s]*)\)/$1（源码路径：`$2`）/g'
```

`demos|experiments|package.json` 不在其中，而这两个目标在 metacrypt 既不在 git 树、也不在磁盘：

```
$ git show af99af8 --format='' -- docs/standards/SPEC-CARD-MATRIX.md | grep -E '^\+.*SPEC-CARDS' | head -3
+| [`npm run spec:validate`](../guides/SPEC-CARDS.md) | 重算制品哈希、引文锚点、块与类型引用 |
+| [`npm run spec:plan`](../guides/SPEC-CARDS.md) | 把卡片缺口算成可执行工作项 |
+| [`npm run spec:candidates`](../guides/SPEC-CARDS.md) | 复核 `spec-runs/candidates/` 的候选骨架 |
$ git cat-file -e HEAD:docs/guides/SPEC-CARDS.md   → 不存在（CipherCat ef6e76f 存在）
$ ls docs/guides/SPEC-CARDS.md                     → 没有那个文件或目录
```

同一提交在 `CONFORMANCE-INVENTORY.md` 新增行里带进 `../../experiments/ai-helper-2026-11-14/grid-harness/index.html`（metacrypt 无 `experiments/`，磁盘也没有；sync 脚本不复制该目录）。

- 等级：**缺陷**（`SPEC-CARD-MATRIX.md` 是本次新增页，3 条链接一点即空；experiments 那条同样空）。
- 修完要达到：`SPEC-CARDS.md` 要么随 `docs/guides/` 纳入同步，要么在目标仓把该链接降级成"源码路径"文本；experiments 链接同理。验收：对 `af99af8` 改动过的 md 跑一次链接存在性检查，除已知的 gitignore 目标外 0 条缺失。

### 4.3 缺陷：`DOCUMENT-STATUS.md` 的 SETUP 链接两仓不一致（镜像落后于真源）

```
$ diff -u <(git show 17b36ac:docs/standards/DOCUMENT-STATUS.md) <(git show ef6e76f:docs/standards/DOCUMENT-STATUS.md)
-| [SETUP.md](../DEPLOYMENT.md) | 2 | 文档分组和开发模式验收 |      ← metacrypt
+| [SETUP.md](../guides/SETUP.md) | 2 | 文档分组和开发模式验收 |     ← CipherCat
```

（另有一处是许可的品牌降级：`不属于 本项目…` / `不属于 MetaCrypto Online IDE…`，属预期。）

CipherCat 侧有 `docs/guides/SETUP.md`，metacrypt 侧没有：

```
$ git ls-tree -r --name-only 17b36ac:docs/guides | grep -i setup   → （无输出）
$ git ls-tree -r --name-only ef6e76f:docs/guides | grep -i setup
SETUP.en.md
SETUP.md
```

所以 metacrypt 这行是**链接文字与目标不符**（标签写 `SETUP.md`，点开是 `DEPLOYMENT.md`）；CipherCat 已在 `36bf177` 修正，metacrypt 从未把这一行同步过来。

- 等级：**缺陷**（偏低；指向的文件存在，不会 404，但读者会拿到另一份文档）。
- 修完要达到：metacrypt 侧要么补 `docs/guides/SETUP.md`，要么把这行标签改成 `DEPLOYMENT.md` 并指向 `../DEPLOYMENT.md`；验收：该表 5 行的"标签文件名 = 目标文件名"。

### 4.4 观察：`demos/*` 与 `package.json` 链接在"裸 clone"里是死的

机械扫描 `502ed90/af99af8/17b36ac` 改动的 60 份 md（`git ls-tree -r -z` 建目标集，python 解析链接）得 43 条目标缺失，按目标聚类只有三类：

- `demos/**`（14 个目标，34 条链接，集中在 `CONFORMANCE-INVENTORY.md` 19 条、`CAPABILITY-MAP.md` 8 条）：metacrypt `.gitignore:52` 是 `/demos/`，该目录由同步脚本生成、**磁盘上存在**（`ls demos` 有 `tests.json`/`evidence.json`/`procedures/`），所以已同步的部署里能点开，新 clone 里点不开；
- `package.json`（3 条，`PRODUCT-CERTIFICATION-FEASIBILITY*.md`）：metacrypt 根 `package.json` 在磁盘上有、**不在 git 树**；
- `docs/guides/SPEC-CARDS.md` 与 `experiments/**`（见 4.2，真死）。

`demos|package.json` 两类属于"同步产物不入库"的既有设计，不计为本轮缺陷，但应知道：metacrypt 没有 `docs:check-links` 门禁（`docs/INDEX.md:77`），这类"只在部署树成立"的链接没有任何自动检查。

---

## 面 5 — 二进制与夹具（`08c936b`）

### 5.1 提交实体

```
$ git -C metacrypt_server show 08c936b --numstat --format=''
1	0	randomness/README.md
22	0	randomness/data/README.md
-	-	randomness/data/data.bin
-	-	randomness/tools/rddetector/rddetector

$ git show 08c936b --stat --format=''
 randomness/README.md                   |   1 +
 randomness/data/README.md              |  22 ++++++++++++++++++++++
 randomness/data/data.bin               | Bin 0 -> 125000 bytes
 randomness/tools/rddetector/rddetector | Bin 2056376 -> 2162848 bytes
 4 files changed, 23 insertions(+)
```

- **新入库二进制**：`randomness/data/data.bin`，125,000 字节；
- **替换二进制**：`randomness/tools/rddetector/rddetector`，2,056,376 → 2,162,848 字节；
- 本提交**没有改任何 `.go`**（"工具链是否与新二进制一致"因此完全无法从提交本身判断）。

### 5.2 缺陷：`data.bin` 无来源、无哈希、无许可说明，而且它不是 NIST 素材

```
$ git show 08c936b:randomness/data/data.bin | file -
/dev/stdin: data
$ git cat-file -s 08c936b:randomness/data/data.bin         → 125000
$ git show 08c936b:randomness/data/data.bin | sha256sum
60d4948008872854431773cfd6ffd0e0024e74054d6e9f2cf13e72db833e6db2  -
$ git show 08c936b:randomness/data/data.bin | md5sum
85b1d8fd63d7ffe44d44a89d8a87cb66  -
$ git show 08c936b:randomness/data/README.md    # 摘录（+22 行；表格与结论句为原文，命令段省略）
# 固定样本
本目录保存随机性检测的固定输入，不包含新鲜熵源采样结果。
| 文件 | 格式 | 规模 | 用途 |
| `data_e`  | ASCII 0/1 文本 | 1,000,000 bit 对应的 NIST 参考序列 | Go 包内 NIST SP 800-22 组合测试 |
| `data.bin` | 原始字节 | 125,000 字节，正好 1,000,000 bit | `rddetector --suite nist` 的二进制输入回归 |
（省略：mkdir/cp + rddetector 的示例命令）
该命令实际执行 15 项 NIST SP 800-22 检测。固定样本用于验证检测流程和边界，不用于评价宿主机当前熵源质量，也不构成随机数产品认证。
```

README 对 `data.bin` 只写了格式/规模/用途，**没有来源、没有哈希、没有许可证说明**；`randomness/LICENSE` 是 MIT（`Copyright (c) 2022 Quan Guanyu`），但 README 未说明这份 125 KB 字节流由谁生成、按什么许可随仓库分发。

"它是不是 NIST 素材"可证伪——与目录里真正的 NIST 参考序列 `data_e` 无关：

```
$ git show 08c936b:randomness/data/data_e | python3 -c "…按 8 bit 打包…"
1004882 125611 46afb8461543e8ad32cd763b283a575a      ← 位数 / 打包后字节 / md5
$ git show HEAD:randomness/data/data_e | python3 -c "…比较 e 的二进制展开…"
file first40: 1010110111111000010101000101100010100010
e=10.1010110111111000010101000101100010100010
match first 40: True
```

即 `data_e` 确为 e 的二进制展开（README 称"NIST 参考序列"成立），但 `data.bin` 与它**既非同一内容、也不能由它打包得到**（打包会得 125,611 字节）。字节分布与均匀随机一致（256 个取值、计数区间 432–550），符合 `randomness/tools/rdgen`（`crypto/rand` → `target/data/random%d.bin`，`n/8 = 125000`）的产物特征——但这只是**推断**，仓库里没有任何一处记录生成方式。

并且这个夹具是**孤儿**：无代码/测试引用，只有 README 的手工命令用它。

```
$ git grep -n 'data\.bin\|data_e' HEAD -- randomness | grep -v 'data/README.md'
randomness/linear_complexity_test.go:15:  eConstantBits = ReadGroupInASCIIFormat("data/data_e")
randomness/nist_suite_test.go:8/12:      …data/data_e…
randomness/tools/overhead_profiler/main.go:13: //  ./overhead_profiler.exe --file data.bin --block 500 …
```

- 等级：**缺陷**（提交信息写 `add NIST fixture`，README 又把"NIST 参考序列"这个身份只给 `data_e`；入库的 125 KB 随机字节没有任何可复核出处。审计里"这个数字/这份样本哪来的"将无法回答）。
- 修完要达到：`randomness/data/README.md` 为 `data.bin` 补一行来源（例如 `rdgen -s 1 -n 1000000`，注明生成日期与 `crypto/rand`）、SHA-256 与许可说明，或改名为 `rdgen-sample.bin` 一类不暗示 NIST 出处的名字；验收：README 中的哈希与 `git show <rev>:randomness/data/data.bin | sha256sum` 一致，且提交信息不再称其为 NIST 夹具。

### 5.3 缺陷：二进制刷新没有构建出处，且与仓库钉住的工具链不一致

```
$ git show 08c936b:randomness/tools/rddetector/rddetector | file -
ELF 64-bit LSB executable, x86-64, … statically linked,
Go BuildID=SAM3axW0EWeb41oqn0VD/…, BuildID[sha1]=f390ba8da4cdb2ac1973ec0a510b611a404508ec, stripped
$ git show 08c936b:randomness/tools/rddetector/rddetector | strings -a | grep -oE 'go1\.[0-9]+(\.[0-9]+)?' | sort -u
go1.27.1
$ git show 08c936b^:randomness/tools/rddetector/rddetector | strings -a | grep -oE 'go1\.[0-9]+(\.[0-9]+)?' | sort -u
go1.25.4
```

仓库钉住的工具链是另一套：

```
$ git show HEAD:randomness/go.mod
module github.com/Trisia/randomness

go 1.18
$ git show HEAD:randomness/.github/workflows/go.yml | grep -A2 matrix
        goVer: ['1.18', '1.21']
$ git show HEAD:docker/backend-gpu.Dockerfile | grep -n 'go1\.'
34:RUN wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz
```

没有任何文档、脚本或提交记录说明这份 ELF 由哪个源提交、哪套工具链产出；ELF 还是 stripped，无法从产物反推。正向核对只能确认"功能面大致对得上"：新二进制含 `NIST SP 800-22 Rev.1a` 与 `-suite` 字符串，旧二进制没有（`strings | grep -cE 'NIST SP 800-22|随机偏移检测|1\.5\.0'` → 新 3 / 旧 1），与 `e7c5a2c`（2026-10-15 加 NIST 组合）之后的时间线一致。

- 等级：**缺陷**（同一源码 + 不同工具链会产生不同字节，任何"这批检测结果出自哪份源码"的复核都无从做起；同时 go1.27.1 比 CI 矩阵与镜像钉的版本新两个大版本）。
- 修完要达到：在 `randomness/tools/rddetector/README.md` 记录构建命令、Go 版本与源提交，最好附 `sha256`；或改为发布制（构建产物不进 git）。验收：按 README 命令在钉住的 Go 版本上重建，能与入库文件的 sha256 对上（或明确声明不可复现及原因）。

### 5.4 缺陷：刷新只换了一个，`rddetector_linux` 变成过期分叉

```
$ git show 08c936b^:randomness/tools/rddetector/rddetector | md5sum
0cd164fdd938a883105934f12cddf019  -
$ git show HEAD:randomness/tools/rddetector/rddetector_linux | md5sum
0cd164fdd938a883105934f12cddf019  -          ← 改前两者逐字节相同
$ git show HEAD:randomness/tools/rddetector/rddetector | md5sum
e3f992fe89d5107d30e0498e13849666  -          ← 改后只剩新的一份
$ git ls-tree -r -l HEAD -- randomness/tools/rddetector | awk '$4+0>100000'
100755 … 2162848 … rddetector
100755 … 2056376 … rddetector_linux
```

刷新前 `rddetector` 与 `rddetector_linux` 是同一份文件的两个拷贝；刷新后仓库里同时存在 2.16 MB 的新版与 2.06 MB 的旧版，后者仍是 2056376 字节、任何人看不出它对应哪一代源码。加上 `randomness/rddetector_objdump.txt`（831,357 字节，实测是对 **Windows PE** `tools\rddetector\rddetector.exe` 的 objdump，且不含 `1.5.0` 字符串 → 早已过期），`randomness/` 下入库的不可复核二进制共约 4.0 MB ELF + 0.83 MB 文本转储。仓库没有 `.gitattributes`（`git show HEAD:.gitattributes` → 不存在），也没有 LFS。

- 等级：**缺陷**（同一工具两份不一致的二进制 + 一份指向不存在 `.exe` 的反汇编；正是"2.1 MB 既有问题"的扩大版）。
- 修完要达到：`rddetector_linux` 与 `rddetector_objdump.txt` 二选一处理（删掉，或与新二进制同批重建并在 README 标明各自对应的源码提交/平台）；验收：`git ls-tree -r -l HEAD:randomness | awk '$4>100000'` 里每个非数据文件都能在 README 找到"它是什么、对应哪次构建"。

### 5.5 通过项：夹具 README 的命令与 NIST 项数可核对

`randomness/data/README.md` 的示例命令与 CLI 实现一致，不是空写：`randomness/tools/rddetector/main.go` 里 `-n` 是**工作线程数**、按 `.bin`/`.dat` 后缀遍历输入目录、`nist` 组合强制要求 `sbit == 1e6`；`data.bin` 125,000 × 8 = 1,000,000 bit，正好落在唯一允许的规模上。"15 项检测"也可核：`randomness/nist_suite.go` 的 `TestMethodArrNIST` 有 15 个条目，`nist_suite_test.go:44` 断言 `len == 15`。

---

## 一句话结论

五笔里**数字类全对、参数化缺省无回归、搬移后无旧路径死链**，但运维面有三处必须补：`08c936b` 把一份无出处无哈希的 125 KB 随机字节当作"NIST 夹具"入库、并用未记录工具链（go1.27.1）的 ELF 替换二进制留下过期的 `rddetector_linux`；`502ed90` 搬进 `docs/audits/` 的 12 份审计文档因前端无 `audits` 分类分支而在文档中心消失，且提交信息宣称删除的 `backend/docs` 并不在该提交的 diff 里；`ced4568` 注释推荐的 `CUDA_ARCH="35;50;60"` 会让 `des_search.cu` 的 `nvcc -gencode` 一步构建必挂，而新旋钮也没进 `.env.example`。
