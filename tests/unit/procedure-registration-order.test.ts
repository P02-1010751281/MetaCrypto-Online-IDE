// @vitest-environment jsdom
/**
 * procedure 块注册顺序的常驻断言。
 *
 * 背景：这些块原先写在单个 blocks.ts 里，注册顺序由文件自上而下的语句顺序保证；
 * 拆成 basic/mutator/def/call/template 五个模块后，顺序改由 blocks/index.ts 的
 * import 先后决定。ESM 按 import 声明顺序求值，所以「顺序」这件事在源码里是一行
 * import，谁把它调到前面都不会编译报错，只会在运行时表现为「模板块先于定义块注册」
 * —— 已知症状是加载项目时 procedures_callreturn 的 NAME 下拉拒绝取值并打印
 * "Cannot set the dropdown's value to an unavailable option"。
 *
 * 因此这里同时钉三层：
 *   1. index.ts 的副作用 import 序列（顺序的唯一真源，只能静态断言）；
 *   2. 运行时模板块确实按 TEMPLATE_TYPES 的顺序落进 Blockly.Blocks；
 *   3. procedures_def 与 procedures_call 两族仍是本仓库的覆盖实现，而非 Blockly 原生。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import { describe, expect, it } from 'vitest';

import '@/blocks/procedure/blocks';
import { TEMPLATE_REGISTRY, TEMPLATE_TYPES } from '@/blocks/procedure/blocks';

const INDEX_FILE = 'src/blocks/procedure/blocks/index.ts';

/** 注册顺序的唯一定义处：index.ts 里的副作用 import 序列。 */
function sideEffectImports(): string[] {
  const source = readFileSync(resolve(process.cwd(), INDEX_FILE), 'utf-8');
  return [...source.matchAll(/^import\s+'([^']+)';$/gm)].map((m) => m[1]);
}

function initSource(type: string): string {
  const def = Blockly.Blocks[type] as unknown as { init?: () => void };
  return typeof def?.init === 'function' ? String(def.init) : '';
}

describe('procedure 块注册顺序', () => {
  it('index.ts 按「原生 → 基本块 → mutator → 定义块 → 调用块 → 模板块」的顺序求值', () => {
    expect(sideEffectImports()).toEqual([
      'blockly/blocks',
      './basic-blocks',
      './mutator-blocks',
      './def-blocks',
      './call-blocks',
      './template-blocks',
    ]);
  });

  it('模板块按 TEMPLATE_TYPES 的顺序依次注册', () => {
    const keys = Object.keys(Blockly.Blocks);
    const positions = TEMPLATE_TYPES.map((t) => keys.indexOf(t));

    expect(positions.filter((p) => p < 0)).toEqual([]);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('def/call 块仍是本仓库的覆盖实现，未退回 Blockly 原生', () => {
    // 原生 def 的 init 不含 hasReturn 分支；原生 call 的 NAME 是文本输入而非 buildCallOptions 下拉
    for (const type of ['procedures_defreturn', 'procedures_defnoreturn']) {
      expect(initSource(type)).toMatch(/hasReturn/);
    }
    for (const type of ['procedures_callreturn', 'procedures_callnoreturn']) {
      expect(initSource(type)).toMatch(/buildCallOptions/);
    }
  });

  it('模板清单与注册表同源同序', () => {
    expect(TEMPLATE_TYPES).toEqual(Object.keys(TEMPLATE_REGISTRY));
    expect(TEMPLATE_TYPES).toHaveLength(29);
  });
});
