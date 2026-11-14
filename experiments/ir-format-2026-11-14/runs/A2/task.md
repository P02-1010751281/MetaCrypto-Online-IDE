# 任务

把 NIST SP 800-38C（CCM）的 7 个条目实现为一个 Blockly 工作区。

必须恰好包含以下 7 个 `procedures_defreturn` 过程，`NAME` 分别为：

`CCM_Encrypt`、`CCM_B0`、`CCM_AAD_PREFIX`、`CCM_COUNTER_BLOCK`、`CCM_CBC_MAC`、`CCM_CTR`、`CCM_Decrypt`

每个过程无参数（`extraState.params` 为空数组、`hasStatements: false`），通过 `RETURN` 输入返回对应原语的结果。
只能使用 `blocks.md` 里列出的块类型，不要新增块，不要引用不存在的块。

卡片条目（含伪代码、端口与参数）见 `spec.json` 的 `entries` 字段；这是你要实现的标准义务。
参数请统一取 SP 800-38C 附录 C **Example 1**：K = 16 字节、N = 7 字节、A = 8 字节、P = 4 字节、Tlen = 4 位组。
`data_value` 块用 `NUM` 字段承载字面量（字节串写成 `[0x40,0x41,...]`，整数写成十进制）。

## 产物

把结果写成当前目录下的 `output.json`，除此之外不要写别的文件。格式见 `format.md`。
