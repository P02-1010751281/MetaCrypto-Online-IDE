#!/usr/bin/env node
/**
 * 记录 KeyExpansion 进 V1 前后的结构读数差（「先如实记录失败点」的可复跑证据）。
 *
 * 做法：把 git HEAD 里的 p3/lib/c-parse.mjs 取到 .tmp-build/b-keyexp/head/ 并按同一份样本
 * 解析一次，再与当前解析器对照。两份读数都写进 p3/out/keyexpansion-parser-gap.json。
 *
 * 这不是「旧解析器报错」的故事：它根本没抛错，而是把 `#if defined(AES256)` 的两个分支
 * 都当成活动代码读了进来（if=2、assignments=32、13 条预处理诊断），默认 Nk=4/Nr=10 的
 * 配置没有被求值。差异必须写清楚，否则「V1 通过」会被读成结构已经读对。
 *
 * 用法：node experiments/ai-helper-2026-11-14/p3/run-keyexpansion-precheck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const P3_DIR = import.meta.dirname;
const ROOT = path.resolve(P3_DIR, '../../..');
const OUT_DIR = path.join(P3_DIR, 'out');
const SAMPLES_DIR = path.join(P3_DIR, 'samples');
const TMP_DIR = path.join(ROOT, '.tmp-build/b-keyexp');
const SAMPLE = 'kokke-keyexpansion.c';
const HEAD_PARSER_REL = 'experiments/ai-helper-2026-11-14/p3/lib/c-parse.mjs';

const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

function summarise(parsed) {
  const byCode = {};
  for (const d of parsed.diagnostics) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    functions: parsed.functions.length,
    constructCounts: parsed.constructCounts,
    diagnosticCount: parsed.diagnostics.length,
    diagnosticByCode: byCode,
    preprocLineCount: parsed.preprocs.length,
    hasPreprocessorTable: 'preprocessor' in parsed,
    defines: parsed.preprocessor?.defines?.map((d) => `${d.name}=${d.value}`) ?? null,
    conditionals: parsed.preprocessor?.conditionals?.length ?? null,
  };
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const headDir = path.join(TMP_DIR, 'head');
  fs.mkdirSync(headDir, { recursive: true });
  const show = spawnSync('git', ['show', `HEAD:${HEAD_PARSER_REL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (show.status !== 0) throw new Error(`git show 失败（rc=${show.status}）：${(show.stderr || '').trim()}`);
  const headParserPath = path.join(headDir, 'c-parse-head.mjs');
  fs.writeFileSync(headParserPath, show.stdout);

  const samplePath = path.join(SAMPLES_DIR, SAMPLE);
  const sourceText = fs.readFileSync(samplePath, 'utf8');
  const lineCount = sourceText.split('\n').length - 1;

  const headMod = await import(pathToFileURL(headParserPath).href);
  const currentMod = await import(pathToFileURL(path.join(P3_DIR, 'lib/c-parse.mjs')).href);
  const before = summarise(headMod.parseC(sourceText));
  const after = summarise(currentMod.parseC(sourceText));

  const record = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    sample: SAMPLE,
    sampleLines: lineCount,
    preExtension: {
      parser: `git HEAD:${HEAD_PARSER_REL}`,
      ...before,
      v0LineRule: { maxLines: 40, lines: lineCount, wouldPass: lineCount <= 40 },
      whatWentWrong: [
        'V0：样本 134 行，旧规则硬上限 40 行（run-p3.mjs 的 linesOk = lines <= 40），V0 会直接 FAIL；本轮改成 manifest 显式 maxLines=140，不自动放宽。',
        'V1：没有条件编译求值，`#if defined(AES256)` 的分支被当成活动代码 → if=2、assignments=32，而默认配置应是 if=1、assignments=28。',
        'V1：宏表未登记 → Nk/Nr/Nb 三个 #define 只是 13 条预处理诊断里的三行，默认配置（Nk=4/Nr=10）没有可核对的取值。',
      ],
    },
    postExtension: {
      parser: 'working tree:experiments/ai-helper-2026-11-14/p3/lib/c-parse.mjs',
      ...after,
      whatChanged: [
        'preprocessConditionals()：按行求值 #if/#ifdef/#ifndef/#elif/#else/#endif，非活动分支留空行保行号；表达式只支持 defined/整数/宏名/! && || == !=。',
        '宏表随 V1 读数给出（对象式与函数式都登记），#define 不再记成 unsupported 诊断。',
        'AES-256 分支被裁掉后，V1 的 if=1、assignments=28 与默认构建一致；5 条 implicit-narrowing 仍保留为 semantic-drift，没有被当成通过。',
      ],
    },
    delta: {
      if: after.constructCounts.if - before.constructCounts.if,
      assignments: after.constructCounts.assignments - before.constructCounts.assignments,
      diagnosticCount: after.diagnosticCount - before.diagnosticCount,
      preprocLineCount: after.preprocLineCount - before.preprocLineCount,
    },
    verdict: {
      parseCrashBefore: false,
      note: '旧解析器不崩，但结构读数与默认构建不一致；因此不能把「旧 V1 通过」当成样本可接。',
    },
  };
  const outFile = path.join(OUT_DIR, 'keyexpansion-parser-gap.json');
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`V1 扩展前后（${SAMPLE}）：\n`);
  process.stdout.write(`  旧：if=${before.constructCounts.if} assignments=${before.constructCounts.assignments} diag=${before.diagnosticCount} preproc=${before.preprocLineCount}，V0 行数规则 ${lineCount}<=40: ${lineCount <= 40}\n`);
  process.stdout.write(`  新：if=${after.constructCounts.if} assignments=${after.constructCounts.assignments} diag=${after.diagnosticCount} preproc=${after.preprocLineCount}，宏表 ${after.defines?.length ?? 0} 条、条件 ${after.conditionals ?? 0} 条\n`);
  process.stdout.write(`JSON: ${rel(outFile)}\n`);
}

main();
