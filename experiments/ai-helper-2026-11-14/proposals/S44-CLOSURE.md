# S44 收口：三个原语接进反解析，四条缺口关闭

本文取代 `S44-GAPS.md` 里「能不能忠实表达」的收口前判定（那份保留为历史记录）。

日期：2026-11-17 晚。范围：只改反解析（`src/services/ai-helper/reverse/**`）与用例；
`src/blocks/**`、`src/generators/**`、`docs/**` 未动（工作区里它们本就是上一轮加块留下的
改动，本轮没有新增修改）。没有跑任何 `git add/commit/stash/checkout`，没有推远端，没有跑
`sync-to-metacrypt.sh`。

一句话结论：三条并行实现（模板 `core/`、AST `ast/`、共用诊断）已接上 `ctrl_range`、
`arr_append`、`math_constrain`；§44.6 的四条缺口按「能忠实表达就实现，不能就点名诊断」收口，
两条路径对同一段代码产出相同块结构并闭链，六段新样本差分执行全部一致。

---

## 0. 速查：五件事与落点

| # | 事 | 落点 |
|---|---|---|
| 1 | `range(a, b)` → `ctrl_range`（TO 独占）；删空区间/端点漂移 | `core/statements.ts` `buildForNode`、`ast/ir.ts` `For`、`ast/blocks.ts`、`diagnostics.ts` |
| 2 | 省略终点切片 / 两参非常量切片长度用 `math_constrain` 钳位；删两条漂移 | `core/containers.ts` `sliceNode`、`ast/ir-expr.ts` `sliceToIr`、`ast/ir-comprehension.ts`、`ast/blocks.ts` |
| 3 | 非字面量区间推导式 → 空列表 + 循环 + append；遮蔽改名；落点与多生成器诊断 | 新 `core/comprehension.ts`、新 `ast/ir-comprehension.ts` 的完整重写、`core/statements.ts`、`ast/ir.ts`、`ast/blocks.ts`、`serialize.ts` |
| 4 | 两条路径同形 + 闭链 | 新 `tests/unit/ai-helper-reverse-s44-desugar.test.ts`、重写 `tests/unit/ai-helper-reverse-s44-gaps.test.ts` |
| 5 | 诊断文案改成真实原因（共用 `diagnostics.ts`） | `src/services/ai-helper/reverse/diagnostics.ts` |

块序列化层为守住 ≤500 行拆了文件：`ast/blocks.ts` 460 → 289 行，新增 `ast/block-ctx.ts`
（块/变量 id 派生共用）与 `ast/expr-blocks.ts`（表达式 → 值块）。全部反解析文件行数：

| 文件 | 行 |
|---|---|
| `ast/ir-comprehension.ts` | 313 |
| `core/comprehension.ts` | 294 |
| `ast/blocks.ts` | 289 |
| `ast/block-ctx.ts` / `ast/expr-blocks.ts` | 37 / 215 |
| `tests/unit/ai-helper-reverse-s44-desugar.test.ts` | 344 |
| `tests/unit/ai-helper-reverse-s44-gaps.test.ts` | 266 |

---

## 1. `range(a, b)` → `ctrl_range`

**判据（两条路径同一套）**：

| Python | 块 | 生成 |
|---|---|---|
| `for i in range(n)` | `ctrl_iterate(TIMES=n)` | `for i in range(n):`（不动） |
| `for i in range(a, b)` | `ctrl_range(FROM=a, TO=b)` | `for i in range(a, b):` |
| `for i in range(a, b, 1)` | `ctrl_range(FROM=a, TO=b)` | 同上 |
| `for i in range(a, b, s≠1)` | 不产出 | `RANGE_STEP` |
| 参数个数 ∉ [1,3] | 不产出 | `RANGE_ARITY` |
| `for x in xs` | `controls_forEach(LIST, DO)` | `for x in xs:`（两条路径都补上，与 desugar 的口径一致） |

- 模板路径 `buildForNode` 不再把 `b-1` 当闭区间终点、不再判 `from >= to`、不再推漂移诊断。
- AST 路径 `For` 分支的 `kind:'for'`（from/to，to 已减 1）改成 `kind:'range'`（to 原样）。
- `RANGE_EMPTY`、`RANGE_ENDPOINT` 从 `diagnostics.ts` 删除；全仓 grep 无引用。
- 常量空区间 `range(5, 2)` 现在照常出 `ctrl_range`，生成代码一次也不执行。

**块结构样例（Python 真实生成，AST 路径）**：

```python
def f(xs: bytes):
    acc = 0
    for i in range(0, len(xs)):
          acc = acc + i

    return acc
```

块结构：`ctrl_range{FROM: data_value(0), TO: lists_length(xs), DO: variables_set(acc, acc + i)}`。

---

## 2. 省略终点切片 / 非常量两参切片：`math_constrain` 钳位

**公式（两条路径逐字一致）**：

| Python | 块 | 生成 |
|---|---|---|
| `a[i:]` | `arr_slice(a, i, math_constrain(len(a)-i, 0, len(a)))` | `crypto_array_slice(a, i, (min(max(len(a) - i, 0), len(a))))` |
| `a[i:j]`（至少一端非字面量） | `arr_slice(a, i, math_constrain(j-i, 0, len(a)))`，并报 `SLICE_DYNAMIC_SIGN` | `min(max(j - i, 0), len(a))` |
| `a[1:2]` / `a[-2:-1]` 字面量同号 | 长度折成 `j-i` 字面量 | 同左 |
| `a[1:2:3]` | 拒绝 `SLICE_STEP` | — |
| `a[-2:2]` 字面量异号 | 拒绝 `SLICE_SIGN` | — |
| `a[2:1]` 字面量倒序 | 拒绝 `SLICE_LENGTH` | — |

- `math_constrain` 是 Blockly 原生 Math 块（Python `min(max(v, low), high)`，JS
  `Math.min(Math.max(v, low), high)`），没有新造 min 块。
- `SLICE_TAIL_DRIFT` 从 `diagnostics.ts` 删除（`a[i:]` 已由钳位精确覆盖）；旧 `SLICE_DRIFT`
  的文案（「终点小于起点时块会因负长度报错」）在钳位后已不成立，不能用，但「两端异号时
  `j - i` 不是元素个数」这个已知漂移仍然存在——按新事实恢复成 `SLICE_DYNAMIC_SIGN`：至少一端
  不是字面量时**出块 + `semantic-drift`**，点名缺运行期符号判定。两个字面量端点仍走
  `SLICE_SIGN` / `SLICE_LENGTH` 拦截。
- 模板路径新增 `min(max(v, low), high)` → `math_constrain` 的读回（`core/expressions.ts`
  `readConstrain`），否则 AST 产物生成 `min(max(...))` 后模板路径读不回同一个块，闭链会断在
  这里。
- 模板路径的 `[]` 现在读成原生 `lists_create_empty`（以前是 `data_value(NUM='[]')`），
  与 AST 的空列表块同形，也让「生成 `[]` → 读回」落在同一个块上。

**块结构样例（Python 真实生成，AST 路径）**：

```python
def cut(a: bytes, i: bytes) -> list[int]:
    return crypto_array_slice(a, i, (min(max(len(a) - i, 0), len(a))))
```

块结构：`arr_slice{LIST: variables_get(a), START: variables_get(i),
LENGTH: math_constrain{VALUE: (len(a) - i), LOW: 0, HIGH: len(a)}}`。

---

## 3. 非字面量区间推导式 → 空列表 + 循环 + append（本轮主线）

### 3.1 形状与落点

`target = [expr for v in <迭代器> if cond]`（`cond` 可有可无）展开成：

1. `variables_set(target, lists_create_empty)`；
2. 循环：一参 `range(n)` → `ctrl_iterate`；两/三参（步长 1）→ `ctrl_range`；
   其余列表表达式 → 原生 `controls_forEach`；
3. 循环体：`arr_append(target, expr)`；有 `if` 时是 `controls_if(IF0=cond, DO0=append)`。

- 落点只认「简单变量赋值」右侧。return、函数实参、嵌套表达式、二元表达式的一部分都报
  `COMP_ASSIGN_ONLY`（说明展开后没有值、只支持赋值右侧），不产出半成品。
- 生成器数量 > 1：**全是字面量 range 且无 if** 保持既有笛卡尔积静态展开；含非字面量区间或
  `for x in <非 range 表达式>` 报 `COMP_NESTED`（多生成器嵌套展开未实现），不硬凑。
- 单生成器且是「字面量 range、无 if」保持既有静态展开（既有用例语义不动）；带 `if` 或区间
  非字面量才走动态展开。`if` 多于一个报 `COMP_NESTED`。
- 静态展开 > 64 项仍报 `compTooLong`（保留）；动态展开的次数由循环决定，没有项数上限。

### 3.2 变量遮蔽（Python 3 推导式有独立作用域）

`v = 1; arr = [v for v in range(n)]` 之后 Python 的 `v` 仍是 1。展开会把 `v` 变成循环变量，
所以：循环变量与目标函数参数 / 同作用域已出现过的变量（`Ctx.scope` / `seen`）重名时，按已有
名字集合改名为确定性的 `v_1`、`v_2`…（不是随机），并把元素与条件里的引用同步改名；目标变量
在循环里只出现在 `arr_append` 的 `LIST`，不改名。

实现上两条路径各自维护「同作用域已出现过的名字」：AST 在 `astToIr` 里每个函数一份
`ctx.scope`（形参先入集合，赋值/循环变量随处理加入）；模板路径由 `parsePythonBody` 的
`params`/`seen` 贯穿嵌套体。**元素/条件里对循环变量自身的引用是绑定引用，不算外层占用**——
这一条最初写错（把绑定引用也算进占用），导致没有遮蔽时也改名，已修。

### 3.3 块结构样例（Python 真实生成，AST 路径）

```python
def mk(n: bytes):
    arr = []
    for v in range(n):
          arr.append(v * 2)

    return arr
```

带 if：

```python
def mk(n: bytes):
    arr = []
    for v in range(n):
          if v > 1:
            arr.append(v * 2)

    return arr
```

块结构（无 if）：`variables_set(arr, lists_create_empty)` →
`ctrl_iterate(TIMES=n, DO=arr_append(LIST=arr, VALUE=v*2))`。
带 if 时 `DO` 是 `controls_if(IF0=(v>1), DO0=arr_append(...))`。

### 3.4 块结构样例（JavaScript 真实生成，同一条工作区）

```javascript
function mk(n) {
  arr = [];
  // 迭代循环
  for (let v = 0; v < n; v++) {
    arr.push(v * 2);
  }

  return arr;
}
```

带 if、`range(a, b)` 与切片的三段 JS 也实测生成：`ctrl_range` 的 TO 是独占（`for (let i = 0;
i < xs.length; i++)`，见上面 range 样例的同构输出）；`arr_append` 生成
`arr.push(v * 2);`；切片长度生成
`(Math.min(Math.max(a.length - i, 0), a.length))`。

---

## 4. 两条路径同形 + 闭链

判据写在 `tests/unit/ai-helper-reverse-s44-desugar.test.ts`：

1. **同形**：同一段代码分别走模板路径与 AST 路径，把两边的工作区状态归一成
   「类型 + 输入名 + 输入子块 + next 链 + 字段 + extraState」指纹（变量 id 换成变量名）后逐字
   相等。覆盖：非字面量区间、带 if、`for x in xs`、变量遮蔽、`range(a, b)`、`a[i:]`。
   - 唯一归一化：数字字面量 AST 用原生 `math_number`、模板路径用项目的 `data_value`，两者
     生成代码逐字相同（都是那个数字）。这是两条路径**既有**的表示差异，不是本轮引入的；指纹
     里统一成 `num`。其余块类型不归一。
2. **闭链**：AST 产物 → 生成 Python → `reverseCode`（模板路径）读回 → 两条路径的块结构指纹
   相等，且再生成代码逐字相同。覆盖六段：非字面量区间、带 if、列表表达式迭代器、变量遮蔽、
   `range(5, 2)`、`a[i:]`；另加 `range(a, b)`。
3. 遮蔽专项：参数同名、同作用域已赋值、目标变量本身同名三种都断言循环变量为 `v_1`，且生成
   代码里 `for v_1 in range(...)`，`return` 的仍是外层 `v`。

---

## 5. 诊断文案（两条路径共用 `diagnostics.ts`）

| 常量 | 现在的文案要点 | 状态 |
|---|---|---|
| `COMP_ASSIGN_ONLY` | 只支持简单变量赋值右侧；展开后没有值 | 替换旧的 `COMP_RANGE`/`MISSING_APPEND` 表述 |
| `COMP_NESTED` | 多生成器嵌套展开未实现（含多 if） | 替换旧的 `COMP_IF` 表述 |
| `COMP_GENERATOR` | 生成器只支持「变量 in range(...) / 列表表达式」 | 新增（形状认不出） |
| `compTooLong(n)` | 展开后过长（n 项，上限 64） | 保留 |
| `RANGE_ARITY` | 1–3 个参数；`ctrl_iterate` / `ctrl_range` 两种形态 | 文案按新块改写 |
| `RANGE_STEP` | 只支持步长 1；`ctrl_range` 没有步长输入 | 文案按新块改写 |
| `SLICE_STEP` / `SLICE_SIGN` / `SLICE_LENGTH` | 不变 | 保留 |
| `SLICE_DYNAMIC_SIGN` | 两参切片至少一端非字面量：负起点先按长度归一，`j - i` 在两端异号时不是元素个数，缺运行期符号判定 | 新增（替代旧 `SLICE_DRIFT` 的不成立文案） |
| `RANGE_EMPTY` / `RANGE_ENDPOINT` / `SLICE_TAIL_DRIFT` / `SLICE_DRIFT` | — | **删除**，全仓无引用 |
| `MISSING_APPEND` / `COMP_RANGE` / `COMP_IF` | — | **删除** |

用例断言两条路径拿到的 `detail` 与常量**逐字相同**（`toBe`，不是 `toContain`）。

---

## 6. 差分执行（块生成代码 vs 原文 Python，本机 CPython）

driver 与既有差分用例同一写法（base64 传源码 + `exec(compile(...))` + `json.dumps` 输出）。
六段样本都是本轮新增能力，`块生成代码` 是 AST 产物载入真实 Blockly 后由 Python 生成器输出的
完整代码；两边跑同一组调用。

| 样本 | 调用 | 原文结果 | 块生成代码结果 | 一致 |
|---|---|---|---|---|
| `range(0, len(x))` 变量端点 | `f([7,8,9])` / `f([])` | `[3]` / `[0]` | `[3]` / `[0]` | ✅ |
| `range(n)` | `f(5)` / `f(0)` | `[10]` / `[0]` | `[10]` / `[0]` | ✅ |
| 常量空区间 `range(5, 2)` | `f()` | `[0]` | `[0]` | ✅ |
| `[v*2 for v in range(n)]` | `mk(4)` / `mk(0)` | `[[0,2,4,6]]` / `[[]]` | `[[0,2,4,6]]` / `[[]]` | ✅ |
| 带 `if` 的推导式 `[v*2 ... if v > 1]` | `mk(5)` / `mk(1)` | `[[4,6,8]]` / `[[]]` | `[[4,6,8]]` / `[[]]` | ✅ |
| 变量遮蔽 `v = 1; arr = [v for v in range(n)]; return v` | `mk(5)` / `mk(1)` | `[1]` / `[1]` | `[1]` / `[1]` | ✅ |

切片另有专项差分（`s44-gaps.test.ts`）：`a[i:]` 的 `i ∈ {-9,-2,0,2,4,9}` 全部一致——原来
「起点越界抛 TypeError、Python 返回 `[]`」的漂移已经消失。`a[i:j]` 的同号端点（`j ≥ i` /
`j < i`，含双负）一致；**异号端点的漂移是真的**，并作为 `SLICE_DYNAMIC_SIGN` 的存在理由
钉住：

| 样本 | 调用 | 原文（Python） | 块生成代码 | 一致 |
|---|---|---|---|---|
| `a[-2:j]`（起点负字面量、终点变量，运行期 j=3） | `mid([1,2,3,4], -2, 3)` | `[[3]]` | `[[3, 4]]` | ❌（已报 `SLICE_DYNAMIC_SIGN`） |
| `a[i:j]` 双负且起点 `< -len`（i=-9, j=-1） | `mid([1,2,3,4], -9, -1)` | `[[1,2,3]]` | `[[1,2,3,4]]` | ❌（同一条诊断） |

`range(0, len(x))` 与 `range(5, 2)` 也覆盖了空列表输入（`len=0`）。

---

## 7. 门禁读数（整树实跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 单测 | `npx vitest run tests/unit` | **113 文件 / 1260 通过 1 跳过（1261）**，rc=0 |
| 类型 | `npm run type-check`（`vue-tsc --noEmit`） | **0 error** |
| lint（本轮范围） | `npx eslint src/services/ai-helper/reverse tests/unit/ai-helper-reverse-{s44-gaps,s44-desugar,slice-comp,core,ast}.test.ts` | **0 error / 0 warning** |
| lint（整树） | `npm run lint:check` | **0 error / 0 warning**（P3 线那 7 条 warning 已由 lead 修掉；本轮改动范围同样 0/0） |
| 整树门禁 | `npm run verify:all` | **rc=0**；`FIELD_CHECK ok blocks=224`、`CLOSURE_CHECK ok names=226`、模板 29/29、`DEMO_SUMMARY total=60 pass=60 fail=0`，contract / docs / spec / inventory 各段全过 |
| 运行时产物刷新 | `npm run reverse:templates` / `npm run reverse:closures` | `FIELD_WRITE`（blocks=224，with_template=222）、`CLOSURE_WRITE`（names=226） |
| 文档索引 | `npm run docs:index` | 重建后 `hash=5fb704055ef2e084`；`doc-search.test.ts` 22/22 通过 |

> `docs:index` 是必须的：工作区里 `docs/**` 在本轮开始前就有未提交改动，索引与语料不一致，
> `doc-search.test.ts` 先红；重建索引后恢复（索引是生成物，没有改任何 docs 内容）。

---

## 8. 仍缺什么（本轮明确没做，不要当成已支持）

1. **多生成器嵌套展开**：生成器 > 1 且不全是「字面量 range、无 if」时只报 `COMP_NESTED`。
   嵌套循环 + 每层 if 的结构还没做。
2. **推导式在表达式位置**（return、实参、嵌套表达式、二元表达式的一部分）只报
   `COMP_ASSIGN_ONLY`；没有「先收集再返回」的落点。
3. **两参非常量切片的异号漂移：已按诊断处理，不再静默**。至少一端不是字面量时，出块 +
   `SLICE_DYNAMIC_SIGN`（两条路径同一句话，点名缺运行期符号判定），因为 `j - i` 只在同号时
   成立：`a[-2:j]`（`j=3`，`a=[1,2,3,4]`）Python 得 `[3]`、块得 `[3,4]`；双负且起点 `< -len`
   时长度会多取到尾部。诊断已在 `slice-comp` / `s44-gaps` 里断言，异号差分的两条读数也写进
   §6。常量同号两端仍 0 诊断、常量异号仍是 `SLICE_SIGN` 拦截、`a[i:]` 单端 0 诊断。
4. **推导式循环变量在「原本不存在」时的泄漏**：`arr = [v for v in range(n)]; return v` 在
   Python 里是 NameError（推导式不泄漏），展开后的块里 `v` 是最后一项。只有与已出现名字同名
   时才改名；这种情况原本就引用了一个不存在的变量，未额外处理。
5. **列表字面量的既有表示差异**：AST 路径把 `[1, 2]` 落成 `lists_create_with`，模板路径读
   回时落成既有的 `data_value(NUM='[1, 2]')`（两者生成代码逐字相同）。因此
   `arr = [x for x in [1, 2]]`、`[[1, 2] for v in range(n)]` 这类**元素或迭代器是列表字面量**
   的样本，闭链的「生成代码逐字相同」成立、块结构指纹不完全同形；变量列表（`for x in xs`）
   与变量元素已同形并有用例。这是上一轮就存在的表示差异，本轮没有改动列表字面量的解析。
6. **括号包住的赋值右侧**：`arr = ([v for v in range(n)])` 不会走赋值展开（会报
   `COMP_ASSIGN_ONLY`）；非括号形态才是本轮支持的落点。
7. 语句位置的原语调用与多 return（§41 / §43.5）不变，不在本轮范围。

---

## 9. 需要 lead 知道的风险

- **整树 lint 已恢复 0/0**：本轮期间 P3 线新建脚本带来的 7 条 warning 已由 lead 修掉；
  本次收尾复跑 `npm run lint:check` 为 0 error / 0 warning。
- **`field-templates.json` / `closure-names.json` 已是「新块版本」**：重生成后 stats 从
  222 → 224 块、226 个闭包名，与 `FIELD_CHECK ok blocks=224` 一致；这两个是生成物，HEAD 里
  还是 222 的旧值，提交时它们会一起进入 diff。
- **`src/blocks/**` 与 `src/generators/**` 的未提交改动不是本轮产生的**：`ctrl_range` /
  `arr_append` 的块与双生成器、toolbox、locale 是上一轮加的（进入工作区时就是 M/?? 状态）；
  本轮只消费它们。`docs/blocks/BLOCK-IO-CONTRACT.json` 同理，未新增修改。
- **诊断文案是行为变化**：面板上原来的「缺 list append」类文案会消失，换成
  「多生成器嵌套展开未实现」「只支持赋值右侧」等真实原因；如果界面测试按旧文案断言，需要
  同步（本轮已同步仓库内的用例）。
- **模板路径新增 `min(max(...))` 与 `[]` 的读回**：`[]` 从 `data_value` 变成
  `lists_create_empty`，生成代码不变；如果别处有按 `data_value(NUM='[]')` 断言的快照式用例，
  需要复核（仓库内 grep 未见）。
