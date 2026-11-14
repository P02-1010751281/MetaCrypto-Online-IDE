# 复现任务规格（格式中立）

每个 `NAME -> 类型 字段="值"` 行是一个块；缩进表示「该输入槽里放这个块」；`(then)` 表示语句链的下一块。
本文件不含 id、坐标、`{"block": …}` 包装——这些由你在目标格式里自行补。

## MLKEM_SEG（241 块）
procedures_defreturn extraState={"params":[],"hasStatements":true} NAME="MLKEM_SEG"
  STACK -> variables_set VAR={"id":"v_H","name":"H"}
    VALUE -> sponge_squeeze RATE="1088"
      STATE -> sponge_absorb RATE="1088"
        STATE -> keccak_state_init
        BLOCK -> sponge_pad RATE="1088" SUFFIX="0x06"
          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
      OUTLEN -> data_value NUM="32"
    (then)
    variables_set VAR={"id":"v_G","name":"G"}
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
      (then)
      variables_set VAR={"id":"v_Kp","name":"Kp"}
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
        (then)
        variables_set VAR={"id":"v_r","name":"r"}
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
          (then)
          variables_set VAR={"id":"v_rho","name":"rho"}
            VALUE -> pq_bytes_slice
              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
              START -> data_value NUM="768"
              END -> data_value NUM="800"
            (then)
            variables_set VAR={"id":"v_t0","name":"t0"}
              VALUE -> pq_byte_decode BITS="12"
                INPUT -> pq_bytes_slice
                  INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                  START -> data_value NUM="0"
                  END -> data_value NUM="384"
              (then)
              variables_set VAR={"id":"v_t1","name":"t1"}
                VALUE -> pq_byte_decode BITS="12"
                  INPUT -> pq_bytes_slice
                    INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                    START -> data_value NUM="384"
                    END -> data_value NUM="768"
                (then)
                variables_set VAR={"id":"v_A00","name":"A00"}
                  VALUE -> pq_sample_ntt MODULUS="3329"
                    SEED -> pq_seed_with_nonce
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_bytes_slice
                          INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                          START -> data_value NUM="768"
                          END -> data_value NUM="800"
                        NONCE -> data_value NUM="0"
                      NONCE -> data_value NUM="0"
                  (then)
                  variables_set VAR={"id":"v_A01","name":"A01"}
                    VALUE -> pq_sample_ntt MODULUS="3329"
                      SEED -> pq_seed_with_nonce
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_bytes_slice
                            INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                            START -> data_value NUM="768"
                            END -> data_value NUM="800"
                          NONCE -> data_value NUM="1"
                        NONCE -> data_value NUM="0"
                    (then)
                    variables_set VAR={"id":"v_A10","name":"A10"}
                      VALUE -> pq_sample_ntt MODULUS="3329"
                        SEED -> pq_seed_with_nonce
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_bytes_slice
                              INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                              START -> data_value NUM="768"
                              END -> data_value NUM="800"
                            NONCE -> data_value NUM="0"
                          NONCE -> data_value NUM="1"
                      (then)
                      variables_set VAR={"id":"v_A11","name":"A11"}
                        VALUE -> pq_sample_ntt MODULUS="3329"
                          SEED -> pq_seed_with_nonce
                            SEED -> pq_seed_with_nonce
                              SEED -> pq_bytes_slice
                                INPUT -> variables_get VAR={"id":"ek","name":"ek"}
                                START -> data_value NUM="768"
                                END -> data_value NUM="800"
                              NONCE -> data_value NUM="1"
                            NONCE -> data_value NUM="1"
                        (then)
                        variables_set VAR={"id":"v_s0","name":"s0"}
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
                          (then)
                          variables_set VAR={"id":"v_s1","name":"s1"}
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
                            (then)
                            variables_set VAR={"id":"v_e1_0","name":"e1_0"}
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
                              (then)
                              variables_set VAR={"id":"v_e1_1","name":"e1_1"}
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
                                (then)
                                variables_set VAR={"id":"v_e2","name":"e2"}
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
                                  (then)
                                  variables_set VAR={"id":"v_sh0","name":"sh0"}
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
  RETURN -> variables_get VAR={"id":"v_ret","name":"ret"}

