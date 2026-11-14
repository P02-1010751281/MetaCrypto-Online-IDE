import { describe, expect, it } from 'vitest';
import {
  buildCategories,
  isEnglishPath,
  isSourceLocaleFallback,
  localizedCounterpart,
  shouldIncludeLocalePath,
} from '@/composables/useDocsCatalog';

const includes = (path: string) => path.startsWith('/docs/');

describe('docs locale pairing', () => {
  it('derives the .en.md counterpart in both directions', () => {
    expect(localizedCounterpart('/docs/guides/USER-GUIDE.md')).toBe(
      '/docs/guides/USER-GUIDE.en.md',
    );
    expect(localizedCounterpart('/docs/guides/USER-GUIDE.en.md')).toBe(
      '/docs/guides/USER-GUIDE.md',
    );
  });

  it('keeps the legacy ML-KEM guide pairs explicit', () => {
    const buildGuide = '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-build-guide.md';
    const zhGuide = '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-搭建指南.md';
    expect(localizedCounterpart(buildGuide)).toBe(zhGuide);
    expect(localizedCounterpart(zhGuide)).toBe(buildGuide);
    expect(isEnglishPath(buildGuide)).toBe(true);
    expect(isEnglishPath(zhGuide)).toBe(false);
  });

  it('prefers a translation but keeps a lone document as fallback', () => {
    const withTwin = (candidate: string) =>
      candidate === '/docs/guides/A.md' || candidate === '/docs/guides/A.en.md';
    const withoutTwin = () => false;

    expect(shouldIncludeLocalePath('/docs/guides/A.md', 'zh', withTwin)).toBe(true);
    expect(shouldIncludeLocalePath('/docs/guides/A.en.md', 'zh', withTwin)).toBe(false);

    expect(shouldIncludeLocalePath('/docs/guides/A.en.md', 'en', withTwin)).toBe(true);
    expect(shouldIncludeLocalePath('/docs/guides/A.md', 'en', withTwin)).toBe(false);

    expect(shouldIncludeLocalePath('/docs/guides/A.md', 'en', withoutTwin)).toBe(true);
    expect(shouldIncludeLocalePath('/docs/guides/A.en.md', 'zh', withoutTwin)).toBe(true);
  });

  it('flags a source-language fallback only when no twin exists', () => {
    expect(isSourceLocaleFallback(undefined, 'en')).toBe(false);
    expect(isSourceLocaleFallback('/docs/guides/A.md', 'zh')).toBe(false);
    expect(isSourceLocaleFallback('/docs/guides/A.md', 'en', includes)).toBe(false);
    expect(isSourceLocaleFallback('/docs/guides/A.md', 'en', () => false)).toBe(true);
    expect(isSourceLocaleFallback('/docs/guides/A.en.md', 'zh', () => false)).toBe(true);
    expect(isSourceLocaleFallback('/docs/guides/A.en.md', 'zh', includes)).toBe(false);
  });
});

const paths = [
  '/docs/README.md',
  '/docs/standards/COVERAGE.md',
  '/docs/standards/CONFORMANCE-INVENTORY.md',
  '/docs/standards/SPEC-CARD-MATRIX.md',
  '/docs/standards/sp800-38b-cmac/README.md',
  '/docs/standards/sp800-38b-cmac/01-CMAC.md',
  '/docs/standards/rfc4493/README.md',
  '/docs/guides/USER-GUIDE.md',
  '/docs/guides/DEVELOPMENT.md',
  '/docs/demos/DEMO.md',
  '/docs/build/INDEX.md',
  '/docs/audits/README.md',
  '/docs/audits/project/AUDIT-REPORT.md',
  '/docs/audits/standards/SOURCE-SPLIT-INVENTORY.md',
  '/docs/blocks/INDEX.md',
  '/docs/blocks/symmetric.md',
  '/docs/blocks/bitwise-logic.md',
  '/docs/research/R1.md',
  '/docs/topics/UNMATCHED.md',
];

function ids(locale: string) {
  return buildCategories({ paths, locale, contains: () => false }).map((c) => c.id);
}

describe('docs category construction', () => {
  it('routes every path branch into its category', () => {
    const categories = buildCategories({ paths, locale: 'zh', contains: () => false });
    const byId = new Map(categories.map((c) => [c.id, c]));

    expect(byId.has('topics')).toBe(false);
    expect(byId.get('platform')?.files.map((f) => f.filename)).toEqual([
      'README.md',
      'README.md',
    ]);
    expect(byId.get('standards-index')?.files.map((f) => f.filename)).toEqual([
      'COVERAGE.md',
    ]);
    expect(byId.get('standards-tooling')?.files.map((f) => f.filename)).toEqual([
      'CONFORMANCE-INVENTORY.md',
      'SPEC-CARD-MATRIX.md',
    ]);
    expect(byId.get('rfc-references')?.files.map((f) => f.filename)).toEqual([
      'README.md',
    ]);
    expect(byId.get('user-guides')?.files.map((f) => f.filename)).toEqual([
      'USER-GUIDE.md',
    ]);
    expect(byId.get('development-guides')?.files.map((f) => f.filename)).toEqual([
      'DEVELOPMENT.md',
    ]);
    expect(byId.get('user-demos')?.files.map((f) => f.filename)).toEqual(['DEMO.md']);
    expect(byId.get('build-guides')?.files.map((f) => f.filename)).toEqual(['INDEX.md']);
    expect(byId.get('audit-project')?.files.map((f) => f.filename)).toEqual([
      'AUDIT-REPORT.md',
    ]);
    expect(byId.get('audit-standards')?.files.map((f) => f.filename)).toEqual([
      'SOURCE-SPLIT-INVENTORY.md',
    ]);
    expect(byId.get('research')?.files.map((f) => f.filename)).toEqual(['R1.md']);
    expect(byId.get('user-reference')?.files.map((f) => f.filename)).toEqual([
      'INDEX.md',
      'symmetric.md',
    ]);
    expect(byId.get('user-reference-foundations')?.files.map((f) => f.filename)).toEqual([
      'bitwise-logic.md',
    ]);
    expect(byId.get('sp800-38b-cmac')?.files.map((f) => f.filename)).toEqual([
      '01-CMAC.md',
      'README.md',
    ]);
  });

  it('orders pinned categories first and the rest alphabetically', () => {
    expect(ids('zh')).toEqual([
      'user-guides',
      'build-guides',
      'user-demos',
      'user-reference',
      'user-reference-foundations',
      'development-guides',
      'platform',
      'research',
      'standards-index',
      'standards-tooling',
      'rfc-references',
      'audit-project',
      'audit-standards',
      'sp800-38b-cmac',
    ]);
  });

  it('keeps only the locale-matching pair when a twin exists', () => {
    const enPaths = [
      '/docs/guides/USER-GUIDE.en.md',
      '/docs/guides/USER-GUIDE.md',
      '/docs/guides/ONLY-ZH.md',
    ];
    const en = buildCategories({
      paths: enPaths,
      locale: 'en',
      contains: (candidate) =>
        candidate === '/docs/guides/USER-GUIDE.md' ||
        candidate === '/docs/guides/USER-GUIDE.en.md',
    });
    expect(en.flatMap((c) => c.files.map((f) => f.path))).toEqual([
      '/docs/guides/USER-GUIDE.en.md',
      '/docs/guides/ONLY-ZH.md',
    ]);

    const zh = buildCategories({
      paths: enPaths,
      locale: 'zh',
      contains: (candidate) =>
        candidate === '/docs/guides/USER-GUIDE.md' ||
        candidate === '/docs/guides/USER-GUIDE.en.md',
    });
    expect(zh.flatMap((c) => c.files.map((f) => f.path))).toEqual([
      '/docs/guides/USER-GUIDE.md',
      '/docs/guides/ONLY-ZH.md',
    ]);
  });
});
