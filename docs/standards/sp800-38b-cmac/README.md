# NIST SP 800-38B — CMAC 认证模式

标准原文提取参考：[00-Standard-Source.md](./00-Standard-Source.md)。

来源: NIST SP 800-38B — Recommendation for Block Cipher Modes: CMAC Mode for Authentication
      PDF: [NIST.SP.800-38B.pdf](./NIST.SP.800-38B.pdf)

## 关键算法

- **AES-CMAC**: 基于 AES 的消息认证码，用于数据完整性验证
- 可与任何 NIST 批准的分组密码配合使用

## 文档文件

- `01-CMAC.md` — CMAC 算法参考
- `NIST.SP.800-38B.pdf` — 标准原文

## 实现状态

✅ 已实现：`cmac_mac`（CIPHER 下拉：AES-128 / SM4）、独立的 `cmac_subkeys`（`K1‖K2`）与单步 `cmac_double`（GF(2¹²⁸) 加倍）。AES-128 分支以 RFC 4493 与 SP 800-38B 共有的 AES-CMAC 示例值做双语言回归，`cmac_subkeys` 另由 Demo 的 `CMAC_SUBKEYS` 过程与单测双向核对；SM4 分支目前只有密钥长度等契约检查，没有官方向量，仓库内无 pycryptodome 依赖或第三方交叉验证。

> 版本注：NIST 2025-01 提案修订 SP 800-38B（去除 3DES 依赖）；现行版仍为 2005。

## 函数/原语索引

- [01-CMAC.md](./01-CMAC.md)：CMAC 总览
- [02-Subkeys.md](./02-Subkeys.md)：`K1/K2` 子密钥
- [03-MAC.md](./03-MAC.md)：CBC-MAC 与标签输出

<!-- standard-body:start -->

## 标准内容

本目录对应 **NIST SP 800-38B — CMAC 认证模式**，按标准条款拆分为 3 个结构化条目，覆盖 「NIST SP 800-38B — CMAC 参考」、「CMAC — 子密钥生成原语」、「CMAC — CBC-MAC 与标签输出原语」。每个条目页给出标准定位、原文出处、公式或伪代码，以及对应积木块与验证边界。

| 结构化条目 | 内容 | 项目状态 |
|---|---|---|
| [NIST SP 800-38B — CMAC 参考](./01-CMAC.md) | NIST SP 800-38B — CMAC 参考 | 已实现（不代表完整标准覆盖） |
| [CMAC — 子密钥生成原语](./02-Subkeys.md) | CMAC — 子密钥生成原语 | 已映射为 `cmac_subkeys` / `cmac_double`（不代表完整标准覆盖） |
| [CMAC — CBC-MAC 与标签输出原语](./03-MAC.md) | CMAC — CBC-MAC 与标签输出原语 | 已映射为 `cmac_mac`（AES-128 与 SM4 路径；不代表完整标准覆盖） |

## 实现与验证映射

| 积木块 | 规范语义范围 | 已登记验证入口 | 边界（本行不能证明什么） |
|---|---|---|---|
| `cmac_double` | SP 800-38B §6.1 子密钥加倍 | `cmac-xts-primitives-contract.test.ts` 双语言执行 RFC 4493 §4 的 L→K1→K2 | 单次加倍链；不覆盖其它密钥或 SM4 分支 |
| `cmac_subkeys` | SP 800-38B §6.1 子密钥生成（AES-128） | `cmac-xts-primitives-contract.test.ts` 双语言复现 RFC 4493 §4 的 K1‖K2；`demos/procedures/CMAC-AES.json` 的 `CMAC_SUBKEYS` 过程由 `verify:demos` 双语言执行同一 K1‖K2 | 仅 AES-128；SM4-CMAC 子密钥不在本块范围 |
| `cmac_mac`(CIPHER 下拉：AES-128 / SM4) | SP 800-38B §6.2 CMAC 生成（子密钥 + CBC-MAC + 末块 K1/K2 选择） | `demos/procedures/CMAC-AES.json` 在 `verify:demos` 中双语言执行 RFC 4493 §4 的 0/16/40/64 字节四条向量；`cmac-block-contract.test.ts` 直接驱动块核对同组向量与 15/17 字节密钥拒绝 | 仅 AES-128 这四条向量与密钥长度；不覆盖截断标签（Tlen<b）、SM4 的 GB/T 专用向量或完整 SP 800-38B 测试集 |

示例工作区：[`demos/procedures/CMAC-AES.json`](../../../demos/procedures/CMAC-AES.json)；搭建指南：[对称密码与工作模式 § CMAC-AES](../../build/symmetric.md#cmac-aes)；Procedure 模板仍无。

以上是当前实现与回归范围，不代表已通过认证或完成完整标准测试；逐块证据与缺项见[标准符合性对象清单](../CONFORMANCE-INVENTORY.md)。

<!-- standard-body:end -->
