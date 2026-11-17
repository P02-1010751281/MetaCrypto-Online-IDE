/* P3 样本乙 — AES-128 ECB 单块加密驱动（FIPS 197 §5.1 全轮 + SP 800-38A §6.1 ECB）
 * 自撰，非第三方参考实现：轮函数与 S 盒来自样本甲（显式 #include），本文件只加密钥扩展与 10 轮编排
 * 许可证：AGPL-3.0-or-later（随本仓库）；获取日期 2026-11-17；校验见 p3/samples/manifest.json */
#include "jia-aes-round.c"
static void expand_key(const uint8_t key[16], uint8_t rk[176]) {
    for (int i = 0; i < 16; i++) rk[i] = key[i];
    uint8_t rcon = 1;
    for (int i = 16; i < 176; i += 4) {
        uint8_t t[4] = { rk[i - 4], rk[i - 3], rk[i - 2], rk[i - 1] };
        if (i % 16 == 0) {
            uint8_t u = t[0];
            t[0] = SBOX[t[1]] ^ rcon; t[1] = SBOX[t[2]]; t[2] = SBOX[t[3]]; t[3] = SBOX[u];
            rcon = xtime(rcon);
        }
        for (int j = 0; j < 4; j++) rk[i + j] = rk[i - 16 + j] ^ t[j];
    }
}
void aes_ecb_block(const uint8_t in[16], const uint8_t key[16], uint8_t out[16]) {
    uint8_t rk[176], rk16[16];
    expand_key(key, rk);
    for (int i = 0; i < 16; i++) out[i] = in[i] ^ rk[i];
    for (int r = 1; r < 10; r++) {
        for (int i = 0; i < 16; i++) rk16[i] = rk[16 * r + i];
        sub_bytes(out); shift_rows(out); mix_columns(out); add_round_key(out, rk16);
    }
    for (int i = 0; i < 16; i++) rk16[i] = rk[160 + i];
    sub_bytes(out); shift_rows(out); add_round_key(out, rk16);
}
