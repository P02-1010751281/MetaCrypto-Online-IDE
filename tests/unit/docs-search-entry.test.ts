/**
 * 文档中心第二入口的纯逻辑回归（filterCategories / readQuery / decidePrefill /
 * decideLocaleSwitch / buildDocsLocation）。
 *
 * 这几个函数是「检索面板 → 文档中心」那条链上的全部决策点：
 * 预填会不会把用户丢进空侧栏、同实例去掉 ?q= 会不会残留旧过滤、切语言后要不要清理、
 * 宿主跳转带不带 q。它们原先内联在 DocsView.vue / App.vue 里，只能靠真浏览器验收；
 * 抽成 utils 模块后在这里逐条钉死（vitest 用 node 环境，不需要新增依赖）。
 */
import { describe, expect, it } from 'vitest';

import type { DocCategory, DocFile } from '@/utils/docs-catalog';
import {
  buildDocsLocation,
  decideLocaleSwitch,
  decidePrefill,
  filterCategories,
  readQuery,
} from '@/utils/docs-search-entry';

const file = (path: string, title: string): DocFile => ({
  path,
  category: 'fips203-ML-KEM',
  filename: path.slice(path.lastIndexOf('/') + 1),
  title,
  order: 1,
});

// 真实分类 id：getCategoryLabel 对 zh / en 给出不同标签
// zh: FIPS 203 — ML-KEM 密钥封装   en: FIPS 203 — ML-KEM Key Encapsulation
const CATALOG: DocCategory[] = [
  {
    id: 'fips203-ML-KEM',
    label: 'FIPS 203 — ML-KEM',
    files: [
      file('/docs/standards/fips203-ML-KEM/01-keys.md', 'Key generation'),
      file('/docs/standards/fips203-ML-KEM/02-encaps.md', 'Encapsulation'),
    ],
  },
  {
    id: 'platform',
    label: 'Project index',
    files: [file('/docs/README.md', 'MetaCrypto Online IDE documentation entry')],
  },
];

describe('readQuery', () => {
  it('只要字符串并去掉首尾空白', () => {
    expect(readQuery('  ML-KEM  ')).toBe('ML-KEM');
    expect(readQuery('')).toBe('');
  });
  it('非字符串（重复参数的数组、undefined、数字）一律当没有', () => {
    expect(readQuery(undefined)).toBe('');
    expect(readQuery(['a', 'b'])).toBe('');
    expect(readQuery(42)).toBe('');
  });
});

describe('filterCategories', () => {
  it('q 为空时返回同一个数组（不复制、不重排）', () => {
    expect(filterCategories(CATALOG, '', 'zh')).toBe(CATALOG);
  });

  it('分类名命中时保留该分类的全部文件', () => {
    const out = filterCategories(CATALOG, 'ml-kem', 'zh');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('fips203-ML-KEM');
    expect(out[0].files).toHaveLength(2);
  });

  it('只在标题里命中的词：只留命中文件，并把空分类剔除', () => {
    // 'generation' 只出现在标题里，不在分类标签里——对比上面的分类名命中
    const out = filterCategories(CATALOG, 'generation', 'en');
    expect(out).toHaveLength(1);
    expect(out[0].files.map((f) => f.title)).toEqual(['Key generation']);
  });

  it('不 trim：尾随空白参与 includes（与原 computed 语义一致）', () => {
    // 对照：去掉尾随空格能命中，带空格就不能——证明这里确实没做 trim
    expect(filterCategories(CATALOG, 'Encapsulation', 'en')).toHaveLength(1);
    expect(filterCategories(CATALOG, 'Encapsulation ', 'en')).toEqual([]);
  });

  it('语言影响分类标签匹配：中文标签词只在 zh 命中', () => {
    expect(filterCategories(CATALOG, '密钥封装', 'zh')).toHaveLength(1);
    expect(filterCategories(CATALOG, '密钥封装', 'en')).toEqual([]);
  });

  it('无命中返回空数组', () => {
    expect(filterCategories(CATALOG, 'zzzqqqxx', 'en')).toEqual([]);
  });
});

describe('decidePrefill', () => {
  it('没有 q 时不预填、也不提示', () => {
    expect(decidePrefill(undefined, CATALOG, 'en')).toEqual({ keyword: '', notice: '' });
  });

  it('命中的词才预填（分类名或标题都算）', () => {
    expect(decidePrefill(' ML-KEM ', CATALOG, 'en')).toEqual({ keyword: 'ML-KEM', notice: '' });
    expect(decidePrefill('key generation', CATALOG, 'en')).toEqual({ keyword: 'key generation', notice: '' });
  });

  it('必然筛空的词不预填，只留说明行（否则用户被丢进空侧栏）', () => {
    expect(decidePrefill('zzzqqqxx', CATALOG, 'en')).toEqual({ keyword: '', notice: 'zzzqqqxx' });
  });

  it('中文标签词在 en 下算不出内容 → 不预填 + 提示', () => {
    expect(decidePrefill('密钥封装', CATALOG, 'en')).toEqual({ keyword: '', notice: '密钥封装' });
  });
});

describe('decideLocaleSwitch', () => {
  it('没有预填值 / 用户改过搜索框 → 不接管', () => {
    expect(decideLocaleSwitch('', 'ML-KEM', CATALOG, 'en')).toBeNull();
    expect(decideLocaleSwitch('密钥封装', '用户自己改的', CATALOG, 'en')).toBeNull();
  });

  it('切换后仍命中 → 不动', () => {
    expect(decideLocaleSwitch('密钥封装', '密钥封装', CATALOG, 'zh')).toBeNull();
    expect(decideLocaleSwitch('ml-kem', 'ml-kem', CATALOG, 'en')).toBeNull();
  });

  it('切换后不再命中 → 清空搜索框并提示原词', () => {
    expect(decideLocaleSwitch('密钥封装', '密钥封装', CATALOG, 'en')).toEqual({
      keyword: '',
      notice: '密钥封装',
    });
  });
});

describe('buildDocsLocation', () => {
  it('无词时就是 /docs（不带空 q）', () => {
    expect(buildDocsLocation(undefined)).toBe('/docs');
    expect(buildDocsLocation('')).toBe('/docs');
    expect(buildDocsLocation('   ')).toBe('/docs');
    expect(buildDocsLocation(['a'])).toBe('/docs');
  });

  it('有词时带 ?q=，且先 trim', () => {
    expect(buildDocsLocation('  ML-KEM  ')).toEqual({ path: '/docs', query: { q: 'ML-KEM' } });
  });
});
