export const BLOCK_TYPE_MIGRATION_MAP: Record<string, string> = {
  crypto_assign: 'ctrl_assign',
  crypto_iterate: 'ctrl_iterate',
  ctrl_assign: 'variables_set', // ctrl_assign 赋值块 → Blockly 内置变量赋值
  math_number: 'data_value',
  crypto_number: 'data_value',
  crypto_expr_infix: 'bit_expr_infix',
  crypto_bitwise_expr: 'bit_operation',
  crypto_bitwise_not32: 'bit_not32',
  crypto_not: 'lgc_not',
  crypto_xor: 'lgc_operation',
  crypto_logic_compound: 'lgc_compound',
  crypto_rotate_left: 'bit_rotate_left',
  crypto_rotate_left_op: 'bit_rotate_left_op',
  crypto_rotate_right: 'bit_rotate_right',
  crypto_rotate_right_op: 'bit_rotate_right_op',
  crypto_byte_substitute: 'bit_byte_substitute',
  crypto_sbox: 'sbox',
  // crypto_sbox_def 由 migrateSboxDefXml / migrateSboxDefJson 自定义迁移
  crypto_sbox_4x4: 'sbox',
  crypto_sbox_8x8: 'sbox',
  crypto_sbox_16x16: 'sbox',
  crypto_sbox_16x16_settings: 'sbox',
  crypto_sbox_8x8_settings: 'sbox',
  crypto_sbox_configurable: 'sbox',
  crypto_sm4_sbox_sub: 'sbox_sub',
  crypto_get_text: 'data_value',
  crypto_bit_length: 'data_bit_length',
  crypto_convert_to_int: 'data_convert_to_int',
  crypto_partition_to_array: 'arr_partition_to_array',
  crypto_load_curve_params: 'ecc_load_curve_params',
  crypto_load_point: 'ecc_load_point',
  crypto_point_double: 'ecc_point_double',
  crypto_ecc_add: 'ecc_add',
  crypto_ecc_multiply: 'ecc_multiply',
  crypto_mod_inverse: 'nt_mod_inverse',
  crypto_sm3_pad_text: 'hash_sm3_pad_text',
  crypto_sm3_pad_hex: 'hash_sm3_pad_hex',
  crypto_sm3_pad: 'hash_sm3_pad',
  crypto_sm3_compress: 'hash_sm3_compress',
  crypto_sha256_pad: 'hash_sha256_pad',
  crypto_sha256_pad_hex: 'hash_sha256_pad_hex',
  crypto_sha256_pad_text: 'hash_sha256_pad_text',
  hash_sha3_pad: 'sponge_pad',
  hash_sha3_keccak_f: 'keccak_f',
  hash_sha3_absorb: 'sponge_absorb',
  hash_sha3_squeeze: 'sponge_squeeze',
  hash_sha3_state_init: 'keccak_state_init',
};

export function migrateBlockTypesJson(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) migrateBlockTypesJson(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;
  const oldType = record.type;
  if (oldType === 'crypto_get_text' && typeof record.fields === 'object' && record.fields !== null) {
    const fields = record.fields as Record<string, unknown>;
    if ('TEXT' in fields) {
      fields.NUM = fields.TEXT;
      delete fields.TEXT;
    }
  }
  if (typeof oldType === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_TYPE_MIGRATION_MAP, oldType)) {
    record.type = BLOCK_TYPE_MIGRATION_MAP[oldType];
  }
  for (const child of Object.values(record)) migrateBlockTypesJson(child);
}

export function getMigrationMap(): Record<string, string> {
  return { ...BLOCK_TYPE_MIGRATION_MAP };
}
