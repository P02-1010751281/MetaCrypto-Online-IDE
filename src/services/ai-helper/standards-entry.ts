/**
 * A 线入口要展示给用户的那份「可选/已选」视图数据。
 *
 * 单拎成模块的原因：`<script setup>` 不能导出类型，而条目数据要同时被
 * `StandardsEntryBar`（渲染）与 `StandardsToWorkspacePanel`（选中后取判据）用到。
 *
 * `sha256` 是登记原文的哈希，只有它才支持「文件核对」；缺了这一项就明说无法核对，
 * 不退化成「看着像就选中」。
 */
export interface EntryStandard {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly checkedAt?: string;
  readonly sha256?: string;
  readonly path?: string;
}

/** 面板给条目的提示：命中（附命中的编号）或没认出（让用户自己选）。 */
export interface EntryNote {
  readonly tone: 'hit' | 'miss';
  readonly text: string;
}
