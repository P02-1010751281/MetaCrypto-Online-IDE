A2-SEAT objects=6

# A2（证伪席）· 镜像保真 + lint 语义中立

- 镜像目标：`/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server`，HEAD `17b36ac6a04f83f6b7b458b2b5ea8f09fd92f35b`
- 唯一真源：`/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat`，HEAD `ef6e76f29c9a0e2ef6acf7803913612f1a74d365`
- 本席只读，未修改任一仓库文件（唯一写入为本报告）。未执行 build / install / lint / test。

## 覆盖声明

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 面 1 镜像保真 | **已核实** | 5 笔镜像提交逐笔对「同期 CipherCat 快照」做归一化逐字比对（296 个（commit, file）对，覆盖率 100%）；另做 HEAD 全镜像 389 对终态比对 |
| 面 2 hand-edit | **已核实** | HEAD 全镜像写入前缀 478 个文件全扫 + 非镜像目录逐文件比对 |
| 面 3 `31dad11` 语义中立 | **已核实** | 79/79 文件全量机械检验（token 计数、字符多重集、逐块字符级 diff），未抽样；另取 14 类代表 hunk 逐字引用 |
| 面 4 数字复算 | **已核实** | `git show --numstat` 全部重算；两处「对数」断言用脚本重建 `mirror_pairs()` 复现 |
| 面 5 覆盖缺口 | **已核实** | 逐条读 `scripts/sync-to-metacrypt.sh`（453 行）的写入段、`SYNC_WRITE_PREFIXES` 与 `mirror_pairs()`；镜像配对集合实测 389 对 |
| 「112 文件 / 978 用例全过」「vue-tsc 0 错 / eslint 0 问题」 | **未能核实** | 硬规则禁止 build / lint / 跑测试；只能核对这些数字所对应的源码事实，不能核对结果 |
| 运行时行为（生成的代码跑不跑得对） | **未能核实** | 同上，未执行任何程序 |

命令口径：下文 `META` = metacrypt_server 仓，`CIPHER` = CipherCat 仓；归一化函数 `norm()` 只折叠脚本自身允许的三类差异（见面 1「允许差异清单」）。

---

## 面 1 · 镜像保真（权威冲突）

**等级：观察（通过）** — 5 笔镜像提交对同期真源的保真度是 **296 对里 292 对归一化后逐字相同**，4 处不可匹配项全部可归因：2 处是已登记且已收敛的产品化文件名替换、1 处是源侧已删除文件（脚本按设计清理）、1 处是非镜像目标的手工分叉。**未发现任何逻辑漂移、缺函数、变量名不同。**

### 1.1 方法：先定「同期快照」，再逐字比

镜像取的是 CipherCat **工作树**，不是某个 tag，所以必须比同期快照而非 HEAD。按提交时间戳定位：

| 镜像提交 | 时间 | 同期 CipherCat 快照 | 依据 |
| --- | --- | --- | --- |
| `3931f73` | 11-15 18:22 | `6dc4b32` | `git log --until=2026-11-15T18:22` 最后一个 |
| `d7f7efd` | 11-15 18:23 | `6dc4b32` | 同上 |
| `c83188f` | 11-15 19:55 | `8b5b46f` | 19:54 提交 |
| `43b4e7c` | 11-16 21:01 | `b4b4202` | 21:01 提交 |
| `cfd2d13` | 11-18 08:21 | `a25c11f` | 08:21 提交 |

路径映射（与脚本 `mirror_pairs()` 一致）：`core/blocks/X`↔`src/blocks/X`；`core/generators/{python,javascript}/X`↔`src/generators/{python,javascript}/X`（`bitwise/`↔`bit/`、`post-quantum/`↔`postquantum/`）；`core/generators/X.ts`↔`src/generators/X.ts`；`core/constants/X`↔`src/constants/X`；`core/utils/locale/X`↔`src/composables/locale/X`；`core/utils/migration/X`↔`src/utils/migration/X`；`components/CryptoFunctionPanel.vue`↔`src/components/CryptoFunctionPanel.vue`；`services/projects/ProjectStore.ts`↔`src/services/projects/ProjectStore.ts`；`runtime/**`↔`src/runtime/**`。

### 1.2 逐笔结果

```
$ for pair in "3931f73 6dc4b32" "d7f7efd 6dc4b32" "c83188f 8b5b46f" "43b4e7c b4b4202" "cfd2d13 a25c11f"; do set -- $pair; ./snap.sh $1 $2; done
## 3931f73 vs 6dc4b32: pairs=152 identical=150 diff=2
## d7f7efd vs 6dc4b32: pairs=5 identical=5 diff=0
## c83188f vs 8b5b46f: pairs=23 identical=22 diff=0   (+1 ABSENT：源侧已拆目录)
## 43b4e7c vs b4b4202: pairs=85 identical=84 diff=1
## cfd2d13 vs a25c11f: pairs=31 identical=31 diff=0
```

两处 diff 逐字展开：

**(a) `CryptoFunctionPanel.vue` 的产品化文件名替换（`3931f73` + `43b4e7c` 各 1 处，已收敛）**

```
$ diff -u <(git -C $CIPHER show b4b4202:src/components/CryptoFunctionPanel.vue) \
          <(git -C $META   show 43b4e7c:frontend/src/features/blockly/components/CryptoFunctionPanel.vue)
@@ -303,7 +303,7 @@
     await new Promise((r) => setTimeout(r, 0));
   }
   if (!states.length) return;
-  download(JSON.stringify({ blocks: { languageVersion: 0, blocks: states } }, null, 2), 'ciphercat_templates.json');
+  download(JSON.stringify({ blocks: { languageVersion: 0, blocks: states } }, null, 2), 'function_templates.json');
```

判读：这是**导出文件名**差异（用户下载得到的文件叫 `ciphercat_templates.json` 还是 `function_templates.json`），属可见行为差异。它在 `43b4e7c` 正文里已被点名（「唯一差异是 sync-to-metacrypt.sh 第 323 行做的产品化替换」）。**当前已收敛**：CipherCat `b50fe0a`（11-17 品牌清扫）把自己也改成 `function_templates.json`，脚本第 323 行现在是注释而非 sed：

```
$ grep -n "templates.json" $CIPHER/scripts/sync-to-metacrypt.sh
323:# 导出文件名两侧已统一为 function_templates.json（2026-11-17），此处不再需要 sed 改名。

$ git -C $CIPHER show HEAD:src/components/CryptoFunctionPanel.vue | sed -n '306p'
  download(JSON.stringify({ blocks: { languageVersion: 0, blocks: states } }, null, 2), 'function_templates.json');
$ git -C $META   show HEAD:frontend/src/features/blockly/components/CryptoFunctionPanel.vue | sed -n '306p'
  download(JSON.stringify({ blocks: { languageVersion: 0, blocks: states } }, null, 2), 'function_templates.json');
```

**(b) `components/BlocklyEditor.vue`（`3931f73` 计入 1 处；非镜像目标，属面 2 问题）**

此文件**不在** `mirror_pairs()` 里（脚本只镜像 `CryptoFunctionPanel.vue`），是手工维护的分叉，故不构成「镜像漂移」，归入面 2。

### 1.3 允许的差异清单（实测只有三类）

1. **相对目录改写**（脚本 `fix_imports`，第 34–42 行）：`'./bit'`→`'./bitwise'`、`'./postquantum'`→`'./post-quantum'` 等。HEAD 全镜像 389 对里**只有这 10 对**因此不同：

```
$ ./fullpairs.sh HEAD HEAD
pairs=389
raw-identical=379 raw-diff=10 absent=0
--- diff list ---
src/generators/python/index.ts
src/generators/python/numtheory/{mat-vec-mul,ntt,poly-add,poly-sub}.ts
src/generators/javascript/index.ts
src/generators/javascript/numtheory/{mat-vec-mul,ntt,poly-add,poly-sub}.ts
```

逐字（两类形态，各自归一化后 diff=0）：

```
$ git -C $META   show HEAD:frontend/src/features/blockly/core/generators/python/index.ts | sed -n '1,6p'
import './ctrl';
import './data';
import './array';
import './bitwise';
import './logic';
import './sbox';
$ git -C $CIPHER show HEAD:src/generators/python/index.ts | sed -n '1,6p'
import './ctrl';
import './data';
import './array';
import './bit';
import './logic';
import './sbox';

$ diff <(git -C $CIPHER show HEAD:src/generators/python/numtheory/ntt.ts) \
       <(git -C $META   show HEAD:frontend/src/features/blockly/core/generators/python/numtheory/ntt.ts)
7c7
< } from '../postquantum/helpers';
---
> } from '../post-quantum/helpers';
```

2. **应用级别名改写（历史态，HEAD 已归零）**：2026-11-16 20:37 `3ee4c5a` 之前，镜像把 `@/x` 改写成 `@/features/blockly/core/x`；之后核内统一走 `@cc/*`，脚本不再改写。这正是 `3931f73` 有 85 处 raw-diff 而归一化后 0 处的原因，形如：

```
$ diff -u <(git -C $CIPHER show 6dc4b32:src/blocks/argon2/blocks.ts) \
          <(git -C $META show 3931f73:frontend/src/features/blockly/core/blocks/argon2/blocks.ts)
-import { TYPE_BYTES, TYPE_NUMBER } from '@/constants/block-types';
+import { TYPE_BYTES, TYPE_NUMBER } from '@/features/blockly/core/constants/block-types';
```
HEAD 侧：`BARE_ALIAS=$(grep -rnE "from '@/" …)` 断言仍生效，实测 389 对里 0 处应用级别名。

3. 见 1.2(a) 的产品化文件名（已收敛）。

### 1.4 关键文件抽检（每笔 5–6 个，归一化 diff 行数）

```
=== 3931f73 (snap 6dc4b32) ===
  diff_lines=0  core/utils/migration/xml-migrate.ts  <->  src/utils/migration/xml-migrate.ts
  diff_lines=0  core/utils/locale/ui.ts              <->  src/composables/locale/ui.ts
  diff_lines=0  core/blocks/data/int-list.ts         <->  src/blocks/data/int-list.ts
  diff_lines=0  core/constants/grid-shape.ts         <->  src/constants/grid-shape.ts
  diff_lines=0  core/generators/python/numtheory/ntt.ts <-> src/generators/python/numtheory/ntt.ts
  diff_lines=0  core/generators/javascript/bitwise/rotate.ts <-> src/generators/javascript/bit/rotate.ts
=== d7f7efd (snap 6dc4b32) ===
  diff_lines=0  runtime/run-code.ts / python-runner.worker.ts / js-runner.worker.ts
  diff_lines=0  runtime/contracts/run-chain.ts / services/projects/ProjectStore.ts
=== c83188f (snap 8b5b46f) ===
  diff_lines=0  blocks/procedure/blocks/{index,template-blocks,mutator-blocks}.ts
  diff_lines=0  generators/python/sm9/sm9-pairing.ts / python/sm9/blocks.ts
  diff_lines=0  generators/javascript/mldsa/mldsa-core-b.ts
=== 43b4e7c (snap b4b4202) ===
  diff_lines=0  blocks/array/slice.ts / blocks/hash/fors.ts
  diff_lines=0  core/utils/locale/ui.ts / runtime/run-code.ts / generators/python/index.ts
=== cfd2d13 (snap a25c11f) ===
  diff_lines=0  blocks/array/append.ts / blocks/ctrl/range.ts
  diff_lines=0  generators/javascript/ctrl/loop-bound.ts / generators/procedure-params.ts
  diff_lines=0  runtime/python-parse.ts / core/utils/migration/xml-migrate.ts
```

被删文件的说明：`3931f73`/`c83188f` 里 `core/blocks/procedure/blocks.ts` 呈「源侧已不存在」（CipherCat `1bcf034` 拆成 `procedure/blocks/` 目录），脚本第 1 段的删除分支按设计清掉，`commits` 里也是纯 deletion，不是漏镜像。

---

## 面 2 · hand-edit 检测（「真源没有、只在这里有」）

**等级：缺陷（3 条）** — 3 处是「真源无、仅镜像区有」的实质分叉；其中 1 处落在脚本写入前缀内，1 处是整文件手工分叉，1 族 33 个文件对同步完全隐形。逐条给文件与行。

### 2.1 【缺陷】`core/constants/code-languages.ts:5,14` — 写入前缀内长出的 MCL 语言（sync 语义下会被覆盖的一类）

```
$ git -C $META show HEAD:frontend/src/features/blockly/core/constants/code-languages.ts | grep -n "MCL\|KASM51"
4:  // KASM51: 'kasm51',
5:  MCL: 'mcl',
13:  // [CODE_LANGUAGES.KASM51]: 'Kasm51',
14:  [CODE_LANGUAGES.MCL]: 'MCL',
```

CipherCat 侧同文件只有 `JAVASCRIPT` / `PYTHON`（`git -C $CIPHER show HEAD:src/constants/code-languages.ts`，最后一次改动是 `0ce1145 2026-05-30 initial`）。

影响链：该文件位于 `SYNC_WRITE_PREFIXES` 的 `$CORE/constants` 之下（脚本第 138 行），但脚本第 3 段只 `cp` 四个具名文件（`block-types.ts`、`sbox-presets.ts`、`grid-shape.ts`、`list-bridge.ts`，第 314–321 行），既不复制也不删除 `code-languages.ts`。所以**今天不会被静默覆盖**，但它恰好是「mirror 区里长出来的语义增量」这一类，只靠脚本 0b 段的「shared 但未镜像」报告兜底：

```
$ sed -n '191,232p' $CIPHER/scripts/sync-to-metacrypt.sh
while IFS= read -r rel; do
  case "$rel" in
    components/*) dst="$META/frontend/src/features/blockly/$rel" ;;
    *) dst="$CORE/$rel" ;;
  ...
done <<< "$( { ( cd "$CORE" && find utils services constants -name "*.ts" 2>/dev/null )
```

判据：0b 段只扫 `$CORE/{utils,services,constants}` 与 `features/blockly/components/*.vue`。`code-languages.ts` 在 `constants` 内 → 会被报告（减轻），但报告只是「差异」提示，不阻止同步。

**修完要达到的结果**：要么把 MCL 语言表上移到非镜像层（如 `features/blockly/algorithms/`）由镜像文件转发，要么在 CipherCat 权威源补同名条目使镜像成为超集。验收：`git -C $CIPHER show HEAD:src/constants/code-languages.ts | grep -c MCL` 返回 ≥1，或该文件从 `$CORE/constants` 移出。

### 2.2 【缺陷】`components/BlocklyEditor.vue` — 整文件手工分叉，且落在 `SYNC_TARGETS` 里但不被 `mirror_pairs()`

真源与镜像的 props 契约已经不同：

```
$ git -C $META   show HEAD:frontend/src/features/blockly/components/BlocklyEditor.vue | sed -n '11p'
const props = defineProps<{ initialWorkspace?: string; readonly?: boolean }>()
$ git -C $CIPHER show HEAD:src/components/BlocklyEditor.vue | sed -n '14p'
const props = defineProps<{ readOnly?: boolean }>();
```

`3931f73` 正文已经承认这是手工改动：「`BlocklyEditor.vue` 改用 `uiLocaleRef`（原 `blocklyLocaleRef` 随旧实现一起删除）。该文件还带一段此前的「切语言后重建积木与工具箱」改动，随本批一并落盘」。

风险不对称：`$COMPONENTS` 同时在 `SYNC_WRITE_PREFIXES`（第 138 行）与 `SYNC_TARGETS`（第 137 行），于是
- 脏检查会把它当同步目标 → 任何未提交编辑都会**误报**「继续同步会覆盖」；
- 实际写入段只覆盖 `CryptoFunctionPanel.vue` → 真源对 `BlocklyEditor.vue` 的修复**永远收不到**，且只在 0b 的 `find components -maxdepth 1 -name "*.vue"` 里被列成「大差异 >20 行」。

**修完要达到的结果**：`BlocklyEditor.vue` 要么进镜像集合（并接受真源 props 契约），要么移出 `$COMPONENTS` 到明确的 metacrypt 专属目录，使 `SYNC_TARGETS` 的脏检查粒度与实际写入粒度一致。验收：`grep -n "BlocklyEditor" scripts/sync-to-metacrypt.sh` 有明确归属（镜像或显式排除），且 `SYNC_TARGETS` 不再包含只写 1 个文件的目录。

### 2.3 【缺陷】`views/`、`plugins/`、`composables/`、`algorithms/`、`utils/` — 33 个文件对同步完全隐形

`43b4e7c` 的 118 个文件里，**33 个**落在任何写入前缀之外（实测），且不在 0b 的扫描范围内：

```
$ git -C $META show --numstat --format="" 43b4e7c | awk '{print $3}' | grep '^frontend/src/features/blockly/' \
  | grep -vE 'core/(blocks|generators|constants|utils/(locale|migration))|components|services/projects|runtime' | wc -l
33
```

目录级证明：这些目录与真源**根本没有对应关系**，是两份各自演化的编辑器壳：

```
=== META views/editor vs CIPHER src/components/editor ===
ONLY-META   EditorProjectOverview.vue, SidebarToggleButton.vue, EditorStatusBar.css,
            editor-panel-chrome.css, editor-shell.css, editor-sidebar-files.css,
            editor-sidebar-shell.css, editor-workbench.css, editorProjectPresentation.ts,
            useEditorCodeRunner.ts, useEditorLifecycle.ts, useEditorProjectActions.ts, useEditorUiHost.ts
DIFF        EditorSidebar.vue      (meta 363 行 / cipher 217 行)
DIFF        EditorStatusBar.vue     (meta  64 行 / cipher  61 行)
ONLY-CIPHER CodePanel.vue, EditorBreadcrumb.vue, EditorHeaderActions.vue, EditorSidePanels.vue,
            EditorToast.vue, EditorToolbar.vue, LocaleToggleButton.vue, ProjectPanel.vue,
            RunOutputPanel.vue, WorkspaceMenu.vue, editor-handles.ts, editor-sidebar.css,
            editor-toolbar-button.css, useCodeToWorkspaceImport.ts, useEditorFileActions.ts,
            useEditorPanels.ts, useEditorSplit.ts, useEditorWorkspaceActions.ts,
            useProjectList.ts, useWorkspaceStats.ts
```

当前规模（`git -C $META ls-tree -r --name-only HEAD -- frontend/src/features/blockly/<d> | wc -l`）：`views` 16（含 `views/editor` 15）、`plugins` 16（含 `ui/builtin` 13）、`composables` 7、`algorithms`（含 `builtin` 5）7、`utils` 1、`session` 2、`api` 6，合计 55 个文件。

**修完要达到的结果**：脚本 0b 段的扫描域必须与「手工维护目录清单」一致——把 `views`、`plugins`、`composables`、`algorithms`、`utils`、`core/utils`（除 locale/migration）纳入报告，或在脚本头部写死一份 `HAND_MAINTAINED_DIRS` 并打印其文件数。验收：`bash scripts/sync-to-metacrypt.sh --dry-run`（或阅读 0b 段）能在输出里看到 `views/editor/useEditorUiHost.ts` 这类路径的差异行数。

### 2.4 【观察】`core/constants/workspace-config.ts` — 只差格式的陈旧副本

```
$ diff -u <(git -C $CIPHER show HEAD:src/constants/workspace-config.ts) \
          <(git -C $META   show HEAD:frontend/src/features/blockly/core/constants/workspace-config.ts) | tail -6
   trashcan: true,
-};
+}
```

真源最后一次改动是 `1f11855 2026-08-04`，镜像侧始终没有回灌（缺尾分号 + 文件末尾换行差异）。纯格式，无行为影响；与 `manual-check 2.1` 同类（镜像区自长），但无 MCL 这类语义增量。

### 2.5 【观察】清理干净的部分（避免误报）

HEAD 写入前缀内 478 个文件全扫，82 个「真源没有」的文件全部属于脚本明确声明的 metacrypt 专属族，且**都不在任何删除循环的射程内**：

```
$ ./head_sweep.sh   # 478 个文件
     82 ABSENT-IN-CIPHER      # core/generators/mcl/**（77）、components/{CodePreview,CodeViewer,CommandPalette,RawCodeEditor}.vue（4）、core/constants/mcl-highlight.ts（1）
      3 DIFF                  # components/BlocklyEditor.vue、core/constants/{code-languages,workspace-config}.ts
    391 MATCH
      2 UNMAPPED              # services/projects/{httpProjectStore,index}.ts（脚本注释声明为 metacrypt 独占）
```

删除循环射程核对：`core/generators/mcl/**` 在 `$CORE/generators` 下，但删除循环只遍历 `generators/{python,javascript}`（第 289–295 行），不受影响；`core/blocks/**` 的删除循环会递归扫全目录，而实测该目录下**没有任何**真源缺失的 `.ts`，故无删除风险。`httpProjectStore.ts` / `index.ts` 在 `$PROJECT_PORT` 下，第 3.6 段只 `cp` `ProjectStore.ts`、无删除分支，安全。

---

## 面 3 · `31dad11` lint 自动修复的语义中立性

**等级：缺陷（2 处语义变化 + 1 类源级改名）** — 结论是「**含 3 处非纯格式改动**」，不是纯格式。但必须先说清一件事：

**`31dad11` 与镜像零交集。** 79 个文件里 `frontend/src/features/blockly` 命中 **0** 次：

```
$ git -C $META show --numstat --format="" 31dad11 | awk '{print $3}' | grep -c 'features/blockly'
0
$ git -C $META show --numstat --format="" 31dad11 | awk '{n=split($3,a,"."); print a[n]}' | sort | uniq -c
     77 vue
      2 ts
```

全部落在 RuoYi 脚手架（`views/system/**`、`views/monitor/**`、`views/tool/**`、`components/Crontab/**`、`layout/**`）。所以它的语义风险**不进入镜像链路**，只影响 metacrypt 自己的后台界面。

### 3.1 机械判据（79/79 全覆盖，未抽样）

```
$ ./tokcount.sh 31dad11   # 逐文件统计风险 token 前后出现次数
file  EQ2  EQ3  NE2  NE3  VAR  LET  CONST  OPTCHAIN  NULLISH
（无任何 FLAG 行）
```

即 79 个文件里 `==`、`===`、`!=`、`!==`、`var`、`let`、`const`、`?.`、`??` 的出现次数**逐个文件前后完全不变**——`==`→`===`、`var`→`let/const`、加可选链、删未用导入这几类风险在本提交里**零发生**。

字符多重集检验：45/79 文件「去空白后字符多重集完全相同」（纯重排）。其余 34 个的逐字符增量集中在四类，全部可解释：

```
  132  -  "'"
  130  +  '"'          ← 引号风格 ' → "
   58  +  '-'          ← 组件/类名 kebab 化插入连字符
   18  -  'T' / 24 +  't'   ← 同上（大写转小写）
    6  +  '&' 6 + ';' 6 +  'q' 6 + 'u' 6 +  'o'   ← &quot; 实体转义（6 处）
    2  +  '#'  2 - ':'   ← v-slot:xxx → #xxx
```

### 3.2 三处非纯格式改动（逐字）

**（1）`frontend/src/main.ts:74` — 全局组件注册名改变**

```
$ git -C $META show 31dad11 -- frontend/src/main.ts | sed -n '/^@@/,$p'
@@ -71,7 +71,7 @@ app.use(router)
 app.use(store)
 app.use(plugins)
 app.use(elementIcons)
-app.component('svg-icon', SvgIcon)
+app.component('SvgIcon', SvgIcon)
```

这不是格式。注册键从 `'svg-icon'` 变成 `'SvgIcon'`。实测没有降级：
- 40+ 处模板仍在写 `<svg-icon …>`（`git -C $META grep -c "<svg-icon" 31dad11 -- frontend/src` 命中 13 个文件）；
- Vue 3 `resolveAsset` 对组件名做 `camelize` + `capitalize` 回退，`<svg-icon>` → `SvgIcon` 仍能解析；
- 全仓无 `app.component('svg-icon')` 读取式调用（`git grep` 只有注册这一行）。

仍是「源级名字变了、只靠框架回退兜住」的改动，应登记而非按格式放过。触发规则：`vue/component-definition-name-casing`。

**（2）`frontend/src/views/system/menu/index.vue:240` — 非法属性值被转义，渲染结果变化**

```
$ git -C $META show 31dad11:frontend/src/views/system/menu/index.vue | sed -n '240p'
                  <el-tooltip content="访问路由的默认传递参数，如：`{&quot;id&quot;: 1, &quot;name&quot;: &quot;ry&quot;}`" placement="top">

$ git -C $META show 31dad11^:frontend/src/views/system/menu/index.vue | sed -n '234p'
                           <el-tooltip content='访问路由的默认传递参数，如：`{"id": 1, "name": "ry"}`' placement="top">
```

原文用单引号包属性、值里含裸 `"`——HTML 合法，但 Vue 模板的 `vue/html-quotes` 修正把它改成双引号后，内层 `"` 必须写成 `&quot;`（6 处）。**这是行为变化**：若只换成双引号而不转义，属性会被提前截断，tooltip 变成半句；转义后渲染仍是完整的 `{"id": 1, "name": "ry"}`。属修正，但性质是「改渲染输入」而非「改排版」。

**（3）25 处 `v-on` 事件名 camelCase → kebab-case**

```
$ git -C $META show 31dad11 | grep -E '^-' | grep -oE '@[a-z]+[A-Z][A-Za-z]*' | sort | uniq -c | sort -rn
     15 @queryTable
      2 @deleteItem
      2 @copyItem
      2 @activeItem
      1 @toggleClick
      1 @textChange
      1 @setLayout
      1 @realTime
```

逐字代表：

```
-         <right-toolbar v-model:showSearch="showSearch" @queryTable="getList"></right-toolbar>
+      <right-toolbar v-model:show-search="showSearch" @query-table="getList"></right-toolbar>

-            @activeItem="activeItem(scoped.element)"
-            @copyItem="copyItem(scoped.element, element.children)"
-            @deleteItem="deleteItem(scoped.index, element.children)" />
+            @active-item="activeItem(scoped.element)"
+            @copy-item="copyItem(scoped.element, element.children)"
+            @delete-item="deleteItem(scoped.index, element.children)"
```

判定为**等价但非格式**：Vue 3 编译器对 `v-on` 的静态参数做 `camelize` 再拼 `on` + 首字母大写，`@query-table` 与 `@queryTable` 都产出 `onQueryTable`。子组件侧确认仍是 camelCase emit：

```
$ git -C $META show 31dad11:frontend/src/components/RightToolbar/index.vue | grep -n "defineEmits"
65:const emits = defineEmits(['update:showSearch', 'queryTable'])
$ git -C $META show 31dad11:frontend/src/layout/components/Navbar.vue | grep -n "defineEmits"
118:const emits = defineEmits(['setLayout'])
```

且 25 处全部挂在自定义组件（`right-toolbar`、`scroll-pane`、`navbar`、`hamburger`、`user-avatar`、`draggable-item`）上，没有落在原生 DOM 元素上（原生元素上 kebab 事件名不会派发，那才是真 break）。

### 3.3 其余为纯格式（逐类取证）

| 类别 | 逐字证据 | 规模 |
| --- | --- | --- |
| 缩进 3 空格 → 2 空格、整文件重排 | `git show 31dad11 -- frontend/src/views/system/user/index.vue` 全文件单 hunk（`@@ -1,450 +1,450 @@`），字符多重集相同 | 45/79 文件 |
| 引号风格 `'` → `"` | `-<el-radio v-model='radioValue' :value="1">` → `+<el-radio v-model="radioValue" :value="1">` | 132 处 |
| 长标签 prettier 折行 | `IconsDialog.vue`：`<el-dialog v-model="value" width="980px" …` 断成多行 + 闭合 `>` 独立成行；字符多重集相同 | 4 文件（含 `TreeNodeDialog.vue`） |
| 属性顺序 `v-if`/`v-else` 提前 | `DraggableItem.vue`：`<el-form-item :label=… :required=… v-if=…>` → `<el-form-item v-if=… :label=… :required=…>` | 全仓 |
| 组件标签 kebab 化 | `userAvatar.vue`：`<vue-cropper`（保留）、`<el-upload`；大写组件名转 kebab（`'I'`-3/`'i'`+3/`'-'`+3） | 8 文件 |
| `v-slot:header` → `#header` | `profile/index.vue`：`-<template v-slot:header>` / `+<template #header>` | 2 处 |
| 空行删除 | `TreeNodeDialog.vue`：`</el-select>` 与 `</el-input>` 之间的空行被删 | 若干 |

### 3.4 唯一需要担心的连带项（已排除）

任务点名的「删未使用导入是否连带删掉有副作用的调用」：本提交**没有删任何 import 语句**——`import`/`from` 计数在 79 个文件里前后相等；唯一的「净删除」文件是 `IconsDialog.vue`（8/4）、`TreeNodeDialog.vue`（8/5）、`RightPanel.vue`（73/40）、`DraggableItem.vue`（16/10），逐个查看均为折行/空行/属性重排所致，无语句消失（`DraggableItem.vue` 那 6 行净减全部来自 `<el-form-item …>`、`<draggable …>`、`<draggable-item …>` 三处折行差异）。

---

## 面 4 · 数字复算（正文值 vs 实测值并列）

**等级：缺陷（1 处口径错误）＋ 2 处未能核实**

### 4.1 逐提交文件数 / 行数

```
$ for c in 43b4e7c c83188f 3931f73 d7f7efd cfd2d13 31dad11; do
    printf "%s " $c; git -C $META show --numstat --format="" $c | awk '{a+=$1;d+=$2;n++} END{printf "files=%d adds=%d dels=%d\n",n,a,d}'; done
3931f73 files=155 adds=4774 dels=3029
d7f7efd files=7   adds=836  dels=0
c83188f files=23  adds=3579 dels=3464
43b4e7c files=118 adds=4511 dels=3156
cfd2d13 files=32  adds=635  dels=39
31dad11 files=79  adds=13168 dels=12984
```

| 提交 | 任务书/正文所给 | 实测 | 判定 |
| --- | --- | --- | --- |
| `43b4e7c` | 「118 文件」（`git show --stat` 尾行同）/ 正文未给行数 | 118 文件 / +4511 / −3156 | **一致** |
| `3931f73` | 「155 文件」 | 155 文件 / +4774 / −3029 | **一致** |
| `31dad11` | 「13,168 增 / 12,984 删、79 文件」 | 79 文件 / +13168 / −12984 | **一致** |
| `c83188f` | 正文未给 | 23 文件 / +3579 / −3464 | 无断言 |
| `d7f7efd` | 正文称「四个目录此前从未入库」 | 7 文件 / +836 / −0 | **一致**（`runtime/` 3 + `runtime/contracts/` 1 + `services/projects/` 3） |
| `cfd2d13` | 正文未给文件数 | 32 文件 / +635 / −39 | 无断言 |

### 4.2 「比对对数」断言复算（本席重建 `mirror_pairs()` 逐对 md5）

**`43b4e7c` 正文**：「镜像内容与 CipherCat 当前工作树逐文件比对：380 对里 379 对逐字节相同，唯一差异是 … 产品化替换，0 个文件缺失。」

```
$ ./fullpairs.sh 43b4e7c b4b4202
pairs=380                      ← 与正文「380 对」一致
raw-identical=369 raw-diff=11 absent=0
```

- 「380 对」：**复现成功**（脚本化重建配对集合 = 380）。
- 「0 个文件缺失」：**复现成功**（`absent=0`）。
- 「379 对逐字节相同」：**只在「折叠允许改写」口径下成立**。原始字节是 369/11；11 = 10 个 `bit`/`postquantum` 相对导入改写 + 1 个 `CryptoFunctionPanel.vue`。折叠后 379/1，与正文一致。口径需写明，数字本身可接受。

**`cfd2d13` 正文**：「与 CipherCat 源 389 对逐字节比对 362 一致、0 不符，其余 27 对是 bit/postquantum 目录改名的预期差异。」

```
$ ./fullpairs.sh cfd2d13 a25c11f
pairs=389                      ← 与正文「389 对」一致
raw-identical=379 raw-diff=10 absent=0
```

- 「389 对」：**复现成功**。
- 「0 不符」：**成立**（10 处差异全部为允许的相对目录改写，归一化后 diff=0）。
- **「362 一致 / 27 差异」：复算不成立（口径错误）。** 实测 379 / 10。

「27」的来源可追：CipherCat `a25c11f` 树里位于被改名目录下的 `.ts` 恰好 27 个——

```
$ git -C $CIPHER ls-tree -r --name-only a25c11f -- \
    src/generators/python/bit src/generators/python/postquantum \
    src/generators/javascript/bit src/generators/javascript/postquantum | wc -l
27
```

但这 27 个**文件本身**里 17 个逐字节相同（不含任何需要改写的相对导入：逐文件 `grep -cE "\./(bit|postquantum)['/]"` 全为 0）；真正含被改写导入的 10 个文件**不在**这 27 个里，而是引用者（`generators/{python,javascript}/index.ts` 与 `numtheory/{mat-vec-mul,ntt,poly-add,poly-sub}.ts`）。所以「362 一致 + 27 差异」既低估了一致数，又把差异归错了对象。

**修完要达到的结果**：`cfd2d13` 的数字应记为「389 对：379 对逐字节相同，10 对仅差 `bit`↔`bitwise`、`postquantum`↔`post-quantum` 相对导入改写，0 对不一致、0 缺失」。验收：`./fullpairs.sh cfd2d13 a25c11f` 输出 `raw-identical=379 raw-diff=10 absent=0`。

### 4.3 当前终态（HEAD ↔ HEAD）

```
$ ./fullpairs.sh HEAD HEAD
pairs=389
raw-identical=379 raw-diff=10 absent=0
```

即 5 笔镜像提交之后（含未列入本席对象的 `bd0b09f`），镜像与真源在 389 对上是 **379 逐字节相同 + 10 仅差目录改名 + 0 缺失 + 0 逻辑差异**。

### 4.4 未能核实

| 断言 | 出处 | 不可达环节 |
| --- | --- | --- |
| 「vitest 112 文件 978 通过」 | `43b4e7c`、`cfd2d13` | 硬规则禁止跑测试；仓内无法离线验证用例数与通过状态 |
| 「vue-tsc --noEmit 0 错 / eslint 0 问题 / build:prod rc=0」 | `3931f73`、`43b4e7c`、`cfd2d13` | 禁止 build / lint |
| 「380 对里 379 对」中「比对时刻的 CipherCat 工作树」 | `43b4e7c` | 工作树含未提交内容，只能以同期提交快照近似；已用 `b4b4202` 近似并注明 |

---

## 面 5 · 覆盖缺口（脚本写入前缀 vs 提交涉及路径）

**等级：缺陷（2 条）** — 5 笔镜像提交共触及 `frontend/src/features/blockly/**` 335 个文件，脚本能自动覆盖 297 个（**88.7%**），剩下 38 个（`43b4e7c` 的 33 个 + `3931f73` 的 2 个 + `cfd2d13` 的 1 个测试文件）只能手工维护；其中 `views/`、`plugins/`、`composables/`、`algorithms/`、`utils/` **连差异报告都没有**。

### 5.1 脚本的写入前缀（权威清单）

```
$ sed -n '133,140p' $CIPHER/scripts/sync-to-metacrypt.sh
CORE="$META/frontend/src/features/blockly/core"
COMPONENTS="$META/frontend/src/features/blockly/components"
PROJECT_PORT="$META/frontend/src/features/blockly/services/projects"
RUNTIME="$META/frontend/src/features/blockly/runtime"
SYNC_TARGETS=("$CORE" "$COMPONENTS" "$PROJECT_PORT" "$RUNTIME")
SYNC_WRITE_PREFIXES=("$CORE/blocks" "$CORE/generators" "$CORE/constants" "$COMPONENTS" "$PROJECT_PORT" "$RUNTIME" "$CORE/utils/locale" "$CORE/utils/migration")
```

实际 `cp` 到的路径（第 1–3.8 段）比 `SYNC_WRITE_PREFIXES` 窄：`$COMPONENTS` 只写 `CryptoFunctionPanel.vue` 一个文件，`$CORE/constants` 只写 4 个具名文件，`$PROJECT_PORT` 只写 `ProjectStore.ts`。**`SYNC_WRITE_PREFIXES` 是目录级、写入段是文件级**，两者不一致是下面两条缺口的根因。

### 5.2 逐提交覆盖判定

| 提交 | 主路径文件数（`frontend/src/features/blockly/**`） | 落在写入前缀内（可自动同步） | 前缀外（只能手工） | 覆盖率 |
| --- | --- | --- | --- | --- |
| `3931f73` | 155 | 153（151 镜像目标 + 2 由 3.8 段删除的平板 `locale.ts`/`migration.ts`） | 2（`components/BlocklyEditor.vue`、`core/utils/project-context.ts`） | 98.7% |
| `d7f7efd` | 7 | 5 | 2（`services/projects/{httpProjectStore,index}.ts`，脚本注释声明为 metacrypt 独占，**非缺口**） | 100%（5/5） |
| `c83188f` | 23 | 23 | 0 | 100% |
| `43b4e7c` | 118 | 85 | 33 | 72.0% |
| `cfd2d13` | 32 | 31 | 1（`tests/frontend/unit/.../procedure-demo.test.ts`，测试目录不在镜像范围） | 96.9% |

`3931f73` 的 2 个手工文件之一 `core/utils/project-context.ts` 当前与真源**归一化后逐字相同**（`diff <(... 3931f73:core/utils/project-context.ts | norm) <(... 6dc4b32:src/utils/project-context.ts | norm)` 输出为空，HEAD 侧同样为空）——即它靠人工复制保持了同步，但下一次真源改动不会有任何提示。

`43b4e7c` 的 33 个前缀外文件：

```
$ git -C $META show 43b4e7c -- frontend/src/features/blockly/views frontend/src/features/blockly/plugins \
  | head -3
```

按目录：`views/` 16（其中 15 在 `views/editor/`）+ `plugins/ui/builtin/` 7 + `composables/` 4 + `algorithms/builtin/` 3 + `utils/` 3 = 33。它们的性质是**metacrypt 独有实现**（`43b4e7c` 正文自述「同时纳入 features/blockly 下 metacrypt 自己的并行改动」），所以不算「漏镜像」；问题在于**它们永远拿不到真源修复，且脚本不报告**。

### 5.3 【缺陷】0b 段的扫描域窄于「手工维护目录清单」

0b 段只覆盖三处：

```
$ sed -n '191,232p' $CIPHER/scripts/sync-to-metacrypt.sh
while IFS= read -r rel; do
  case "$rel" in
    components/*) dst="$META/frontend/src/features/blockly/$rel" ;;
    *) dst="$CORE/$rel" ;;
  ...
done <<< "$( { ( cd "$CORE" && find utils services constants -name "*.ts" 2>/dev/null )
                ( cd "$META/frontend/src/features/blockly" && find components -maxdepth 1 -name "*.vue" 2>/dev/null ) } | sort )"
```

即：`$CORE/{utils,services,constants}` + `features/blockly/components/*.vue`（maxdepth 1）。**未覆盖**：`features/blockly/views/**`、`plugins/**`、`composables/**`、`algorithms/**`、`features/blockly/utils/**`、`core/generators/mcl/**`。这五族当前共 47 个文件（`views` 16、`plugins` 16、`composables` 7、`algorithms` 7、`utils` 1；另有 `session` 2、`api` 6 与 `core/generators/mcl/**` 属纯 metacrypt 专属、按设计不同步），对同步脚本**完全不存在**：既不被覆盖，也不被报告，也不进脏检查。

**修完要达到的结果**：0b 段的 `find` 列表必须与 5.2 表的「只能手工」列逐项对齐（至少加入 `views`、`plugins`、`composables`、`algorithms`），且在 `[4/4] 核对` 段打印「手工维护目录清单 + 文件数」。验收：运行脚本时输出里出现 `views/editor/useEditorUiHost.ts` 一类的路径（差异 ≤20 行则列行数，>20 行列文件名）。

### 5.4 【缺陷】两个被 `cp` 但没有配对的 constants 文件逃过导出回归预检

第 3 段会复制 4 个 constants 文件：

```
$ sed -n '314,321p' $CIPHER/scripts/sync-to-metacrypt.sh
cp "$CIPHER/src/constants/block-types.ts" "$CORE/constants/block-types.ts"
cp "$CIPHER/src/constants/sbox-presets.ts" "$CORE/constants/sbox-presets.ts"
cp "$CIPHER/src/constants/grid-shape.ts" "$CORE/constants/grid-shape.ts"
cp "$CIPHER/src/constants/list-bridge.ts" "$CORE/constants/list-bridge.ts"
```

但 `mirror_pairs()` 只给前两个配了对（第 100–101 行 `printf '%s\t%s\n' … block-types.ts` / `sbox-presets.ts`），`grid-shape.ts` 与 `list-bridge.ts` **不在配对表里**。后果：
- 0a 的导出回归预检（`comm -13 <(exports_of src) <(exports_of dst)`）对这两个文件不执行 → metricrypt 侧若有人往里加导出，下一次同步静默删除且不报错；
- 0b 的「shared 但未镜像」反而会**误报**它们（它们其实被镜像了），因为 0b 用 `grep -Fxq "$dst" <<< "$MIRROR_TARGETS"` 做排除，不在配对表里的就当成未镜像。

这两个文件正是 `3931f73` 正文点名的「此前未纳入镜像，导致本仓 type-check 找不到模块」的那两个——也就是**上一次覆盖缺口刚修好、预检没跟着补**。

**修完要达到的结果**：`mirror_pairs()` 增加这两行映射，使 `SYNC_WRITE_PREFIXES`、实际 `cp` 列表、配对表三者一一对应。验收：`bash -c 'source scripts/sync-to-metacrypt.sh 2>/dev/null' ` 不可行时，改为静态判据——`grep -c "constants/" scripts/sync-to-metacrypt.sh` 中 `mirror_pairs()` 区段的 constants 配对数 = 4，且 `grep -c "导出回归预检：比对"` 输出里 `跳过` 计数不包含这两个文件。

---

## 一句话结论

5 笔镜像提交在「同期真源快照」口径下 **296 对里 292 对逐字相同、0 处逻辑漂移、0 个文件缺失**（HEAD 终态 389 对 = 379 逐字节 + 10 仅差允许的 `bit/postquantum` 目录改写），镜像保真本身过关；但 `43b4e7c` 有 **33 个文件在脚本写入前缀之外且 0b 不报告**、`code-languages.ts:5,14` 与 `components/BlocklyEditor.vue` 是只在镜像区生长的 hand-edit、`grid-shape.ts`/`list-bridge.ts` 被复制却逃过导出回归预检，这四处决定「未来同步会不会漏」；`31dad11` 实测含 **2 处真语义变化（`main.ts:74` 全局注册名 `'svg-icon'`→`'SvgIcon'`、`menu/index.vue:240` 属性值 `&quot;` 转义改变渲染）+ 25 处 v-on 事件名 camelCase→kebab**，不是纯格式（但不触及镜像）；`cfd2d13` 正文的「362 一致 / 27 差异」复算为 **379 / 10**，口径写错。
