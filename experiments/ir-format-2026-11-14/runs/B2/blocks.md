# 可用积木的端口契约（取自 docs/blocks/BLOCK-IO-CONTRACT.json）

## `ccm_encrypt`
```json
{
  "inputs": [
    {
      "name": "KEY",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "AAD",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "MSG",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "Bytes"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_decrypt`
```json
{
  "inputs": [
    {
      "name": "KEY",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "AAD",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "CT",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "Bytes"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_b0`
```json
{
  "inputs": [
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "MSGLEN",
      "type": 1,
      "check": [
        "Number"
      ]
    },
    {
      "name": "AADLEN",
      "type": 1,
      "check": [
        "Number"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "IntList"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_aad_len_prefix`
```json
{
  "inputs": [
    {
      "name": "AADLEN",
      "type": 1,
      "check": [
        "Number"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [],
  "outputCheck": [
    "IntList"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_counter_block`
```json
{
  "inputs": [
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "I",
      "type": 1,
      "check": [
        "Number"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "IntList"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_cbc_mac`
```json
{
  "inputs": [
    {
      "name": "KEY",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "AAD",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "MSG",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "Bytes"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `ccm_ctr`
```json
{
  "inputs": [
    {
      "name": "KEY",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "NONCE",
      "type": 1,
      "check": [
        "IntList"
      ]
    },
    {
      "name": "MSG",
      "type": 1,
      "check": [
        "Bytes"
      ]
    },
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "TAGLEN",
      "fieldClass": "vd",
      "options": [
        [
          "4",
          "4"
        ],
        [
          "6",
          "6"
        ],
        [
          "8",
          "8"
        ],
        [
          "10",
          "10"
        ],
        [
          "12",
          "12"
        ],
        [
          "14",
          "14"
        ],
        [
          "16",
          "16"
        ]
      ]
    }
  ],
  "outputCheck": [
    "Bytes"
  ],
  "previousStatement": null,
  "nextStatement": null
}
```

## `data_value`
```json
{
  "inputs": [
    {
      "name": "",
      "type": 5,
      "check": null
    }
  ],
  "fields": [
    {
      "name": "NUM",
      "fieldClass": ""
    }
  ],
  "outputCheck": null,
  "previousStatement": null,
  "nextStatement": null
}
```

## 全部可用的块类型（221 个，只能使用这些类型）

aes_add_round_key、aes_mix_columns、aes_shift_rows、aes_sub_bytes、argon2_g、argon2_hash、arr_partition_to_array、arr_slice、ascon_cxof128、ascon_decrypt、ascon_encrypt、ascon_hash256、ascon_xof128、base64_decode、base64_encode、berlekamp_massey、bin_mat_inv、bin_mat_mul、bit_byte_substitute、bit_expr_infix、bit_not32、bit_operation、bit_rotate_left、bit_rotate_left_op、bit_rotate_right、bit_rotate_right_op、bn_add、bn_div、bn_mul、bn_sub、bytes_to_hex、ccm_aad_len_prefix、ccm_b0、ccm_cbc_mac、ccm_counter_block、ccm_ctr、ccm_decrypt、ccm_encrypt、cipher_key_from_seed、cmac_double、cmac_mac、cmac_subkeys、comb、crypto_decrypt_func、crypto_encrypt_func、crypto_hash_func、crypto_return、ctrl_iterate、data_bit_length、data_byte_length、data_convert_bits_to_bytes、data_convert_bytes_to_bits、data_convert_to_int、data_value、drbg_generate、drbg_update、ecc_add、ecc_load_curve_params、ecc_load_point、ecc_multiply、ecc_point_double、ecdh_shared_secret、ecdsa_k_rfc6979、ecdsa_sign、ecdsa_verify、eddsa_sign、eddsa_verify、endian_swap、fors_leaf_index、fors_pk_from_sk、fors_root、fors_sign、fors_verify、gauss_elim、gauss_pmf、gcm_encrypt、gcm_gctr、gcm_gf128_mul、gcm_ghash、gcm_inc32、gcm_j0、gf2_poly_div、gf2_poly_gcd、gf2_poly_mod、gf2_poly_mul、gf2m_add、gf2m_inv、gf2m_mul、gf2m_poly_add、gf2m_poly_eval、gf2m_poly_mod、gf2m_poly_mul、gf2m_poly_xgcd、gm_rng、goppa_decode、goppa_gen_poly、ham_dist、ham_weight、hash_chain、hash_hmac、hash_sha224_hash、hash_sha256_compress、hash_sha256_pad、hash_sha256_pad_hex、hash_sha256_pad_text、hash_sha3_pad_hex、hash_sha3_pad_text、hash_sha512_compress、hash_sha512_hash、hash_sha512_pad、hash_sm3_compress、hash_sm3_pad、hash_sm3_pad_hex、hash_sm3_pad_text、hex_to_bytes、hkdf、hkdf_expand、hkdf_extract、keccak_f、keccak_state_init、lgc_compound、lgc_not、lgc_operation、lll_reduce、merkle_auth_path、merkle_leaf、merkle_node、merkle_root、mldsa_sign、mldsa_verify、mode_cbc_encrypt、mode_ctr_encrypt、mode_ecb_decrypt、mode_ecb_encrypt、mv_quad_eval、nt_div_rem、nt_field_add、nt_mod、nt_mod_inverse、nt_mod_pow、pad_pkcs7、pad_zero、pbkdf2、pbkdf2_f、poly_scale、pq_bits_to_bytes、pq_byte_concat、pq_byte_decode、pq_byte_encode、pq_bytes_slice、pq_bytes_to_bits、pq_compress、pq_decompose、pq_decompress、pq_intt、pq_make_hint、pq_mat_vec_mul、pq_ntt、pq_ntt_butterfly、pq_ntt_mul、pq_poly_add、pq_poly_mul、pq_poly_sub、pq_power2round、pq_prf、pq_rej_sample、pq_sample_in_ball、pq_sample_ntt、pq_sample_poly_cbd、pq_seed_with_nonce、pq_use_hint、pq_xof、primitive_def、rsa_decrypt、rsa_emsa_pkcs1_v15_encode、rsa_encrypt、rsa_keygen、rsa_mgf1、rsa_sign、rsa_verify、sbox、sbox_sub、sbox_variables_get、sbox_variables_set、seed_bytes、seed_hex、sha3_hash、slh_addr、slh_adrs_full、slh_msg_randomness、slh_sign、slh_xmss_root、sm2_decrypt、sm2_encrypt、sm2_kdf、sm2_key_exchange、sm2_sign、sm2_verify、sm4_linear_transform、sm4_round_func、sm4_sbox、sm9_master_key、sm9_sign、sm9_user_key、sm9_verify、sponge_absorb、sponge_pad、sponge_squeeze、syndrome_calc、vec_dot、wots_checksum、x25519、xts_encrypt、xts_tweak_mul、zuc_eia3、zuc_f、zuc_keystream、zuc_l1、zuc_l2、zuc_s0、zuc_s1
