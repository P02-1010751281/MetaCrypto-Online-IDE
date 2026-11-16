#!/usr/bin/env bash
# 复跑本轮的四个变异：每个变异都必须让门禁变红，且只红对应的那一条。
# 用法：bash reproduce-mutations.sh   （在 metacrypt_server/frontend 下跑）
set -u
FE=$(cd "$(dirname "$0")/../../../../../metacrypt_server/frontend" && pwd)
cd "$FE" || exit 1
LOCALE=src/features/blockly/core/utils/locale/ui-messages.ts
STATUS=src/features/blockly/views/editor/EditorStatusBar.vue
VIEW=src/features/blockly/views/EditorView.vue
COVERAGE=../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts
CHROME=../tests/frontend/unit/blockly/components/editor-chrome-locale.test.ts

backup() { cp "$1" "/tmp/$(basename "$1").mutbak"; }
restore() { cp "/tmp/$(basename "$1").mutbak" "$1"; cmp "/tmp/$(basename "$1").mutbak" "$1" && echo "  已逐字节还原 $1"; }

echo "--- 变异 A：en 侧删掉 filesUnit（缺键 + 键集不一致）"
backup "$LOCALE"
python3 - "$LOCALE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(); i = s.index('\n  en: {'); zh, en = s[:i], s[i:]
en = en.replace("    filesUnit: 'files',\n", ""); p.write_text(zh + en)
PY
npx vitest run "$COVERAGE" 2>&1 | grep -E "×|Tests  |filesUnit" | head -6
restore "$LOCALE"

echo "--- 变异 B：源码引用一个字典里没有的键"
backup "$VIEW"
python3 - "$VIEW" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
p.write_text(s.replace('<span class="crumb-project">', '<span class="crumb-project" :data-mutation="ui(\'bogusChromeKey\')">', 1))
PY
npx vitest run "$COVERAGE" 2>&1 | grep -E "×|Tests  |bogusChromeKey" | head -6
restore "$VIEW"

echo "--- 变异 C：英文文案写进中文"
backup "$LOCALE"
python3 - "$LOCALE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
p.write_text(s.replace("    statusReady: 'Ready',", "    statusReady: '准备就绪',"))
PY
npx vitest run "$COVERAGE" 2>&1 | grep -E "×|Tests  |statusReady" | head -6
restore "$LOCALE"

echo "--- 变异 D：状态条文案退回硬编码（渲染门禁）"
backup "$STATUS"
python3 - "$STATUS" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
p.write_text(s.replace("{{ filePath || ui('noFileOpen') }}", "{{ filePath || '文件未打开' }}"))
PY
npx vitest run "$CHROME" 2>&1 | grep -E "×|Tests  |未打开文件" | head -6
restore "$STATUS"

echo "--- 还原后复跑两条门禁"
npx vitest run "$COVERAGE" "$CHROME" 2>&1 | grep -E "Tests  |Test Files" | head -4
