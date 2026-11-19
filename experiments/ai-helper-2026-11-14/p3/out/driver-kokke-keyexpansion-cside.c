/* 由 run-keyexpansion-cside.mjs 生成：把样本 #include 进同一编译单元（KeyExpansion 是 static）；
 * 只跑 A.1 向量，打印 176 字节轮密钥。不要手改，改向量请重跑脚本。 */
#include <stdint.h>
#include <stdio.h>
#include "kokke-keyexpansion.c"

static void p3_print(const uint8_t *p, int n) {
    for (int i = 0; i < n; i++) printf("%02x", p[i]);
    printf("\n");
}

int main(void) {
    static const uint8_t key[16] = {
    0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88,
    0x09, 0xcf, 0x4f, 0x3c
  };
    uint8_t roundkeys[176];
    KeyExpansion(roundkeys, key);
    p3_print(roundkeys, 176);
    return 0;
}
