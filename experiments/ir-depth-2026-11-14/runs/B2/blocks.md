# 块端口契约（任务里出现的全部类型）

共 16 个块类型。

| 类型 | 输入槽 | 字段 | 来源 |
|---|---|---|---|
| `data_value` | `` | `NUM` | 契约 |
| `keccak_state_init` | `` | — | 契约 |
| `pq_byte_concat` | `A`<br>`B`<br>`` | — | 契约 |
| `pq_byte_decode` | `INPUT`<br>``<br>`` | `BITS(12,12/11,11/10,10/5,5/4,4/1,1)` | 契约 |
| `pq_bytes_slice` | `INPUT`<br>`START`<br>`END`<br>`` | — | 契约 |
| `pq_ntt` | `INPUT`<br>``<br>``<br>`` | `MODULUS(3329 (ML-KEM),3329/8380417 (ML-DSA),8380417/12289 (Teaching),12289)`<br>`DEGREE(256,256)` | 契约 |
| `pq_prf` | ``<br>`SEED`<br>`NONCE`<br>`OUTLEN` | `ALGO(SHAKE256,SHAKE256/SHAKE128,SHAKE128)` | 契约 |
| `pq_sample_ntt` | `SEED`<br>``<br>`` | `MODULUS(3329 (Kyber),3329/8380417 (ML-DSA),8380417)` | 契约 |
| `pq_sample_poly_cbd` | `SEED`<br>``<br>``<br>`` | `ETA(3 (ML-KEM-512),3/2 (ML-KEM-768/1024),2)`<br>`MODULUS(3329 (Kyber),3329/8380417 (ML-DSA),8380417)` | 契约 |
| `pq_seed_with_nonce` | `SEED`<br>`NONCE`<br>`` | — | 契约 |
| `procedures_defreturn` | `STACK`<br>`RETURN` | `NAME` | 原生块 |
| `sponge_absorb` | ``<br>`STATE`<br>`BLOCK`<br>`` | `RATE(1088,1088/576,576/1152,1152/832,832/1344,1344)` | 契约 |
| `sponge_pad` | `INPUT`<br>``<br>`` | `RATE(1088 (SHA3-256),1088/576 (SHA3-512),576/1152 (SHA3-224),1152/832 (SHA3-384),832/1344 (SHAKE128),1344)`<br>`SUFFIX(0x06 (SHA-3),0x06/0x1F (SHAKE),0x1F)` | 契约 |
| `sponge_squeeze` | ``<br>`STATE`<br>`OUTLEN`<br>`` | `RATE(1088,1088/576,576/1152,1152/832,832/1344,1344)` | 契约 |
| `variables_get` | — | `VAR` | 原生块 |
| `variables_set` | `VALUE` | `VAR` | 原生块 |

