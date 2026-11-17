# SHA-256 多分组试点工程（P4 A 线第一条纵向切片）

FIPS 180-4 的 SHA-256 摘要，用**仓库现有块**搭出的多文件 project。现有 60 个 demo 里
`SHA256-Hash.json` 只对**一个** 512-bit 分组调用一次 `hash_sha256_compress`（向量 `'abc'`）；
本工程补的是 §6.2.2 里 `For i=1 to N` 那段迭代，并用 Appendix B.2 的 448-bit 消息
（填充后 1024 bit = **两个**分组）作为向量。

## 文件与角色

| 文件 | 角色 | 块数 |
|---|---|---:|
| `algo.sha256.block.json` | procedure `SHA256_Multiblock(msg)`：`hash_sha256_pad` 填充 → `data_bit_length`/`math_floor` 算分组数 → `ctrl_iterate` 里 `pq_bytes_slice` 切 64 字节 → `hash_sha256_compress` 迭代链状态 → 返回 8 个 32-bit 字 | 28 |
| `main.block.json` | entry（顶层演示）：B.2 的消息字面量 → 调用 `SHA256_Multiblock` → `digest` 变量 | 5 |
| `sha256-multiblock.project.json` | `ProjectRecord`：`files[]` 里是上面两个负载的字符串，`entryFileId = file-main`，覆盖报告与锚点在 `metadata.aiHelper`（**不进** `files[]`） | — |

`entryFileId` 决定生成顺序与「原语只注入一次」：`algo` 先出、`main` 最后出。

## 生成的代码形状（节选）

```python
for i in range(blocks):
    offset = i * 64
    state = sha256_compress(state, bytes_slice(padded, offset, (offset + 64)))
```

```javascript
for (let i = 0; i < blocks; i++) {
  offset = i * 64;
  state = sha256Compress(state, bytesSlice(padded, offset, (offset + 64)));
}
```

## 复现（仓库根执行）

```bash
node scripts/p4-anchors.mjs                                   # 第 1 段：锚点 → ../anchors.json
AIVERIFY_ENTRY=scripts/p4-verdicts.ts AIVERIFY_OUTDIR=dist-verify/p4-verdicts \
  npx vite build --config vite.verify.config.ts
node dist-verify/p4-verdicts/p4-verdicts.js                   # 第 2 段：三档 → ../verdicts.json
python3 experiments/ai-helper-2026-11-14/p4/build-project.py   # 第 3 段：重新生成本目录
AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/p4-project \
  npx vite build --config vite.verify.config.ts
node dist-verify/p4-project/verify-project.js \
  experiments/ai-helper-2026-11-14/p4/project/sha256-multiblock.project.json \
  --exec --out experiments/ai-helper-2026-11-14/p4/verify-project-readings.json   # 第 4 段
```

> 重建是确定性的：块 id 按构建顺序编号、构建时间固定，重复跑 `build-project.py` 得到字节相同的三个 JSON
> （已用 `sha256sum -c` 验过）。

期望：`=== PROJECT VECTOR PASS (248d6a61…19db06c1) ===`，Python 与 JS 各一行 PASS，
外加单分组阴性对照（必须 ≠ 官方向量）两行 PASS。

## 这个工程不证明什么

- 不证明块与 FIPS 180-4 伪代码逐行等价（`semantic_equivalence: unverified`）。
- 不证明 SHA-256 标准符合性或产品认证（`PRODUCT-CERTIFICATION-FEASIBILITY.md` 明确整体不是认证对象）。
- 摘要的**字节序格式化**不在画布上：8 个 32-bit 字 → 32 字节大端打包没有对应块，由验证 driver 完成
  （见 `metadata.aiHelper.tests.formattingGap`）。
- 只覆盖这一条向量（两分组）；百万分组（B.3）没有跑。
