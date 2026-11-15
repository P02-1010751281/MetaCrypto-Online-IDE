/**
 * 密码学函数封装积木块定义
 *
 * 策略：完整独立实现增强版 procedure 块，直接注册到 Blockly 原生块名
 * （procedures_defreturn 等），覆盖原生注册。不 Object.assign 原生定义——
 * 全部方法自包含，参数带密码学类型下拉（bytes/int/int_list/...）。
 * 兼容原生 flyout / mutateCallers / 序列化 / toolbox。
 */

// 注册顺序即 import 顺序，不可调整：
//   定义块、调用块必须先于模板块注册 —— 模板块的 rename 联动与 call 下拉
//   都要能解析到 procedures_def*/procedures_call*。
import 'blockly/blocks';
import './basic-blocks';
import './mutator-blocks';
import './def-blocks';
import './call-blocks';
import './template-blocks';

export {
  PROCEDURE_BLOCK_TYPES,
  CRYPTO_PARAM_TYPES,
  TEMPLATE_REGISTRY,
} from './shared';
export type { ProcedureBlockType, TemplateInfo } from './shared';
export { TEMPLATE_TYPES } from './template-blocks';
