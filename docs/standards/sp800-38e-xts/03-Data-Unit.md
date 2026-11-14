# XTS — 数据单元与 ciphertext stealing 边界

## 条目元数据

| 字段 | 内容 |
|---|---|
| 类型 | 原语 / 函数 |
| 标准定位 | XTS — 数据单元与 ciphertext stealing 边界 |
| 原文证据 | [source 提取稿](./00-Standard-Source.md)（本目录 PDF 清单见 source 页） |
| 原文位置 | [提取稿 §5.1–§5.2，行 266–298](./00-Standard-Source.md#L266-L298)；PDF 物理页需结合同目录 PDF 核对 |
| 项目状态 | 已映射为 `xts_encrypt`（16 字节至 16 MiB，含 ciphertext stealing；无解密块） |

## 原文定位与引用

> 本页按 source 中的“XTS — 数据单元与 ciphertext stealing 边界”拆分；这是定位说明，不替代标准逐字引文。完整正文、公式和表格请回看 [source 提取稿](./00-Standard-Source.md) 与同目录 PDF。

## 原文摘录

> 本页正文是按 source 的“XTS — 数据单元与 ciphertext stealing 边界”拆出的结构化说明；该定位是概览/组合页，未强行截取不唯一的行号。需要核对时请按 [source 提取稿](./00-Standard-Source.md) 的章节标题和同目录 PDF 查看原文。

原件：[NIST SP 800-38E PDF](./NIST.SP.800-38E.pdf)。

## 公式或伪代码

> 以下是面向用户的结构化公式/伪代码摘要，不是标准原文的完整逐字摘录；完整规范单元请以本页“原文摘录”、source 提取稿和 PDF 为准。

### 整块路径

密钥为 `K1||K2`，每个数据块计算：

```text
Ci = AES_K1(Pi xor Ti) xor Ti
```

XTS 不提供认证，数据单元号/扇区号和密钥轮换由调用方管理。

### 项目状态

`xts_encrypt` 要求数据单元 16 字节至 16 MiB，并拒绝两半相同的 `K1‖K2`；末尾部分块由
ciphertext stealing 处理，因此非 16 字节倍数（17/31/47 字节）是受支持输入而非拒绝输入。
缺项是解密方向、tweak/数据单元号的管理与存储协议约束，以及其它数据单元长度的覆盖。
