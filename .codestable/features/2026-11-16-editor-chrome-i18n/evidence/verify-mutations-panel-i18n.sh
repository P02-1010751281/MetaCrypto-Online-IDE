#!/usr/bin/env bash
# 面板体 i18n 的变异验证：证明三条新断言真的会开火，而不是恒绿。
# 每个变异只打一处，跑对应门禁，然后逐字节还原（cmp 校验）。
set -u
P=/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects
MC=$P/metacrypt_server/frontend
BK=$P/.i18n-post-2026-11-16
cd "$MC" || exit 1

run() {  # $1 = 变异名, $2 = 测试文件路径
  echo "--- $1"
  npx vitest run "$2" 2>&1 | grep -E '✓|×|Tests +[0-9]|FAIL' | head -12
}

restore() {
  cp "$BK/$1" "$MC/$2"
  cmp "$BK/$1" "$MC/$2" && echo "  已逐字节还原 $1"
}

echo "=== 变异 A：把界面文案写回硬编码中文"
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/features/blockly/views/editor/EditorSidebar.vue')
s = p.read_text(encoding='utf-8')
old = "＋ {{ ui('addNew') }}"
assert s.count(old) == 1
p.write_text(s.replace(old, '＋ 新建'), encoding='utf-8')
PY
run "A 硬编码中文" ../tests/frontend/unit/blockly/locale/editor-chrome-no-hardcoded.test.ts
restore EditorSidebar.vue src/features/blockly/views/editor/EditorSidebar.vue

echo
echo "=== 变异 B：从英文包里删掉一个带占位符的键"
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/features/blockly/core/utils/locale/ui-messages.ts')
s = p.read_text(encoding='utf-8')
old = "    removeMemberConfirm: 'Remove member {name}?',\n"
assert s.count(old) == 1
p.write_text(s.replace(old, ''), encoding='utf-8')
PY
run "B 缺键" ../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts
restore ui-messages.ts src/features/blockly/core/utils/locale/ui-messages.ts

echo
echo "=== 变异 C：用 ui() 直接取一条带占位符的文案"
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/features/blockly/views/editor/useEditorProjectActions.ts')
s = p.read_text(encoding='utf-8')
old = "ElMessageBox.confirm(ui('closeFileConfirm'), ui('closeFile'), {"
assert s.count(old) == 1
p.write_text(s.replace(old, "ElMessageBox.confirm(ui('switchBranchConfirm'), ui('closeFile'), {"), encoding='utf-8')
PY
run "C 占位符泄漏" ../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts
restore useEditorProjectActions.ts src/features/blockly/views/editor/useEditorProjectActions.ts

echo
echo "=== 变异 D：用 uiFormat 取一条没有占位符的文案"
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/features/blockly/plugins/ui/builtin/commands.ts')
s = p.read_text(encoding='utf-8')
old = "label: uiFormat('openFileCommand', { path: file.path }),"
assert s.count(old) == 1
p.write_text(s.replace(old, "label: uiFormat('importWorkspace', { path: file.path }),"), encoding='utf-8')
PY
run "D 误用 uiFormat" ../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts
restore commands.ts src/features/blockly/plugins/ui/builtin/commands.ts

echo
echo "=== 变异 E：英文侧丢占位符（{name} 变空，英文界面会少一个变量）"
python3 - <<'INNER'
import pathlib
p = pathlib.Path('src/features/blockly/core/utils/locale/ui-messages.ts')
s = p.read_text(encoding='utf-8')
old = "    removeMemberConfirm: 'Remove member {name}?',"
assert s.count(old) == 1
p.write_text(s.replace(old, "    removeMemberConfirm: 'Remove member?',"), encoding='utf-8')
INNER
run "E 占位符不一致" ../tests/frontend/unit/blockly/locale/ui-messages-coverage.test.ts
restore ui-messages.ts src/features/blockly/core/utils/locale/ui-messages.ts

echo
echo "=== 还原后复跑全部三条门禁"
npx vitest run ../tests/frontend/unit/blockly/locale/ ../tests/frontend/unit/blockly/components/editor-chrome-locale.test.ts 2>&1 | tail -6
