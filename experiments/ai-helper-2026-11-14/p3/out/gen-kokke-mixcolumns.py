state = None

def aes_mix_columns(s):
    def xtime(x):
        return ((x << 1) ^ (((x >> 7) & 1) * 0x1b)) & 0xFF
    def mix(c):
        t = list(c)
        c[0] = xtime(t[0]^t[1]) ^ t[1] ^ t[2] ^ t[3]
        c[1] = xtime(t[1]^t[2]) ^ t[2] ^ t[3] ^ t[0]
        c[2] = xtime(t[2]^t[3]) ^ t[3] ^ t[0] ^ t[1]
        c[3] = xtime(t[3]^t[0]) ^ t[0] ^ t[1] ^ t[2]
    for c in range(4):
        i = 4 * c
        col = [s[i], s[i+1], s[i+2], s[i+3]]
        mix(col)
        s[i]=col[0]; s[i+1]=col[1]; s[i+2]=col[2]; s[i+3]=col[3]
    return s



def P3_MixColumns(state: list[int]) -> list[int]:
    """
    Crypto function: P3_MixColumns
    """

    return aes_mix_columns(state)

# ---- 由 run-p3.mjs 追加的向量驱动（与 C 驱动同源：vectors.json） ----
print(''.join(f'{b:02x}' for b in P3_MixColumns([0x63, 0x53, 0xe0, 0x8c, 0x09, 0x60, 0xe1, 0x04, 0xcd, 0x70, 0xb7, 0x51, 0xba, 0xca, 0xd0, 0xe7])))
print(''.join(f'{b:02x}' for b in P3_MixColumns([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])))