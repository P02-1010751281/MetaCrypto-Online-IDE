import * as Blockly from 'blockly/core';
import { MLKEM_ENCAPS_BODY_STATE, MLKEM_ENCAPS_RETURN_STATE } from '../encaps-prefill';
import type { AnyBlock } from './shared';

interface TemplatePrefill {
  /** RETURN 表达式链：从叶子到根的块类型序列（最后一个是根）。 */
  returnChain?: string[];
  /** 链中 variables_get 引用的参数变量名。 */
  paramVarName?: string;
  /** 链块字段覆盖：blockType → { fieldName: 值 }（如 hash_hmac → { HASH: 'SM3' }）。 */
  chainFields?: Record<string, Record<string, string>>;
  /** BODY statement 预填的块 state（如 ctrl_iterate 循环）。 */
  bodyState?: Blockly.serialization.blocks.State;
  /** RETURN 预填的块 state（多语句模板的返回表达式，如 ML-KEM-Encaps 的 ret 变量引用）。 */
  returnState?: Blockly.serialization.blocks.State;
}

/** 各模板的预填内容定义。 */
export const TEMPLATE_PREFILL: Record<string, TemplatePrefill> = {
  // AES 轮：AddRoundKey(MixColumns(ShiftRows(SubBytes(state))), rk) — rk 输入留空待用户接
  proc_aes_round: {
    returnChain: ['variables_get', 'aes_sub_bytes', 'aes_shift_rows', 'aes_mix_columns', 'aes_add_round_key'],
    paramVarName: 'state',
  },
  // AES 最后一轮：AddRoundKey(ShiftRows(SubBytes(state)), rk) — rk 输入留空
  proc_aes_last_round: {
    returnChain: ['variables_get', 'aes_sub_bytes', 'aes_shift_rows', 'aes_add_round_key'],
    paramVarName: 'state',
  },
  // SHA-256：pad(msg) → compress — W/V 输入留空
  proc_sha256_hash: {
    returnChain: ['variables_get', 'hash_sha256_pad'],
    paramVarName: 'msg',
  },
  // SM3：pad(msg) → compress — W/WP/V 输入留空
  proc_sm3_hash: {
    returnChain: ['variables_get', 'hash_sm3_pad'],
    paramVarName: 'msg',
  },
  // NTT：NTT(vec)
  proc_ntt_vec: {
    returnChain: ['variables_get', 'pq_ntt'],
    paramVarName: 'vec',
  },
  // CBD 采样：SamplePolyCBD(seed) — η/q 下拉预设
  proc_pq_cbd: {
    returnChain: ['variables_get', 'pq_sample_poly_cbd'],
    paramVarName: 'seed',
  },
  // NTT 采样：SampleNTT(seed)
  proc_pq_sample: {
    returnChain: ['variables_get', 'pq_sample_ntt'],
    paramVarName: 'seed',
  },
  // 向量加法：PolyAdd(a, b) — b 输入留空
  proc_pq_vec_add: {
    returnChain: ['variables_get', 'pq_poly_add'],
    paramVarName: 'a',
  },
  // 向量减法：PolySub(a, b) — b 输入留空
  proc_pq_vec_sub: {
    returnChain: ['variables_get', 'pq_poly_sub'],
    paramVarName: 'a',
  },
  // 通用标量矩阵×向量教学示例；不是格密码多项式环运算
  proc_pq_mat_mul: {
    returnChain: ['variables_get', 'pq_mat_vec_mul'],
    paramVarName: 'mat',
  },
  // ECB：ECB-Encrypt(data, key) — key 输入留空
  proc_mode_ecb: {
    returnChain: ['variables_get', 'mode_ecb_encrypt'],
    paramVarName: 'data',
  },
  // CBC：CBC-Encrypt(data, key, iv) — key/iv 输入留空
  proc_mode_cbc: {
    returnChain: ['variables_get', 'mode_cbc_encrypt'],
    paramVarName: 'data',
  },
  // CTR：CTR-Encrypt(data, key, nonce) — key/nonce 输入留空
  proc_mode_ctr: {
    returnChain: ['variables_get', 'mode_ctr_encrypt'],
    paramVarName: 'data',
  },
  // GCM 起始骨架仅预填 CTR 核心；缺少 GHASH/认证标签，不是可用的 GCM 加密流程。
  proc_mode_gcm: {
    returnChain: ['variables_get', 'mode_ctr_encrypt'],
    paramVarName: 'data',
  },
  // PBKDF2：1000 次空循环起始骨架（password 参数）；未实现 PRF/派生计算。
  proc_pbkdf2: {
    bodyState: iterateState(1000),
    returnChain: ['variables_get'],
    paramVarName: 'password',
  },
  // HKDF：两次空循环占位（ikm 参数）；未实现 Extract/Expand 计算。
  proc_hkdf: {
    bodyState: iterateState(2),
    returnChain: ['variables_get'],
    paramVarName: 'ikm',
  },
  // 通用哈希函数：SHA-256 pad 链
  crypto_hash_func: {
    returnChain: ['variables_get', 'hash_sha256_pad'],
    paramVarName: 'message',
  },
  // 通用加密函数：ECB 链（key 输入留空）
  crypto_encrypt_func: {
    returnChain: ['variables_get', 'mode_ecb_encrypt'],
    paramVarName: 'message',
  },
  // 通用解密函数：ECB 解密链（key 输入留空）
  crypto_decrypt_func: {
    returnChain: ['variables_get', 'mode_ecb_decrypt'],
    paramVarName: 'ciphertext',
  },
  // 仅预填 sponge_squeeze(state)，outlen 留空；不是 duplex 构造。
  proc_sponge_duplex: {
    returnChain: ['variables_get', 'sponge_squeeze'],
    paramVarName: 'state',
  },
  // SM4 轮：F(state, x1, x2, x3, rk) — 仅 X0 连 state，其余留空
  proc_sm4_round: {
    returnChain: ['variables_get', 'sm4_round_func'],
    paramVarName: 'state',
  },
  // HMAC-SHA256：HMAC(key, msg) — key 连参数，msg 留空
  proc_hmac_sha256: {
    returnChain: ['variables_get', 'hash_hmac'],
    paramVarName: 'key',
  },
  // HMAC-SM3：HMAC(key, msg) — key 连参数，msg 留空，HASH 强制 SM3
  proc_sm3_hmac: {
    returnChain: ['variables_get', 'hash_hmac'],
    paramVarName: 'key',
    chainFields: { hash_hmac: { HASH: 'SM3' } },
  },
  // ML-KEM KeyGen：NTT(CBD(seed))
  proc_mlkem_keygen: {
    returnChain: ['variables_get', 'pq_sample_poly_cbd', 'pq_ntt'],
    paramVarName: 'seed',
  },
  // ML-KEM-512 Encaps：28 条 variables_set 语句全链（提取自已登记的 ML-KEM-Encaps Demo；
  // 该 Demo 现登记为项目固定回归，来源向量 ID 未登记，见 docs/standards/CONFORMANCE-INVENTORY.md）
  proc_mlkem_encaps: {
    bodyState: MLKEM_ENCAPS_BODY_STATE as Blockly.serialization.blocks.State,
    returnState: MLKEM_ENCAPS_RETURN_STATE as Blockly.serialization.blocks.State,
    paramVarName: 'ek',
  },
  // ZUC 密钥流：Keystream(key, iv, len) — key 连参数，iv/len 留空
  proc_zuc_keystream: {
    returnChain: ['variables_get', 'zuc_keystream'],
    paramVarName: 'key',
  },
  // AES 密钥扩展起始模板：10 次空循环，不计算轮密钥。
  proc_aes_key_schedule: {
    bodyState: iterateState(10),
    returnChain: ['variables_get'],
    paramVarName: 'key',
  },
  // SM4 密钥扩展起始模板：32 次空循环，不计算轮密钥。
  proc_sm4_key_schedule: {
    bodyState: iterateState(32),
    returnChain: ['variables_get'],
    paramVarName: 'key',
  },
  // 消息摘要迭代：16 轮迭代循环骨架
  proc_md_iterate: {
    bodyState: iterateState(16),
    returnChain: ['variables_get'],
    paramVarName: 'iv',
  },
};

/** 构建 RETURN 表达式链：chain 从叶子到根（如 [variables_get, aes_sub_bytes, ...]），
 *  每个新块把前一块（子）连到自己的第一个 VALUE input。返回根块。 */
function buildReturnChain(
  ws: Blockly.Workspace,
  chain: string[],
  varName: string,
  chainFields?: Record<string, Record<string, string>>,
): Blockly.BlockSvg | null {
  let root: Blockly.BlockSvg | null = null;
  let child: Blockly.BlockSvg | null = null;
  // 确保变量存在（FieldVariable 用 id 引用）
  let varModel: Blockly.IVariableModel<Blockly.IVariableState> | null = ws
    .getVariableMap()
    .getVariable(varName, '');
  if (!varModel) varModel = ws.getVariableMap().createVariable(varName, '');
  for (const type of chain) {
    const b = ws.newBlock(type) as Blockly.BlockSvg;
    if (type === 'variables_get' && varModel) {
      b.setFieldValue(varModel.getId(), 'VAR');
    }
    // 链块字段覆盖（如 hash_hmac 的 HASH 下拉）
    const fields = chainFields && chainFields[type];
    if (fields) {
      for (const [fieldName, fieldValue] of Object.entries(fields)) {
        if (b.getField(fieldName)) b.setFieldValue(fieldValue, fieldName);
      }
    }
    b.initSvg();
    if (child && child.outputConnection) {
      const valInput = b.inputList.find((i) => i.type === Blockly.inputs.inputTypes.VALUE);
      if (valInput && valInput.connection) {
        valInput.connection.connect(child.outputConnection);
      }
    }
    child = b;
    root = b;
  }
  if (root) {
    root.render();
  }
  return root;
}

/** 向模板块注入预填内容（RETURN 表达式链 / BODY 语句）。 */
export function injectPrefill(block: AnyBlock, prefill: TemplatePrefill | undefined, paramName: string) {
  if (!prefill) return;
  const ws = block.workspace;
  // 确保参数变量存在
  if (prefill.paramVarName && !ws.getVariableMap().getVariable(prefill.paramVarName, '')) {
    ws.getVariableMap().createVariable(prefill.paramVarName, '');
  }
  if (prefill.returnChain) {
    try {
      const valueBlock = buildReturnChain(ws, prefill.returnChain, prefill.paramVarName || paramName, prefill.chainFields);
      if (valueBlock) {
        const retInput = block.getInput('RETURN');
        if (retInput && valueBlock.outputConnection) {
          retInput.connection.connect(valueBlock.outputConnection);
        }
      }
    } catch (e) {
      console.warn('[prefill] ' + block.type + ' inject failed:', e);
    }
  }
  if (prefill.bodyState || prefill.returnState) {
    try {
      // 多语句预填（如 ML-KEM-Encaps）：先创建 body/return 引用的全部变量，再注入语句链
      const varRefs: string[] = [];
      if (prefill.bodyState) collectStateVariables(prefill.bodyState as unknown as Record<string, unknown>, varRefs);
      if (prefill.returnState) collectStateVariables(prefill.returnState as unknown as Record<string, unknown>, varRefs);
      for (const v of varRefs) {
        if (!ws.getVariableMap().getVariable(v, '')) ws.getVariableMap().createVariable(v, '');
      }
      if (prefill.bodyState) {
        const state = JSON.parse(JSON.stringify(prefill.bodyState));
        const bodyBlock = Blockly.serialization.blocks.append(
          state as Blockly.serialization.blocks.State,
          ws,
        ) as unknown as Blockly.BlockSvg | null;
        if (bodyBlock) {
          bodyBlock.initSvg();
          bodyBlock.render();
          const bodyInput = block.getInput('BODY');
          if (bodyInput && bodyBlock.previousConnection) {
            bodyInput.connection.connect(bodyBlock.previousConnection);
          }
        }
      }
      if (prefill.returnState) {
        const rstate = JSON.parse(JSON.stringify(prefill.returnState));
        const retBlock = Blockly.serialization.blocks.append(
          rstate as Blockly.serialization.blocks.State,
          ws,
        ) as unknown as Blockly.BlockSvg | null;
        if (retBlock) {
          retBlock.initSvg();
          retBlock.render();
          const retInput = block.getInput('RETURN');
          if (retInput && retBlock.outputConnection) {
            retInput.connection.connect(retBlock.outputConnection);
          }
        }
      }
    } catch (e) {
      console.warn('[prefill] ' + block.type + ' multi-state inject failed:', e);
    }
  }
  if (prefill.bodyState === undefined && prefill.returnState === undefined && prefill.returnChain === undefined) {
    // 无预填：保持骨架
  }
}

/** 收集 serialization state 中的变量引用（variables_set/get VAR + ctrl_iterate VAR）。 */
function collectStateVariables(state: Record<string, unknown>, out: string[]) {
  const fields = state.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields.VAR === 'object' && fields.VAR !== null) {
    const v = (fields.VAR as { id?: string }).id;
    if (v && !out.includes(v)) out.push(v);
  }
  if (fields && typeof fields.VAR === 'string' && !out.includes(fields.VAR)) out.push(fields.VAR);
  const inputs = state.inputs as Record<string, { block?: Record<string, unknown> }> | undefined;
  if (inputs) {
    for (const inp of Object.values(inputs)) {
      if (inp && inp.block) collectStateVariables(inp.block, out);
    }
  }
  const next = state.next as { block?: Record<string, unknown> } | undefined;
  if (next && next.block) collectStateVariables(next.block, out);
}

/** 构建 ctrl_iterate 循环块 state（BODY 预填用）。TIMES 是值输入，用 math_number 影子块表达次数。 */
function iterateState(times: number, varName = 'i', bodyBlocks?: Blockly.serialization.blocks.State[]): Blockly.serialization.blocks.State {
  const state: Record<string, unknown> = {
    type: 'ctrl_iterate',
    fields: { VAR: varName },
    inputs: {
      TIMES: { shadow: { type: 'data_value', fields: { NUM: String(times) } } },
    },
  };
  if (bodyBlocks && bodyBlocks.length) {
    (state.inputs as Record<string, unknown>).DO = { block: bodyBlocks[0] };
    for (let i = 0; i < bodyBlocks.length - 1; i++) {
      const b = bodyBlocks[i];
      const next = bodyBlocks[i + 1];
      const rec = b as unknown as { next?: { block: Blockly.serialization.blocks.State } };
      rec.next = { block: next };
    }
  }
  return state as unknown as Blockly.serialization.blocks.State;
}
