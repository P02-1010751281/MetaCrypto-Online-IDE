# SpecCards: turning "what the standard says" into machine-checkable assertions

**Scope**: `docs/standards/<standard-dir>/SPEC-CARD.json`, `spec-runs/<run-id>/manifest.json`, and the five gates `npm run spec:validate` / `npm run spec:anchors` / `npm run spec:runs` / `npm run spec:candidates` / `npm run spec:matrix`, plus the generated [`SPEC-CARD-MATRIX.md`](../standards/SPEC-CARD-MATRIX.md).
**Status**: v0 skeleton plus three cards (SP 800-38B CMAC, SP 800-38C CCM, SP 800-38E XTS), with all 12 anchors at `anchor_grade: A` (quote verifiable plus the PDF physical page confirmed by `spec:anchors` re-extracting page by page). P0 fixes evidence and interface mappings only and generates no code; from P1 on, `spec:scaffold` writes candidate skeletons into `spec-runs/candidates/` only — it merges nothing and edits no standard page; `spec:candidates` then rechecks each candidate's shape, provenance, syntax, contract conformance and dual-language structural parity.

## 1. Why it exists

When standards or papers are turned into blocks and generators, the failures that hurt most are not "cannot write the algorithm" but three kinds of errors that reading the code cannot reveal:

1. **Fabricated anchors**: a claim that "§6.1 says K1 = L << 1" where the location was invented;
2. **Hallucinated constants**: S-boxes, round constants or Rb "filled in" into plausible but wrong values;
3. **Interface drift**: block names or port types that do not exist in the repository, discovered only downstream.

All three share one property: they can be re-checked **offline and deterministically**. A SpecCard extracts those facts so a script recomputes them, instead of a human or a model asserting "I checked it".

## 2. What a card looks like

The field contract lives in [`scripts/spec-card.schema.json`](../../scripts/spec-card.schema.json) (JSON Schema 2020-12). Minimal skeleton:

```json
{
  "schema": "ciphercat.spec-card/v0",
  "id": "sp800-38b-cmac",
  "kind": "standard",
  "standard": { "name": "...", "version": "...", "source_url": "https://...", "dir": ".", "artifacts": [{ "path": "...pdf", "sha256": "<64 hex>" }] },
  "anchors": [{ "id": "A1-...", "source": "00-Standard-Source.md", "line_range": [586, 592], "quote": "...", "quote_sha256": "<64 hex>", "anchor_grade": "A", "pdf_pages": [12], "extractor": { "tool": "pdftotext", "version": "..." } }],
  "entries": [{ "key": "sp800-38b.cmac.subkey-generation", "type": "原语", "io": { "inputs": [], "outputs": [] }, "pseudocode": { "fidelity": "text-layer", "anchor": "A1-...", "text": "..." }, "blocks": { "existing": ["cmac_subkeys"] } }],
  "provenance": { "extracted_by": { "kind": "llm", "model": "..." }, "review": { "status": "draft" } }
}
```

Cards sit inside their standard directory (`dir: "."`) so anchors, the PDF and the split pages share one location and paths cannot drift. An extra JSON file does not disturb `standards:check`, which only requires `.pdf`/`.txt` files to be registered in the manifest.

## 3. What the gate recomputes (the card's own word does not count)

`node scripts/check-spec-cards.mjs` (`npm run spec:validate`):

| Check | Rule | Failure example |
|---|---|---|
| Artifact hash | `standard.artifacts[].sha256` matches the file byte for byte | PDF replaced, hash stale |
| Quote anchor | `quote`, after whitespace normalisation, must really appear inside `line_range` of `source` | drifted line numbers, rewritten quote |
| Quote digest | `quote_sha256` equals SHA-256 of the normalised quote | quote edited, digest not updated |
| Block existence | `entries[].blocks.existing` must be real blocks in `docs/blocks/BLOCK-IO-CONTRACT.json` | `cmac_not_a_real_block` |
| Type labels | port `type` must be a check label actually used by the contract (or `Any`) | invented `ByteArray` |
| Decomposition level | `entries[].composes` may only reference entries in the same card, the child `level` must be strictly lower, and the references must be acyclic | an L2 procedure composing another L2, or a cycle |
| Structure | strict schema validation; undeclared fields are rejected | keys the schema does not know |

Three more rules:

- **`fidelity` in three tiers**: `verbatim` (identical to the anchor quote), `text-layer` (identical to the text layer, which itself has known defects, so `known_defects` is mandatory), `paraphrase` (a project rewrite, navigation only, never evidence). The first two require `text` to equal the anchor quote after normalisation.
- **`anchor_grade` ladder**: `A` = line-level quote verified **and** the PDF physical page confirmed by `spec:anchors` re-extracting it page by page (hence `pdf_pages` is required, and the pages must agree with the extraction's own page breaks); `B` = line-level quote verified, PDF page unchecked; `C` = section-level location only. The object being checked is the text layer, not a human visual pass over the layout (see §8).
- **Granularity ladder (`level`)**: `L0` operations/literals, `L1` primitive blocks, `L2` procedures, `L3` algorithms, `L4` families/patterns. An entry that declares `composes` must also declare `level`, children must sit strictly lower, and the graph must be acyclic — that is what makes "small blocks into medium blocks into large blocks" machine-checkable (research report §4.3.1).

Every run also executes **negative-control self-test**: twelve mutations of the first card (edit a quote, edit a digest, out-of-range lines, relabel B as A, edit the artifact hash, verbatim text mismatch, unknown block, reviewed without a reviewer, `composes` pointing at a missing entry, self-reference, a child not lower than its parent, a `composes` cycle). Each must turn the gate red. If the self-test fails, the gate is considered broken — a gate that cannot fire is not a gate.

```
$ npm run spec:validate
SPEC_CARD_SELFTEST controls=12 fired=12
SPEC_CARD_SUMMARY cards=3 anchors=12 entries=11 artifacts=3 errors=0
```

## 4. Three landed cards: the CMAC example and the CCM/XTS additions

[`docs/standards/sp800-38b-cmac/SPEC-CARD.json`](../standards/sp800-38b-cmac/SPEC-CARD.json) fixes §6.1 subkey generation and §6.2 MAC generation: two anchors (lines 586–592 and 636–644), two entries and one artifact hash, with the entries mapped to `cmac_subkeys`/`cmac_double` and to `cmac_mac`; the two entries also carry their ladder level — `cmac_subkeys` is an `L1` primitive and `cmac_mac` is an `L2` procedure that declares via `composes` that it is built from the former.

It equally demonstrates **not pretending to know**:

- both anchors use `fidelity: text-layer` and carry `known_defects`: the extraction flattens `CIPH_K(0^b)` to `CIPHK(0b)`, drops the ceiling brackets in `n = ⌈Mlen/b⌉`, and mixes a footnote digit into the body;
- `Rb = 0x87` has no verbatim anchor (the text layer renders `R128` as `012010000111`), so it is recorded under `open_questions` instead of being forced;
- `cmac_mac` moved its `vectors.status` from `missing` to `wired`: the four RFC 4493 §4 vectors (0/16/40/64 bytes) run through `demos/procedures/CMAC-AES.json` in both languages under `verify:demos`; `cmac_subkeys` moved from `partial` to `wired` too — a new `CMAC_SUBKEYS` procedure in the same workspace runs the same section K1‖K2, and `tests/unit/demo-vector-crosscheck.test.ts` recomputes those subkeys independently with `cryptography`;
- `review.status: draft`: the semantics (bit widths, byte order, Rb value) have no named cryptographic reviewer sign-off yet — `decision: gated` is not a sign-off.

The same snapshot (`spec-runs/2026-11-13-ccm-xts-extract`) produced two more cards. This tests "how many cards can one run write" and also whether the contract pretends to know when the local standard text does not contain the algorithm:

| Card | Anchors / entries | What the standard text can prove | What it cannot prove |
|---|---|---|---|
| [SP 800-38C CCM](../standards/sp800-38c-ccm/SPEC-CARD.json) | 7 / 7 | The eight §6.1 generation-encryption steps (including `known_defects` such as the page number mixed into the body and flattened superscripts), the ten §6.2 decryption-verification steps, the A.2.1 B0 bit fields, the three A.2.2 length-encoding cases, and the A.3 counter-block format | All seven entries are now executed stage by stage by procedures in the same workspace (`vectors.status=wired`), but only the Example 1/2 parameters and the Example 1 intermediate values are covered; there is no full nonce/tag length matrix, and §6.2 INVALID is expressed only as a throw, without the standard's MaxErrs counter or key-retirement policy |
| [SP 800-38E XTS](../standards/sp800-38e-xts/SPEC-CARD.json) | 3 / 2 | The §3 XEX + ciphertext-stealing definition, the §4 limit of 2^20 AES blocks, and the §5 ordering convention for the last complete block and the partial block | **The standard itself contains no XTS-AES-Enc steps**: §3 delegates the algorithm to IEEE Std 1619-2007, which the repository does not distribute, so both entries can only be `fidelity=paraphrase` summaries of the project implementation; although `xts_tweak_mul` is now executed by a workspace procedure, it remains project implementation, not source-text evidence |

The XTS card is precisely about **not pretending to know**: it records "there is no local algorithm text" in `limits` and `open_questions` instead of passing the project implementation off as a verbatim quote. In the same snapshot the six primitives moved from `partial` to `wired` — six procedures added to `CCM-Encrypt.json` and `XTS-Encrypt.json`, no new workspaces — and `spec:plan` went from `gaps=6` to `cards=3 gaps=0`.

## 5. What a run changed: the run manifest

A card proves what the standard says; it cannot prove which run produced the card, which bytes that run read, or whether the gate exited 0 at the time. The run manifest `spec-runs/<run-id>/manifest.json` (contract in [`scripts/spec-run.schema.json`](../../scripts/spec-run.schema.json), gate `npm run spec:runs`) closes that gap.

```json
{
  "run_id": "2026-11-13-cmac-extract",
  "inputs": [{ "path": "docs/standards/sp800-38b-cmac/NIST.SP.800-38B.pdf", "sha256": "<64 hex>", "role": "standard-source" }],
  "extractor": { "tool": "pdftotext -layout", "version": "not recorded (…)" },
  "outputs": [{ "path": "docs/standards/sp800-38b-cmac/SPEC-CARD.json" }],
  "shared": [{ "path": "demos/tests.json" }],
  "gates": [{ "cmd": "npm run verify:all", "exit": 0, "summary": "DEMO_SUMMARY total=60 pass=60 fail=0" }],
  "decision": "gated"
}
```

`node scripts/check-spec-runs.mjs` recomputes only the deterministic parts:

| Check | Rule |
|---|---|
| `run_id` | must equal the directory name (a manifest copied elsewhere goes red) |
| Input hashes | `inputs[].sha256` matches the disk byte for byte; outputs and shared files are only checked for existence |
| Single accounting | one path may not appear in `inputs`/`outputs`/`shared` twice |
| Real gate names | `gates[].cmd` must be a script that exists in `package.json`, or an existing repository script |
| Decision consistency | `gated` requires at least one gate, all exiting 0; `halted`/`rejected` require at least one non-zero exit |
| Structure | strict schema validation; undeclared fields are rejected |

Four design choices; the first three were corrected in the previous round:

1. **Freeze inputs only**: the source PDF and text layer carry hashes — if the source changes, that run's conclusion no longer holds. Outputs are listed by path only: SpecCards and Demo workspaces are rewritten by later review, and freezing their hashes would turn every legitimate revision into a red gate, which in practice invites "just update the hash" and destroys the evidence.
2. **No duplicated hashes**: the source PDF and text-layer digests already live in `standard.artifacts[].sha256` and `anchors[].quote_sha256` on the card; storing them again in the manifest creates two copies that drift.
3. **Shared files are paths only**: `demos/tests.json` and `demos/evidence.json` are touched by every later Demo. Hashing them into the manifest would turn the 61st Demo into a red gate for every historical manifest. Their internal consistency is guaranteed by `spec:validate` and `verify:all` themselves.
4. **No `model` block when no model ran**: the offline template path omits the section entirely, placeholder values such as `provider: offline` fail the gate, and `prompt_sha256` appears only once the prompt is actually archived.

```
$ npm run spec:runs
SPEC_RUN_SELFTEST controls=10 fired=10
SPEC_RUN_SUMMARY runs=4 inputs=14 outputs=10 shared=24 gates=10 decision=gated errors=0
```

The third manifest, `2026-11-13-ccm-xts-wiring`, is the wiring run for the same cards: the inputs are still those two text layers, while the outputs are two Demo workspaces — extraction and wiring are recorded separately so each run says exactly what it changed.

The fourth manifest, `2026-11-13-anchor-pages`, records the anchor page-attestation round: its inputs freeze both the three text layers and the three PDFs (`spec:anchors` recomputes page numbers from them), and its outputs are the three cards with backfilled `pdf_pages` plus `scripts/check-spec-anchors.mjs`.

**What it cannot prove**: the `exit: 0` entries are a declared evidence basis. The script guarantees only that the manifest is internally consistent and that the bytes it references still exist; it does not prove that the command ran. This has the same status as `demos/evidence.json`, so `decision: gated` must never be used to claim "correct", "secure" or "signed off" beyond the limits in §6.

## 6. What it must not be used to claim

- Not "the AI verified the standard": the gate re-checks the words written on the card, not a human's understanding of the specification;
- Not "the implementation conforms" or "certified": `vectors.status=wired` only means a regression entry is attached in a Demo or unit test, while `partial` means evidence exists on one side only; neither is an official-vector coverage proof nor a complete test suite;
- `anchor_grade: C` is a location, not quote evidence; `fidelity: paraphrase` is navigation, not source text;
- `anchor_grade: A` says only that the quote appears on that PDF page, not that the page is a particular clause; the page check is text-layer re-extraction, not a human visual pass, and it does not cover scans or glyph defects;
- A card neither replaces the entry metadata tables under `docs/standards` nor the vector regression in `verify:all`.

## 7. Producer entry points: `spec:plan`, `spec:scaffold` and `spec:candidates`

P0 covers the evidence layer only. Turning a card into something a person can actually start from needs three entry points, each doing exactly one thing.

### 7.1 `spec:plan`: read-only gap accounting

```bash
npm run spec:plan -- sp800-38b-cmac     # one card
npm run spec:plan -- --all --json       # every card, machine-readable
```

```text
SPEC_PLAN card=sp800-38b-cmac entries=2 anchors=2 registered=4 unregistered=0 planned=0 vectors_open=0 anchors_open=0 gaps=0
SPEC_PLAN_SUMMARY cards=1 gaps=0
```

When gaps exist, each one adds a line: `  GAP <kind> <entry key> (<detail>)` (e.g. set an entry's `vectors.status` back to `partial` and rerun).

Four kinds of gap:

| kind | meaning | where it goes |
| --- | --- | --- |
| `register-block` | a referenced block is absent from `BLOCK-IO-CONTRACT.json` | card and code disagree; fix one side first |
| `implement-block` | a block listed under `blocks.planned` | run `spec:scaffold` |
| `wire-vectors` | `vectors.status` is not `wired` | wire the official vectors and update the card |
| `refine-anchor` | an anchor lacks `quote_sha256` or `line_range` | go back to the source text |

"Registered blocks" means the keys of `docs/blocks/BLOCK-IO-CONTRACT.json`: that file is generated from the real block definitions by `npm run block-io:write`, and `verify:all` checks it still matches the code. Gaps are not errors, so the exit code is always 0; the script only lays out what is missing.

### 7.2 `spec:scaffold`: writes into the candidate directory only

```bash
npm run spec:scaffold -- sp800-38b-cmac --block cmac_mac
npm run spec:scaffold -- --selftest          # 5 controls: 4 refusals + 1 production
```

Four hard preconditions; failing any one of them refuses to produce candidates:

1. the card exists and parses;
2. the target block appears in that card's `entries[].blocks` (`existing` or `planned`) — no generating by algorithm name alone;
3. the output directory is inside `spec-runs/candidates/` (`--skip-gates` is accepted only under `.selftest`);
4. both `npm run spec:validate` and `npm run spec:runs` exit 0.

Exactly five files come out: `plan.json`, `block.ts`, `generator.python.ts`, `generator.javascript.ts`, `REVIEW-PACKET.md`. The block skeleton is built from the contract's input kinds (Blockly VALUE / STATEMENT / DUMMY), `getCheck()` values and field classes, and everything to be filled in stays a `TODO`.

**Boundary**: it writes no `src/`, edits no evidence page under `docs/standards`, merges nothing and calls no model. The candidate directory is excluded from both `.gitignore` and ESLint — it is generated output, not source, and that is not a relaxation of the lint rules. The contract only records `getCheck()`, which cannot distinguish "no connection" from "any type", so statement connections must be confirmed by a person; that is item 2 of the review packet.

### 7.3 `spec:candidates`: three-layer verification of candidates

```bash
npm run spec:candidates              # scan every candidate directory, 16 self-test controls
npm run spec:candidates -- --json    # machine-readable
```

The gates were green when a candidate was written, but afterwards its basis can drift, its skeleton can be broken, and its two generators can point at different blocks. This gate recomputes five things per directory:

| Layer | What it recomputes | Failure example |
| --- | --- | --- |
| Shape | `plan.json` parses, the schema is right, the five required files exist, `files` matches disk, directory name = `<card>-<block>` | someone deleted `REVIEW-PACKET.md` |
| Provenance | the card and entry still exist, the entry's `blocks.existing/planned` still lists the block, `level`/`normative_level` match the card, the `contract` flag agrees with the contract | the card renamed the entry key, orphaning the candidate |
| Syntax and registration | the three TS files parse; imports come only from `blockly/core`, `blockly/javascript`, `blockly/python` (no `@/` alias); every `Blockly.Blocks[...]` and both `forBlock[...]` keys equal `plan.block` | a generator registers a different block name |
| Contract conformance | `appendValueInput(...).setCheck([...])` and `setOutput(true, [...])` match `check`/`outputCheck` in `BLOCK-IO-CONTRACT.json` item by item | `Bytes` written as `Number` |
| Dual-language parity | judged only once `TODO(候选)` is gone: both generators must read the same input and field sets, and every input name must exist in the contract | JavaScript reads `MSG`, Python reads only `KEY` |

```text
$ npm run spec:candidates
SPEC_CANDIDATE_SELFTEST controls=16 fired=16
SPEC_CANDIDATE_SUMMARY candidates=1 shape_ok=1 parse_ok=1 parity_ok=0 parity_stub=1 vectors_wired=0 vectors_pending=1 errors=0
```

The self-test has 16 controls: 2 positive (an unmutated copy and an implemented form) must pass, and 14 negative (missing file, corrupt JSON, wrong schema, unknown card or entry, drifted block, incomplete `files`, syntax error, `setCheck`/`setOutput` disagreeing with the contract, a generator registering the wrong block, an `@/` alias, a flipped `contract` flag, TODO markers removed while no input is read) must each turn red. The positive controls are not ceremony: with negatives only, a broken implementation whose parity check always fails or whose vectors are always pending would be hidden behind an all-green board.

**One fail-closed trade-off**: contract conformance parses the candidate skeleton's chained form (`appendValueInput(...).setCheck([...])`, `setOutput(true, [...])`). A hand-written implementation using another form (say, building a local variable before setting the check) is reported as "not declared in block.ts" rather than silently passing — go back to a parseable form or change the check in the same change; do not make the gate guess.

**What it cannot prove**: candidates are not in the `src/` registration chain, so no Blockly code can be generated from them. This gate therefore proves neither that the two languages emit the **same output** nor that a candidate implements the algorithm — while the skeleton is still TODO, `parity` is recorded as `stub` and the summary counts `pending`, not verified; `vectors=card-wired` says only that the card declares a regression entry, not that the candidate passed that vector. Real output equivalence and vector execution have to wait until a candidate is merged into `src/`, where unit tests and `verify:demos` can run it.

## 8. PDF page attestation for anchors: `spec:anchors`

`pdf_pages` used to be the one card field filled in by hand and rechecked by nothing: `spec:validate` only required it to be non-empty when `anchor_grade=A`, so any page number passed. `node scripts/check-spec-anchors.mjs` (`npm run spec:anchors`) now recomputes it.

```bash
npm run spec:anchors              # check plus 11 self-test controls
npm run spec:anchors -- --write   # verify first, then backfill pdf_pages from the extraction
npm run spec:anchors -- --debug   # print which error each control actually hit
```

It recomputes three layers:

| Layer | What is recomputed | Failure example |
| --- | --- | --- |
| Page breaks in the extraction | `00-Standard-Source.md` still carries the `-layout` form feeds (`\f`), so the page holding the first and last line of `line_range` is determined; `pdf_pages` must equal that range page for page | the quote is only on page 12 but the card says `[13]` or `[12,13]` |
| Real PDF page content | `pdftotext -layout` re-extracts the sibling PDF page by page; the listed pages, joined in order, must actually contain `quote` | the quote was edited, the extraction drifted from the PDF, the page number is wrong |
| Page existence | `pdf_pages` entries must be integers, start at 1, be strictly increasing and not exceed the PDF page count | `["12"]`, or `[22]` for a 21-page PDF |

```text
$ npm run spec:anchors
SPEC_ANCHOR card=sp800-38b-cmac anchors=2 grade_a=2 verified=2 pages=12,13 errors=0
SPEC_ANCHOR card=sp800-38c-ccm anchors=6 grade_a=6 verified=6 pages=15,16,19,20 errors=0
SPEC_ANCHOR card=sp800-38e-xts anchors=3 grade_a=3 verified=3 pages=9,10,11 errors=0
SPEC_ANCHOR_SELFTEST controls=11 fired=11
SPEC_ANCHOR_SUMMARY cards=3 anchors=12 grade_a=12 verified=12 pages=9 tool=pdftotext/26.10.0 errors=0
```

All 12 anchors are now `anchor_grade: A`: CMAC §6.1/§6.2 sit on physical pages 12/13; the seven CCM anchors sit on pages 15/16/19/20 (with `A1-encrypt-steps` spanning 15–16, matched after joining the adjacent pages, and `A2-decrypt-steps` covering the §6.2 steps on page 16); the three XTS anchors sit on pages 9/10/11.

**What `anchor_grade: A` now means**: the line-level quote is verifiable and the PDF physical page has been confirmed by this gate re-extracting it page by page. It is **not** a human visual pass — the object is the text layer, scan or glyph defects are still recorded in `anchors[].known_defects`, and it does not prove that the page is a particular clause.

**11 self-test controls**: 1 positive (an unmutated copy must pass) plus 10 negative (missing `pdf_pages`, non-integer page, page beyond the PDF, descending order, duplicate page, one page too many, wrong page, line range drifted onto a neighbouring page, PDF absent, card with no PDF artifact). Each must turn red for its intended reason — `--debug` prints the error it actually hit.

**Dependency**: poppler-utils' `pdftotext` (`-layout`). A missing tool fails closed with an install hint rather than skipping silently: if the pages cannot be checked, the gate must not be green. CI installs poppler-utils before `verify:all`.

**What it cannot prove**: only that the quote appears on that page. Semantic sign-off (bit widths, endianness, `Rb`, B0 bit fields) still depends on `provenance.review` — all three cards are still `draft`, with no named cryptographic reviewer.

## 9. The cross-reference table: `spec:matrix`

A card can declare `vectors.status: wired`, but "which workspace and which procedure actually executed this obligation" used to live only in the prose of `vectors.detail`. Prose can be neither rechecked nor compared. `npm run spec:matrix` turns it into the generated [`SPEC-CARD-MATRIX.md`](../standards/SPEC-CARD-MATRIX.md), and it only makes deterministic connections:

| Connection | How it is decided | Source |
|---|---|---|
| entry → declared blocks | read straight from the card's `entries[].blocks.existing` | the three `SPEC-CARD.json` files |
| blocks → workspace | recurse the 60 workspace JSON files registered in `demos/tests.json` directly, then ask whether one workspace holds every block the entry declares | `demos/**/*.json` + `scripts/generate-spec-matrix.mjs` |
| blocks → executing procedure | the block really appears in a procedure body's block tree (containment, not name similarity) | same |
| card → frozen run | `spec-runs/<run-id>/manifest.json` lists the card path in `outputs` | `spec-runs/` |
| block existence | keyed by `BLOCK-IO-CONTRACT.json` | generated from the real block definitions |

`npm run spec:matrix:write` writes the file; `npm run spec:matrix` (now part of `verify:all`) regenerates it and compares byte for byte, so a hand edit fails immediately. The script carries seven negative controls: flip a `vectors.status`, inject a non-existent block, downgrade an A anchor to B, drop one demo, clear all procedures, clear the run manifests, invert a `composes` level — each must change the output, otherwise that connection counts as dead.

The gaps it currently surfaces (recorded, not smoothed over):

- the `cmac_subkeys` entry declares both `cmac_subkeys` and `cmac_double`, yet no registered workspace contains both — `cmac_double` is driven directly by `tests/unit/cmac-xts-primitives-contract.test.ts`, while the `CMAC_SUBKEYS` procedure in the demo uses the `cmac_subkeys` block;
- so that entry's workspace coverage reads "none" while its executing procedure still reads `CMAC_SUBKEYS`. This is exactly where the card's declaration granularity and the demo's workspace granularity disagree: adding a minimal workspace or changing the declaration is a human trade-off, not something the script may settle.

**What it cannot prove**: it does not judge whether an implementation matches the standard's semantics, whether a demo's expected value came from an official test set, or replace anchor sign-off. It answers only "was this executed, and where".

## 10. Next steps

1. ~~Add CCM (SP 800-38C) and XTS (SP 800-38E) cards under the same contract to test how much one snapshot carries~~ — done by `spec-runs/2026-11-13-ccm-xts-extract`, which wrote both cards in one run: 3 cards / 11 anchors / 10 entries / 0 errors. `spec:plan` now reports six `wire-vectors` gaps (the five CCM primitives plus `xts_tweak_mul`), which is the next wiring list;
2. ~~Wire official vectors into `cmac_subkeys` and move its `vectors.status` from `partial` to `wired`~~ — now wired through the `CMAC_SUBKEYS` procedure under `verify:demos`, with the subkeys independently recomputed by `cryptography`; the next step is a dedicated minimal workspace for it, or ACVP-level cases;
3. ~~Make the gates run `spec:validate` and `spec:runs` before writing candidates~~ — now built into `spec:scaffold` (see item 4 of §7.2). The first of the three verification layers landed as `spec:candidates` (see §7.3): shape, provenance drift, TypeScript syntax, contract conformance and dual-language **structural** parity, with 16 self-test controls. **Still missing** is dual-language **output** equivalence and execution of the card's anchored vectors on a candidate — both need the candidate inside the `src/` registration chain, as does `type-check`/`lint`. Until then the honest accounting is `parity=stub`, never "candidate verified";
4. ~~Work through the six `wire-vectors` gaps `spec:plan` reports: wire the five CCM primitives and `xts_tweak_mul` into minimal workspaces~~ — done by reusing `CCM-Encrypt.json` and `XTS-Encrypt.json` and adding six procedures (no new workspaces, so the Demo count does not cascade): the CCM B0 / AAD length prefix / counter block / CBC-MAC / CTR stages are checked with Example 1 parameters, and the XTS α doubling checks the high-bit carry. `spec:plan` now reports `cards=3 gaps=0`, and the blocks with no direct Demo reference dropped from 94 to 88. If an entry genuinely cannot be checked offline (e.g. IEEE 1619 vectors), state the reason in the card's `limits` instead of flipping its status to `wired`.
5. ~~Give `anchor_grade: A` a checkable PDF page record~~ — landed as `spec:anchors` (see §8): the `pdf_pages` of all 12 anchors are derived from the extraction's page breaks and confirmed by re-extracting the PDF, with all 11 controls firing. **Still missing** is semantic sign-off: all three cards have `provenance.review: draft`, so judgements about bit widths, endianness, `Rb` and the B0 bit fields still have no named cryptographic reviewer — no script can substitute for that layer.

---

See also: [AI helper research (design rationale for SpecCards and gates)](../research/AI-HELPER-RESEARCH-2026-11-13.md), [block I/O contract](../blocks/BLOCK-IO-CONTRACT.json), [structured entry specification](../standards/STRUCTURED-ENTRY-SCHEMA.md).
