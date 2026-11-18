state = None

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



def P3_ShiftRows(state: list[int]) -> list[int]:
    """
    Crypto function: P3_ShiftRows
    """

    return aes_shift_rows(state)

# ---- 由 run-p3.mjs 追加的向量驱动（与 C 驱动同源：vectors.json） ----
print(''.join(f'{b:02x}' for b in P3_ShiftRows([0x63, 0xca, 0xb7, 0x04, 0x09, 0x53, 0xd0, 0x51, 0xcd, 0x60, 0xe0, 0xe7, 0xba, 0x70, 0xe1, 0x8c])))
print(''.join(f'{b:02x}' for b in P3_ShiftRows([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f])))