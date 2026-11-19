# AI assistant: document search, answer evidence, and model-assisted sentence picking with your own key

The AI assistant in MetaCrypto Online IDE is a local-first search tool: repository docs, standard PDF page text and block metadata are indexed at build time, and queries run in the browser to return an answer with evidence; no network and no model are required. Model-assisted sentence picking is an optional enhancement: it is off by default, the provider and key are supplied by the user, and the model may only pick among candidate sentences — it cannot rewrite a sentence, add content or replace the evidence.

This page describes the current behaviour of four entry points: **Q&A assistant** in the sidebar (doc search / block search), **Start from a file**, the fourth panel in the left activity bar (the A/B single entry), and the two panels it routes to — **Generate workspace from code** (also available directly from the **More** menu) and **Standards → workspace** (preview + human sign-off). Evaluation readings (recall@5, eval-set pass rates) are not usage instructions; see the [feasibility research](../research/AI-HELPER-RESEARCH-2026-11-13.md) and the records under `experiments/ai-helper-2026-11-14/`.

## 1. Entry points and boundaries

| Entry | Location | Purpose |
|---|---|---|
| Q&A assistant | Assistant icon in the left activity bar; click again to return to the **Files** panel | Doc search and block search share one panel with two tabs |
| Start from a file | Fourth icon in the left activity bar (the A/B single entry) | Pick a file or paste content, decide whether it belongs to line A (documents) or line B (code), and route to that panel; the decision comes with its evidence and can be changed |
| Generate workspace from code | Reached by routing from the single entry (the same item is in the **More** menu) | Reverse-parse pasted or selected code into a block workspace |
| Standards → workspace | Reached by routing from the single entry (preview + human sign-off) | Shows three-tier verdicts, gaps and source anchors per standard slice, records a per-clause sign-off, and opens that slice's pilot project; generates no workspace |

Detection only **pre-fills** the choice; it never locks it: a clear extension decides by extension, a missing or conflicting extension decides by content signals (imports, function definitions, `#include` versus chapter/clause structure, appendices, standard numbers, formulas), and when neither holds the panel says "cannot tell" and asks the user to pick with the switch. After an override the panel marks it as **changed by you**, so the machine's judgement and the user's choice stay distinguishable.

Three boundaries come first:

1. **Search and answers stay offline.** The doc index, PDF page index and block index are build-time artifacts shipped with the app; queries run in the browser and send no request.
2. **The answer layer is extractive.** Every answer sentence quotes the source verbatim and carries a line number; the card is labelled "extracted from source, each sentence links back (no generative model)". It works with the model switched off.
3. **The model only picks sentences.** With the toggle on, the question and at most five candidate sentences (all from the same best section) go to the provider the user configured; the reply must still pass reference-integrity checks, and anything out of range is discarded while the retrieval answer and evidence stay on screen.

## 2. Doc search

### 2.1 Input and search scope

Type one sentence into **Doc search** (for example "which steps does one block cipher round contain"); search starts about 120 ms after typing stops and returns at most 12 hits. Query terms are expanded through the glossary (synonyms, English abbreviations and Chinese names), and each hit lists the matched terms.

The **Include standard PDFs** checkbox on the query row controls the search scope:

- unchecked: only Markdown body text under `docs/**/*.md`;
- checked: the standard PDF page index is searched as well, and hits carry a `PDF` marker and a page number;
- PDF originals are third-party standards and are not bundled, so a PDF hit never opens a file; it only reports "path + page".

When the PDF index is missing (for example `npm run docs:index:pdf` was never run), the panel degrades to Markdown-only search and says so in the status line instead of silently searching less.

### 2.2 Result list and keyboard

Each hit shows a kind marker (`MD` / `PDF`), the document title, the section heading, `path:line` (a page number for PDFs) and an excerpt. One document contributes only its highest-scoring section, so clicking a hit lands on that line.

| Key | Action |
|---|---|
| `↑` / `↓` | Move the selection between hits |
| `Enter` | Open the selected hit |
| `Esc` | Close the panel |

A Markdown hit opens the documentation centre in a new tab at that line; when the browser blocks the new window, the app navigates the current page instead. A PDF hit copies `path#page=N` to the clipboard and shows a notice in the corner, so the user can open it inside the repository.

**Browse all docs** at the bottom of the panel enters the documentation centre with the current query (`/docs?q=…`) to keep looking across the whole tree.

### 2.3 The answer card: answer and evidence

When there are hits, an answer card appears above the result list, titled **Answer** and labelled "extracted from source, each sentence links back (no generative model)":

- the answer is taken only from the highest-scoring section, in source order, without rewriting or concatenation;
- every sentence carries a `[n]` index and is verbatim source text with Markdown markers stripped;
- **Evidence `path:line`** is clickable and opens that exact source line;
- **Coverage N%** is the share of question terms present in the selected sentences, which shows how much of the question the answer actually covers;
- a PDF hit has no body text to split into sentences, so it only provides a page excerpt, explicitly tagged "PDF page excerpt".

### 2.4 When there is no answer

When the corpus holds no section that directly supports an answer, the card does not pass off "the nearest section" as an answer:

1. it states "no evidence was found that directly answers this";
2. it lists the missing question terms (up to six, `missing: …`);
3. it points at the nearest related sections below for the user to check.

This rule is why the result list below always stays: no direct answer does not mean no relevant material.

## 3. Block search

**Block search** maps a natural-language description to block types that can be dragged onto the canvas:

- type one sentence describing the job, or use structured filters only;
- **Filters** is collapsed by default; expanding it selects an input type and/or an output type (`Bytes`, `IntList`, `Bits`, `Number`, `String`, `Boolean`, `SBox`);
- each hit shows the block label, the block type identifier, its output types and why it matched;
- clicking a hit or pressing `Enter` inserts that block into the visible canvas area (starting 40 px from the top-left of the viewport, offset by 24 px per consecutive insert so blocks do not stack); `↑` / `↓` moves the selection and `Esc` closes the panel.

**Find docs** on each hit asks the opposite question — how the documentation describes this block. Most of these blocks are shared mathematical primitives with no dedicated page, so an empty result is an answer too.

## 4. Cross-tab links

Both tabs feed each other:

| Direction | Appears when | Behaviour |
|---|---|---|
| Docs → blocks | The hit's content derives identifiers present in the block vocabulary | A **Find blocks** button switches to the block tab with the derived query |
| Blocks → docs | Always | A **Find docs** button switches to the doc tab with a block-related query |

A link only applies the next time the opposite tab is shown; clicking a tab yourself clears the query carried over from the previous link and returns to a clean input.

## 5. Generate workspace from code

The **Generate workspace from code** panel is the entry point of line B (reference implementation → workspace): it no longer has its own activity-bar icon and is reached by routing from **Start from a file** once the content is judged code (the **More** menu still opens it directly). It is not the same path as **Import workspace**: importing loads an existing workspace file, while this reverse-parses code into a new workspace. Like the other panels, it is a mutually exclusive panel: it docks in the left column (460px wide) and leaves the canvas visible and usable; on narrow screens the column collapses into a top strip and the panel appears as an overlay.

The order is fixed: parse, review diagnostics, load. Each step can stop:

1. **Input**: paste code, or read a file with **Choose file** (2 MB limit; larger files are rejected);
2. **Parse**: produces workspace state and diagnostics only, without touching the canvas;
3. **Review**: every diagnostic is tagged "unrecognised" or "possibly different semantics"; up to 20 are listed and the heading gives the total;
4. **Load**: **Load workspace** is an explicit action, and the note next to it states how many blocks on the current canvas will be replaced and that this cannot be undone.

Two recognition paths:

| Source shape | Path | Notes |
|---|---|---|
| Python generated by this platform | Template matching | Rebuilds statements in the shape the generators emit |
| Other Python | Standard-library syntax tree (AST) | Structure only; parameter types fall back to `bytes`; nodes that cannot be converted are warned about separately |

JavaScript and C/C++ reference implementations are not supported: code judged to be JavaScript is reported as "no blocks will be loaded" instead of listing per-line noise, and when functions are recognised but neither path can assemble blocks, the dialog refuses to produce a half-built workspace and lists the recognised function names.

The syntax-tree parser is the Pyodide Python runtime inside the browser (about 12 MB), bundled with the app at the same origin (`public/pyodide/`), loaded on the first parse and reused afterwards; it depends on no external CDN, and a load or parse failure reports the reason as-is (missing assets, or the 45-second parse timeout).

## 6. Standards → workspace (preview + human sign-off)

The entry point of line A (standard text → workspace) is reached by routing from the single entry once the content is judged a document; it pre-fills no specific standard, because line A only covers standards and papers registered in the repository. It lays out "standard slices → clause units → three tiers" for a person to read and **generates no workspace**; next to the tiers it records a **human sign-off**: who signed or rejected which clause, when, with an optional note, and the verdict fingerprint at that moment.

| View | What it answers |
|---|---|
| Standard slices | Verdicts for three slices today: NIST FIPS 180-4 (SHA-2), NIST SP 800-38B (CMAC) and NIST SP 800-38C (CCM) |
| Clause units | Clauses split out of entry pages, with their standard position and step count |
| Three tiers | Buildable / partial / not buildable — whether a clause's steps can be assembled from canvas blocks |
| Gaps and claim boundaries | Which steps live only inside generator closures, and which parameter ranges the block model does not express |
| Source anchors | Every anchor carries a line range; clicking it opens the doc centre at that line |
| Pilot project | The same slice actually assembled from existing blocks as a multi-file project (SHA-2 33 blocks / CMAC 41 / CCM 113), driven by official vectors |

Three qualifiers must be read together with the tiers:

1. The tiers are **build-time machine candidates**: `scripts/p4-*` produce the verdict JSON and `scripts/build-verdicts-index.mjs` merges it into `src/services/ai-helper/verdicts-index.json` (regenerated before every build);
2. **Semantic equivalence is always unverified** (`semantic_equivalence = unverified`): a tier says whether steps can be assembled, never that an implementation matches the standard;
3. **Sign-off stays with a person**: the panel header shows signed / rejected / pending counts, and each clause lets a person record a name, a note and either a sign-off or a rejection. A record is bound to the verdict fingerprint at that moment (step text, gaps, anchor line ranges); when the artifact is regenerated and the clause changes, the old record is shown as **data changed, re-review required** instead of still counting as signed. Records live in browser storage only and can be exported as JSON carrying both the export-time and the record-time index fingerprints. There is no one-click generation.

Next to the tiers the panel also lists a **pilot project**: the same slice actually assembled from existing blocks as a multi-file project, with block totals and the file list taken from the artifact. "Open pilot project" only **copies an editable record** into this device's project list and jumps to the editor — the build artifact is untouched, and it is not "generate a workspace from the standard text". If this device already holds the same pilot, the panel first asks whether to replace it or open the existing one (replacing discards those edits). The pilot itself is still a machine-candidate demo, not a proof of conformance.

After changing a verdict JSON or a pilot project, rerun `npm run verdicts:index` (`verdicts:index:check` only compares): the index and `src/services/ai-helper/pilot-projects/*.json` are regenerated together, and a stale artifact is named in the error. The source JSON must be committed, otherwise the script refuses to generate — the artifact has to be reproducible.

## 7. Let the model pick sentences (bring your own key)

### 7.1 Off by default

**Let the model pick sentences** is off by default. While it is unchecked the app sends no external request and needs no key; switching it on without a configuration shows "Model not configured" and opens the settings dialog immediately.

### 7.2 Configuration

The **Model settings (bring your own key)** dialog has three required fields, an optional unit-price group and one risk notice:

| Field | Validation |
|---|---|
| Base URL | Must be `https://` on any host, or `http://127.0.0.1` / `localhost` on this machine; plain http on any other host is rejected |
| Model id | Required |
| API key | Required; sent only in a request header |

The unit price is optional and turns this call's tokens into an amount: state it **per million tokens**, input and output separately (their ratio is often 3–5×); leave the output price blank to reuse the input price, and leave the currency blank for `USD`. The repository keeps no price list — prices differ per provider, model and month, so a built-in table would only go stale; you enter the price from your own bill. Leave it blank and no cost is shown: a blank price is not the same as free.

The repository ships no default provider, default model or key: an empty configuration means "no model attached", not "use the default".

### 7.3 Where the key lives

| Tier | Written when | Lifetime |
|---|---|---|
| Session tier (default) | **Save** without ticking remember | Lost when the tab closes |
| Persistent tier | Tick **Remember**, then save | Written to `localStorage`, kept after the browser closes |

The two tiers are mutually exclusive: writing the persistent tier clears the session copy. **Clear** empties both tiers, turns the toggle off and resets the status line.

### 7.4 What one call does

| Item | Value |
|---|---|
| Protocol | OpenAI-compatible `chat/completions` (appended to the Base URL) |
| Payload | The user question plus at most five candidate sentences (each with id and source line); candidates come from the best section only |
| Sampling | `temperature: 0`, `stream: false`, output capped at 300 tokens by default (configurable) |
| Timeout | 20 s by default, actually aborted at the deadline |
| Retries | None; a failure is never re-sent automatically |

The key only travels in the `Authorization` header — never in the request body and never in error messages.

### 7.5 How the reply is checked and used

The model may pick sentences and may also write a short explanation; the two go through different gates because they do not carry the same evidentiary weight.

**Answer sentences** may only reference candidate ids and must return at most five picks. The reply passes reference-integrity checks, and each of the three violation classes gets its own message instead of a generic failure:

| Violation | Message |
|---|---|
| An id outside the candidates | the model picked a sentence outside the candidates (unknown id) |
| The same sentence picked twice | the model picked the same sentence more than once |
| More picks than allowed | the model picked more sentences than allowed |

**The explanation** (`notes`) is not evidence: the answer card shows it in its own block (left rule plus the "model note (not part of the answer evidence)" tag), and **every sentence must name its basis** — the candidate ids it rests on. A sentence that cannot be tied to a candidate id is **dropped whole** without failing the call: empty text, no support, a support id outside the candidates, a duplicate, or more than four sentences each cost only that one sentence, and the card shows a `−n` counter for how many were dropped (hovering gives the reasons). A well-written explanation never becomes evidence, and an unsupported one never discards the usable picks.

After the checks pass, the answer card shows only the selected sentences, and the evidence remains the `path:line` of that one section — picking sentences cannot make the evidence point at a different file. The status line reports the call: `model picked n sentence(s) · N tokens · M ms`, and appends `≈USD 0.00054` once a unit price is set (hovering states that it is an estimate and the provider bill is the authority). A verification failure or a declined answer keeps the same readout and cost and only adds a reason line — a failed call still costs money.

### 7.6 How failures are shown

Failures start with "Model call failed: " and name the cause: timeout (20 s), authentication failed (401), forbidden (403), quota or rate limited (429; no retry), the model did not return the required JSON, empty content, network error, incomplete configuration, or an unknown HTTP status.

A failure never swallows the answer: the retrieval result and its evidence stay on screen with one extra line explaining the cause. To try again, ask again — not retrying automatically is deliberate.

### 7.7 Risks and what is not done

- The key lives in browser storage: same-origin scripts and extensions can read it, and it may reach disk backups. By default it is kept for this tab only and lost when the tab closes.
- With the toggle on, the question and candidate sentence text go to the provider the user configured; how that data is handled depends on that provider.
- **The cost is an estimate, not a bill**: the amount is converted from the unit price you entered and the `usage` the provider returned, then rounded for display; cached-input pricing, reasoning-token surcharges and tiered prices are outside the model. When the provider returns no `usage` (or only a total without the input/output split) no cost is shown — the status line says "no usage" instead of pretending zero.
- Unit prices live in this machine's `localStorage` (they are not secrets); **Clear** removes the key and the configuration only, never the prices you entered.
- No real provider has been verified inside the repository (it ships no key); the existing acceptance run uses a local fake provider over real HTTP, crossing the CSP.

## 8. Index and corpus maintenance

| Command | Purpose |
|---|---|
| `npm run docs:index` | Rebuild the Markdown doc index (`docs/**/*.md`, dot-directories skipped) |
| `npm run docs:index:pdf` | Rebuild the standard PDF page index |
| `npm run docs:index:check` | Verify the index matches the current corpus |

Indexes are build-time artifacts tied to the documentation in the tree: after adding or editing docs the index must be rebuilt, otherwise search and answers keep working from the old corpus (`docs:index:check` reports the mismatch). Search itself touches no network or backend, but the two large indexes are not part of the first-load bundle: the Markdown index (about 4 MB) and the PDF page index (about 3.4 MB) are loaded on demand the first time that range is searched, while the block index (about 288 KB) ships with the panel.

## 9. Related documents

| Purpose | Document |
|---|---|
| Editor, projects and the overall code-generation path | [User guide](./USER-GUIDE.en.md) |
| Covered algorithm families and evidence boundaries | [Capability map](./CAPABILITY-MAP.en.md) |
| Research, design and evaluation readings for the AI assistant | [AI-HELPER-RESEARCH-2026-11-13](../research/AI-HELPER-RESEARCH-2026-11-13.md) |
| Mirroring relationship and mirrorable scope with the other repository | [Cross-repository alignment](./METACRYPT-SYNC.en.md) |
