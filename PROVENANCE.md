# Provenance

What this repository is, where it comes from, and how it relates to the published software.

## 1. Identity

| Item | Value |
|---|---|
| Software (this version) | MetaCrypto Online IDE |
| Published title | *MetaCrypto online: A model-driven visual development platform for cryptographic engineering* |
| Publication | *SoftwareX*, vol. 35, 102943, 2026 — <https://doi.org/10.1016/j.softx.2026.102943> |
| Repository | `P02-1010751281/MetaCrypto-Online-IDE` |
| Version | v2.0.0, tag `v2.0.0` |

## 2. Lineage

- This repository has its own root history. It is not a GitHub fork of the published article's code repository and carries no copy of that code.
- It contains the v2.0.0 update: the block core, both code generators (Python / JavaScript), and the standalone editor (web build plus optional Tauri desktop wrapper).
- The server components of the published version (Flask backend, MySQL, Redis) are not part of this repository. Opening an existing workspace does not require them.
- The full-stack companion platform, including the evaluation service, lives in a separate repository `metacrypt_server`. It receives the block core and both generators one way via `scripts/sync-to-metacrypt.sh` and does not modify that core.
- The lineage decision and the alternatives considered are recorded in `paper/softwarex-update-2026-10/REPOSITORY-LINEAGE-DECISION.md` (that directory is covered by `.gitignore` and must be committed with `git add -f`).

## 3. Team and rights

- This repository is maintained by the team that authored the published article.
- Author list, affiliations, corresponding author and support email come from the authors at submission time; this file does not restate them.
- Licence: GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later), matching C3 of the published article.

## 4. Reproducibility

- Every structural count quoted in the paper and the documentation was measured on the tree the tag points at; the rerun commands are in `.codestable/audits/2026-11-16-v2.0.0-freeze/README.md`.
- Export check: `git archive v2.0.0 | tar -x -C /tmp/v200 && cd /tmp/v200 && npm ci && npm run verify:all`.
