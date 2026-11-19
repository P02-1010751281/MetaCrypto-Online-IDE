/**
 * 文档检索索引构建器（构建期，Node 侧）。
 *
 *   npx tsx scripts/ai-helper-docindex.ts index        生成索引（运行时副本 + 实验留档）
 *   npx tsx scripts/ai-helper-docindex.ts stats        只统计，不落盘
 *   npx tsx scripts/ai-helper-docindex.ts query "SM4 密钥扩展" [--limit 5]
 *   npx tsx scripts/ai-helper-docindex.ts eval <eval.json>
 *
 * 语料 = `docs/**\/*.md`（跳过点开头目录）。检索单元是按标题切出的段落：
 * 一个标题到下一个任意级标题之间，正文与标题本身都进索引。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { corpusDigest, mergeIndexes, parseDocIndex, searchDocs, type DocIndex } from '@/services/ai-helper/doc-search';
import { stripMarkdown, termFreq } from '@/services/ai-helper/doc-tokenize';

const ROOT = process.cwd();
const DOCS_DIR = 'docs';
const RUNTIME_PATH = resolve(ROOT, 'src/services/ai-helper/doc-index.json');
const ARCHIVE_PATH = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/doc-index.json');
const PDF_RUNTIME_PATH = resolve(ROOT, 'src/services/ai-helper/doc-index-pdf.json');
/** 文献语料：`paper/references` 不随包分发（未跟踪、版权与体积），索引只落实验目录。 */
const LIT_DIR = 'paper/references';
const LIT_INDEX_PATH = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/lit-index.json');
/** 文献按段落切块：目标长度与硬上限（字符）。 */
const LIT_CHUNK_TARGET = 700;
const LIT_CHUNK_MAX = 1400;
const PDF_ARCHIVE_PATH = resolve(ROOT, 'experiments/ai-helper-2026-11-14/out/doc-index-pdf.json');
/** PDF 单页少于这么多字符就不建段（封面、空白页、扫描页）。 */
const PDF_PAGE_MIN = 120;
const EXCERPT_LIMIT = 140;
/** CJK 单字与「高频单字」门槛：超过这么多段落出现的单字不进倒排。 */
const UNIGRAM = /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]$/;
const UNIGRAM_DF_LIMIT = 200;

interface Section {
  doc: number;
  line: number;
  level: number;
  heading: string;
  excerpt: string;
  length: number;
  freq: Map<string, number>;
}

interface Corpus {
  entries: Array<[string, string]>;
  docs: Array<[string, string]>;
  sections: Section[];
}

function listMarkdown(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(join(base, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) listMarkdown(path, base, out);
    else if (entry.name.endsWith('.md')) out.push(path);
  }
}

function plain(text: string): string {
  return stripMarkdown(text).replace(/\s+/g, ' ').trim();
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function splitSections(text: string): Array<{ line: number; level: number; heading: string; body: string }> {
  const lines = text.split(/\r?\n/);
  const fences: boolean[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fences.push(inFence);
      inFence = !inFence;
    } else {
      fences.push(inFence);
    }
  }

  const headings: Array<{ index: number; level: number; heading: string }> = [];
  lines.forEach((line, index) => {
    if (fences[index]) return;
    const match = line.match(HEADING);
    if (match) headings.push({ index, level: match[1].length, heading: match[2].trim() });
  });

  const sections: Array<{ line: number; level: number; heading: string; body: string }> = [];
  const first = headings[0]?.index ?? lines.length;
  const preamble = lines.slice(0, first).join('\n');
  if (plain(preamble).length >= 8) {
    sections.push({ line: 1, level: 0, heading: '', body: preamble });
  }
  headings.forEach((heading, position) => {
    const end = headings[position + 1]?.index ?? lines.length;
    sections.push({
      line: heading.index + 1,
      level: heading.level,
      heading: heading.heading,
      body: lines.slice(heading.index + 1, end).join('\n'),
    });
  });
  return sections;
}

function buildCorpus(): Corpus {
  const files: string[] = [];
  listMarkdown(DOCS_DIR, ROOT, files);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const corpus: Corpus = { entries: [], docs: [], sections: [] };
  for (const path of files) {
    const text = readFileSync(resolve(ROOT, path), 'utf8');
    corpus.entries.push([path, text]);
    const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
    const title = plain(titleMatch?.[1] ?? path.split('/').pop() ?? path);
    const docIndex = corpus.docs.push([path, title]) - 1;

    for (const section of splitSections(text)) {
      const heading = section.heading || title;
      const body = plain(section.body);
      const excerpt = body.slice(0, EXCERPT_LIMIT);
      // 标题里的希腊字母不参与建段：`Algorithm 12 BaseCaseMultiply(…, γ)` 这类只有标题、
      // 没有正文的段不应因为多了一个希腊符号就跨过「≥4 个词」的门槛；正文里的 θ/ρ 照常索引。
      const freq = termFreq(`${heading.replace(/[\u0370-\u03ff]/g, ' ')}\n${body}`);
      let length = 0;
      for (const [term, count] of freq) {
        // 希腊符号不参与长度归一：θ/ρ 这类单字母是「公式里的指代」，不增加文章篇幅；
        // 计入长度会让含公式的段整体降权，把 ML-DSA 这类近并列的排序翻掉（RESULTS §27）。
        if (/^[\u0370-\u03ff]$/.test(term)) continue;
        length += count;
      }
      if (length < 4) continue;
      corpus.sections.push({
        doc: docIndex,
        line: section.line,
        level: section.level,
        heading,
        excerpt,
        length,
        freq,
      });
    }
  }
  return corpus;
}

/** 递归列出某个目录下的 PDF（check 与建索引共用同一口径）。 */
function listPdfFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(resolve(ROOT, current), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.toLowerCase().endsWith('.pdf')) files.push(path);
    }
  };
  walk(dir);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files;
}

/** 文献 PDF 不随包分发：目录整份不在时按「没有源」处理，而不是让门禁炸掉。 */
function listPdfFilesSafe(dir: string): string[] {
  try {
    return listPdfFiles(dir);
  } catch {
    return [];
  }
}

function buildPdfCorpus(): Corpus {
  const files = listPdfFiles(DOCS_DIR);

  const corpus: Corpus = { entries: [], docs: [], sections: [] };
  const skipped: Array<[string, string]> = [];
  for (const path of files) {
    let text: string;
    try {
      text = execFileSync('pdftotext', ['-enc', 'UTF-8', resolve(ROOT, path), '-'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      skipped.push([path, `pdftotext 失败: ${(error as Error).message.slice(0, 60)}`]);
      continue;
    }
    if (text.replace(/\s/g, '').length < 500) {
      skipped.push([path, `可抽文本过少（${text.replace(/\s/g, '').length} 字符）`]);
      continue;
    }
    corpus.entries.push([path, text]);
    const docIndex = corpus.docs.push([path, path.split('/').pop() ?? path]) - 1;
    const pages = text.split('\f');
    pages.forEach((page, position) => {
      const body = plain(page);
      if (body.length < PDF_PAGE_MIN) return;
      const freq = termFreq(body);
      let length = 0;
      for (const count of freq.values()) length += count;
      if (length < 8) return;
      corpus.sections.push({
        doc: docIndex,
        line: position + 1,
        level: 0,
        heading: `第 ${position + 1} 页`,
        excerpt: body.slice(0, EXCERPT_LIMIT),
        length,
        freq,
      });
    });
  }
  for (const [path, reason] of skipped) console.log(`PDF_SKIP ${path} :: ${reason}`);
  return corpus;
}

interface PdfMeta { title: string; author: string; pages: number }

function readPdfMeta(path: string): PdfMeta {
  try {
    const text = execFileSync('pdfinfo', [resolve(ROOT, path)], { encoding: 'utf8' });
    const field = (name: string): string => {
      const match = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi'));
      return match?.[1]?.trim() ?? '';
    };
    return { title: field('Title'), author: field('Author'), pages: Number(field('Pages')) || 0 };
  } catch {
    return { title: '', author: '', pages: 0 };
  }
}

/** 段落切块：空行分段，短段合并到目标长度，超长段按上限硬切。 */
function paragraphChunks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 40 && !/^\d{1,3}$/.test(part));
  const chunks: string[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += LIT_CHUNK_MAX) {
      const piece = paragraph.slice(offset, offset + LIT_CHUNK_MAX);
      if (buffer.length + piece.length > LIT_CHUNK_TARGET) flush();
      buffer = buffer ? `${buffer} ${piece}` : piece;
      if (buffer.length >= LIT_CHUNK_TARGET) flush();
    }
  }
  flush();
  return chunks;
}

function buildLitCorpus(): Corpus {
  const dir = resolve(ROOT, LIT_DIR);
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) files.push(`${LIT_DIR}/${entry.name}`);
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const corpus: Corpus = { entries: [], docs: [], sections: [] };
  const skipped: Array<[string, string]> = [];
  for (const path of files) {
    let text: string;
    try {
      text = execFileSync('pdftotext', ['-enc', 'UTF-8', resolve(ROOT, path), '-'], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
      });
    } catch (error) {
      skipped.push([path, `pdftotext 失败: ${(error as Error).message.slice(0, 60)}`]);
      continue;
    }
    if (text.replace(/\s/g, '').length < 1000) {
      skipped.push([path, '可抽文本过少']);
      continue;
    }
    corpus.entries.push([path, text]);
    const meta = readPdfMeta(path);
    const fileName = path.split('/').pop() ?? path;
    const title = meta.title && meta.title.length > 3 ? meta.title : fileName.replace(/\.pdf$/i, '');
    const docIndex = corpus.docs.push([path, title]) - 1;
    text.split('\f').forEach((page, position) => {
      for (const chunk of paragraphChunks(page)) {
        const freq = termFreq(chunk);
        let length = 0;
        for (const count of freq.values()) length += count;
        if (length < 12) continue;
        corpus.sections.push({
          doc: docIndex,
          line: position + 1,
          level: 0,
          heading: chunk.slice(0, 60),
          excerpt: chunk.slice(0, EXCERPT_LIMIT),
          length,
          freq,
        });
      }
    });
  }
  for (const [path, reason] of skipped) console.log(`LIT_SKIP ${path} :: ${reason}`);
  return corpus;
}

function commandIndexLit(): void {
  const started = Date.now();
  const corpus = buildLitCorpus();
  const built = Date.now();
  const index = buildIndex(corpus, 'lit');
  index.corpus.sourceHash = sourceHashOf(listPdfFiles(LIT_DIR));
  // 文献索引只有一份（不进前端包），不需要留档副本。
  const text = `${JSON.stringify(index)}\n`;
  writeJsonAtomic(LIT_INDEX_PATH, text);
  const bytes = Buffer.byteLength(text);
  console.log(`DOC_INDEX_LIT build_ms=${built - started} total_ms=${Date.now() - started}`);
  summarize(index, bytes);
}

function buildIndex(corpus: Corpus, kind: 'md' | 'pdf' | 'lit' = 'md'): DocIndex {
  const post = new Map<string, number[]>();
  corpus.sections.forEach((section, index) => {
    for (const [term, tf] of section.freq) {
      let list = post.get(term);
      if (!list) {
        list = [];
        post.set(term, list);
      }
      list.push(index, tf);
    }
  });
  const terms = [...post.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted: Record<string, number[]> = {};
  let tokens = 0;
  let dropped = 0;
  for (const term of terms) {
    const list = post.get(term) ?? [];
    // 高频 CJK 单字（标/的/准…）几乎没有区分度，却占了四分之一索引，直接不进倒排。
    // 稀有单字保留，短查询（「S 盒」的「盒」）仍能命中。
    if (UNIGRAM.test(term) && list.length / 2 > UNIGRAM_DF_LIMIT) {
      dropped += 1;
      continue;
    }
    sorted[term] = list;
  }
  for (const section of corpus.sections) tokens += section.length;
  console.log(`DOC_INDEX pruned_unigrams=${dropped}`);

  return {
    v: 1,
    kind,
    corpus: {
      files: corpus.docs.length,
      sections: corpus.sections.length,
      tokens,
      hash: corpusDigest(corpus.entries),
    },
    docs: corpus.docs,
    secs: corpus.sections.map((section) => [
      section.doc,
      section.line,
      section.level,
      section.heading,
      section.excerpt,
      section.length,
    ]),
    post: sorted,
  };
}

/** 先写临时文件再 rename：并行开发时另一条线可能正在读索引，直接覆盖会读到半截 JSON。 */
function writeJsonAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * 运行时副本与实验留档写同一份序列化结果：两份副本只差落盘时刻，
 * 内容不可能不同（并发重建时最多短暂不同步，由单测重试兜住）。
 */
function writeJsonPair(runtimePath: string, archivePath: string, index: DocIndex): number {
  const text = `${JSON.stringify(index)}\n`;
  writeJsonAtomic(runtimePath, text);
  writeJsonAtomic(archivePath, text);
  return Buffer.byteLength(text);
}

function summarize(index: DocIndex, runtimeBytes: number): void {
  let pairs = 0;
  for (const key of Object.keys(index.post)) pairs += index.post[key].length / 2;
  console.log(`DOC_INDEX files=${index.corpus.files} sections=${index.corpus.sections} ` +
    `tokens=${index.corpus.tokens} terms=${Object.keys(index.post).length} postings=${pairs}`);
  console.log(`DOC_INDEX bytes=${(runtimeBytes / 1048576).toFixed(2)}MB hash=${index.corpus.hash}`);
}

function commandIndex(): void {
  const started = Date.now();
  const corpus = buildCorpus();
  const built = Date.now();
  const index = buildIndex(corpus, 'md');
  const runtimeBytes = writeJsonPair(RUNTIME_PATH, ARCHIVE_PATH, index);
  console.log(`DOC_INDEX build_ms=${built - started} total_ms=${Date.now() - started}`);
  summarize(index, runtimeBytes);
}

function commandIndexPdf(): void {
  const started = Date.now();
  const corpus = buildPdfCorpus();
  const built = Date.now();
  const index = buildIndex(corpus, 'pdf');
  index.corpus.sourceHash = sourceHashOf(listPdfFiles(DOCS_DIR));
  const runtimeBytes = writeJsonPair(PDF_RUNTIME_PATH, PDF_ARCHIVE_PATH, index);
  console.log(`DOC_INDEX_PDF build_ms=${built - started} total_ms=${Date.now() - started}`);
  summarize(index, runtimeBytes);
}

/**
 * 源文件字节摘要：`path␀sha256(字节)␀` 依路径排序后串起来再取 sha256 前 16 位。
 *
 * 与 `corpus.hash`（抽取文本）分工：那个只有重建才能算（PDF 要抽文本 7~9 s），
 * 这个只读字节（49+19 份 PDF 约 117 MB，实测 ~2 s），够便宜到放进每次门禁。
 * 新增、删除、改动都会被它抓到，且与 mtime 无关。
 */
function sourceHashOf(files: string[]): string {
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path);
    hash.update('\u0000');
    hash.update(createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex'));
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, 16);
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    // 明确的兜底：0 表示「文件不存在」。两条副索引本就可选，调用方据 0 给出 warn 而不是 fail。
    return 0;
  }
}

/**
 * 读索引里存的源字节摘要。
 *
 * 返回 `''` = 旧索引没有该字段（调用方退回 mtime 比较）；返回 `null` = 索引读不出或解析失败
 * （这是真问题，调用方按 fail 处理）——两种情况都不吞掉。
 */
function readSourceHash(indexPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch (error) {
    console.warn(`DOC_INDEX warn: 读不出索引 ${indexPath}（${(error as Error).message}）`);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DocIndex;
    return typeof parsed.corpus?.sourceHash === 'string' ? parsed.corpus.sourceHash : '';
  } catch (error) {
    console.warn(`DOC_INDEX warn: 索引无法解析 ${indexPath}（${(error as Error).message}）`);
    return null;
  }
}
function newestMtime(files: string[]): number {
  let newest = 0;
  for (const path of files) newest = Math.max(newest, mtimeOf(resolve(ROOT, path)));
  return newest;
}

/**
 * 新鲜度门禁（不重建、不落盘）。
 *
 * - Markdown：语料是纯文本，摘要可精确重算（~1 s），过期即失败。
 * - PDF / 文献：重算要重新抽 19~49 份 PDF 的文本（7~9 s），门禁里不做。
 *   改为比**源文件字节摘要**（`corpus.sourceHash`，读 117 MB 约 2 s）：新增、删除、
 *   改动都能抓到，且与 mtime 无关。旧索引没有这个字段时退回比 mtime——那条路在干净
 *   检出里会假红（git 把源 PDF 与索引写成同一时刻、顺序不定），所以重建一次索引即可
 *   永久摆脱；见到 `sourceHash` 缺失的提示就重跑对应 `docs:index:pdf` / `docs:index:lit`。
 */
function commandCheck(): void {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!mtimeOf(RUNTIME_PATH)) {
    problems.push('Markdown 索引缺失（src/services/ai-helper/doc-index.json）→ npm run docs:index');
  } else {
    const index = parseDocIndex(readFileSync(RUNTIME_PATH, 'utf8'));
    const corpus = buildCorpus();
    const digest = corpusDigest(corpus.entries);
    if (digest !== index.corpus.hash) {
      problems.push(
        `Markdown 索引过期：语料 ${corpus.entries.length} 篇摘要 ${digest} ≠ 索引 ${index.corpus.files} 篇 ${index.corpus.hash} → npm run docs:index`,
      );
    }
  }

  const secondary: Array<[string, string, () => string[], string]> = [
    ['PDF', PDF_RUNTIME_PATH, () => listPdfFiles(DOCS_DIR), 'docs:index:pdf'],
    ['文献', LIT_INDEX_PATH, () => listPdfFilesSafe(LIT_DIR), 'docs:index:lit'],
  ];
  for (const [label, indexPath, listSources, rebuild] of secondary) {
    const indexMtime = mtimeOf(indexPath);
    if (!indexMtime) {
      // 两条索引都是可选的：PDF 缺了面板降级为只查 Markdown，文献缺了不影响前端。
      warnings.push(`${label} 索引不存在（可选，跳过）：${rebuild}`);
      continue;
    }
    const sources = listSources();
    if (sources.length === 0) {
      // 源整份不在（例如只检出代码、没带文献 PDF）时无从比较，跳过而不是报红。
      warnings.push(`${label} 源目录没有 PDF（跳过新鲜度比较）：${rebuild}`);
      continue;
    }
    const stored = readSourceHash(indexPath);
    if (stored === null) {
      problems.push(`${label} 索引读不出或无法解析：${indexPath} → npm run ${rebuild}`);
      continue;
    }
    if (stored) {
      const current = sourceHashOf(sources);
      if (current !== stored) {
        problems.push(
          `${label} 索引过期：源文件字节摘要 ${current} ≠ 索引 ${stored} → npm run ${rebuild}`,
        );
      }
      continue;
    }
    const newest = newestMtime(sources);
    if (newest > indexMtime) {
      problems.push(
        `${label} 索引过期：源文件 ${new Date(newest).toISOString()} 比索引 ${new Date(indexMtime).toISOString()} 新 → npm run ${rebuild}`,
      );
    }
  }

  for (const warning of warnings) console.warn(`DOC_INDEX_CHECK warn: ${warning}`);
  if (problems.length) {
    for (const problem of problems) console.error(`DOC_INDEX_CHECK fail: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('DOC_INDEX_CHECK ok（Markdown 语料摘要一致，副索引无更新）');
}

function commandStats(): void {
  const started = Date.now();
  const index = buildIndex(buildCorpus());
  summarize(index, 0);
  console.log(`DOC_INDEX stats_ms=${Date.now() - started}`);
}

function loadIndex(withPdf = false, withLit = false): DocIndex {
  if (withLit) return parseDocIndex(readFileSync(LIT_INDEX_PATH, 'utf8'));
  const markdown = parseDocIndex(readFileSync(RUNTIME_PATH, 'utf8'));
  if (!withPdf) return markdown;
  try {
    const pdf = parseDocIndex(readFileSync(PDF_RUNTIME_PATH, 'utf8'));
    return mergeIndexes(markdown, pdf);
  } catch {
    console.log('DOC_INDEX_PDF 不存在，只检索 Markdown 语料（先跑 index:pdf）');
    return markdown;
  }
}

function commandQuery(argv: string[]): void {
  const text = argv.filter((arg) => !arg.startsWith('--')).join(' ').trim();
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 5;
  if (!text) {
    console.error('用法: query "关键词" [--limit=5]');
    process.exit(2);
  }
  const index = loadIndex(argv.includes('--pdf'), argv.includes('--lit'));
  const hits = searchDocs(index, text, { limit });
  console.log(`QUERY ${JSON.stringify(text)} hits=${hits.length}`);
  hits.forEach((hit, position) => {
    console.log(`${position + 1}. ${hit.score.toFixed(2)}  ${hit.path}#L${hit.line}  ${hit.heading}`);
    console.log(`   命中: ${hit.terms.join(' ')}`);
    if (hit.excerpt) console.log(`   摘录: ${hit.excerpt.slice(0, 100)}`);
  });
}

interface EvalCase {
  q: string;
  expect: string[];
  note?: string;
}

function commandEval(argv: string[]): void {
  const file = argv.find((arg) => !arg.startsWith('--'));
  if (!file) {
    console.error('用法: eval <eval.json>');
    process.exit(2);
  }
  const cases = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as EvalCase[];
  const index = loadIndex(argv.includes('--pdf'), argv.includes('--lit'));
  let hit = 0;
  const misses: string[] = [];
  cases.forEach((item, position) => {
    const hits = searchDocs(index, item.q, { limit: 5 });
    const paths = hits.map((entry) => entry.path);
    const ok = item.expect.some((want) => paths.some((path) => path === want || path.endsWith(want) || path.includes(want)));
    if (ok) hit += 1;
    else misses.push(` #${position + 1} ${item.q} -> ${paths[0] ?? '(空)'} 期望 ${item.expect.join('|')}`);
    if (process.env.DOC_EVAL_VERBOSE) {
      console.log(`${ok ? 'OK ' : 'MISS'} ${item.q}\n     top5: ${paths.join(', ')}`);
    }
  });
  const rate = ((hit / cases.length) * 100).toFixed(1);
  console.log(`DOC_EVAL cases=${cases.length} recall@5=${rate}% (${hit}/${cases.length})`);
  for (const miss of misses) console.log(miss);
  if (hit !== cases.length) process.exitCode = 1;
}

const command = process.argv[2];
const rest = process.argv.slice(3);
if (command === 'index') commandIndex();
else if (command === 'index:pdf') commandIndexPdf();
else if (command === 'index:lit') commandIndexLit();
else if (command === 'check') commandCheck();
else if (command === 'stats') commandStats();
else if (command === 'query') commandQuery(rest);
else if (command === 'eval') commandEval(rest);
else {
  console.error('用法: index | index:pdf | index:lit | check | stats | query "词" [--limit=N] [--pdf|--lit] | eval <eval.json> [--pdf|--lit]');
  process.exit(2);
}
