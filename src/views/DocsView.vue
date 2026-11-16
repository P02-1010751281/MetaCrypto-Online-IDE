<template>
  <div class="docs-view">
    <!-- Top navigation bar -->
    <header class="docs-header">
      <button class="header-btn" @click="goBack">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {{ ui('back') }}
      </button>
      <h1 class="docs-title">{{ ui('docsTitle') }}</h1>
      <div class="header-spacer" />
      <LocaleToggleButton class="header-btn" @toggle="toggleLocale" />
    </header>

    <!-- 预填词没命中任何分类/标题时说明一句：否则用户会对着一个被清空的搜索框猜原因。 -->
    <p v-if="prefillNotice" class="docs-notice">
      {{ ui('docsPrefillNoTitleMatch').replace('{q}', prefillNotice) }}
    </p>

    <div class="docs-body">
      <!-- Sidebar navigation -->
      <DocsSidebar
        v-model:search-query="searchQuery"
        :categories="filteredCategories"
        :expanded-categories="expandedCategories"
        :active-doc="activeDoc"
        :current-locale="currentLocale"
        @toggle-category="toggleCategory"
        @select-doc="selectDoc"
      />

      <!-- Content area -->
      <DocsContent
        :loading="loading"
        :error="error"
        :rendered-html="renderedHtml"
        :is-source-locale-fallback="sourceLocaleFallback"
        :categories="categories"
        :current-locale="currentLocale"
        @select-doc="selectDoc"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ui, uiLocaleRef, useBlocklyLocale } from '@/composables/locale';
import { useDocsCatalog } from '@/composables/useDocsCatalog';
import { renderMarkdown, type DocCategory } from '@/utils/markdown';
import {
  decideLocaleSwitch,
  decidePrefill,
  filterCategories,
} from '@/utils/docs-search-entry';
import DocsSidebar from '@/components/docs/DocsSidebar.vue';
import DocsContent from '@/components/docs/DocsContent.vue';
import LocaleToggleButton from '@/components/editor/LocaleToggleButton.vue';

const {
  docLoaders,
  buildCategories: buildDocCategories,
  isSourceLocaleFallback,
  localizedCounterpart,
} = useDocsCatalog();
const router = useRouter();
const route = useRoute();
const blocklyLocale = useBlocklyLocale();
function toggleLocale() {
  blocklyLocale.setLocale(
    blocklyLocale.getCurrentLocale() === 'zh-hans' ? 'en' : 'zh-hans',
  );
}
const currentLocale = computed<'zh' | 'en'>(() =>
  uiLocaleRef.value === 'zh-hans' ? 'zh' : 'en',
);

const categories = ref<DocCategory[]>([]);
const activeDoc = ref<string>('');
const renderedHtml = ref<string>('');
const loading = ref(false);
const error = ref<string>('');
const searchQuery = ref('');
/** 非空则显示「未匹配任何分类或文档标题」说明行。 */
const prefillNotice = ref('');
/** 记录搜索框当前值是否由 ?q= 预填：用户自己改过就不再接管（见设计稿 §8 L1）。 */
const prefilledQuery = ref('');
const expandedCategories = ref<Set<string>>(new Set());
let docRequestId = 0;

// 当前页面的语言与界面语言不一致、且没有对应译本时提示源语言回退。
const sourceLocaleFallback = computed(() =>
  isSourceLocaleFallback(activeDoc.value, currentLocale.value),
);

const filteredCategories = computed(() =>
  filterCategories(categories.value, searchQuery.value, currentLocale.value),
);

function toggleCategory(id: string) {
  if (expandedCategories.value.has(id)) {
    expandedCategories.value.delete(id);
  } else {
    expandedCategories.value.add(id);
  }
  // Trigger reactivity
  expandedCategories.value = new Set(expandedCategories.value);
}

async function selectDoc(path: string, sourceLine?: number, headingId?: string) {
  const requestId = ++docRequestId;
  activeDoc.value = path;
  loading.value = true;
  error.value = '';

  try {
    const loader = docLoaders[path];
    if (!loader) {
      if (requestId === docRequestId) error.value = ui('docsNotFound');
      return;
    }
    const content = await loader();
    if (requestId === docRequestId) renderedHtml.value = renderMarkdown(content, sourceLine);
  } catch (err) {
    if (requestId === docRequestId) error.value = `${ui('docsRenderFailed')}: ${err}`;
  } finally {
    if (requestId === docRequestId) {
      loading.value = false;
      // loading=false 后内容区才渲染，mermaid 需在 DOM 就绪后执行
      await renderMermaid();
      if (requestId === docRequestId && sourceLine) {
        document.getElementById(`source-line-${sourceLine}`)?.scrollIntoView({ block: 'start' });
      } else if (requestId === docRequestId && headingId) {
        document.getElementById(headingId)?.scrollIntoView({ block: 'start' });
      }
    }
  }
}

// 渲染文档中的 mermaid 图（动态加载，避免增大首屏包体）
async function renderMermaid() {
  // 等待 renderedHtml 写入 DOM（loading=false 后才渲染内容区）
  await nextTick();
  const nodes = Array.from(
    document.querySelectorAll('.docs-content pre.mermaid'),
  ) as HTMLElement[];
  if (nodes.length === 0) return;
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false });
    await mermaid.run({ nodes });
  } catch (err) {
    console.warn('Mermaid render failed:', err);
  }
}

function goBack() {
  // 优先回来源页：vue-router 给每个应用内条目写了 back，首屏 / 直开 URL 是 null。
  // back 是 vue-router 的字段而非公开 API；上游改字段就退化成恒回首页（今天的行
  // 为），不会崩。
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back) router.back();
  else void router.push('/');
}

function rebuildCategories() {
  categories.value = buildDocCategories(currentLocale.value);
  // Expand all categories by default
  for (const cat of categories.value) {
    expandedCategories.value.add(cat.id);
  }
}

// Keep relative Markdown and PDF links inside their docs/ source paths. Markdown
// files load in the docs view; PDFs are served as static files by Vite/nginx.
async function setupDocLinks() {
  await nextTick();
  const container = document.querySelector('.docs-content');
  if (!container) return;
  container.addEventListener('click', (ev: Event) => {
    const target = ev.target as HTMLElement;
    const a = target.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    let url: URL;
    try {
      url = new URL(href, `${window.location.origin}${activeDoc.value}`);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;

    let targetPath = url.pathname;
    try {
      targetPath = decodeURIComponent(targetPath);
    } catch {
      // Keep malformed percent sequences unchanged; they will not match a doc.
    }

    if (targetPath.endsWith('.pdf')) {
      ev.preventDefault();
      window.location.assign(`${targetPath}${url.search}${url.hash}`);
      return;
    }
    if (!targetPath.endsWith('.md')) return;

    ev.preventDefault();
    if (targetPath in docLoaders) {
      const sourceLine = /^#L(\d+)/.exec(url.hash)?.[1];
      let headingId = sourceLine ? '' : url.hash.slice(1);
      try {
        headingId = decodeURIComponent(headingId);
      } catch {
        // Keep malformed heading fragments unchanged; they will not match.
      }
      if (targetPath === activeDoc.value && headingId) {
        document.getElementById(headingId)?.scrollIntoView({ block: 'start' });
      } else {
        void selectDoc(targetPath, sourceLine ? Number(sourceLine) : undefined, headingId || undefined);
      }
    } else {
      console.warn('Doc link not found:', targetPath);
    }
  });
}

/** 深链：`#/docs?doc=/docs/xxx.md&line=42`（查文档面板的检索结果跳转）。 */
function applyDeepLink(): void {
  const doc = route.query.doc;
  const line = route.query.line;
  if (typeof doc !== 'string' || !doc) return;
  const path = doc.startsWith('/') ? doc : `/${doc}`;
  if (!(path in docLoaders)) return;
  const sourceLine = typeof line === 'string' ? Number(line) : undefined;
  void selectDoc(path, Number.isFinite(sourceLine) ? sourceLine : undefined);
}

/** 把 ?q= 带进来的查询词预填到侧栏搜索框（决策在 utils/docs-search-entry.ts，那里有单测）。 */
function applyQueryPrefill(): void {
  const { keyword, notice } = decidePrefill(route.query.q, categories.value, currentLocale.value);
  searchQuery.value = keyword;
  prefilledQuery.value = keyword;
  prefillNotice.value = notice;
}

onMounted(() => {
  rebuildCategories();
  applyDeepLink();
  applyQueryPrefill();
});
// doc 与 line 各自独立监听：同一篇文档换行号（跳到另一段）时只改 line，
// 只看 doc 的话面板连续点同一文件的第二条结果不会滚动。
watch([() => route.query.doc, () => route.query.line], applyDeepLink);
watch(() => route.query.q, applyQueryPrefill);
// 语言切换：优先使用对应译文；标准页暂无英文译本时保留 source 语言页面作为可见 fallback。
watch(currentLocale, async () => {
  rebuildCategories();
  const rel = activeDoc.value.replace(/^\/docs\//, '');
  if (!rel) return;
  const counterpart = localizedCounterpart(activeDoc.value);
  if (counterpart in docLoaders) {
    await selectDoc(counterpart);
  }
});
// 语言切换后分类标签与标题都换语言了：中文标签命中的词在英文下可能一个都匹配不到。
// 上面的 watcher 只重建分类；这里对「由 URL 预填、且用户没改过」的词重判一次。
// 必须 { flush: 'post' }：post 队列一定晚于上面 pre-flush watcher 里的同步 rebuildCategories()，
// 因此 matches() 读到的 categories 已按新语言重建——与两个 watcher 的注册顺序无关。
watch(
  currentLocale,
  () => {
    const decision = decideLocaleSwitch(
      prefilledQuery.value,
      searchQuery.value,
      categories.value,
      currentLocale.value,
    );
    if (!decision) return;
    searchQuery.value = decision.keyword;
    prefilledQuery.value = decision.keyword;
    prefillNotice.value = decision.notice;
  },
  { flush: 'post' },
);
// 文档链接拦截（v-html 渲染后绑定，容器级事件委托）
void setupDocLinks();
</script>

<style scoped>
.docs-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
}

/* Header */
.docs-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.header-btn svg {
  width: 14px;
  height: 14px;
}

.header-btn:hover {
  background: var(--color-bg-hover, #f0f0f0);
  border-color: var(--color-border-hover, #ccc);
}

.docs-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.header-spacer {
  flex: 1;
}

/* Body layout */
.docs-notice {
  margin: 0;
  padding: 8px 24px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 13px;
  /* .docs-view 是 100vh 纵向 flex、.docs-body 是 flex: 1；不加会被压缩到看不见。 */
  flex-shrink: 0;
}

.docs-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>
