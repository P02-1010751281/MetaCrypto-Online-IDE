# SP 800-38B CMAC 试点工程（P4 A 线第二条纵向切片）

NIST SP 800-38B 的 AES-CMAC，用**仓库现有块**搭出的多文件 project，向量取 RFC 4493 §4
（与 `tests/unit/cmac-block-contract.test.ts`、`demos/tests.json` 的 `procedures/CMAC-AES.json`
条目同源；那两处由仓库门禁跑）。与第一条切片（SHA-256 多分组）的区别：这次覆盖的是一个
**非哈希**标准，且 §6.1 的四步在画布上**拼不出来**（见下）。

## 文件与角色

| 文件 | 角色 | 块数 |
|---|---|---:|
| `algo.cmac.block.json` | 两个 procedure：`CMAC_AES(key, msg)` = `cmac_mac`（§6.2 标签），`CMAC_SUBKEYS(subkey)` = `cmac_subkeys`（§6.1 的 K1‖K2） | 7 |
| `main.block.json` | entry：`hex_to_bytes` 造 key/msg → 四个长度（0/16/40/64）各调一次 `CMAC_AES` → 一次 `CMAC_SUBKEYS` | 34 |
| `cmac-rfc4493.project.json` | `ProjectRecord`：`files[]` 里是上面两个负载的字符串，`entryFileId = file-main`，覆盖报告与锚点在 `metadata.aiHelper`（**不进** `files[]`）。v0.0 稿（`project/sha256-multiblock.project.json`）照旧存在，未改。 | — |

`entryFileId` 决定生成顺序与「原语只注入一次」：`algo` 先出、`main` 最后出。

## 生成的代码形状（节选）

```python
key = hex_to_bytes("2b7e…4f3c")
msg = hex_to_bytes("6bc1…3710")
tag16 = CMAC_AES(key, bytes_slice(msg, 0, 16))
subkeys = CMAC_SUBKEYS(key)
```

四个长度分支覆盖 §6.2 的四条路径：0 字节（空消息 → `K2`）、16 字节（整块 → `K1`）、
40 字节（不完整末块 → pad 后 `K2`）、64 字节（多整块）。

## 复现（仓库根执行）

```bash
# 第 3 段：重新生成本目录（读同目录的 anchors/verdicts，两者须先跑）
python3 experiments/ai-helper-2026-11-14/p4/build-project-cmac.py

# 第 4 段：结构 / 生成 / 类型 / 双语言向量
AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/p4-project \
  npx vite build --config vite.verify.config.ts
node dist-verify/p4-project/verify-project.js \
  experiments/ai-helper-2026-11-14/p4/project-cmac/cmac-rfc4493.project.json \
  --exec --out experiments/ai-helper-2026-11-14/p4/verify-project-readings-cmac.json
```

期望：`=== PROJECT VECTOR PASS (bb1d6929…)`，Python 与 JS 各一行 PASS（四行标签 + 一行子密钥），
外加 15 字节阴性对照（`f212d4c2…`，必须 ≠ 16 字节官方向量 `070a16b4…`）两行 PASS。

本次读数（2026-11-18）：structure `7+34`；symbols `CMAC_AES(key,msg)` / `CMAC_SUBKEYS(subkey)`；
python 171 行 / js 159 行；typecheck `pairs=32 ok=0 mismatch=0 unknown=32`
（`coreBlockNoContract 17 / parentInputNoCheck 13 / childOutputNoCheck 2`）。

## 这个工程不证明什么

- 不证明块与 SP 800-38B 伪代码逐行等价（`semantic_equivalence: unverified`）。
- 不证明认证或标准符合性（`PRODUCT-CERTIFICATION-FEASIBILITY.md` 明确整体不是认证对象）。
- **§6.1 的分解不在画布上**：`L = E_K(0)` 的产物是 `Bytes`，`cmac_double` 入口是 `IntList`，
  画布拒绝这次连接且 224 块里没有 `Bytes→IntList` 转换块（证据：`../connect-probe-sp800-38b.json`）。
  工程里 §6.1 只用到 `cmac_subkeys` 一个块，四步都被它吸收。
- 只覆盖 RFC 4493 §4 的四条消息与一组子密钥；SM4 路径没进本试点。
