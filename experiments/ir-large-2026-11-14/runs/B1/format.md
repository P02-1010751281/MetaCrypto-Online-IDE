# 目标格式：Blockly 工作区 JSON

```json
{ "blocks": { "languageVersion": 0, "blocks": [ <顶层块>, … ] } }
```

- 每个块：`type`（必填）、`id`（必填，**全工作区唯一**）、`fields`、`extraState`、`inputs`、`next`。
- `inputs` 的每个值必须是 `{ "block": <子块> }` 包装；`next` 同样。
- `id`：任意非空字符串，但**不得重复**（218 个块 = 218 个不同 id）。
- `x`/`y`：只给**顶层**块（任意数字），嵌套块**不要**带坐标。
- `extraState.params[].id` 与 `variables_get` 的 `fields.VAR.id` 是 spec 直接给出的**字段值**，必须照抄；它们不算块 id。
- 样例：`refs/example.workspace.json`（CMAC 的两条过程，7 块；仅示范格式，不是任务）。
