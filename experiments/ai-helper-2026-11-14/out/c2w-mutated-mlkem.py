ek = None
m = None
H = None
ret = None
G = None
Kp = None
r = None
rho = None
t0 = None
t1 = None
A00 = None
A01 = None
A10 = None
A11 = None
s0 = None
s1 = None
e1_0 = None
e1_1 = None
e2 = None
sh0 = None
sh1 = None
u0 = None
u1 = None
v = None
mu = None
c1a = None
c1b = None
c1 = None
c2 = None
c = None

def sha3_pad(msg, rate_bytes=136, suffix=0x06):
    if isinstance(msg, str):
        msg = msg.encode("utf-8")
    elif isinstance(msg, (list, tuple)):
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 255 or int(value) != value for value in msg): raise ValueError("SHA-3 input must contain byte integers from 0 to 255")
        msg = bytes(int(value) for value in msg)
    elif isinstance(msg, (bytes, bytearray)):
        msg = bytes(msg)
    else:
        raise TypeError("SHA-3 input must be UTF-8 text or bytes")
    m_len = len(msg)
    q = rate_bytes - (m_len % rate_bytes)
    padded = bytearray(msg) + bytearray(q)
    padded[m_len] ^= suffix
    padded[m_len + q - 1] ^= 0x80
    return bytes(padded)

def keccak_f(state, width):
    if width not in (200, 400, 800, 1600): raise ValueError("Unsupported Keccak-f width")
    if not isinstance(state, (list, tuple)) or len(state) != 25: raise TypeError("Keccak-f state must contain 25 lanes")
    lane_bits = width // 25
    mask = (1 << lane_bits) - 1
    if any(isinstance(lane, bool) or not isinstance(lane, int) or not 0 <= lane <= mask for lane in state): raise ValueError("Keccak-f lanes must be integers within the selected width")
    RC = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]
    R = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]]
    s = list(state)
    rounds = 12 + 2 * (lane_bits.bit_length() - 1)
    for rnd in range(rounds):
        C = [s[x] ^ s[x+5] ^ s[x+10] ^ s[x+15] ^ s[x+20] for x in range(5)]
        D = [C[(x+4)%5] ^ (((C[(x+1)%5] << 1) | (C[(x+1)%5] >> (lane_bits-1))) & mask) for x in range(5)]
        s = [(s[i] ^ D[i%5]) & mask for i in range(25)]
        B = [0]*25
        for x in range(5):
            for y in range(5):
                r = R[x][y] % lane_bits
                B[((2*x+3*y)%5)*5+y] = ((s[x+y*5] << r) | (s[x+y*5] >> (lane_bits-r))) & mask
        for x in range(5):
            for y in range(5):
                s[x+y*5] = (B[x+y*5] ^ ((~B[(x+1)%5+y*5]) & B[(x+2)%5+y*5])) & mask
        s[0] = (s[0] ^ RC[rnd]) & mask
    return s

def sha3_absorb(state, block, rate_bytes=136):
    if len(block) % rate_bytes: raise ValueError("Sponge absorb input length must be a multiple of the rate")
    rate_lanes = rate_bytes // 8
    s = list(state)
    for offset in range(0, len(block), rate_bytes):
        chunk = block[offset:offset + rate_bytes]
        for i in range(rate_lanes):
            lane = 0
            for j in range(8):
                lane |= (chunk[i*8+j] if i*8+j < len(chunk) else 0) << (j*8)
            s[i] ^= lane
        s = keccak_f(s, 1600)
    return s

def sha3_squeeze(state, out_len, rate_bytes=136):
    if isinstance(out_len, bool) or not isinstance(out_len, (int, float)) or not 0 <= out_len <= 9007199254740991 or int(out_len) != out_len: raise ValueError("Sponge output length must be a non-negative safe integer value")
    out_len = int(out_len)
    rate_lanes = rate_bytes // 8
    s = list(state)
    output = bytearray()
    while len(output) < out_len:
        for i in range(rate_lanes):
            for j in range(8):
                if len(output) >= out_len:
                    break
                output.append((s[i] >> (j*8)) & 0xFF)
            if len(output) >= out_len:
                break
        if len(output) < out_len:
            s = keccak_f(s, 1600)
    return bytes(output[:out_len])

def bytes_concat(a, b):
    if isinstance(a, str):
        a = a.encode("utf-8")
    if isinstance(b, str):
        b = b.encode("utf-8")
    return bytes(a) + bytes(b)

def bytes_slice(data, start, end):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return bytes(data)[start:end]

def byte_decode_d12(B):
    d = 12
    n = 256
    if not isinstance(B, (bytes, bytearray)) or len(B) != (n * d) // 8: raise TypeError("ByteDecode input length must match d")
    f = [0] * n
    bit_pos = 0
    for i in range(n):
        val = 0
        for j in range(d):
            byte_idx = bit_pos >> 3
            bit_idx = bit_pos & 7
            if (B[byte_idx] >> bit_idx) & 1:
                val |= 1 << j
            bit_pos += 1
        f[i] = val % 3329 if d == 12 else val
    return f

def seed_with_nonce(seed, nonce):
    if isinstance(seed, str):
        seed = seed.encode("utf-8")
    return bytes(seed) + bytes([nonce & 0xFF])

def sample_ntt(seed, q=3329):
    import hashlib
    if isinstance(seed, str):
        seed = seed.encode("utf-8")
    seed = bytes(seed)
    out = hashlib.shake_128(seed).digest(768)
    coeffs = []
    if q == 8380417:
        # ML-DSA (FIPS 204 Alg 30): 3 bytes → 23-bit value < q accepted
        for pos in range(0, len(out), 3):
            if len(coeffs) >= 256:
                break
            z = out[pos] | (out[pos + 1] << 8) | ((out[pos + 2] & 0x7F) << 16)
            if z < q:
                coeffs.append(z)
        return coeffs
    for pos in range(0, len(out), 3):
        if len(coeffs) >= 256:
            break
        d1 = (out[pos] | ((out[pos + 1] & 0x0F) << 8)) & 0xFFF
        d2 = ((out[pos + 1] >> 4) | (out[pos + 2] << 4)) & 0xFFF
        if d1 < q:
            coeffs.append(d1)
        if d2 < q and len(coeffs) < 256:
            coeffs.append(d2)
    return coeffs

def shake_input_bytes(value):
    if isinstance(value, str): return value.encode("utf-8")
    if isinstance(value, (bytes, bytearray)): return bytes(value)
    if not isinstance(value, (list, tuple)) or any(isinstance(byte, bool) or not isinstance(byte, (int, float)) or not 0 <= byte <= 255 or int(byte) != byte for byte in value): raise ValueError("SHAKE input must be UTF-8 text or a byte array of integers from 0 to 255")
    return bytes(int(byte) for byte in value)

def prf_shake256(seed, nonce, out_len=128):
    if isinstance(nonce, bool) or not isinstance(nonce, (int, float)) or not 0 <= nonce <= 255 or int(nonce) != nonce: raise ValueError("SHAKE PRF nonce must be an integer byte")
    if isinstance(out_len, bool) or not isinstance(out_len, (int, float)) or not 0 <= out_len <= 9007199254740991 or int(out_len) != out_len: raise ValueError("SHAKE output length must be a non-negative safe integer number of bytes")
    nonce = int(nonce)
    out_len = int(out_len)
    import hashlib
    seed = shake_input_bytes(seed)
    data = bytes(seed) + bytes([nonce & 0xFF])
    return hashlib.shake_256(data).digest(out_len)

def sample_poly_cbd_eta3(prf_out, q=3329):
    eta = 3
    if isinstance(prf_out, str):
        prf_out = prf_out.encode("utf-8")
    buf = bytes(prf_out)
    def _bit(pos):
        return (buf[pos // 8] >> (pos % 8)) & 1
    coeffs = [0] * 256
    for i in range(256):
        base = 2 * i * eta
        a = sum(_bit(base + j) for j in range(eta))
        b = sum(_bit(base + eta + j) for j in range(eta))
        coeffs[i] = (a - b) % q
    return coeffs

def sample_poly_cbd_eta2(prf_out, q=3329):
    eta = 2
    if isinstance(prf_out, str):
        prf_out = prf_out.encode("utf-8")
    buf = bytes(prf_out)
    def _bit(pos):
        return (buf[pos // 8] >> (pos % 8)) & 1
    coeffs = [0] * 256
    for i in range(256):
        base = 2 * i * eta
        a = sum(_bit(base + j) for j in range(eta))
        b = sum(_bit(base + eta + j) for j in range(eta))
        coeffs[i] = (a - b) % q
    return coeffs

def require_safe_integers(message, *collections):
    if any(type(value) not in (int, float) or abs(value) > 9007199254740991 or (type(value) is float and not value.is_integer()) for collection in collections for value in collection):
        raise TypeError(message)

def ntt(a, q=3329, n=256):
    if n != 256 or len(a) != 256: raise ValueError("NTT requires n=256 and 256 coefficients")
    require_safe_integers("NTT input coefficients must be safe integers", a)
    a = [int(value) % q for value in a]
    if q == 12289:
        root = pow(11, 48, q); res = list(a); j = 0
        for i in range(1, 256):
            bit = 128
            while j & bit: j ^= bit; bit >>= 1
            j ^= bit
            if i < j: res[i], res[j] = res[j], res[i]
        size = 2
        while size <= 256:
            root_step = pow(root, 256 // size, q); half = size // 2
            for start in range(0, 256, size):
                w = 1
                for offset in range(half):
                    u = res[start + offset]; t = w * res[start + offset + half] % q
                    res[start + offset] = (u + t) % q
                    res[start + offset + half] = (u - t) % q
                    w = w * root_step % q
            size *= 2
        return res
    if q == 8380417:
        # ML-DSA (FIPS 204 §6.3.2): Cooley-Tukey 8 layers, ζ=1753 (2^32 mod q, 512th primitive root)
        def _brv8(x):
            r = 0
            for _ in range(8):
                r = (r << 1) | (x & 1)
                x >>= 1
            return r
        zetas = [0] * 256
        for k in range(1, 256):
            zetas[k] = pow(1753, _brv8(k), q)
        res = list(a)
        m = 0
        ln = 128
        while ln >= 1:
            start = 0
            while start < 256:
                m += 1
                z = zetas[m]
                for j in range(start, start + ln):
                    t = (z * res[j + ln]) % q
                    res[j + ln] = (res[j] - t) % q
                    res[j] = (res[j] + t) % q
                start += 2 * ln
            ln //= 2
        return res
    gen = 17 if q == 3329 else 3
    res = list(a)
    ln = len(res)
    def _brv(x, bits):
        r = 0
        for _ in range(bits):
            r = (r << 1) | (x & 1)
            x >>= 1
        return r
    nbits = n.bit_length() - 1
    stride = ln // 2
    zz = 0
    while stride >= 2:  # log2(n)-1 layers; stride=1 not used in NTT domain
        for start in range(0, ln, stride * 2):
            zz += 1
            zp = pow(gen, _brv(zz, nbits - 1), q)
            for i in range(start, start + stride):
                u = res[i]
                t = (zp * res[i + stride]) % q
                res[i] = (u + t) % q
                res[i + stride] = (u - t + q) % q
        stride >>= 1
    return res

def ntt_mul(a, b, q=3329):
    if len(a) != 256 or len(b) != 256: raise ValueError("NTT multiplication requires 256 coefficients")
    require_safe_integers("NTT multiplication coefficients must be safe integers", a, b)
    a = [int(value) % q for value in a]; b = [int(value) % q for value in b]
    if q == 8380417:
        # ML-DSA (FIPS 204 §6.3.4): pointwise multiplication of NTT-domain polynomials
        return [(a[i] * b[i]) % q for i in range(256)]
    gen = 17 if q == 3329 else 3
    n = min(len(a), len(b))
    res = [0] * n
    def _brv(x, bits):
        r = 0
        for _ in range(bits):
            r = (r << 1) | (x & 1)
            x >>= 1
        return r
    bits = max(1, n.bit_length() - 2)
    i = 0
    while i + 1 < n:
        z = pow(gen, 2 * _brv(i // 2, bits) + 1, q)
        res[i] = (a[i] * b[i] + z * a[i + 1] * b[i + 1]) % q
        res[i + 1] = (a[i + 1] * b[i] + a[i] * b[i + 1]) % q
        i += 2
    if i < n:
        res[i] = (a[i] * b[i]) % q
    return res

def poly_add_mod(a, b, q=3329):
    if len(a) != 256 or len(b) != 256: raise ValueError("R_q polynomial addition requires 256 coefficients")
    require_safe_integers("polynomial coefficients must be safe integers", a, b)
    a = [int(value) for value in a]; b = [int(value) for value in b]
    return [((a[i] % q) + (b[i] % q)) % q for i in range(256)]

def intt(a, q=3329, n=256):
    if n != 256 or len(a) != 256: raise ValueError("INTT requires n=256 and 256 coefficients")
    require_safe_integers("NTT input coefficients must be safe integers", a)
    a = [int(value) % q for value in a]
    if q == 12289:
        root = pow(11, 48, q); inverse_root = pow(root, q - 2, q); res = list(a); j = 0
        for i in range(1, 256):
            bit = 128
            while j & bit: j ^= bit; bit >>= 1
            j ^= bit
            if i < j: res[i], res[j] = res[j], res[i]
        size = 2
        while size <= 256:
            root_step = pow(inverse_root, 256 // size, q); half = size // 2
            for start in range(0, 256, size):
                w = 1
                for offset in range(half):
                    u = res[start + offset]; t = w * res[start + offset + half] % q
                    res[start + offset] = (u + t) % q
                    res[start + offset + half] = (u - t) % q
                    w = w * root_step % q
            size *= 2
        inverse_length = pow(256, q - 2, q)
        return [value * inverse_length % q for value in res]
    if q == 8380417:
        # ML-DSA (FIPS 204 §6.3.3): Gentleman-Sande 8 layers, -zetas[m], final × 256⁻¹
        def _brv8(x):
            r = 0
            for _ in range(8):
                r = (r << 1) | (x & 1)
                x >>= 1
            return r
        zetas = [0] * 256
        for k in range(1, 256):
            zetas[k] = pow(1753, _brv8(k), q)
        res = list(a)
        m = 256
        ln = 1
        while ln < 256:
            start = 0
            while start < 256:
                m -= 1
                z = (-zetas[m]) % q
                for j in range(start, start + ln):
                    t = res[j]
                    res[j] = (t + res[j + ln]) % q
                    res[j + ln] = (t - res[j + ln]) % q
                    res[j + ln] = (z * res[j + ln]) % q
                start += 2 * ln
            ln *= 2
        res = [(v * 8347681) % q for v in res]  # 256⁻¹ mod 8380417
        return res
    gen = 17 if q == 3329 else 3
    res = list(a)
    ln = len(res)
    def _brv(x, bits):
        r = 0
        for _ in range(bits):
            r = (r << 1) | (x & 1)
            x >>= 1
        return r
    nbits = n.bit_length() - 1
    stride = 2
    zz = ln // 2
    while stride <= ln // 2:
        for start in range(0, ln, stride * 2):
            zz -= 1
            zp = pow(gen, _brv(zz, nbits - 1), q)
            for i in range(start, start + stride):
                a_val = res[i]
                b_val = res[i + stride]
                res[i] = (a_val + b_val) % q
                res[i + stride] = (zp * (b_val - a_val + q)) % q
        stride <<= 1
    n_inv = pow(ln // 2, q - 2, q)
    res = [(v * n_inv) % q for v in res]
    return res

def byte_decode_d1(B):
    d = 1
    n = 256
    if not isinstance(B, (bytes, bytearray)) or len(B) != (n * d) // 8: raise TypeError("ByteDecode input length must match d")
    f = [0] * n
    bit_pos = 0
    for i in range(n):
        val = 0
        for j in range(d):
            byte_idx = bit_pos >> 3
            bit_idx = bit_pos & 7
            if (B[byte_idx] >> bit_idx) & 1:
                val |= 1 << j
            bit_pos += 1
        f[i] = val % 3329 if d == 12 else val
    return f

def decompress_d1(y, q=3329):
    d = 1
    pow2d = 1 << d
    half = pow2d >> 1
    if isinstance(y, (list, tuple)):
        return [(yi * q + half) // pow2d for yi in y]
    return (y * q + half) // pow2d

def compress_d10(x, q=3329):
    d = 10
    pow2d = 1 << d
    mask = pow2d - 1
    if isinstance(x, (list, tuple)):
        return [((xi * pow2d + q // 2) // q) & mask for xi in x]
    return ((x * pow2d + q // 2) // q) & mask

def byte_encode_d10(f):
    d = 10
    n = 256
    modulus = 3329 if d == 12 else 1 << d
    if not isinstance(f, list) or len(f) != n: raise TypeError("ByteEncode input must contain 256 coefficients")
    for value in f:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not value.is_integer()) or not 0 <= value < modulus: raise ValueError("ByteEncode coefficient is outside its declared range")
    out_len = (n * d) // 8
    out = bytearray(out_len)
    bit_pos = 0
    for i in range(n):
        val = int(f[i])
        for j in range(d):
            byte_idx = bit_pos >> 3
            bit_idx = bit_pos & 7
            if (val >> j) & 1:
                out[byte_idx] |= 1 << bit_idx
            bit_pos += 1
    return bytes(out)

def compress_d4(x, q=3329):
    d = 4
    pow2d = 1 << d
    mask = pow2d - 1
    if isinstance(x, (list, tuple)):
        return [((xi * pow2d + q // 2) // q) & mask for xi in x]
    return ((x * pow2d + q // 2) // q) & mask

def byte_encode_d4(f):
    d = 4
    n = 256
    modulus = 3329 if d == 12 else 1 << d
    if not isinstance(f, list) or len(f) != n: raise TypeError("ByteEncode input must contain 256 coefficients")
    for value in f:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not value.is_integer()) or not 0 <= value < modulus: raise ValueError("ByteEncode coefficient is outside its declared range")
    out_len = (n * d) // 8
    out = bytearray(out_len)
    bit_pos = 0
    for i in range(n):
        val = int(f[i])
        for j in range(d):
            byte_idx = bit_pos >> 3
            bit_idx = bit_pos & 7
            if (val >> j) & 1:
                out[byte_idx] |= 1 << bit_idx
            bit_pos += 1
    return bytes(out)



def ML_KEM_Encaps(ek: bytes, m: bytes):
    """
    Crypto function: ML_KEM_Encaps
    """
    H = sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)
    G = sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72)
    Kp = bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 0, 32)
    r = bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64)
    rho = bytes_slice(ek, 768, 800)
    t0 = byte_decode_d12(bytes_slice(ek, 0, 384))
    t1 = byte_decode_d12(bytes_slice(ek, 384, 768))
    A00 = sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329)
    A01 = sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329)
    A10 = sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329)
    A11 = sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329)
    s0 = sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329)
    s1 = sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329)
    e1_0 = sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329)
    e1_1 = sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329)
    e2 = sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 4, out_len=128), q=3329)
    sh0 = ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256)
    sh1 = ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256)
    u0 = poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329), q=3329)
    u1 = poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329), q=3329)
    v = poly_add_mod(poly_add_mod(intt(poly_add_mod(ntt_mul(byte_decode_d12(bytes_slice(ek, 0, 384)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(byte_decode_d12(bytes_slice(ek, 384, 768)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 4, out_len=128), q=3329), q=3329), decompress_d1(byte_decode_d1(m), q=3329), q=3329)
    mu = decompress_d1(byte_decode_d1(m), q=3329)
    c1a = byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329), q=3329), q=3329))
    c1b = byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329), q=3329), q=3329))
    c1 = bytes_concat(byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329), q=3329), q=3329)), byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329), q=3329), q=3329)))
    c2 = byte_encode_d4(compress_d4(poly_add_mod(poly_add_mod(intt(poly_add_mod(ntt_mul(byte_decode_d12(bytes_slice(ek, 0, 384)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(byte_decode_d12(bytes_slice(ek, 384, 768)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 4, out_len=128), q=3329), q=3329), decompress_d1(byte_decode_d1(m), q=3329), q=3329), q=3329))
    c = bytes_concat(bytes_concat(byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329), q=3329), q=3329)), byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329), q=3329), q=3329))), byte_encode_d4(compress_d4(poly_add_mod(poly_add_mod(intt(poly_add_mod(ntt_mul(byte_decode_d12(bytes_slice(ek, 0, 384)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(byte_decode_d12(bytes_slice(ek, 384, 768)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 4, out_len=128), q=3329), q=3329), decompress_d1(byte_decode_d1(m), q=3329), q=3329), q=3329)))
    ret = bytes_concat(bytes_concat(bytes_concat(byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 0), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 2, out_len=128), q=3329), q=3329), q=3329)), byte_encode_d10(compress_d10(poly_add_mod(intt(poly_add_mod(ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 0), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(sample_ntt(seed_with_nonce(seed_with_nonce(bytes_slice(ek, 768, 800), 1), 1), q=3329), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 3, out_len=128), q=3329), q=3329), q=3329))), byte_encode_d4(compress_d4(poly_add_mod(poly_add_mod(intt(poly_add_mod(ntt_mul(byte_decode_d12(bytes_slice(ek, 0, 384)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 0, out_len=192), q=3329), q=3329, n=256), q=3329), ntt_mul(byte_decode_d12(bytes_slice(ek, 384, 768)), ntt(sample_poly_cbd_eta3(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 1, out_len=192), q=3329), q=3329, n=256), q=3329), q=3329), q=3329, n=256), sample_poly_cbd_eta2(prf_shake256(bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 32, 64), 4, out_len=128), q=3329), q=3329), decompress_d1(byte_decode_d1(m), q=3329), q=3329), q=3329))), bytes_slice(sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(bytes_concat(m, sha3_squeeze(sha3_absorb([0] * 25, sha3_pad(ek, rate_bytes=168, suffix=0x1F), rate_bytes=136), 32, rate_bytes=136)), rate_bytes=168, suffix=0x1F), rate_bytes=72), 64, rate_bytes=72), 0, 32))

    return ret
