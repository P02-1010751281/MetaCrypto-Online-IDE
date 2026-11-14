/** scripts/lib/block-ir.mjs 的类型声明（门禁由 node 直接运行，测试里由 TS 引用）。 */

export declare const NATIVE_BLOCK_TYPES: ReadonlySet<string>;

export declare class IrError extends Error {}

export interface IrNode {
  type: string;
  fields?: Record<string, string | number>;
  extraState?: Record<string, unknown>;
  inline?: boolean;
  disabled?: boolean;
  inputs?: Record<string, IrNode>;
  next?: IrNode;
}

export interface BlockIr {
  schema: 'ciphercat.block-ir/v0';
  source?: string;
  entry: IrNode[];
}

export interface BlockIoContractEntry {
  inputs: Array<{ name: string; type: number; check: string[] | null }>;
  fields: Array<{ name: string; fieldClass?: string; options?: unknown }>;
  outputCheck: string[] | null;
  previousStatement?: unknown;
  nextStatement?: unknown;
}

export declare function flattenWorkspace(doc: unknown, source?: string): BlockIr;

export declare function assembleIr(ir: BlockIr): { blocks: { languageVersion: number; blocks: unknown[] } };

export declare function canonicalWorkspace(doc: { blocks: { blocks: unknown[] } }): unknown;

export declare function sameCanonical(left: unknown, right: unknown): boolean;

export declare function validateIr(ir: BlockIr, contract: Record<string, BlockIoContractEntry>): string[];

export declare function irStats(
  ir: BlockIr,
  contract: Record<string, BlockIoContractEntry>,
): { blocks: number; native: number; checked: number; types: number };
