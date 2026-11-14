# 产物格式（A 组：扁平 IR）

`output.json` 必须是 `ciphercat.block-ir/v0`：顶层两个键 `schema` 与 `entry`（顶层块数组）。
每个节点只允许这些键：`type`、`fields`、`extraState`、`inputs`、`next`、`inline`、`disabled`。
**没有 id，也没有 x/y 坐标** —— 组装器会自己补。
`inputs` 的值是节点本身（不是 `{"block": ...}` 包装）。

完整例子见 `refs/example.ir.json`（一个真实工作区：XTS-Encrypt，8 个块）。

## 不要做的事

- 不要读本目录之外的文件（这是评分实验，读了就没有意义）；
- 不要写注释、说明或额外文件，只写 `output.json`。
