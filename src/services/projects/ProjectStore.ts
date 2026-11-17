/**
 * 项目存储端口（ProjectStore）—— IDE 与「项目怎么存」之间的唯一缝。
 *
 * 视图层（项目列表、编辑器保存/加载）只依赖本接口，具体实现由各宿主提供：
 * - MetaCrypto Online IDE（单机/桌面）：IndexedDB，见 ./indexedDbProjectStore.ts
 * - metacrypt_server（服务器）：HTTP 后端，见
 *   frontend/src/features/blockly/services/projects/httpProjectStore.ts
 *
 * 本文件是端口的唯一权威源；metacrypt_server 侧副本由
 * scripts/sync-to-metacrypt.sh 镜像生成，改动请先改这里。
 */

export type ProjectId = number | string;

/**
 * 项目内的一个积木文件。
 *
 * 单机版（MetaCrypto Online IDE）一个项目可以有多个 block 文件，编译时按文件拼成一份代码；
 * metacrypt 侧有自己的 ProjectFile（含 kind/content/version），不复用本结构。
 */
export interface ProjectFileRecord {
  fileId: string;
  /** 展示名，同时作为代码注释里的 file 标签，如 main.block.json */
  name: string;
  /** 工作区负载（JSON/XML 文本），与 ProjectRecord.workspace 同格式 */
  workspace: string;
  format?: 'json' | 'xml';
  /** 入口文件：只有它注入 primitives，生成顺序也排在最后 */
  isEntry?: boolean;
}

export interface ProjectRecord<TId extends ProjectId = number> {
  id?: TId;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 单文件工作区负载（XML/JSON 文本）。
   * 多文件项目里它保存「入口文件」的负载，兼容只认单文件的旧读取方；
   * 多文件/多语言后端可以留空；此时 save() 不应尝试写入它。
   */
  workspace?: string;
  format?: 'json' | 'xml';
  /** 多文件项目的文件清单（单文件项目可缺省，读取时视为一个入口文件）。 */
  files?: ProjectFileRecord[];
  /** 多文件项目的入口文件 id；缺省取 files 中 isEntry 或第一个文件。 */
  entryFileId?: string;
  /** 后端附加的元数据（单机版不使用）。 */
  metadata?: Record<string, unknown>;
}

export interface ProjectStore<TId extends ProjectId = number> {
  list(): Promise<ProjectRecord<TId>[]>;
  get(id: TId): Promise<ProjectRecord<TId> | undefined>;
  save(record: ProjectRecord<TId>): Promise<TId>;
  rename(id: TId, name: string): Promise<void>;
  remove(id: TId): Promise<void>;
  /** 释放底层连接（IndexedDB 用；HTTP 实现可不提供）。 */
  close?(): void | Promise<void>;
}

/**
 * 端口能力边界：某个实现不支持该操作时抛此错误，
 * 让上层做显式降级或提示，而不是静默吞掉或写坏数据。
 */
export class ProjectStoreCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectStoreCapabilityError';
  }
}
