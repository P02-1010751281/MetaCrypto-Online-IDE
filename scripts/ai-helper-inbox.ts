/**
 * 缺块回流 channel 1 的生产端与读取端（用户侧 AI Helper · 维护者线收件箱）
 *
 * 来源：B2（P3）V1 的 `unsupported` 诊断——它们正是「现有块类型表达不了」的机器可读证据。
 * 每条诊断变成一条 ticket（缺什么、证据在哪一行、期望什么块签名、最小复现），按
 * `语义标签@来源哈希` 去重后落到 `experiments/ai-helper-2026-11-14/inbox/`。
 *
 * 三条子命令：
 *   ingest  （默认）读 p3-summary.json → 生成 ticket → 合并进收件箱，只写新增项
 *   --dry-run         只打印将要新增的 id，不落盘
 *   --check           只读：校验现有收件箱每个文件都能解析、id 自洽，退出码 1 表示有坏文件
 *
 * 去重键不是整文件哈希：同一文件里的两处同类缺失会合成一条，换个文件则是另一条
 * （见 src/services/ai-helper/missing-block-ticket.ts 的头部说明）。
 *
 * 复跑：
 *   AIVERIFY_ENTRY=scripts/ai-helper-inbox.ts npx vite build --config vite.verify.config.ts
 *   node dist-verify/ai-helper-inbox.js [--dry-run|--check]
 *
 * 本脚本只写 `inbox/` 下的 ticket 文件，不改任何源码或语料。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  buildTicket,
  mergeTickets,
  normalizeEvidence,
  parseTicket,
  serializeTicket,
  summarizeInbox,
} from '@/services/ai-helper/missing-block-ticket';
import type { ExpectedBlock, MissingBlockTicket, TicketDraft } from '@/services/ai-helper/missing-block-ticket';

const SUMMARY = 'experiments/ai-helper-2026-11-14/p3/out/p3-summary.json';
const INBOX = 'experiments/ai-helper-2026-11-14/inbox';
const SAMPLES = 'experiments/ai-helper-2026-11-14/p3/samples';

interface Diagnostic {
  line: number;
  kind: string;
  code: string;
  message: string;
  snippet?: string;
}

interface SampleRow {
  id: string;
  file: string;
  diagnostics: Diagnostic[];
}

/**
 * 诊断码 → 期望块签名。只有 B2 实际报出来的码才在这里；
 * 未知码走 fallback，并在 codeShape 里写明「尚无块形态」，不冒充已有设计。
 */
const EXPECTED_BLOCKS: Record<string, ExpectedBlock> = {
  preprocessor: {
    name: 'cpp_directive',
    inputs: [],
    outputs: [],
    codeShape:
      '按目标语言产出该行：C 侧原样保留 #include/#define；Python/JS 侧降级为注释。不参与块间数据流。',
  },
  pointer: {
    name: 'pointer_param_ref',
    inputs: [{ name: 'TARGET', types: ['Bytes'] }],
    outputs: [],
    codeShape:
      '只覆盖「形参是指向定长数组的指针、函数体整段被吸收」这一形态：生成代码按原地改写传参。解引用运算不作表达。',
  },
};

function expectedBlockFor(code: string): ExpectedBlock {
  return EXPECTED_BLOCKS[code] ?? {
    name: `proposed_block_${code.replace(/[^a-z0-9]+/gu, '_')}`,
    inputs: [],
    outputs: [],
    codeShape: `待设计：诊断码 ${code} 目前没有块形态，维护者需要先决定表示的代码形状。`,
  };
}

function hashOf(parts: string[]): string {
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

const log = (line = ''): void => {
  console.log(line);
};

function readExistingInbox(dir: string): { tickets: MissingBlockTicket[]; broken: string[] } {
  if (!existsSync(dir)) return { tickets: [], broken: [] };
  const tickets: MissingBlockTicket[] = [];
  const broken: string[] = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      broken.push(`${name}: JSON 解析失败（${error instanceof Error ? error.message : String(error)}）`);
      continue;
    }
    const parsed = parseTicket(raw);
    if (!parsed.ok) {
      broken.push(`${name}: ${parsed.problems.map((p) => `${p.code}@${p.field}`).join(', ')}`);
      continue;
    }
    if (`${parsed.ticket.id}.json` !== name) {
      broken.push(`${name}: 文件名与 id 不一致（期望 ${parsed.ticket.id}.json）`);
      continue;
    }
    tickets.push(parsed.ticket);
  }
  return { tickets, broken };
}

function draftsFromSummary(summaryPath: string): TicketDraft[] {
  const parsed = JSON.parse(readFileSync(summaryPath, 'utf8')) as { v1?: { samples?: SampleRow[] } };
  const samples = parsed.v1?.samples ?? [];
  if (!samples.length) throw new Error(`${summaryPath} 里没有 v1.samples，无法产出 ticket`);
  const drafts: TicketDraft[] = [];
  for (const sample of samples) {
    const samplePath = `${SAMPLES}/${sample.file}`;
    for (const diagnostic of sample.diagnostics ?? []) {
      if (diagnostic.kind !== 'unsupported') continue;
      const excerpt = normalizeEvidence(diagnostic.snippet ?? diagnostic.message);
      drafts.push({
        semanticTag: `unsupported-${diagnostic.code}`,
        summary: `${sample.id}:${diagnostic.line} ${diagnostic.message}`,
        source: {
          kind: 'code-ref',
          file: samplePath,
          line: diagnostic.line,
          excerpt: diagnostic.snippet ?? diagnostic.message,
          hash: hashOf(['code-ref', samplePath, excerpt]),
        },
        expectedBlock: expectedBlockFor(diagnostic.code),
        reproduction: {
          kind: 'code',
          locator: samplePath,
          content: diagnostic.snippet,
          note: 'V1 在签名/声明解析阶段报出；V3 当前把该函数作为 absorbed 绑定跑通，缺的是块级表达而非可执行真值。',
        },
      });
    }
  }
  return drafts;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkOnly = args.includes('--check');
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const summaryPath = resolve(process.cwd(), valueOf('--summary') ?? SUMMARY);
  const inboxDir = resolve(process.cwd(), valueOf('--inbox') ?? INBOX);

  const existing = readExistingInbox(inboxDir);
  let failed = false;
  for (const line of existing.broken) {
    failed = true;
    log(`✗ ${line}`);
  }
  log(`收件箱 ${relative(process.cwd(), inboxDir)}：已有 ${existing.tickets.length} 条${existing.broken.length ? `，坏文件 ${existing.broken.length} 个` : ''}`);

  if (checkOnly) {
    const summary = summarizeInbox(existing.tickets);
    log(`   状态 open=${summary.byStatus.open} accepted=${summary.byStatus.accepted} rejected=${summary.byStatus.rejected} shipped=${summary.byStatus.shipped}`);
    log(`   语义标签 ${Object.entries(summary.byTag).map(([tag, count]) => `${tag}×${count}`).join(' ') || '(空)'}`);
    log(`CHECK ${failed ? 'FAIL' : 'PASS'}`);
    process.exit(failed ? 1 : 0);
  }

  if (!existsSync(summaryPath)) {
    log(`✗ 找不到 ${relative(process.cwd(), summaryPath)}（先跑 p3 的 V1）`);
    process.exit(2);
  }

  const drafts = draftsFromSummary(summaryPath);
  const incoming = drafts.map((draft) => buildTicket(draft));
  const merged = mergeTickets(existing.tickets, incoming);
  const fresh = merged.tickets.filter((ticket) => merged.added.includes(ticket.id));

  log(`本次扫描 ${drafts.length} 条 unsupported 诊断 → 新 ticket ${merged.added.length} 条，重复 ${merged.duplicates.length} 条`);
  for (const ticket of fresh) log(`   + ${ticket.id}  ${ticket.summary}`);
  for (const id of merged.duplicates) log(`   = ${id}（已在收件箱，保留原状态）`);

  if (!dryRun && fresh.length) {
    mkdirSync(inboxDir, { recursive: true });
    for (const ticket of fresh) writeFileSync(join(inboxDir, `${ticket.id}.json`), serializeTicket(ticket), 'utf8');
    log(`已写入 ${fresh.length} 个文件到 ${relative(process.cwd(), inboxDir)}`);
  } else if (dryRun) {
    log('--dry-run：未写盘');
  } else {
    log('没有新增，收件箱未变（幂等）');
  }

  const summary = summarizeInbox(merged.tickets);
  log(`合计 ${summary.total} 条：open=${summary.byStatus.open} accepted=${summary.byStatus.accepted} rejected=${summary.byStatus.rejected} shipped=${summary.byStatus.shipped}`);
  process.exit(failed ? 1 : 0);
}

main();
