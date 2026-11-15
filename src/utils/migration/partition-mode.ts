const LEGACY_BYTE_TARGETS = new Set(['B', 'Block', 'padded', 'data', 'state']);

export function legacyPartitionMode(target: string | undefined): 'BYTES' | 'WORDS32' {
  return target && LEGACY_BYTE_TARGETS.has(target.trim()) ? 'BYTES' : 'WORDS32';
}
