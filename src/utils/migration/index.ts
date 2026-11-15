// 迁移器按职责拆分：XML 链（xml-*）、JSON 链（json-*）、两条链共用的块类型表与
// 分区模式判定。对外仍只暴露下面三个入口，引用 `@/utils/migration` 无需改动。
export { getMigrationMap } from './block-map';
export { migrateJsonState } from './json-migrate';
export { migrateXmlText } from './xml-migrate';
