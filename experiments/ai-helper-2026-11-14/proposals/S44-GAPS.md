# S44：§44.6 四条缺口的判定与落点

针对 `RESULTS.md` §44.6「仍然缺什么」的前四条，逐条先判「现有块模型能否忠实表达」，再决定
实现还是报诊断。判据：两条路径（模板 `core/`、AST `ast/`）同形 + 闭链（AST 产物 → 生成 →
模板路径读回）+ 诊断点名缺的原语；用例在 `tests/unit/ai-helper-reverse-s44-gaps.test.ts`。

| # | 缺口 | 判定 | 落点 |
|---|---|---|---|
| 1 | 非字面量区间推导式 `[f(v) for v in range(n)]` | 不能：没有 list append | 一条 `unsupported` 诊断，不出块 |
| 2a | 带 `if` 的推导式 | 不能：要先收集再筛选，同样缺 append | 一条 `unsupported` 诊断，不出块 |
| 2b | 多个生成器（字面量 range） | 能：笛卡尔积是定长列表 | 两条路径都实现 |
| 3 | 省略终点切片 `a[i:]` | 能（`arr_slice` + `len(源) - 起点`），带一处已记录漂移 | 两条路径都实现 |
| 4 | `range(a, b)` 非常量端点 | 不能：缺「起点 + 次数」的计数循环 | 出块 + `semantic-drift` |

## 已核实的事实（本轮实测）

- 工作区没有 append：`lists_setIndex` 的生成器被覆盖成只做按下标赋值
  （`src/generators/python/array/lists.ts`），`lists_create_with` 的 `itemCount` 必须静态确定。
  所以 1、2a 的展开次数要么未知、要么需要筛选，都落不了地。
- `lists_length` 是工具箱「数组」类目里已有的原生块，Python 生成就是 `len(x)`，所以它才是
  Python 的长度原语。**不用** `data_byte_length` / `data_bit_length`：它们对 list 输入确实
  返回 `len(list)`（`src/generators/python/data/measurement.ts`），但按类型分档（str 走
  UTF-8 字节数、bytes 走 `len * 8`），拿它当切片长度会在 str/bytes 源上静默切错。
- `lists_getSublist` 也不能当切片原语：它的 Python 生成器按键 1-based 取值，实测
  `a[i:]` 会生成 `a[int(i - 1) : ]`，而本项目只把 `lists_getIndex` / `lists_setIndex`
  覆盖成 0-based（`src/generators/python/array/lists.ts`），没有覆盖 getSublist。
- 缺口 3 的残余漂移：起点为正且源比它还短时，长度 `len - 起点` 变负，`crypto_array_slice`
  会抛 TypeError，而 Python 返回空列表——列表块里没有标量 min/钳位原语。`a[:]`、`a[-2:]`
  的长度必然非负，逐字等价、不出诊断。差分执行实测两种行为，作为漂移为真的证据。
- 缺口 4 保留块的理由：与 `bit_operation` 同档（块出来了、运行时语义可能不同、必须报
  `semantic-drift`）；常量空区间已整条不产出；若把非常量端点也整条拒绝，`range(0, len(x))`
  这类最常见写法会连同循环体一起丢掉。

## 顺带修掉的断链

模板层匹配到块后，槽位里的子表达式只走模板层，`crypto_array_slice(a, i, (len(a) - i))`
的 `LENGTH` 会留成 UNRESOLVED——`a[i:j]` 的非常量端点本来也断在这。现在模板层给认不出的
子输入留 `raw` 原文，核心语法层补拆（`core/expressions.ts` 的 `upgradeCaptured`），闭链在
`a[i:]` 与 `a[i:j]` 上都成立。
