# 确定性测量结果

- Demo 工作区：**60** 个，块总数 **2151**，procedure 总数 **148**
- ≥100 块的 Demo：**1** 个；<25 块的 Demo：**54** 个

## 规模最大的 8 个工作区

| Demo | 块数 | 过程数 | 单过程最大块数 | IR 字节 | JSON 字节（原始） | JSON 字节（组装后） | 必须唯一的 id 数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| procedures/ML-KEM-Encaps.json | 1494 | 1 | 1494 | 90105 | 125110 | 128911 | 1494 |
| procedures/Goppa-Decode.json | 47 | 8 | 16 | 4145 | 5486 | 5370 | 47 |
| procedures/CCM-Encrypt.json | 35 | 7 | 6 | 3382 | 4728 | 4290 | 35 |
| procedures/PQC-Gaps.json | 33 | 7 | 7 | 3457 | 4367 | 4316 | 33 |
| procedures/Code-Based-Math.json | 32 | 8 | 5 | 3089 | 4023 | 3921 | 32 |
| procedures/Tree-Index.json | 25 | 5 | 6 | 2813 | 3559 | 3450 | 25 |
| procedures/GF2m-Poly.json | 23 | 6 | 4 | 2369 | 3014 | 2961 | 23 |
| procedures/Hash-Based-Structures.json | 23 | 5 | 5 | 2433 | 3100 | 3007 | 23 |

## 每个 procedure 的块数分布（全部工作区）

- procedure 总数 **148**；块数中位数 **4**，p90 **7**，最大 **1494**（procedures/ML-KEM-Encaps.json 的 ML_KEM_Encaps）
- 只有 1 个块的 procedure：**1** 个；≤3 块的：**40** 个

