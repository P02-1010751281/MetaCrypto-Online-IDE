/**
 * 界面文案（ui()）键位契约：源码里每一个 `ui('字面量键')` 都必须在两个语言包里落地。
 *
 * 为什么需要这条门禁：`ui()` 的实现是
 *   UI_MESSAGES[locale]?.[key] || UI_MESSAGES['zh-hans'][key] || key
 * 缺键既不报错也不空白，而是把**键名本身**画到界面上。类型检查、lint、单测
 * 都不会因为缺键变红——历史上有键只加进了英文侧（exported / exportError），
 * 中文界面于是显示 `exported: <路径>`，一直没人发现。
 *
 * 这里守住三件同族的事：
 *   1. 引用的键必须中英都有（缺哪边就列哪边，带文件:行号）；
 *   2. 两个语言包的键集必须一致（否则某一边静默回退到中文或键名）；
 *   3. 英文文案里不许残留中文（中文界面允许保留拉丁术语，反向不成立）。
 *
 * 语言包是 MetaCrypto Online IDE ↔ metacrypt_server 共用的权威源（scripts/sync-to-metacrypt.sh
 * 的 [3.8] 逐文件镜像），这里删键会让对面界面直接露出键名。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ui, uiLocaleRef } from '@/composables/locale';
import { UI_MESSAGES } from '@/composables/locale/ui-messages';

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = join(PROJECT_ROOT, 'src');
const CJK = /[\u4e00-\u9fff]/;

const zh = UI_MESSAGES['zh-hans'];
const en = UI_MESSAGES.en;

interface UiKeyUsage {
  key: string;
  file: string;
  line: number;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|vue)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function collectUiKeys(): UiKeyUsage[] {
  const usages: UiKeyUsage[] = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8');
    const pattern = /ui\((['"])([A-Za-z0-9_]+)\1\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length;
      usages.push({ key: match[2], file: relative(PROJECT_ROOT, file), line });
    }
  }
  return usages;
}

describe('ui() 键位契约', () => {
  const usages = collectUiKeys();

  it('源码里能找到 ui() 调用（防止扫描本身失效而恒绿）', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('每个 ui() 引用的键在中英两个语言包里都存在', () => {
    const missing = usages
      .filter((usage) => !(usage.key in zh) || !(usage.key in en))
      .map((usage) => {
        const sides = [
          usage.key in zh ? '' : 'zh',
          usage.key in en ? '' : 'en',
        ]
          .filter(Boolean)
          .join('+');
        return `${usage.file}:${usage.line} ui('${usage.key}') 缺 ${sides}`;
      });
    expect(missing).toEqual([]);
  });

  it('两个语言包的键集一致', () => {
    const zhOnly = Object.keys(zh).filter((key) => !(key in en));
    const enOnly = Object.keys(en).filter((key) => !(key in zh));
    expect({ zhOnly, enOnly }).toEqual({ zhOnly: [], enOnly: [] });
  });

  it('英文文案里没有残留中文', () => {
    const leaked = Object.entries(en)
      .filter(([, value]) => CJK.test(value))
      .map(([key]) => key);
    expect(leaked).toEqual([]);
  });

  it('缺键时 ui() 会退回键名本身（这就是必须守住上面三条的原因）', () => {
    expect(ui('__definitely_missing_key__')).toBe('__definitely_missing_key__');
  });

  it('切换语言后同一键取到不同文案', () => {
    const previous = uiLocaleRef.value;
    try {
      uiLocaleRef.value = 'zh-hans';
      const zhText = ui('exported');
      uiLocaleRef.value = 'en';
      const enText = ui('exported');
      expect(zhText).toBe('工作区已导出');
      expect(enText).toBe('Workspace exported');
    } finally {
      uiLocaleRef.value = previous;
    }
  });
  it('同一个键在中英两侧的 {占位符} 集合必须一致（英文侧丢占位符会让变量静默消失）', () => {
    const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
    const sets = (text: string): string => placeholders(text).join();
    const mismatched = Object.keys(zh)
      .filter((key) => key in en)
      .filter((key) => sets(zh[key]) !== sets(en[key]))
      .map((key) => `${key}: zh {${sets(zh[key])}} / en {${sets(en[key])}}`);
    expect(mismatched).toEqual([]);
  });
});
