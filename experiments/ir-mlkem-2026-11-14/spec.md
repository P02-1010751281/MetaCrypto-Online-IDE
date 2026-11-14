# 复现任务规格（格式中立）

每个 `槽名 -> 类型 字段="值"` 行是一个块；**缩进严格等于嵌套层数**（输入槽里的块比父块多一层）。
语句链（`next`）用**与语句同缩进**的 `then: ` 前缀表示：该行是上一条同缩进语句的后继块，不增加嵌套层数。
本文件不含 id、坐标、`{"block": …}` 包装——这些由你在目标格式里自行补。

## ML_KEM_Encaps（1494 块，28 条语句）
procedures_defreturn extraState={"params":[{"name":"ek","id":"ek","type":"bytes"},{"name":"m","id":"m","type":"bytes"}],"hasStatements":true} NAME="ML_KEM_Encaps"
  STACK -> variables_set VAR={"id":"v_H","name":"H"}
    VALUE -> sponge_squeeze RATE="1088"
      STATE -> sponge_absorb RATE="1088"
        STATE -> keccak_state_init
        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
      OUTLEN -> data_value NUM="32"
  then: variables_set VAR={"id":"v_G","name":"G"}
    VALUE -> sponge_squeeze RATE="576"
      STATE -> sponge_absorb RATE="576"
        STATE -> keccak_state_init
        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
          INPUT -> pq_byte_concat
            A -> variables_get VAR={"id":"m","name":"m"}
            B -> sponge_squeeze RATE="1088"
              STATE -> sponge_absorb RATE="1088"
                STATE -> keccak_state_init
                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
              OUTLEN -> data_value NUM="32"
      OUTLEN -> data_value NUM="64"
  then: variables_set VAR={"id":"v_Kp","name":"Kp"}
    VALUE -> pq_bytes_slice
      INPUT -> sponge_squeeze RATE="576"
        STATE -> sponge_absorb RATE="576"
          STATE -> keccak_state_init
          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
            INPUT -> pq_byte_concat
              A -> variables_get VAR={"id":"m","name":"m"}
              B -> sponge_squeeze RATE="1088"
                STATE -> sponge_absorb RATE="1088"
                  STATE -> keccak_state_init
                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                OUTLEN -> data_value NUM="32"
        OUTLEN -> data_value NUM="64"
      START -> data_value NUM="0"
      END -> data_value NUM="32"
  then: variables_set VAR={"id":"v_r","name":"r"}
    VALUE -> pq_bytes_slice
      INPUT -> sponge_squeeze RATE="576"
        STATE -> sponge_absorb RATE="576"
          STATE -> keccak_state_init
          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
            INPUT -> pq_byte_concat
              A -> variables_get VAR={"id":"m","name":"m"}
              B -> sponge_squeeze RATE="1088"
                STATE -> sponge_absorb RATE="1088"
                  STATE -> keccak_state_init
                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                OUTLEN -> data_value NUM="32"
        OUTLEN -> data_value NUM="64"
      START -> data_value NUM="32"
      END -> data_value NUM="64"
  then: variables_set VAR={"id":"v_rho","name":"rho"}
    VALUE -> pq_bytes_slice
      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
      START -> data_value NUM="768"
      END -> data_value NUM="800"
  then: variables_set VAR={"id":"v_t0","name":"t0"}
    VALUE -> pq_byte_decode BITS="12"
      INPUT -> pq_bytes_slice
        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
        START -> data_value NUM="0"
        END -> data_value NUM="384"
  then: variables_set VAR={"id":"v_t1","name":"t1"}
    VALUE -> pq_byte_decode BITS="12"
      INPUT -> pq_bytes_slice
        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
        START -> data_value NUM="384"
        END -> data_value NUM="768"
  then: variables_set VAR={"id":"v_A00","name":"A00"}
    VALUE -> pq_sample_ntt MODULUS="3329"
      SEED -> pq_seed_with_nonce
        SEED -> pq_seed_with_nonce
          SEED -> pq_bytes_slice
            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
            START -> data_value NUM="768"
            END -> data_value NUM="800"
          NONCE -> data_value NUM="0"
        NONCE -> data_value NUM="0"
  then: variables_set VAR={"id":"v_A01","name":"A01"}
    VALUE -> pq_sample_ntt MODULUS="3329"
      SEED -> pq_seed_with_nonce
        SEED -> pq_seed_with_nonce
          SEED -> pq_bytes_slice
            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
            START -> data_value NUM="768"
            END -> data_value NUM="800"
          NONCE -> data_value NUM="1"
        NONCE -> data_value NUM="0"
  then: variables_set VAR={"id":"v_A10","name":"A10"}
    VALUE -> pq_sample_ntt MODULUS="3329"
      SEED -> pq_seed_with_nonce
        SEED -> pq_seed_with_nonce
          SEED -> pq_bytes_slice
            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
            START -> data_value NUM="768"
            END -> data_value NUM="800"
          NONCE -> data_value NUM="0"
        NONCE -> data_value NUM="1"
  then: variables_set VAR={"id":"v_A11","name":"A11"}
    VALUE -> pq_sample_ntt MODULUS="3329"
      SEED -> pq_seed_with_nonce
        SEED -> pq_seed_with_nonce
          SEED -> pq_bytes_slice
            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
            START -> data_value NUM="768"
            END -> data_value NUM="800"
          NONCE -> data_value NUM="1"
        NONCE -> data_value NUM="1"
  then: variables_set VAR={"id":"v_s0","name":"s0"}
    VALUE -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
      SEED -> pq_prf ALGO="SHAKE256"
        SEED -> pq_bytes_slice
          INPUT -> sponge_squeeze RATE="576"
            STATE -> sponge_absorb RATE="576"
              STATE -> keccak_state_init
              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                INPUT -> pq_byte_concat
                  A -> variables_get VAR={"id":"m","name":"m"}
                  B -> sponge_squeeze RATE="1088"
                    STATE -> sponge_absorb RATE="1088"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    OUTLEN -> data_value NUM="32"
            OUTLEN -> data_value NUM="64"
          START -> data_value NUM="32"
          END -> data_value NUM="64"
        NONCE -> data_value NUM="0"
        OUTLEN -> data_value NUM="192"
  then: variables_set VAR={"id":"v_s1","name":"s1"}
    VALUE -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
      SEED -> pq_prf ALGO="SHAKE256"
        SEED -> pq_bytes_slice
          INPUT -> sponge_squeeze RATE="576"
            STATE -> sponge_absorb RATE="576"
              STATE -> keccak_state_init
              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                INPUT -> pq_byte_concat
                  A -> variables_get VAR={"id":"m","name":"m"}
                  B -> sponge_squeeze RATE="1088"
                    STATE -> sponge_absorb RATE="1088"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    OUTLEN -> data_value NUM="32"
            OUTLEN -> data_value NUM="64"
          START -> data_value NUM="32"
          END -> data_value NUM="64"
        NONCE -> data_value NUM="1"
        OUTLEN -> data_value NUM="192"
  then: variables_set VAR={"id":"v_e1_0","name":"e1_0"}
    VALUE -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
      SEED -> pq_prf ALGO="SHAKE256"
        SEED -> pq_bytes_slice
          INPUT -> sponge_squeeze RATE="576"
            STATE -> sponge_absorb RATE="576"
              STATE -> keccak_state_init
              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                INPUT -> pq_byte_concat
                  A -> variables_get VAR={"id":"m","name":"m"}
                  B -> sponge_squeeze RATE="1088"
                    STATE -> sponge_absorb RATE="1088"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    OUTLEN -> data_value NUM="32"
            OUTLEN -> data_value NUM="64"
          START -> data_value NUM="32"
          END -> data_value NUM="64"
        NONCE -> data_value NUM="2"
        OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_e1_1","name":"e1_1"}
    VALUE -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
      SEED -> pq_prf ALGO="SHAKE256"
        SEED -> pq_bytes_slice
          INPUT -> sponge_squeeze RATE="576"
            STATE -> sponge_absorb RATE="576"
              STATE -> keccak_state_init
              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                INPUT -> pq_byte_concat
                  A -> variables_get VAR={"id":"m","name":"m"}
                  B -> sponge_squeeze RATE="1088"
                    STATE -> sponge_absorb RATE="1088"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    OUTLEN -> data_value NUM="32"
            OUTLEN -> data_value NUM="64"
          START -> data_value NUM="32"
          END -> data_value NUM="64"
        NONCE -> data_value NUM="3"
        OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_e2","name":"e2"}
    VALUE -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
      SEED -> pq_prf ALGO="SHAKE256"
        SEED -> pq_bytes_slice
          INPUT -> sponge_squeeze RATE="576"
            STATE -> sponge_absorb RATE="576"
              STATE -> keccak_state_init
              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                INPUT -> pq_byte_concat
                  A -> variables_get VAR={"id":"m","name":"m"}
                  B -> sponge_squeeze RATE="1088"
                    STATE -> sponge_absorb RATE="1088"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    OUTLEN -> data_value NUM="32"
            OUTLEN -> data_value NUM="64"
          START -> data_value NUM="32"
          END -> data_value NUM="64"
        NONCE -> data_value NUM="4"
        OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_sh0","name":"sh0"}
    VALUE -> pq_ntt MODULUS="3329" DEGREE="256"
      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
        SEED -> pq_prf ALGO="SHAKE256"
          SEED -> pq_bytes_slice
            INPUT -> sponge_squeeze RATE="576"
              STATE -> sponge_absorb RATE="576"
                STATE -> keccak_state_init
                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                  INPUT -> pq_byte_concat
                    A -> variables_get VAR={"id":"m","name":"m"}
                    B -> sponge_squeeze RATE="1088"
                      STATE -> sponge_absorb RATE="1088"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      OUTLEN -> data_value NUM="32"
              OUTLEN -> data_value NUM="64"
            START -> data_value NUM="32"
            END -> data_value NUM="64"
          NONCE -> data_value NUM="0"
          OUTLEN -> data_value NUM="192"
  then: variables_set VAR={"id":"v_sh1","name":"sh1"}
    VALUE -> pq_ntt MODULUS="3329" DEGREE="256"
      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
        SEED -> pq_prf ALGO="SHAKE256"
          SEED -> pq_bytes_slice
            INPUT -> sponge_squeeze RATE="576"
              STATE -> sponge_absorb RATE="576"
                STATE -> keccak_state_init
                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                  INPUT -> pq_byte_concat
                    A -> variables_get VAR={"id":"m","name":"m"}
                    B -> sponge_squeeze RATE="1088"
                      STATE -> sponge_absorb RATE="1088"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      OUTLEN -> data_value NUM="32"
              OUTLEN -> data_value NUM="64"
            START -> data_value NUM="32"
            END -> data_value NUM="64"
          NONCE -> data_value NUM="1"
          OUTLEN -> data_value NUM="192"
  then: variables_set VAR={"id":"v_u0","name":"u0"}
    VALUE -> pq_poly_add
      A -> pq_intt MODULUS="3329" DEGREE="256"
        INPUT -> pq_poly_add
          A -> pq_ntt_mul MODULUS="3329"
            A -> pq_sample_ntt MODULUS="3329"
              SEED -> pq_seed_with_nonce
                SEED -> pq_seed_with_nonce
                  SEED -> pq_bytes_slice
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    START -> data_value NUM="768"
                    END -> data_value NUM="800"
                  NONCE -> data_value NUM="0"
                NONCE -> data_value NUM="0"
            B -> pq_ntt MODULUS="3329" DEGREE="256"
              INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="0"
                  OUTLEN -> data_value NUM="192"
          B -> pq_ntt_mul MODULUS="3329"
            A -> pq_sample_ntt MODULUS="3329"
              SEED -> pq_seed_with_nonce
                SEED -> pq_seed_with_nonce
                  SEED -> pq_bytes_slice
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    START -> data_value NUM="768"
                    END -> data_value NUM="800"
                  NONCE -> data_value NUM="0"
                NONCE -> data_value NUM="1"
            B -> pq_ntt MODULUS="3329" DEGREE="256"
              INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="1"
                  OUTLEN -> data_value NUM="192"
      B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
        SEED -> pq_prf ALGO="SHAKE256"
          SEED -> pq_bytes_slice
            INPUT -> sponge_squeeze RATE="576"
              STATE -> sponge_absorb RATE="576"
                STATE -> keccak_state_init
                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                  INPUT -> pq_byte_concat
                    A -> variables_get VAR={"id":"m","name":"m"}
                    B -> sponge_squeeze RATE="1088"
                      STATE -> sponge_absorb RATE="1088"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      OUTLEN -> data_value NUM="32"
              OUTLEN -> data_value NUM="64"
            START -> data_value NUM="32"
            END -> data_value NUM="64"
          NONCE -> data_value NUM="2"
          OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_u1","name":"u1"}
    VALUE -> pq_poly_add
      A -> pq_intt MODULUS="3329" DEGREE="256"
        INPUT -> pq_poly_add
          A -> pq_ntt_mul MODULUS="3329"
            A -> pq_sample_ntt MODULUS="3329"
              SEED -> pq_seed_with_nonce
                SEED -> pq_seed_with_nonce
                  SEED -> pq_bytes_slice
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    START -> data_value NUM="768"
                    END -> data_value NUM="800"
                  NONCE -> data_value NUM="1"
                NONCE -> data_value NUM="0"
            B -> pq_ntt MODULUS="3329" DEGREE="256"
              INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="0"
                  OUTLEN -> data_value NUM="192"
          B -> pq_ntt_mul MODULUS="3329"
            A -> pq_sample_ntt MODULUS="3329"
              SEED -> pq_seed_with_nonce
                SEED -> pq_seed_with_nonce
                  SEED -> pq_bytes_slice
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    START -> data_value NUM="768"
                    END -> data_value NUM="800"
                  NONCE -> data_value NUM="1"
                NONCE -> data_value NUM="1"
            B -> pq_ntt MODULUS="3329" DEGREE="256"
              INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="1"
                  OUTLEN -> data_value NUM="192"
      B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
        SEED -> pq_prf ALGO="SHAKE256"
          SEED -> pq_bytes_slice
            INPUT -> sponge_squeeze RATE="576"
              STATE -> sponge_absorb RATE="576"
                STATE -> keccak_state_init
                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                  INPUT -> pq_byte_concat
                    A -> variables_get VAR={"id":"m","name":"m"}
                    B -> sponge_squeeze RATE="1088"
                      STATE -> sponge_absorb RATE="1088"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      OUTLEN -> data_value NUM="32"
              OUTLEN -> data_value NUM="64"
            START -> data_value NUM="32"
            END -> data_value NUM="64"
          NONCE -> data_value NUM="3"
          OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_v","name":"v"}
    VALUE -> pq_poly_add
      A -> pq_poly_add
        A -> pq_intt MODULUS="3329" DEGREE="256"
          INPUT -> pq_poly_add
            A -> pq_ntt_mul MODULUS="3329"
              A -> pq_byte_decode BITS="12"
                INPUT -> pq_bytes_slice
                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                  START -> data_value NUM="0"
                  END -> data_value NUM="384"
              B -> pq_ntt MODULUS="3329" DEGREE="256"
                INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                  SEED -> pq_prf ALGO="SHAKE256"
                    SEED -> pq_bytes_slice
                      INPUT -> sponge_squeeze RATE="576"
                        STATE -> sponge_absorb RATE="576"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                            INPUT -> pq_byte_concat
                              A -> variables_get VAR={"id":"m","name":"m"}
                              B -> sponge_squeeze RATE="1088"
                                STATE -> sponge_absorb RATE="1088"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                OUTLEN -> data_value NUM="32"
                        OUTLEN -> data_value NUM="64"
                      START -> data_value NUM="32"
                      END -> data_value NUM="64"
                    NONCE -> data_value NUM="0"
                    OUTLEN -> data_value NUM="192"
            B -> pq_ntt_mul MODULUS="3329"
              A -> pq_byte_decode BITS="12"
                INPUT -> pq_bytes_slice
                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                  START -> data_value NUM="384"
                  END -> data_value NUM="768"
              B -> pq_ntt MODULUS="3329" DEGREE="256"
                INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                  SEED -> pq_prf ALGO="SHAKE256"
                    SEED -> pq_bytes_slice
                      INPUT -> sponge_squeeze RATE="576"
                        STATE -> sponge_absorb RATE="576"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                            INPUT -> pq_byte_concat
                              A -> variables_get VAR={"id":"m","name":"m"}
                              B -> sponge_squeeze RATE="1088"
                                STATE -> sponge_absorb RATE="1088"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                OUTLEN -> data_value NUM="32"
                        OUTLEN -> data_value NUM="64"
                      START -> data_value NUM="32"
                      END -> data_value NUM="64"
                    NONCE -> data_value NUM="1"
                    OUTLEN -> data_value NUM="192"
        B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
          SEED -> pq_prf ALGO="SHAKE256"
            SEED -> pq_bytes_slice
              INPUT -> sponge_squeeze RATE="576"
                STATE -> sponge_absorb RATE="576"
                  STATE -> keccak_state_init
                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                    INPUT -> pq_byte_concat
                      A -> variables_get VAR={"id":"m","name":"m"}
                      B -> sponge_squeeze RATE="1088"
                        STATE -> sponge_absorb RATE="1088"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        OUTLEN -> data_value NUM="32"
                OUTLEN -> data_value NUM="64"
              START -> data_value NUM="32"
              END -> data_value NUM="64"
            NONCE -> data_value NUM="4"
            OUTLEN -> data_value NUM="128"
      B -> pq_decompress BITS="1" MODULUS="3329"
        INPUT -> pq_byte_decode BITS="1"
          INPUT -> variables_get VAR={"id":"m","name":"m"}
  then: variables_set VAR={"id":"v_mu","name":"mu"}
    VALUE -> pq_decompress BITS="1" MODULUS="3329"
      INPUT -> pq_byte_decode BITS="1"
        INPUT -> variables_get VAR={"id":"m","name":"m"}
  then: variables_set VAR={"id":"v_c1a","name":"c1a"}
    VALUE -> pq_byte_encode BITS="10"
      INPUT -> pq_compress BITS="10" MODULUS="3329"
        INPUT -> pq_poly_add
          A -> pq_intt MODULUS="3329" DEGREE="256"
            INPUT -> pq_poly_add
              A -> pq_ntt_mul MODULUS="3329"
                A -> pq_sample_ntt MODULUS="3329"
                  SEED -> pq_seed_with_nonce
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="768"
                        END -> data_value NUM="800"
                      NONCE -> data_value NUM="0"
                    NONCE -> data_value NUM="0"
                B -> pq_ntt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                    SEED -> pq_prf ALGO="SHAKE256"
                      SEED -> pq_bytes_slice
                        INPUT -> sponge_squeeze RATE="576"
                          STATE -> sponge_absorb RATE="576"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                              INPUT -> pq_byte_concat
                                A -> variables_get VAR={"id":"m","name":"m"}
                                B -> sponge_squeeze RATE="1088"
                                  STATE -> sponge_absorb RATE="1088"
                                    STATE -> keccak_state_init
                                    BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                  OUTLEN -> data_value NUM="32"
                          OUTLEN -> data_value NUM="64"
                        START -> data_value NUM="32"
                        END -> data_value NUM="64"
                      NONCE -> data_value NUM="0"
                      OUTLEN -> data_value NUM="192"
              B -> pq_ntt_mul MODULUS="3329"
                A -> pq_sample_ntt MODULUS="3329"
                  SEED -> pq_seed_with_nonce
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="768"
                        END -> data_value NUM="800"
                      NONCE -> data_value NUM="0"
                    NONCE -> data_value NUM="1"
                B -> pq_ntt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                    SEED -> pq_prf ALGO="SHAKE256"
                      SEED -> pq_bytes_slice
                        INPUT -> sponge_squeeze RATE="576"
                          STATE -> sponge_absorb RATE="576"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                              INPUT -> pq_byte_concat
                                A -> variables_get VAR={"id":"m","name":"m"}
                                B -> sponge_squeeze RATE="1088"
                                  STATE -> sponge_absorb RATE="1088"
                                    STATE -> keccak_state_init
                                    BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                  OUTLEN -> data_value NUM="32"
                          OUTLEN -> data_value NUM="64"
                        START -> data_value NUM="32"
                        END -> data_value NUM="64"
                      NONCE -> data_value NUM="1"
                      OUTLEN -> data_value NUM="192"
          B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
            SEED -> pq_prf ALGO="SHAKE256"
              SEED -> pq_bytes_slice
                INPUT -> sponge_squeeze RATE="576"
                  STATE -> sponge_absorb RATE="576"
                    STATE -> keccak_state_init
                    BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                      INPUT -> pq_byte_concat
                        A -> variables_get VAR={"id":"m","name":"m"}
                        B -> sponge_squeeze RATE="1088"
                          STATE -> sponge_absorb RATE="1088"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          OUTLEN -> data_value NUM="32"
                  OUTLEN -> data_value NUM="64"
                START -> data_value NUM="32"
                END -> data_value NUM="64"
              NONCE -> data_value NUM="2"
              OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_c1b","name":"c1b"}
    VALUE -> pq_byte_encode BITS="10"
      INPUT -> pq_compress BITS="10" MODULUS="3329"
        INPUT -> pq_poly_add
          A -> pq_intt MODULUS="3329" DEGREE="256"
            INPUT -> pq_poly_add
              A -> pq_ntt_mul MODULUS="3329"
                A -> pq_sample_ntt MODULUS="3329"
                  SEED -> pq_seed_with_nonce
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="768"
                        END -> data_value NUM="800"
                      NONCE -> data_value NUM="1"
                    NONCE -> data_value NUM="0"
                B -> pq_ntt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                    SEED -> pq_prf ALGO="SHAKE256"
                      SEED -> pq_bytes_slice
                        INPUT -> sponge_squeeze RATE="576"
                          STATE -> sponge_absorb RATE="576"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                              INPUT -> pq_byte_concat
                                A -> variables_get VAR={"id":"m","name":"m"}
                                B -> sponge_squeeze RATE="1088"
                                  STATE -> sponge_absorb RATE="1088"
                                    STATE -> keccak_state_init
                                    BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                  OUTLEN -> data_value NUM="32"
                          OUTLEN -> data_value NUM="64"
                        START -> data_value NUM="32"
                        END -> data_value NUM="64"
                      NONCE -> data_value NUM="0"
                      OUTLEN -> data_value NUM="192"
              B -> pq_ntt_mul MODULUS="3329"
                A -> pq_sample_ntt MODULUS="3329"
                  SEED -> pq_seed_with_nonce
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="768"
                        END -> data_value NUM="800"
                      NONCE -> data_value NUM="1"
                    NONCE -> data_value NUM="1"
                B -> pq_ntt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                    SEED -> pq_prf ALGO="SHAKE256"
                      SEED -> pq_bytes_slice
                        INPUT -> sponge_squeeze RATE="576"
                          STATE -> sponge_absorb RATE="576"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                              INPUT -> pq_byte_concat
                                A -> variables_get VAR={"id":"m","name":"m"}
                                B -> sponge_squeeze RATE="1088"
                                  STATE -> sponge_absorb RATE="1088"
                                    STATE -> keccak_state_init
                                    BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                  OUTLEN -> data_value NUM="32"
                          OUTLEN -> data_value NUM="64"
                        START -> data_value NUM="32"
                        END -> data_value NUM="64"
                      NONCE -> data_value NUM="1"
                      OUTLEN -> data_value NUM="192"
          B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
            SEED -> pq_prf ALGO="SHAKE256"
              SEED -> pq_bytes_slice
                INPUT -> sponge_squeeze RATE="576"
                  STATE -> sponge_absorb RATE="576"
                    STATE -> keccak_state_init
                    BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                      INPUT -> pq_byte_concat
                        A -> variables_get VAR={"id":"m","name":"m"}
                        B -> sponge_squeeze RATE="1088"
                          STATE -> sponge_absorb RATE="1088"
                            STATE -> keccak_state_init
                            BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          OUTLEN -> data_value NUM="32"
                  OUTLEN -> data_value NUM="64"
                START -> data_value NUM="32"
                END -> data_value NUM="64"
              NONCE -> data_value NUM="3"
              OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_c1","name":"c1"}
    VALUE -> pq_byte_concat
      A -> pq_byte_encode BITS="10"
        INPUT -> pq_compress BITS="10" MODULUS="3329"
          INPUT -> pq_poly_add
            A -> pq_intt MODULUS="3329" DEGREE="256"
              INPUT -> pq_poly_add
                A -> pq_ntt_mul MODULUS="3329"
                  A -> pq_sample_ntt MODULUS="3329"
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="768"
                          END -> data_value NUM="800"
                        NONCE -> data_value NUM="0"
                      NONCE -> data_value NUM="0"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="0"
                        OUTLEN -> data_value NUM="192"
                B -> pq_ntt_mul MODULUS="3329"
                  A -> pq_sample_ntt MODULUS="3329"
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="768"
                          END -> data_value NUM="800"
                        NONCE -> data_value NUM="0"
                      NONCE -> data_value NUM="1"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="1"
                        OUTLEN -> data_value NUM="192"
            B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
              SEED -> pq_prf ALGO="SHAKE256"
                SEED -> pq_bytes_slice
                  INPUT -> sponge_squeeze RATE="576"
                    STATE -> sponge_absorb RATE="576"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                        INPUT -> pq_byte_concat
                          A -> variables_get VAR={"id":"m","name":"m"}
                          B -> sponge_squeeze RATE="1088"
                            STATE -> sponge_absorb RATE="1088"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            OUTLEN -> data_value NUM="32"
                    OUTLEN -> data_value NUM="64"
                  START -> data_value NUM="32"
                  END -> data_value NUM="64"
                NONCE -> data_value NUM="2"
                OUTLEN -> data_value NUM="128"
      B -> pq_byte_encode BITS="10"
        INPUT -> pq_compress BITS="10" MODULUS="3329"
          INPUT -> pq_poly_add
            A -> pq_intt MODULUS="3329" DEGREE="256"
              INPUT -> pq_poly_add
                A -> pq_ntt_mul MODULUS="3329"
                  A -> pq_sample_ntt MODULUS="3329"
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="768"
                          END -> data_value NUM="800"
                        NONCE -> data_value NUM="1"
                      NONCE -> data_value NUM="0"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="0"
                        OUTLEN -> data_value NUM="192"
                B -> pq_ntt_mul MODULUS="3329"
                  A -> pq_sample_ntt MODULUS="3329"
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="768"
                          END -> data_value NUM="800"
                        NONCE -> data_value NUM="1"
                      NONCE -> data_value NUM="1"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="1"
                        OUTLEN -> data_value NUM="192"
            B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
              SEED -> pq_prf ALGO="SHAKE256"
                SEED -> pq_bytes_slice
                  INPUT -> sponge_squeeze RATE="576"
                    STATE -> sponge_absorb RATE="576"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                        INPUT -> pq_byte_concat
                          A -> variables_get VAR={"id":"m","name":"m"}
                          B -> sponge_squeeze RATE="1088"
                            STATE -> sponge_absorb RATE="1088"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            OUTLEN -> data_value NUM="32"
                    OUTLEN -> data_value NUM="64"
                  START -> data_value NUM="32"
                  END -> data_value NUM="64"
                NONCE -> data_value NUM="3"
                OUTLEN -> data_value NUM="128"
  then: variables_set VAR={"id":"v_c2","name":"c2"}
    VALUE -> pq_byte_encode BITS="4"
      INPUT -> pq_compress BITS="4" MODULUS="3329"
        INPUT -> pq_poly_add
          A -> pq_poly_add
            A -> pq_intt MODULUS="3329" DEGREE="256"
              INPUT -> pq_poly_add
                A -> pq_ntt_mul MODULUS="3329"
                  A -> pq_byte_decode BITS="12"
                    INPUT -> pq_bytes_slice
                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      START -> data_value NUM="0"
                      END -> data_value NUM="384"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="0"
                        OUTLEN -> data_value NUM="192"
                B -> pq_ntt_mul MODULUS="3329"
                  A -> pq_byte_decode BITS="12"
                    INPUT -> pq_bytes_slice
                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                      START -> data_value NUM="384"
                      END -> data_value NUM="768"
                  B -> pq_ntt MODULUS="3329" DEGREE="256"
                    INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                      SEED -> pq_prf ALGO="SHAKE256"
                        SEED -> pq_bytes_slice
                          INPUT -> sponge_squeeze RATE="576"
                            STATE -> sponge_absorb RATE="576"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                INPUT -> pq_byte_concat
                                  A -> variables_get VAR={"id":"m","name":"m"}
                                  B -> sponge_squeeze RATE="1088"
                                    STATE -> sponge_absorb RATE="1088"
                                      STATE -> keccak_state_init
                                      BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                    OUTLEN -> data_value NUM="32"
                            OUTLEN -> data_value NUM="64"
                          START -> data_value NUM="32"
                          END -> data_value NUM="64"
                        NONCE -> data_value NUM="1"
                        OUTLEN -> data_value NUM="192"
            B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
              SEED -> pq_prf ALGO="SHAKE256"
                SEED -> pq_bytes_slice
                  INPUT -> sponge_squeeze RATE="576"
                    STATE -> sponge_absorb RATE="576"
                      STATE -> keccak_state_init
                      BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                        INPUT -> pq_byte_concat
                          A -> variables_get VAR={"id":"m","name":"m"}
                          B -> sponge_squeeze RATE="1088"
                            STATE -> sponge_absorb RATE="1088"
                              STATE -> keccak_state_init
                              BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            OUTLEN -> data_value NUM="32"
                    OUTLEN -> data_value NUM="64"
                  START -> data_value NUM="32"
                  END -> data_value NUM="64"
                NONCE -> data_value NUM="4"
                OUTLEN -> data_value NUM="128"
          B -> pq_decompress BITS="1" MODULUS="3329"
            INPUT -> pq_byte_decode BITS="1"
              INPUT -> variables_get VAR={"id":"m","name":"m"}
  then: variables_set VAR={"id":"v_c","name":"c"}
    VALUE -> pq_byte_concat
      A -> pq_byte_concat
        A -> pq_byte_encode BITS="10"
          INPUT -> pq_compress BITS="10" MODULUS="3329"
            INPUT -> pq_poly_add
              A -> pq_intt MODULUS="3329" DEGREE="256"
                INPUT -> pq_poly_add
                  A -> pq_ntt_mul MODULUS="3329"
                    A -> pq_sample_ntt MODULUS="3329"
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_bytes_slice
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            START -> data_value NUM="768"
                            END -> data_value NUM="800"
                          NONCE -> data_value NUM="0"
                        NONCE -> data_value NUM="0"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="0"
                          OUTLEN -> data_value NUM="192"
                  B -> pq_ntt_mul MODULUS="3329"
                    A -> pq_sample_ntt MODULUS="3329"
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_bytes_slice
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            START -> data_value NUM="768"
                            END -> data_value NUM="800"
                          NONCE -> data_value NUM="0"
                        NONCE -> data_value NUM="1"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="1"
                          OUTLEN -> data_value NUM="192"
              B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="2"
                  OUTLEN -> data_value NUM="128"
        B -> pq_byte_encode BITS="10"
          INPUT -> pq_compress BITS="10" MODULUS="3329"
            INPUT -> pq_poly_add
              A -> pq_intt MODULUS="3329" DEGREE="256"
                INPUT -> pq_poly_add
                  A -> pq_ntt_mul MODULUS="3329"
                    A -> pq_sample_ntt MODULUS="3329"
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_bytes_slice
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            START -> data_value NUM="768"
                            END -> data_value NUM="800"
                          NONCE -> data_value NUM="1"
                        NONCE -> data_value NUM="0"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="0"
                          OUTLEN -> data_value NUM="192"
                  B -> pq_ntt_mul MODULUS="3329"
                    A -> pq_sample_ntt MODULUS="3329"
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_bytes_slice
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            START -> data_value NUM="768"
                            END -> data_value NUM="800"
                          NONCE -> data_value NUM="1"
                        NONCE -> data_value NUM="1"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="1"
                          OUTLEN -> data_value NUM="192"
              B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="3"
                  OUTLEN -> data_value NUM="128"
      B -> pq_byte_encode BITS="4"
        INPUT -> pq_compress BITS="4" MODULUS="3329"
          INPUT -> pq_poly_add
            A -> pq_poly_add
              A -> pq_intt MODULUS="3329" DEGREE="256"
                INPUT -> pq_poly_add
                  A -> pq_ntt_mul MODULUS="3329"
                    A -> pq_byte_decode BITS="12"
                      INPUT -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="0"
                        END -> data_value NUM="384"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="0"
                          OUTLEN -> data_value NUM="192"
                  B -> pq_ntt_mul MODULUS="3329"
                    A -> pq_byte_decode BITS="12"
                      INPUT -> pq_bytes_slice
                        INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                        START -> data_value NUM="384"
                        END -> data_value NUM="768"
                    B -> pq_ntt MODULUS="3329" DEGREE="256"
                      INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                        SEED -> pq_prf ALGO="SHAKE256"
                          SEED -> pq_bytes_slice
                            INPUT -> sponge_squeeze RATE="576"
                              STATE -> sponge_absorb RATE="576"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                  INPUT -> pq_byte_concat
                                    A -> variables_get VAR={"id":"m","name":"m"}
                                    B -> sponge_squeeze RATE="1088"
                                      STATE -> sponge_absorb RATE="1088"
                                        STATE -> keccak_state_init
                                        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                      OUTLEN -> data_value NUM="32"
                              OUTLEN -> data_value NUM="64"
                            START -> data_value NUM="32"
                            END -> data_value NUM="64"
                          NONCE -> data_value NUM="1"
                          OUTLEN -> data_value NUM="192"
              B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                SEED -> pq_prf ALGO="SHAKE256"
                  SEED -> pq_bytes_slice
                    INPUT -> sponge_squeeze RATE="576"
                      STATE -> sponge_absorb RATE="576"
                        STATE -> keccak_state_init
                        BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                          INPUT -> pq_byte_concat
                            A -> variables_get VAR={"id":"m","name":"m"}
                            B -> sponge_squeeze RATE="1088"
                              STATE -> sponge_absorb RATE="1088"
                                STATE -> keccak_state_init
                                BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              OUTLEN -> data_value NUM="32"
                      OUTLEN -> data_value NUM="64"
                    START -> data_value NUM="32"
                    END -> data_value NUM="64"
                  NONCE -> data_value NUM="4"
                  OUTLEN -> data_value NUM="128"
            B -> pq_decompress BITS="1" MODULUS="3329"
              INPUT -> pq_byte_decode BITS="1"
                INPUT -> variables_get VAR={"id":"m","name":"m"}
  then: variables_set VAR={"id":"v_ret","name":"ret"}
    VALUE -> pq_byte_concat
      A -> pq_byte_concat
        A -> pq_byte_concat
          A -> pq_byte_encode BITS="10"
            INPUT -> pq_compress BITS="10" MODULUS="3329"
              INPUT -> pq_poly_add
                A -> pq_intt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_poly_add
                    A -> pq_ntt_mul MODULUS="3329"
                      A -> pq_sample_ntt MODULUS="3329"
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_bytes_slice
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              START -> data_value NUM="768"
                              END -> data_value NUM="800"
                            NONCE -> data_value NUM="0"
                          NONCE -> data_value NUM="0"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="0"
                            OUTLEN -> data_value NUM="192"
                    B -> pq_ntt_mul MODULUS="3329"
                      A -> pq_sample_ntt MODULUS="3329"
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_bytes_slice
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              START -> data_value NUM="768"
                              END -> data_value NUM="800"
                            NONCE -> data_value NUM="0"
                          NONCE -> data_value NUM="1"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="1"
                            OUTLEN -> data_value NUM="192"
                B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                  SEED -> pq_prf ALGO="SHAKE256"
                    SEED -> pq_bytes_slice
                      INPUT -> sponge_squeeze RATE="576"
                        STATE -> sponge_absorb RATE="576"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                            INPUT -> pq_byte_concat
                              A -> variables_get VAR={"id":"m","name":"m"}
                              B -> sponge_squeeze RATE="1088"
                                STATE -> sponge_absorb RATE="1088"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                OUTLEN -> data_value NUM="32"
                        OUTLEN -> data_value NUM="64"
                      START -> data_value NUM="32"
                      END -> data_value NUM="64"
                    NONCE -> data_value NUM="2"
                    OUTLEN -> data_value NUM="128"
          B -> pq_byte_encode BITS="10"
            INPUT -> pq_compress BITS="10" MODULUS="3329"
              INPUT -> pq_poly_add
                A -> pq_intt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_poly_add
                    A -> pq_ntt_mul MODULUS="3329"
                      A -> pq_sample_ntt MODULUS="3329"
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_bytes_slice
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              START -> data_value NUM="768"
                              END -> data_value NUM="800"
                            NONCE -> data_value NUM="1"
                          NONCE -> data_value NUM="0"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="0"
                            OUTLEN -> data_value NUM="192"
                    B -> pq_ntt_mul MODULUS="3329"
                      A -> pq_sample_ntt MODULUS="3329"
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_bytes_slice
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              START -> data_value NUM="768"
                              END -> data_value NUM="800"
                            NONCE -> data_value NUM="1"
                          NONCE -> data_value NUM="1"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="1"
                            OUTLEN -> data_value NUM="192"
                B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                  SEED -> pq_prf ALGO="SHAKE256"
                    SEED -> pq_bytes_slice
                      INPUT -> sponge_squeeze RATE="576"
                        STATE -> sponge_absorb RATE="576"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                            INPUT -> pq_byte_concat
                              A -> variables_get VAR={"id":"m","name":"m"}
                              B -> sponge_squeeze RATE="1088"
                                STATE -> sponge_absorb RATE="1088"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                OUTLEN -> data_value NUM="32"
                        OUTLEN -> data_value NUM="64"
                      START -> data_value NUM="32"
                      END -> data_value NUM="64"
                    NONCE -> data_value NUM="3"
                    OUTLEN -> data_value NUM="128"
        B -> pq_byte_encode BITS="4"
          INPUT -> pq_compress BITS="4" MODULUS="3329"
            INPUT -> pq_poly_add
              A -> pq_poly_add
                A -> pq_intt MODULUS="3329" DEGREE="256"
                  INPUT -> pq_poly_add
                    A -> pq_ntt_mul MODULUS="3329"
                      A -> pq_byte_decode BITS="12"
                        INPUT -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="0"
                          END -> data_value NUM="384"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="0"
                            OUTLEN -> data_value NUM="192"
                    B -> pq_ntt_mul MODULUS="3329"
                      A -> pq_byte_decode BITS="12"
                        INPUT -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="384"
                          END -> data_value NUM="768"
                      B -> pq_ntt MODULUS="3329" DEGREE="256"
                        INPUT -> pq_sample_poly_cbd ETA="3" MODULUS="3329"
                          SEED -> pq_prf ALGO="SHAKE256"
                            SEED -> pq_bytes_slice
                              INPUT -> sponge_squeeze RATE="576"
                                STATE -> sponge_absorb RATE="576"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                                    INPUT -> pq_byte_concat
                                      A -> variables_get VAR={"id":"m","name":"m"}
                                      B -> sponge_squeeze RATE="1088"
                                        STATE -> sponge_absorb RATE="1088"
                                          STATE -> keccak_state_init
                                          BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                        OUTLEN -> data_value NUM="32"
                                OUTLEN -> data_value NUM="64"
                              START -> data_value NUM="32"
                              END -> data_value NUM="64"
                            NONCE -> data_value NUM="1"
                            OUTLEN -> data_value NUM="192"
                B -> pq_sample_poly_cbd ETA="2" MODULUS="3329"
                  SEED -> pq_prf ALGO="SHAKE256"
                    SEED -> pq_bytes_slice
                      INPUT -> sponge_squeeze RATE="576"
                        STATE -> sponge_absorb RATE="576"
                          STATE -> keccak_state_init
                          BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
                            INPUT -> pq_byte_concat
                              A -> variables_get VAR={"id":"m","name":"m"}
                              B -> sponge_squeeze RATE="1088"
                                STATE -> sponge_absorb RATE="1088"
                                  STATE -> keccak_state_init
                                  BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                OUTLEN -> data_value NUM="32"
                        OUTLEN -> data_value NUM="64"
                      START -> data_value NUM="32"
                      END -> data_value NUM="64"
                    NONCE -> data_value NUM="4"
                    OUTLEN -> data_value NUM="128"
              B -> pq_decompress BITS="1" MODULUS="3329"
                INPUT -> pq_byte_decode BITS="1"
                  INPUT -> variables_get VAR={"id":"m","name":"m"}
      B -> pq_bytes_slice
        INPUT -> sponge_squeeze RATE="576"
          STATE -> sponge_absorb RATE="576"
            STATE -> keccak_state_init
            BLOCK -> sponge_pad RATE="576" SUFFIX="0x06"
              INPUT -> pq_byte_concat
                A -> variables_get VAR={"id":"m","name":"m"}
                B -> sponge_squeeze RATE="1088"
                  STATE -> sponge_absorb RATE="1088"
                    STATE -> keccak_state_init
                    BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
                      INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                  OUTLEN -> data_value NUM="32"
          OUTLEN -> data_value NUM="64"
        START -> data_value NUM="0"
        END -> data_value NUM="32"
  RETURN -> variables_get VAR={"id":"v_ret","name":"ret"}

