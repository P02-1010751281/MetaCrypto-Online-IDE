import { marked, Renderer, type Parser } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

// Configure marked with highlight.js
marked.setOptions({
  breaks: true,
  gfm: true,
});

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  text: 'plaintext',
  txt: 'plaintext',
};

function inferCodeLanguage(source: string): string {
  const text = source.trim();
  if (!text) return 'plaintext';

  if ((text.startsWith('{') || text.startsWith('['))) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      // A code block can start with a bracket without being JSON.
    }
  }

  if (/^(?:\$\s*)?(?:npm|pnpm|yarn|node|python3?|cargo|git|podman|docker|cd|mkdir|export|chmod)\b/m.test(text)) {
    return 'bash';
  }
  if (/\b(?:def|elif|from\s+\S+\s+import|import\s+\S+|True|False|None)\b/.test(text)) {
    return 'python';
  }
  if (/\b(?:const|let|function|interface|type|export|import)\b|=>/.test(text)) {
    return 'typescript';
  }
  return 'plaintext';
}

function normalizeCodeLanguage(language: string | undefined, source: string): string {
  const requested = language?.trim().toLowerCase();
  if (!requested) return inferCodeLanguage(source);
  return LANGUAGE_ALIASES[requested] || requested;
}

function displayCodeLanguage(language: string): string {
  const labels: Record<string, string> = {
    bash: 'Bash',
    javascript: 'JavaScript',
    json: 'JSON',
    mermaid: 'Mermaid',
    plaintext: 'Text',
    python: 'Python',
    typescript: 'TypeScript',
  };
  return labels[language] || language;
}

// Custom renderer for better code blocks
const renderer = new Renderer();
const headingIds = new Set<string>();

function slugifyHeading(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';
}

renderer.heading = function ({ tokens, depth, text }) {
  const baseId = slugifyHeading(text);
  let id = baseId;
  let suffix = 0;
  while (headingIds.has(id)) id = `${baseId}-${++suffix}`;
  headingIds.add(id);
  const content = this.parser.parseInline(tokens);
  return `<h${depth} id="${id}">${content}</h${depth}>`;
};

renderer.code = ({ text, lang }) => {
  const language = normalizeCodeLanguage(lang, text);
  // mermaid 块保留原始文本，渲染后由 mermaid.run 替换为 SVG
  if (language === 'mermaid') {
    return `<pre class="mermaid">${text}</pre>`;
  }
  let highlighted: string;
  try {
    highlighted = hljs.getLanguage(language)
      ? hljs.highlight(text, { language }).value
      : hljs.highlight(text, { language: 'plaintext' }).value;
  } catch {
    highlighted = hljs.highlight(text, { language: 'plaintext' }).value;
  }
  return `<pre class="doc-code" data-language="${displayCodeLanguage(language)}"><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

renderer.table = function (token) {
  // 单元格用子 token 渲染（保留表格内的链接/行内格式），而不是 c.text 纯文本
  const renderCell = (c: { text: string; tokens?: unknown[] }) =>
    c.tokens && c.tokens.length
      ? (this as Renderer).parser.parseInline(c.tokens as Parameters<
          Renderer['parser']['parseInline']
        >[0])
      : c.text;
  const header = token.header.map((h) => `<th>${renderCell(h)}</th>`).join('');
  const rows = token.rows
    .map((row) => {
      const cells = row.map((c) => `<td>${renderCell(c)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="doc-table-wrapper"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
};

renderer.blockquote = function (token) {
  const inner = this.parser.parse(
    (token as { tokens: unknown[] }).tokens as Parameters<Parser['parse']>[0],
  );
  // 语言切换行（`> [English](./x.en.md) · [中文](./x.md)`）：单段纯链接 →
  // 渲染为普通链接行（.doc-lang-links），不使用引用框样式
  if (/^<p>(?:<a [^>]*>.*?<\/a>[\s·]*)+<\/p>$/.test(inner.trim())) {
    return `<div class="doc-lang-links">${inner.replace(/<\/?p>/g, '').trim()}</div>`;
  }
  return `<blockquote>${inner}</blockquote>`;
};

marked.use({ renderer });

export function renderMarkdown(content: string, sourceLine?: number): string {
  headingIds.clear();
  let html: string;
  if (sourceLine && sourceLine > 0) {
    const tokens = marked.lexer(content);
    let offset = 0;
    let anchorAdded = false;
    html = tokens
      .map((token) => {
        const start = content.indexOf(token.raw, offset);
        if (start < 0) return marked.parser([token]);
        const end = start + token.raw.length;
        offset = end;
        const firstLine = content.slice(0, start).split('\n').length;
        const lastLine = content.slice(0, end).split('\n').length;
        const anchor = !anchorAdded && token.type !== 'space' &&
          sourceLine >= firstLine && sourceLine <= lastLine;
        if (anchor) anchorAdded = true;
        return `${anchor ? `<span id="source-line-${sourceLine}" class="source-line-anchor"></span>` : ''}${marked.parser([token])}`;
      })
      .join('');
  } else {
    html = marked.parse(content, { async: false }) as string;
  }
  if (typeof DOMPurify.sanitize === 'function') return DOMPurify.sanitize(html);

  // In Node-based checks dompurify exports its factory until it receives a
  // window. The browser bundle takes the first branch; this keeps the same
  // renderer callable by the unit harness without adding a runtime shim.
  if (typeof DOMPurify === 'function' && typeof window !== 'undefined') {
    const purifier = DOMPurify(window);
    if (typeof purifier.sanitize === 'function') return purifier.sanitize(html);
  }

  return html;
}

// 目录/标题元数据见 docs-catalog.ts；此处统一再导出，现有调用方的 import 不用改。
export * from './docs-catalog';
