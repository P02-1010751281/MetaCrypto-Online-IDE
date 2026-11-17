#!/usr/bin/env bash
# 在受限宿主上构建 MetaCrypto Online IDE 的 AppImage。
#
# 直接跑 `npx tauri build --bundles appimage` 会在三个与项目代码无关的
# 宿主环境问题上失败，本脚本逐个绕过：
#
#   1. FUSE 不可用 —— linuxdeploy 是 AppImage，挂载被拒
#      （fusermount: mount failed: Operation not permitted）。
#      解法：APPIMAGE_EXTRACT_AND_RUN=1，让 AppImage 自解压运行。
#
#   2. 内置 strip 太旧 —— 不认识新版 glibc 的 .relr.dyn 段
#      （unknown type [0x13] section '.relr.dyn'）。
#      解法：NO_STRIP=1，跳过 strip。
#
#   3. appimagetool 下载 runtime 不跟随 HTTP 302 ——
#      GitHub Release 已改为经 release-assets.githubusercontent.com 重定向，
#      appimagetool 内置下载器拿到 302 直接判定失败
#      （Failed to download runtime: server returned status code 302）。
#      解法：自己用 curl -L 取回 runtime，通过 LDAI_RUNTIME_FILE 交给插件。
#
# 三个解法都只影响构建环境，不改变应用本身与 tauri.conf.json。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
# AppDir 与产物名由 productName 派生（tauri.conf.json 的 "MetaCrypto Online IDE"），
# 改名或改 productName 时这三行必须同步，否则脚本会把旧路径当成"未生成"。
APP_DIR="$BUNDLE_DIR/MetaCrypto Online IDE.AppDir"
OUTPUT="$BUNDLE_DIR/MetaCrypto Online IDE_2.0.0_amd64.AppImage"
RUNTIME_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/ciphercat-appimage"
RUNTIME_FILE="$RUNTIME_CACHE/runtime-x86_64"
RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"

log() { printf '[build-appimage] %s\n' "$*"; }
fail() { printf '[build-appimage] 错误: %s\n' "$*" >&2; exit 1; }

# runtime 是 AppImage 的 ELF 头，约 900KB；缺失或损坏时才重新下载。
ensure_runtime() {
  mkdir -p "$RUNTIME_CACHE"
  if [ -s "$RUNTIME_FILE" ] && file "$RUNTIME_FILE" | grep -q 'ELF'; then
    log "复用已缓存的 runtime: $RUNTIME_FILE"
    return
  fi
  log "下载 AppImage runtime"
  # curl -L 跟随 302，这正是 appimagetool 内置下载器缺的能力。
  curl -fsSL --retry 3 --retry-delay 2 --max-time 300 -o "$RUNTIME_FILE.tmp" "$RUNTIME_URL" ||
    fail "下载 runtime 失败，请检查网络或手动放入 $RUNTIME_FILE"
  mv -f "$RUNTIME_FILE.tmp" "$RUNTIME_FILE"
  file "$RUNTIME_FILE" | grep -q ELF || fail "下载到的 runtime 不是 ELF: $RUNTIME_FILE"
}

ensure_runtime

# tauri 的 appimage 打包先在 bundle/appimage_deb/data 放一份 deb 式暂存树，再灌进 AppDir；
# 两处都是增量写入、从不清空。改名（productName 或 mainBinaryName）后旧名字的文件会留在里面，
# 被原样复制进新 AppDir，症状是 AppDir 根同时存在新旧两个 .desktop 与两套图标，
# appimagetool 报 "metacrypto-online-ide{.png,...} defined in desktop file but not found" 并拒绝出包。
# 故构建前清掉这两处暂存目录——它们只由 tauri build 重新生成，删掉无信息损失。
STALE_DIRS=("$BUNDLE_DIR" "src-tauri/target/release/bundle/appimage_deb")
for d in "${STALE_DIRS[@]}"; do
  case "$ROOT/$d" in
    "$ROOT"/src-tauri/target/release/bundle/*) ;;
    *) fail "拒绝清理 bundle 之外的路径: $ROOT/$d" ;;
  esac
  rm -rf -- "$ROOT/$d"
  log "清空暂存目录: $d"
done

log "构建并打包（tauri build --bundles appimage）"
# tauri build 仍可能失败：它自己调 appimagetool 时下载不到 runtime（不跟 HTTP 302），
# 或 linuxdeploy 因暂存目录残留而拒绝出包。失败时 AppDir 已完整生成，由下面的手动打包步骤接手。
# 2026-11-17 实测：暂存目录清理干净后，这一句直接 rc=0 出包，手动分支不会被触发。
export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=1
set +e
npx tauri build --bundles appimage
TAURI_STATUS=$?
set -e

[ -x "$APP_DIR/AppRun" ] || fail "AppDir 未生成（$APP_DIR），tauri build 在更早的阶段失败"
[ -x "$APP_DIR/usr/bin/metacrypto-online-ide" ] || fail "AppDir 内缺少主程序（mainBinaryName=metacrypto-online-ide）"

if [ "$TAURI_STATUS" -eq 0 ] && [ -f "$OUTPUT" ]; then
  log "tauri build 已直接出包: $OUTPUT"
  exit 0
fi

log "tauri build 退出码 $TAURI_STATUS，改为手动完成 AppImage 打包"

PLUGIN="$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage"
[ -f "$PLUGIN" ] || fail "缺少 linuxdeploy appimage 插件: $PLUGIN（请先跑一次 tauri build 让 CLI 下载）"

# 插件默认把产物写成 <name>-x86_64.AppImage，放在当前目录；
# 用 LDAI_OUTPUT 指定最终路径，避免在仓库根目录留下散落文件。
export LDAI_RUNTIME_FILE="$RUNTIME_FILE"
export LDAI_OUTPUT="$ROOT/$OUTPUT"
(cd "$BUNDLE_DIR" && "$PLUGIN" --appdir="$ROOT/$APP_DIR")

[ -f "$OUTPUT" ] || fail "插件未产出 $OUTPUT"
log "完成: $OUTPUT"
ls -lh "$OUTPUT"
