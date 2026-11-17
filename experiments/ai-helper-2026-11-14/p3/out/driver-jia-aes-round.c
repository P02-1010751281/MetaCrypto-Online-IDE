/* 由 run-p3.mjs 生成：同一组向量喂给 C 样本；不要手改，改 vectors.json 后重跑。 */
#include <stdint.h>
#include <stdio.h>

void aes_round(uint8_t s[16], const uint8_t rk[16]);
static void p3_print(const uint8_t *p, int n) {
    for (int i = 0; i < n; i++) printf("%02x", p[i]);
    printf("\n");
}

int main(void) {
    uint8_t s[16];
    static const uint8_t a0[16] = { 0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0 };
    static const uint8_t k0[16] = { 0xd6, 0xaa, 0x74, 0xfd, 0xd2, 0xaf, 0x72, 0xfa, 0xda, 0xa6, 0x78, 0xf1, 0xd6, 0xab, 0x76, 0xfe };
    for (int j = 0; j < 16; j++) s[j] = a0[j];
    aes_round(s, k0);
    p3_print(s, 16);
    return 0;
}
