# 规格卡（SpecCard）：把「标准说了什么」变成可机器复核的断言

**适用范围**：`docs/standards/<标准目录>/SPEC-CARD.json` 与门禁 `npm run spec:validate`。
**状态**：v0 骨架 + 首例（SP 800-38B CMAC）。它不生成代码、不改标准文档，只固化证据与接口映射。

## 1. 为什么需要它

把标准或论文转成积木与生成器时，最容易出的错不是「不会写算法」，而是三类无法靠读代码发现的错：

1. **锚点编造**：声称「§6.1 写着 K1 = L << 1」，但原文位置是模型编的；
2. **常量幻觉**：S 盒、轮常量、Rb 之类被「补全」成看起来合理但错误的值；
3. **接口漂移**：卡上写的块名或端口类型在仓库里不存在，下游照着做才发现。

这三类错都有共同点：**可以离线、确定性地复核**。SpecCard 就是把这些事实抽出来，让脚本重算，而不是让人或模型自述「我已经核对过」。

## 2. 卡片长什么样

字段契约在 [`scripts/spec-card.schema.json`](../../scripts/spec-card.schema.json)（JSON Schema 2020-12）。最小骨架：

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

卡片放在对应标准目录里（`dir: "."`），好处是锚点、PDF 与拆分页就在同一目录，路径不会漂。标准目录多一个 JSON 不影响 `standards:check`（它只要求 `.pdf`/`.txt` 登记进 manifest）。

## 3. 门禁重算什么（卡片自己说的不算）

`node scripts/check-spec-cards.mjs`（`npm run spec:validate`）：

| 检查 | 规则 | 失败示例 |
|---|---|---|
| 制品哈希 | `standard.artifacts[].sha256` 与磁盘文件逐字节一致 | PDF 换版后哈希变 |
| 引文锚点 | `quote` 规范化空白后必须真的出现在 `source` 的 `line_range` 内 | 行号漂移、引文被改写 |
| 引文摘要 | `quote_sha256` = 规范化引文的 SHA-256 | 有人只改引文不改哈希 |
| 块存在性 | `entries[].blocks.existing` 必须是 `docs/blocks/BLOCK-IO-CONTRACT.json` 里的真实块 | 写了 `cmac_not_a_real_block` |
| 类型标签 | 端口 `type` 必须是契约里实际出现过的 check 标签（或 `Any`） | 自造 `ByteArray` |
| 结构化 | 按 schema 严格校验；未声明的字段直接报错 | 加了 schema 没有的键 |

还有两条纪律：

- **`fidelity` 三档**：`verbatim`（与锚点引文逐字一致）、`text-layer`（与文本层一致，但文本层本身有已知失真，必须列 `known_defects`）、`paraphrase`（项目改写，只能当导航，不能进证据层）。前两档要求 `text` 与锚点引文规范化后完全相等。
- **`anchor_grade` 阶梯**：`A` = 行级引文可复核 **且** PDF 物理页已人工核对（所以 A 必须给 `pdf_pages`）；`B` = 行级引文可复核但 PDF 页未核；`C` = 仅章节级定位。

门禁每轮都会跑**负控自检**：对首张卡做 8 种变异（改引文、改哈希、越界行号、把 B 标成 A、改制品哈希、verbatim 文本不符、写不存在的块、reviewed 却没签核人），每一种都必须让门禁变红。自检不过即视为门禁失效——自己不能开火的门禁不算门禁。

```
$ npm run spec:validate
SPEC_CARD_SELFTEST controls=8 fired=8
SPEC_CARD_SUMMARY cards=1 anchors=2 entries=2 artifacts=1 errors=0
```

## 4. 首例：SP 800-38B CMAC

[`docs/standards/sp800-38b-cmac/SPEC-CARD.json`](../standards/sp800-38b-cmac/SPEC-CARD.json) 固化了 §6.1 子密钥生成与 §6.2 MAC 生成两块：2 个锚点（行 586–592、636–644）、2 个条目、1 个制品哈希，条目分别映射到 `cmac_subkeys`/`cmac_double` 与 `cmac_mac`。

它同时示范了**不装懂**：

- 两个锚点都是 `fidelity: text-layer` 且带 `known_defects`：提取稿把 `CIPH_K(0^b)` 拉平成 `CIPHK(0b)`，把 `n = ⌈Mlen/b⌉` 的 ceiling 括号丢了，还把脚注号混进正文；
- `Rb = 0x87` 没有逐字锚点（文本层把 `R128` 渲染成 `012010000111`），因此写进 `open_questions` 而不是硬凑一个；
- `vectors.status: missing`：`demos/tests.json` 里没有 CMAC 条目，官方示例向量尚未接入回归；
- `review.status: draft`：语义（位宽、端序、Rb 取值）还没有具名密码学审阅者签核。

## 5. 它不能用来声称什么

- 不能声称「AI 已核对标准」——门禁只复核**卡片写下的字**，不复核人对规范的理解；
- 不能声称「实现符合标准」或「通过认证」——卡片里连 KAT 都还是 `missing`；
- `anchor_grade: C` 只是定位，不是引文证据；`fidelity: paraphrase` 只是导航，不能当原文；
- 卡片不替代 `docs/standards` 的条目元数据表，也不替代 `verify:all` 的向量回归。

## 6. 下一步

1. 给 CMAC 补官方向量并接进 `demos/tests.json`，把 `vectors.status` 从 `missing` 改成 `wired`；
2. 按同一契约补 CCM（SP 800-38C）与 XTS（SP 800-38E）两张卡，检验「一个快照能写几张」；
3. 让 `ai-draft-gate.sh` 在写候选文件前先跑 `spec:validate`，把「卡不成立就不产出候选」变成硬前提。

---

相关：[AI Helper 调研（SpecCard 与门禁的设计依据）](../research/AI-HELPER-RESEARCH-2026-11-13.md)、[积木 I/O 契约](../blocks/BLOCK-IO-CONTRACT.json)、[结构化条目规范](../standards/STRUCTURED-ENTRY-SCHEMA.md)。
