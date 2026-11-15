import * as Blockly from 'blockly/core';
import { CRYPTO_PARAM_TYPES, TEMPLATE_REGISTRY, identifierValidator, syncCallParams } from './shared';
import type { AnyBlock } from './shared';
import { TEMPLATE_PREFILL, injectPrefill } from './template-prefill';

// ─────────────────────────────────────────────────────────
// Template blocks (single-param inline)
// ─────────────────────────────────────────────────────────
function _makeTemplateBlock(
  presetName: string, paramName: string | { name: string; type: string }[], paramType: string, label: string,
  category: string,
): void {
  const paramsArr = Array.isArray(paramName)
    ? paramName
    : [{ name: paramName, type: paramType }];
  TEMPLATE_REGISTRY[presetName] = {
    name: presetName,
    paramName: paramsArr[0].name,
    paramType: paramsArr[0].type,
    category,
    params: paramsArr.length > 1 ? paramsArr : undefined,
  };
  const msg = Blockly.Msg as Record<string, string>;
  Blockly.Blocks[presetName] = {
    init: function () {
      const funcNameField = new Blockly.FieldTextInput(presetName);
      funcNameField.setValidator(identifierValidator);
      funcNameField.setSpellcheck(false);
      this.appendDummyInput('NAME_INPUT')
        .appendField(label)
        .appendField(funcNameField, 'FUNC_NAME');
      // 多参数模板：每参数一行 PARAM_NAME_i/PARAM_TYPE_i（生成器/syncCallParams 按字段存在性探测）
      const usesIndexedParams = paramsArr.length > 1;
      (usesIndexedParams ? paramsArr : []).forEach((p, i) => {
        const pf = new Blockly.FieldTextInput(p.name);
        const typeField = new Blockly.FieldDropdown(CRYPTO_PARAM_TYPES);
        pf.setValidator(identifierValidator);
        pf.setSpellcheck(false);
        const row = this.appendDummyInput('PARAM_INPUT_' + i);
        if (i === 0) row.appendField(msg.CRYPTO_PROCEDURES_PARAM_MSG || 'param:');
        row.appendField(pf, 'PARAM_NAME_' + i)
          .appendField(':')
          .appendField(typeField, 'PARAM_TYPE_' + i);
        typeField.setValue(p.type);
      });
      // 单参数模板：保留原生 PARAM_NAME/PARAM_TYPE 字段（call 同步/生成器兼容）
      if (paramsArr.length === 1) {
        const paramNameField = new Blockly.FieldTextInput(paramsArr[0].name);
        const paramTypeField = new Blockly.FieldDropdown(CRYPTO_PARAM_TYPES);
        paramNameField.setValidator(identifierValidator);
        paramNameField.setSpellcheck(false);
        this.appendDummyInput('PARAM_INPUT')
          .appendField(msg.CRYPTO_PROCEDURES_PARAM_MSG || 'param:')
          .appendField(paramNameField, 'PARAM_NAME')
          .appendField(':')
          .appendField(paramTypeField, 'PARAM_TYPE');
        paramTypeField.setValue(paramsArr[0].type);
      }
      this.appendStatementInput('BODY').setCheck(null).appendField(msg.CRYPTO_ITERATE_DO || 'Do');
      this.appendValueInput('RETURN').setCheck(null).appendField(msg.PROCEDURES_DEFRETURN_RETURN || '\u2699 return');
      this.setInputsInline(false);
      this.setColour(290);
      this.setTooltip(msg.CRYPTO_PROCEDURES_TEMPLATE_TOOLTIP || 'Pre-configured crypto function template.');
      this.setHelpUrl('');
    },
    onchange: function (event: Blockly.Events.Abstract) {
      // 改名联动：模板 FUNC_NAME 变更 → 同步引用 call 块（与 def 改名同路径）。
      // 模板参数在注册表存默认名，改名后按新名查不到，必须按模板块实际 PARAM_NAME/PARAM_TYPE 重建。
      const evt = event as unknown as {
        blockId?: string; element?: string; name?: string; oldValue?: string; newValue?: string;
      };
      if (
        evt.blockId === this.id &&
        event.type === Blockly.Events.BLOCK_CHANGE &&
        evt.element === 'field' &&
        evt.name === 'FUNC_NAME' &&
        evt.oldValue && evt.newValue && evt.oldValue !== evt.newValue
      ) {
        try {
          for (const b of (this as unknown as Blockly.Block).workspace.getAllBlocks(false)) {
            if ((b.type === 'procedures_callreturn' || b.type === 'procedures_callnoreturn') &&
                (b.getFieldValue('NAME') as string) === evt.oldValue) {
              // 刷新下拉选项缓存（getOptions(true) 走缓存，不刷则拒绝新选项）
              const nameField = b.getField('NAME') as unknown as { getOptions?: (u: boolean) => unknown };
              if (nameField && typeof nameField.getOptions === 'function') nameField.getOptions(false);
              b.setFieldValue(evt.newValue, 'NAME');
              syncCallParams(b as AnyBlock, evt.newValue);
            }
          }
        } catch (e) { console.warn('[procedure] template rename propagation failed:', e); }
        return;
      }
      // 拖出到主 workspace 后注入预填内容（flyout 预览不展开，保持紧凑）
      const self = this as unknown as { __prefilled?: boolean; isInFlyout?: boolean };
      if (self.isInFlyout) return;
      if (self.__prefilled) return;
      // 防御：RETURN 或 BODY 已有内容视为已注入（兼容旧损坏工作区，防止二次注入）
      const retInput = (this as unknown as Blockly.Block).getInput('RETURN');
      const bodyInput = (this as unknown as Blockly.Block).getInput('BODY');
      if (
        (retInput && retInput.connection && retInput.connection.targetBlock()) ||
        (bodyInput && bodyInput.connection && bodyInput.connection.targetBlock())
      ) {
        self.__prefilled = true;
        return;
      }
      self.__prefilled = true;
      injectPrefill(this as unknown as AnyBlock, TEMPLATE_PREFILL[presetName], paramsArr[0].name);
    },
    // 预填标记随序列化持久化：保存→重载后 onchange 不再重复注入
    saveExtraState: function (this: Blockly.Block) {
      const self = this as unknown as { __prefilled?: boolean };
      return self.__prefilled ? { prefilled: true } : null;
    },
    loadExtraState: function (this: Blockly.Block, state: Record<string, unknown>) {
      const self = this as unknown as { __prefilled?: boolean };
      if (state && state.prefilled) self.__prefilled = true;
    },
  };
}

_makeTemplateBlock('crypto_encrypt_func', 'message', 'message', Blockly.Msg.CRYPTO_PROCEDURES_ENCRYPT_LABEL || '🔐 encrypt', 'base');
_makeTemplateBlock('crypto_decrypt_func', 'ciphertext', 'message', Blockly.Msg.CRYPTO_PROCEDURES_DECRYPT_LABEL || '🔓 decrypt', 'base');
_makeTemplateBlock('crypto_hash_func', 'message', 'message', Blockly.Msg.CRYPTO_PROCEDURES_HASH_LABEL || '#️⃣ hash', 'base');

const MSG = Blockly.Msg as Record<string, string>;
_makeTemplateBlock('proc_aes_round', 'state', 'int_list', MSG.PROC_AES_ROUND_LABEL || '🔧 AES_Round', 'symmetric');
_makeTemplateBlock('proc_aes_last_round', 'state', 'int_list', MSG.PROC_AES_LAST_ROUND_LABEL || '🔧 AES_LastRound', 'symmetric');
_makeTemplateBlock('proc_aes_key_schedule', 'key', 'bytes', MSG.PROC_AES_KEY_SCHEDULE_LABEL || '🔧 AES_KeySchedule', 'symmetric');
_makeTemplateBlock('proc_sm4_round', 'state', 'int_list', MSG.PROC_SM4_ROUND_LABEL || '🔧 SM4_Round', 'symmetric');
_makeTemplateBlock('proc_sm4_key_schedule', 'key', 'bytes', MSG.PROC_SM4_KEY_SCHEDULE_LABEL || '🔧 SM4_KeySchedule', 'symmetric');
_makeTemplateBlock('proc_sha256_hash', 'msg', 'message', MSG.PROC_SHA256_HASH_LABEL || '🔧 SHA256_Hash', 'hash');
_makeTemplateBlock('proc_sm3_hash', 'msg', 'message', MSG.PROC_SM3_HASH_LABEL || '🔧 SM3_Hash', 'hash');
_makeTemplateBlock('proc_hmac_sha256', 'key', 'bytes', MSG.PROC_HMAC_SHA256_LABEL || '🔧 HMAC_SHA256', 'hash');
_makeTemplateBlock('proc_sm3_hmac', 'key', 'bytes', MSG.PROC_SM3_HMAC_LABEL || '🔧 HMAC_SM3', 'hash');
_makeTemplateBlock('proc_pbkdf2', 'password', 'bytes', MSG.PROC_PBKDF2_LABEL || '🔧 PBKDF2', 'hash');
_makeTemplateBlock('proc_hkdf', 'ikm', 'bytes', MSG.PROC_HKDF_LABEL || '🔧 HKDF', 'hash');
_makeTemplateBlock('proc_md_iterate', 'iv', 'int_list', MSG.PROC_MD_ITERATE_LABEL || '🔧 MD_Iterate', 'pqc');
_makeTemplateBlock('proc_sponge_duplex', 'state', 'int_list', MSG.PROC_SPONGE_DUPLEX_LABEL || '🔧 Sponge_Duplex', 'pqc');
_makeTemplateBlock('proc_mlkem_keygen', 'seed', 'seed', MSG.PROC_MLKEM_KEYGEN_LABEL || '🔧 ML_KEM_KeyGen', 'pqc');
_makeTemplateBlock('proc_mlkem_encaps', [{ name: 'ek', type: 'bytes' }, { name: 'm', type: 'bytes' }], 'bytes', MSG.PROC_MLKEM_ENCAPS_LABEL || '🔧 ML_KEM_Encaps', 'pqc');
_makeTemplateBlock('proc_zuc_keystream', 'key', 'bytes', MSG.PROC_ZUC_KEYSTREAM_LABEL || '🔧 ZUC_Keystream', 'zuc');
_makeTemplateBlock('proc_mode_ecb', 'data', 'bytes', MSG.PROC_MODE_ECB_LABEL || '🔧 ECB', 'mode');
_makeTemplateBlock('proc_mode_cbc', 'data', 'bytes', MSG.PROC_MODE_CBC_LABEL || '🔧 CBC', 'mode');
_makeTemplateBlock('proc_mode_ctr', 'data', 'bytes', MSG.PROC_MODE_CTR_LABEL || '🔧 CTR', 'mode');
_makeTemplateBlock('proc_mode_gcm', 'data', 'bytes', MSG.PROC_MODE_GCM_LABEL || '🔧 GCM', 'mode');
_makeTemplateBlock('proc_ntt_vec', 'vec', 'int_list', MSG.PROC_NTT_VEC_LABEL || '🔧 NTT_Vec', 'pqc');
_makeTemplateBlock('proc_pq_cbd', 'seed', 'seed', MSG.PROC_PQ_CBD_LABEL || '🔧 CBD_NTT_Vec', 'pqc');
_makeTemplateBlock('proc_pq_mat_mul', 'mat', 'int_list', MSG.PROC_PQ_MAT_MUL_LABEL || '🔧 Scalar_Mat×Vec', 'pqc');
_makeTemplateBlock('proc_pq_sample', 'seed', 'seed', MSG.PROC_PQ_SAMPLE_LABEL || '🔧 SampleNTT_Mat', 'pqc');
_makeTemplateBlock('proc_pq_vec_add', 'a', 'int_list', MSG.PROC_PQ_VEC_ADD_LABEL || '🔧 Vec_Add', 'pqc');
_makeTemplateBlock('proc_pq_vec_sub', 'a', 'int_list', MSG.PROC_PQ_VEC_SUB_LABEL || '🔧 Vec_Sub', 'pqc');

/** 模板类型清单（单一数据源，派生自注册表；生成器/面板从此导入）。 */
export const TEMPLATE_TYPES: readonly string[] = Object.keys(TEMPLATE_REGISTRY);
