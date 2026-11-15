# CipherCat → metacrypt_server editor-shell alignment whitelist

This page records the **alignment verdict** for the editor shell and run chain across the two repositories: which files can be mirrored mechanically, which must be ported with adaptation, and which must be excluded. Every verdict rests on a re-runnable command listed on this page; none comes from directory names or recollection. The page states verdicts only — no port has been executed.

## 1. Conclusions first

1. **The two shells are not the same structure.** CipherCat's shell root is `src/App.vue` (route `/editor/:id` mounts it directly), with orchestration and components in `src/components/editor/` and `src/composables/`; metacrypt_server's shell root is `frontend/src/features/blockly/views/EditorView.vue`, whose orchestration is split into seven modules and five CSS slices (twelve files) under `views/editor/`.
2. **No shell file can be mirrored byte-for-byte.** Every same-named file differs (class A in section 3).
3. **The run chain is what can be aligned, and it needs adaptation.** The four differences are listed in class B; they cross directories and aliases, so `cp` is not an option.
4. **`scripts/sync-to-metacrypt.sh` covers the Blockly core** (`blocks/`, `generators/`, `constants/`). The editor shell is outside that scope and should not be merged into it — the two shells have different host dependencies.

## 2. Structure side by side

| Responsibility | CipherCat | metacrypt_server | Relationship |
|---|---|---|---|
| Shell root | `src/App.vue` (487 lines) | `views/EditorView.vue` (491 lines) | Same origin, forked; similar size, different split |
| Sidebar / toolbar / status bar | `src/components/editor/*` (9 files) | `views/editor/*` (7 modules + 5 CSS files, 12 in total) | Different directories and granularity |
| Project data | `src/composables/useProjectDB.ts`, `useProjectFiles.ts` (IndexedDB) | `features/blockly/api/*` (6 backend modules) | **Different storage model** |
| Run chain | `src/runtime/run-code.ts`, `python-runner.worker.ts`, `js-runner.worker.ts` | `utils/run-code.ts`, `python-runner.worker.ts` | JS worker missing |
| Pyodide assets | `devDependency pyodide ^0.25.1` + `scripts/copy-pyodide.mjs` + `predev`/`prebuild` | 7 files committed under `frontend/public/pyodide/` | Same version (0.25.1 / Python 3.11.3), different management |
| Content security policy | `index.html`: `script-src 'self'` | none | metacrypt has no policy |

CipherCat has **no `src/api` layer**: every shell file counts zero references to `@/api`, `@/store`, `@/router`, `axios` or `element-plus`. The metacrypt shell files import `features/blockly/api/*`.

## 3. Three verdict classes

### A. Mechanically mirrorable: existing shell files **none**, new shared layer **four**

Comparing same-named **shell** files byte by byte, all differ:

| File | Result |
|---|---|
| `EditorSidebar.vue` | 482 differing lines |
| `EditorStatusBar.vue` | 107 differing lines |
| Five CSS slices such as `editor-shell.css` | exist only in metacrypt (CipherCat uses a single `editor-sidebar.css`) |

The conclusion stands: copying the shell across does not hold, and every change has to be adapted per responsibility.

The shared layer added in step 1 is the exception — it has no host dependency and can be mirrored as a whole directory. That is the only way to move the mirrorable count from zero to something positive:

| File | Lines | Note |
|---|---:|---|
| `runtime/contracts/run-chain.ts` | 70 | Pure types, zero dependencies |
| `runtime/run-code.ts` | 257 | Single injection point: `RuntimeAssets` |
| `runtime/python-runner.worker.ts` | 229 | Falls back to same-origin `/pyodide/` |
| `runtime/js-runner.worker.ts` | 81 | Same-origin module worker |

### B. Port with adaptation (run chain, 4 items)

| Item | CipherCat | metacrypt | Difference | Port action |
|---|---|---|---|---|
| Thread running JS | `src/runtime/js-runner.worker.ts` (81 lines) | absent; still a Blob worker + `new Function` | CipherCat moved to a same-origin module worker because `script-src 'self'` blocks Blob | Add the same worker and adjust the caller's URL construction |
| Run orchestration and progress | `src/runtime/run-code.ts` (257 lines) | `utils/run-code.ts` (227 lines) | CipherCat adds an `onProgress` channel (load-byte progress) and a unified JS/Python entry | Port the progress channel; keep metacrypt's existing `errorCode` plus i18n wording |
| Python worker | `src/runtime/python-runner.worker.ts` (229 lines) | same-named file (104 lines) | CipherCat wraps same-origin `/pyodide/` requests and counts bytes; the denominator comes from a build-time `manifest.json` | Also introduce `manifest.json`; otherwise progress degrades to indefinite |
| Pyodide asset management | `scripts/copy-pyodide.mjs` (65 lines) + `pyodide:copy` + `predev`/`prebuild`; `public/pyodide/` is git-ignored | 7 files committed, no copy script, no `predev`/`prebuild` | Same version 0.25.1, but metacrypt pins it only in committed files | Either move it out of Git and add a copy script, or keep it committed but add `manifest.json` and a version check |

Common porting edit: in metacrypt the `@/` alias points at `@/features/blockly/`, so import paths must be rewritten; the run chain does not need `core/`, but it must still avoid `api/`.

### C. Must be excluded (backend-bound or structurally unrelated)

| metacrypt file | Backend references | Reason for exclusion |
|---|---:|---|
| `views/editor/useEditorUiHost.ts` | 7 | Members, branches, revisions and collaboration all go through backend interfaces |
| `views/EditorView.vue` | 3 | Carries collaboration and revision orchestration; does not correspond to `App.vue` |
| `views/editor/useEditorProjectActions.ts` | 3 | `renameProject` and peers call `api/project` directly |
| `views/editor/useEditorLifecycle.ts` | 1 | `ProjectFile` type comes from the api layer |
| `views/editor/editorProjectPresentation.ts` | 1 | Same |
| `views/editor/EditorSidebar.vue` | 1 | Same |
| `views/editor/useEditorCodeRunner.ts` | 1 | Type dependency on api; **its run logic is still the reference**, so handle it as class B when porting |
| `features/blockly/api/*` (6 modules) | — | CipherCat has no such layer (it uses IndexedDB) |

`useEditorCodeRunner.ts` sits here because of its type imports, not because it binds business logic: use it as the host entry point when porting the run chain, rewriting where the types come from.

## 4. Ordering: worker first, CSP second

CipherCat's `index.html` uses `script-src 'self'`, which blocks Blob workers outright (per the comment in `src/runtime/js-runner.worker.ts` and the CSP spec: without `worker-src`, `script-src` applies, and `blob:` is outside `'self'`). metacrypt currently has no CSP, so its Blob worker still runs.

The order therefore cannot be reversed: **land the same-origin module worker in metacrypt first, then add the CSP**. Doing it the other way breaks "run JS" in metacrypt the moment the policy lands, and the symptom — a run button that produces no output — reads like a generator failure.

## 5. Re-running the checks

```bash
# Shell-root size on both sides
wc -l src/App.vue
wc -l ../metacrypt_server/frontend/src/features/blockly/views/EditorView.vue

# Byte identity of a same-named file (no output means identical)
cmp src/components/editor/EditorSidebar.vue \
    ../metacrypt_server/frontend/src/features/blockly/views/editor/EditorSidebar.vue

# Backend coupling count (should be 0 in CipherCat)
grep -cE "from '@/(api|store|router)|axios|element-plus|/api/" src/App.vue

# Pyodide versions
grep -n '"pyodide"' package.json
node -e 'const j=require("../metacrypt_server/frontend/public/pyodide/pyodide-lock.json");console.log(j.info)'
```

## 6. Out of scope

- metacrypt-only directories (`features/blockly/algorithms/`, `generators/mcl/`, `utils/locale.ts`) are not mirrored and are not judged here.
- The storage-model difference (IndexedDB versus backend API) is architectural and cannot be solved by file synchronisation.
- This page is neither a port plan nor a schedule; it records only the basis for the alignment verdict.

## 7. Current progress (2026-11-15)

| Step | Status | Evidence |
|---|---|---|
| Land the contract (types only) | Done | `src/runtime/contracts/run-chain.ts`; CipherCat `vue-tsc --noEmit` passes |
| Move the run chain into the shared directory | Done | `src/runtime/`: run-code 257 lines plus two workers; `useCodeRunner` is the only reference and its path is updated |
| Inject `RuntimeAssets` | Done | Default still resolves same-origin `/pyodide/`; a real browser ran the default Python path, default JS path and explicit injection, all passing with zero console errors |
| sync whitelist | Done (isolated check) | New `[3.7]` stage; the same logic run twice gives one md5 (`b937605d515e62cede20c61fe556179d`) and leaves no `@/runtime/` residue |
| metacrypt side in place | Done (references not switched) | Four files written to `features/blockly/runtime/`; that repository reports 0 `vue-tsc` errors and 0 eslint problems |
| Switch metacrypt references | Not executed (preconditions open) | The mirror area still carries uncommitted changes, and they are a **static pile** rather than work added today: all of `features/blockly` measures 156 entries (22 untracked entries, 172 files under `git status -uall`); the modified files date to 2026-11-13 (124), 11-14 (6) and 10-22 (4) |
| Harden the sync guard | Done | The guard now covers all four write roots instead of only `core` + `components` (adds `services/projects` and `runtime`) and measures 146 entries against the old 144. A new pair-mapping assertion exits 1 when a paired destination falls outside the subtrees the sync writes — the old script pointed ProjectStore at `core/services/`, so that pair's export check was silently skipped. Pair total 343 → 347 with 3 skipped. Mutation check: the old mapping is rejected, while the new mapping, a not-yet-synced new file and a runtime contract all pass |
| Back-port mirror-area increments | Owner decision | The export pre-check found `TYPE_MATRIX`/`TYPE_VECTOR` exported only by metacrypt's `core/constants/block-types.ts` (CipherCat has no Matrix/Vector type anywhere), so the next sync would delete them; choose one of the three routes the script prints (move up a layer / back-port / confirm discard) |
| De-fork ProjectStore | Done | The authoritative copy overwrote the metacrypt copy and is byte-identical; `httpProjectStore.ts` untouched |
| Slim the shell (CipherCat side) | Done | `App.vue` went from 487 to 376 lines; orchestration moved into `useEditorFileActions` / `useEditorPanels` / `useEditorWorkspaceActions` under `src/components/editor/`, leaving bindings only. 13 new unit tests pin the order "write the canvas back before switching files"; a real browser verified import 6 blocks, add an empty file, switch back still 6 blocks, delete, refuse deleting the last file, and persistence after reload |
| Slim the shell (metacrypt side) | Not executed | Same batch as switching references, pending a clean worktree there |

Two places in the shell must refresh derived state by hand for the same reason: Blockly's load path wraps `clear()` and `load()` in `Blockly.Events.disable()` and therefore **does not fire a change event**. So after importing a workspace or switching files, the block counter at the bottom would not update by itself. `afterWorkspaceReplaced` (import, which also marks the project dirty) and `afterWorkspaceSwitch` (switch, refresh only) cover the two cases. The split is deliberate: merely switching files is not an edit and must not mark the project unsaved.

Two things to handle when switching references: metacrypt still has `utils/run-code.ts` referenced by `useEditorCodeRunner`, and it should be deleted then to avoid two implementations; and moving JS from a Blob worker to a same-origin module worker is a behaviour change that must be verified in a real browser before any CSP is added.

Dispose of that backlog in two classes. Changes inside the mirror (`core` + `components`) follow the authority rule: metacrypt-only logic moves to a non-mirror layer, fixes that belong upstream are back-ported into CipherCat, and the rest is discarded. Local metacrypt refactors such as `views/editor/` (`views/EditorView.vue` net 1983 lines removed plus 12 new files) do not couple to the reference switch and can be committed on their own. The sync script already fails closed: any dirty write root exits 1 unless `--overwrite-local` is passed explicitly.
