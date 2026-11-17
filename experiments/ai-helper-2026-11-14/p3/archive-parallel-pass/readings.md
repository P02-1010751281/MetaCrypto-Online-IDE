# P3 第一步切片读数（由 run-p3.mjs 生成，勿手改）

生成时间：2026-11-17T12:30:17.141Z
仓库：`/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat`
重跑：`node experiments/ai-helper-2026-11-14/p3/run-p3.mjs all`

## V0 样本哈希

| 文件 | sha256（前 16） | 行数 | 字节 | 结论 |
|---|---|---|---|---|
| jia-aes-round.c | `68bd0d7c2b13464d…` | 39 | 3086 | 通过 |
| yi-aes-ecb.c | `677df19bce0354a2…` | 28 | 1408 | 通过 |
| bing-sm4-sbox.c | `d7dbb1809c533d0a…` | 23 | 2054 | 通过 |

校验命令：`cd experiments/ai-helper-2026-11-14/p3/samples && sha256sum -c SHA256SUMS`

## V1 结构扫描（已知 / 未知 / 无块承接）

| 样本 | 已知构造 | 未知构造 | 无块承接 | 函数 | 循环 | 查表 |
|---|---|---|---|---|---|---|
| jia-aes-round.c | 90 | 0 | 2 | 6 | 5 | 1 |
| yi-aes-ecb.c | 85 | 0 | 5 | 2 | 7 | 4 |
| bing-sm4-sbox.c | 5 | 0 | 2 | 1 | 0 | 1 |

自测探针未知构造：11 条

## V2 别名命中 / 未命中

| 样本 | 命中块（distinct） | 命中记录 | 未命中调用 |
|---|---|---|---|
| jia-aes-round.c | 4 | 8 | 4 |
| yi-aes-ecb.c | 4 | 7 | 2 |
| bing-sm4-sbox.c | 1 | 1 | 0 |

## V3 差分

- 可达：yi-aes-ecb.c → 密文 `69c4e0d86a7b0430d8cdb78070b4c55a`，期望 `69c4e0d86a7b0430d8cdb78070b4c55a`，相等
- 不可达：jia-aes-round.c —— 片段无入口：只有轮函数四步与 aes_round(s, rk)（无返回值），没有 (in, key, out) 形态入口，也没有 main/向量驱动。
- 不可达：bing-sm4-sbox.c —— 片段无 I/O 入口：唯一函数 sm4_sbox(uint8_t) 是 uint8_t→uint8_t 查表体，没有 main、没有向量驱动；V3 要与生成代码两侧对跑，本切片不跑生成器，只有一侧可执行。
