# 第 4 轮：全量 ML-KEM（1494 块）单发生成

> 前三轮：浅层 35 块（[../ir-format-2026-11-14/RESULTS.md](../ir-format-2026-11-14/RESULTS.md)）、宽度 218 块（[../ir-large-2026-11-14/RESULTS.md](../ir-large-2026-11-14/RESULTS.md)）、深度 241 块（[../ir-depth-2026-11-14/RESULTS.md](../ir-depth-2026-11-14/RESULTS.md)）。
>
> 前三轮都没能验证「1494 块能不能一次写对」，因为 50–999 块的真实工作区是 0 个、1494 块只有一个。本轮直接拿这个唯一的大样本做任务：**两席都一次写成了，且逐块精确**。同时暴露出一个比格式差异更大的成本项——缩进。

## 1. 任务

| 项 | 值 |
|---|---:|
| 参考工作区 | `demos/procedures/ML-KEM-Encaps.json`（真实文件，未截取、未改名） |
| 块数 | 1494 |
| 语句链 | 28 条语句 / 27 个 `next` |
| 规格最大缩进 | 22 层（44 空格） |
| 规格文本 | 83 511 B |
| 块类型数 | 22 |
| 臂与席次 | 仅 IR 臂，2 席（A1 / A2） |

输入是格式中立规格，不含 id、坐标与 `{"block": …}` 包装。

### 方言修正（本轮同时验证的改动）

前三轮用的是「`(then)` 行放在父级缩进、后继块缩进 +1」，A2 与 B2 两席都主动指出这等于让「缩进=嵌套」与「缩进=链」互相冲突，一旦按缩进解析，链长会塌成 1。本轮改为：

```
  STACK -> variables_set VAR={"id":"v_H","name":"H"}
    VALUE -> ...
  then: variables_set VAR={"id":"v_G","name":"G"}
    VALUE -> ...
```

即 **`then:` 与语句同缩进**，缩进只表示嵌套、`then:` 只表示后继。这个方言不是靠约定，而是靠一个解析器证明的：`verify-dialect.mjs` 把 `spec.md` 机械解析回工作区，与真实文件规范化后**同构**（1494 块 / 1 个根 / 27 个 `next`）。前三轮的方言做不到这一点。

## 2. 结果

| 运行 | 形状 | 文件字节 | 紧凑字节 | 块数 | 链长 | 最大深度 | 格式缺陷 | 契约错误 | 逐过程精确 | 类型 F1 | 叶子 F1 | 整体同构 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A1 | ✓ | 582 534 | 90 064 | 1494 | 28 | 23 | 0 | 0 | 1/1 | 1.000 | 1.000 | ✓ |
| A2 | ✓ | 582 533 | 90 064 | 1494 | 28 | 23 | 0 | 0 | 1/1 | 1.000 | 1.000 | ✓ |

`A1 ≡ A2`（规范化后是同一棵树），且**两席都与仓库里的真实工作区逐块一致**。

两席的独立性：md5 不同（`ba24778d…` vs `678e4baa…`），但规范化后完全相同——差异只在键序/排版，不在语义。

## 3. 本轮最重要的发现：缩进吃掉了格式的全部优势

| 口径 | IR token（`cl100k_base`） |
|---|---:|
| 紧凑文本（理论最小值） | **25 484** |
| 两席实际写出（含缩进） | **51 477** |

两席都把产物缩进排版（1 空格/层），文件 582 KB，缩进占 85% 字节，于是实际输出 token 是紧凑形式的 **2.02 倍**。

这直接改写前几轮的一个判断：我之前把「IR ≈ 25.5k token，32k 上限下装得下」当作 IR 的容量优势。实测表明：
1. **32k 不是本环境的输出上限**——这两席各写出 51 477 token 仍未截断，所以「装得进 32k」不能当作「本环境能不能做」的判据；
2. **格式不是决定输出成本的主变量，缩进风格才是**。四轮 14 份产物全部选择了缩进排版，缩进占 43%–90% 字节（见 [../MEASURED-TOKENS.md](../MEASURED-TOKENS.md)）。

换句话说：如果真要控制输出预算，第一步不是选 IR 还是 JSON，而是约定「紧凑输出」。在紧凑口径下 IR 比 JSON 少 33%，但这个差距仍小于「缩进 vs 紧凑」带来的 1.4–10 倍差。

## 4. 这轮推翻/坐实了什么

| 前几轮的表述 | 本轮结论 |
|---|---|
| 「1494 块一次成型无法验证正确率」 | **推翻**：两席都一次写成，且与真实文件逐块精确 |
| 「(then) 缩进会让链读成嵌套」 | **修正**：改用同缩进 `then:` 后，解析器可机械还原，两席均未误读 |
| 「IR 装得进 32k、JSON 装不进」 | **降级**：紧凑口径下成立，但本环境实测预算 ≥51k；且缩进风格的影响远大于格式 |
| 「大工作区必须分块生成」 | **推翻**：1494 块可以单次生成（本次两次都做到） |

## 5. 加载进真实 Blockly：越过「结构同构」的最后一公里

结构同构只说明两棵 JSON 树的形状一样，不说明产品能吃下产物。补做的验证是把两席 IR 组装成 workspace JSON，交给仓库自带的 `dist-verify/verify-demo.js`——它用 `Blockly.serialization.workspaces.load` 真实加载、经注册表与连接检查、再走 Python/JS 生成器：

| 检查 | A1 | A2 | 原始 Demo |
|---|---|---|---|
| Blockly 加载 | 通过 | 通过 | 通过 |
| 识别 `procedures_defreturn` | `ML_KEM_Encaps` | `ML_KEM_Encaps` | `ML_KEM_Encaps` |
| 生成代码字节 | 80 905 | 80 905 | 80 905 |
| 生成代码 sha256 | `a7abfa9f…` | `a7abfa9f…` | `a7abfa9f…` |
| 官方向量（Python） | PASS | PASS | PASS |
| 官方向量（JS） | PASS | PASS | PASS |

两席产物生成的 Python/JS 代码与真实文件**逐字节一致**（三份都是 `a7abfa9ff7fc1a55ad56c41b26855d27a6aea0c80997344d1eb17aa1ec1b54fc`），且 `--exec` 跑官方 ML-KEM 向量（`demos/tests.json` 登记的密文期望值）两种语言都通过。这一步把证据从「树同构」升级到「真实 Blockly 加载 → 生成 → 执行 → 向量一致」。

复跑：先 `node experiments/ir-mlkem-2026-11-14/load-check.mjs` 组装产物，再按 `…/demos/procedures/ML-KEM-Encaps.json` 的路径形状暂存，交给 `node dist-verify/verify-demo.js <暂存路径> --exec`。

## 6. 局限（必须一起读）

- **只测了 IR 臂**（2 席），没有 JSON 臂做对照。因此本轮不能声称「JSON 做不到」——只能说 JSON 的紧凑文本是 38 006 token，若同样缩进排版会更大；
- **N=2**，两席规范化后相同（采样方差为零），给不出置信区间；
- **任务仍是转写**：给定格式中立规格，不含算法推理；
- Blockly 验证用的是**仓库自己的生成器与向量**，证明产物可加载、可生成、可执行；它不证明生成器本身与标准的符合性（那由既有 `verify:demos` 负责）；
- 判分依赖 mtime 稳定：本轮 A2 在 14:21:15 落盘，第一次判分在它写完之前，读数会显示「缺产物」，等写完重判才有效（前三轮踩过同样的坑）。

## 7. 复跑

```bash
node experiments/ir-mlkem-2026-11-14/build.mjs        # 从真实 ML-KEM 文件生成规格、契约摘录、样例与两个运行目录
node experiments/ir-mlkem-2026-11-14/verify-dialect.mjs  # 证明方言可机械还原（必须输出「同构：true」）
# 两个 runs/A{1,2}/ 各交给一个独立生成席，产出 output.json
node experiments/ir-mlkem-2026-11-14/score.mjs        # 打分，写 RESULTS-MLKEM.md / RESULTS-MLKEM.json
node experiments/ir-mlkem-2026-11-14/load-check.mjs   # 组装成 workspace JSON（runs/A*/assembled.workspace.json）
node experiments/measure-tokens.mjs                   # 导出紧凑文本（供 token 计数）
python3 experiments/measure-tokens.py                 # 实测 token，写 MEASURED-TOKENS.md
```
