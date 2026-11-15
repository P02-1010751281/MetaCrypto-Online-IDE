export const MESSAGES_EN: Record<string, string> = {
  CRYPTO_LOGIC_XOR_XOR: 'XOR^XOR',
  CRYPTO_LOGIC_OR_XOR: 'OR^XOR',
  CRYPTO_LOGIC_AND_XOR: 'AND^XOR',
  CRYPTO_LOGIC_XOR_OR: 'XOR^OR',
  CRYPTO_LOGIC_OR_OR: 'OR^OR',
  CRYPTO_LOGIC_AND_OR: 'AND^OR',
  CRYPTO_LOGIC_XOR_AND: 'XOR^AND',
  CRYPTO_LOGIC_OR_AND: 'OR^AND',
  CRYPTO_LOGIC_AND_AND: 'AND^AND',
  CRYPTO_LOGIC_XOR: 'XOR',
  CRYPTO_LOGIC_OR: 'OR',
  CRYPTO_LOGIC_AND: 'AND',
  CRYPTO_LOGIC_NOT: 'NOT',
  CRYPTO_LOGIC_COMPOUND_TOOLTIP: 'Execute compound logic operation',
  CRYPTO_LOGIC_TOOLTIP: 'Execute logic operation on inputs',
  CRYPTO_LOGIC_NOT_TOOLTIP: 'Execute NOT operation on input',
  CRYPTO_LOGIC_OUTPUT_VAR: 'Output Var',

  CRYPTO_BITWISE_AND: 'Bitwise AND(&)',
  CRYPTO_BITWISE_OR: 'Bitwise OR(|)',
  CRYPTO_BITWISE_XOR: 'Bitwise XOR(^)',
  CRYPTO_BITWISE_RIGHT_SHIFT: 'Right Shift(>>)',
  CRYPTO_BITWISE_LEFT_SHIFT: 'Left Shift(<<)',
  CRYPTO_BITWISE_RIGHT_ROTATE: 'Right Rotate(>>>)',
  CRYPTO_BITWISE_LEFT_ROTATE: 'Left Rotate(<<<)',
  CRYPTO_BITWISE_TOOLTIP:
    'Execute bitwise logic operation on two inputs, can be chained',
  CRYPTO_BIT_OPERATION_TOOLTIP:
    'Execute bitwise operation (logic/shift/rotate) on two inputs, can be chained',
  CRYPTO_BIT_NOT32: 'NOT32(',
  CRYPTO_BIT_NOT32_TOOLTIP: '32-bit bitwise NOT on input',
  CRYPTO_ASSIGN_TOOLTIP: 'Assignment: left value equals right value',
  CRYPTO_EXPR_INFIX_TOOLTIP: 'Expression block: supports XOR, AND, OR, =',

  CRYPTO_ROTATE_LEFT: '32-bit Rotate Left Input',
  CRYPTO_ROTATE_LEFT_BIT: 'Bits',
  CRYPTO_ROTATE_LEFT_OP: '32-bit Rotate Left with Op Input',
  CRYPTO_ROTATE_LEFT_TOOLTIP: 'Rotate left by specified bits',
  CRYPTO_ROTATE_LEFT_OP_TOOLTIP:
    'Rotate left then execute operation (XOR, AND, OR, ADD)',
  CRYPTO_ROTATE_RIGHT: '32-bit Rotate Right Input',
  CRYPTO_ROTATE_RIGHT_OP: '32-bit Rotate Right with Op Input',
  CRYPTO_ROTATE_RIGHT_TOOLTIP: 'Rotate right by specified bits',
  CRYPTO_ROTATE_RIGHT_OP_TOOLTIP:
    'Rotate right then execute operation (XOR, AND, OR, ADD)',
  CRYPTO_BYTE_SUBSTITUTE: 'Byte Substitute Input',
  CRYPTO_BYTE_SUBSTITUTE_OUTPUT: 'Output Var',
  CRYPTO_BYTE_SUBSTITUTE_TOOLTIP: 'Substitute input byte with output byte',

  CRYPTO_ITERATE: 'Iterate',
  CRYPTO_ITERATE_TIMES: 'times',
  CRYPTO_ITERATE_DO: 'Do',
  CRYPTO_ITERATE_TOOLTIP: 'Custom iteration loop',

  CRYPTO_CURVE_PARAMS: 'Elliptic Curve Params',
  CRYPTO_CURVE_PARAMS_TOOLTIP: 'Set elliptic curve a, b, p parameters',
  CRYPTO_CURVE_POINT: 'Elliptic Curve Point',
  CRYPTO_CURVE_POINT_TOOLTIP: 'Define a point on elliptic curve',
  CRYPTO_CURVE_DOUBLE_POINT: 'Elliptic Curve Double Point',
  CRYPTO_CURVE_DOUBLE_POINT_TOOLTIP: 'Calculate double point on elliptic curve',
  CRYPTO_CURVE_ADD: 'Elliptic Curve Point Addition',
  CRYPTO_CURVE_ADD_TOOLTIP: 'Execute point addition on elliptic curve',
  CRYPTO_CURVE_MULTIPLY: 'Elliptic Curve Scalar Multiply',
  CRYPTO_CURVE_MULTIPLY_TOOLTIP:
    'Execute k-times point multiplication on elliptic curve',

  CRYPTO_SBOX_SIZE: 'S-box Size',
  CRYPTO_SBOX_ROW: 'Row',
  CRYPTO_SBOX_TOOLTIP: 'Define an S-box lookup table, click + to import CSV',
  CRYPTO_SBOX_SUB: 'S-box Substitute Input Var',
  CRYPTO_SBOX_SUB_VAR: 'S-box',
  CRYPTO_SBOX_SUB_TOOLTIP:
    'Apply an S-box to an unsigned 32-bit word in big-endian byte order; the first 256 entries must be integer byte values.',

  CRYPTO_SM3_PAD_TEXT: 'SM3 Text Pad',
  CRYPTO_SM3_PAD_TEXT_TOOLTIP: 'SM3 text string padding (UTF-8)',
  CRYPTO_SM3_PAD_HEX: 'SM3 Hex Pad',
  CRYPTO_SM3_PAD_HEX_TOOLTIP: 'SM3 hex string padding (2 hex chars = 1 byte)',
  CRYPTO_SM3_PAD: 'SM3 Pad',
  CRYPTO_SM3_PAD_TOOLTIP:
    'SM3 message padding: pad message to multiple of 512 bits',
  CRYPTO_SM3_COMPRESS: 'SM3 Compress',
  CRYPTO_SM3_COMPRESS_TOOLTIP:
    "SM3 compression function: OUT = CF(V, B) with expanded message W, W'",

  CRYPTO_SHA256_PAD: 'SHA-256 Pad',
  CRYPTO_SHA256_PAD_TOOLTIP: 'SHA-256 text padding',
  CRYPTO_SHA256_PAD_HEX: 'SHA-256 Hex Pad',
  CRYPTO_SHA256_PAD_HEX_TOOLTIP: 'SHA-256 hex string padding',
  CRYPTO_SHA256_PAD_TEXT: 'SHA-256 Text Pad',
  CRYPTO_SHA256_PAD_TEXT_TOOLTIP: 'SHA-256 text string padding (UTF-8)',
  CRYPTO_SHA256_COMPRESS: 'SHA-256 Compress',
  CRYPTO_SHA256_COMPRESS_TOOLTIP:
    'SHA-256 compression function: OUT = CF(V, B)',

  CRYPTO_SHA3_PAD_TEXT: 'SHA-3 Text Pad',
  CRYPTO_SHA3_PAD_TEXT_TOOLTIP:
    'SHA-3 pad10*1 padding (UTF-8 text input), aligned to rate r',
  CRYPTO_SHA3_PAD_HEX: 'SHA-3 Hex Pad',
  CRYPTO_SHA3_PAD_HEX_TOOLTIP:
    'SHA-3 pad10*1 padding (hex input), aligned to rate r',
  CRYPTO_SHA3_PAD: 'SHA-3 Pad',
  CRYPTO_SHA3_PAD_TOOLTIP:
    'SHA-3 pad10*1 padding: M || d || 0x00…0x00 xor 0x00…0x80, aligned to rate r (FIPS 202)',
  CRYPTO_SHA3_RATE: ', rate=',
  CRYPTO_SHA3_SUFFIX: 'suffix=',
  CRYPTO_SHA3_KECCAK_F_TOOLTIP:
    'Keccak-f permutation: supports widths 200/400/800/1600 with 18/20/22/24 rounds. SHA-3/SHAKE use only Keccak-f[1600]; smaller widths are permutation primitives, not SHA-3/SHAKE implementations.',
  CRYPTO_SHA3_ABSORB: 'Absorb',
  CRYPTO_SHA3_ABSORB_TOOLTIP:
    'Sponge absorb phase: State ^= Pi, then State = Keccak-f(State)',
  CRYPTO_SHA3_SQUEEZE: 'Squeeze',
  CRYPTO_SHA3_SQUEEZE_TOOLTIP:
    'Sponge squeeze phase: read r bits from state, re-run Keccak-f if more output needed',
  CRYPTO_SHA3_OUTLEN: ', outLen=',

  CRYPTO_ITERATE_VAR: 'Var',
  CRYPTO_ITERATE_LOOP: 'Loop',

  CRYPTO_CONVERT_TO_INT: 'Convert to Int',
  CRYPTO_CONVERT_TO_INT_TOOLTIP:
    'Convert variable to integer type, assign result to itself',
  CRYPTO_CONVERT_VAR: 'Var',
  CRYPTO_CONVERT_BYTES: 'Bytes',
  CRYPTO_CONVERT_BITS: 'Bit String',
  CRYPTO_CONVERT_BITS_TO_BYTES_TOOLTIP: 'Convert bit string to bytes',
  CRYPTO_CONVERT_BYTES_TO_BITS_TOOLTIP: 'Convert bytes to bit string',

  CRYPTO_MEASURE_BIT_LENGTH: 'Bit Length(',
  CRYPTO_MEASURE_BIT_LENGTH_TOOLTIP: 'Return the bit length of the input',
  CRYPTO_MEASURE_BYTE_LENGTH: 'Byte Length(',
  CRYPTO_MEASURE_BYTE_LENGTH_TOOLTIP: 'Return the byte length of the input',

  CRYPTO_NUMBER_TOOLTIP: 'Enter a number or expression',

  CRYPTO_PARTITION_SPLIT: 'Split',
  CRYPTO_PARTITION_INTO: 'into',
  CRYPTO_PARTITION_COUNT: 'parts',
  CRYPTO_PARTITION_AS: 'as',
  CRYPTO_PARTITION_MODE_BYTES: 'byte slices',
  CRYPTO_PARTITION_MODE_WORDS32: '32-bit words',
  CRYPTO_PARTITION_TARGET: 'into',
  CRYPTO_PARTITION_TOOLTIP:
    'Split bytes into equal byte slices or 32-bit big-endian words and assign to a target variable',

  CRYPTO_MOD_INVERSE_ASSIGN: 'Mod Inverse d',
  CRYPTO_MOD_INVERSE_TOOLTIP: 'Compute d = modular inverse of e mod φ(n)',

  CRYPTO_FIELD_ADD_TOOLTIP:
    'Finite field operation: add/sub/mul A and B then modulo P',

  CRYPTO_NTT_TOOLTIP:
    'NTT uses n=256 and exactly 256 coefficients. q=3329 is ML-KEM, q=8380417 is ML-DSA, and q=12289 is teaching-only.',
  CRYPTO_INTT_TOOLTIP:
    'Inverse NTT uses n=256 and exactly 256 coefficients, converting NTT evaluation form back to coefficient form.',
  CRYPTO_NTT_MUL: 'NTT Mul(',
  CRYPTO_NTT_MUL_TOOLTIP:
    'NTT-domain multiplication: ML-KEM half-NTT for q=3329 or ML-DSA pointwise multiplication for q=8380417; both inputs require 256 coefficients.',
  CRYPTO_NTT_BUTTERFLY: 'Butterfly(',
  CRYPTO_NTT_BUTTERFLY_TOOLTIP:
    'Butterfly operation: CT=(a+ζ·b, a-ζ·b) for NTT, GS=((a+b)/2, ζ·(b-a)/2) for INTT',
  CRYPTO_NTT_ZETA: ', ζ=',
  CRYPTO_NTT_TYPE: ', Type=',

  CRYPTO_XOF_TOOLTIP:
    'XOF (SHAKE128): Extendable Output Function. Generates arbitrary-length pseudorandom byte stream from a seed (FIPS 202)',
  CRYPTO_PRF_TOOLTIP:
    'PRF (SHAKE256): Pseudo-Random Function. seed || nonce → output bytes. Used by CBD sampling (FIPS 203 Alg 8)',

  CRYPTO_CATEGORY_CTRL: 'Control Flow',
  CRYPTO_CATEGORY_VARIABLE: 'Variables',
  CRYPTO_CATEGORY_MATH: 'Math',
  CRYPTO_CATEGORY_ARRAY: 'Arrays',
  CRYPTO_CATEGORY_DATA: 'Data Processing',
  CRYPTO_CATEGORY_BIT: 'Bitwise Operations',
  CRYPTO_CATEGORY_LOGIC: 'Logic Operations',
  CRYPTO_CATEGORY_SBOX: 'S-box Unit',
  CRYPTO_CATEGORY_HASH: 'Hash & Padding',
  CRYPTO_CATEGORY_SYMMETRIC: 'Symmetric Cipher',
  CRYPTO_CATEGORY_NUMTHEORY: 'Number Theory',
  CRYPTO_CATEGORY_ECC: 'Elliptic Curve',
  CRYPTO_CATEGORY_POSTQUANTUM_BASIC: 'PQC · Basic',
  CRYPTO_CATEGORY_POSTQUANTUM_ADVANCED: 'PQC · Advanced',
  CRYPTO_CATEGORY_ZUC: 'ZUC Stream Cipher',
  CRYPTO_CATEGORY_PROCEDURE: 'Functions',
  CRYPTO_CATEGORY_CRYPTO_TEMPLATES: 'Crypto Templates',

  CRYPTO_FUNCTIONS_IMPORT_BUTTON: '📥 Import',
  CRYPTO_FUNCTIONS_EXPORT_BUTTON: '📤 Export',
  CRYPTO_FUNCTIONS_PANEL_TITLE: 'Function Manager',
  CRYPTO_FUNCTIONS_NEW_BUTTON: '＋ New',
  CRYPTO_FUNCTIONS_ADD_TIP: 'Add to toolbox',
  CRYPTO_FUNCTIONS_REMOVE_TIP: 'Remove from toolbox',
  CRYPTO_FUNCTIONS_EXPORT_TIP: 'Export as .json',
  CRYPTO_FUNCTIONS_WORKSPACE_SECTION: 'Workspace Functions',
  PROC_AES_ROUND_LABEL: '🔧 AES_Round',
  PROC_AES_LAST_ROUND_LABEL: '🔧 AES_LastRound',
  PROC_AES_KEY_SCHEDULE_LABEL: '🔧 AES key-schedule empty loop (10x)',
  PROC_SM4_ROUND_LABEL: '🔧 SM4_Round',
  PROC_SM4_KEY_SCHEDULE_LABEL: '🔧 SM4 key-schedule empty loop (32x)',
  PROC_SHA256_HASH_LABEL: '🔧 SHA-256 padding fragment',
  PROC_SM3_HASH_LABEL: '🔧 SM3 padding fragment',
  PROC_HMAC_SHA256_LABEL: '🔧 HMAC-SHA-256 scaffold (message unset)',
  PROC_SM3_HMAC_LABEL: '🔧 SM3-HMAC scaffold (message unset)',
  PROC_PBKDF2_LABEL: '🔧 PBKDF2 empty-loop scaffold',
  PROC_HKDF_LABEL: '🔧 HKDF empty-loop scaffold',
  PROC_MLKEM_KEYGEN_LABEL: '🔧 ML-KEM KeyGen fragment',
  PROC_MLKEM_ENCAPS_LABEL: '🔧 ML-KEM-512 Encaps template',
  PROC_ZUC_KEYSTREAM_LABEL: '🔧 ZUC keystream scaffold (IV/length unset)',
  PROC_MD_ITERATE_LABEL: '🔧 MD_Iterate',
  PROC_SPONGE_DUPLEX_LABEL: '🔧 Sponge squeeze scaffold (not duplex)',
  PROC_MODE_ECB_LABEL: '🔧 AES-128-ECB (key unset)',
  PROC_MODE_CBC_LABEL: '🔧 AES-128-CBC (key/IV unset)',
  PROC_MODE_CTR_LABEL: '🔧 AES-128-CTR (key/nonce unset)',
  PROC_MODE_GCM_LABEL: '🔧 GCM scaffold (CTR only; no authentication)',
  PROC_NTT_VEC_LABEL: '🔧 NTT_Vec',
  PROC_PQ_CBD_LABEL: '🔧 CBD_NTT_Vec',
  PROC_PQ_MAT_MUL_LABEL: '🔧 Scalar Mat×Vec teaching',
  PROC_PQ_SAMPLE_LABEL: '🔧 SampleNTT_Mat',
  PROC_PQ_VEC_ADD_LABEL: '🔧 Vec_Add',
  PROC_PQ_VEC_SUB_LABEL: '🔧 Vec_Sub',

  CRYPTO_SUBCAT_BASE: 'Base',
  CRYPTO_SUBCAT_SYMMETRIC: 'Symmetric',
  CRYPTO_SUBCAT_HASH_MAC_KDF: 'Hash / MAC / KDF',
  CRYPTO_SUBCAT_MODE: 'Mode',
  CRYPTO_SUBCAT_ITERATE_SPONGE_PQC: 'Iterate / Sponge / PQC',
  CRYPTO_SUBCAT_ZUC: 'ZUC / Stream Cipher',


  CRYPTO_PROCEDURES_PARAM_MSG: 'message',
  CRYPTO_PROCEDURES_TEMPLATE_TOOLTIP: 'Create a crypto-typed function wrapper for organizing complex cipher algorithms.',

  CRYPTO_IFRETURN_LABEL: '🔧 if return',
  CRYPTO_RETURN_LABEL: '🔧 return',
  CRYPTO_PROCEDURES_ENCRYPT_LABEL: '🔐 AES-128-ECB encrypt template',
  CRYPTO_PROCEDURES_DECRYPT_LABEL: '🔓 AES-128-ECB decrypt template',
  CRYPTO_PROCEDURES_HASH_LABEL: '#️⃣ SHA-256 padding template',

  CRYPTO_SBOX_SIZE_LIMIT: 'S-box size limited to 32x32',
  CRYPTO_SBOX_PRESET: 'Preset',
  CRYPTO_SBOX_PRESET_NONE: 'Custom (CSV)',
  CRYPTO_SBOX_PRESET_AES: 'AES S-box (FIPS 197)',
  CRYPTO_SBOX_PRESET_SM4: 'SM4 S-box (GB/T 32907-2016)',
  CRYPTO_SBOX_PRESET_ZUC_S0: 'ZUC S0 (GB/T 33133)',
  CRYPTO_SBOX_PRESET_ZUC_S1: 'ZUC S1 (GB/T 33133)',
  CRYPTO_SBOX_ARRAY_1D: '1D Array',
  CRYPTO_SBOX_ARRAY_2D: '2D Array',
  CRYPTO_SBOX_IMPORT_CSV: 'Import CSV',
  CRYPTO_SBOX_EXPORT_CSV: 'Export CSV',
  CRYPTO_SBOX_CREATE_VARIABLE: 'Create SBox Variable',
  CRYPTO_SBOX_CSV_COUNT_ERROR:
    'CSV file must contain exactly {0} values, but found {1}.',
  CRYPTO_SBOX_CSV_INVALID_VALUE:
    'The {0}th value "{1}" is not a valid hex format.',
  CRYPTO_SBOX_CSV_READ_ERROR: 'Failed to read CSV file',
};
