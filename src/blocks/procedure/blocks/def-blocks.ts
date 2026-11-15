import * as Blockly from 'blockly/core';
import { argsExtraState, loadArgsExtraState, parseArgsFromDom, procedureGetVarModels, renameVarByIdCommon, serializeArgsToDom, updateVarNameCommon } from './shared';
import type { AnyBlock } from './shared';

function makeDefBlock(hasReturn: boolean): AnyBlock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DEF: Record<string, any> = {
    init: function (this: AnyBlock) {
      const msg = Blockly.Msg as Record<string, string>;
      const title = hasReturn
        ? (msg.PROCEDURES_DEFRETURN_TITLE || 'to')
        : (msg.PROCEDURES_DEFNORETURN_TITLE || 'to do');
      const nameField = new Blockly.FieldTextInput(
        Blockly.Procedures.findLegalName('', this),
      );
      nameField.setValidator(Blockly.Procedures.rename);
      nameField.setSpellcheck(false);
      this.appendDummyInput()
        .appendField(title)
        .appendField(nameField, 'NAME')
        .appendField('', 'PARAMS');
      if (hasReturn) {
        this.appendValueInput('RETURN')
          .setCheck(null)
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField(msg.PROCEDURES_DEFRETURN_RETURN || 'return');
      }
      this.setMutator(new Blockly.icons.MutatorIcon(['procedures_mutatorarg'], this));
      this.setStyle('procedure_blocks');
      this.setColour(290);
      this.setTooltip(msg.CRYPTO_PROCEDURES_TEMPLATE_TOOLTIP || 'A crypto function with typed parameters.');
      this.setHelpUrl('');
      this.arguments_ = [];
      this.argumentVarModels_ = [];
      this.paramTypes_ = [];
      this.paramIds_ = [];
      this.setStatements_(true);
      this.statementConnection_ = null;
    },
    getProcedureDef: function (this: AnyBlock): [string, string[], boolean] {
      return [this.getFieldValue('NAME') as string, this.arguments_, hasReturn];
    },
    updateParams_: function (this: AnyBlock) {
      const msg = Blockly.Msg as Record<string, string>;
      const before = msg.PROCEDURES_BEFORE_PARAMS || 'with';
      const parts = this.arguments_.map((name: string, i: number) =>
        name + ': ' + (this.paramTypes_[i] || 'bytes'));
      const label = parts.length ? before + ' ' + parts.join(', ') : '';
      Blockly.Events.disable();
      try { this.setFieldValue(label, 'PARAMS'); } finally { Blockly.Events.enable(); }
    },
    setStatements_: function (this: AnyBlock, hasStatements: boolean) {
      if (this.hasStatements_ === hasStatements) return;
      if (hasStatements) {
        this.appendStatementInput('STACK')
          .appendField((Blockly.Msg as Record<string, string>).PROCEDURES_DEFRETURN_DO || 'do');
        if (this.getInput('RETURN')) this.moveInputBefore('STACK', 'RETURN');
      } else {
        this.removeInput('STACK', true);
      }
      this.hasStatements_ = hasStatements;
    },
    mutationToDom: function (this: AnyBlock, opt_saveId?: boolean): Element {
      const container = Blockly.utils.xml.createElement('mutation');
      if (opt_saveId) container.setAttribute('name', (this.getFieldValue('NAME') as string) || '');
      serializeArgsToDom(this, container, opt_saveId);
      if (this.hasStatements_ === false) container.setAttribute('statements', 'false');
      return container;
    },
    domToMutation: function (this: AnyBlock, xmlElement: Element) {
      parseArgsFromDom(this, xmlElement);
      this.updateParams_();
      Blockly.Procedures.mutateCallers(this);
      this.setStatements_((xmlElement.getAttribute('statements') !== 'false'));
    },
    decompose: function (this: AnyBlock, workspace: Blockly.Workspace): Blockly.Block {
      const topBlock = workspace.newBlock('procedures_mutatorcontainer');
      (topBlock as Blockly.BlockSvg).initSvg();
      let connection = topBlock.getInput('STACK')?.connection ?? null;
      for (let i = 0; i < this.arguments_.length; i++) {
        const argBlock = workspace.newBlock('procedures_mutatorarg');
        argBlock.setFieldValue(this.arguments_[i], 'NAME');
        argBlock.setFieldValue(this.paramTypes_[i] || 'bytes', 'PARAM_TYPE');
        (argBlock as Blockly.BlockSvg).initSvg();
        if (connection && argBlock.previousConnection) connection.connect(argBlock.previousConnection);
        connection = argBlock.nextConnection;
      }
      Blockly.Procedures.mutateCallers(this);
      return topBlock;
    },
    compose: function (this: AnyBlock, topBlock: Blockly.Block) {
      this.arguments_ = [];
      this.paramIds_ = [];
      this.argumentVarModels_ = [];
      this.paramTypes_ = [];
      let block: Blockly.Block | null = topBlock.getInputTargetBlock('STACK');
      while (block && !block.isInsertionMarker()) {
        const name = (block.getFieldValue('NAME') as string) || '';
        const type = (block.getFieldValue('PARAM_TYPE') as string) || 'bytes';
        this.arguments_.push(name);
        this.paramTypes_.push(type);
        this.paramIds_.push(block.id);
        const v = Blockly.Variables.getOrCreateVariablePackage(this.workspace, block.id, name, '') as unknown as Blockly.VariableModel | null;
        if (v) this.argumentVarModels_.push(v);
        else console.warn(`Failed to create variable "${name}", ignoring.`);
        block = block.getNextBlock();
      }
      this.updateParams_();
      Blockly.Procedures.mutateCallers(this);
    },
    saveExtraState: function (this: AnyBlock): Record<string, unknown> | null {
      if (!this.argumentVarModels_.length && this.hasStatements_ !== false) return null;
      const state: Record<string, unknown> = {};
      const paramsState = argsExtraState(this);
      if (paramsState) state.params = paramsState.params;
      if (this.hasStatements_ === false) state.hasStatements = false;
      return state;
    },
    loadExtraState: function (this: AnyBlock, state: Record<string, unknown>) {
      loadArgsExtraState(this, state);
      this.updateParams_();
      Blockly.Procedures.mutateCallers(this);
      if (state.hasStatements === false) this.setStatements_(false);
    },
    getVarModels: procedureGetVarModels,
    renameVarById: function (this: AnyBlock, oldId: string, newId: string) {
      renameVarByIdCommon(this, oldId, newId, (block, oldName, newName) => {
        block.displayRenamedVar_(oldName, newName);
        Blockly.Procedures.mutateCallers(block);
      });
    },
    updateVarName: function (this: AnyBlock, variable: Blockly.VariableModel) {
      updateVarNameCommon(this, variable, (block, oldName) => {
        block.displayRenamedVar_(oldName, variable.getName());
        Blockly.Procedures.mutateCallers(block);
      });
    },
    displayRenamedVar_: function (this: AnyBlock, oldName: string, newName: string) {
      this.updateParams_();
      const icon = this.getIcon(Blockly.icons.MutatorIcon.TYPE) as unknown as {
        bubbleIsVisible: () => boolean; getWorkspace: () => Blockly.WorkspaceSvg | null;
      };
      if (icon && icon.bubbleIsVisible()) {
        const ws = icon.getWorkspace();
        if (ws) {
          for (const b of ws.getAllBlocks(false)) {
            if (b.type === 'procedures_mutatorarg' &&
                Blockly.Names.equals(oldName, b.getFieldValue('NAME') as string)) {
              b.setFieldValue(newName, 'NAME');
            }
          }
        }
      }
    },
    // 生命周期联动：改名（BLOCK_CHANGE field NAME）按旧名匹配 call 块并同步（删除由 call 块侧 onchange 处理——
    // def 的 change listener 在 dispose 时被移除，BLOCK_DELETE 派发时 def 侧已收不到）
    onchange: function (this: AnyBlock, event: Blockly.Events.Abstract) {
      const evt = event as unknown as { blockId?: string; element?: string; name?: string; oldValue?: string; newValue?: string };
      if (evt.blockId !== this.id) return;
      if (event.type !== Blockly.Events.BLOCK_CHANGE) return;
      if (evt.element !== 'field' || evt.name !== 'NAME') return;
      // mutateCallers 按新名匹配会落空（callers 仍为旧名），直接用事件 oldValue 匹配并同步
      const oldName = evt.oldValue;
      const newName = evt.newValue;
      try {
        if (oldName && newName && oldName !== newName) {
          for (const b of this.workspace.getAllBlocks(false)) {
            if ((b.type === 'procedures_callreturn' || b.type === 'procedures_callnoreturn') &&
                (b.getFieldValue('NAME') as string) === oldName) {
              // 刷新下拉选项缓存（getOptions(true) 走缓存，不刷则拒绝新选项）
              const nameField = b.getField('NAME') as unknown as { getOptions?: (u: boolean) => unknown };
              if (nameField && typeof nameField.getOptions === 'function') {
                nameField.getOptions(false);
              }
              b.setFieldValue(newName, 'NAME');
            }
          }
        }
        // 参数同步（改名后 callers 已更新，mutateCallers 可匹配）
        Blockly.Procedures.mutateCallers(this);
      } catch (e) { console.warn('[procedure] rename propagation failed:', e); }
    },
  };

  DEF.callType_ = hasReturn ? 'procedures_callreturn' : 'procedures_callnoreturn';
  return DEF;
}

Blockly.Blocks['procedures_defreturn'] = makeDefBlock(true);
Blockly.Blocks['procedures_defnoreturn'] = makeDefBlock(false);

