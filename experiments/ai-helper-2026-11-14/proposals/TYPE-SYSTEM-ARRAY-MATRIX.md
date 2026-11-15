# 类型系统与数组/矩阵形态：裁定提案

状态：**待裁定**。本文件不含任何代码改动，所有数字均可在仓库内复跑（§7 给命令）。

> **状态更新（2026-11-15）**：R1/R2/R4/R5/R6/R7 已由 owner 批准并**全部实施**，实测记录与三处偏离见
> `../RESULTS.md` §14。三处偏离：① `TYPE_ARRAY` 保留（R2 桥接需要 Blockly 原生标签）；
> ② 嵌套数组仍判 unknown（不造假类型标签）；③ 表格编辑器做成共用模块 `grid/grid-editor.ts`
> 而非 Field 子类（不重写已通过 KAT 的 S-box 交互，只把它委托出来）。


提案编号：P-TypeArray-01
起因：`data_value` 缺输出类型的讨论（见 `DATA-LITERAL-TYPES.md`）向下追到了数据表示层。

---

## 0. 结论摘要

1. **「字面量该拆成几个块」是表层问题**，真正缺口是「数组没有可构造、可编辑、可填充的形态」。
2. 推荐走 **扁平存储 + `shape` 元数据**：3 秩（3×3×3）与 2 秩、1 秩成本相同，类型系统不随维数增长。
3. 推荐**不**往契约里加 `Matrix`/`Vector` 类型：今天 0 个消费块，加了就是再造死词汇。
4. 与本次讨论并行的 `data_value` 判定口径修正（形状 × 槽位定型）仍建议做，二者不冲突。

---

## 1. 实测证据

| # | 事实 | 数值 | 复跑方式 |
|---|---|---:|---|
| E1 | `data_value` 的字面量数组总数 | 117 | §7.1 |
| E2 | 单字段最大数组字面量 | **14 671 元素**（ML-DSA-Sign 内 5 条：14671/14671/12801/12101/…） | §7.2 |
| E3 | Blockly 原生列表块使用次数 | **0** | §7.3 |
| E4 | 原生列表块输出类型 | `"Array"`（`blockly/blocks_compressed.js` 内逐字） | §7.3 |
| E5 | 密码槽位使用的类型 | `Bytes` 239 / `IntList` 188 / `Number` 111 / `String` 31 / `Boolean` 7 / `SBox` 4 / `Bits` 2 | §7.4 |
| E6 | `lists_*` 是否在契约内 | **0 条** | §7.4 |
| E7 | `SBox` 的实际存储 | 扁平 `gridData: string[]` + `ROW`/`COL` 仅用于显示（`r*maxCol+c`） | §7.5 |
| E8 | 词汇表死类型 | `Matrix` / `Vector` / `Array` 有定义与语言映射，**无任何块使用** | §7.6 |
| E9 | 有 check 槽位中 `data_value` 子块 | 356 条；其中 123 条 `NUM` 非纯数字 → 判定 unknown | §7.7 |
| E10 | 60 demo 类型检查基线（**加载模式** `check-loaded`） | 1237 配对 / 1102 ok / 0 mismatch / 135 unknown (10.9%) | §7.8 |
| E11 | 同一基线的**离线模式** `check`（不加载块定义，形参类型取不到） | 1237 / 956 / 0 / 281 (22.7%) | §7.8 |

E10 与 E11 是同一份 JSON 的两种运行方式，**引用数字时必须写清模式**；本提案与 RESULTS 一律用加载模式（E10）。

**E4 + E5 的组合是本提案的核心事实**：`Array` 与 `IntList`/`Bytes` 无交集，Blockly 会直接拒绝连线。toolbox 里摆着的「填充/构造」整族块，今天在能力上不可用。

---

## 2. 方案组 A：数组的构造形态

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A0 现状 | 文本字段里写字面量 | 零成本、透传任意表达式 | 14 671 元素不可编辑、无范围校验、无填充 |
| **A1 通用网格字段（推荐）** | 把 `sbox` 的表格弹窗抽成 `FieldGrid`，供新块 `data_int_list` 复用；秩 2 显示 rows×cols，秩 ≥3 显示切片页 | 复用已存在且已验证的编辑器；大数组可 CSV 进出 | 新字段组件 + 契约再生成 + 新块注册链 |
| A2 只用原生列表块 | 依赖 `lists_create_with` 手工加项 | 无新代码 | 项数上千时不可能；仍是逐项拖拽 |

**推荐 A1**，并把 `data_value` 保留为「任意表达式」逃逸口（矩阵/切片/下标仍走它）。

## 3. 方案组 B：填充

「填充」指按规则生成数组内容，今天的落地路径全部不通（E3/E4）。

| 方案 | 做法 | 说明 |
|---|---|---|
| **B1 放宽原生列表块 check（推荐先做）** | 覆盖 `lists_*` 定义，把 `setOutput(true, 'Array')` 改为 `setOutput(true, ['Array','IntList','Bytes','SBox'])` | `setOutput` 接受数组；改后 `lists_repeat`（按值填成长度 n）、`lists_create_with`、`lists_getIndex` 立刻能接进密码槽位。有先例：procedure 块已整体覆盖原生块 |
| B2 新增专用块 | `arr_fill(值, 长度)`、`arr_matrix_fill(rows, cols, 值)` | 语义更明确，但块数增加；若不做 B1，原生族仍是死件 |
| B3 不做 | 继续手打字面量 | 「填充」能力缺失 |

**推荐 B1 先做、B2 视需要后补**；B1 是唯一能立刻让现有 toolbox 条目生效的改动。

## 4. 方案组 C：N 维表示（本次讨论的核心）

| 方案 | 数据形态 | 类型 | 3×3×3 的成本 | 判定 |
|---|---|---|---|---|
| C0 嵌套 + 每秩一类型 | `[[[..]]]` | `IntList`/`Matrix`/`Cube`/… | 每加一维：新块 + 新契约条目 + 新转换规则 + 新检查器分支 | **会炸**，否决 |
| **C1 扁平 + shape 元数据（推荐）** | `[27 个值]` + `shape:[3,3,3]` | 仍是 `IntList` | 与 1 秩相同；编辑器按 k 切片 | 采用 |
| C2 扁平 + 无 shape | `[27 个值]` | `IntList` | 无成本 | 可行但失去「形状自洽」检查 |

C1 的要点：

- **秩不是类型，是元数据**：生成器输出扁平值，检查器不需要知道秩，契约不变。
- `shape` 存于块 `extraState`（Blockly 序列化自带），随工作区保存/加载。
- 新增真检查：`prod(shape) == len(values)`、每维 ≥ 1、总元素数 ≤ 上限（建议 65536）。今天这类错误完全无人发现。
- 秩**不设硬上限**：UI 用切片导航处理秩 ≥ 3，硬上限只放在总元素数。
- 先例：`SBox` 已经是这个形态（E7），本提案是把隐式先例显式化。

C1 下 `data_value` 的定位不变：任意表达式/嵌套字面量仍可透传，只是**不作为规范形态**，判定由所在槽位决定。

## 5. 方案组 D：`Matrix`/`Vector` 是否进契约

| 方案 | 说明 | 判定 |
|---|---|---|
| D0 维持死词汇 | 常量在、映射在、无块使用 | 可接受，但应有 `reserved` 注释 |
| D1 删掉 | `Array` 语义最弱；`Matrix`/`Vector` 与 C1 冲突（形状是元数据不是类型） | 与 C1 一致，推荐 |
| D2 真类型化 | 新增 `Matrix` 输出块 + reshape/transpose/取行列 + 转换规则 | 今天 0 消费块，等于再建死词汇 |

**推荐 D1（配合 C1）**：删除或标 `reserved` 三型；矩阵能力由 `shape` 元数据承载，不进类型表。

---

## 6. 逐条待裁项

| 编号 | 待裁内容 | 推荐 | 影响面 |
|---|---|---|---|
| R1 | 数组构造走 A1 通用网格字段？ | 是 | 新字段 + 新块 + 契约再生成 |
| R2 | 是否覆盖原生 `lists_*` 放宽输出 check（B1）？ | 是，先做 | 覆盖原生块定义，影响所有含列表块的工作区 |
| R3 | 是否新增 `arr_fill` / `arr_matrix_fill`（B2）？ | 先不加，看 B1 是否够用 | 块数 |
| R4 | N 维走 C1（扁平 + shape）？ | 是 | 新块 `extraState` 约定、编辑器、新校验 |
| R5 | `shape` 自洽校验是否纳入 `ai-helper-validate` 判据？ | 是（新增一类 issue） | 检查器 |
| R6 | `Matrix`/`Vector`/`Array` 三型：删 / 标 reserved？ | 删 | `block-types.ts` |
| R7 | `data_value` 判定口径（形状 × 槽位定型）：做否？ | 做，与本提案正交 | `typecheck.ts` ~30 行 + 钉死数字更新 |
| R8 | 若 R2 与 R4 都做，`data_int_list` 是否仍需存在？ | 需要：网格字段是编辑体验，原生块是程序化构造 | 块数 |

---

## 7. 复跑命令

```bash
# 7.1 数组字面量条数（117）
grep -rho '"NUM": "\[[^"]*\]"' demos/ | wc -l

# 7.2 最大字面量（14671）
python3 - <<'PY'
import re
t=open('demos/procedures/ML-DSA-Sign.json',encoding='utf-8').read()
print(sorted((len(m.group(1)) for m in re.finditer(r'"NUM": "(\[[^"]*\])"',t)),reverse=True)[:5])
PY

# 7.3 原生列表块使用次数与输出类型
grep -rho '"type": "lists_[A-Za-z_]*"' demos/ | sort | uniq -c        # 空 = 0 次
grep -o 'lists_create_with={init[^}]*setOutput(!0,"Array")' node_modules/blockly/blocks_compressed.js

# 7.4 契约类型分布与 lists_* 条目
python3 - <<'PY'
import json,collections
c=json.load(open('docs/blocks/BLOCK-IO-CONTRACT.json'))
T=collections.Counter()
for s in c.values():
    for v in (s.get('outputCheck') or []): T[v]+=1
    for i in (s.get('inputs') or []):
        for v in (i.get('check') or []): T[v]+=1
print(dict(T)); print('lists_*:',[k for k in c if k.startswith('lists_')])
PY

# 7.5 SBox 扁平存储
grep -n "gridData" src/blocks/sbox/sbox.ts | head

# 7.6 死类型
grep -rn "TYPE_MATRIX\|TYPE_VECTOR\|TYPE_ARRAY" src/ | grep -v block-types.ts

# 7.7 有 check 槽位中 data_value 的形状交叉表（应得 356 条子块 / 123 条非纯数字）
python3 - <<'PY'
import json,glob,collections,re
c=json.load(open('docs/blocks/BLOCK-IO-CONTRACT.json'))
def ic(bt,name):
    e=c.get(bt)
    if not e: return None
    for i in e.get('inputs') or []:
        if i.get('type')==1 and i.get('name')==name:
            ch=i.get('check'); return ch if ch else None
def shape(raw):
    s=(raw or '').strip()
    if re.fullmatch(r'-?\d+',s): return 'int'
    if s[:1] in ('"',"'") and s[-1:]==s[:1] and len(s)>1: return 'string'
    if s.startswith('[') and s.endswith(']'):
        inner=s[1:-1].strip()
        if not inner: return 'empty_array'
        return 'nested' if '[' in inner else 'flat_array'
    if re.fullmatch(r'0x[0-9a-fA-F]+',s): return 'hex'
    return 'empty' if not s else 'expr'
detail=collections.Counter(); pairs=0
def walk(b):
    global pairs
    for name,v in (b.get('inputs') or {}).items():
        ch=(v or {}).get('block')
        if not ch: continue
        exp=ic(b.get('type'),name)
        if exp:
            pairs+=1
            if ch.get('type')=='data_value':
                detail[('|'.join(exp),shape((ch.get('fields') or {}).get('NUM','')))]+=1
        walk(ch)
    n=(b.get('next') or {}).get('block')
    if n: walk(n)
for f in sorted(glob.glob('demos/**/*.json',recursive=True)):
    if 'tests' in f: continue
    d=json.load(open(f))
    for b in (d.get('blocks') or {}).get('blocks') or []: walk(b)
print('pairs=',pairs,'data_value子块=',sum(detail.values()))
for (exp,sh),n in sorted(detail.items(),key=lambda x:-x[1]): print(f'{n:5d}  {exp:10s} <- {sh}')
PY

# 7.8 60 demo 基线（必须用 check-loaded；离线 check 是另一组数字）
npm run verify:build
node dist-verify/ai-helper-typecheck.js check-loaded
node dist-verify/ai-helper-typecheck.js check          # 对照组：22.7%
```

---

## 8. 验收判据（若批准）

1. `verify:demos` 60/60、`verify-templates` 29/29 保持全绿。
2. 类型检查基线变化须**显式记录**：改动前后的 `pairs/ok/mismatch/unknown` 必须逐字写在 RESULTS 里，且 mismatch 增量必须逐条给出可定位的 issue。
3. 新增形状校验要有反例：`shape=[3,3,3]` 只给 26 个值 → 必须报错并指出位置；给 27 个值 → 通过。
4. 覆盖原生列表块后，须验证：`lists_repeat` 能接入 `Bytes` 槽位并生成可执行代码（配一个 KAT 级 demo，而非只看能否连线）。
5. 行数：新增源文件 ≤ 500 行；`sbox.ts` 抽出 `FieldGrid` 后必须显著变短。
6. `lint` 0 错误 0 警告，`vue-tsc --noEmit` 0 error。

---

## 9. 本提案明确不做的事

- 不引入「每种秩一个类型」。
- 不把矩阵变成运行时结构（生成代码始终是扁平序列）。
- 不在没有消费块的情况下往契约加 `Matrix`/`Vector`。
- 不改 `data_value` 的显示文本（论文图内有积木截图，改显示会连带返工图）。
