# 对抗层登记处 — 2026-11-19

门禁：`gated-review` 对抗层（A 证伪 → B 逐字复核 → 主线程复现四分流）。
状态取值：草案 / 已派 A / 已过 B / 裁决完成。一行一个对象，只追加不覆盖。

生成者（起草方）：lead（本会话）。按隔离规则，lead 不得担任 A 或 B。

## 对象

| 对象 | 状态 | 冻结指纹（整笔 patch 的 md5） | 起草者缺口清单 |
|---|---|---|---|
| CipherCat `7b57abd`（D 线生成式选句，18 文件） | 草案 | `713a203ad8b0f68e5c6909f3a5363e3b` | 未做真机模型调用（无用户 key 可用），provider 路径只由 mock 与单测覆盖；未做浏览器交互实测 |
| CipherCat `1272230`（文档同步白名单，1 文件） | 草案 | `0022112269d7ad015ed37ccc5fe3bd2d` | 仅 `bash -n` + 实跑一次；未覆盖「源文件缺失」「目标仓库无 guides/ 目录」等异常分支 |
| metacrypt `bd0b09f`（locale 镜像，1 文件） | 草案 | `eb430e2f8c7b5f3f6981587f16f9b776` | 镜像来的 57 个键在目标仓无可执行消费者（D 线面板未移植）；未验证运行时渲染 |
| metacrypt `917f16e`（文档拉齐，25 文件） | 草案 | `d7d1473b2c05b98d1fde12e064fd3b63` | 已知 METACRYPT-SYNC.md 的结构数字可能已随目标仓演进过期；页面引用 CipherCat 侧路径在目标仓不可达；metacrypt 无 docs:check-links / standards:check 等同名门禁，只能用自写解析核对 |
| metacrypt `d7a02ea`（文档中心拆分，5 文件） | 草案 | `91c321e65403d291b955ce5f038942cd` | 只跑 type-check / eslint / build:prod / 单测（112 文件 978 用例）+ 用真实 docs 清单跑 `buildDocCategories`；未做浏览器实测，未验证 CSS 拆分后的视觉回归 |
| 分支其余 47 笔（MCLProver / blockly sync） | 未纳入本轮对抗 | —（不在本轮对象内） | 只做过结构性扫描（密钥、冲突标记、二进制），未逐行复核 |

状态推进：2026-11-19 08:52，五个对象全部 → **裁决完成**（四分流见 `VERDICT.md`）。

## 逐文件指纹

见同目录 `OBJECTS.md5.txt`（每个文件取其**提交内 blob** 的 md5，不受工作区并发改动影响）。

## reviewer 派单

- **A（证伪者，只读）**：`reviewer-a`，五面全覆盖（编造裁定 / 锚点逐条核 / 数字复算 / 权威冲突 / 声称强度），对象 = 上表 5 笔；报告 `A-report.md`（22246 B）。
  首行回执：五笔 patch md5 全部 match。
- **B（复核者，只读）**：第一席 `reviewer-b` 无产出即失败（未落盘任何文件），按「两轮上限」重派 `reviewer-b2`，收窄到 A 的 10 条关键结论；报告 `B-report.md`（16090 B）。
  首行回执：`B-SEAT checks=10 holds=7 partially=3 does_not_hold=0`。
- **隔离**：lead 为生成者，未担任 A/B；A 与 B 为不同 agent、不同运行。

## 结算

见 `VERDICT.md`（主线程逐条复现后四分流）。摘要：

- 对象指纹结算：5 笔 patch md5 与派单时**逐一相同**；`OBJECTS.md5.txt` md5 `d60956e1…` 未变 → 审查期间无并发改动。
- 裁决条数 **18**（A 20 条去重 + 主线程 6 条去重后合并）：真缺陷 **9**（D1–D9，其中 D7/D9 为既有）、算错 **2**（E1、E2）、编造 **0**、无法判定 **3**（U1–U3）、观察 **8**（O1–O8）。
- **编造率 = 0 / 18 = 0%**；reviewer 过强率 = 2 / 18 ≈ 11%（E1、E2 已按实测更正）。
- 门禁：metacrypt 文档中心 + 语言包 `vitest` rc=0（4 文件 / 29 用例）；CipherCat D 线 `vitest` rc=0（4 文件 / 43 用例）；自建链接解析 917f16e = 185 链接 / 28 不可解析（917f16e^ 同为 28）。
- 本轮未修改任何被审文件（只审不改）；修复清单见 `VERDICT.md` §4。

## 结算后补查（2026-11-19 09:05）

- **U1 结案**：主线程扫 `.agents/memory/session-logs` 下 mtime ≥ 2026-11-12 的 **209 份 `session.jsonl`**（覆盖 ai-helper 全线窗口 2026-11-13 起），事件类型限定 `user/message` 与 `ask_user_question` 应答，关键词 `费用`/`单价` → **真实命中 0 条**（唯 2 处命中是 subagent 完成通知在转述 A 报告）。结论从「无法判定」改为「**无用户侧记录**」：`RESULTS.md` §67.7 的「owner 已裁决不做」目前只有助手自述支撑。
- 补查只写本目录两个文件（`VERDICT.md`、本文件），未触碰任何被审对象；`OBJECTS.md5.txt` 仍为 `d60956e1…`。

## 修复执行（2026-11-19 09:2x，owner 选「按修复清单改（P1+P2）」）

| 项 | 位置 | 改法 | 复核 |
|---|---|---|---|
| P1 / D1 | `docs/guides/METACRYPT-SYNC.md:7,16,17` 与 `.en.md` 同位 | 491→498、487→486、7 模块+5 CSS（12）→9 模块+6 CSS（15）、`src/components/editor/*` 9→22（12 Vue + 8 TS + 2 CSS） | `wc -l` 486/498、`ls`/`git ls-tree` 22/15；两份 md5 与 metacrypt 镜像逐一相同 |
| P1 / D2 | `experiments/ai-helper-2026-11-14/RESULTS.md:4806` | 「8 组」→「7 组」 | `grep -c "  it(" tests/unit/ai-helper-model-notes.test.ts` = 7；同节 `:4821` 自写「+1 文件 7 条」 |
| P2 / D5 | 同上 `:4812` | 「§66.6」→「§66.7」 | 工作区 `:4740` 的 §66.7 标题即「一个真实约束：入口 chunk 只剩 13 字节」；`:4732` 的 §66.6 是「没做的」 |
| P2 / D6 | 同上 `:4840` | 删去无记录支撑的「owner 已裁决不做」，改为「仍未做，§3.4 待办继续挂着（原写…查无记录，2026-11-19 更正）」 | 依 U1 结案；`PARALLEL-EXECUTION.md` 未动（其 §3.4 本就要求该 UI 项） |
| P2 / D8 | `docs/standards/CONFORMANCE-INVENTORY.md:39`（两仓同句） | 「不再使用单一数字」→「三类分述 + 类目表保留 5 个的合计，明细与合计并存」 | README.zh-CN.md:123 / README.md:126 实测仍保留单一数字 5，且计数注已写三类分述 |
| 未做 | D9 `randomness/tools/rddetector/rddetector`（2.1 MB） | 出库需 owner 同意 | 保持原状 |
| 未做 | D7 28 条相对链接 | 改动面广（`/demos/` 为 gitignore 部署副本），留待文档轮次 | 保持原状 |
| 不修 | D3/D4 三笔 commit message | 已推送，不重写历史 | 已在 VERDICT §4 注明 |

门禁（改完实跑，CipherCat）：`standards:check` entries=40 errors=0；`standards:inventory` OK；`docs:titles:check` 439；`docs:check-links` files=445 broken=0；`docs:mermaid:check` failed=0。
**`docs:index:check` 为既有红灯**：语料 439 篇摘要 5fa2d369…（把本轮三份文档临时回退到 HEAD 后仍是此值）≠ 索引 01709194689d5c17 → 与本轮改动无关，属其他线未提交的 docs 改动，未代为重建索引。


