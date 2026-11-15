# 提案：把 `data_value` 拆成类型化字面量块（**已降级为备选，见下方状态**）

> **状态更新（2026-11-15）**：本提案的方案 A（拆 4 个字面量块）**暂不实施**。追查后发现 123 条 unknown 的根因不在块粒度，而在
> ① 检查器缺少「字面量形状 × 槽位类型」的判定规则；
> ② 更深一层：数组没有可构造/可编辑/可填充的形态（详见 `TYPE-SYSTEM-ARRAY-MATRIX.md`）。
> 方案 A 的迁移规则是「按父槽 check 分配」，等价于把上下文已经给出的信息抄进工作区，代价却是 221→225 块 + 356 处 demo 改写 + 契约再生成 + 回译等价类手术。
> 保留本文件作为对照与历史记录；当前建议见 `TYPE-SYSTEM-ARRAY-MATRIX.md` §6 的 R1–R8。

日期：2026-11-15　状态：**备选方案，未实施**　实施会动的文件见 §5

## 1. 事实：它为什么存在

`src/blocks/data/number.ts:22` 是 `this.setOutput(true, null)`，注释写明「接受任意文本值——数字、表达式、数组字面量，生成器原样透传，不做数值转换和引号包裹」。生成器（Python/JS 各一份）确实**逐字透传** `NUM`：

```ts
const raw = block.getFieldValue('NUM');
return [raw, Order.ATOMIC];   // 合法数字走数字字面量，其它原样输出
```

它还承担旧工程兼容：`src/utils/migration.ts` 把 `math_number` / `crypto_number` / `crypto_get_text` 都映射到 `data_value`。

## 2. 实测用法（60 个 demo、34 个文件、585 个实例）

| 值形状 | 数量 | 说明 |
|---|---:|---|
| 纯整数 | 455 | 长度/下标/常量（`32`、`64`、`0`、`768`…） |
| 一维数组字面量 | 108 | `[0x00,0x11,…]` 字节串与 4×32 位状态 |
| 空数组 `[]` | 8 | 多项式初值 |
| 带引号字符串 | 17 | 文本/十六进制串 |
| 十六进制字面量 | 1 | `0xF12186F9` |
| 表达式 / 多维数组 | **0** | 当前无实际使用 |

结论：「为兼容性」成立；「为数列」成立（116 个数组）；**「为多维矩阵」不成立**（0 例，只是透传能力允许它）。

## 3. 现在为什么仍是 unknown

两个检查器（`scripts/ai-helper-typecheck.ts:178`、`src/services/ai-helper/typecheck.ts:146`）已经对纯数字字面量推断 `Number`，并对数组/字符串**故意保持 unknown**，注释写明「`[...]` 可能是 IntList 也可能是 Bytes，猜错会制造假报」。

于是 135 条 unknown 正好可拆：

| 来源 | 数量 |
|---|---:|
| `data_value` 数组/字符串/十六进制（形状有歧义） | **123** |
| `variables_get`（未绑定） | 12 |

而 123 条**全部有父槽 check 可消歧**：

| 父槽 check | 实例 | 值形状 |
|---|---:|---|
| Number | 234 | 整数 233 + 十六进制 1 |
| Bytes | 84 | 数组 78 + 十六进制串 6 |
| IntList | 27 | 数组 27 |
| String | 11 | 字符串 11 |

父槽**没有声明 check** 的 227 个实例里，有歧义的只有 **11 个**（`variables_set.VALUE` 6、`hash_sha256_pad.INPUT` 2、`hash_sha256_compress.V` 2、`hash_sm3_compress.V` 1）。

## 4. 三个方案

### 方案 A（推荐）：分型 + 保留逃逸口

新增 4 个类型化字面量块，`data_value` 保留为「原始表达式」：

| 新块 | outputCheck | 迁移来源 |
|---|---|---|
| `data_number` | `Number` | 父槽 Number（234）+ 可选的 222 个无 check 整数 |
| `data_bytes` | `Bytes` | 父槽 Bytes（84） |
| `data_int_list` | `IntList` | 父槽 IntList（27） |
| `data_text` | `String` | 父槽 String（11） |

- 生成器：4 个块复用同一份「透传」实现，**生成代码逐字不变**。
- 迁移依据是**父槽 check**（契约已有信息），不是猜形状；11 个无 check 的歧义实例保持 `data_value`。
- 预期：unknown **135 → 12**（只剩 variables_get），未知率 10.9% → 1.0%；契约里 4 个新块有真实 `outputCheck`。
- 代价：块 221→225；4 块 × 2 生成器；toolbox + i18n；契约重生成；34 个 demo 文件、356 个实例改写；模板 1 处；旧工程靠 `data_value` 继续可读。

### 方案 B：单块加 `KIND` 下拉

`data_value` 加字段 `KIND = auto|number|bytes|int_list|text`，输出类型动态；检查器读字段判定。
- 优点：块数不变，toolbox 不变，迁移只是加字段。
- 缺点：契约无法表达动态输出（`outputCheck` 仍是 null），判定口径要在检查器里维护第二张真值表，与「契约是单一真值」的架构冲突。
- 预期收益同 A（同样按父槽 check 迁移），但契约侧看不出类型。

### 方案 C：维持现状

- 优点：零风险，透传能力保留。
- 缺点：B 线校验器永远有 123 条 unknown（10.9%），且这些恰好是数组/字符串这类最常见的数据字面量。

**推荐 A**。理由：契约保持单一真值；新块有真实 `outputCheck`；生成代码不变；逃逸口（`W[j]`、切片表达式）保留。

## 5. 方案 A 的改动清单与验收

实施改动：
- `src/blocks/data/number.ts`：新增 4 块，`data_value` 保留（改标签为「原始表达式」并移出主工具箱或单列「高级」）。
- 生成器 Python/JS：4 块注册同一实现。
- `docs/blocks/BLOCK-IO-CONTRACT.json`：`npm run block-io:write` 重生成（221→225）。
- demo 迁移：按父槽 check 改写 356 个实例（脚本一次性执行，含 11 个保留项）。
- `scripts/ai-helper-reverse.ts` / `roundtrip.ts`：反解析目前把所有字面量统一产出 `data_value`，roundtrip 已有等价类（`data_value ⇄ math_number`），需把 4 个新块并入同一等价类，否则 60/60 tree_equal 会破。
- 旧工程：`data_value` 仍在注册表，加载不受影响；可选迁移把能判定的实例换型。

验收（全部实跑）：
1. `verify:demos` 60/60（生成代码逐字不变）。
2. `typecheck` unknown 135 → **12**，mismatch 保持 0。
3. `roundtrip` 60/60 tree_equal（等价类更新后）。
4. `contract:check` 无漂移；`lint`/`type-check`/`vitest` 全绿。
5. 若 2 不成立，按实际值回写并说明差在哪。

## 6. 待裁项

1. 走 A / B / C 哪个。
2. 是否允许改写 34 个 demo 文件（356 个实例）。
3. 222 个「无 check 槽位里的整数」是否也迁到 `data_number`（不影响 unknown，只影响一致性）。
