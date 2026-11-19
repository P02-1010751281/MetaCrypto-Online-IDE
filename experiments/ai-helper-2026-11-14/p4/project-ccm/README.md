# SP 800-38C CCM 试点工程（P4 A 线第三条纵向切片）

NIST SP 800-38C 的 AES-CCM，用**仓库现有块**搭出的多文件 project，向量取 Appendix C
Example 1/2/3（Tlen 4/6/8；Nlen 56/64/96；Alen 64/128/160；Plen 32/128/192）。
与前两条切片的区别：CCM 的分解链更长（格式化 → CBC-MAC → CTR → 标签掩码），且三处
`IntList`→`Bytes` 的类型门在画布上被拒（`../connect-probe-sp800-38c-ccm.json`），
所以格式化产物只能整体走 `ccm_encrypt`/`ccm_cbc_mac`/`ccm_ctr` 的闭包。

## 文件与角色

| 文件 | 角色 | 块数 |
|---|---|---:|
| `algo.ccm.block.json` | 七个 procedure：`CCM_ENCRYPT_EX1` / `CCM_DECRYPT_EX1`（整段）与 `CCM_B0` / `CCM_COUNTER_BLOCK` / `CCM_CBC_MAC` / `CCM_CTR` / `CCM_AAD_PREFIX`（Appendix A 原语） | 35 |
| `main.block.json` | entry：Example 1/2/3 的 K/N/A/P → `C‖T`；Example 1 再算 B0、Ctr0/Ctr1、AAD 前缀、CBC-MAC 的 X、CTR 密文段 | 78 |
| `ccm-appendix-c.project.json` | `ProjectRecord`：`files[]` 里是上面两个负载的字符串，`entryFileId = file-main`，覆盖报告与锚点在 `metadata.aiHelper`（**不进** `files[]`） | — |

`entryFileId` 决定生成顺序与「原语只注入一次」：`algo` 先出、`main` 最后出。

## 官方向量（Appendix C）

| 例 | Tlen | Nlen | Alen | Plen | C‖T | 掩码前 T |
|---|---:|---:|---:|---:|---|---|
| 1 | 4 | 7 | 8 | 4 | `7162015b4dac255d` | `6084341b` |
| 2 | 6 | 8 | 16 | 16 | `d2a1f0e051ea5f62081a7792073d593d1fc64fbfaccd` | `7f479ffca464` |
| 3 | 8 | 12 | 20 | 24 | `e3b201a9f5b71a7a9b1ceaeccd97e70b6176aad9a4428aa5484392fbc1b09951` | `67c99240c7d51048` |

Example 1 的中间量：B0 `4f101112131415160000000000000004`、Ctr0 `07101112131415160000000000000000`、
Ctr1 `07101112131415160000000000000001`、AAD 前缀（a=8/16）`0008`/`0010`、
CBC-MAC 的 X `6084341b32042bf000b4b7995553a3c5`、CTR 密文段 `7162015b`。

X 不是本仓库生成器算的：用 `cryptography` 的 AES-ECB 按 CBC-MAC 手搭
（`Y0=E(B0)`、`Yi=E(Y(i-1) xor Bi)`）独立复算，再与 `T xor S0` 的前 4 字节对齐 Appendix C.1 的 `T`。

## 复现（仓库根执行）

```bash
# 第 3 段：重新生成本目录（读同目录的 anchors/verdicts，两者须先跑）
python3 experiments/ai-helper-2026-11-14/p4/build-project-ccm.py

# 第 4 段：结构 / 生成 / 类型 / 双语言向量
AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/a-ccm-project \
  npx vite build --config vite.verify.config.ts
node dist-verify/a-ccm-project/verify-project.js \
  experiments/ai-helper-2026-11-14/p4/project-ccm/ccm-appendix-c.project.json \
  --exec --out experiments/ai-helper-2026-11-14/p4/verify-project-readings-ccm.json
```

## 这个工程不证明什么

- 不证明块与 SP 800-38C 伪代码逐行等价（`semantic_equivalence: unverified`）。
- 不证明认证或标准符合性；也不构成常量时间或认证安全证明。
- **分解链的三处类型门在画布上不通**：`ccm_b0` / `ccm_counter_block` / `ccm_aad_len_prefix`
  输出 `IntList`，`ccm_cbc_mac.MSG` / `ccm_ctr.MSG` / `mode_ecb_encrypt.DATA` 要 `Bytes`；
  224 块里没有 `IntList→Bytes` 转换块（证据：`../connect-probe-sp800-38c-ccm.json`）。
  工程只用现有块，不补转换块。
- `ccm_*` 块只实现 AES-128（没有 SM4 路径）；本试点只覆盖附录 C 的 4/6/8 字节标签，其他 nonce 长度与 bit 级 Tlen 不进本试点。
