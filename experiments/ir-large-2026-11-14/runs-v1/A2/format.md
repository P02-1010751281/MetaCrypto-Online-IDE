# 目标格式：扁平 IR（ciphercat.block-ir/v0）

```json
{ "schema": "ciphercat.block-ir/v0", "entry": [ <顶层块>, … ] }
```

- 每个块只有这些键：`type`（必填）、`fields`、`extraState`、`inputs`、`next`（可选）。
- `inputs` 的值**直接是子块节点**，不要 `{"block": …}` 包装。
- **不要** `id`、`x`、`y`。
- `fields` 是「字段名 → 字符串」对象；数字型字面量也写成字符串。
- 语句链用 `next`（对象，直接是下一块节点）。
- 样例：`refs/example.ir.json`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。

**校验**：产物会被 `scripts/lib/block-ir.mjs` 的 schema 与契约校验读取。
