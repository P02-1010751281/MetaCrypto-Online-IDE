# 核心包边界：把「路径改写」换成「同一套包内别名」（2026-11-16）

## 问题

CipherCat 的核（blocks / generators / constants / locale / migration / runtime /
ProjectStore 端口）以文件复制的方式镜像进 metacrypt_server。两边应用级别名不同：
CipherCat 用 `@/constants/...`，metacrypt 用 `@/features/blockly/core/...`。
于是同步脚本靠一张**手工枚举的 14 条 sed 表**改写 import，脚本自己在注释里写着：

> fix_imports 的映射表是手工枚举的，新增块若引用了新的 `@/blocks/*` 而这里没跟上，
> 同步本身不会报错，只会让 metacrypt 的 type-check / 打包在别人机器上炸
> （2026-11-15 的 grid-shape、list-bridge 就是这么漏的）。

2026-11-16 当天就真的撞了两次：`lint --fix` 把同步进去的 `<button>✕</button>` 拆行，
与脚本写回的单行格式来回打架；以及一处注释里的 `@/runtime/...` 被 sed 顺带改写。

**根因不是 sed 写得不够聪明，而是核的导入依赖应用级别名。**

## 改法

1. **同一套包内别名**：7 个家族，两仓各自配置解析，不再改写文件内容。

   | 别名 | CipherCat | metacrypt_server |
   |---|---|---|
   | `@cc/blocks` | `src/blocks` | `features/blockly/core/blocks` |
   | `@cc/generators` | `src/generators` | `features/blockly/core/generators` |
   | `@cc/constants` | `src/constants` | `features/blockly/core/constants` |
   | `@cc/migration` | `src/utils/migration` | `features/blockly/core/utils/migration` |
   | `@cc/locale` | `src/composables/locale` | `features/blockly/core/utils/locale` |
   | `@cc/runtime` | `src/runtime` | `features/blockly/runtime` |
   | `@cc/utils` | `src/utils` | `features/blockly/core/utils` |

   配置点：`vite.config.ts`、`vite.verify.config.ts`、`vitest.config.ts`、`tsconfig.json`
   （两侧都配齐；esbuild 走 tsconfig paths，缺一个就会在单测/构建期炸）。

2. **改写 91 处导入**：84 个源文件，`from '@/…'` → `from '@cc/…'`。改完核家庭内
   应用级别名残留 **0**。

3. **同步脚本瘦身**：
   - 删掉 14 条文件级 sed 映射与整个 `fix_imports_blocks()`；
   - 只留 4 条**相对目录名**规则（`./bit` → `./bitwise`、`./postquantum` →
     `./post-quantum`）——它们不随新增文件失效；
   - 删掉 runtime 的 `@/runtime/` sed（runtime 现在是纯复制）；
   - 原来的「裸别名」检查换成包边界口径：镜像文件只许 `@cc/*`，且家族名必须已知。

## 判据（实跑）

| 仓 | 结果 |
|---|---|
| CipherCat | type-check 0 / lint 0 / 单测 **1018 passed, 1 skipped**（89 文件）/ `verify:all` 模板 **29/29**、Demo **60/60** |
| metacrypt_server | type-check 0 / lint 0 / 单测 **978 passed**（112 文件）/ build:prod 0 / verify:chrome **6/6** |

**镜像纯度**（新判据）：381 对配对里 **370 对逐字节相同**；不同 11 对只剩两类，
都是纯路径字符串改写：

| 类别 | 文件 | 原因 |
|---|---|---|
| 相对目录名 | `generators/{python,javascript}/index.ts` + `numtheory/{poly-add,ntt,poly-sub,mat-vec-mul}.ts`（10） | `bit`↔`bitwise`、`postquantum`↔`post-quantum` |
| 模板文件名 | `components/CryptoFunctionPanel.vue`（1） | `ciphercat_templates.json` → `function_templates.json` |

## 途中踩的两个坑

1. **tsconfig 少一个逗号**：往 `"@/*": ["src/*"]` 后面插条目时漏了逗号，esbuild 直接报
   `Expected "," in JSON`，于是 type-check / 单测 / 构建三处同时红——看起来像别名没配好，
   实际是 JSON 语法。改配置后必须看 esbuild 的原文报错，不要按"别名解析失败"去改别名。
2. **门禁口径过宽**：第一版检查扫整个 `core/`，把 metacrypt **自有**代码
   （`utils/workspace`、`utils/generator`、`generators/mcl`）里的 `@/features/...` 也判违规。
   收紧到只扫镜像文件后通过——检查必须只覆盖被复制的那部分。

## 这轮刻意没做的

| 项 | 原因 |
|---|---|
| `core/index.ts` barrel | Blockly **注册顺序是不变式**（procedure 定义/调用必须先于模板块）。barrel 会改变副作用顺序，风险高于收益；等真要出包时再做，并需注册顺序回归 |
| 扩展点（MCL 生成器外移） | `generators/mcl` 有 **77 个文件**，且它们依赖 core 内部注册链；外移要连注册入口一起重写，属独立一刀 |
| 目录名对齐（`bit`→`bitwise`） | 涉及 12 处相对导入与文档里的源码路径注解，收益（消掉最后 2 条 sed）不抵风险 |
| 真正切包（npm / submodule） | 边界刚冻结，先用镜像验证一轮；切包形态留给下一步决定 |

## 复跑

```bash
cd CipherCat
npm run type-check && npm run lint:check && npm run test:unit && npm run verify:all
bash scripts/sync-to-metacrypt.sh --overwrite-local     # 预检会列出未提交，确认后覆盖
cd ../metacrypt_server/frontend
npm run type-check && npm run lint && npm run test:unit && npm run build:prod && npm run verify:chrome
```
