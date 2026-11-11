# 审计报告

本目录收纳项目的审计与核验报告。审计报告记录「查过什么、结论是什么、哪些还没查」，与标准条目正文分开存放；审计结论不构成认证、形式化验证或安全证明。

按来源分子目录：

| 子目录 | 内容 |
|---|---|
| [standards/](./standards/) | 标准文档审计：原文提取、条目拆分、质量复核与重提取核验 |
| [project/](./project/) | 项目审计：密码原语与教学表面的整体核对 |

## 标准文档审计

| 报告 | 回答什么问题 |
|---|---|
| [SOURCE-LAYERS.md](./standards/SOURCE-LAYERS.md) | 标准原文提取层与结构化参照层如何分工 |
| [SOURCE-QUALITY-AUDIT.md](./standards/SOURCE-QUALITY-AUDIT.md) | 原文提取质量复核，哪里可信、哪里有缺口 |
| [SOURCE-SPLIT-COVERAGE.md](./standards/SOURCE-SPLIT-COVERAGE.md) | 原文到结构化条目的拆分覆盖率 |
| [SOURCE-SPLIT-INVENTORY.md](./standards/SOURCE-SPLIT-INVENTORY.md) | 原文到结构化条目的逐条清单（由 `npm run standards:inventory:write` 生成） |
| [REEXTRACTION-REPORT.md](./standards/REEXTRACTION-REPORT.md) | 重新提取与核验的结论汇总 |

> `SOURCE-SPLIT-INVENTORY.md` 是生成物，不要手改；改任何标准页的 `原文位置` 或 `项目状态` 后须重跑 `npm run standards:inventory:write`。

## 项目审计

| 报告 | 回答什么问题 |
|---|---|
| [AUDIT-REPORT.md](./project/AUDIT-REPORT.md) | 自定义块类型、函数模板与教学表面的整体核对 |

## 阅读边界

- 审计报告描述的是**某个核对日期**的状态，不是当前状态的实时保证；引用具体数字前先跑对应门禁重算。
- 检查通过只说明工程回归与选定输入下的行为，不代表 CAVP/ACVTS、CMVP/FIPS 140-3、constant-time、侧信道安全或形式化验证。
- 标准条款的最终解释以发布机构原文为准，见[标准覆盖矩阵](../standards/COVERAGE.md)。
