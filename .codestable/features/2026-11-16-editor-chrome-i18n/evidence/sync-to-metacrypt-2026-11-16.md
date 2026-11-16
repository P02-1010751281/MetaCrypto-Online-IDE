# 全量 sync 到 metacrypt_server：风险实测与结果（2026-11-16）

## 为什么先测再跑

上轮交接停在「metacrypt 侧全量 sync 被 3 份未提交 locale 挡住，①/②/③ 三选一」。
owner 的疑问是「用脚本会出问题吧？」——脚本确实有三条会丢东西的路径，所以先量化再动手：

| 机制 | 脚本实现位置 | 实测 |
|---|---|---|
| 哑删块文件 | `[1/4]` 段：metacrypt 有、CipherCat 无的 `.ts` 直接 `rm` | **0 条** |
| 哑删生成器 | `[2/4]` 段：按 `bitwise→bit`、`post-quantum→postquantum` 反向映射比对后 `rm` | **0 条** |
| 哑删 locale/migration + 平板文件 | `sync_family` + `utils/locale*.ts` 清理 | **0 条**（平板文件已不存在） |
| 覆盖 | 全量 `cp` + `fix_imports` sed | **4 个文件**内容会变 |

另两条前提：镜像写入目标内 **untracked 0 个**（不会出现"覆盖了又没有 git 副本"）；
`EXPORT_LOSS` 闸为空（预检那次先报 dirty 就退，该段没打印）。

## 会变的 4 个文件（全是权威源的真改动）

| 文件 | 差异 | 性质 |
|---|---|---|
| `core/utils/locale/messages-zh.ts` | +13 行 | 查块面板 11 个 `CRYPTO_BLOCK_SEARCH_*` + `CRYPTO_CLOSE` |
| `core/utils/locale/messages-en.ts` | +13 行 | 同上英文 |
| `runtime/run-code.ts` | +23 行 | 运行链加可选 `AbortSignal`（metacrypt 调用方不传 → 行为不变） |
| `components/CryptoFunctionPanel.vue` | +27 行 | 面板头统一到全局 `.section-head`，✕ 补 `title`/`aria-label` |

第 4 条需额外确认：同步脚本只拷 `.vue`、不拷 CSS。已核实 metacrypt 的
`views/editor/editor-panel-chrome.css` 有 `.editor-view .section-head` /
`.section-actions` / `.section-title`，且该面板挂在 `EditorView.vue` 内，作用域成立。

## 跑的结果

`scripts/sync-to-metacrypt.sh --overwrite-local` → **RC=0，0 条 DEL**。
镜像区未提交 3 → 7（新增即上面 4 个），全仓 187 → 191，
3 份 locale 被覆盖但内容逐字节未变（`cmp` 逐份确认）。

## 途中抓到的真问题：`lint --fix` 与同步打架

metacrypt 的 `npm run lint` 带 `--fix`。首次跑完后它把同步进去的

```html
            >✕</button>
```

拆成三行（prettier 认为开标签跨行时文本应独立成行），于是
「同步写单行 → lint 拆行 → 下次同步再写回单行」每轮都对不上。

修法在权威源：把 CipherCat 的 `src/components/CryptoFunctionPanel.vue`
改成 prettier 规范的多行形式，两边 lint 都通过，再同步一次后
`eslint --fix` 对该文件成为 no-op（归一化比对 True）。

## 终态

| 项 | 结果 |
|---|---|
| 镜像收敛 | 381 对配对：380 一致，剩 1 处 2 行 = 脚本**有意**的 `ciphercat_templates.json → function_templates.json` 改名 |
| 删除 | 0 |
| metacrypt 门禁 | type-check 0 / lint 0 / 单测 **978 passed（112 文件）** / build:prod 0（30.44s） |
| 未提交 | metacrypt 191 条（其中镜像区 7），CipherCat 侧 `CryptoFunctionPanel.vue` 1 条 |

## 复跑

```bash
# 1. 先测爆炸半径（不写盘）
python3 <本目录外的一次性脚本>   # 逻辑：canon(@/features/blockly/core/→@/) 后逐对 diff
# 2. 跑同步（预检会被 3 份 locale 拦下，内容与权威源一致故可安全覆盖）
cd CipherCat && bash scripts/sync-to-metacrypt.sh --overwrite-local
# 3. metacrypt 门禁
cd metacrypt_server/frontend && npm run type-check && npm run lint && npm run test:unit && npm run build:prod
```

原始输出：[sync-run-full.log](sync-run-full.log)
