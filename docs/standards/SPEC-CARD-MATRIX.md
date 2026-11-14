# 规格卡对照表：卡片条目、声明积木与执行它的 Demo

> 本文件由 `npm run spec:matrix:write` 生成，**不要手工编辑**。`npm run spec:matrix`（已并入 `npm run verify:all`）会重新生成并与磁盘逐字节比对，手工改动会直接让门禁变红。

## 口径

这张表只做**确定性连接**，不做任何判定：

- **声明积木**取自卡片自身的 `entries[].blocks.existing`，不是从代码反推的；
- **工作区覆盖**是把 `demos/tests.json` 登记的 60 个工作区 JSON 逐块递归后，按「该 Demo 是否同时包含条目声明的全部积木」判定的；
- **专用过程**指 Demo 里存在与某个声明积木同名（忽略大小写与分隔符）的 `procedures_def*` 过程，即该块有独立的执行入口；
- **冻结运行清单**指 `spec-runs/<run-id>/manifest.json` 的 `outputs` 里包含该卡片路径的运行；
- **积木是否存在**以 [`BLOCK-IO-CONTRACT.json`](../blocks/BLOCK-IO-CONTRACT.json) 为准，它本身由真实块定义生成并由 `verify:all` 逐字节校验。

因此本表**不能**证明：条目实现与标准原文语义一致、Demo 的期望值来自官方测试集、或条目已被具名密码学审阅者签核。这三件事分别归 `spec:validate`、`demos/evidence.json` 与 `provenance.review`。

## 1. 卡片台账

| 卡片 | 标准 | 锚点（A/总） | 条目 | 标准制品 | 审阅状态 | 冻结运行清单 |
|---|---|---:|---:|---:|---|---|
| `sp800-38b-cmac` | NIST SP 800-38B | 2/2 | 2 | 1 | draft | `2026-11-13-anchor-pages`、`2026-11-13-cmac-extract` |
| `sp800-38c-ccm` | NIST SP 800-38C | 7/7 | 7 | 1 | draft | `2026-11-13-anchor-pages`、`2026-11-13-ccm-decrypt`、`2026-11-13-ccm-xts-extract` |
| `sp800-38e-xts` | NIST SP 800-38E | 3/3 | 2 | 1 | draft | `2026-11-13-anchor-pages`、`2026-11-13-ccm-xts-extract` |

## 2. 条目 → 声明积木 → 执行证据

| 卡片 | 条目 | 类型 | 粒度 | 声明积木 | 工作区覆盖 | 执行过程 | 向量 |
|---|---|---|---|---|---|---|---|
| `sp800-38b-cmac` | `sp800-38b.cmac.subkey-generation` | 原语 | L1 | `cmac_subkeys`<br>`cmac_double` | 无 | `CMAC_SUBKEYS`@`CMAC-AES.json` | wired |
| `sp800-38b-cmac` | `sp800-38b.cmac.mac-generation` | 函数 | L2 | `cmac_mac`<br>`cmac_subkeys` | `CMAC-AES.json` | `CMAC_AES`@`CMAC-AES.json`<br>`CMAC_SUBKEYS`@`CMAC-AES.json` | wired |
| `sp800-38c-ccm` | `ccm-format-b0` | 原语 | L1 | `ccm_b0` | `CCM-Encrypt.json` | `CCM_B0`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-aad-len-prefix` | 原语 | L1 | `ccm_aad_len_prefix` | `CCM-Encrypt.json` | `CCM_AAD_PREFIX`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-counter-block` | 原语 | L1 | `ccm_counter_block` | `CCM-Encrypt.json` | `CCM_COUNTER_BLOCK`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-cbc-mac` | 函数 | L2 | `ccm_cbc_mac`<br>`ccm_b0`<br>`ccm_aad_len_prefix` | `CCM-Encrypt.json` | `CCM_B0`@`CCM-Encrypt.json`<br>`CCM_AAD_PREFIX`@`CCM-Encrypt.json`<br>`CCM_CBC_MAC`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-ctr` | 函数 | L2 | `ccm_ctr`<br>`ccm_counter_block` | `CCM-Encrypt.json` | `CCM_COUNTER_BLOCK`@`CCM-Encrypt.json`<br>`CCM_CTR`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-encrypt` | 模式 | L3 | `ccm_encrypt`<br>`ccm_cbc_mac`<br>`ccm_ctr` | `CCM-Encrypt.json` | `CCM_Encrypt`@`CCM-Encrypt.json`<br>`CCM_CBC_MAC`@`CCM-Encrypt.json`<br>`CCM_CTR`@`CCM-Encrypt.json` | wired |
| `sp800-38c-ccm` | `ccm-decrypt` | 模式 | L3 | `ccm_decrypt`<br>`ccm_cbc_mac`<br>`ccm_ctr` | `CCM-Encrypt.json` | `CCM_CBC_MAC`@`CCM-Encrypt.json`<br>`CCM_CTR`@`CCM-Encrypt.json`<br>`CCM_Decrypt`@`CCM-Encrypt.json` | wired |
| `sp800-38e-xts` | `xts-tweak-mul` | 原语 | L1 | `xts_tweak_mul` | `XTS-Encrypt.json` | `XTS_TWEAK_MUL`@`XTS-Encrypt.json` | wired |
| `sp800-38e-xts` | `xts-encrypt` | 模式 | L3 | `xts_encrypt`<br>`xts_tweak_mul` | `XTS-Encrypt.json` | `XTS_Encrypt`@`XTS-Encrypt.json`<br>`XTS_TWEAK_MUL`@`XTS-Encrypt.json` | wired |

`⚠` 前缀表示该积木在卡片里被声明但不在 `BLOCK-IO-CONTRACT.json` 里（`spec:validate` 会对这种情况直接失败，这里只是同屏提示）。

## 3. 差集（不是缺陷判定）

| 卡片 | 条目 | 差集 | 明细 |
|---|---|---|---|
| `sp800-38b-cmac` | `sp800-38b.cmac.subkey-generation` | Demo 未使用 | `cmac_double` 未被任何登记 Demo 使用 |
| `sp800-38b-cmac` | `sp800-38b.cmac.subkey-generation` | 无完整覆盖工作区 | 声明积木 `cmac_subkeys` `cmac_double` 未同时出现在同一 Demo |

这些行说明「卡片的声明」与「Demo 的实际执行」之间的差集。它不等于阻塞缺陷：例如只由单元测试驱动、没有 Demo 工作区的原语，会在「无过程执行」里出现，而它的证据在 `tests/unit/` 里。

## 4. 统计

```
cards=3 entries=11 demos=60
demo_block_types=137 entry_blocks=12 gaps=2
```

## 5. 相关入口

| 入口 | 作用 |
|---|---|
| [`npm run spec:validate`](../guides/SPEC-CARDS.md) | 重算制品哈希、引文锚点、块与类型引用 |
| [`npm run spec:plan`](../guides/SPEC-CARDS.md) | 把卡片缺口算成可执行工作项 |
| [`npm run spec:candidates`](../guides/SPEC-CARDS.md) | 复核 `spec-runs/candidates/` 的候选骨架 |
| [`demos/ENDPOINT-MATRIX.md`](../demos/ENDPOINT-MATRIX.md) | Demo 端点级的「测试来源 + 参数范围 + 缺口」 |
| [`CONFORMANCE-INVENTORY.md`](./CONFORMANCE-INVENTORY.md) | 全量符合性对象边界与逐块证据表 |
| [`COVERAGE.md`](./COVERAGE.md) | 标准目录与积木的聚合覆盖矩阵 |

本表与 `ENDPOINT-MATRIX.md` 的分工：**端点矩阵以 Demo 为主体**（每个工作区用了哪些块、测试来源是什么），**本表以卡片条目为主体**（每条标准义务由哪些 Demo/过程执行、哪些没有）。
