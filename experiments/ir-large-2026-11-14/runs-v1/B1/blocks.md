# 块端口契约（任务里出现的全部类型）

共 42 个块类型。字段名与输入槽名取自真实定义；`(options)` 表示枚举取值。原生 Blockly 块没有契约条目，端口按实际块树汇总。

| 类型 | 输入槽 | 字段 | 来源 |
|---|---|---|---|
| `arr_slice` | `LIST`<br>`START`<br>`LENGTH`<br>`` | — | 契约 |
| `bin_mat_inv` | `A`<br>`N`<br>`` | — | 契约 |
| `bin_mat_mul` | `A`<br>`B`<br>`N`<br>`` | — | 契约 |
| `ccm_aad_len_prefix` | `AADLEN`<br>`` | — | 契约 |
| `ccm_b0` | `NONCE`<br>`MSGLEN`<br>`AADLEN`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `ccm_cbc_mac` | `KEY`<br>`NONCE`<br>`AAD`<br>`MSG`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `ccm_counter_block` | `NONCE`<br>`I`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `ccm_ctr` | `KEY`<br>`NONCE`<br>`MSG`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `ccm_decrypt` | `KEY`<br>`NONCE`<br>`AAD`<br>`CT`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `ccm_encrypt` | `KEY`<br>`NONCE`<br>`AAD`<br>`MSG`<br>`` | `TAGLEN(4,4/6,6/8,8/10,10/12,12/14,14/16,16)` | 契约 |
| `data_value` | `` | `NUM` | 契约 |
| `fors_leaf_index` | `M`<br>`I`<br>`` | — | 契约 |
| `gf2_poly_div` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2_poly_gcd` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2_poly_mod` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2_poly_mul` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2m_poly_add` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2m_poly_eval` | `P`<br>`X`<br>`` | — | 契约 |
| `gf2m_poly_mod` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2m_poly_mul` | `A`<br>`B`<br>`` | — | 契约 |
| `gf2m_poly_xgcd` | `A`<br>`B`<br>`` | — | 契约 |
| `goppa_decode` | `Y`<br>`G`<br>`L`<br>`` | — | 契约 |
| `goppa_gen_poly` | `ALPHA`<br>`` | — | 契约 |
| `ham_dist` | `X`<br>`Y`<br>`` | — | 契约 |
| `ham_weight` | `X`<br>`` | — | 契约 |
| `math_number` | — | `NUM` | 原生块 |
| `merkle_auth_path` | `LEAVES`<br>`LEAF_LEN`<br>`ADRS`<br>`INDEX`<br>`` | — | 契约 |
| `merkle_node` | `LEFT`<br>`RIGHT`<br>`ADRS`<br>`` | — | 契约 |
| `merkle_root` | `LEAVES`<br>`LEAF_LEN`<br>`ADRS`<br>`` | — | 契约 |
| `nt_mod_pow` | `A`<br>`B`<br>``<br>`` | `MODULUS(3329 (Kyber),3329/8380417 (ML-DSA),8380417/12289 (NewHope),12289/65537,65537/1000000007,1000000007)` | 契约 |
| `pq_decompose` | `INPUT`<br>``<br>`` | `PART(r1 (高位),r1/r0 (低位),r0)` | 契约 |
| `pq_make_hint` | `Z`<br>`R`<br>`` | — | 契约 |
| `pq_poly_mul` | `A`<br>`B`<br>``<br>`` | `MODULUS(none,none/q=3329,3329/q=8380417,8380417/q=12289 (teaching),12289)` | 契约 |
| `pq_power2round` | `INPUT`<br>``<br>`` | `PART(r1 (高位),r1/r0 (低位),r0)` | 契约 |
| `pq_rej_sample` | `X`<br>`BOUND`<br>`` | — | 契约 |
| `pq_sample_in_ball` | `SEED`<br>`` | — | 契约 |
| `pq_use_hint` | `H`<br>`R`<br>`` | — | 契约 |
| `procedures_defreturn` | `RETURN` | `NAME` | 原生块 |
| `slh_addr` | ``<br>`LAYER`<br>`TREE`<br>`LEAF`<br>``<br>`` | `TYPE(WOTS_HASH(0),0/WOTS_PK(1),1/TREE(2),2/FORS_TREE(3),3/FORS_ROOTS(4),4/WOTS_PRF(5),5/FORS_PRF(6),6)` | 契约 |
| `slh_adrs_full` | `LAYER`<br>`TREE`<br>``<br>`KEYPAIR`<br>`HEIGHT`<br>`INDEX`<br>`` | `TYPE(WOTS_HASH,0/WOTS_PK,1/TREE,2/FORS_TREE,3/FORS_ROOTS,4/WOTS_PRF,5/FORS_PRF,6)` | 契约 |
| `variables_get` | — | `VAR` | 原生块 |
| `wots_checksum` | `M`<br>`` | — | 契约 |

