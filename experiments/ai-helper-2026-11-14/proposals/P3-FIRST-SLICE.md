# P3 第一步切片：外部 C 参考实现 → Blockly 工作区（真实读数）

> **结论先行**：三份 ≤40 行自撰 C 样本（sha256 钉死）跑通了 V0–V3 四段：**V0 3/3 哈希与 6/6 别名通过；V1 3/3 解析成功、10 条带行号诊断；V2 3/3 生成出可载入工作区；V3 双侧差分 9/9 向量通过**（甲 1、乙 5、丙 3），且阴性对照（把 `sub_bytes` 的别名改成 `shift_rows`）**当场变红**。
>
> 但这不是「C→积木翻译器」的读数。V3 只覆盖两种函数形态——**整函数被别名吸收**（乙、丙）与**纯原语调用链**（甲）；带分支/循环的函数体（如乙的 `expand_key`，14 个骨架节点）**没有** V3 读数。别名是人工真值，与生成器没有机械联系。
>
> 复跑：`node experiments/ai-helper-2026-11-14/p3/run-p3.mjs`（`--stage v0|v1|v2|v3` 可分段重跑；rc=0 表示全绿）。机器摘要见 [p3-summary.json](../p3/out/p3-summary.json)，人读摘要见 [p3-summary.txt](../p3/out/p3-summary.txt)。

## 0. 与同目录其它产物的关系

| 产物 | 来源 | 说明 |
|---|---|---|
| [run-p3.mjs](../p3/run-p3.mjs) + [lib/c-parse.mjs](../p3/lib/c-parse.mjs) | 本切片 | C 子集解析器 + V0–V3 跑批；V3 的 Python 侧**真的调用本仓库生成器**（经 `dist-verify/verify-demo.js`） |
| [alias-map.json](../p3/alias-map.json)、[samples/manifest.json](../p3/samples/manifest.json)、[vectors.json](../p3/vectors.json) | 本切片 | 别名真值、哈希真值、向量真值 |
| [out/p3-summary.json](../p3/out/p3-summary.json)、[out/p3-summary.txt](../p3/out/p3-summary.txt) | 本切片 | 权威读数（机器 + 人读） |
| [samples/SHA256SUMS](../p3/samples/SHA256SUMS)、[archive-parallel-pass/](../p3/archive-parallel-pass/) | 并行 pass（20:21–20:30），已归档 | 另一份读数（`readings.{md,json}`、`driver-aes-ecb.c`、`v3-aes-ecb.bin`）：V3 只跑 C 侧、明确写「本切片不跑生成器」，所以甲/丙判不可达。**已移入 `archive-parallel-pass/`，只作留痕**；口径与本报告不同时，**以 `out/p3-summary.*` 为准** |
| `docs/blocks/BLOCK-IO-CONTRACT.json`（本轮实测 **224** 键） | 并行线（未提交） | 相对 P3-SCOPE 采集时的 222 键多了 `arr_append`、`ctrl_range`。本切片的 6 条别名只依赖原有键，读数不受影响，但**引用块面数量时必须写实测值与时刻** |

## 1. 交付清单

| 文件 | 行数 | 作用 | 复跑命令 |
|---|---|---|---|
| [samples/jia-aes-round.c](../p3/samples/jia-aes-round.c) | 39 | 样本甲：AES-128 轮函数四步（SubBytes→ShiftRows→MixColumns→AddRoundKey） | `sha256sum` 见 §2 |
| [samples/yi-aes-ecb.c](../p3/samples/yi-aes-ecb.c) | 28 | 样本乙：AES-128 ECB 单块加密驱动（含密钥扩展；轮函数来自甲） | 同上 |
| [samples/bing-sm4-sbox.c](../p3/samples/bing-sm4-sbox.c) | 23 | 样本丙：SM4 S 盒查表 | 同上 |
| [samples/manifest.json](../p3/samples/manifest.json) | 45 | V0 的唯一哈希/来源真值表 | 被 run-p3 读取，不自动刷新 |
| [p3/alias-map.json](../p3/alias-map.json) | 77 | 6 条 C 名 → 块类型 + 证据行 + 3 条 rejected | V0 机械校验 |
| [p3/vectors.json](../p3/vectors.json) | 106 | 9 条向量（输入 hex、期望 hex、独立来源） | V3 两侧共用同一份 |
| [p3/run-p3.mjs](../p3/run-p3.mjs) | 963 | V0–V3 跑批 + 工作区/驱动/生成代码落盘 + 阴性对照 | `node …/run-p3.mjs [--stage …]` |
| [p3/lib/c-parse.mjs](../p3/lib/c-parse.mjs) | 941 | C 子集词法/语法/构造计数/带行号诊断 | 无依赖 |
| [out/evidence-v0-gate.txt](../p3/out/evidence-v0-gate.txt) | 29 | V0 开火证据（篡改样本后 rc=1 + MISMATCH，已恢复） | 见文件头 |
| [out/evidence-first-run.txt](../p3/out/evidence-first-run.txt) | 25 | 首跑 V3 的两个真实失败原文（保留字、重复定义） | 见文件 |

## 2. 三份样本：来源、许可证、哈希

**来源纪律（先说明）**：本轮**没有下载或取用任何第三方实现**。三份样本都按标准定义自撰——≤40 行约束下，第三方整文件实现无法原样使用，裁剪出来就变成「衍生版本」，来源与许可证表述会变得不可核验；因此走任务允许的第二条路，并在**文件头注释与本节表格**两处写明「自撰，非第三方参考实现」。S 盒表按标准附录逐字节转写，属于标准数据而非第三方代码。

| id | 文件 | 行数 | sha256 | 来源（明确写死） | 标准依据 | 许可证 | 获取日期 |
|---|---|---|---|---|---|---|---|
| jia-aes-round | `jia-aes-round.c` | 39 | `68bd0d7c…f73792c` | **自撰，非第三方参考实现** | FIPS 197 (2001) §5.1.1–5.1.4、§5.1.1 S 盒表 | AGPL-3.0-or-later（随本仓库） | 2026-11-17 |
| yi-aes-ecb | `yi-aes-ecb.c` | 28 | `677df19b…c511ad8` | **自撰，非第三方参考实现**（轮函数来自甲，显式 `#include`） | FIPS 197 §5.1/§5.2；SP 800-38A §6.1 ECB | AGPL-3.0-or-later | 2026-11-17 |
| bing-sm4-sbox | `bing-sm4-sbox.c` | 23 | `d7dbb180…3f66e157` | **自撰，非第三方参考实现** | GB/T 32907-2016 §7.3、附录 A S 盒 | AGPL-3.0-or-later | 2026-11-17 |

完整哈希与依赖见 [manifest.json](../p3/samples/manifest.json)。一行校验命令：

```bash
cd experiments/ai-helper-2026-11-14/p3/samples && sha256sum jia-aes-round.c yi-aes-ecb.c bing-sm4-sbox.c
```

完整值（本轮实测）：

```
68bd0d7c2b13464d0ee8a5e155c1fe4ff3faf5aafa873d8c8b5c56899f73792c  jia-aes-round.c
677df19bce0354a2fafe3815e8be40159f0b55ba2d8268d32980985b0c511ad8  yi-aes-ecb.c
d7dbb1809c533d0a1c408dd1c04574b24bea0c3d39d2ef3df39f9bd03f66e157  bing-sm4-sbox.c
```

样本乙依赖样本甲（`#include "jia-aes-round.c"`）。V0 把这条依赖也钉住：manifest 的 `dependsOn` 会在摘要里重算依赖文件哈希；V3 编译时**不再单独编译已被 `#include` 的依赖**（首跑就是在这里踩到重复定义，见 §8）。

## 3. 别名表（6 条，全部命中样本）

| # | C 名 | C 签名 | → 块类型 | 契约键 | 证据（块定义 / 生成器） | 命中样本 |
|---|---|---|---|---|---|---|
| 1 | `sub_bytes` | `void sub_bytes(uint8_t s[16])` | `aes_sub_bytes` | 是 | `src/blocks/symmetric/aes/blocks.ts:15`；`src/generators/python/symmetric/aes/blocks.ts:35` | 甲（定义 + 调用点） |
| 2 | `shift_rows` | `void shift_rows(uint8_t s[16])` | `aes_shift_rows` | 是 | `src/blocks/symmetric/aes/blocks.ts:27`；`src/generators/python/symmetric/aes/blocks.ts:48` | 甲（定义 + 调用点） |
| 3 | `mix_columns` | `void mix_columns(uint8_t s[16])` | `aes_mix_columns` | 是 | `src/blocks/symmetric/aes/blocks.ts:39`；`src/generators/python/symmetric/aes/blocks.ts:65` | 甲（定义 + 调用点） |
| 4 | `add_round_key` | `void add_round_key(uint8_t s[16], const uint8_t rk[16])` | `aes_add_round_key` | 是 | `src/blocks/symmetric/aes/blocks.ts:51`；`src/generators/python/symmetric/aes/blocks.ts:87` | 甲（定义 + 调用点） |
| 5 | `sm4_sbox` | `uint8_t sm4_sbox(uint8_t x)` | `sm4_sbox` | 是 | `src/blocks/symmetric/sm4/blocks.ts:17`；`src/generators/python/symmetric/sm4/blocks.ts:45` | 丙（整函数） |
| 6 | `aes_ecb_block` | `void aes_ecb_block(const uint8_t in[16], const uint8_t key[16], uint8_t out[16])` | `mode_ecb_encrypt` | 是 | `src/blocks/symmetric/modes/blocks.ts:19`；`src/generators/python/symmetric/modes/blocks.ts:5` | 乙（整函数） |

**别名与生成器之间没有机械联系**：这张表是人写的真值。V0 只机械校验两件事——（a）块类型是 `BLOCK-IO-CONTRACT.json` 的键；（b）证据行**现在仍含** `Blockly.Blocks['<块>']` / `forBlock['<块>']`（行漂移或块改名会当场失败）。语义等价只能靠 V3 差分 + 阴性对照抓。三条 rejected（无契约键，不做近似）：`aes_round`（只有 `proc_aes_round` 模板块，不在契约键内）、`expand_key`（同上）、`xtime`（GF(2⁸) 乘 2 无块，`bit_operation` 是 32 位语义，接上去是伪造）。

## 4. V0 读数（哈希 / 来源 / 行数 / 别名可审）

| 项 | N | 通过 | 结果 |
|---|---|---|---|
| 样本哈希 | 3 | 3 | 全等；行数 39 / 28 / 23，均 ≤40 |
| 依赖哈希 | 1 | 1 | 乙依赖甲的哈希一致 |
| 别名条目 | 6 | 6 | ≤8；块全在契约键内（本轮实测 224 键）；C 名无重复；证据行全部命中 |
| **V0 总判定** | — | — | **PASS** |

**开火证据**：临时给 `bing-sm4-sbox.c` 末尾加一个换行，`--stage v0` 输出 `MISMATCH` 且 **rc=1**；恢复后哈希回到 `d7dbb180…`。原文见 [evidence-v0-gate.txt](../p3/out/evidence-v0-gate.txt)。这一条是刻意的负向测试，不是故障。

## 5. V1 读数（词法/结构解析）

| 样本 | 解析 | 函数 | 形参 | for | if | 赋值 | 声明 | 数组初始化 | 下标读 | 下标写 | 调用 | 强转 | 二元运算 | 诊断 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 甲 | OK | 6 | 8 | 5 | 0 | 13 | 13 | 1 | 17 | 8 | 8 | 1 | 38 | **5**（1 unsupported / 4 drift） |
| 乙 | OK | 2 | 5 | 7 | 1 | 17 | 12 | 1 | 24 | 9 | 9 | 0 | 18 | **4**（1 / 3） |
| 丙 | OK | 1 | 1 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | **1**（1 / 0） |
| 合计 | 3/3 | 9 | 14 | 12 | 1 | 30 | 26 | 3 | 42 | 17 | 17 | 1 | 56 | **10** |

诊断逐条（行号 + 原文片段都在 JSON 里）：

| 样本 | 行 | 类别 | 代码 | 现象 |
|---|---|---|---|---|
| 甲 | 4 | unsupported | `preprocessor` | `#include <stdint.h>` 未展开（如实报，不假装看过头文件） |
| 甲 | 23 | semantic-drift | `narrow-cast` | `(uint8_t)` 截断语义块模型没有（按 32 位整数） |
| 甲 | 32 | semantic-drift | `implicit-narrowing` | `uint8_t a0 = s[i] …` 右侧是算术表达式，C 会按声明宽度截断 |
| 甲 | 33 | semantic-drift | `implicit-narrowing` | `s[i] = a0 ^ t ^ xtime(...)` |
| 甲 | 34 | semantic-drift | `implicit-narrowing` | `s[i+2] = …` |
| 乙 | 4 | unsupported | `preprocessor` | `#include "jia-aes-round.c"` 未展开 |
| 乙 | 12 | semantic-drift | `implicit-narrowing` | `t[0] = SBOX[t[1]] ^ rcon` |
| 乙 | 15 | semantic-drift | `implicit-narrowing` | `rk[i+j] = rk[i-16+j] ^ t[j]` |
| 乙 | 21 | semantic-drift | `implicit-narrowing` | `out[i] = in[i] ^ rk[i]` |
| 丙 | 4 | unsupported | `preprocessor` | `#include <stdint.h>` 未展开 |

**声明的支持集**（写在 [c-parse.mjs](../p3/lib/c-parse.mjs) 头部，解析器只认这些）：函数定义（标量/定长数组/const 形参）、声明（含 `{...}` 初始化列表与一语句多声明符）、`for(;;)`、`if/else`、`return`、`break/continue`、表达式语句（赋值 `=`/`^=`/`|=`/`&=`/`+=`/`-=`/`*=`/`/=`/`%=`/`<<=`/`>>=`）、调用、下标读写、算术/位运算/比较/一元/`++`/`--`、`(T)expr` 强转。

**声明的不支持集**（逐条带行号报 `unsupported`，不静默吞）：`switch/case`、`do-while`、`goto`、`struct/union/enum/typedef`、指针（`*p`/`&x`/`p+i`）、成员访问、三元 `?:`、逗号表达式、`sizeof`、函数指针、多维数组、不定长数组形参。三份样本只命中 `preprocessor` 一条，其余都在词法/语法层被识别并按构造计数——**「没出现」不等于「支持」**。

## 6. V2 读数（别名命中 / 结构骨架 / 工作区可生成）

| 样本 | 别名命中（定义 / 调用点） | 骨架节点 | 有块候选 | 全局表 | 工作区可生成 | 映射产物 |
|---|---|---|---|---|---|---|
| 甲 | 8（4 / 4） | 5 | 5 | `SBOX[256]` → 被别名吸收 | **是** | `P3_AES_Round`（chain-fold） |
| 乙 | 1（1 / 0） | 14 | 14 | — | **是** | `P3_AES_ECB_Block`（whole-function-alias） |
| 丙 | 1（1 / 0） | 0 | 0 | `SM4_SBOX[256]` → 被别名吸收 | **是** | `P3_SM4_Sbox`（whole-function-alias） |

骨架节点分布（块类型 → 个数）：

| 样本.函数 | 骨架块候选 |
|---|---|
| 甲.`xtime` | `procedures_defreturn.RETURN` ×1 |
| 甲.`aes_round` | `aes_sub_bytes` / `aes_shift_rows` / `aes_mix_columns` / `aes_add_round_key` 各 1（调用点命中） |
| 乙.`expand_key` | `controls_for` ×3、`lists_setIndex` ×6、`variables_set` ×3、`data_int_list` ×1、`controls_if` ×1 |
| 丙 | 无（唯一函数被 `sm4_sbox` 整函数吸收） |

**四条映射规则（每条都能被读到，不是隐含约定）**：

| # | 规则 | 依据 | 反例/边界 |
|---|---|---|---|
| 1 | 整函数命中别名 → 函数体整体被一个块吸收，内部构造不再单独映射 | 闭包把算法体吃掉了（P3-SCOPE §1.3） | 吸收后内部结构**不可审计**；只能靠 V3 对整函数做差分 |
| 2 | 无返回值的函数 + 末尾数组形参 → 该形参变块的**返回值** | `mode_ecb_encrypt` 用输出代替 out-param | 只有「最后一个数组形参」这一种形态；其它输出约定不支持 |
| 3 | 同一缓冲区上按顺序的原地原语调用 → 折叠成嵌套返回链（顺序 = 语句顺序） | 甲 `aes_round` 四句 → `add_round_key(mix_columns(shift_rows(sub_bytes(s))), rk)` | 函数体只要有一句不是原语调用就整体不可生成（如乙的 `expand_key`） |
| 4 | C `uint8_t[16]` 落 `bytes` 还是 `int_list`，**由目标块契约的 input check 决定** | AES 原子块要 IntList、`mode_ecb_encrypt` 要 Bytes | 同一 C 类型落到两种块类型；这是映射层的选择，不是 C 类型决定的 |

另加一条**必做的清洗**：C 形参名 `in` 会原样进函数签名，而 `in` 在 Python 与 JS 都是保留字 → 生成代码语法错。映射层现在把保留字/非法标识符改成 `in_`，并在 V2 输出里写「参数改名：in→in_」。这是首跑 V3 抓到的真问题（§8）。

## 7. V3 读数（gcc vs 生成器双侧差分）

两侧口径：C 侧 `gcc -O1 -std=c11 -Wall -Wextra` 编译「样本 + 本脚本生成的驱动」；Python 侧由 `dist-verify/verify-demo.js`（sha256 `3330d031…`）载入 V2 工作区，用**本仓库 Python 生成器**输出代码，再拼同一份向量驱动。两边跑同一组 hex 输入，逐行比对，且都要等于 `vectors.json` 的期望值。

| 样本 | 向量形态 | N | 通过 | 失败 | 说明 |
|---|---|---|---|---|---|
| 甲 | `inplace16` | 1 | **1** | 0 | FIPS 197 C.1 第 1 轮（初始 ARK 后状态 + 轮密钥 1） |
| 乙 | `ecb-block` | 5 | **5** | 0 | SP 800-38A F.1.1 四块 + FIPS 197 C.1 单块 |
| 丙 | `byte` | 3 | **3** | 0 | S 盒 `S[00]=d6`、`S[01]=90`、`S[ff]=48` |
| 合计 | — | **9** | **9** | 0 | 3/3 样本可达 |

逐向量（两侧输出与期望全等）：

| 样本 | 向量 | expect = C = Python |
|---|---|---|
| 甲 | `fips197-c1-round1` | `89d810e8855ace682d1843d8cb128fe4` |
| 乙 | `sp800-38a-f11-b1` | `3ad77bb40d7a3660a89ecaf32466ef97` |
| 乙 | `sp800-38a-f11-b2` | `f5d3d58503b9699de785895a96fdbaaf` |
| 乙 | `sp800-38a-f11-b3` | `43b1cd7f598ece23881b00e3ed030688` |
| 乙 | `sp800-38a-f11-b4` | `7b0c785e27e8ad3f8223207104725dd4` |
| 乙 | `fips197-c1-block` | `69c4e0d86a7b0430d8cdb78070b4c55a` |
| 丙 | `gb32907-a-s00` | `d6` |
| 丙 | `gb32907-a-s01` | `90` |
| 丙 | `gb32907-a-sff` | `48` |

**向量来源**（逐条写在 [vectors.json](../p3/vectors.json) 的 `source` 字段）：乙的 5 条是 FIPS 197 C.1 与 SP 800-38A F.1.1 的官方向量，另用 pycryptodome 3.20.0 复核；丙的 3 条是 GB/T 32907-2016 附录 A 的 S 盒表项（`S[01]=90` 与 `demos/procedures/SM4-Sbox.json` 的 `expect=144` 同值）；甲的期望值由 FIPS 197 C.1 给出的 SubBytes/ShiftRows/MixColumns 中间态与轮密钥 1 经 AddRoundKey（逐字节异或）推得，且**同一组轮函数被乙的 5 条官方向量端到端钉住**——这不是循环论证，但也不是独立实现对照，边界见 §9。

**阴性对照（判据有牙）**：把 `sub_bytes` 的别名改成 `aes_shift_rows`（同类型、仍能生成代码、语义错），同一向量下生成代码给出 `ed416f36a904297161cde3ba2d80adf5` ≠ 期望 `89d810e8…` → **已捕获**。工作区与生成代码留在 [ws-negative-control.json](../p3/out/ws-negative-control.json)、[gen-negative-control.py](../p3/out/gen-negative-control.py)。

**本轮对 P3-SCOPE 的一处修正**：SCOPE §2 说 `AES-Round` 无官方向量、只能做 V1/V2。实际上 FIPS 197 C.1 附录给的是**逐轮中间状态**，取「初始 AddRoundKey 后状态 + 轮密钥 1」就是一条可用的轮函数向量，所以甲也到了 V3。

## 8. 首跑抓到的两个真问题（已修，原文留证）

| # | 现象 | 根因 | 修在哪 | 原文 |
|---|---|---|---|---|
| 1 | 生成代码 `def P3_AES_ECB_Block(in: bytes, key: bytes)` → `SyntaxError`；同工作区的 JS 是 `function P3_AES_ECB_Block(in, key)` | procedure 块的双生成器把参数名原样写进签名，没有保留字/标识符清洗；`in` 在 Python 与 JS 都是保留字 | 本切片映射层 `sanitizeParam()`；**产品层没修**（桌面上用户把参数命名成 `in`/`class` 仍会生成非法代码） | [evidence-first-run.txt](../p3/out/evidence-first-run.txt) |
| 2 | `multiple definition of 'aes_round'`，链接失败 | 样本乙已 `#include` 甲，V3 又把甲当独立编译单元传入 | 本切片 V3 编译阶段：manifest 的 `dependsOn` 只在该样本未 `#include` 依赖时追加 | 同上 |

这两条不是「环境问题」，是 V3 真的抓到了映射/装配缺陷；修完重跑才有 9/9。

## 9. 失败与不可达：明确边界

| 项 | 本轮状态 | 说明 |
|---|---|---|
| V3 不可达 | **0/3** | 三份样本都可达；不可达分支的判定与原因文案写在 `stageV3`（入口函数找不到 / 工作区生成不出 / 契约输入对不上 / harness 缺失 / 编译失败 / 运行失败），触发时会写进摘要 |
| **没有 V3 读数的函数体** | 乙的 `expand_key`（14 骨架节点）、甲里被别名吸收的 4 个函数体 | 前者含 `for`/`if`，链式规则不适用；后者整函数被块吸收，内部构造没有映射对象，差分只能证明「整块 vs C 整函数」 |
| 语义漂移 | 7 条 drift 诊断（甲 4、乙 3） | 给定向量上**没有显现**（两侧相等）。这不证明任意输入等价：一旦 `uint8_t` 溢出/截断点与 32 位块模型分叉，V3 只能报红、不能自动修 |
| V3 能证明什么 | 只对给定向量成立 | 「两侧一致」既不等于「映射保真」，也不覆盖闭包内部实现与 C 是否同算法（这轮乙/丙恰好证明了整块与 C 单块在 5/3 组向量上一致） |
| 未定义行为 | 未覆盖 | 没开 `-fsanitize=undefined,address`；有符号溢出/越界/未初始化不在本轮判据内 |
| 头文件/宏 | 未展开 | `#include` 只记录不展开；乙的 `#include` 是 V3 装配层按 manifest 依赖处理的，解析器看不到甲的函数 |
| 样本数量 | 3 | 都是两三种函数形态；结论不能外推到「任意参考实现」 |

## 10. 下一步需要什么

| # | 需要的东西 | 为什么（本轮读数给的证据） | 归属 |
|---|---|---|---|
| 1 | **块层参数名清洗/校验** | 首跑 `in` 直接产出非法 Python + JS（§8） | 维护者线（`src/blocks/procedure` + 双生成器），非本切片 |
| 2 | **桌面 sidecar（`clang -Xclang -ast-dump=json` + gcc）** | 本切片的 V3 只能靠 Node 侧 harness + 本机 gcc；Web 里没有编译器（P3-SCOPE R3）。30 行 C 的 clang JSON 是 301 KB，跨 IPC 前要裁剪 | owner 定是否付打包成本 |
| 3 | **语言中立向量库** | 现在向量按「样本 × 驱动形态」手写在 `p3/vectors.json`；要复用 `demos/tests.json` 得先把它重构成 `{id, call, inputs, expect_hex}`（SCOPE §4.2） | 主线程/AI Helper |
| 4 | **带控制流的映射** | 乙的 `expand_key` 有 14 个骨架节点、0 条 V3 读数；`controls_for` 的闭区间语义与 C 的 `i < n` 不等价（SCOPE §1.2 #5） | 需要设计，不是加样本能解 |
| 5 | **缺块清单** | ①「起点 + 次数」计数循环（C 的 `for(i=0;i<n;i++)` 落到块会多跑/倒序）②指针/结构体/宏（SCOPE 第 15/16/21 条：无块）③标量钳位（`uint8_t` 截断的显式化） | 维护者线评估 |
| 6 | **更多样本 + 现成公开实现** | 本轮三份都是自撰；要证明「外部实现」这条链，下一轮应引入**许可证明确的公开实现**（public domain/MIT/BSD/Apache-2.0）并钉 URL/许可证/获取日期/哈希，即使它 >40 行也应保留原文、另写裁剪说明 | AI Helper |
| 7 | **V5 阴性对照进脚本门禁** | 本轮的阴性对照是单次手动触发（已写进 run-p3，默认跑）；应固定成每次 V3 都跑并断言 `detected === true` | 本脚本已做，待主线程决定是否进 `verify:all`（会引入 gcc 依赖，不建议进） |

## 11. 复跑与可重复性

```bash
cd /run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat
node experiments/ai-helper-2026-11-14/p3/run-p3.mjs            # 全绿 rc=0（本机约 26 s）
node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v0 # 只验哈希/别名；rc 反映判定
node experiments/ai-helper-2026-11-14/p3/run-p3.mjs --stage v3 --no-negative-control
```

- 连跑两次（除 `generatedAt` 与 harness mtime 外）摘要 JSON **逐字节相同**；四段各自单独重跑 rc=0。
- 依赖：本机 `gcc 16.2.1`、`python3 3.14.10`、`node v26.13.1`、已构建的 `dist-verify/verify-demo.js`（本轮 sha256 `3330d03154c34b35…`）。harness 缺失时 V3 写「不可达 + 原因」，不会伪造读数。
- 产物：`out/ws-*.json`（可载入工作区）、`out/gen-*.py`（生成代码 + 向量驱动）、`out/driver-*.c`（C 驱动）、`out/p3-summary.{json,txt}`、两份 evidence。全部是文本，可直接 diff。
