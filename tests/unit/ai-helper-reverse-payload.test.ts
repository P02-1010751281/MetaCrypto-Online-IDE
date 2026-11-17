/**
 * 运行时字段模板载荷（`reverse/field-templates.json`）的结构契约。
 *
 * 这份 160 KB 的产物是反解析的词汇表：缺一个块类型，那段代码就永远判成 UNRESOLVED；
 * 多一个已退场的类型，匹配器就会去追一段不可能出现的代码。所以这里钉三件事：
 *   1. 类型集合与 `ALL_BLOCK_TYPES` 逐项相等（不靠数字碰巧相等）；
 *   2. 有生成器却没采到模板的类型只能是被点名的已知例外（sbox 旧变量块），
 *      新增一个这样的块必须先改这份名单；
 *   3. 载入层的 `parseFieldPayload` 对结构不对的文本必须抛错，不许半份模板上岗。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_BLOCK_TYPES } from '@/blocks';
import { buildMatchers, loadFieldPayload, parseFieldPayload } from '@/services/ai-helper/reverse';

const PAYLOAD_PATH = resolve(process.cwd(), 'src/services/ai-helper/reverse/field-templates.json');
const text = readFileSync(PAYLOAD_PATH, 'utf8');
const payload = parseFieldPayload(text);

/** 有生成器但采不到模板的两个旧变量块（生成器拿 null 名字调 toLowerCase）。 */
const KNOWN_UNTEMPLATED = ['sbox_variables_get', 'sbox_variables_set'];

describe('字段模板载荷', () => {
  it('覆盖全部块类型，且没有多余类型', () => {
    const payloadTypes = payload.blocks.map((block) => block.type);
    expect(new Set(payloadTypes).size).toBe(payloadTypes.length);
    expect([...payloadTypes].sort()).toEqual([...ALL_BLOCK_TYPES].sort());
  });

  it('采不到模板的只有已知例外，其余块都有可匹配形态', () => {
    const untemplated = payload.blocks.filter((block) => block.template === null).map((block) => block.type).sort();
    expect(untemplated).toEqual(KNOWN_UNTEMPLATED);
    expect(payload.blocks.length - untemplated.length).toBe(ALL_BLOCK_TYPES.length - KNOWN_UNTEMPLATED.length);
  });

  it('每个有模板的块都能构建出匹配器（否则等于没采）', () => {
    const matchers = buildMatchers(payload);
    const covered = new Set(matchers.map((matcher) => matcher.type));
    const missing = payload.blocks
      .filter((block) => block.template !== null && !covered.has(block.type))
      .map((block) => block.type);
    expect(missing).toEqual([]);
    // 匹配器数 ≥ 块数：下拉变体与宽松档会为同一块产出多条。
    expect(matchers.length).toBeGreaterThanOrEqual(payload.blocks.length - KNOWN_UNTEMPLATED.length);
  });

  it('载荷结构与 src 存档不是两套东西：两处内容逐字相同（除生成时间）', () => {
    const archive = readFileSync(
      resolve(process.cwd(), 'experiments/ai-helper-2026-11-14/out/field-templates.json'),
      'utf8',
    );
    const strip = (raw: string): string =>
      raw.replace(/"generatedAt": "[^"]*"/, '"generatedAt": "-"');
    expect(strip(text)).toBe(strip(archive));
  });

  it('结构不对的文本必须抛错', () => {
    expect(() => parseFieldPayload('{}')).toThrow(/blocks/);
    expect(() => parseFieldPayload('{"blocks": []}')).toThrow(/blocks/);
    expect(() => parseFieldPayload('not json')).toThrow();
  });

  it('浏览器入口走 ?raw 能拿到同一份载荷，且只解析一次', async () => {
    const loaded = await loadFieldPayload();
    expect(loaded.blocks.length).toBe(payload.blocks.length);
    expect(await loadFieldPayload()).toBe(loaded);
  });
});
