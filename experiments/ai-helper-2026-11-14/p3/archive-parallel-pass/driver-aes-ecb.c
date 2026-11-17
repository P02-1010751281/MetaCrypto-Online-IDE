/* P3 V3 driver — 给 yi-aes-ecb.c 的 aes_ecb_block(in, key, out) 喂 FIPS 197 附录 B/C.1 的 AES-128 向量
 *
 * 自撰（本文件只做十六进制编解码与比对，不含任何密码实现）。
 * 向量：FIPS 197 附录 B / C.1 —— 明文 00112233445566778899aabbccddeeff，
 *       期望密文 69c4e0d86a7b0430d8cdb78070b4c55a（同一组值在 docs/standards/fips197-AES/05-Appendix.md:24 已记录）。
 * 退出码：0 = 密文与期望逐字节相等；1 = 不等；2 = 入参/编码失败。
 */
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#include "samples/yi-aes-ecb.c"

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int hex2bytes(const char *hex, uint8_t *out, size_t n) {
    for (size_t i = 0; i < n; i++) {
        int hi = hexval(hex[2 * i]), lo = hexval(hex[2 * i + 1]);
        if (hi < 0 || lo < 0) return -1;
        out[i] = (uint8_t)((hi << 4) | lo);
    }
    return 0;
}

static void bytes2hex(const uint8_t *b, size_t n, char *out) {
    static const char *D = "0123456789abcdef";
    for (size_t i = 0; i < n; i++) {
        out[2 * i] = D[b[i] >> 4];
        out[2 * i + 1] = D[b[i] & 0x0f];
    }
    out[2 * n] = '\0';
}

int main(void) {
    static const char *PT_HEX = "00112233445566778899aabbccddeeff";
    static const char *KEY_HEX = "000102030405060708090a0b0c0d0e0f";
    static const char *EXPECT_HEX = "69c4e0d86a7b0430d8cdb78070b4c55a";

    uint8_t in[16], key[16], out[16], expect[16];
    char got[33];

    if (strlen(PT_HEX) != 32 || strlen(KEY_HEX) != 32 || strlen(EXPECT_HEX) != 32) {
        fprintf(stderr, "driver: 向量长度不是 32 个十六进制字符\n");
        return 2;
    }
    if (hex2bytes(PT_HEX, in, 16) || hex2bytes(KEY_HEX, key, 16) || hex2bytes(EXPECT_HEX, expect, 16)) {
        fprintf(stderr, "driver: 十六进制解码失败\n");
        return 2;
    }

    memset(out, 0, sizeof out);
    aes_ecb_block(in, key, out);
    bytes2hex(out, 16, got);

    printf("plaintext=%s\n", PT_HEX);
    printf("key=%s\n", KEY_HEX);
    printf("ciphertext=%s\n", got);
    printf("expected=%s\n", EXPECT_HEX);
    printf("match=%d\n", memcmp(out, expect, 16) == 0 ? 1 : 0);
    return memcmp(out, expect, 16) == 0 ? 0 : 1;
}
