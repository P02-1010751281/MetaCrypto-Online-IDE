import {
  getAuditCategory,
  getBlockDocCategories,
  getCategoryLabel,
  getDocTitle,
  getGuideCategory,
  getPlatformCategory,
  getStandardDocCategory,
  getStandardsIndexCategory,
  parseOrder,
  type DocCategory,
  type DocFile,
} from '@/utils/markdown';

// Lazy loader map: path -> () => Promise<string>. Vite 根即仓库根，所以
// 绝对路径 glob 在构建期展开；内容按需加载，避免把全部文档塞进首屏包体。
export const docLoaders = import.meta.glob('/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: false,
}) as Record<string, () => Promise<string>>;

export const docPaths: string[] = Object.keys(docLoaders);

export function hasDoc(path: string): boolean {
  return path in docLoaders;
}

// 旧版指南的文件名不带 .en.md 后缀，只能显式配对；其余按 .md ↔ .en.md 推导。
const legacyGuideLocalePairs: Record<string, string> = {
  '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-build-guide.md':
    '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-搭建指南.md',
  '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-搭建指南.md':
    '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-build-guide.md',
  '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-pure-basic.md':
    '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-纯基础块.md',
  '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-纯基础块.md':
    '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-pure-basic.md',
};

export function localizedCounterpart(path: string): string {
  if (path in legacyGuideLocalePairs) return legacyGuideLocalePairs[path];
  return path.endsWith('.en.md')
    ? `${path.slice(0, -'.en.md'.length)}.md`
    : `${path.slice(0, -'.md'.length)}.en.md`;
}

export function isEnglishPath(path: string): boolean {
  return (
    path.endsWith('.en.md') ||
    path ===
      '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-build-guide.md' ||
    path ===
      '/docs/standards/fips203-ML-KEM/guides/ML-KEM-768-Encaps-pure-basic.md'
  );
}

export function shouldIncludeLocalePath(
  path: string,
  locale: string,
  contains: (candidate: string) => boolean = hasDoc,
): boolean {
  const isEnglish = isEnglishPath(path);
  const counterpart = localizedCounterpart(path);
  const hasCounterpart = contains(counterpart);
  // Prefer a translation when present; retain the only available language as
  // an explicit fallback so a missing translation never hides a document.
  return locale === 'en' ? isEnglish || !hasCounterpart : !isEnglish || !hasCounterpart;
}

// 当前页面的语言与界面语言不一致、且没有对应译本时，页面会显示源语言内容。
export function isSourceLocaleFallback(
  path: string | undefined,
  locale: string,
  contains: (candidate: string) => boolean = hasDoc,
): boolean {
  if (!path) return false;
  const isEnglish = isEnglishPath(path);
  const expectsEnglish = locale === 'en';
  return isEnglish !== expectsEnglish && !contains(localizedCounterpart(path));
}

export interface BuildCategoriesOptions {
  paths: readonly string[];
  locale: string;
  contains?: (path: string) => boolean;
}

// 只按文件路径构建导航（不读内容）。分类规则与 DocsView 拆分前逐条一致：
// platform / research / standards 索引与子目录 / guides / demos / build /
// audits / blocks，最后按 pinned 顺序 + 其余字母序排列。
export function buildCategories({
  paths,
  locale,
  contains = hasDoc,
}: BuildCategoriesOptions): DocCategory[] {
  const catMap = new Map<string, DocFile[]>();
  const included = (path: string) => shouldIncludeLocalePath(path, locale, contains);

  for (const path of paths) {
    // path looks like: /docs/guides/ARCHITECTURE.md | /docs/standards/fips202-SHA3/01-Theta.md
    const parts = path.replace(/^\/docs\//, '').split('/');
    if (parts.length < 1) continue;

    const top = parts[0];

    // Root/index/research docs are valid entries too. Keep locale filtering
    // consistent with the other top-level documentation groups.
    if (parts.length === 1 || (top === 'research' && parts.length >= 2)) {
      const filename = parts[parts.length - 1];
      if (!included(path)) continue;

      const category = parts.length === 1
        ? getPlatformCategory(filename)
        : 'research';
      const file: DocFile = {
        path,
        category,
        filename: parts.slice(1).join('/') || filename,
        title: getDocTitle(path, locale),
        order: parseOrder(filename),
      };
      if (!catMap.has(category)) catMap.set(category, []);
      catMap.get(category)!.push(file);
      continue;
    }

    if (top === 'standards' && parts.length === 2) {
      const filename = parts[1];
      if (!included(path)) continue;

      const file: DocFile = {
        path,
        category: getStandardsIndexCategory(filename),
        filename,
        title: getDocTitle(path, locale),
        order: parseOrder(filename),
      };
      if (!catMap.has(file.category)) catMap.set(file.category, []);
      catMap.get(file.category)!.push(file);
      continue;
    }

    // guides/、demos/、build/：核心文档平铺，按 locale 过滤中英版本
    if ((top === 'guides' || top === 'demos' || top === 'build') && parts.length === 2) {
      const filename = parts[1];
      if (!included(path)) continue;

      const category =
        top === 'guides' ? getGuideCategory(filename) : top === 'demos' ? 'user-demos' : 'build-guides';
      const file: DocFile = {
        path,
        category,
        filename,
        title: getDocTitle(path, locale),
        order: parseOrder(filename),
      };
      if (!catMap.has(file.category)) catMap.set(file.category, []);
      catMap.get(file.category)!.push(file);
      continue;
    }

    // audits/：审计报告是一级主题，按来源分子目录（standards/、project/）。
    // 与 standards/ 平级，不藏在 standards 内部；category 由来源目录决定。
    if (top === 'audits' && parts.length >= 2) {
      if (parts.length === 2) {
        // audits/README.md 这类索引页归到平台入口
        const filename = parts[1];
        if (!included(path)) continue;
        const file: DocFile = {
          path,
          category: 'platform',
          filename,
          title: getDocTitle(path, locale),
          order: parseOrder(filename),
        };
        if (!catMap.has(file.category)) catMap.set(file.category, []);
        catMap.get(file.category)!.push(file);
        continue;
      }
      if (!included(path)) continue;
      const basename = parts[parts.length - 1];
      const file: DocFile = {
        path,
        category: getAuditCategory(parts[1]),
        filename: parts.slice(2).join('/'),
        title: getDocTitle(path, locale),
        order: parseOrder(basename),
      };
      if (!catMap.has(file.category)) catMap.set(file.category, []);
      catMap.get(file.category)!.push(file);
      continue;
    }

    // blocks/：按算法家族拆开导航，同时保留总览和共享原语入口
    if (top === 'blocks' && parts.length === 2) {
      const filename = parts[1];
      if (!included(path)) continue;

      const file = {
        path,
        filename,
        title: getDocTitle(path, locale),
        order: parseOrder(filename),
      };
      for (const category of getBlockDocCategories(filename)) {
        if (!catMap.has(category)) catMap.set(category, []);
        catMap.get(category)!.push({ ...file, category });
      }
      continue;
    }

    // standards/：算法规范允许包含 guides/、papers/ 等子目录；category
    // 仍取标准目录名，filename 使用相对路径以避免同名文件冲突。
    if (top === 'standards' && parts.length >= 3) {
      const category = getStandardDocCategory(parts[1]);
      const filename = parts.slice(2).join('/');
      const basename = parts[parts.length - 1];
      if (!included(path)) continue;
      const file: DocFile = {
        path,
        category,
        filename,
        title: getDocTitle(path, locale),
        order: parseOrder(basename),
      };
      if (!catMap.has(category)) catMap.set(category, []);
      catMap.get(category)!.push(file);
    }
  }

  // Sort files within each category by order
  for (const [, files] of catMap) {
    files.sort((a, b) => a.order - b.order);
  }

  // Define display order: user docs first, then development/audit/reference docs, then standards.
  const pinned = [
    'user-guides',
    'build-guides',
    'user-demos',
    'user-reference',
    'user-reference-foundations',
    'development-guides',
    'audit-reports',
    'platform',
    'research',
    'standards-index',
    'standards-tooling',
    'rfc-references',
  ];
  const rest = [...catMap.keys()]
    .filter((id) => !pinned.includes(id))
    .sort((a, b) => a.localeCompare(b));
  const categoryOrder = [...pinned, ...rest];

  return categoryOrder
    .filter((id) => catMap.has(id))
    .map((id) => ({
      id,
      label: getCategoryLabel(id, locale),
      files: catMap.get(id)!,
    }));
}

export function useDocsCatalog() {
  return {
    docLoaders,
    docPaths,
    hasDoc,
    buildCategories: (locale: string) =>
      buildCategories({ paths: docPaths, locale }),
    localizedCounterpart,
    isEnglishPath,
    isSourceLocaleFallback,
  };
}
