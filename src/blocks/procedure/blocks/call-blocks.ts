import * as Blockly from 'blockly/core';
import { toolboxTemplates } from '../toolbox-state';
import { getActiveProjectFileId, getProjectSymbols } from '@cc/utils/project-context';
import { argsExtraState, buildCallOptions, invalidateCallOptions, loadArgsExtraState, parseArgsFromDom, procedureGetVarModels, renameVarByIdCommon, serializeArgsToDom, syncCallParams, updateVarNameCommon } from './shared';
import type { AnyBlock } from './shared';
import { TEMPLATE_PREFILL } from './template-prefill';

// ─────────────────────────────────────────────────────────
// procedures_defreturn / procedures_defnoreturn
// 完整独立实现，通过 mutateCallers 与 def 同步
// ─────────────────────────────────────────────────────────
function makeCallBlock(hasReturn: boolean): AnyBlock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CALL: Record<string, any> = {
    init: function (this: AnyBlock) {
      const msg = Blockly.Msg as Record<string, string>;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const block: AnyBlock = this;
      const title = hasReturn
        ? (msg.PROCEDURES_CALLRETURN_TITLE || 'call')
        : (msg.PROCEDURES_CALLNORETURN_TITLE || 'call');
      // NAME 用下拉：列出工作区中所有已定义函数，供用户选择调用（惰性生成，打开菜单时刷新选项）
      const nameField = new Blockly.FieldDropdown(() => buildCallOptions(block));
      nameField.setValidator(function (this: Blockly.Field, newName: string) {
        // 选择函数后同步参数
        const src = this.getSourceBlock();
        if (src && newName) {
          syncCallParams(src as AnyBlock, newName);
        }
        return newName;
      });
      this.appendDummyInput('TOPROW')
        .appendField(title)
        .appendField(nameField, 'NAME');
      if (hasReturn) {
        this.setOutput(true);
      } else {
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
      }
      this.setStyle('procedure_blocks');
      this.setColour(290);
      this.setTooltip('Call a typed crypto function.');
      this.setHelpUrl('');
      this.arguments_ = [];
      this.argumentVarModels_ = [];
      this.paramTypes_ = [];
    },
    getProcedureCall: function (this: AnyBlock): string {
      return this.getFieldValue('NAME') as string;
    },
    renameProcedure: function (this: AnyBlock, name: string, args: string[]) {
      this.setFieldValue(name, 'NAME');
      this.arguments_ = args || [];
      this.updateShape_();
    },
    updateShape_: function (this: AnyBlock) {
      for (let i = 0; i < this.arguments_.length; i++) {
        const label = this.arguments_[i] + ': ' + (this.paramTypes_[i] || 'bytes');
        const existing = this.getField('ARGNAME' + i);
        if (existing) {
          Blockly.Events.disable();
          try { existing.setValue(label); } finally { Blockly.Events.enable(); }
        } else {
          this.appendValueInput('ARG' + i)
            .setCheck(null)
            .setAlign(Blockly.inputs.Align.RIGHT)
            .appendField(label, 'ARGNAME' + i);
        }
      }
      for (let i = this.arguments_.length; this.getInput('ARG' + i); i++) {
        this.removeInput('ARG' + i);
      }
      const top = this.getInput('TOPROW');
      if (top) {
        if (this.arguments_.length) {
          if (!this.getField('WITH')) {
            top.appendField((Blockly.Msg as Record<string, string>).PROCEDURES_CALL_BEFORE_PARAMS || 'with', 'WITH');
          }
        } else if (this.getField('WITH')) {
          top.removeField('WITH');
        }
      }
    },
    // 删除联动：所引用函数被删除后自清为 unnamed（def 的 change listener 在 dispose 时被移除，
    // BLOCK_DELETE 派发时只能由 call 块侧兜底；事件异步派发，此时 def 已从工作区移除）
    onchange: function (this: AnyBlock, event: Blockly.Events.Abstract) {
      // 下拉选项缓存失效：函数定义/模板的新建、删除、改名都可能改变可选函数集合
      const evt0 = event as unknown as { element?: string; name?: string; blockId?: string };
      if (event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_DELETE) {
        invalidateCallOptions(this);
      } else if (
        event.type === Blockly.Events.BLOCK_CHANGE &&
        evt0.element === 'field'
      ) {
        const src = evt0.blockId
          ? this.workspace.getBlockById(evt0.blockId)
          : null;
        if (
          src &&
          (src.type === 'procedures_defreturn' ||
            src.type === 'procedures_defnoreturn' ||
            src.getField('FUNC_NAME') !== null)
        ) {
          invalidateCallOptions(this);
        }
      }
      if (event.type !== Blockly.Events.BLOCK_DELETE) return;
      try {
        // 性能门：仅当被删块是函数定义/模板时才扫描（普通块删除零开销，免 K×M×N 全工作区遍历）
        const delEvt = event as unknown as {
          blockId?: string;
          oldJson?: { type?: string };
        };
        if (delEvt.blockId === this.id) return;
        const deletedType = delEvt.oldJson?.type;
        if (
          deletedType !== 'procedures_defreturn' &&
          deletedType !== 'procedures_defnoreturn' &&
          !(deletedType && deletedType in TEMPLATE_PREFILL)
        ) {
          return;
        }
        const name = this.getFieldValue('NAME') as string;
        if (!name) return;
        const ws = (this.workspace as unknown as { targetWorkspace?: Blockly.Workspace }).targetWorkspace || this.workspace;
        const tuples = Blockly.Procedures.allProcedures(ws);
        const defNames = tuples[0].concat(tuples[1]).map((t) => t[0]);
        const wsTemplateNames = ws.getAllBlocks(false)
          .filter((b: Blockly.Block) => b.getField('FUNC_NAME') !== null)
          .map((b: Blockly.Block) => (b.getFieldValue('FUNC_NAME') as string) || b.type);
        // 跨文件函数也是有效定义：项目符号（其他 .block.json 里的 def）被删同名本地函数时不得清空调用
        const stillValid = defNames.includes(name) || wsTemplateNames.includes(name)
          || toolboxTemplates.value.includes(name)
          || getProjectSymbols().some(
            (symbol) => symbol.name === name && symbol.fileId !== getActiveProjectFileId(),
          );
        if (!stillValid) {
          const nameField = this.getField('NAME') as unknown as {
            doValueUpdate_?: (v: string) => void; getOptions?: (u: boolean) => Array<[string, string]>;
            selectedOption?: [string, string] | null; markDirty?: () => void; getSourceBlock?: () => Blockly.Block;
          };
          if (nameField && typeof nameField.doValueUpdate_ === 'function' && typeof nameField.getOptions === 'function') {
            // 刷新选项缓存后置值（doValueUpdate_ 内部 getOptions(true) 同步 selectedOption）
            nameField.getOptions(false);
            nameField.doValueUpdate_('');
            // '' 可能不在选项列表（其他函数存在时）——显式对齐 selectedOption 并重渲染，避免 UI 残留旧函数名
            const refreshed = nameField.getOptions(false);
            const unnamed = refreshed.find((o) => o[1] === '');
            nameField.selectedOption = unnamed || null;
            if (typeof nameField.markDirty === 'function') nameField.markDirty();
            const srcBlock = typeof nameField.getSourceBlock === 'function' ? nameField.getSourceBlock() : null;
            if (srcBlock && typeof (srcBlock as unknown as { queueRender?: () => void }).queueRender === 'function') {
              (srcBlock as unknown as { queueRender: () => void }).queueRender();
            }
          }
        }
      } catch (e) { console.warn('[procedure] call orphan cleanup failed:', e); }
    },
    mutationToDom: function (this: AnyBlock): Element {
      const container = Blockly.utils.xml.createElement('mutation');
      serializeArgsToDom(this, container);
      return container;
    },
    domToMutation: function (this: AnyBlock, xmlElement: Element) {
      // 改名传播：mutation 携带 name 时同步 NAME 字段（def 改名经 mutateCallers 到达）
      const mutatedName = xmlElement.getAttribute('name');
      if (mutatedName) {
        // 刷新下拉选项缓存（getOptions(true) 走缓存，不刷则拒绝新选项）
        const nameField = this.getField('NAME');
        if (nameField && typeof (nameField as unknown as { getOptions: (u: boolean) => unknown }).getOptions === 'function') {
          (nameField as unknown as { getOptions: (u: boolean) => unknown }).getOptions(false);
        }
        try { this.setFieldValue(mutatedName, 'NAME'); } catch (e) { console.warn('[procedure] call name sync failed:', e); }
      }
      parseArgsFromDom(this, xmlElement);
      this.updateShape_();
    },
    saveExtraState: function (this: AnyBlock): Record<string, unknown> | null {
      return argsExtraState(this);
    },
    loadExtraState: function (this: AnyBlock, state: Record<string, unknown>) {
      loadArgsExtraState(this, state);
      this.updateShape_();
    },
    getVarModels: procedureGetVarModels,
    renameVarById: function (this: AnyBlock, oldId: string, newId: string) {
      renameVarByIdCommon(this, oldId, newId, (block) => {
        block.updateShape_();
      });
    },
    updateVarName: function (this: AnyBlock, variable: Blockly.VariableModel) {
      updateVarNameCommon(this, variable, (block) => {
        block.updateShape_();
      });
    },
  };
  return CALL;
}

Blockly.Blocks['procedures_callreturn'] = makeCallBlock(true);
Blockly.Blocks['procedures_callnoreturn'] = makeCallBlock(false);

