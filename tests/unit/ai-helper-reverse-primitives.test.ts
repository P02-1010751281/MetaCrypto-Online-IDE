/**
 * 已知原语调用索引（B 线 P2.3d）
 *
 * 索引是「AST 路径认不认得出密码块调用」的唯一判据，所以两组用例都要钉住：
 *   - 真载荷上的读数（块数、同名不同块类型的反查、参数个数表）；
 *   - 合成载荷上的边界（撞名必须整条丢弃、多行模板/字段槽/语句槽不进索引、没 io 就整体不可用）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { BlockFieldTemplate, FieldPayload } from '@/services/ai-helper/reverse/matchers';
import { parseFieldPayload } from '@/services/ai-helper/reverse/payload';
import { buildPrimitiveIndex, splitCallArguments } from '@/services/ai-helper/reverse/primitive-calls';

const payload = parseFieldPayload(
  readFileSync(resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json'), 'utf8'),
);

const io = { output: true, previous: false, next: false };
const statementIo = { output: false, previous: true, next: true };

function block(type: string, template: string | null, templateIo = io): BlockFieldTemplate {
  return { type, template, fields: [], probes: [], invisible: [], constant: [], io: templateIo };
}

function synthetic(blocks: BlockFieldTemplate[]): FieldPayload {
  return { blocks };
}

describe('原语调用索引：真载荷', () => {
  const index = buildPrimitiveIndex(payload);

  it('索引规模与歧义：66 条、无撞名', () => {
    expect(index.size).toBe(66);
    expect(index.ambiguous).toEqual([]);
  });

  it('块类型可以跟函数名不同（pq_byte_concat 吐 bytes_concat）', () => {
    const call = index.lookup('bytes_concat', 2);
    expect(call?.type).toBe('pq_byte_concat');
    expect(call?.inputs).toEqual(['A', 'B']);
  });

  it('模板里的字面量关键字参数不占参数位（sha3_squeeze 只认 2 个）', () => {
    const call = index.lookup('sha3_squeeze', 2);
    expect(call?.type).toBe('sponge_squeeze');
    expect(call?.inputs).toEqual(['STATE', 'OUTLEN']);
    expect(call?.output).toBe(true);
    expect(call?.statement).toBe(false);
    expect(index.lookup('sha3_squeeze', 3)).toBeNull();
    expect(index.arities('sha3_squeeze')).toEqual([2]);
  });

  it('一条块都不能把哈希函数与海绵函数混起来：名字不同就是不同调用', () => {
    // hash_sha3_pad_hex 的模板是 `sha3_pad(decodeHexBytes(...), ...)`，参数里嵌了调用，
    // 不进索引；否则 `sha3_pad(x)` 会同时对上两块。
    expect(index.lookup('sha3_pad', 1)?.type).toBe('sponge_pad');
    expect(index.lookup('sha3_pad', 2)).toBeNull();
  });
});

describe('原语调用索引：合成载荷的边界', () => {
  it('撞名（同调用名、同参数个数、不同块）两个都不收，记进 ambiguous', () => {
    const index = buildPrimitiveIndex(
      synthetic([
        block('first_block', 'shared_call(zzsigv_A)'),
        block('second_block', 'shared_call(zzsigv_B)'),
      ]),
    );
    expect(index.lookup('shared_call', 1)).toBeNull();
    expect(index.ambiguous).toEqual(['shared_call/1']);
  });

  it('多行模板、字段槽、语句槽都不进索引', () => {
    const index = buildPrimitiveIndex(
      synthetic([
        block('multi_line', 'call_a(zzsigv_X)\nother_line()'),
        block('field_slot', 'call_b(zzfield_OP)'),
        block('statement_slot', 'call_c(zzsigs_DO)'),
        block('nested_call', 'call_d(wrap(zzsigv_X))'),
        block('literal_arg', 'call_e(zzsigv_X, 32)'),
      ]),
    );
    expect(index.size).toBe(0);
  });

  it('没有 io 的老载荷整体不可用：不猜连接能力', () => {
    const stale = {
      type: 'legacy',
      template: 'legacy_call(zzsigv_X)',
      fields: [],
      probes: [],
      invisible: [],
      constant: [],
    } as unknown as BlockFieldTemplate;
    const index = buildPrimitiveIndex(synthetic([stale]));
    expect(index.size).toBe(0);
    expect(index.lookup('legacy_call', 1)).toBeNull();
  });

  it('只有前驱/后继的块也能进索引，并标成语句块', () => {
    const index = buildPrimitiveIndex(synthetic([block('stmt_block', 'do_thing(zzsigv_X)', statementIo)]));
    const call = index.lookup('do_thing', 1);
    expect(call?.statement).toBe(true);
    expect(call?.output).toBe(false);
  });
});

describe('模板参数切分', () => {
  it('按括号深度切，不切嵌套调用里的逗号', () => {
    expect(splitCallArguments('zzsigv_A, f(zzsigv_B, 1), "a,b"')).toEqual(['zzsigv_A', 'f(zzsigv_B, 1)', '"a,b"']);
  });
});
