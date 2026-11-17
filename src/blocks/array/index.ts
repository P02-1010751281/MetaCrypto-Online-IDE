export * from './append';
export * from './partition';
export * from './slice';

import { APPEND_BLOCK_TYPES, type AppendBlockType } from './append';
import { PARTITION_BLOCK_TYPES, type PartitionBlockType } from './partition';
import { SLICE_BLOCK_TYPES, type SliceBlockType } from './slice';

export const ARRAY_BLOCK_TYPES = [
  ...APPEND_BLOCK_TYPES,
  ...PARTITION_BLOCK_TYPES,
  ...SLICE_BLOCK_TYPES,
] as const;

export type ArrayBlockType = AppendBlockType | PartitionBlockType | SliceBlockType;
