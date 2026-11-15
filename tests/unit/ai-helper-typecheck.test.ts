// @vitest-environment node
/**
 * 浏览器端工作区类型检查器的回归基线（用户侧 AI Helper · 类型检查器）。
 *
 * 数字来自 Node 脚本 scripts/ai-helper-typecheck.ts 的实测基线（加载模式 check-loaded）：
 * 60 个 demo、pairs=1237、ok=1234、mismatch=0、unknown=3、unknown_rate=0.2%。
 * 这些数字是回归基线，不是可调参数——对不上说明移植有偏差，要查模块而不是改期望值。
 *
 * 剩下的 3 条 unknown 全部是 `vocab_unmapped`（形参类型词表里没有 poly/seed 这类名字），
 * 不是字面量：字面量已按「形状 → 可表示它的类型」定型（见 literal-shape.ts）。
 *
 * 形参绑定按「变量 id ↔ 过程形参 id」并限定在所属过程内；只按变量名匹配会掉回 unknown。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkspace, checkWorkspaceObject } from '@/services/ai-helper/typecheck';

interface ParamJson {
  name?: string;
  id?: string;
  type?: string;
}

interface BlockJson {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson }>;
  extraState?: { params?: ParamJson[] };
}

interface WorkspaceJson {
  blocks: { blocks: BlockJson[] };
}

const DEMOS_ROOT = resolve(process.cwd(), 'demos');

/** demos/ 下排除 tests.json / evidence.json 的全部工作区，按路径排序保证可复现。 */
function listDemos(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json') && name !== 'tests.json' && name !== 'evidence.json') files.push(full);
    }
  };
  walk(DEMOS_ROOT);
  return files.sort();
}

function readDemo(file: string): WorkspaceJson {
  return JSON.parse(readFileSync(resolve(DEMOS_ROOT, file), 'utf-8')) as WorkspaceJson;
}

function findDef(workspace: WorkspaceJson): BlockJson {
  const def = workspace.blocks.blocks.find((block) => block.type === 'procedures_defreturn');
  if (!def) throw new Error('demo 里没有 procedures_defreturn');
  return def;
}

describe('checkWorkspace：60 个 demo 的回归基线', () => {
  it('五个数字与 Node 基线逐字一致', () => {
    const files = listDemos();
    expect(files).toHaveLength(60);

    const totals = { pairs: 0, ok: 0, mismatch: 0, unknown: 0, varByParamId: 0 };
    for (const file of files) {
      const report = checkWorkspace(readDemo(file));
      totals.pairs += report.pairs;
      totals.ok += report.ok;
      totals.mismatch += report.mismatch;
      totals.unknown += report.unknown;
      totals.varByParamId += report.varByParamId;
      expect(report.issues, `${relative(DEMOS_ROOT, file)} 不应有 mismatch`).toHaveLength(0);
    }

    expect(totals.pairs).toBe(1237);
    expect(totals.ok).toBe(1234);
    expect(totals.mismatch).toBe(0);
    expect(totals.unknown).toBe(3);
    // 252 个 variables_get 没有赋值来源，靠「变量 id ↔ 过程形参 id」拿到声明类型；
    // 若退回按变量名匹配，这一批会掉进 unknown。
    expect(totals.varByParamId).toBe(252);
    const rate = Number(((totals.unknown / totals.pairs) * 100).toFixed(1));
    expect(rate).toBe(0.2);
  });

  it('未知全部单列：ok + unknown 等于 pairs，unknown 不并进通过', () => {
    for (const file of listDemos()) {
      const report = checkWorkspace(readDemo(file));
      expect(report.ok + report.unknown + report.mismatch).toBe(report.pairs);
      expect(report.unknownRate).toBe(
        report.pairs ? Number(((report.unknown / report.pairs) * 100).toFixed(1)) : 0,
      );
    }
  });
});

describe('反例：形参声明与槽位类型冲突', () => {
  it('SM4-Round 的 state_0..state_3 写成 int 时，4 个 IntList 槽全部报 mismatch', () => {
    const workspace = readDemo('procedures/SM4-Round.json');
    const def = findDef(workspace);
    const params = def.extraState?.params ?? [];
    const stateParams = params.filter((param) => param.name?.startsWith('state_'));
    expect(stateParams).toHaveLength(4);
    for (const param of stateParams) param.type = 'int';

    const report = checkWorkspace(workspace);
    expect(report.mismatch).toBe(4);
    expect(report.issues).toHaveLength(4);
    expect(report.issues.map((issue) => issue.parent)).toEqual([
      'sm4_round_func', 'sm4_round_func', 'sm4_round_func', 'sm4_round_func',
    ]);
    expect(report.issues.map((issue) => issue.input).sort()).toEqual(['X0', 'X1', 'X2', 'X3']);
    expect(report.issues.map((issue) => issue.location).sort()).toEqual([
      'sm4_round_func[X0]', 'sm4_round_func[X1]', 'sm4_round_func[X2]', 'sm4_round_func[X3]',
    ]);
    for (const issue of report.issues) {
      expect(issue.expected).toEqual(['IntList']);
      expect(issue.actual).toEqual(['Number']);
    }

    // 反例只改内存副本：磁盘上的 demo 必须仍是 int_list（正例继续 0 mismatch）。
    const onDisk = readDemo('procedures/SM4-Round.json');
    expect(findDef(onDisk).extraState?.params?.map((param) => param.type)).toEqual([
      'int_list', 'int_list', 'int_list', 'int_list', 'int',
    ]);
    expect(checkWorkspace(onDisk).mismatch).toBe(0);
  });
});

describe('反例：变量中转', () => {
  it('Bytes 来源经 variables_set 存下、再接进 IntList 槽时报 mismatch', () => {
    const workspace = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'variables_set',
            fields: { VAR: { id: 'v-bytes' } },
            inputs: { VALUE: { block: { type: 'seed_bytes' } } },
          },
          {
            type: 'aes_sub_bytes',
            inputs: {
              STATE: { block: { type: 'variables_get', fields: { VAR: { id: 'v-bytes' } } } },
            },
          },
        ],
      },
    };

    const report = checkWorkspace(workspace);
    expect(report.pairs).toBe(1);
    expect(report.mismatch).toBeGreaterThanOrEqual(1);
    expect(report.issues[0].location).toBe('aes_sub_bytes[STATE]');
    expect(report.issues[0].expected).toEqual(['IntList']);
    expect(report.issues[0].actual).toEqual(['Bytes']);
  });
});

describe('正例：干净工作区', () => {
  it('单个 procedure demo 全部判 ok（SM4-Round 原样）', () => {
    const report = checkWorkspace(readDemo('procedures/SM4-Round.json'));
    expect(report.pairs).toBe(5);
    expect(report.ok).toBe(5);
    expect(report.mismatch).toBe(0);
    expect(report.unknown).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it('atomic demo 的数组字面量按形状定型后全部判 ok（不再留 unknown）', () => {
    const report = checkWorkspace(readDemo('AES-Atomic-Round.json'));
    expect(report.pairs).toBe(5);
    expect(report.mismatch).toBe(0);
    expect(report.ok).toBe(5);
    expect(report.unknown).toBe(0);
  });

  it('反例：形状与槽位冲突的字面量判 mismatch，而不是笼统的 unknown', () => {
    // IntList 槽位喂一个引号字符串：String/Bytes 与 IntList 无交集。
    const report = checkWorkspace({
      blocks: {
        blocks: [
          {
            type: 'aes_sub_bytes',
            inputs: { STATE: { block: { type: 'data_value', fields: { NUM: "'abc'" } } } },
          },
        ],
      },
    });
    expect(report.pairs).toBe(1);
    expect(report.mismatch).toBe(1);
    expect(report.unknown).toBe(0);
    expect(report.issues[0].location).toBe('aes_sub_bytes[STATE]');
    expect(report.issues[0].actual).toEqual(['String', 'Bytes']);
  });
});

// ---- 已加载 Workspace 适配器的结构等价性（不装 Blockly、不装 jsdom） ----

interface FakeField {
  name?: string;
  getValue: () => unknown;
}

interface FakeInput {
  name: string;
  fieldRow: FakeField[];
}

interface FakeBlock {
  type: string;
  id?: string;
  inputList: FakeInput[];
  getInputTargetBlock(name: string): FakeBlock | null;
  getNextBlock(): FakeBlock | null;
  getParent(): FakeBlock | null;
  saveExtraState?: () => unknown;
}

/** 把序列化 JSON 逐块包成 Blockly Block 的最小结构，用于验证适配器只依赖公开 API。 */
function toFakeBlock(block: BlockJson, parent: FakeBlock | null): FakeBlock {
  const children = new Map<string, FakeBlock>();
  const fields: FakeField[] = Object.entries(block.fields ?? {}).map(([name, value]) => ({
    name,
    getValue: () => (name === 'VAR' && value && typeof value === 'object'
      ? (value as { id?: string }).id
      : value),
  }));
  const inputList: FakeInput[] = [{ name: '', fieldRow: fields }];
  for (const [inputName, value] of Object.entries(block.inputs ?? {})) {
    if (!value.block) continue;
    children.set(inputName, toFakeBlock(value.block, null));
    inputList.push({ name: inputName, fieldRow: [] });
  }
  const fake: FakeBlock = {
    type: block.type,
    id: block.id,
    inputList,
    getInputTargetBlock: (name) => children.get(name) ?? null,
    getNextBlock: () => null,
    getParent: () => parent,
    saveExtraState: block.extraState ? () => block.extraState : undefined,
  };
  for (const child of children.values()) {
    // 子块的父亲就是当前块：适配器按 getParent() 过滤顶层块。
    Object.defineProperty(child, 'getParent', { value: () => fake });
  }
  return fake;
}

describe('checkWorkspaceObject：已加载工作区适配器', () => {
  it('同一棵 SM4-Round 树，适配器与序列化检查给出相同计数', () => {
    const workspace = readDemo('procedures/SM4-Round.json');
    const roots = workspace.blocks.blocks.map((block) => toFakeBlock(block, null));
    const report = checkWorkspaceObject({ getAllBlocks: () => roots });
    expect(report.pairs).toBe(5);
    expect(report.ok).toBe(5);
    expect(report.mismatch).toBe(0);
  });
});
