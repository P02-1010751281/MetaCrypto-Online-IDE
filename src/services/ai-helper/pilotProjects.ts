/**
 * A 线试点工程的运行时侧：把构建期制品 `pilot-projects/<standardId>.json` 读成一条
 * ProjectRecord，并在本机项目库里打开它。
 *
 * 三件事刻意分开，都是踩过的坑：
 * - **读制品**只做结构校验，不写任何东西：制品由 `scripts/build-verdicts-index.mjs`
 *   从 p4 复制生成，界面不重新拼装工作区（A 线不生成工作区，这条边界不能被「试点工程」破掉）。
 * - **认定「本机已有同一份」按 `metadata.aiHelper`（kind + standard.id）**，不按项目名：
 *   名字用户可以改，改名不该导致多导一份。
 * - **打开时不带 id**：本机主键由 IndexedDB 自增分配，`/editor/:id` 只认数字；
 *   制品里若残留 `p4-…` 这类字符串 id，这里直接拒绝，而不是落库后打开一个打不开的项目。
 */
import type { ProjectFileRecord, ProjectRecord, ProjectStore } from '@/services/projects/ProjectStore';
import { projectStore } from '@/services/projects/index';

/** 制品里每个文件的统计：`roots` 是画布上互不相连的根块，`blocks` 含 next/inputs 的全部积木。 */
export interface PilotProjectFileSummary {
  fileId: string;
  name: string;
  roots: number;
  blocks: number;
  entry: boolean;
}

export interface PilotProjectSummary {
  artifact: string;
  standardId: string;
  name: string;
  language: string;
  entryFileId: string;
  files: PilotProjectFileSummary[];
  blocks: number;
  clauseIds: string[];
  bytes: number;
  sha256: string;
  source: { path: string; sha256: string; bytes: number };
}

export type OpenPilotOutcome =
  | { status: 'opened'; id: number; replaced: boolean }
  | { status: 'needs-replace-confirm'; existingId: number };

const PILOT_DIR = './pilot-projects/';
const AI_HELPER_KIND = 'standards-to-project';
const AI_HELPER_META = 'aiHelper';

/** Vite 把每份制品切成独立 chunk；这里只登记「有哪几份」，读入发生在点击之后。 */
const rawPilots = import.meta.glob('./pilot-projects/*.json', {
  query: '?raw',
  import: 'default',
});

/** 构建期登记的制品文件名（`verify` 用：面板里的标准若没有制品，打开按钮就不该出现）。 */
export function pilotArtifactNames(): string[] {
  return Object.keys(rawPilots)
    .map((path) => path.slice(PILOT_DIR.length))
    .sort();
}

/**
 * 把一份制品的原文解析成可落库的记录。
 *
 * 校验放在读取处而不是构建处：构建处已经校验过一遍，但制品可能被手改或旧版残留，
 * 打开前再确认一次成本极低，失败时给的是「哪一份文件坏了」而不是一条 IndexedDB 写入异常。
 */
export function parsePilotRecord(
  raw: string,
  summary: Pick<PilotProjectSummary, 'standardId' | 'artifact'>,
  now: Date = new Date(),
): ProjectRecord<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${summary.artifact} 不是合法 JSON：${(error as Error).message}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${summary.artifact} 的顶层不是对象`);
  }
  const record = parsed as Partial<ProjectRecord<string>>;

  // 字符串 id 会让 /editor/:id 打开失败（Number('p4-…') 为 NaN），必须在落库前拒掉。
  if (record.id !== undefined) {
    throw new Error(`${summary.artifact} 带着制品 id=${String(record.id)}；打开时应由本机分配`);
  }
  if (!record.name || !record.language) {
    throw new Error(`${summary.artifact} 缺 name/language`);
  }
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw new Error(`${summary.artifact} 的 files 为空`);
  }
  for (const file of record.files as ProjectFileRecord[]) {
    if (!file.fileId || !file.name || typeof file.workspace !== 'string') {
      throw new Error(`${summary.artifact} 的文件缺 fileId/name/workspace：${file.name ?? '(未命名)'}`);
    }
    try {
      const payload = JSON.parse(file.workspace) as { blocks?: { blocks?: unknown[] } };
      if (!Array.isArray(payload?.blocks?.blocks)) {
        throw new Error('没有 blocks.blocks');
      }
    } catch (error) {
      throw new Error(`${summary.artifact}/${file.name} 的工作区不可解析：${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  if (!record.entryFileId || !record.files.some((file) => file.fileId === record.entryFileId)) {
    throw new Error(`${summary.artifact} 的 entryFileId 不在 files 里`);
  }

  const meta = aiHelperMeta(record);
  if (meta?.kind !== AI_HELPER_KIND || meta?.standard?.id !== summary.standardId) {
    throw new Error(`${summary.artifact} 的来源标记不是 ${summary.standardId} 的试点工程`);
  }

  return {
    ...(record as ProjectRecord<number>),
    // createdAt 保留制品里的时间（出处证据）；updatedAt 是「本机这一份」的时间。
    updatedAt: now.toISOString(),
  };
}

function aiHelperMeta(record: {
  metadata?: Record<string, unknown>;
}): { kind?: string; standard?: { id?: string } } | undefined {
  const meta = record.metadata?.[AI_HELPER_META];
  return meta && typeof meta === 'object' ? (meta as { kind?: string; standard?: { id?: string } }) : undefined;
}

/** 一条本机记录是不是某份标准的试点工程（只看来源标记，不看名字）。 */
export function pilotStandardIdOf(record: { metadata?: Record<string, unknown> }): string | undefined {
  const meta = aiHelperMeta(record);
  return meta?.kind === AI_HELPER_KIND ? meta.standard?.id : undefined;
}

export function findExistingPilot(
  records: readonly { id?: number; metadata?: Record<string, unknown> }[],
  standardId: string,
): { id?: number } | undefined {
  return records.find((record) => pilotStandardIdOf(record) === standardId);
}

/** 读入制品；只有点击「打开试点工程」之后才发生，所以它是异步的。 */
export async function loadPilotRecord(
  summary: PilotProjectSummary,
  now: Date = new Date(),
): Promise<ProjectRecord<number>> {
  const load = rawPilots[`${PILOT_DIR}${summary.artifact}`];
  if (!load) {
    throw new Error(`试点工程制品未打包：${summary.artifact}（先跑 npm run verdicts:index）`);
  }
  const raw = await load();
  return parsePilotRecord(String(raw), summary, now);
}

/**
 * 在本机项目库里打开一份试点工程。
 *
 * 已有同一份且没给 `replace` 时**不写库**，只回报对方的 id，让界面问一句再决定：
 * 覆盖会丢掉用户在那份工程里的改动，不能由一次点击替用户决定。
 */
export async function openPilotProject(
  summary: PilotProjectSummary,
  options: { store?: ProjectStore<number>; replace?: boolean; now?: Date } = {},
): Promise<OpenPilotOutcome> {
  const store = options.store ?? projectStore;
  const existing = findExistingPilot(await store.list(), summary.standardId);
  const existingId = existing?.id === undefined ? undefined : Number(existing.id);

  if (existingId !== undefined && !options.replace) {
    return { status: 'needs-replace-confirm', existingId };
  }

  const record = await loadPilotRecord(summary, options.now);
  const target: ProjectRecord<number> =
    existingId !== undefined ? { ...record, id: existingId } : record;
  const id = Number(await store.save(target));
  return { status: 'opened', id, replaced: existingId !== undefined };
}
