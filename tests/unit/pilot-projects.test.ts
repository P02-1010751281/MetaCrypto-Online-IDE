/**
 * A 线试点工程：构建期制品 → 本机项目记录 → 导航目标。
 *
 * 这里守的是五件「看起来能跑、实际会害人」的事：
 *   1. 索引里登记的每份 pilot 都必须真有制品，且能读成 ProjectRecord（glob 映射漏登记就红）；
 *   2. 制品里的字符串 id 必须被拒：`/editor/:id` 走 Number()，`p4-…` 会变成一个打不开的项目；
 *   3. 「本机已有同一份」按 metadata 判定而不是项目名——用户改名不该导致多导一份；
 *   4. 已有同一份时默认**不写库**，由用户选覆盖或打开现有（覆盖会丢改动）；
 *   5. 「覆盖」沿用原 id，不在项目列表里留下第二份同名工程。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findExistingPilot,
  loadPilotRecord,
  openPilotProject,
  parsePilotRecord,
  pilotArtifactNames,
  pilotStandardIdOf,
  type PilotProjectSummary,
} from '@/services/ai-helper/pilotProjects';
import type { ProjectRecord, ProjectStore } from '@/services/projects/ProjectStore';
import { loadVerdictsIndex } from '@/services/ai-helper/verdicts';

const ROOT = process.cwd();
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const NOW = new Date('2026-11-19T06:00:00.000Z');

const index = await loadVerdictsIndex();
const pilots = index.standards
  .map((standard) => standard.pilot)
  .filter((pilot): pilot is PilotProjectSummary => Boolean(pilot));

function createStore(initial: ProjectRecord<number>[] = []) {
  const records = initial.map((record) => ({ ...record }));
  let nextId = Math.max(0, ...records.map((record) => Number(record.id ?? 0))) + 1;
  const store: ProjectStore<number> = {
    list: async () => records.map((record) => ({ ...record })),
    get: async (id) => records.find((record) => Number(record.id) === Number(id)),
    save: async (record) => {
      const id = record.id === undefined ? nextId++ : Number(record.id);
      const next: ProjectRecord<number> = { ...record, id };
      const at = records.findIndex((item) => Number(item.id) === id);
      if (at >= 0) records[at] = next;
      else records.push(next);
      return id;
    },
    rename: async (id, name) => {
      const at = records.findIndex((item) => Number(item.id) === Number(id));
      if (at >= 0) records[at] = { ...records[at], name };
    },
    remove: async (id) => {
      const at = records.findIndex((item) => Number(item.id) === Number(id));
      if (at >= 0) records.splice(at, 1);
    },
  };
  return { store, records };
}

describe('试点工程：制品与索引', () => {
  it('三份切片各有一份 pilot，且制品都真的被打包', () => {
    expect(pilots).toHaveLength(3);
    expect(pilotArtifactNames()).toEqual(
      expect.arrayContaining(pilots.map((pilot) => pilot.artifact)),
    );
    for (const pilot of pilots) {
      expect(pilot.sha256, pilot.artifact).toMatch(/^[0-9a-f]{64}$/);
      expect(pilot.files.length, pilot.artifact).toBeGreaterThan(0);
      expect(pilot.blocks, pilot.artifact).toBeGreaterThan(0);
    }
  });

  it('制品的 sha256 与索引登记一致（改了制品要重跑 verdicts:index）', () => {
    for (const pilot of pilots) {
      const path = join(ROOT, 'src/services/ai-helper/pilot-projects', pilot.artifact);
      expect(sha256(readFileSync(path, 'utf8')), `${pilot.artifact} 已变化`).toBe(pilot.sha256);
    }
  });

  it('制品能读成 ProjectRecord：无字符串 id、入口文件在其中、每个工作区可解析', async () => {
    for (const pilot of pilots) {
      const record = await loadPilotRecord(pilot, NOW);
      expect(record.id, pilot.artifact).toBeUndefined();
      expect(record.name, pilot.artifact).toBeTruthy();
      expect(record.files?.length, pilot.artifact).toBe(pilot.files.length);
      expect(record.entryFileId, pilot.artifact).toBe(pilot.entryFileId);
      const entry = record.files?.find((file) => file.fileId === record.entryFileId);
      expect(entry, `${pilot.artifact} 的 entryFileId 没有对应文件`).toBeTruthy();
      for (const file of record.files ?? []) {
        const payload = JSON.parse(file.workspace) as { blocks?: { blocks?: unknown[] } };
        expect(Array.isArray(payload.blocks?.blocks), `${pilot.artifact}/${file.name}`).toBe(true);
      }
      // createdAt 是制品里的出处时间，updatedAt 是「本机这一份」的时间。
      expect(record.updatedAt, pilot.artifact).toBe(NOW.toISOString());
      expect(pilotStandardIdOf(record), pilot.artifact).toBe(pilot.standardId);
    }
  });

  it('否定对照：字符串 id、坏工作区、来源不符都要被拒', () => {
    const pilot = pilots[0];
    const base = JSON.parse(
      readFileSync(join(ROOT, 'src/services/ai-helper/pilot-projects', pilot.artifact), 'utf8'),
    ) as ProjectRecord<string>;
    const summary = { standardId: pilot.standardId, artifact: pilot.artifact };

    expect(() => parsePilotRecord(JSON.stringify({ ...base, id: 'p4-strings' }), summary, NOW)).toThrow(
      /id=p4-strings/,
    );

    const broken = {
      ...base,
      files: [{ fileId: 'file-main', name: 'main.block.json', workspace: '{}' }],
      entryFileId: 'file-main',
    };
    expect(() => parsePilotRecord(JSON.stringify(broken), summary, NOW)).toThrow(/blocks\.blocks/);

    const wrongSource = {
      ...base,
      metadata: { aiHelper: { kind: 'standards-to-project', standard: { id: 'some-other' } } },
    };
    expect(() => parsePilotRecord(JSON.stringify(wrongSource), summary, NOW)).toThrow(/来源标记/);
  });
});

describe('试点工程：在本机打开', () => {
  const pilot = pilots.find((item) => item.standardId === 'sp800-38c-ccm');
  if (!pilot) throw new Error('索引里没有 CCM 的试点工程');

  it('没有同名工程时写一条新记录，id 交给 store 分配', async () => {
    const { store, records } = createStore();
    const outcome = await openPilotProject(pilot, { store, now: NOW });
    expect(outcome).toEqual({ status: 'opened', id: 1, replaced: false });
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(1);
    expect(records[0].files).toHaveLength(pilot.files.length);
    expect(records[0].updatedAt).toBe(NOW.toISOString());
  });

  it('已有同一份时不写库，只回报现有 id（覆盖与否由用户定）', async () => {
    const existing: ProjectRecord<number> = {
      id: 7,
      name: '我改过的 CCM 工程',
      language: 'python',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      metadata: { aiHelper: { kind: 'standards-to-project', standard: { id: pilot.standardId } } },
    };
    const { store, records } = createStore([existing]);
    const outcome = await openPilotProject(pilot, { store, now: NOW });
    expect(outcome).toEqual({ status: 'needs-replace-confirm', existingId: 7 });
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('我改过的 CCM 工程');
  });

  it('覆盖沿用原 id，不留下第二份', async () => {
    const existing: ProjectRecord<number> = {
      id: 7,
      name: '旧名字',
      language: 'python',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      metadata: { aiHelper: { kind: 'standards-to-project', standard: { id: pilot.standardId } } },
    };
    const { store, records } = createStore([existing]);
    const outcome = await openPilotProject(pilot, { store, replace: true, now: NOW });
    expect(outcome).toEqual({ status: 'opened', id: 7, replaced: true });
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe(pilot.name);
  });

  it('同名但来路不是这份试点工程的项目不算「已有」', async () => {
    const lookalike: ProjectRecord<number> = {
      id: 3,
      name: pilot.name,
      language: 'python',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    const { store, records } = createStore([lookalike]);
    expect(findExistingPilot(records, pilot.standardId)).toBeUndefined();
    const outcome = await openPilotProject(pilot, { store, now: NOW });
    expect(outcome.status).toBe('opened');
    expect(records).toHaveLength(2);
  });
});
