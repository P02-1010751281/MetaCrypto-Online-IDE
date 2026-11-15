// @vitest-environment jsdom
/**
 * 原生列表块 ↔ 密码学类型桥接（R2）的连接判定。
 *
 * 断言的是「真的能连上」而不是「常量表里写了什么」：
 * 用 Blockly 自己的 connectionChecker 判定，与界面拖拽走同一条路径。
 */

import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '@/blocks/list-bridge';

// 原生列表块的标题走 %{BKY_*} 插值；没有语言包时 jsonInit 会因占位符无法展开而抛
// 「Message does not reference all N arg(s)」——那是测试环境问题，与应用行为无关。
Blockly.setLocale(En as unknown as Record<string, string>);

describe('Blockly 原生列表块桥接', () => {
  let workspace: Blockly.Workspace;

  beforeEach(() => {
    workspace = new Blockly.Workspace();
    // 测试用密码槽位：分别声明 Bytes / IntList / SBox / Number 四种期望。
    for (const type of ['Bytes', 'IntList', 'SBox', 'Number'] as const) {
      Blockly.Blocks[`__slot_${type}`] = {
        init(this: Blockly.Block) {
          this.appendValueInput('INPUT').setCheck(type);
          this.setOutput(true, type);
        },
      };
    }
  });

  afterEach(() => {
    workspace.dispose();
  });

  function canConnect(outputBlockType: string, inputBlockType: string): boolean {
    const output = workspace.newBlock(outputBlockType);
    const input = workspace.newBlock(inputBlockType);
    return workspace.connectionChecker.canConnect(
      output.outputConnection,
      input.getInput('INPUT')?.connection ?? null,
      false,
    );
  }

  it('lists_repeat 能接进 Bytes / IntList / SBox 槽位', () => {
    expect(canConnect('lists_repeat', '__slot_Bytes')).toBe(true);
    expect(canConnect('lists_repeat', '__slot_IntList')).toBe(true);
    expect(canConnect('lists_repeat', '__slot_SBox')).toBe(true);
  });

  it('负控制：Number 槽位仍然拒绝列表输出', () => {
    expect(canConnect('lists_repeat', '__slot_Number')).toBe(false);
  });

  it('负控制：只拓宽接受 Array 的端口——lists_repeat 的 NUM 仍是 Number', () => {
    const repeat = workspace.newBlock('lists_repeat');
    const numCheck = repeat.getInput('NUM')?.connection?.getCheck() ?? [];
    expect(numCheck).toContain('Number');
    expect(numCheck).not.toContain('Bytes');
  });

  it('lists_split 切到 JOIN 后 INPUT 也被桥接（钩子包装生效）', () => {
    const split = workspace.newBlock('lists_split');
    split.setFieldValue('JOIN', 'MODE');
    const check = split.getInput('INPUT')?.connection?.getCheck() ?? [];
    expect(check).toContain('Bytes');
    expect(check).toContain('IntList');
  });

  it('列表输出可接进 lists_length 的 VALUE', () => {
    const createWith = workspace.newBlock('lists_create_with');
    const length = workspace.newBlock('lists_length');
    expect(
      workspace.connectionChecker.canConnect(
        createWith.outputConnection,
        length.getInput('VALUE')?.connection ?? null,
        false,
      ),
    ).toBe(true);
  });

  it('桥接是幂等的：重复应用不会让 check 无限增长', () => {
    const repeat = workspace.newBlock('lists_repeat') as Blockly.Block & {
      init: () => void;
    };
    repeat.init();
    const after = repeat.outputConnection?.getCheck() ?? [];
    expect(after.filter((type) => type === 'Bytes')).toHaveLength(1);
  });
});
