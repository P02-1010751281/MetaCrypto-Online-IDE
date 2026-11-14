"""Demo 官方向量的第二批独立复算（SM2 / ECDSA / ZUC-EEA3 / ZUC-EIA3）。

由 tests/unit/demo-vector-crosscheck.test.ts 调用，向 stdout 输出 JSON 数组，
每个元素对应 REGISTRY_CASES 中的一条登记期望值（顺序一致）。

独立性来源：
- 椭圆曲线标量乘法、SM2 的 ZA/签名/加密、ECDSA 的 RFC 6979 派生与 ZUC/EIA3
  均在本文件内用 Python 标准库实现，不 import 仓库任何代码；
- SM3 取自 hashlib（OpenSSL 提供）；
- ZUC 的 S 盒是标准（GB/T 33133.1 附录 A）公布的常量表，本文件内联；
- 输入从 demos/ 下的工作区 JSON 与 tests.json 的 driver 读取，工作区改了输入这里跟着变。

覆盖边界：SM9 验签需要双线性配对，不在本探针内（见 .review/demo-vector-audit 记录）；
本探针只核对所列参数集，不替代官方完整测试集，也不构成认证证据。
"""

import binascii, hashlib, hmac, json, re

# ===================== 工具：从 demo 工作区与 driver 取输入 =====================
def _load(name):
    return json.load(open(f"demos/{name}.json"))

def _collect_num(node, out):
    if isinstance(node, dict):
        fields = node.get("fields")
        if isinstance(fields, dict) and "NUM" in fields:
            out.append(fields["NUM"])
        for value in node.values():
            _collect_num(value, out)
    elif isinstance(node, list):
        for value in node:
            _collect_num(value, out)

def block_nums(name, procedure):
    """取指定 procedures_defreturn 块内 data_value 的 NUM，按文档顺序。"""
    doc = _load(name)
    for block in doc.get("blocks", {}).get("blocks", []):
        if _block_name(block) == procedure:
            found = []
            _collect_num(block, found)
            return found
    raise SystemExit(f"未找到 procedure {procedure} in {name}")

def _block_name(node):
    if isinstance(node, dict):
        if node.get("type") == "procedures_defreturn":
            return node.get("fields", {}).get("NAME")
        for value in node.values():
            got = _block_name(value)
            if got:
                return got
    elif isinstance(node, list):
        for value in node:
            got = _block_name(value)
            if got:
                return got
    return None

def as_ints(value):
    return [int(token, 0) for token in re.findall(r"0x[0-9a-fA-F]+|\d+", value)]

def as_str(value):
    return value.strip('"')

def as_hex(value):
    """NUM 可能是十六进字符串，也可能是字节列表。"""
    text = value.strip()
    if text.startswith("["):
        return int.from_bytes(bytes(as_ints(text)), "big")
    return int(as_str(text), 16)

def driver(name):
    return json.load(open("demos/tests.json"))[f"procedures/{name}.json"]["py"]["driver"]

# ===================== 有限域椭圆曲线（自己在模 p 上实现）=====================
def _curve(p, a, b):
    def inv(x, m):
        return pow(x, -1, m)

    def add(P, Q):
        if P is None:
            return Q
        if Q is None:
            return P
        if P[0] == Q[0] and (P[1] + Q[1]) % p == 0:
            return None
        if P == Q:
            lam = (3 * P[0] * P[0] + a) * inv(2 * P[1] % p, p) % p
        else:
            lam = (Q[1] - P[1]) * inv((Q[0] - P[0]) % p, p) % p
        x = (lam * lam - P[0] - Q[0]) % p
        return (x, (lam * (P[0] - x) - P[1]) % p)

    def mul(k, P):
        R = None
        while k:
            if k & 1:
                R = add(R, P)
            P = add(P, P)
            k >>= 1
        return R

    return add, mul

def be(x, size=32):
    return x.to_bytes(size, "big")

# ===================== SM2（GB/T 32918）：标准附录 A 示例 2 的 Fp-256 示例曲线 =====================
SM2_P = 0x8542D69E4C044F18E8B92435BF6FF7DE457283915C45517D722EDB8B08F1DFC3
SM2_A = 0x787968B4FA32C3FD2417842E73BBFEFF2F3C848B6831D7E0EC65228B3937E498
SM2_B = 0x63E4C6D3B23B0C849CF84241484BFE48F61D59A5B16BA06E6E12D1DA27C5249A
SM2_N = 0x8542D69E4C044F18E8B92435BF6FF7DD297720630485628D5AE74EE7C32E79B7
SM2_GX = 0x421DEBD61B62EAB6746434EBC3CC315E32220B3BADD50BDC4C4E6C147FEDD43D
SM2_GY = 0x0680512BCBB42C07D47349D2153B70C4E5D7FDFCBFA36EA1A85841B9E46E09A2
SM2_G = (SM2_GX, SM2_GY)
_sm2_add, _sm2_mul = _curve(SM2_P, SM2_A, SM2_B)

def sm3(data):
    return hashlib.new("sm3", data).digest()

def sm2_za(P, ident):
    entl = (len(ident) * 8).to_bytes(2, "big")
    return sm3(entl + ident + be(SM2_A) + be(SM2_B) + be(SM2_GX) + be(SM2_GY) + be(P[0]) + be(P[1]))

def sm2_sign(d, ident, message, k):
    P = _sm2_mul(d, SM2_G)
    e = int.from_bytes(sm3(sm2_za(P, ident) + message), "big")
    r = (e + _sm2_mul(k, SM2_G)[0]) % SM2_N
    s = (pow(1 + d, -1, SM2_N) * (k - r * d)) % SM2_N
    return f"{r:064x}{s:064x}", sm2_za(P, ident), f"{e:064x}"

def sm2_kdf(z, klen):
    out, counter = b"", 1
    while len(out) < klen:
        out += sm3(z + counter.to_bytes(4, "big"))
        counter += 1
    return out[:klen]

def sm2_encrypt(message, px, py, k):
    C1 = _sm2_mul(k, SM2_G)
    S = _sm2_mul(k, (px, py))
    mask = sm2_kdf(be(S[0]) + be(S[1]), len(message))
    C2 = bytes(x ^ y for x, y in zip(message, mask))
    C3 = sm3(be(S[0]) + message + be(S[1]))
    return (b"\x04" + be(C1[0]) + be(C1[1]) + C3 + C2).hex()

# ===================== ECDSA（RFC 6979 A.2.5，P-256 / SHA-256）=====================
EC_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
EC_A = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC
EC_B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
EC_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
EC_G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
        0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)
_ec_add, _ec_mul = _curve(EC_P, EC_A, EC_B)

def rfc6979_k(d, digest):
    qlen, rlen = EC_N.bit_length(), (EC_N.bit_length() + 7) // 8

    def int2octets(x):
        return x.to_bytes(rlen, "big")

    def bits2octets(h):
        z = int.from_bytes(h, "big") >> max(0, len(h) * 8 - qlen)
        return int2octets(z % EC_N)

    V, K = b"\x01" * 32, b"\x00" * 32
    K = hmac.new(K, V + b"\x00" + int2octets(d) + bits2octets(digest), hashlib.sha256).digest()
    V = hmac.new(K, V, hashlib.sha256).digest()
    K = hmac.new(K, V + b"\x01" + int2octets(d) + bits2octets(digest), hashlib.sha256).digest()
    V = hmac.new(K, V, hashlib.sha256).digest()
    while True:
        T = b""
        while len(T) < rlen:
            V = hmac.new(K, V, hashlib.sha256).digest()
            T += V
        candidate = int.from_bytes(T, "big") >> max(0, len(T) * 8 - qlen)
        if 1 <= candidate < EC_N:
            return candidate
        K = hmac.new(K, V + b"\x00", hashlib.sha256).digest()
        V = hmac.new(K, V, hashlib.sha256).digest()

def ecdsa_sign(d, message):
    digest = hashlib.sha256(message).digest()
    k = rfc6979_k(d, digest)
    r = _ec_mul(k, EC_G)[0] % EC_N
    s = (pow(k, -1, EC_N) * (int.from_bytes(digest, "big") + r * d)) % EC_N
    return f"{r:064x}{s:064x}"

# ===================== ZUC（GB/T 33133.1）=====================
_S0 = bytes([
    0x3e, 0x72, 0x5b, 0x47, 0xca, 0xe0, 0x00, 0x33, 0x04, 0xd1, 0x54, 0x98, 0x09, 0xb9, 0x6d, 0xcb,
    0x7b, 0x1b, 0xf9, 0x32, 0xaf, 0x9d, 0x6a, 0xa5, 0xb8, 0x2d, 0xfc, 0x1d, 0x08, 0x53, 0x03, 0x90,
    0x4d, 0x4e, 0x84, 0x99, 0xe4, 0xce, 0xd9, 0x91, 0xdd, 0xb6, 0x85, 0x48, 0x8b, 0x29, 0x6e, 0xac,
    0xcd, 0xc1, 0xf8, 0x1e, 0x73, 0x43, 0x69, 0xc6, 0xb5, 0xbd, 0xfd, 0x39, 0x63, 0x20, 0xd4, 0x38,
    0x76, 0x7d, 0xb2, 0xa7, 0xcf, 0xed, 0x57, 0xc5, 0xf3, 0x2c, 0xbb, 0x14, 0x21, 0x06, 0x55, 0x9b,
    0xe3, 0xef, 0x5e, 0x31, 0x4f, 0x7f, 0x5a, 0xa4, 0x0d, 0x82, 0x51, 0x49, 0x5f, 0xba, 0x58, 0x1c,
    0x4a, 0x16, 0xd5, 0x17, 0xa8, 0x92, 0x24, 0x1f, 0x8c, 0xff, 0xd8, 0xae, 0x2e, 0x01, 0xd3, 0xad,
    0x3b, 0x4b, 0xda, 0x46, 0xeb, 0xc9, 0xde, 0x9a, 0x8f, 0x87, 0xd7, 0x3a, 0x80, 0x6f, 0x2f, 0xc8,
    0xb1, 0xb4, 0x37, 0xf7, 0x0a, 0x22, 0x13, 0x28, 0x7c, 0xcc, 0x3c, 0x89, 0xc7, 0xc3, 0x96, 0x56,
    0x07, 0xbf, 0x7e, 0xf0, 0x0b, 0x2b, 0x97, 0x52, 0x35, 0x41, 0x79, 0x61, 0xa6, 0x4c, 0x10, 0xfe,
    0xbc, 0x26, 0x95, 0x88, 0x8a, 0xb0, 0xa3, 0xfb, 0xc0, 0x18, 0x94, 0xf2, 0xe1, 0xe5, 0xe9, 0x5d,
    0xd0, 0xdc, 0x11, 0x66, 0x64, 0x5c, 0xec, 0x59, 0x42, 0x75, 0x12, 0xf5, 0x74, 0x9c, 0xaa, 0x23,
    0x0e, 0x86, 0xab, 0xbe, 0x2a, 0x02, 0xe7, 0x67, 0xe6, 0x44, 0xa2, 0x6c, 0xc2, 0x93, 0x9f, 0xf1,
    0xf6, 0xfa, 0x36, 0xd2, 0x50, 0x68, 0x9e, 0x62, 0x71, 0x15, 0x3d, 0xd6, 0x40, 0xc4, 0xe2, 0x0f,
    0x8e, 0x83, 0x77, 0x6b, 0x25, 0x05, 0x3f, 0x0c, 0x30, 0xea, 0x70, 0xb7, 0xa1, 0xe8, 0xa9, 0x65,
    0x8d, 0x27, 0x1a, 0xdb, 0x81, 0xb3, 0xa0, 0xf4, 0x45, 0x7a, 0x19, 0xdf, 0xee, 0x78, 0x34, 0x60,
])
_S1 = bytes([
    0x55, 0xc2, 0x63, 0x71, 0x3b, 0xc8, 0x47, 0x86, 0x9f, 0x3c, 0xda, 0x5b, 0x29, 0xaa, 0xfd, 0x77,
    0x8c, 0xc5, 0x94, 0x0c, 0xa6, 0x1a, 0x13, 0x00, 0xe3, 0xa8, 0x16, 0x72, 0x40, 0xf9, 0xf8, 0x42,
    0x44, 0x26, 0x68, 0x96, 0x81, 0xd9, 0x45, 0x3e, 0x10, 0x76, 0xc6, 0xa7, 0x8b, 0x39, 0x43, 0xe1,
    0x3a, 0xb5, 0x56, 0x2a, 0xc0, 0x6d, 0xb3, 0x05, 0x22, 0x66, 0xbf, 0xdc, 0x0b, 0xfa, 0x62, 0x48,
    0xdd, 0x20, 0x11, 0x06, 0x36, 0xc9, 0xc1, 0xcf, 0xf6, 0x27, 0x52, 0xbb, 0x69, 0xf5, 0xd4, 0x87,
    0x7f, 0x84, 0x4c, 0xd2, 0x9c, 0x57, 0xa4, 0xbc, 0x4f, 0x9a, 0xdf, 0xfe, 0xd6, 0x8d, 0x7a, 0xeb,
    0x2b, 0x53, 0xd8, 0x5c, 0xa1, 0x14, 0x17, 0xfb, 0x23, 0xd5, 0x7d, 0x30, 0x67, 0x73, 0x08, 0x09,
    0xee, 0xb7, 0x70, 0x3f, 0x61, 0xb2, 0x19, 0x8e, 0x4e, 0xe5, 0x4b, 0x93, 0x8f, 0x5d, 0xdb, 0xa9,
    0xad, 0xf1, 0xae, 0x2e, 0xcb, 0x0d, 0xfc, 0xf4, 0x2d, 0x46, 0x6e, 0x1d, 0x97, 0xe8, 0xd1, 0xe9,
    0x4d, 0x37, 0xa5, 0x75, 0x5e, 0x83, 0x9e, 0xab, 0x82, 0x9d, 0xb9, 0x1c, 0xe0, 0xcd, 0x49, 0x89,
    0x01, 0xb6, 0xbd, 0x58, 0x24, 0xa2, 0x5f, 0x38, 0x78, 0x99, 0x15, 0x90, 0x50, 0xb8, 0x95, 0xe4,
    0xd0, 0x91, 0xc7, 0xce, 0xed, 0x0f, 0xb4, 0x6f, 0xa0, 0xcc, 0xf0, 0x02, 0x4a, 0x79, 0xc3, 0xde,
    0xa3, 0xef, 0xea, 0x51, 0xe6, 0x6b, 0x18, 0xec, 0x1b, 0x2c, 0x80, 0xf7, 0x74, 0xe7, 0xff, 0x21,
    0x5a, 0x6a, 0x54, 0x1e, 0x41, 0x31, 0x92, 0x35, 0xc4, 0x33, 0x07, 0x0a, 0xba, 0x7e, 0x0e, 0x34,
    0x88, 0xb1, 0x98, 0x7c, 0xf3, 0x3d, 0x60, 0x6c, 0x7b, 0xca, 0xd3, 0x1f, 0x32, 0x65, 0x04, 0x28,
    0x64, 0xbe, 0x85, 0x9b, 0x2f, 0x59, 0x8a, 0xd7, 0xb0, 0x25, 0xac, 0xaf, 0x12, 0x03, 0xe2, 0xf2,
])

_ZUC_D = [
    0b100010011010111, 0b010011010111100, 0b110001001101011, 0b001001101011110,
    0b101011110001001, 0b011010111100010, 0b111000100110101, 0b000100110101111,
    0b100110101111000, 0b010111100010011, 0b110101111000100, 0b001101011110001,
    0b101111000100110, 0b011110001001101, 0b111100010011010, 0b100011110101100,
]

def _rol32(x, n):
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF

def _zuc_bs(x):
    return (((_S0[(x >> 24) & 0xFF]) << 24) ^ ((_S1[(x >> 16) & 0xFF]) << 16)
            ^ ((_S0[(x >> 8) & 0xFF]) << 8) ^ (_S1[x & 0xFF]))

def _zuc_l1(x):
    return x ^ _rol32(x, 2) ^ _rol32(x, 10) ^ _rol32(x, 18) ^ _rol32(x, 24)

def _zuc_l2(x):
    return x ^ _rol32(x, 8) ^ _rol32(x, 14) ^ _rol32(x, 22) ^ _rol32(x, 30)

def zuc_words(key, iv, count):
    state = [(key[i] << 23) | (_ZUC_D[i] << 8) | iv[i] for i in range(16)]
    R1 = R2 = 0

    def F(X0, X1, X2):
        nonlocal R1, R2
        W = ((X0 ^ R1) + R2) & 0xFFFFFFFF
        W1 = (R1 + X1) & 0xFFFFFFFF
        W2 = R2 ^ X2
        R1 = _zuc_bs(_zuc_l1(((W1 & 0xFFFF) << 16) ^ (W2 >> 16)))
        R2 = _zuc_bs(_zuc_l2(((W2 & 0xFFFF) << 16) ^ (W1 >> 16)))
        return W

    def lfsr(u=0):
        s16 = ((state[15] << 15) + (state[13] << 17) + (state[10] << 21)
               + (state[4] << 20) + (state[0] << 8) + state[0] + u) % 0x7FFFFFFF
        state.append(0x7FFFFFFF if s16 == 0 else s16)
        state.pop(0)

    def reorganize():
        X0 = ((state[15] >> 15) << 16) | (state[14] & 0xFFFF)
        X1 = ((state[11] & 0xFFFF) << 16) | (state[9] >> 15)
        X2 = ((state[7] & 0xFFFF) << 16) | (state[5] >> 15)
        X3 = ((state[2] & 0xFFFF) << 16) | (state[0] >> 15)
        return X0, X1, X2, X3

    for _ in range(32):
        X0, X1, X2, _X3 = reorganize()
        lfsr(F(X0, X1, X2) >> 1)

    X0, X1, X2, X3 = reorganize()
    F(X0, X1, X2)
    lfsr()

    words = []
    for _ in range(count):
        X0, X1, X2, X3 = reorganize()
        words.append(F(X0, X1, X2) ^ X3)
        lfsr()
    return words

def zuc_iv(count, bearer, direction):
    """GB/T 33133.3 附录 A.2：前半为 COUNT||BEARER||0，后半重复并叠加 DIRECTION。"""
    iv = bytearray(16)
    iv[0:4] = count.to_bytes(4, "big")
    iv[4] = (bearer << 3) & 0xFF
    flip = (direction << 7) & 0xFF
    iv[8] = iv[0] ^ flip
    iv[9], iv[10], iv[11] = iv[1], iv[2], iv[3]
    iv[12], iv[13] = iv[4], iv[5]
    iv[14] = iv[6] ^ flip
    iv[15] = iv[7]
    return bytes(iv)

def eia3(key, count, bearer, direction, message, bitlen):
    iv = zuc_iv(count, bearer, direction)
    words = zuc_words(key, iv, (bitlen + 31) // 32 + 2)
    stream = []
    for word in words:
        for i in range(32):
            stream.append((word >> (31 - i)) & 1)

    def window(offset):
        value = 0
        for j in range(32):
            value = (value << 1) | stream[offset + j]
        return value

    bits = []
    for byte in message:
        for i in range(8):
            bits.append((byte >> (7 - i)) & 1)
    T = 0
    for i in range(bitlen):
        if bits[i]:
            T ^= window(i)
    return T ^ window(bitlen) ^ window(32 * (len(words) - 1))

# ===================== 汇总 =====================
results = []

# 1-3 SM2 签名（GB/T 32918.2 附录 A.2）
vals = block_nums("procedures/SM2-Sign", "SM2_Sign")
sig, za, e = sm2_sign(as_hex(vals[0]), as_str(vals[1]).encode(), bytes(as_ints(vals[2])), int(as_str(vals[3]), 16))
results += [sig, binascii.hexlify(za).decode(), e]

# 4 SM2 加密（GB/T 32918.4 附录 A）
vals = block_nums("procedures/SM2-Encrypt", "SM2_Encrypt")
results.append(sm2_encrypt(bytes(as_ints(vals[0])), as_hex(vals[1]), as_hex(vals[2]), as_hex(vals[3])))

# 5-6 ECDSA（RFC 6979 A.2.5）
vals = block_nums("procedures/ECDSA", "ECDSA_Sign")
d = as_hex(vals[0])
results += [ecdsa_sign(d, b"sample"), ecdsa_sign(d, b"test")]

# 7-8 EEA3（GB/T 33133.2 附录 A.1）
vals = block_nums("procedures/EEA3", "EEA3_Encrypt")
key, iv = bytes(as_ints(vals[0])), bytes(as_ints(vals[1]))
ksb = b"".join(word.to_bytes(4, "big") for word in zuc_words(key, iv, 7))[:25]
ibs = bytes(int(t, 0) for t in re.findall(r"0x[0-9a-fA-F]{2}", driver("EEA3") .split("ibs = bytes([")[1].split("])")[0]))
obs = bytes(x ^ y for x, y in zip(ibs, ksb))
results += [(obs[:24] + bytes([obs[24] & 0x80])).hex(), ksb[:24].hex()]

# 9-10 EIA3（GB/T 33133.3 附录 B 示例 1、2）
vals = block_nums("procedures/EIA3", "EIA3_Vector_1")
results.append(f"{eia3(bytes(as_ints(vals[0])), int(as_str(vals[1]), 0), int(as_str(vals[2]), 0), int(as_str(vals[3]), 0), bytes(as_ints(vals[4])), int(as_str(vals[5]), 0)):08x}")
vals = block_nums("procedures/EIA3", "EIA3_Vector_2")
results.append(f"{eia3(bytes(as_ints(vals[0])), int(as_str(vals[1]), 0), int(as_str(vals[2]), 0), int(as_str(vals[3]), 0), bytes(as_ints(vals[4])), int(as_str(vals[5]), 0)):08x}")

print(json.dumps(results))
