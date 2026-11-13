# SpecCards: turning "what the standard says" into machine-checkable assertions

**Scope**: `docs/standards/<standard-dir>/SPEC-CARD.json` and the `npm run spec:validate` gate.
**Status**: v0 skeleton plus one worked example (SP 800-38B CMAC). It generates no code and edits no standard page; it only fixes evidence and interface mappings.

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
  "anchors": [{ "id": "A1-...", "source": "00-Standard-Source.md", "line_range": [586, 592], "quote": "...", "quote_sha256": "<64 hex>", "anchor_grade": "B", "extractor": { "tool": "pdftotext", "version": "..." } }],
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
| Structure | strict schema validation; undeclared fields are rejected | keys the schema does not know |

Two more rules:

- **`fidelity` in three tiers**: `verbatim` (identical to the anchor quote), `text-layer` (identical to the text layer, which itself has known defects, so `known_defects` is mandatory), `paraphrase` (a project rewrite, navigation only, never evidence). The first two require `text` to equal the anchor quote after normalisation.
- **`anchor_grade` ladder**: `A` = line-level quote verified **and** the PDF physical page checked by a human (hence `pdf_pages` is required); `B` = line-level quote verified, PDF page unchecked; `C` = section-level location only.

Every run also executes **negative-control self-test**: eight mutations of the first card (edit a quote, edit a digest, out-of-range lines, relabel B as A, edit the artifact hash, verbatim text mismatch, unknown block, reviewed without a reviewer). Each must turn the gate red. If the self-test fails, the gate is considered broken — a gate that cannot fire is not a gate.

```
$ npm run spec:validate
SPEC_CARD_SELFTEST controls=8 fired=8
SPEC_CARD_SUMMARY cards=1 anchors=2 entries=2 artifacts=1 errors=0
```

## 4. The first card: SP 800-38B CMAC

[`docs/standards/sp800-38b-cmac/SPEC-CARD.json`](../standards/sp800-38b-cmac/SPEC-CARD.json) fixes §6.1 subkey generation and §6.2 MAC generation: two anchors (lines 586–592 and 636–644), two entries and one artifact hash, with the entries mapped to `cmac_subkeys`/`cmac_double` and to `cmac_mac`.

It equally demonstrates **not pretending to know**:

- both anchors use `fidelity: text-layer` and carry `known_defects`: the extraction flattens `CIPH_K(0^b)` to `CIPHK(0b)`, drops the ceiling brackets in `n = ⌈Mlen/b⌉`, and mixes a footnote digit into the body;
- `Rb = 0x87` has no verbatim anchor (the text layer renders `R128` as `012010000111`), so it is recorded under `open_questions` instead of being forced;
- `vectors.status: missing`: `demos/tests.json` has no CMAC entry and the official example vectors are not wired into regression;
- `review.status: draft`: the semantics (bit widths, byte order, Rb value) have no named cryptographic reviewer sign-off yet.

## 5. What it must not be used to claim

- Not "the AI verified the standard": the gate re-checks the words written on the card, not a human's understanding of the specification;
- Not "the implementation conforms" or "certified": even the KAT status is still `missing`;
- `anchor_grade: C` is a location, not quote evidence; `fidelity: paraphrase` is navigation, not source text;
- A card neither replaces the entry metadata tables under `docs/standards` nor the vector regression in `verify:all`.

## 6. Next steps

1. Wire the official CMAC vectors into `demos/tests.json` and move `vectors.status` from `missing` to `wired`;
2. Add CCM (SP 800-38C) and XTS (SP 800-38E) cards under the same contract to test how much one snapshot carries;
3. Make `ai-draft-gate.sh` run `spec:validate` before writing candidates, so "no valid card, no candidates" becomes a hard precondition.

---

See also: [AI helper research (design rationale for SpecCards and gates)](../research/AI-HELPER-RESEARCH-2026-11-13.md), [block I/O contract](../blocks/BLOCK-IO-CONTRACT.json), [structured entry specification](../standards/STRUCTURED-ENTRY-SCHEMA.md).
