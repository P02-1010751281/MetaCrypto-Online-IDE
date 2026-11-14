# NIST SP 800-38C — CCM 认证加密模式

标准原文提取参考：[00-Standard-Source.md](./00-Standard-Source.md)。

来源: NIST SP 800-38C — Recommendation for Block Cipher Modes: CCM Mode for Authentication and Confidentiality
      PDF: [NIST.SP.800-38C.pdf](./NIST.SP.800-38C.pdf)

## 关键算法

- **AES-CCM**: CTR 加密 + CBC-MAC 认证的组合模式
- 提供机密性和认证性的 AEAD 方案

## 文档文件

- `01-CCM.md` — CCM 算法参考
- `NIST.SP.800-38C.pdf` — 标准原文

## 实现状态

✅ 已实现：`ccm_encrypt`（§6.1）与 `ccm_decrypt`（§6.2，标签不符即抛错）。加密路径回归 SP 800-38C 附录 C Example 1-3 官方向量（tagLen 4/6/8）并由独立实现复算；解密路径回归 Example 1/2 的明文恢复与三类拒绝（篡改标签、篡改 AAD、Clen ≤ Tlen）。Demo：`demos/procedures/CCM-Encrypt.json`。

## 函数/原语索引

- [01-CCM.md](./01-CCM.md)：CCM 总览
- [02-Formatting.md](./02-Formatting.md)：B0、AAD 与计数器编码
- [03-CBC-MAC.md](./03-CBC-MAC.md)：认证链
- [04-CTR.md](./04-CTR.md)：CTR 加密与标签掩码

<!-- standard-body:start -->

## 标准内容

本目录对应 **NIST SP 800-38C — CCM 认证加密模式**，按标准条款拆分为 4 个结构化条目，覆盖 「NIST SP 800-38C — CCM 参考」、「NIST SP 800-38C §6.1–§6.2」、「NIST SP 800-38C §6.3」、「CCM — CTR 加密原语」。每个条目页给出标准定位、原文出处、公式或伪代码，以及对应积木块与验证边界。

| 结构化条目 | 内容 | 项目状态 |
|---|---|---|
| [NIST SP 800-38C — CCM 参考](./01-CCM.md) | NIST SP 800-38C — CCM 参考 | 部分实现：生成-加密与解密-验证两条路径均已映射为原子块，未覆盖全部参数组合（不代表完整标准覆盖） |
| [CCM — B0、AAD 与计数器编码原语](./02-Formatting.md) | NIST SP 800-38C §6.1–§6.2 | 已映射为 `ccm_b0` / `ccm_aad_len_prefix` / `ccm_counter_block`（不代表完整标准覆盖） |
| [CCM — CBC-MAC 认证原语](./03-CBC-MAC.md) | NIST SP 800-38C §6.3 | 已映射为 `ccm_cbc_mac`；标签掩码与端点组装仍由 `ccm_encrypt` 完成 |
| [CCM — CTR 加密原语](./04-CTR.md) | CCM — CTR 加密原语 | 已映射为 `ccm_ctr`（只输出密文段；标签掩码在 `ccm_encrypt` 内） |

## 实现与验证映射

| 积木块 | 规范语义范围 | 已登记验证入口 | 边界（本行不能证明什么） |
|---|---|---|---|
| `ccm_b0` | SP 800-38C §A.2 首块 B0 | `ccm-primitives-contract.test.ts` 双语言核对附录 C.1 公布的 B 首块 `4f101112 13141516 00000000 00000004` | 一个参数组合；不覆盖 AAD 长度编码分支（≥0xFF00）或其它 Tlen/Nlen |
| `ccm_counter_block` | SP 800-38C §A.3 计数器块 A_i | `ccm-primitives-contract.test.ts` 双语言核对 C.1 公布的 Ctr0 `07101112 13141516 00000000 00000000` 与 Ctr1 末位加一 | 两个计数器值；不覆盖计数器回绕或超长数据单元 |
| `ccm_aad_len_prefix` | SP 800-38C §A.2.2 AAD 长度编码 | `rsa-ccm-encoding-primitives.test.ts` 双语言核对 0/8/0xFEFF/0xFF00/0x01020304 五个边界与超界拒绝 | 只覆盖该编码函数；不覆盖 CCM 全流程或其它 Tlen/Nlen |
| `ccm_cbc_mac` | SP 800-38C §A.2 CBC-MAC | `ccm-primitives-contract.test.ts` 双语言一致性与 16 字节输出；同一工作区的 `CCM_CBC_MAC` 过程按附录 C.1 参数核对该链中间值 `6084341b…`（其加 `S0` 后的标签 `4dac255d` 与附录公布的 C‖T 一致） | 标准未公布 CBC-MAC 中间值，本行不能替代 CCM 端点官方向量或完整符合性 |
| `ccm_ctr` | SP 800-38C §A.3 计数器模式 | `ccm-primitives-contract.test.ts` 双语言复现 C.1 公布密文段 `7162015b`；`CCM_CTR` 过程执行同一路径 | 单块明文、单一 Tlen/Nlen；不覆盖多块或部分块 |
| `ccm_encrypt` | SP 800-38C CCM（CBC-MAC + CTR），AES-128 | `procedures/CCM-Encrypt.json` 回归附录 C Example 1/2/3（tagLen 4/6/8），并由 `demo-vector-crosscheck.test.ts` 独立复算一致；输出容器由 `symmetric-bytes-output-contract.test.ts` 核对 | 只覆盖 Example 1-3 的参数组合；不覆盖全部 nonce/tag 长度组合 |
| `ccm_decrypt` | SP 800-38C §6.2 decryption-verification | `ccm-decrypt-contract.test.ts` 双语言执行附录 C.1 Example 1 与 C.2 Example 2 的明文恢复，并验证篡改标签/篡改 AAD/Clen ≤ Tlen 三类拒绝；`CCM_Decrypt` 过程在 Demo 中回归同一路径 | 只覆盖两个附录示例与列明的拒绝；抛出错误只保证调用方拿不到明文，不构成常量时间或认证安全证明 |

示例工作区：`demos/procedures/CCM-Encrypt.json`（另含 `CCM_B0` / `CCM_AAD_PREFIX` / `CCM_COUNTER_BLOCK` / `CCM_CBC_MAC` / `CCM_CTR` / `CCM_Decrypt` 六个过程）；搭建指南：[对称密码与工作模式 § CCM-Encrypt](../../build/symmetric.md#ccm-encrypt)。

以上是当前实现与回归范围，不代表已通过认证或完成完整标准测试；逐块证据与缺项见[标准符合性对象清单](../CONFORMANCE-INVENTORY.md)。

<!-- standard-body:end -->
