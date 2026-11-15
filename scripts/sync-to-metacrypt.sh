#!/bin/bash
# CipherCat → metacrypt_server 同步脚本（2026-08-01 重写）
# 将 CipherCat 的 Blockly 核心改动同步到 metacrypt_server
#
# 背景：2026-08-01 平台重构 Step2 features 化后，metacrypt 的 Blockly 核心
# 从 frontend/src/blockly/ 移至 frontend/src/features/blockly/core/。
# 旧脚本路径已失效 + 目录名不匹配（bit→bitwise、postquantum→post-quantum），
# 且 metacrypt 侧残留已删除文件（convenience.ts、gf-mul.ts）。
# 本次重写为"全量镜像 + 目录映射 + 旧文件清理"。
#
# 使用方法：
#   1. CipherCat 侧修复完成并自验（vue-tsc/build）后运行
#   2. 运行此脚本，然后在 metacrypt_server 运行 npm run build 验证
#   3. 若 metacrypt 镜像区有未提交改动，脚本会中止；确认可丢弃后加 --overwrite-local
#
# 导入别名转换（CipherCat @/ → metacrypt @/features/blockly/core/）：
#   @/constants/block-types          → @/features/blockly/core/constants/block-types
#   @/blocks/procedure/blocks        → @/features/blockly/core/blocks/procedure/blocks
#   @/utils/migration                → @/features/blockly/core/utils/migration
# 注意：镜像后 metacrypt 的 blocks/index.ts 会被 CipherCat 版本覆盖（含 REMAINING_BLOCK_TYPES
# 合并进 ALL_BLOCK_TYPES，这是期望行为——metacrypt 旧 index 漏了 remaining）。
# metacrypt 专属文件（generators/mcl/、utils/workspace/、blockly-patches.ts、generator/、
# constants/mcl-highlight.ts）不在镜像范围，保留。utils/locale/ 与 utils/migration/ 自
# 2026-11-15 起改为镜像（见 [3.8]），不再是 metacrypt 专属。

set -e

# 导入别名 sed 转换函数（CipherCat 别名 → metacrypt features/blockly/core 别名）
# 两类转换：
#   a) @/ 绝对别名：CipherCat @/constants/... → metacrypt @/features/blockly/core/...
#   b) 相对目录名（仅 generators/）：CipherCat bit/ → metacrypt bitwise/，postquantum/ → post-quantum/
#      （blocks/ 目录两边同名，不需要；但 generators/ 目录名两边不同，镜像后 index.ts 等
#      相对导入会指向不存在的 ./bit 或 ./postquantum，必须映射）
fix_imports() {
  sed -i \
    -e "s|@/constants/block-types|@/features/blockly/core/constants/block-types|g" \
    -e "s|@/constants/sbox-presets|@/features/blockly/core/constants/sbox-presets|g" \
    -e "s|@/constants/grid-shape|@/features/blockly/core/constants/grid-shape|g" \
    -e "s|@/constants/list-bridge|@/features/blockly/core/constants/list-bridge|g" \
    -e "s|@/blocks/grid/grid-editor|@/features/blockly/core/blocks/grid/grid-editor|g" \
    -e "s|@/blocks/procedure/blocks|@/features/blockly/core/blocks/procedure/blocks|g" \
    -e "s|@/blocks/procedure/toolbox-state|@/features/blockly/core/blocks/procedure/toolbox-state|g" \
    -e "s|@/utils/migration|@/features/blockly/core/utils/migration|g" \
    -e "s|@/utils/project-context|@/features/blockly/core/utils/project-context|g" \
    -e "s|@/utils/toolbox-config|@/features/blockly/core/utils/toolbox-config|g" \
    -e "s|@/generators/assignment-target|@/features/blockly/core/generators/assignment-target|g" \
    -e "s|@/generators/python/safe-int|@/features/blockly/core/generators/python/safe-int|g" \
    -e "s|'\./bit'|'./bitwise'|g" \
    -e "s|'\./postquantum'|'./post-quantum'|g" \
    -e "s|'\.\./postquantum/|'../post-quantum/|g" \
    -e "s|'\.\./bit/|'../bitwise/|g" \
    "$1"
}

# 仅 blocks/ 目录不需要相对目录映射（目录名两边一致）；generators/ 需要。
# 调用方按需决定：blocks 文件传 false（跳过相对映射），generators 文件传 true。
fix_imports_blocks() {
  sed -i \
    -e "s|@/constants/block-types|@/features/blockly/core/constants/block-types|g" \
    -e "s|@/constants/sbox-presets|@/features/blockly/core/constants/sbox-presets|g" \
    -e "s|@/constants/grid-shape|@/features/blockly/core/constants/grid-shape|g" \
    -e "s|@/constants/list-bridge|@/features/blockly/core/constants/list-bridge|g" \
    -e "s|@/blocks/grid/grid-editor|@/features/blockly/core/blocks/grid/grid-editor|g" \
    -e "s|@/blocks/procedure/blocks|@/features/blockly/core/blocks/procedure/blocks|g" \
    -e "s|@/utils/migration|@/features/blockly/core/utils/migration|g" \
    -e "s|@/utils/project-context|@/features/blockly/core/utils/project-context|g" \
    -e "s|@/utils/toolbox-config|@/features/blockly/core/utils/toolbox-config|g" \
    -e "s|@/generators/assignment-target|@/features/blockly/core/generators/assignment-target|g" \
    "$1"
}

# 提取一个文件的导出名集合（声明式导出 + export {...} 列表；export * 记为 __STAR__）。
# 只看"名字"，不看内容——镜像会改写 import 路径，但导出名应当两边一致。
exports_of() {
  awk '
  function collect(s,   n, i, p, parts) {
    n = split(s, parts, ",")
    for (i = 1; i <= n; i++) {
      p = parts[i]
      gsub(/^[ \t]+|[ \t]+$/, "", p)
      if (p == "") continue
      if (match(p, /[ \t]+as[ \t]+/)) p = substr(p, RSTART + RLENGTH)
      sub(/[^A-Za-z0-9_$].*$/, "", p)
      if (p != "") print p
    }
  }
  {
    line = $0
    if (inblock) {
      if (match(line, /}/)) { collect(substr(line, 1, RSTART - 1)); inblock = 0; next }
      collect(line); next
    }
    if (line ~ /^export[ \t]+(type[ \t]+)?\{/) {
      seg = substr(line, index(line, "{") + 1)
      if (match(seg, /}/)) { collect(substr(seg, 1, RSTART - 1)) }
      else { collect(seg); inblock = 1 }
      next
    }
    if (line ~ /^export[ \t]+\*/) { print "__STAR__"; next }
    if (match(line, /^export[ \t]+(async[ \t]+)?(const|let|var|function|class|interface|type|enum)[ \t]+/)) {
      t = substr(line, RLENGTH + 1)
      sub(/[^A-Za-z0-9_$].*$/, "", t)
      if (t != "") print t
      next
    }
  }
  ' "$1" | sort -u
}

# 打印镜像配对（CipherCat 源<TAB>metacrypt 目标），与步骤 1–3.6 的映射保持一致。
# 新增镜像项时必须同步这里，否则回归预检会漏检。
mirror_pairs() {
  ( cd "$CIPHER/src/blocks" && find . -name "*.ts" | sed 's|^\./||' | while read -r f; do
      printf '%s\t%s\n' "$CIPHER/src/blocks/$f" "$CORE/blocks/$f"
    done )
  for gen in python javascript; do
    ( cd "$CIPHER/src/generators/$gen" && find . -name "*.ts" | sed 's|^\./||' | while read -r f; do
        mf=$(printf '%s' "$f" | sed -e 's|^bit/|bitwise/|' -e 's|^postquantum/|post-quantum/|')
        printf '%s\t%s\n' "$CIPHER/src/generators/$gen/$f" "$CORE/generators/$gen/$mf"
      done )
  done
  for f in "$CIPHER"/src/generators/*.ts; do
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$f" "$CORE/generators/$(basename "$f")"
  done
  printf '%s\t%s\n' "$CIPHER/src/constants/block-types.ts" "$CORE/constants/block-types.ts"
  printf '%s\t%s\n' "$CIPHER/src/constants/sbox-presets.ts" "$CORE/constants/sbox-presets.ts"
  printf '%s\t%s\n' "$CIPHER/src/components/CryptoFunctionPanel.vue" \
    "$META/frontend/src/features/blockly/components/CryptoFunctionPanel.vue"
  # ProjectStore 的目标是 features/blockly/services/projects（与 core 平级），不是 core 内部；
  # 写错这里会让这一对的导出预检因目标文件不存在而被静默跳过。
  printf '%s\t%s\n' "$CIPHER/src/services/projects/ProjectStore.ts" \
    "$META/frontend/src/features/blockly/services/projects/ProjectStore.ts"
  for f in "$CIPHER"/src/runtime/*.ts; do
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$f" "$META/frontend/src/features/blockly/runtime/$(basename "$f")"
  done
  for f in "$CIPHER"/src/runtime/contracts/*.ts; do
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$f" "$META/frontend/src/features/blockly/runtime/contracts/$(basename "$f")"
  done
  # 界面文案与块迁移器：源目录与镜像目录不同名（composables/locale → core/utils/locale），
  # 按文件 1:1 映射，目录内部的相对导入在两侧结构一致，不需要改写。
  for f in "$CIPHER"/src/composables/locale/*.ts; do
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$f" "$CORE/utils/locale/$(basename "$f")"
  done
  for f in "$CIPHER"/src/utils/migration/*.ts; do
    [ -f "$f" ] || continue
    printf '%s\t%s\n' "$f" "$CORE/utils/migration/$(basename "$f")"
  done
}

CIPHER="/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/CipherCat"
META="/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server"
CORE="$META/frontend/src/features/blockly/core"
# 同步会写入的四个根。守卫与写入段必须一一对应，新增写入段时要同步加进来：
#   [1][2][2.5][3] → CORE      [3.5] → COMPONENTS
#   [3.6] → PROJECT_PORT       [3.7] → RUNTIME（含 runtime/contracts/）
#   [3.8] → CORE/utils/{locale,migration}（两族各有独立写入根，见下）
COMPONENTS="$META/frontend/src/features/blockly/components"
PROJECT_PORT="$META/frontend/src/features/blockly/services/projects"
RUNTIME="$META/frontend/src/features/blockly/runtime"
SYNC_TARGETS=("$CORE" "$COMPONENTS" "$PROJECT_PORT" "$RUNTIME")
# 同步真正会写到的子树（blocks/ 与 generators/ 会按源目录 mkdir -p，新增子目录属正常情况）。
# 配对目标的路径必须落在这几个前缀内，否则这段映射一定指错了地方。
SYNC_WRITE_PREFIXES=("$CORE/blocks" "$CORE/generators" "$CORE/constants" "$COMPONENTS" "$PROJECT_PORT" "$RUNTIME" "$CORE/utils/locale" "$CORE/utils/migration")

# ─── 0. 预检：镜像区未提交改动（防静默覆盖）───
# 全量镜像会用 CipherCat 版本覆盖上述目录，metacrypt 侧任何未提交的本地修改会静默丢失。
# 2026-11-13 就因此删掉了 core/blocks/{hash,pq}/index.ts 里的分组导出，
# 导致 build:prod 报 "HASH_ALGORITHM_BLOCK_GROUPS is not exported"。
# 默认遇到脏就中止；确认可以丢弃后加 --overwrite-local 强跑。
OVERWRITE_LOCAL=0
for arg in "$@"; do
  [ "$arg" = "--overwrite-local" ] && OVERWRITE_LOCAL=1
done

# ─── 0a. 预检：导出回归（防静默删除"已提交"的 metacrypt 侧增量）───
# 工作树干净不代表安全：metacrypt 的增量若已提交（如 2026-10-21 的 1b7ef44 给
# core/blocks/{hash,pq}/index.ts 加了分组导出），git 检查完全看不见它，
# 下一次全量镜像照样把它覆盖掉，11-13 那次的构建失败就是这么来的。
# 判据：镜像目标里有、CipherCat 源里没有的导出名 —— 同步后必然消失。
MIRROR_LIST=$(mirror_pairs)
MIRROR_TARGETS=$(printf '%s\n' "$MIRROR_LIST" | cut -f2)
# 配对目标必须落在同步会写入的子树内：落在别处的映射不会报错，只会表现为 [ -f "$dst" ] 不成立、
# 被静默计入"跳过"，导出回归预检就此失效（旧版把 ProjectStore 指到 core/services/ 就是这样漏掉的）。
BAD_PAIR_DIR=""
while IFS=$'\t' read -r src dst; do
  ok=0
  for prefix in "${SYNC_WRITE_PREFIXES[@]}"; do
    case "$dst" in "$prefix"|"$prefix"/*) ok=1; break ;; esac
  done
  [ "$ok" -eq 1 ] || BAD_PAIR_DIR="${BAD_PAIR_DIR}${dst#"$META"/} ← src: ${src#"$CIPHER"/}"$'\n'
done <<< "$MIRROR_LIST"
if [ -n "$BAD_PAIR_DIR" ]; then
  echo "✗ 预检失败：以下配对目标不在同步写入的子树内，映射路径写错了（导出回归预检会因跳过而失效）："
  printf '%s' "$BAD_PAIR_DIR" | sed 's/^/    /'
  exit 1
fi
EXPORT_LOSS=""
PAIRS_CHECKED=0
PAIRS_SKIPPED=0
while IFS=$'\t' read -r src dst; do
  [ -f "$src" ] && [ -f "$dst" ] || { PAIRS_SKIPPED=$((PAIRS_SKIPPED + 1)); continue; }
  PAIRS_CHECKED=$((PAIRS_CHECKED + 1))
  extra=$(comm -13 <(exports_of "$src") <(exports_of "$dst") | grep -v '^__STAR__$' || true)
  if [ -n "$extra" ]; then
    EXPORT_LOSS="${EXPORT_LOSS}${dst#"$META"/}"$'\n'"$(printf '%s\n' "$extra" | sed 's/^/      /')"$'\n'
  fi
done <<< "$MIRROR_LIST"

# 覆盖统计：跳过数异常偏大通常意味着 mirror_pairs 的路径映射写错了（预检会静默失效）
if [ "$PAIRS_SKIPPED" -gt 0 ]; then
  echo "ℹ 导出回归预检：比对 $PAIRS_CHECKED 对，跳过 $PAIRS_SKIPPED 个尚无镜像对应文件的源文件"
fi

# ─── 0b. 报告：shared 但不在镜像范围的文件（只报告，不覆盖）───
# 除 blocks/、generators/ 外，metacrypt core 里还有与 CipherCat 同名的 utils/、constants/、
# components/ 文件，脚本从不镜像它们。这类文件在 CipherCat 侧修了 bug 后 metacrypt 永远收不到，
# 也没有任何提示。这里只报差异：小差异（≤20 行）通常就是一次没落到 metacrypt 的修复。
SHARED_TOTAL=0
SHARED_SAME=0
SHARED_SMALL=""
SHARED_LARGE=""
while IFS= read -r rel; do
  case "$rel" in
    components/*) dst="$META/frontend/src/features/blockly/$rel" ;;
    *) dst="$CORE/$rel" ;;
  esac
  src="$CIPHER/src/$rel"
  [ -f "$dst" ] && [ -f "$src" ] || continue
  # 已在镜像范围的由 0a 与同步步骤负责，不重复报告
  printf '%s\n' "$MIRROR_TARGETS" | grep -Fxq "$dst" && continue
  SHARED_TOTAL=$((SHARED_TOTAL + 1))
  if cmp -s "$src" "$dst"; then
    SHARED_SAME=$((SHARED_SAME + 1))
    continue
  fi
  d=$(diff -u "$src" "$dst" | grep -cE '^[+-][^+-]' || true)
  if [ "$d" -le 20 ]; then
    SHARED_SMALL="${SHARED_SMALL}      - ${rel} (${d} 行)"$'\n'
  else
    SHARED_LARGE="${SHARED_LARGE}${rel} "
  fi
done <<< "$( { ( cd "$CORE" && find utils services constants -name "*.ts" 2>/dev/null )
                ( cd "$META/frontend/src/features/blockly" && find components -maxdepth 1 -name "*.vue" 2>/dev/null ) } | sort )"

if [ "$SHARED_TOTAL" -gt 0 ]; then
  echo "ℹ shared 但未镜像（只报告，不覆盖）：比对 $SHARED_TOTAL，一致 $SHARED_SAME，差异 $((SHARED_TOTAL - SHARED_SAME))"
  if [ -n "$SHARED_SMALL" ]; then
    echo "    小差异 ≤20 行（通常是一次修复没落到 metacrypt，建议确认）："
    printf '%s' "$SHARED_SMALL"
  fi
  if [ -n "$SHARED_LARGE" ]; then
    echo "    大差异 >20 行（多为结构性分叉，如 migration/locale 拆分）：${SHARED_LARGE% }"
  fi
fi

if [ -n "$EXPORT_LOSS" ]; then
  if [ "$OVERWRITE_LOCAL" -eq 0 ]; then
    echo "✗ 预检失败：metacrypt 镜像区存在 CipherCat 没有的导出（同步后必被删除）："
    printf '%s' "$EXPORT_LOSS" | head -40
    echo ""
    echo "  这些增量只长在镜像区，下一次同步就会丢。处理方式三选一："
    echo "    a) 上移：把实现移到非镜像层（如 features/blockly/algorithms/），镜像文件只留转发；"
    echo "    b) 反向补齐：把同名导出加进 CipherCat 权威源，让镜像成为超集；"
    echo "    c) 确认可以丢弃 → 重跑：$(basename "$0") --overwrite-local"
    exit 1
  fi
  echo "⚠  --overwrite-local：以下导出将被删除"
  printf '%s' "$EXPORT_LOSS"
fi

DIRTY_LOCAL=$(git -C "$META" status --porcelain -- "${SYNC_TARGETS[@]}" 2>/dev/null || true)
if [ -n "$DIRTY_LOCAL" ]; then
  DIRTY_COUNT=$(printf '%s\n' "$DIRTY_LOCAL" | grep -c . || true)
  if [ "$OVERWRITE_LOCAL" -eq 0 ]; then
    echo "✗ 预检失败：同步写入目标内有 $DIRTY_COUNT 处未提交改动，继续同步会覆盖它们（前 15 条）："
    printf '%s\n' "$DIRTY_LOCAL" | head -15 | sed 's/^/    /'
    [ "$DIRTY_COUNT" -gt 15 ] && echo "    … 其余 $((DIRTY_COUNT - 15)) 条省略"
    echo ""
    echo "  处理方式二选一："
    echo "    a) 本地增量属于 metacrypt 专属逻辑 → 移到非镜像层（如 features/blockly/algorithms/），再从 core 删除；"
    echo "    b) 确认这些改动可以丢弃 → 重跑：$(basename "$0") --overwrite-local"
    exit 1
  fi
  echo "⚠  --overwrite-local：将覆盖以下未提交改动"
  printf '%s\n' "$DIRTY_LOCAL" | sed 's/^/    /'
fi

echo "=== CipherCat → metacrypt_server 同步（features/blockly/core 全量镜像）==="

# ─── 1. blocks/ 全量镜像（CipherCat 为权威源）───
echo "[1/4] blocks/ 全量镜像"
# 先清空目标 blocks 内容区（保留目录结构），再复制
# 注意：不能用 rm -rf 整个目录（可能有未跟踪文件），改为：
#   a) 复制 CipherCat 全部 .ts
#   b) 删除 metacrypt 中 CipherCat 不存在的 .ts（旧文件清理）
cd "$CIPHER/src/blocks"
find . -name "*.ts" | while read -r f; do
  mkdir -p "$CORE/blocks/$(dirname "$f")"
  cp "$f" "$CORE/blocks/$f"
  fix_imports_blocks "$CORE/blocks/$f"
done
# 删除 metacrypt 残留但 CipherCat 已不存在的块文件
(cd "$CORE/blocks" && find . -name "*.ts" | while read -r f; do
  [ -f "$CIPHER/src/blocks/$f" ] || { echo "  DEL blocks/$f"; rm "$f"; }
done)

# ─── 2. generators/python/ + generators/javascript/ 全量镜像（目录映射）───
echo "[2/4] generators/ 全量镜像（bit→bitwise, postquantum→post-quantum）"
for gen in python javascript; do
  cd "$CIPHER/src/generators/$gen"
  find . -name "*.ts" | while read -r f; do
    # 目录映射：CipherCat bit/ → metacrypt bitwise/，postquantum/ → post-quantum/
    mf=$(echo "$f" | sed -e 's|^\./bit/|./bitwise/|' -e 's|^\./postquantum/|./post-quantum/|')
    mkdir -p "$CORE/generators/$gen/$(dirname "$mf")"
    cp "$f" "$CORE/generators/$gen/$mf"
    fix_imports "$CORE/generators/$gen/$mf"
  done
  # 删除 metacrypt 残留旧文件（按映射后路径比对）
  (cd "$CORE/generators/$gen" && find . -name "*.ts" | while read -r f; do
    cf=$(echo "$f" | sed -e 's|^\./bitwise/|./bit/|' -e 's|^\./post-quantum/|./postquantum/|')
    [ -f "$CIPHER/src/generators/$gen/$cf" ] || { echo "  DEL generators/$gen/$f"; rm "$f"; }
  done)
done

# ─── 2.5 generators 根级共享文件（assignment-target.ts 等）───
# 旧脚本只镜像 generators/{python,javascript}/，根级共享文件缺位会让
# `@/generators/assignment-target` 这类导入在 metacrypt 侧解析到不存在的路径。
echo "[2.5/4] generators 根级共享文件"
for f in "$CIPHER"/src/generators/*.ts; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  cp "$f" "$CORE/generators/$base"
  fix_imports "$CORE/generators/$base"
  echo "  CP generators/$base"
done

# ─── 3. constants/ 镜像（保留 metacrypt 专属 mcl-highlight.ts）───
echo "[3/4] constants/"
cp "$CIPHER/src/constants/block-types.ts" "$CORE/constants/block-types.ts"
fix_imports_blocks "$CORE/constants/block-types.ts"
cp "$CIPHER/src/constants/sbox-presets.ts" "$CORE/constants/sbox-presets.ts"
fix_imports_blocks "$CORE/constants/sbox-presets.ts"
# IntList / grid 编辑弹层引进的两个常量表：块与生成器都直接 import，缺一个就整包解析失败
cp "$CIPHER/src/constants/grid-shape.ts" "$CORE/constants/grid-shape.ts"
fix_imports_blocks "$CORE/constants/grid-shape.ts"
cp "$CIPHER/src/constants/list-bridge.ts" "$CORE/constants/list-bridge.ts"
fix_imports_blocks "$CORE/constants/list-bridge.ts"

# ─── 3.5 Function Manager 面板（CipherCat 单源 → metacrypt features/blockly/components）───
echo "[3.5/4] Function Manager 面板（CryptoFunctionPanel.vue）"
cp "$CIPHER/src/components/CryptoFunctionPanel.vue" "$META/frontend/src/features/blockly/components/CryptoFunctionPanel.vue"
fix_imports "$META/frontend/src/features/blockly/components/CryptoFunctionPanel.vue"
sed -i 's|ciphercat_templates.json|function_templates.json|g' "$META/frontend/src/features/blockly/components/CryptoFunctionPanel.vue"

# ─── 3.6 项目存储端口（ProjectStore）—— 权威源在 CipherCat，metacrypt 只镜像接口 ───
# 只镜像 ProjectStore.ts（纯类型 + 错误类，零依赖）；
# httpProjectStore.ts / index.ts 是 metacrypt 专属实现，不覆盖。
# 目标路径是 features/blockly/services/projects（与 core 平级），不是 core 内部：
# metacrypt 的实现与组合根都在那里，写到 core/ 会生成不被引用的第三份副本。
echo "[3.6/4] 项目存储端口 ProjectStore.ts"
mkdir -p "$PROJECT_PORT"
cp "$CIPHER/src/services/projects/ProjectStore.ts" "$PROJECT_PORT/ProjectStore.ts"
cmp -s "$CIPHER/src/services/projects/ProjectStore.ts" "$PROJECT_PORT/ProjectStore.ts" \
  && echo "  OK services/projects/ProjectStore.ts（逐字节一致）" \
  || echo "  FAIL services/projects/ProjectStore.ts 未同步一致"

# ─── 3.7 运行链共享层（runtime/）—— 与 core 平级，不依赖 Blockly ───
# 为什么要单独一段：运行链（run-code + 两个 worker + 契约）没有任何宿主依赖，
# 只通过 RuntimeAssets 注入资源位置，所以它可以整目录镜像，而编辑器壳不能。
# 目标目录与 utils/ 里的旧 run-code.ts 并存期间，metacrypt 需自行切引用（见 METACRYPT-SYNC.md）。
echo "[3.7/4] 运行链共享层 runtime/"
mkdir -p "$RUNTIME/contracts"

sync_runtime() {
  for f in "$CIPHER"/src/runtime/*.ts; do
    base=$(basename "$f")
    cp "$f" "$RUNTIME/$base"
    # 别名转换：CipherCat @/runtime/… → metacrypt @/features/blockly/runtime/…
    # worker 内的 ./contracts/run-chain 是相对路径，两侧目录结构一致，无需改写。
    sed -i 's|@/runtime/|@/features/blockly/runtime/|g' "$RUNTIME/$base"
  done
  for f in "$CIPHER"/src/runtime/contracts/*.ts; do
    base=$(basename "$f")
    cp "$f" "$RUNTIME/contracts/$base"
    sed -i 's|@/runtime/|@/features/blockly/runtime/|g' "$RUNTIME/contracts/$base"
  done
}

sync_runtime
RUNTIME_FIRST=$(cd "$RUNTIME" && cat ./*.ts ./contracts/*.ts | md5sum | cut -d' ' -f1)
sync_runtime
RUNTIME_SECOND=$(cd "$RUNTIME" && cat ./*.ts ./contracts/*.ts | md5sum | cut -d' ' -f1)
if [ "$RUNTIME_FIRST" = "$RUNTIME_SECOND" ]; then
  echo "  OK runtime/ 幂等（md5 $RUNTIME_FIRST）"
else
  echo "  FAIL runtime/ 不幂等（$RUNTIME_FIRST → $RUNTIME_SECOND）"
fi
if grep -rq '@/runtime/' "$RUNTIME"; then
  echo "  FAIL runtime/ 仍有未转换的 @/runtime/ 别名"
else
  echo "  OK runtime/ 别名已全部转换"
fi

# ─── 3.8 界面文案 locale/ 与块迁移器 migration/ —— 权威源在 CipherCat ───
# 这两族此前只存在于 metacrypt 的镜像区（那里自行拆了文件），CipherCat 侧一直是
# 926 / 835 行的单文件。2026-11-15 把拆分搬回权威源后，两族按文件 1:1 镜像：
#   src/composables/locale/*.ts → core/utils/locale/*.ts
#   src/utils/migration/*.ts    → core/utils/migration/*.ts
# 目标不取 core/composables/locale 是刻意的：metacrypt 的界面代码一直从
# `@/features/blockly/core/utils/locale` 取 ui / uiLocaleRef，保持路径才能零改动切换。
echo "[3.8/4] 界面文案 locale/ 与块迁移器 migration/"
sync_family() {
  src_dir="$1"; dst_dir="$2"; label="$3"
  mkdir -p "$dst_dir"
  for f in "$src_dir"/*.ts; do
    [ -f "$f" ] || continue
    cp "$f" "$dst_dir/$(basename "$f")"
  done
  # 权威源已删除的文件在镜像里也要删：残留模块没有任何引用，却仍会被构建打进去
  for f in "$dst_dir"/*.ts; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [ -f "$src_dir/$base" ] || { echo "  DEL $label/$base"; rm "$f"; }
  done
  echo "  OK $label/（$(ls -1 "$dst_dir"/*.ts 2>/dev/null | wc -l) 个文件）"
}

sync_family "$CIPHER/src/composables/locale" "$CORE/utils/locale" "utils/locale"
sync_family "$CIPHER/src/utils/migration" "$CORE/utils/migration" "utils/migration"

# 旧平板文件必须删：core/utils/locale.ts 会遮蔽 core/utils/locale/index.ts，
# 让 `@/features/blockly/core/utils/locale` 仍解析回旧内容——同步看着成功，实际没生效。
for f in "$CORE"/utils/locale*.ts "$CORE"/utils/migration*.ts; do
  [ -f "$f" ] || continue
  echo "  DEL utils/$(basename "$f")（被目录版取代）"
  rm "$f"
done

# 别名回归：镜像区不允许残留 CipherCat 侧的裸别名。
# fix_imports 的映射表是手工枚举的，新增块若引用了新的 @/blocks/* 、@/constants/* 条目
# 而这里没跟上，同步本身不会报错，只会让 metacrypt 的 type-check / 打包在别人机器上炸
# （2026-11-15 的 grid-shape、list-bridge、grid-editor 就是这么漏的）。宁可在同步时红。
BARE_ALIAS=$(grep -rnE "from '@/(blocks|constants|generators|utils|runtime)/" "$CORE" --include='*.ts' 2>/dev/null || true)
if [ -n "$BARE_ALIAS" ]; then
  echo "  FAIL 镜像区仍有未转换的裸别名（fix_imports 漏配，需补映射）："
  printf '%s\n' "$BARE_ALIAS" | sed "s|$CORE/|    |" | head -10
else
  echo "  OK 镜像区别名已全部转换"
fi

# ─── 4. 核对清单 ───
echo "[4/4] 核对"
echo ""
echo "已同步（自动）：blocks/ 全部、generators/{python,javascript}/ 全部 + generators 根级 *.ts、constants/block-types.ts + sbox-presets.ts、services/projects/ProjectStore.ts、runtime/（契约 + 运行链 + 两个 worker）"
echo ""

# ─── 手工核对项（同步后需检查）───
echo "⚠️  以下 metacrypt 专属/手工文件未被覆盖，需人工核对："
echo ""
echo " 1. $CORE/blocks/remaining.ts 中的 MCL 专属块（base64/hex 等）"
echo "    → 若 CipherCat 已删同名块，metacrypt 侧对应生成器也会被删，需确认无残留引用"
echo ""
echo " 2. $CORE/utils/toolbox-config.ts"
echo "    → metacrypt 有 MCL 专属类目，全量镜像未覆盖 utils/；确认块类目仍完整"
echo ""
echo " 3. $CORE/utils/workspace/*.ts（blockly-patches.ts 等）"
echo "    → metacrypt 专属逻辑保留；utils/locale、utils/migration 已改为镜像（见 [3.8]）"
echo ""
echo " 4. metacrypt 侧 demos/（如有）引用已删块（pq_*_vec、gf_mul）需清理"
echo ""
echo "验证：cd $META/frontend && npm run build"
