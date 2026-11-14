# 产物格式（B 组：Blockly 工作区序列化）

`output.json` 必须是 Blockly 工作区 JSON：`{"blocks": {"languageVersion": 0, "blocks": [...]}}`。
每个块需要 `type`、**全局唯一** `id`、`x`/`y` 坐标；可选 `fields`、`extraState`、`next`。
输入槽的值是 `{"block": ...}` 包装，`next` 也是 `{"block": ...}` 包装。

完整例子见 `refs/example.workspace.json`（同一个真实工作区，注意每个块都有 id 和坐标）。

## 不要做的事

- 不要读本目录之外的文件（这是评分实验，读了就没有意义）；
- 不要写注释、说明或额外文件，只写 `output.json`。
