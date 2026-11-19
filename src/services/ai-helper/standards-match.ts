/**
 * A 线入口的**匹配内核**：把你带来的正文/文件名对到「已登记的标准」上。
 *
 * 两件事必须分清，代码里也要分得开：
 *   · **匹配**（本模块）只回答「你这份东西像哪一份已登记标准」，依据是标准编号与算法名；
 *   · **核对**（面板里的文件哈希）才回答「你手上这份与登记原文是不是同一份字节」。
 * 匹配不能说成核对：正文里出现 `800-38C` 只证明它提到了 CCM，不证明它就是登记的那份原文。
 *
 * 判据来自 `verdicts-index.json` 里的 `standard.name` / `standard.version`：
 * 编号（FIPS 180-4 / SP 800-38B）从名称里解析，算法名（SHA2/CMAC/CCM）取 id 末段。
 * 新增一份登记标准时不需要改这里；但**每一份都必须至少导出一个信号**，
 * 否则它永远不会被匹配到——由 `tests/unit/ai-helper-standards-match.test.ts` 兜住。
 *
 * 命中要求唯一：两个标准同分就是「猜不出来」，返回 null，让用户自己选，不替他挑。
 */

/** 参与匹配的最小字段集：够用来解析编号，不需要整份判据。 */
export interface StandardsMatchInput {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
}

/** 一份标准身上可用于匹配的信号。编号是最强信号，算法名是弱信号。 */
export interface StandardsSignal {
  readonly id: string;
  /** 「FIPS 180-4」「SP 800-38C」这类标准编号；解析不出来是 null。 */
  readonly designation: string | null;
  /** 编号的数字部分（「180-4」「800-38C」）：文件名里最常出现。 */
  readonly bareNumber: string | null;
  /** 算法名（id 末段，非纯数字时），用于只写了算法名的正文。 */
  readonly keyword: string | null;
}

export interface StandardsMatch {
  readonly id: string;
  /** 命中的那个词（取自标准自己的编号/算法名，不是从正文里抄的），界面直接展示。 */
  readonly token: string;
  readonly strength: 'designation' | 'keyword';
}

/** 正文匹配只看前 200 KB：整本书粘进来时不必逐字扫。 */
const MAX_SCAN_CHARS = 200 * 1024;

/** 编号族：名称里怎么写的都能认（FIPS / SP / GB/T / GM/T）。 */
const DESIGNATION_FAMILIES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /FIPS\s*(\d+(?:[-.]\d+)?)/i, label: 'FIPS' },
  { pattern: /\bSP\s*(\d+[A-Za-z]?-\d+[A-Za-z]?)/i, label: 'SP' },
  { pattern: /GB\/?T\s*([\d.]+(?:-\d{4})?)/i, label: 'GB/T' },
  { pattern: /GM\/?T\s*([\d.]+(?:-\d{4})?)/i, label: 'GM/T' },
  { pattern: /\bRFC\s*(\d+)/i, label: 'RFC' },
];

/** 去掉非字母数字：文件名里的 `sp800_38c-ccm.pdf` 也能和 `800-38C` 对上。 */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 把一段文字转成正则源串：字母数字外的分隔符一律允许 0~1 个（空格、连字符、点）。 */
function flexibleSource(value: string): string {
  return value
    .split(/([^a-z0-9]+)/i)
    .filter((part) => part.length > 0)
    .map((part) => (/^[a-z0-9]+$/i.test(part) ? part : '[\\s._-]*'))
    .join('');
}

/** 编号边界：两侧不能再接字母或数字，免得 `800-38C` 命中 `800-38CZ`。 */
function boundedPattern(body: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
}

/**
 * 解析一份标准的匹配信号。
 *
 * 名称形如 `NIST FIPS 180-4`、`NIST SP 800-38B`；算法名取 id 末段
 * （`fips180-4-SHA2` → `SHA2`）。末段是纯数字时不当算法名（`180-4` 已经由编号覆盖）。
 */
export function signalOf(standard: StandardsMatchInput): StandardsSignal {
  const name = standard.name ?? '';
  let designation: string | null = null;
  for (const family of DESIGNATION_FAMILIES) {
    const hit = family.pattern.exec(name);
    if (hit) {
      designation = `${family.label} ${hit[1].replace(/\./g, '-')}`;
      break;
    }
  }

  let bareNumber: string | null = null;
  if (designation) {
    bareNumber = designation.slice(designation.indexOf(' ') + 1);
  }

  // 算法名取 id 末段；纯数字（`180-4` 的 `4`）不是算法名，编号已经覆盖它。
  const tail = standard.id.split(/[-_]/).filter(Boolean).pop() ?? '';
  const isAlgorithmName = /^[a-z]+[0-9]*$/i.test(tail) && tail.length > 1;

  return { id: standard.id, designation, bareNumber, keyword: isAlgorithmName ? tail : null };
}

/** 算法名在正文里的几种常见写法：`SHA2` 对应 `SHA-2`/`SHA 2`。 */
function keywordSources(keyword: string): string[] {
  const sources = [flexibleSource(keyword)];
  const split = /^([a-z]+)(\d+)$/i.exec(keyword);
  if (split) {
    const hyphenated = `${split[1]}-${split[2]}`;
    if (hyphenated !== keyword) sources.push(flexibleSource(hyphenated));
  }
  return sources;
}

interface Scored {
  readonly signal: StandardsSignal;
  readonly score: number;
  readonly token: string;
  readonly strength: StandardsMatch['strength'];
}

function scoreOne(signal: StandardsSignal, haystack: string, squashedName: string): Scored | null {
  if (signal.designation) {
    const body = flexibleSource(signal.designation);
    if (boundedPattern(body).test(haystack)) {
      return { signal, score: 3, token: signal.designation, strength: 'designation' };
    }
    if (signal.bareNumber && boundedPattern(flexibleSource(signal.bareNumber)).test(haystack)) {
      return { signal, score: 2, token: signal.designation, strength: 'designation' };
    }
  }
  // 文件名：去掉分隔符后包含编号（`sp800-38c-ccm.pdf` → `sp80038ccc`)
  if (signal.bareNumber && squashedName.includes(squash(signal.bareNumber))) {
    return { signal, score: 2, token: signal.designation ?? signal.bareNumber, strength: 'designation' };
  }
  if (signal.keyword) {
    for (const source of keywordSources(signal.keyword)) {
      if (boundedPattern(source).test(haystack)) {
        return { signal, score: 1, token: signal.keyword, strength: 'keyword' };
      }
    }
  }
  return null;
}

/**
 * 把一份「你带来的东西」对到已登记标准上。
 *
 * 只有**唯一最高分**才算命中：两份标准同分（比如正文同时提到 CMAC 与 CCM）时返回 null，
 * 面板显示「没认出来，请自己选」——这里不能替用户挑一个看起来最像的。
 */
export function matchStandard(
  input: { readonly name?: string; readonly text?: string },
  standards: readonly StandardsMatchInput[],
): StandardsMatch | null {
  const name = (input.name ?? '').slice(0, 512);
  const text = (input.text ?? '').slice(0, MAX_SCAN_CHARS);
  const haystack = `${name}\n${text}`.toLowerCase();
  const squashedName = squash(name);
  if (!haystack.trim()) return null;

  const scored: Scored[] = [];
  for (const standard of standards) {
    const hit = scoreOne(signalOf(standard), haystack, squashedName);
    if (hit) scored.push(hit);
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (second && second.score === best.score) return null;
  return { id: best.signal.id, token: best.token, strength: best.strength };
}
