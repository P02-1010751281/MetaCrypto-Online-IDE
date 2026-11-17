s = None
rk = None

def aes_shift_rows(s):
    t = list(s)
    # Row 0: no shift
    # Row 1: shift left 1
    s[1]=t[5]; s[5]=t[9]; s[9]=t[13]; s[13]=t[1]
    # Row 2: shift left 2
    s[2]=t[10]; s[6]=t[14]; s[10]=t[2]; s[14]=t[6]
    # Row 3: shift left 3
    s[3]=t[15]; s[7]=t[3]; s[11]=t[7]; s[15]=t[11]
    return s

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

def aes_add_round_key(s, rk):
    for i in range(16):
        s[i] ^= rk[i]
    return s



def P3_AES_Round(s: list[int], rk: list[int]) -> list[int]:
    """
    Crypto function: P3_AES_Round
    """

    return aes_add_round_key(aes_mix_columns(aes_shift_rows(aes_shift_rows(s))), rk)

# ---- 由 run-p3.mjs 追加的向量驱动（与 C 驱动同源：vectors.json） ----
print(''.join(f'{b:02x}' for b in P3_AES_Round([0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0], [0xd6, 0xaa, 0x74, 0xfd, 0xd2, 0xaf, 0x72, 0xfa, 0xda, 0xa6, 0x78, 0xf1, 0xd6, 0xab, 0x76, 0xfe])))