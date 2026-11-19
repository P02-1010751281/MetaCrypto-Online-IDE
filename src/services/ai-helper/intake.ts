/**
 * A/B 单入口的**判别内核**（纯函数、不碰 DOM、不读文件）。
 *
 * 规则来自 PLAN §3.1：先按扩展名，扩展名缺失或与内容冲突时按内容特征；
 * 两种判据都拿不准就是「判断不了」，交给用户指定——自动判别只做**预填**，不做锁定。
 *
 * 为什么判别要独立成模块而不是写在面板里：
 *   · 它是这条入口唯一的确定性部分，必须能被单测钉住（`tests/unit/ai-helper-intake.test.ts`）；
 *   · 面板只负责把 `kind` 预填到开关上，用户改过就以用户为准——这条「预填不锁定」
 *     得在类型上看得见（`IntakeVerdict` 只描述判据，不持有选择）。
 */

/** 入口把内容送到哪条线：A（文档）/ B（代码）/ 判不出来。 */
export type IntakeKind = 'doc' | 'code' | 'unknown';

/** 判定依据。`conflict` 专指扩展名与内容互相矛盾、由内容推翻扩展名。 */
export type IntakeBasis = 'extension' | 'content' | 'conflict' | 'none';

export interface IntakeVerdict {
  readonly kind: IntakeKind;
  readonly basis: IntakeBasis;
  /** 人类可读的证据，按判据出现顺序；面板直接展示，不在这里拼句子。 */
  readonly evidence: readonly string[];
}

export interface IntakeInput {
  /** 文件名（可空：用户可能只粘贴正文）。 */
  readonly name?: string;
  /** 正文（可空：PDF/DOCX 是二进制，面板不强行解码）。 */
  readonly text?: string;
}

/** 文档类扩展名（PLAN §3.1 的清单；`markdown`/`rst` 是同一类文本的常见写法）。 */
const DOC_EXTENSIONS = new Set(['pdf', 'md', 'markdown', 'txt', 'tex', 'docx', 'rst']);

/** 代码类扩展名（PLAN §3.1 的清单；`mjs`/`tsx`/`hpp`/`cxx` 是同一语言的常见变体）。 */
const CODE_EXTENSIONS = new Set(['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'py', 'js', 'mjs', 'ts', 'tsx', 'rs', 'go']);

/** 二进制文档：不读正文，只按扩展名判。 */
const BINARY_DOC_EXTENSIONS = new Set(['pdf', 'docx']);

interface Signal {
  readonly pattern: RegExp;
  readonly label: string;
}

/**
 * 代码特征。宁可少收也不要收「`{` 就算代码」这类过宽的规则：
 * 公式里的集合记号也带花括号，误判成代码会把标准原文送进反解析器。
 */
const CODE_SIGNALS: readonly Signal[] = [
  { pattern: /(?:^|\n)\s*#\s*include\s*[<"]/, label: '#include' },
  { pattern: /(?:^|\n)\s*(?:def|class|function|fn|func)\s+[A-Za-z_]\w*\s*[({<:]/, label: '函数或类定义' },
  { pattern: /(?:^|\n)\s*(?:import\s+[\w.]+|from\s+\S+\s+import|use\s+\w+::|package\s+\w+)/, label: '导入语句' },
  { pattern: /(?:^|\n)\s*[A-Za-z_]\w*\s*\([^)\n]*\)\s*;?\s*$/m, label: '函数调用语句' },
  { pattern: /=>|\breturn\b|\bconst\b|\blet\b|\bvoid\b/, label: '代码关键字' },
];

/** 文档特征：标准/条款/附录这类结构词，以及标准编号与公式块。 */
const DOC_SIGNALS: readonly Signal[] = [
  { pattern: /(?:^|\n)\s*第\s*[一二三四五六七八九十百零\d]+\s*[章节条款]/, label: '章节条款结构' },
  { pattern: /(?:^|\n)\s*附录\s*[A-ZＡ-Ｚ\d]/, label: '附录' },
  { pattern: /\bGB\/T|\bGM\/T|\bISO\/IEC|\bFIPS\s*\d+|\bSP\s*800-|\bRFC\s*\d+/, label: '标准编号' },
  { pattern: /\$\$[\s\S]+?\$\$|\\begin\{(?:equation|align)\}/, label: '公式块' },
];

/** 取扩展名：小写、不含点；没有点就是空串。 */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** 二进制文档不需要正文：读出来也是乱码，反而会污染内容判据。 */
export function isBinaryDoc(name: string): boolean {
  return BINARY_DOC_EXTENSIONS.has(extensionOf(name));
}

function hits(text: string, signals: readonly Signal[]): Signal[] {
  if (!text) return [];
  return signals.filter((signal) => signal.pattern.test(text));
}

/**
 * 判别一份输入的归属。
 *
 * 判定顺序（与 PLAN §3.1 的表一致）：
 *   1. 扩展名明确、内容不反对 → 按扩展名；
 *   2. 扩展名与内容相反（内容只出现另一侧特征）→ 由内容推翻扩展名，`basis: 'conflict'`；
 *   3. 没有扩展名（或扩展名不认识）→ 按内容；
 *   4. 内容两侧都有、或两侧都没有 → `unknown`，交用户指定。
 */
export function detectIntake(input: IntakeInput): IntakeVerdict {
  const name = input.name ?? '';
  const text = input.text ?? '';
  const ext = extensionOf(name);
  const codeHits = hits(text, CODE_SIGNALS);
  const docHits = hits(text, DOC_SIGNALS);
  const byExtension: IntakeKind | null =
    DOC_EXTENSIONS.has(ext) ? 'doc' : CODE_EXTENSIONS.has(ext) ? 'code' : null;

  if (byExtension === 'doc') {
    // 二进制文档没有可信正文，只按扩展名。
    if (!text || isBinaryDoc(name)) {
      return { kind: 'doc', basis: 'extension', evidence: [`扩展名 .${ext}`] };
    }
    if (codeHits.length > 0 && docHits.length === 0) {
      return {
        kind: 'code',
        basis: 'conflict',
        evidence: [`扩展名 .${ext} 是文档`, `但正文像代码：${codeHits[0].label}`],
      };
    }
    return { kind: 'doc', basis: 'extension', evidence: [`扩展名 .${ext}`] };
  }

  if (byExtension === 'code') {
    if (docHits.length > 0 && codeHits.length === 0) {
      return {
        kind: 'doc',
        basis: 'conflict',
        evidence: [`扩展名 .${ext} 是代码`, `但正文像文档：${docHits[0].label}`],
      };
    }
    return { kind: 'code', basis: 'extension', evidence: [`扩展名 .${ext}`] };
  }

  // 没有可用扩展名：只能按内容。
  if (codeHits.length > 0 && docHits.length === 0) {
    return { kind: 'code', basis: 'content', evidence: [`正文像代码：${codeHits[0].label}`] };
  }
  if (docHits.length > 0 && codeHits.length === 0) {
    return { kind: 'doc', basis: 'content', evidence: [`正文像文档：${docHits[0].label}`] };
  }
  if (codeHits.length > 0 && docHits.length > 0) {
    return {
      kind: 'unknown',
      basis: 'none',
      evidence: [`正文同时像代码（${codeHits[0].label}）与文档（${docHits[0].label}）`],
    };
  }
  return { kind: 'unknown', basis: 'none', evidence: [] };
}
