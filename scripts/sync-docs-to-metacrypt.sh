#!/usr/bin/env bash
# =============================================================================
# sync-docs-to-metacrypt.sh — 通用文档单源同步（CipherCat → metacrypt_server）
#
# 两项目共享 Blockly 核心，以下文档在 CipherCat 维护、同步到 metacrypt：
#   docs/guides/{CAPABILITY-MAP,TYPE-SYSTEM,BLOCKLY-GUIDE,DEMO}.md(+en)
#   docs/blocks/（8 份块文档 + BLOCK-IO-CONTRACT.json，双语）
#   docs/standards/（入口页与规范 + 算法标准目录，纯知识库）
#   docs/audits/（审计报告，standards/ 与 project/ 两类，双语）
#   docs/demos/（5 份算法搭建文档 + ENDPOINT-MATRIX.md，双语）
#   docs/research/（调研报告）
#   paper/references/（调研报告引用的标准与论文 PDF）
#   demos/（Blockly 工作区示例文件 + README，metacrypt 编辑器可直接导入）
#
# 不同步（平台专属）：USER-GUIDE / TUTORIALS / ARCHITECTURE / DEVELOPMENT（入口、路由及任务流程不同）
# 链接约定：同步保持相对目录结构（guides/ + blocks/ + audits/ + standards/ + demos/ + research/），
#           内部相对链接在目标仓库同样有效；同步后运行全仓死链检查验证。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CC_ROOT="$(dirname "$SCRIPT_DIR")"
MC_ROOT="${MC_ROOT:-/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server}"

if [ ! -d "$MC_ROOT/.git" ]; then
  echo "ERROR: metacrypt_server not found at $MC_ROOT (set MC_ROOT to override)" >&2
  exit 1
fi

echo "== 同步 guides/ 通用文档 =="
mkdir -p "$MC_ROOT/docs/guides"
for f in CAPABILITY-MAP TYPE-SYSTEM BLOCKLY-GUIDE; do
  for ext in md en.md; do
    src="$CC_ROOT/docs/guides/$f.$ext"
    if [ -f "$src" ]; then
      cp "$src" "$MC_ROOT/docs/guides/$f.$ext"
      echo "  guides/$f.$ext"
    fi
  done
done

# AUDIT-REPORT 已归入 docs/audits/project/；目标仓库可能还留着 guides/ 下的旧副本，
# 这里显式删除，否则旧路径会继续被目标仓库的 INDEX/DEVELOPMENT 引用成死链。
for ext in md en.md; do
  if [ -f "$MC_ROOT/docs/guides/AUDIT-REPORT.$ext" ]; then
    rm "$MC_ROOT/docs/guides/AUDIT-REPORT.$ext"
    echo "  guides/AUDIT-REPORT.$ext removed (moved to audits/project/)"
  fi
done

echo "== 同步 blocks/ 双语块文档 =="
for f in INDEX bitwise-logic data-encoding ecc-sbox hash numtheory post-quantum symmetric zuc; do
  for ext in md en.md; do
    src="$CC_ROOT/docs/blocks/$f.$ext"
    if [ -f "$src" ]; then
      cp "$src" "$MC_ROOT/docs/blocks/$f.$ext"
      echo "  blocks/$f.$ext"
    fi
  done
done
# BLOCK-IO-CONTRACT.json 是积木输入输出类型契约，内容对象属 blocks/；
# standards/CONFORMANCE-INVENTORY.md 以 ./BLOCK-IO-CONTRACT.json 引用同目录，迁移后需同源同步。
cp "$CC_ROOT/docs/blocks/BLOCK-IO-CONTRACT.json" "$MC_ROOT/docs/blocks/BLOCK-IO-CONTRACT.json"
echo "  blocks/BLOCK-IO-CONTRACT.json (generated)"

echo "== 同步 standards/ 算法规范知识库 =="
mkdir -p "$MC_ROOT/docs/standards"
# Copy canonical files without deleting target-only material (e.g. CNSA tracking).
# Obsolete target files require an explicit reviewed removal, not a whole-tree wipe.
cp -r "$CC_ROOT/docs/standards/." "$MC_ROOT/docs/standards/"
echo "  standards/ canonical files copied; target-only files preserved"

# 上面这 12 个文件已从 standards/ 迁到 audits/ 或 blocks/、demos/：cp -r 不删目标端多余
# 文件，所以目标仓库会留着旧副本。逐个显式删除，清单即迁移清单；将来再迁文件时同步补项。
STANDARDS_MIGRATED=(
  'SOURCE-LAYERS.md' 'SOURCE-LAYERS.en.md'
  'SOURCE-QUALITY-AUDIT.md' 'SOURCE-QUALITY-AUDIT.en.md'
  'SOURCE-SPLIT-COVERAGE.md' 'SOURCE-SPLIT-COVERAGE.en.md'
  'SOURCE-SPLIT-INVENTORY.md' 'SOURCE-SPLIT-INVENTORY.en.md'
  'REEXTRACTION-REPORT.md' 'REEXTRACTION-REPORT.en.md'
  'ENDPOINT-MATRIX.md'
  'BLOCK-IO-CONTRACT.json'
)
for f in "${STANDARDS_MIGRATED[@]}"; do
  if [ -e "$MC_ROOT/docs/standards/$f" ]; then
    rm "$MC_ROOT/docs/standards/$f"
    echo "  standards/$f removed (migrated out of standards/)"
  fi
done

echo "== 同步 audits/ 审计报告 ================="
# 审计报告是与 standards/ 平级的一级目录：standards/ 放标准文档审计，project/ 放
# 项目全局审计。整树镜像（--delete）保证目标端与源端严格一致，不留已撤下的旧报告。
mkdir -p "$MC_ROOT/docs/audits"
rsync -a --delete "$CC_ROOT/docs/audits/" "$MC_ROOT/docs/audits/"
echo "  docs/audits/（$(find "$MC_ROOT/docs/audits" -name '*.md' | wc -l) 个文件）"

echo "== 同步 docs/demos/ 搭建文档 ==============="
mkdir -p "$MC_ROOT/docs/demos"
for f in sm4 aes hash sm2 post-quantum; do
  for ext in md en.md; do
    src="$CC_ROOT/docs/demos/$f.$ext"
    if [ -f "$src" ]; then
      cp "$src" "$MC_ROOT/docs/demos/$f.$ext"
      echo "  docs/demos/$f.$ext"
    fi
  done
done
# ENDPOINT-MATRIX.md 由 verify-templates.ts 生成，standards/CONFORMANCE-INVENTORY.md
# 用 ../demos/ENDPOINT-MATRIX.md 指向它；漏同步会让目标仓库出现死链。
cp "$CC_ROOT/docs/demos/ENDPOINT-MATRIX.md" "$MC_ROOT/docs/demos/ENDPOINT-MATRIX.md"
echo "  docs/demos/ENDPOINT-MATRIX.md (generated)"

echo "== 同步 docs/build/ 分步拼装指南 ==========="
mkdir -p "$MC_ROOT/docs/build"
cp -r "$CC_ROOT/docs/build/." "$MC_ROOT/docs/build/"
echo "  docs/build/（$(ls "$CC_ROOT/docs/build" | wc -l) 个文件）"

# guides/DEMO.md（演示索引）——链接适配：ARCHITECTURE/DEVELOPMENT 不通用，
# metacrypt 的对应文档在 docs/ 顶层（../ARCHITECTURE.md），而非 guides/ 内
for ext in md en.md; do
  cp "$CC_ROOT/docs/guides/DEMO.$ext" "$MC_ROOT/docs/guides/DEMO.$ext"
  # en 版指向 metacrypt 中文版（metacrypt 无英文平台文档）
  sed -i \
    -e 's|(\./ARCHITECTURE\.md)|(../ARCHITECTURE.md)|g' \
    -e 's|(\./DEVELOPMENT\.md)|(../DEVELOPMENT.md)|g' \
    -e 's|(\./ARCHITECTURE\.en\.md)|(../ARCHITECTURE.md)|g' \
    -e 's|(\./DEVELOPMENT\.en\.md)|(../DEVELOPMENT.md)|g' \
    "$MC_ROOT/docs/guides/DEMO.$ext"
  echo "  guides/DEMO.$ext (link-adapted)"
done

echo "== 同步 demos/ 工作区示例 =================="
mkdir -p "$MC_ROOT/demos"
# 工作区 JSON + tests.json（官方向量期望值）
for f in "$CC_ROOT"/demos/*.json; do
  cp "$f" "$MC_ROOT/demos/"
  echo "  demos/$(basename "$f")"
done

echo "== 同步可复用的 Blockly 界面插图 ============"
mkdir -p "$MC_ROOT/frontend/public/docs-assets/tutorials"
for f in 02-editor-empty 03-import-menu 04-editor-imported 05-generated-python 08-function-demo 09-function-generated; do
  cp "$CC_ROOT/public/docs-assets/tutorials/$f.png" "$MC_ROOT/frontend/public/docs-assets/tutorials/$f.png"
  echo "  frontend/public/docs-assets/tutorials/$f.png"
done
# 06-docs-center-current.png is specific to CipherCat's docs UI; do not sync it.

echo "== 同步演示教程实机截图 ================"
mkdir -p "$MC_ROOT/frontend/public/docs-assets/demo-guides"
for f in aes-demo-editor hash-demo-editor post-quantum-demo-editor sm2-demo-editor sm4-demo-editor; do
  cp "$CC_ROOT/public/docs-assets/demo-guides/$f.png" "$MC_ROOT/frontend/public/docs-assets/demo-guides/$f.png"
  echo "  frontend/public/docs-assets/demo-guides/$f.png"
done

for f in "$CC_ROOT"/demos/procedures/*.json; do
  mkdir -p "$MC_ROOT/demos/procedures"
  cp "$f" "$MC_ROOT/demos/procedures/"
  echo "  demos/procedures/$(basename "$f")"
done

echo "== 同步 research/ 调研报告 ================="
mkdir -p "$MC_ROOT/docs/research"
cp "$CC_ROOT/docs/research/CRYPTO-RESEARCH-2026-09.md" "$MC_ROOT/docs/research/"
echo "  research/CRYPTO-RESEARCH-2026-09.md"
cp "$CC_ROOT/docs/research/CRYPTO-RESEARCH-2026-09-12.md" "$MC_ROOT/docs/research/"
echo "  research/CRYPTO-RESEARCH-2026-09-12.md"
cp "$CC_ROOT/docs/research/CRYPTO-RESEARCH-2026-09-25.md" "$MC_ROOT/docs/research/"
echo "  research/CRYPTO-RESEARCH-2026-09-25.md"

echo "== 同步 research/ 文献包 =================="
mkdir -p "$MC_ROOT/paper/references"
cp "$CC_ROOT/paper/references/README.md" "$MC_ROOT/paper/references/"
cp "$CC_ROOT"/paper/references/*.pdf "$MC_ROOT/paper/references/"
echo "  paper/references/ ($(find "$CC_ROOT/paper/references" -name '*.pdf' | wc -l) PDFs)"

echo "== 同步 NIST 研究来源索引与 PDF ============="
mkdir -p "$MC_ROOT/docs/research/sources"
cp -r "$CC_ROOT/docs/research/sources/." "$MC_ROOT/docs/research/sources/"
echo "  docs/research/sources/ (index + source PDFs)"

for ext in md en.md; do
  cp "$CC_ROOT/demos/README.$ext" "$MC_ROOT/demos/README.$ext"
  echo "  demos/README.$ext"
done

echo "== 平台专属用户指南保留目标仓库版本 =="
echo "  USER-GUIDE / TUTORIALS 不同步：入口、路由和测评流程按目标平台维护，不做全仓品牌替换。"

echo "== 降级 CipherCat 专属证据链接 ============="
# 共享文档在 CipherCat 内链接到 src/、tests/、scripts/ 的真实文件；metacrypt
# 仓库没有这些路径，原样同步会变成死链。目标仓库里把这类链接降级为
# 「文本（源码路径：路径）」的代码标记，保留出处但不留死链；标记里不写仓库名，
# 避免平台文档出现另一个仓库的名字。
# 只处理本次同步过去的文件，避免改写目标仓库自有文档。
sync_targets() {
  find "$MC_ROOT/docs/standards" "$MC_ROOT/docs/blocks" "$MC_ROOT/docs/demos" "$MC_ROOT/docs/build" "$MC_ROOT/docs/audits" -name '*.md' -print0 2>/dev/null
  for f in CAPABILITY-MAP TYPE-SYSTEM BLOCKLY-GUIDE DEMO; do
    for ext in md en.md; do
      [ -f "$MC_ROOT/docs/guides/$f.$ext" ] && printf '%s\0' "$MC_ROOT/docs/guides/$f.$ext"
    done
  done
}
# grep 无输出时退出 1，在 `set -euo pipefail` 下会中断脚本；用 `|| true` 放行空集合。
{ sync_targets | grep -zv '\.en\.md$' || true; } \
  | xargs -0 -r perl -0pi -e 's/\[([^\]]*)\]\((?:\.\.\/)+((?:tests|src|scripts)\/[^)\s]*)\)/$1（源码路径：`$2`）/g'
{ sync_targets | grep -z '\.en\.md$' || true; } \
  | xargs -0 -r perl -0pi -e 's/\[([^\]]*)\]\((?:\.\.\/)+((?:tests|src|scripts)\/[^)\s]*)\)/$1 (source path: `$2`)/g'
echo "  CipherCat-only evidence links de-linked in target docs (marked as 源码路径)"

echo "== 目标仓库去掉开发仓库名 ================"
# 平台文档面向 Metacrypto 读者，标题与正文出现另一个仓库名会让人以为是两套产品。
# 这里只改写本次同步过去的文件；调研/审计这类开发文档的叙述保留原样。
# 中文文档
{ sync_targets | grep -zv '\.en\.md$' || true; } | xargs -0 -r perl -0pi \
  -e 's/^## (\d+\.?\s*)?CipherCat\s*/## ${1}项目/gm;' \
  -e 's/\| CipherCat 状态 \|/| 项目状态 |/g;' \
  -e 's/\| CipherCat 前端 \|/| 平台前端 |/g;' \
  -e 's/前端 CipherCat/平台前端/g;' \
  -e 's/CipherCat 前端/平台前端/g;' \
  -e 's/CipherCat 块：/项目块：/g;' \
  -e 's/CipherCat：/项目块：/g;' \
  -e 's/（CipherCat /（/g;' \
  -e 's/CipherCat 的/本项目的/g;' \
  -e 's/CipherCat 对/本项目对/g;' \
  -e 's/CipherCat 基于/本项目基于/g;' \
  -e 's/CipherCat 整体/本项目整体/g;' \
  -e 's/CipherCat 作为/本项目作为/g;' \
  -e 's/CipherCat 当前/本项目当前/g;' \
  -e 's/CipherCat 已有/本项目已有/g;' \
  -e 's/CipherCat 积木体系/本项目积木体系/g;' \
  -e 's/CipherCat Blockly 原语/Blockly 原语/g;' \
  -e 's/CipherCat 实测/实测/g;' \
  -e 's/CipherCat ECDH/本项目 ECDH/g;' \
  -e 's/CipherCat 算法实现/本项目算法实现/g;' \
  -e 's/CipherCat 或/本项目或/g;' \
  -e 's/CipherCat 教学与科研定位/本项目教学与科研定位/g;' \
  -e 's/当前本项目/本项目/g;'
# 英文文档
{ sync_targets | grep -z '\.en\.md$' || true; } | xargs -0 -r perl -0pi \
  -e 's/^## (\d+\.?\s*)?CipherCat\s*/## ${1}Project /gm;' \
  -e 's/CipherCat’s/Project’s/g;' \
  -e 's/CipherCat\x27s/the project\x27s/g;' \
  -e 's/\bCipherCat\b/the project/g;' \
  -e 's/\bthe the project\b/the project/g;' \
  -e 's/(^|[.!?]\s+)the project/${1}The project/gm;'
echo "  repository name removed from platform-facing sections"

# guides/ 内不同步的平台文档：metacrypt 的架构与部署文档位于 docs/ 顶层。
{ sync_targets || true; } | xargs -0 -r perl -0pi \
  -e 's!\.\./guides/ARCHITECTURE(?:\.en)?\.md!../ARCHITECTURE.md!g;' \
  -e 's!\.\./guides/SETUP(?:\.en)?\.md!../DEPLOYMENT.md!g;'
echo "  guides/ARCHITECTURE and guides/SETUP links remapped to target docs/"

echo "== 同步完成 =="
echo "提示：backend/docs 是历史冗余副本，不由此脚本生成；同步后需审阅 docs/INDEX.md 并运行死链检查。"
