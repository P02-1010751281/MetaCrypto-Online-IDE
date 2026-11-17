/* 由 run-p3.mjs 生成：同一组向量喂给 C 样本；不要手改，改 vectors.json 后重跑。 */
#include <stdint.h>
#include <stdio.h>

uint8_t sm4_sbox(uint8_t x);

int main(void) {
    printf("%02x\n", sm4_sbox(0x00));
    printf("%02x\n", sm4_sbox(0x01));
    printf("%02x\n", sm4_sbox(0xff));
    return 0;
}
