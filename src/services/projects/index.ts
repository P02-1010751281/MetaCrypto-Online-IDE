/**
 * 项目存储组合根。
 *
 * 视图层只 import 这里的 projectStore；换实现（IndexedDB ↔ HTTP）只改这一行。
 * metacrypt_server 侧对应 frontend/src/features/blockly/services/projects/index.ts。
 */
import { indexedDbProjectStore } from './indexedDbProjectStore';

export { indexedDbProjectStore };
export { ProjectStoreCapabilityError } from './ProjectStore';
export type { ProjectId, ProjectRecord, ProjectStore } from './ProjectStore';

export const projectStore = indexedDbProjectStore;
