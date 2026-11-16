# 发表版基线能力核对：测评与爆破是否已存在

核对日期：2026-11-16
问题来源：核对时曾把 **metacrypt_server**（密码算法安全评估云平台）的测评/爆破栈误当成 **CipherCat**（更新稿所指仓库）的增量。发表版事实核对仍然有效，但归属已更正：测评栈属于 metacrypt_server，CipherCat 仓库内不存在这些代码（见文末「归属更正」）。

## 核对对象

| 对象 | 定位 |
|---|---|
| 发表版论文 | `paper/_archive/1-s2.0-S2352711026004346-main.pdf`（SoftwareX 35 (2026) 102943, doi:10.1016/j.softx.2026.102943） |
| 发表版源码 | `ltyofficial/MetaCrypt_Online_IDE` tag `v1.1.0`（2026-11-16 浅克隆，477 文件 / 7.9M） |
| 对照对象 | `metacrypt_server` 当前 `backend/owl_admin/`（未提交 WIP） |

## 方法

```bash
pdftotext -layout paper/_archive/1-s2.0-S2352711026004346-main.pdf /tmp/pub-meta.txt
git clone --depth 1 --branch v1.1.0 https://github.com/ltyofficial/MetaCrypt_Online_IDE.git /tmp/pub-v110
# 全文/全树关键词计数（逐条可复跑）
grep -oic "<kw>" /tmp/pub-meta.txt
grep -rn "<kw>" --include=*.py --include=*.js --include=*.vue /tmp/pub-v110
```

## 论文明文：0 命中

发表版论文全文（55,109 字符 / 489 行）中，下列词全部 **0 次**：

`differential`、`brute`、`brute-force`、`MITM`、`meet-in-the-middle`、`randomness`、`randomness test`、`sbox`、`GPU`、`CUDA`、`Celery`、`weak param`、`attack`

非零项均为无关语境，逐条核过：

| 词 | 次数 | 实际语境 |
|---|---|---|
| `assessment` | 2 | 一处是「MCL DSL 的定性评估」，一处是参考文献 [21] 的 DSL 定性评估框架标题 |
| `S-box` | 2 | 只作为可配置积木构件（"Configurable S-box, S-box substitution"），非分析对象 |
| `linear` | 2 | "bit-identical to reference implementations" 与积木功能表 |
| `cryptanalys` | 1 | 参考文献 [16] CrypTool 2 的标题 |
| `evaluat` | 3 | 论后续工作的评价性表述 |

## 源码实测：一条「只有壳、没有实现」的线

发表版 **确实有随机性测试的前端与调度设施**，但没有检验实现。逐项：

| 存在什么 | 文件 | 内容 |
|---|---|---|
| 前端 API 适配层 | `RuoYi-Vue3/src/api/blockly/randomness.js` | 6 个函数，打 `/blockly/randomness/{start,status,progress,result,tasks,delete}` |
| 前端任务界面 | `RuoYi-Vue3/src/views/blockly/TasksView.vue`（1410 行） | 「随机性测试任务」tab 完整；另有「密码算法自动化分析」tab **只有按钮、没有内容块**（`v-if="selectedTab === 'analysis'"` 不存在） |
| 数据库表 | `migrations/add_distributed_columns.sql` | `ALTER TABLE sys_randomness_task` 加 `target_queue` / `worker_node` 列 |
| 队列路由 | `owl_admin/utils/task_routing.py` | `route_randomness_task(n_bits, m_seq)` |
| Celery | `owl_admin/celery_app.py`、`celery_config.py`、`owl_admin/tasks/` | 自动发现 `owl_admin.tasks`；实际任务只有 `detect_orphan_tasks`、`cleanup_old_temp_files` |

| 缺什么 | 证据 |
|---|---|
| 后端路由 | `owl_admin/controller/blockly/__init__.py` 只有 `from . import project`；全树 `/blockly/` 装饰器只有 5 条 `project/*` |
| 检验实现 | NIST SP 800-22 各检验名（monobit / frequency / runs / longest run / serial / poker / spectral / DFT / approximate entropy / cumulative sums / random excursions / rank / universal / linear complexity）与 `fips 140` 全树 **0 命中** |
| 密码计算 | `def des_` / `def aes_` / `def sha256` / `sbox` / `SBOX` / `differential` / `brute` / `mitm` 全树 **0 命中** |
| 分析路由 | 「密码算法自动化分析」tab 无对应 API 文件、无后端路由 → 死 tab |

结论：发表版的随机性测试是**前端壳 + 表结构 + 队列路由**，检验引擎与端点都不在发布仓库里；密码算法自动化分析只有一个点不动的按钮。差分/线性、S 盒指标、爆破（DES/哈希/2DES-MITM）、GPU 路径、弱参数——发表版完全没有。

## 归属更正（2026-11-16 当日修订）

本节原先把测评/爆破栈写成「更新稿的最大增量」，这是错的。两个仓库的边界：

| 仓库 | 身份 | 关键事实 |
|---|---|---|
| `P02-1010751281/CipherCat` | 独立继任分发：Blockly 积木核 + 浏览器编辑器 | 无 backend/server 目录，无 Flask/MySQL/Redis，项目存 IndexedDB；444 个 src 文件；**无**测评、爆破、协作、命令面板实现 |
| `gitee:bestivictory/metacrypt_server` | Metacrypto 密码算法安全评估云平台 | 4236 个后端 py、769 个前端 vue/ts；随机性（Go GM/T 0005）、S 盒指标、差分/线性、爆破、GPU、Celery 都在这里 |

因此：

1. 测评/爆破栈**不能**写进 SoftwareX 更新稿的增量——该稿 C2 指向 CipherCat 仓库，仓库里没有这些代码，写进去就是声称代码不存在的能力。
2. 测评栈是 metacrypt_server 相对发表版的增量，与 CipherCat 的更新叙事是两条线。
3. 发表版源码的事实核对结论不变：随机性测试只有前端壳 + 表结构 + 队列路由，检验引擎与端点不在发布仓库内；「密码算法自动化分析」是死 tab。

## 对更新稿的影响（更正后）

1. 更新稿的增量仍是「积木核独立分发 + PQC 原语 + 标准追溯」，**不含**测评/爆破。
2. 若要把测评栈纳入某份稿件，载体必须是 metacrypt_server 那一侧，且需要另做归属与证据链。
3. 「密码算法自动化分析」死 tab 是可核验事实，但不构成发表版的承诺，不能当论据。


## 附：UI 面板对照（命题已更正）

原命题「metacrypt 的 IDE 界面功能是否已回到 CipherCat」方向搞反了：命令面板、证据面板、协作三面板是 metacrypt_server **宿主**的界面，CipherCat 是被嵌进宿主的那块核。不存在「搬回」，只存在「宿主提供 / 核不提供」。

以下对照只作为事实表保留。

CipherCat 的 locale 权威源里**有** `commandPalette`、`panelMembers`、`panelComments`、`panelRevisions` 等键（`src/composables/locale/ui-messages.ts:138,157-159`），但 CipherCat 组件内 `ui()` 消费数为 **0**——这些键是给镜像到 metacrypt 的宿主面板用的文案，不代表 CipherCat 有对应界面。

| 能力 | metacrypt | CipherCat |
|---|---|---|
| 命令面板 | `plugins/ui/builtin/CommandPaletteContribution.vue` | **无**（`CommandPalette` 0 命中） |
| 证据面板 | `EditorSidebar` 的 `evidence` 面板 + `features/spec-review/components/SpecEvidencePanel.vue` | **无**（`EvidencePanel` 0 命中） |
| 协作三面板 | `MembersPanel` / `CommentsPanel` / `RevisionHistoryPanel` | **无**（均 0 命中） |
| activity bar 互斥切换 | `BuiltinActivityBar.vue` + `activeSidePanel` | **有**（`editor/useEditorPanels.ts`，5 个面板互斥） |
| 侧栏文件浏览器 / 面板头 chrome | `views/editor/editor-panel-chrome.css` 等 | **有**（`2026-11-16-editor-chrome-i18n` 等轮次已镜像样式与键） |

面板集合：CipherCat = `projects / files / functions / docSearch / blockSearch`（5）；metacrypt = 上述 5 个 + `evidence / members / comments / revisions`（9）。

判断：**UI 功能没有回灌**。回灌的是「壳层」——activity bar 模型、面板头样式与双语文案；metacrypt 独有面板背后依赖 `host.services.members/comments/versions` 这类后端服务，而 CipherCat 是纯前端 IndexedDB，直接搬会得到空数据。逐项移植前必须先定数据源映射。

CipherCat 侧零测评界面：`src/` 下 `randomness` / `assessment` 的命中全部是 SLH-DSA 的 `slh_msg_randomness` 积木与 GB/T 32915、GM/T 0005 标准文档目录，与测评功能无关。
