/* 由 run-p3.mjs 生成：样本以 #include 进入同一编译单元（static 函数才能被调用）；不要手改。 */
#include <stdint.h>
#include <stdio.h>
#include "kokke-shiftrows.c"

static void p3_print(const uint8_t *p, int n) {
    for (int i = 0; i < n; i++) printf("%02x", p[i]);
    printf("\n");
}

int main(void) {
    uint8_t s[16];
    static const uint8_t a0[16] = { 0x63, 0xca, 0xb7, 0x04, 0x09, 0x53, 0xd0, 0x51, 0xcd, 0x60, 0xe0, 0xe7, 0xba, 0x70, 0xe1, 0x8c };
    for (int j = 0; j < 16; j++) s[j] = a0[j];
    ShiftRows((uint8_t (*)[4][4])s);
    p3_print(s, 16);
    static const uint8_t a1[16] = { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f };
    for (int j = 0; j < 16; j++) s[j] = a1[j];
    ShiftRows((uint8_t (*)[4][4])s);
    p3_print(s, 16);
    return 0;
}
