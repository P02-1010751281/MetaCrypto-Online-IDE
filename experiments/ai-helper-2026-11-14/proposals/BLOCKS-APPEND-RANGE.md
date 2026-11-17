# 维护者线：新增 `arr_append` / `ctrl_range` 两个通用语句块

> 2026-11-17　状态：代码、测试、文档与契约已落盘并过门禁；**未提交**，未跑 `sync-to-metacrypt.sh`　依据：owner 批准的维护者线改动 + `blockly-conventions`、`blockly-atomic-block-addition` 的块注册/双生成器/契约/文档链条
> 命令均在仓库根 `Projects/CipherCat` 执行；标「读数」的是实跑输出，未实跑的项写「未做」。

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 新增块 | `arr_append`（语句，追加到列表末尾）、`ctrl_range`（语句，等价 Python `range(FROM, TO)`） |
| 契约 | `docs/blocks/BLOCK-IO-CONTRACT.json` 由 `npm run block-io:write` 重新生成：键数 **222 → 224**，两个新键都在 |
| 双生成器 | Python `LIST.append(VALUE)` / `for VAR in range(FROM, TO):`；JavaScript `LIST.push(VALUE);` / `for (let VAR = FROM; VAR < TO; VAR++)`；空体分别补 `pass` / 注释 |
| 标量钳位 | **没有新增块**：原生 `math_constrain` 已在 `blockly/blocks` 里定义，Python 生成 `min(max(v, low), high)`、JS 生成 `Math.min(Math.max(v, low), high)`，`src/utils/toolbox-config.ts:101` 已挂在 Math 类目（证据见 §3） |
| 门禁 | `type-check` / `lint:check` / `contract:check` / `verify:all` / `vitest run tests/unit` 全绿（读数见 §5） |
| 生成产物 | `BLOCK-IO-CONTRACT.json`、`block-index.json`、`code-signatures.json`、`field-templates.json`、`closure-names.json`、`doc-index.json` 按脚本重生成；**`src/services/ai-helper/reverse/**` 的逻辑一行未改** |
| 未做 | 反解析接线、metacrypt 同步、新增 Demo/evidence、根 README 的旧计数、浏览器内工具箱目检（见 §7） |

## 1. 块签名（绑定契约，勿改名）

| 块类型 | 形态 | 输入（name: check） | 字段 | 输出 / 连接 | 双语言语义 |
|---|---|---|---|---|---|
| `arr_append` | 语句 | `LIST`: `IntList`；`VALUE`: `Number` | — | 无输出；`previous`/`next` 可接 | Python `<list>.append(<value>)\n`；JS `<list>.push(<value>);\n`，**原地修改** |
| `ctrl_range` | 语句 | `FROM`: `Number`（值输入）；`TO`: `Number`（值输入）；`DO`: 语句输入 | `VAR`（`FieldTextInput`，默认 `i`） | 无输出；`previous`/`next` 可接 | Python `for VAR in range(FROM, TO):`；JS `for (let VAR = FROM; VAR < TO; VAR++)`；`TO` 独占 |

- 反解析要接的名字逐字固定：`arr_append`（`LIST` / `VALUE`）、`ctrl_range`（`VAR` / `FROM` / `TO` / `DO`）。
- `VALUE` 用 `Number` 而不是 `null` 的理由（写在 `src/blocks/array/append.ts` 顶部）：`LIST` 是 `IntList`，元素域是数值；Blockly 的连接检查把**未标注类型**的槽位（`variables_get`、原生 `lists_getIndex`）按通配放行，所以变量与表达式不会被误拒；而明确返回 `IntList`/`Bytes`/`SBox` 的块会被挡在值槽位外——那正是「把另一个容器当成元素追加」的误用。若用 `null`，这些容器能接进来并静默生成嵌套容器代码。这条取舍已用单测两面钉住：`variables_get` 接 `VALUE` 允许、输出 `IntList` 的容器块接 `VALUE` 被拒。
- `FROM`/`TO` 必须是值输入的关键点已用单测钉住：接 `variables_get` 时生成 `range(n, m)` / `let i = n; i < m`，不是常量；默认另有 `data_value` 影子块（0 / 10）与生成器兜底（`'0'` / `'10'`）。

## 2. 生成样例（headless Blockly 真实输出）

字面量区间、空循环体（`ctrl_range`，默认字段 `i`，FROM=0、TO=5）：

```python
for i in range(0, 5):
    pass
```

```javascript
// 范围循环（TO 独占）
for (let i = 0; i < 5; i++) {
  // 空操作
}
```

`FROM`/`TO` 接变量（`n`、`m`）——题头两行是 Blockly 对工作区变量的既有声明，不是本块加的：

```python
n = None
m = None


for i in range(n, m):
    pass
```

```javascript
var n, m;


// 范围循环（TO 独占）
for (let i = n; i < m; i++) {
  // 空操作
}
```

`arr_append`（列表变量 `items`、值 `7`）：

```python
items = None


items.append(7)
```

```javascript
var items;


items.push(7);
```

> 有循环体时的 Python 缩进沿用 `ctrl_iterate` 的写法：`statementToCode` 自带 2 空格 + `prefixLines(…, '    ')` 再 4 空格，逐字断言为 `for i in range(1, 4):\n      result.append(i)\n`（见 `tests/unit/ctrl-range-append-contract.test.ts`）。相对缩进合法，和 `ctrl_iterate` 保持同一形态。

## 3. `math_constrain` 已存在的证据（不要再建 `math_min` 之类重复块）

`node_modules/blockly` 13.2.0 把块定义拆在 `blocks_compressed.js`（`blockly_compressed.js` 是 core，**不含**块定义——这点与任务描述里的文件名不同，按本机实际布局取证）：

```console
$ grep -o "math_constrain.\{0,80\}" node_modules/blockly/blocks_compressed.js | head -2
math_constrain",message0:"%{BKY_MATH_CONSTRAIN_TITLE}",args0:[{type:"input_value",name:"VALUE"

$ python3 -c "import pathlib; s=pathlib.Path('node_modules/blockly/python_compressed.js').read_text(); i=s.index('math_constrain:function'); print(s[i:i+230])"
math_constrain:function(a,b){var c=b.valueToCode(a,"VALUE",V.NONE)||"0",d=b.valueToCode(a,"LOW",V.NONE)||"0";a=b.valueToCode(a,"HIGH",V.NONE)||"float('inf')";return["min(max("+c+", "+d+"), "+a+")",V.FUNCTION_CALL]}

$ python3 -c "import pathlib; s=pathlib.Path('node_modules/blockly/javascript_compressed.js').read_text(); i=s.index('math_constrain:function'); print(s[i:i+320])"
math_constrain:function(a,b){var c=b.valueToCode(a,"VALUE",S.NONE)||
"0",d=b.valueToCode(a,"LOW",S.NONE)||"0";a=b.valueToCode(a,"HIGH",S.NONE)||"Infinity";return["Math.min(Math.max("+c+", "+d+"), "+a+")",S.FUNCTION_CALL]}

$ sed -n 101p src/utils/toolbox-config.ts
      { kind: 'block', type: 'math_constrain' },
```

同一块在本仓库 headless 工作区实跑（VALUE=5 / LOW=1 / HIGH=10）：

```json
{ "python": "min(max(5, 1), 10)\n", "javascript": "Math.min(Math.max(5, 1), 10);\n" }
```

结论：标量钳位不需要新块，本次**没有**新增任何 `math_min` / `math_clamp`。

## 4. 改动文件

| 层 | 文件 | 改动 |
|---|---|---|
| 块定义 | `src/blocks/array/append.ts`（新） | `arr_append` 定义 + `APPEND_BLOCK_TYPES`；含 `VALUE` 取 `Number` 的理由注释 |
| 块定义 | `src/blocks/ctrl/range.ts`（新） | `ctrl_range` 定义 + `RANGE_BLOCK_TYPES`；FROM/TO 影子块、tooltip 写明 TO 独占与 `controls_for` 的区别 |
| 组注册 | `src/blocks/array/index.ts`、`src/blocks/ctrl/index.ts` | export + `ARRAY_BLOCK_TYPES` / `CTRL_BLOCK_TYPES` + 类型联合；`src/blocks/index.ts` 经组数组自动进入 `ALL_BLOCK_TYPES`（未改 `index.ts`，156 行，无需拆分） |
| 双生成器 | `src/generators/{python,javascript}/array/append.ts`、`src/generators/{python,javascript}/ctrl/range.ts`（新） | `pythonGenerator.forBlock` / `javascriptGenerator.forBlock` 注册，空体补 `pass` / 注释 |
| 生成器注册 | `src/generators/{python,javascript}/{array,ctrl}/index.ts` | `import './append'`、`import './range'` |
| 工具箱 | `src/utils/toolbox-config.ts` | `ctrlTypes` 加 `'ctrl_range'`；`arrTypes` 加 `'arr_append'`（`math_constrain` 保持原样） |
| 中英文案 | `src/composables/locale/messages-zh.ts`、`messages-en.ts` | 新增成对键：`CRYPTO_RANGE_{VAR,FROM,TO,DO,TOOLTIP}`、`CRYPTO_APPEND_{LIST,VALUE,TOOLTIP}`（块内无硬编码中文） |
| 文档 | `docs/blocks/ecc-sbox.md` / `.en.md` | 控制流表加 `ctrl_range` 行 + range 与 `controls_for` 的分工说明 |
| 文档 | `docs/blocks/data-encoding.md` / `.en.md` | 数组表加 `arr_append` 行 + 原地修改/类型检查说明 |
| 文档计数 | `docs/blocks/INDEX.md` / `.en.md` | 222/248 → 224/250 |
| 文档计数 | `docs/README.md` / `.en.md`、`docs/standards/COVERAGE.md` / `.en.md`、`docs/standards/PRODUCT-CERTIFICATION-FEASIBILITY.md` / `.en.md` | 活动块 222 → 224 |
| 清单 | `docs/standards/CONFORMANCE-INVENTORY.md` | 见 §6（计数 + 块清单行 + 无 Demo 清单 + 逐块证据 2 行） |
| 契约 | `docs/blocks/BLOCK-IO-CONTRACT.json` | `npm run block-io:write` 重生成，222 → 224 键 |
| 测试 | `tests/unit/ctrl-range-append-contract.test.ts`（新，14 用例） | 双语言逐字生成、空体补位、FROM/TO 值输入与变量生成、TO 独占/FROM ≥ TO 零迭代实跑、`arr_append` 语句块与原地修改实跑、契约键与端口断言 |
| 测试基线 | `tests/unit/block-search.test.ts`、`tests/unit/ai-helper-linkage.test.ts` | 索引重建后的实测基线：224 块 / 中英标签 224 / `localizedZh` 34 / 词表 457 |
| 生成产物 | `src/services/ai-helper/{block-index,doc-index}.json`、`src/services/ai-helper/reverse/{closure-names,field-templates}.json`、`experiments/ai-helper-2026-11-14/out/{block-index,code-signatures,closure-names,field-templates,doc-index}.json` | 按对应 npm 脚本重生成（只变统计与新增条目；`closure-names.json` 仅 `stats.blockTypes` 222→224，名单 226 未变） |

## 5. 门禁读数

| 命令 | 退出码 | 关键读数 |
|---|---:|---|
| `npx vue-tsc --noEmit`（`npm run type-check`） | 0 | 无输出（0 error） |
| `npm run lint:check` | 0 | 0 error / 0 warning |
| `npx vitest run tests/unit/ctrl-range-append-contract.test.ts` | 0 | `Tests 14 passed (14)` |
| `npx vitest run tests/unit/block-types-connections.test.ts tests/unit/serialization.test.ts` | 0 | 16 + 13 passed |
| `npm run contract:check` | 0 | `CONTRACT_GATE_SELFTEST controls=4 passed=4`；`CONTRACT_GATE_SUMMARY demos=60 blocks=2151 checked=1641 native=510 types=137 errors=0` |
| `npm run block-io:write` | 0 | `模板: 29/29 PASS`；重生成后契约键数 224 |
| `npm run verify:all` | 0 | `STANDARD_METADATA_SUMMARY … errors=0`、`STANDARD_SPLIT uncovered=0`、`COVERAGE_COUNTS_OK`、`STANDARD_INVENTORY_CHECK_OK`、`SPEC_CARD/ANCHOR/RUN/CANDIDATE errors=0`、`CONTRACT_GATE_SUMMARY … errors=0`、`DOC_TITLES_OK entries=437`、`BUILD_GUIDE_OK families=11 workspaces=60 files=24`、`DOC_LINK_SUMMARY files=443 broken=0`、`DOC_MERMAID_SUMMARY files=9 blocks=15 failed=0`、`DOC_INDEX_CHECK ok`、`FIELD_CHECK ok blocks=224`、`CLOSURE_CHECK ok names=226`、`模板: 29/29 PASS`、`DEMO_SUMMARY total=60 pass=60 fail=0` |
| `npx vitest run tests/unit`（全量） | 0 | `Test Files 112 passed (112)`；`Tests 1231 passed / 1 skipped (1232)` |

补充说明：

- 工具箱接线另用一次性 headless 冒烟核对（未落成永久测试）：`createToolboxConfig()` 返回 17 个类目，所有类目 `contents` 展平后含 `ctrl_range`、`arr_append`、`math_constrain`。

- `verify:all` 第一次跑曾在 `ai-helper-variants` 的 `FIELD_CHECK` 挂住（`运行时产物过期（3 处差异）→ npm run reverse:templates`，缺 `arr_append` / `ctrl_range` 与 stats）。这是**产物新鲜度**门禁，不是代码缺陷：重跑 `npm run reverse:templates`、`npm run reverse:closures` 后复跑即全绿。契约新增后需要同步刷新的生成产物清单见 §4 最后一行。
- `FIELD_SUMMARY` 里的 `collisions_after_variants=3`（`bit_expr_infix`/`bit_operation` 模板同形）与 `errors=2`（`sbox_variables_get/set` 的变量字段）是**既有读数**，与本次两块无关，`verify:all` 本身按 ok 放行。

## 6. 计数影响盘点（222 → 224）

确实会因本次新增而变旧、并已同步的位置：

| 位置 | 原值 | 处理 |
|---|---|---|
| `docs/blocks/BLOCK-IO-CONTRACT.json` | 222 键 | `npm run block-io:write` → 224 键 |
| `docs/standards/CONFORMANCE-INVENTORY.md` | 222 活动块 / 248 去重 / 221 兼容段 / 223 注册总数 / 89 无 Demo / 110 证据行 / 222 证据覆盖 | 224 / 250 / 224 / 225 / 91 / 112 / 224；块清单两行、无 Demo 清单、逐块证据 2 行同步 |
| `docs/blocks/INDEX.md` / `.en.md` | 222 / 248 | 224 / 250 |
| `docs/README.md` / `.en.md` | 222 | 224 |
| `docs/standards/COVERAGE.md` / `.en.md` | 222 | 224 |
| `docs/standards/PRODUCT-CERTIFICATION-FEASIBILITY.md` / `.en.md` | 222 | 224 |
| `src/services/ai-helper/block-index.json`（+ 实验留档副本） | 222 块、`localizedZh` 32、契约 FNV 摘要 | 重跑 blocksearch index → 224、34、摘要随契约更新 |
| `src/services/ai-helper/doc-index.json`（+ 留档副本） | docs 语料摘要 | 文档改动后重跑 `npm run docs:index` |
| `src/services/ai-helper/reverse/closure-names.json`、`field-templates.json`（+ 留档副本） | `stats.blockTypes` 222 | 重跑 `reverse:closures` / `reverse:templates` |
| `tests/unit/block-search.test.ts`、`tests/unit/ai-helper-linkage.test.ts` | 222 / 454 基线 | 224 / 457（`missing` 仍 22：新块在文档里能查到） |

只报告、**没有**动的旧计数（避免牵动别的门禁或篡改历史记录）：

| 位置 | 现状 | 为什么不动 |
|---|---|---|
| `README.md:123`、`README.en.md:124` | 195/221（en 194/220） | 本次改动前就与代码不一致（旧口径），改它要连带分类小计与中英措辞，留给 owner/统一处理 |
| `experiments/ai-helper-2026-11-14/{PLAN,RESULTS}.md`、`proposals/P3-SCOPE.md`、`P4-SCOPE.md`、`P4-FIRST-SLICE.md` | 221/222/219/220 等历史读数 | 实验记录是当时实测快照，不应回填 |
| `docs/research/*` | 140/194/220 等带日期的快照 | 同上，报告正文已写明快照日期 |
| `docs/audits/**`、`docs/standards/SOURCE-SPLIT-*` | 229/222 | 那是**标准结构化条目/锚点**计数，与活动块无关 |

## 7. 还没做 / 需要知道的口径

1. **反解析接线未做**（按指示）：`src/services/ai-helper/reverse/**` 的解析逻辑一行未改；只是为了让 `verify:all` 的产物新鲜度门禁转绿，重跑了 `reverse:closures` / `reverse:templates` 生成的 JSON。下一步接线时，`range(a, b)` 现在仍被 `core/statements.ts` 映射到 `controls_for`（两参分支），应改为 `ctrl_range`；`arr_append` 目前没有反向来源。
2. **未跑 `sync-to-metacrypt.sh`**，也未碰 `src/services/ai-helper/**` 的反解析源码、`docs/standards/**` 的规范内容。
3. **未新增 Demo / evidence 台账**：两块不在 60 个 Demo 里，按门禁口径计入「无 Demo 直接引用的块」（91 个），并由新单测提供字面量证据；`demos/evidence.json` 未动。
4. **未在真实浏览器/桌面里目检工具箱**：只做了 headless 的定义、连接、生成、执行与契约证据；「工具箱里能看到并拖出」这一步未截图。
5. **`FROM`/`TO` 表达式求值次数**：JS 生成按任务指定写成 `for (let i = FROM; i < TO; i++)`，`TO` 会在每轮比较时重新求值；若 `TO` 接带副作用的表达式，语义与 Python `range(a, b)`（只求值一次）不完全等价。本次按逐字生成契约实现，未加临时变量；要改需要同时改测试与契约样例。
6. **`arr_append` 的 `VALUE` 类型**：取 `Number`（理由见 §1）；如果后续要支持「列表的列表」或 `Bytes` 元素，需要另立类型/容器约定，不应把 `VALUE` 直接放宽成 `null`。
7. **根 README 旧计数**（195/221）与实验目录的历史读数未回填，见 §6。
8. **影子块依赖**：`ctrl_range` 的 `init` 会实例化 `data_value` 影子块（FROM=0、TO=10），与 `ctrl_iterate` 同一约束——只 import `src/blocks/ctrl/range` 而不 import `src/blocks/data/number` 的独立脚本/测试会在建块时抛 `Invalid block definition for type: data_value`。反解析接线若在独立进程里建块，需要把 `@/blocks/data/number` 一起引入。

## 8. 复现命令

```bash
npm run type-check
npm run lint:check
npm run block-io:write          # 生成契约（含 verify:build）
npm run contract:check
npx vitest run tests/unit/ctrl-range-append-contract.test.ts
npx vitest run tests/unit        # 全量
npm run verify:all               # 若在新增块后首次跑，先按 §5 备注刷 reverse:templates / reverse:closures / docs:index
```
