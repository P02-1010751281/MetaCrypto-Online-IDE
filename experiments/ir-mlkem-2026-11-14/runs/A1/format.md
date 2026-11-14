# 目标格式：扁平 IR（ciphercat.block-ir/v0）

```json
{ "schema": "ciphercat.block-ir/v0", "entry": [ <顶层块>, … ] }
```

- 每个块只有这些键：`type`（必填）、`fields`、`extraState`、`inputs`、`next`（可选）。
- `inputs` 的值**直接是子块节点**，不要 `{"block": …}` 包装。
- **不要** `id`、`x`、`y`。
- `fields` 是「字段名 → 值」对象：**值的 JSON 类型照抄 spec**——spec 写 `NUM=2` 就写数字 `2`，写 `NUM="2"` 才写字符串 `"2"`。
- 语句链用 `next`：**`next` 的值直接是下一块节点**（不是 `{"block": …}`）。链的最后一块不要 `next` 键。
- `extraState.params[].id` 与 `variables_get` 的 `fields.VAR.id` 是 spec 直接给出的**字段值**，必须照抄；它们不是块级 id。
- 样例：`refs/example.ir.json`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。
