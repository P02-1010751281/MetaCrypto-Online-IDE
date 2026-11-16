# 来源与世系说明（PROVENANCE）

本文件说明 CipherCat 与已发表软件 **MetaCrypto Online** 的关系，供审稿、引用与合规核对使用。

## 1. 对应关系

| 项 | 值 |
|---|---|
| 软件名（本版本） | MetaCrypto Online IDE |
| 发表时题名 | *MetaCrypto online: A model-driven visual development platform for cryptographic engineering* |
| 发表出处 | *SoftwareX*, vol. 35, 102943, 2026 — <https://doi.org/10.1016/j.softx.2026.102943> |
| 本仓库 | `P02-1010751281/CipherCat` |
| 本版本 | v2.0.0，对应 tag `v2.0.0` |

## 2. 世系

- 本仓库具有**独立的根提交历史**，不是上述论文代码仓库的 GitHub fork，也不包含其代码副本。
- 本仓库提供该软件 **v2.0.0 更新**的积木核心、两套代码生成器（Python / JavaScript）与独立编辑器形态（Web 构建 + 可选 Tauri 桌面封装）。
- 发表版的服务端组件（Flask 后端、MySQL、Redis）**不在本仓库**；本版本打开既有构造无需该后端。
- 配套的全栈平台（含评估服务）位于另一仓库 `metacrypt_server`，通过 `scripts/sync-to-metacrypt.sh` 从本仓库单向接收积木核心与两套生成器；平台侧不修改该核心。
- 完整的世系裁定与备选方案讨论见 `paper/softwarex-update-2026-10/REPOSITORY-LINEAGE-DECISION.md`（该目录受 `.gitignore` 约束，需 `git add -f` 才能入库）。

## 3. 团队与权利

- 本仓库维护者与发表版作者团队为**同一团队**（2026-11-16 确认）。
- 作者列表、单位、通讯作者与支持邮箱以投稿时作者团队提供的元信息为准；本文件不代为声明。
- 许可证：GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later），与发表版 C3 一致。

## 4. 可复现性

- 论文与文档中的全部结构数字均在该 tag 指向上实跑取得，复跑命令见
  `.codestable/audits/2026-11-16-v2.0.0-freeze/README.md`。
- 导出核对：`git archive v2.0.0 | tar -x -C /tmp/v200 && cd /tmp/v200 && npm ci && npm run verify:all`。
