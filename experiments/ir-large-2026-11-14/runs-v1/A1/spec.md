# 复现任务规格（格式中立）

每个 `NAME -> 类型 字段="值"` 行是一个块；缩进表示「该输入槽里放这个块」；`(then)` 表示语句链的下一块。
本文件不含 id、坐标、`{"block": …}` 包装——这些由你在目标格式里自行补。

## GOPPA_G（3 块）
procedures_defreturn extraState={"params":[{"name":"alphas","id":"goppa_param_alphas","type":"int_list"}],"hasStatements":false} NAME="GOPPA_G"
  RETURN -> goppa_gen_poly
    ALPHA -> variables_get VAR={"id":"goppa_param_alphas"}

## GOPPA_EVAL（4 块）
procedures_defreturn extraState={"params":[{"name":"p","id":"goppa_param_p","type":"int_list"},{"name":"x","id":"goppa_param_x","type":"int"}],"hasStatements":false} NAME="GOPPA_EVAL"
  RETURN -> gf2m_poly_eval
    P -> variables_get VAR={"id":"goppa_param_p"}
    X -> variables_get VAR={"id":"goppa_param_x"}

## GA（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"goppa_param_a","type":"int_list"},{"name":"b","id":"goppa_param_b","type":"int_list"}],"hasStatements":false} NAME="GA"
  RETURN -> gf2m_poly_add
    A -> variables_get VAR={"id":"goppa_param_a"}
    B -> variables_get VAR={"id":"goppa_param_b"}

## GM（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"goppa_param_a","type":"int_list"},{"name":"b","id":"goppa_param_b","type":"int_list"}],"hasStatements":false} NAME="GM"
  RETURN -> gf2m_poly_mul
    A -> variables_get VAR={"id":"goppa_param_a"}
    B -> variables_get VAR={"id":"goppa_param_b"}

## GMod（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"goppa_param_a","type":"int_list"},{"name":"b","id":"goppa_param_b","type":"int_list"}],"hasStatements":false} NAME="GMod"
  RETURN -> gf2m_poly_mod
    A -> variables_get VAR={"id":"goppa_param_a"}
    B -> variables_get VAR={"id":"goppa_param_b"}

## GOPPA_INV（7 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"goppa_param_a","type":"int_list"},{"name":"g","id":"goppa_param_g","type":"int_list"}],"hasStatements":false} NAME="GOPPA_INV"
  RETURN -> arr_slice
    LIST -> gf2m_poly_xgcd
      A -> variables_get VAR={"id":"goppa_param_a"}
      B -> variables_get VAR={"id":"goppa_param_g"}
    START -> math_number NUM=1
    LENGTH -> math_number NUM=2

## GOPPA_SYN（16 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"goppa_param_a","type":"int_list"},{"name":"b","id":"goppa_param_b","type":"int_list"},{"name":"g","id":"goppa_param_g","type":"int_list"}],"hasStatements":false} NAME="GOPPA_SYN"
  RETURN -> gf2m_poly_mod
    A -> gf2m_poly_add
      A -> arr_slice
        LIST -> gf2m_poly_xgcd
          A -> variables_get VAR={"id":"goppa_param_a"}
          B -> variables_get VAR={"id":"goppa_param_g"}
        START -> math_number NUM=1
        LENGTH -> math_number NUM=2
      B -> arr_slice
        LIST -> gf2m_poly_xgcd
          A -> variables_get VAR={"id":"goppa_param_b"}
          B -> variables_get VAR={"id":"goppa_param_g"}
        START -> math_number NUM=1
        LENGTH -> math_number NUM=2
    B -> variables_get VAR={"id":"goppa_param_g"}

## GOPPA_DEC（5 块）
procedures_defreturn extraState={"params":[{"name":"y","id":"goppa_param_y","type":"int_list"},{"name":"g","id":"goppa_param_g","type":"int_list"},{"name":"L","id":"goppa_param_L","type":"int_list"}],"hasStatements":false} NAME="GOPPA_DEC"
  RETURN -> goppa_decode
    Y -> variables_get VAR={"id":"goppa_param_y"}
    G -> variables_get VAR={"id":"goppa_param_g"}
    L -> variables_get VAR={"id":"goppa_param_L"}

## CCM_Encrypt（6 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_Encrypt"
  RETURN -> ccm_encrypt TAGLEN="8"
    KEY -> data_value NUM="[0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f]"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x1a,0x1b]"
    AAD -> data_value NUM="[0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,0x10,0x11,0x12,0x13]"
    MSG -> data_value NUM="[0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x29,0x2a,0x2b,0x2c,0x2d,0x2e,0x2f,0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37]"

## CCM_B0（5 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_B0"
  RETURN -> ccm_b0 TAGLEN="4"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16]"
    MSGLEN -> data_value NUM="4"
    AADLEN -> data_value NUM="8"

## CCM_AAD_PREFIX（3 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_AAD_PREFIX"
  RETURN -> ccm_aad_len_prefix
    AADLEN -> data_value NUM="8"

## CCM_COUNTER_BLOCK（4 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_COUNTER_BLOCK"
  RETURN -> ccm_counter_block TAGLEN="4"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16]"
    I -> data_value NUM="0"

## CCM_CBC_MAC（6 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_CBC_MAC"
  RETURN -> ccm_cbc_mac TAGLEN="4"
    KEY -> data_value NUM="[0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f]"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16]"
    AAD -> data_value NUM="[0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07]"
    MSG -> data_value NUM="[0x20,0x21,0x22,0x23]"

## CCM_CTR（5 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_CTR"
  RETURN -> ccm_ctr TAGLEN="4"
    KEY -> data_value NUM="[0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f]"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16]"
    MSG -> data_value NUM="[0x20,0x21,0x22,0x23]"

## CCM_Decrypt（6 块）
procedures_defreturn extraState={"params":[],"hasStatements":false} NAME="CCM_Decrypt"
  RETURN -> ccm_decrypt TAGLEN="4"
    KEY -> data_value NUM="[0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f]"
    NONCE -> data_value NUM="[0x10,0x11,0x12,0x13,0x14,0x15,0x16]"
    AAD -> data_value NUM="[0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07]"
    CT -> data_value NUM="[0x71,0x62,0x01,0x5b,0x4d,0xac,0x25,0x5d]"

## REJ（4 块）
procedures_defreturn extraState={"params":[{"name":"x","id":"gap_param_x","type":"int"},{"name":"b","id":"gap_param_b","type":"int"}],"hasStatements":false} NAME="REJ"
  RETURN -> pq_rej_sample
    X -> variables_get VAR={"id":"gap_param_x"}
    BOUND -> variables_get VAR={"id":"gap_param_b"}

## PM（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gap_param_a","type":"int_list"},{"name":"b","id":"gap_param_b","type":"int_list"}],"hasStatements":false} NAME="PM"
  RETURN -> pq_poly_mul MODULUS="none"
    A -> variables_get VAR={"id":"gap_param_a"}
    B -> variables_get VAR={"id":"gap_param_b"}

## PMQ（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gap_param_a","type":"int_list"},{"name":"b","id":"gap_param_b","type":"int_list"}],"hasStatements":false} NAME="PMQ"
  RETURN -> pq_poly_mul MODULUS="8380417"
    A -> variables_get VAR={"id":"gap_param_a"}
    B -> variables_get VAR={"id":"gap_param_b"}

## ADRS_TREE（7 块）
procedures_defreturn extraState={"params":[{"name":"layer","id":"gap_param_layer","type":"int"},{"name":"tree","id":"gap_param_tree","type":"int"},{"name":"kp","id":"gap_param_kp","type":"int"},{"name":"h","id":"gap_param_h","type":"int"},{"name":"idx","id":"gap_param_idx","type":"int"}],"hasStatements":false} NAME="ADRS_TREE"
  RETURN -> slh_adrs_full TYPE="3"
    LAYER -> variables_get VAR={"id":"gap_param_layer"}
    TREE -> variables_get VAR={"id":"gap_param_tree"}
    KEYPAIR -> variables_get VAR={"id":"gap_param_kp"}
    HEIGHT -> variables_get VAR={"id":"gap_param_h"}
    INDEX -> variables_get VAR={"id":"gap_param_idx"}

## ADRS_ROOTS（7 块）
procedures_defreturn extraState={"params":[{"name":"layer","id":"gap_param_layer","type":"int"},{"name":"tree","id":"gap_param_tree","type":"int"},{"name":"kp","id":"gap_param_kp","type":"int"}],"hasStatements":false} NAME="ADRS_ROOTS"
  RETURN -> slh_adrs_full TYPE="4"
    LAYER -> variables_get VAR={"id":"gap_param_layer"}
    TREE -> variables_get VAR={"id":"gap_param_tree"}
    KEYPAIR -> variables_get VAR={"id":"gap_param_kp"}
    HEIGHT -> math_number NUM=0
    INDEX -> math_number NUM=0

## WC（3 块）
procedures_defreturn extraState={"params":[{"name":"m","id":"gap_param_m","type":"bytes"}],"hasStatements":false} NAME="WC"
  RETURN -> wots_checksum
    M -> variables_get VAR={"id":"gap_param_m"}

## MP（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gap_param_a","type":"int"},{"name":"b","id":"gap_param_b","type":"int"}],"hasStatements":false} NAME="MP"
  RETURN -> nt_mod_pow MODULUS="8380417"
    A -> variables_get VAR={"id":"gap_param_a"}
    B -> variables_get VAR={"id":"gap_param_b"}

## PMul（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"b","id":"param_b","type":"int_list"}],"hasStatements":false} NAME="PMul"
  RETURN -> gf2_poly_mul
    A -> variables_get VAR={"id":"param_a"}
    B -> variables_get VAR={"id":"param_b"}

## PDiv（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"b","id":"param_b","type":"int_list"}],"hasStatements":false} NAME="PDiv"
  RETURN -> gf2_poly_div
    A -> variables_get VAR={"id":"param_a"}
    B -> variables_get VAR={"id":"param_b"}

## PMod（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"b","id":"param_b","type":"int_list"}],"hasStatements":false} NAME="PMod"
  RETURN -> gf2_poly_mod
    A -> variables_get VAR={"id":"param_a"}
    B -> variables_get VAR={"id":"param_b"}

## PGcd（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"b","id":"param_b","type":"int_list"}],"hasStatements":false} NAME="PGcd"
  RETURN -> gf2_poly_gcd
    A -> variables_get VAR={"id":"param_a"}
    B -> variables_get VAR={"id":"param_b"}

## MMul（5 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"b","id":"param_b","type":"int_list"},{"name":"n","id":"param_n","type":"int"}],"hasStatements":false} NAME="MMul"
  RETURN -> bin_mat_mul
    A -> variables_get VAR={"id":"param_a"}
    B -> variables_get VAR={"id":"param_b"}
    N -> variables_get VAR={"id":"param_n"}

## MInv（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"param_a","type":"int_list"},{"name":"n","id":"param_n","type":"int"}],"hasStatements":false} NAME="MInv"
  RETURN -> bin_mat_inv
    A -> variables_get VAR={"id":"param_a"}
    N -> variables_get VAR={"id":"param_n"}

## HW（3 块）
procedures_defreturn extraState={"params":[{"name":"x","id":"param_x","type":"int_list"}],"hasStatements":false} NAME="HW"
  RETURN -> ham_weight
    X -> variables_get VAR={"id":"param_x"}

## HD（4 块）
procedures_defreturn extraState={"params":[{"name":"x","id":"param_x","type":"int_list"},{"name":"y","id":"param_y","type":"int_list"}],"hasStatements":false} NAME="HD"
  RETURN -> ham_dist
    X -> variables_get VAR={"id":"param_x"}
    Y -> variables_get VAR={"id":"param_y"}

## FLI（4 块）
procedures_defreturn extraState={"params":[{"name":"m","id":"tidx_param_m","type":"bytes"},{"name":"i","id":"tidx_param_i","type":"int"}],"hasStatements":false} NAME="FLI"
  RETURN -> fors_leaf_index
    M -> variables_get VAR={"id":"tidx_param_m"}
    I -> variables_get VAR={"id":"tidx_param_i"}

## AP（6 块）
procedures_defreturn extraState={"params":[{"name":"leaves","id":"tidx_param_leaves","type":"bytes"},{"name":"leaf_len","id":"tidx_param_leaf_len","type":"int"},{"name":"adrs","id":"tidx_param_adrs","type":"bytes"},{"name":"idx","id":"tidx_param_idx","type":"int"}],"hasStatements":false} NAME="AP"
  RETURN -> merkle_auth_path
    LEAVES -> variables_get VAR={"id":"tidx_param_leaves"}
    LEAF_LEN -> variables_get VAR={"id":"tidx_param_leaf_len"}
    ADRS -> variables_get VAR={"id":"tidx_param_adrs"}
    INDEX -> variables_get VAR={"id":"tidx_param_idx"}

## MR（5 块）
procedures_defreturn extraState={"params":[{"name":"leaves","id":"tidx_param_leaves","type":"bytes"},{"name":"leaf_len","id":"tidx_param_leaf_len","type":"int"},{"name":"adrs","id":"tidx_param_adrs","type":"bytes"}],"hasStatements":false} NAME="MR"
  RETURN -> merkle_root
    LEAVES -> variables_get VAR={"id":"tidx_param_leaves"}
    LEAF_LEN -> variables_get VAR={"id":"tidx_param_leaf_len"}
    ADRS -> variables_get VAR={"id":"tidx_param_adrs"}

## MN（5 块）
procedures_defreturn extraState={"params":[{"name":"l","id":"tidx_param_l","type":"bytes"},{"name":"r","id":"tidx_param_r","type":"bytes"},{"name":"adrs","id":"tidx_param_adrs","type":"bytes"}],"hasStatements":false} NAME="MN"
  RETURN -> merkle_node
    LEFT -> variables_get VAR={"id":"tidx_param_l"}
    RIGHT -> variables_get VAR={"id":"tidx_param_r"}
    ADRS -> variables_get VAR={"id":"tidx_param_adrs"}

## Addr（5 块）
procedures_defreturn extraState={"params":[{"name":"layer","id":"tidx_param_layer","type":"int"},{"name":"tree","id":"tidx_param_tree","type":"int"},{"name":"leaf","id":"tidx_param_leaf","type":"int"}],"hasStatements":false} NAME="Addr"
  RETURN -> slh_addr TYPE="0"
    LAYER -> variables_get VAR={"id":"tidx_param_layer"}
    TREE -> variables_get VAR={"id":"tidx_param_tree"}
    LEAF -> variables_get VAR={"id":"tidx_param_leaf"}

## P2R_High（3 块）
procedures_defreturn extraState={"params":[{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="P2R_High"
  RETURN -> pq_power2round PART="r1"
    INPUT -> variables_get VAR={"id":"param_r"}

## P2R_Low（3 块）
procedures_defreturn extraState={"params":[{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="P2R_Low"
  RETURN -> pq_power2round PART="r0"
    INPUT -> variables_get VAR={"id":"param_r"}

## Dec_High（3 块）
procedures_defreturn extraState={"params":[{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="Dec_High"
  RETURN -> pq_decompose PART="r1"
    INPUT -> variables_get VAR={"id":"param_r"}

## Dec_Low（3 块）
procedures_defreturn extraState={"params":[{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="Dec_Low"
  RETURN -> pq_decompose PART="r0"
    INPUT -> variables_get VAR={"id":"param_r"}

## Make_Hint（4 块）
procedures_defreturn extraState={"params":[{"name":"z","id":"param_z","type":"int_list"},{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="Make_Hint"
  RETURN -> pq_make_hint
    Z -> variables_get VAR={"id":"param_z"}
    R -> variables_get VAR={"id":"param_r"}

## Use_Hint（4 块）
procedures_defreturn extraState={"params":[{"name":"h","id":"param_h","type":"int_list"},{"name":"r","id":"param_r","type":"int_list"}],"hasStatements":false} NAME="Use_Hint"
  RETURN -> pq_use_hint
    H -> variables_get VAR={"id":"param_h"}
    R -> variables_get VAR={"id":"param_r"}

## In_Ball（3 块）
procedures_defreturn extraState={"params":[{"name":"seed","id":"param_seed","type":"bytes"}],"hasStatements":false} NAME="In_Ball"
  RETURN -> pq_sample_in_ball
    SEED -> variables_get VAR={"id":"param_seed"}

## GA（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gf2m_param_a","type":"int_list"},{"name":"b","id":"gf2m_param_b","type":"int_list"}],"hasStatements":false} NAME="GA"
  RETURN -> gf2m_poly_add
    A -> variables_get VAR={"id":"gf2m_param_a"}
    B -> variables_get VAR={"id":"gf2m_param_b"}

## GM（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gf2m_param_a","type":"int_list"},{"name":"b","id":"gf2m_param_b","type":"int_list"}],"hasStatements":false} NAME="GM"
  RETURN -> gf2m_poly_mul
    A -> variables_get VAR={"id":"gf2m_param_a"}
    B -> variables_get VAR={"id":"gf2m_param_b"}

## GMod（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gf2m_param_a","type":"int_list"},{"name":"b","id":"gf2m_param_b","type":"int_list"}],"hasStatements":false} NAME="GMod"
  RETURN -> gf2m_poly_mod
    A -> variables_get VAR={"id":"gf2m_param_a"}
    B -> variables_get VAR={"id":"gf2m_param_b"}

## GXGcd（4 块）
procedures_defreturn extraState={"params":[{"name":"a","id":"gf2m_param_a","type":"int_list"},{"name":"b","id":"gf2m_param_b","type":"int_list"}],"hasStatements":false} NAME="GXGcd"
  RETURN -> gf2m_poly_xgcd
    A -> variables_get VAR={"id":"gf2m_param_a"}
    B -> variables_get VAR={"id":"gf2m_param_b"}

## GEval（4 块）
procedures_defreturn extraState={"params":[{"name":"p","id":"gf2m_param_p","type":"int_list"},{"name":"x","id":"gf2m_param_x","type":"int"}],"hasStatements":false} NAME="GEval"
  RETURN -> gf2m_poly_eval
    P -> variables_get VAR={"id":"gf2m_param_p"}
    X -> variables_get VAR={"id":"gf2m_param_x"}

## GP（3 块）
procedures_defreturn extraState={"params":[{"name":"alphas","id":"gf2m_param_alphas","type":"int_list"}],"hasStatements":false} NAME="GP"
  RETURN -> goppa_gen_poly
    ALPHA -> variables_get VAR={"id":"gf2m_param_alphas"}

