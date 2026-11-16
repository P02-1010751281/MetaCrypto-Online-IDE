#!/usr/bin/env python3
"""面板体 i18n 第二半：把 views/editor 与 plugins/ui/builtin 里剩余的硬编码界面文案
换成 ui() / uiFormat()。

设计：全部按「整行 strip 后相等」替换，保留原缩进；每条操作都带期望命中次数，
任何一条不匹配就整体中止、不写盘。这样比逐条手工 150 次 edit 更容易复核：
脚本本身就是改动清单。
"""
import pathlib
import sys

ROOT = pathlib.Path(
    '/run/media/user/6b058d20-a617-484d-b7c6-cd7146baf77c/Projects/metacrypt_server/frontend'
)
FEAT = ROOT / 'src/features/blockly'
LOCALE_IMPORT = "import { ui } from '@/features/blockly/core/utils/locale'"
LOCALE_IMPORT_FMT = "import { ui, uiFormat } from '@/features/blockly/core/utils/locale'"


def line_ops(text, ops):
    lines = text.split('\n')
    for old, new, expect in ops:
        hits = 0
        out = []
        for ln in lines:
            if ln.strip() == old:
                indent = ln[: len(ln) - len(ln.lstrip())]
                out.append(indent + new)
                hits += 1
            else:
                out.append(ln)
        assert hits == expect, f'line op 命中 {hits} 次，期望 {expect}: {old!r}'
        lines = out
    return '\n'.join(lines)


def text_ops(text, ops):
    for old, new, expect in ops:
        hits = text.count(old)
        assert hits == expect, f'text op 命中 {hits} 次，期望 {expect}: {old!r}'
        text = text.replace(old, new)
    return text


def ensure_import(text, line):
    """确保文件顶部有 locale 导入；已有 ui 导入的改成带 uiFormat 的形式。"""
    if line in text:
        return text
    if line.startswith('import { ui, uiFormat }') and LOCALE_IMPORT in text:
        return text.replace(LOCALE_IMPORT, LOCALE_IMPORT_FMT, 1)
    assert 'core/utils/locale' not in text, '文件已有别的 locale 导入，需人工处理'
    return line + '\n' + text


def patch(path, ops, kind='line', add_import=None):
    p = FEAT / path
    text = p.read_text(encoding='utf-8')
    text = line_ops(text, ops) if kind == 'line' else text_ops(text, ops)
    if add_import:
        text = ensure_import(text, add_import)
    p.write_text(text, encoding='utf-8')
    print(f'ok {path}')


# ── EditorSidebar：文件区菜单与操作按钮 ───────────────────────────────────────
patch('views/editor/EditorSidebar.vue', [
    ('＋ 新建', "＋ {{ ui('addNew') }}", 1),
    ("<button class=\"explorer-add secondary\" @click=\"emit('toggleImportMenu')\">导入</button>",
     "<button class=\"explorer-add secondary\" @click=\"emit('toggleImportMenu')\">{{ ui('import') }}</button>", 1),
    ('<button @click="emit(\'triggerExternalImport\')">导入代码文件</button>',
     '<button @click="emit(\'triggerExternalImport\')">{{ ui(\'importCodeFile\') }}</button>', 1),
    ('<button @click="emit(\'triggerPackageImport\')">导入项目包</button>',
     '<button @click="emit(\'triggerPackageImport\')">{{ ui(\'importProjectPackage\') }}</button>', 1),
    ('<button @click="emit(\'triggerImport\')">导入工作区</button>',
     '<button @click="emit(\'triggerImport\')">{{ ui(\'importWorkspace\') }}</button>', 1),
    ('<button @click="emit(\'createFile\', \'block\')">Blockly 文件</button>',
     '<button @click="emit(\'createFile\', \'block\')">{{ ui(\'createBlocklyFile\') }}</button>', 1),
    ('<button @click="emit(\'createFile\', \'python\')">Python 文件</button>',
     '<button @click="emit(\'createFile\', \'python\')">{{ ui(\'createPythonFile\') }}</button>', 1),
    ('<button @click="emit(\'createFile\', \'spec\')">规格文件</button>',
     '<button @click="emit(\'createFile\', \'spec\')">{{ ui(\'createSpecFile\') }}</button>', 1),
    ('<button @click="emit(\'createFile\', \'test\')">测试文件</button>',
     '<button @click="emit(\'createFile\', \'test\')">{{ ui(\'createTestFile\') }}</button>', 1),
    ("<span>{{ group.dir || '根目录' }}</span>", "<span>{{ group.dir || ui('rootDir') }}</span>", 1),
    ('设为入口', "{{ ui('setEntryFile') }}", 1),
    ('删除', "{{ ui('delete') }}", 1),
    ('<button title="检查项目" @click="emit(\'runCheck\')">检查</button>',
     '<button :title="ui(\'checkProject\')" @click="emit(\'runCheck\')">{{ ui(\'check\') }}</button>', 1),
    ('<button title="导出项目包" @click="emit(\'exportPackage\')">导出包</button>',
     '<button :title="ui(\'exportPackage\')" @click="emit(\'exportPackage\')">{{ ui(\'exportPackage\') }}</button>', 1),
    ('title="保存并测试"', ':title="ui(\'saveAndTest\')"', 1),
    ('保存并测试', "{{ ui('saveAndTest') }}", 1),
    ("{{ checkResult.fileCount }} {{ ui('filesUnit') }} · {{ checkResult.symbols.length }} 个函数 ·",
     "{{ checkResult.fileCount }} {{ ui('filesUnit') }} · {{ checkResult.symbols.length }} {{ ui('functionsUnit') }} ·", 1),
])

# ── editorProjectPresentation：角色标签 ──────────────────────────────────────
patch('views/editor/editorProjectPresentation.ts', [
    ("if (role === 'owner') return '所有者'", "if (role === 'owner') return ui('roleOwner')", 1),
    ("if (role === 'editor') return '编辑者'", "if (role === 'editor') return ui('roleEditor')", 1),
    ("if (role === 'viewer') return '只读'", "if (role === 'viewer') return ui('roleViewer')", 1),
    ("return '未知'", "return ui('roleUnknown')", 1),
], add_import=LOCALE_IMPORT)

# ── CommentsPanel ───────────────────────────────────────────────────────────
patch('plugins/ui/builtin/CommentsPanel.vue', [
    ("{{ host.snapshot.activeFilePath ? `当前文件：${host.snapshot.activeFilePath}` : '项目级评论' }}",
     "{{ host.snapshot.activeFilePath ? `${ui('commentCurrentFilePrefix')}${host.snapshot.activeFilePath}` : ui('projectLevelComments') }}", 1),
    ('placeholder="写下问题、建议或复核记录…"', ':placeholder="ui(\'commentPlaceholder\')"', 1),
    ('<button class="explorer-add" @click="addComment">发表评论</button>',
     '<button class="explorer-add" @click="addComment">{{ ui(\'postComment\') }}</button>', 1),
    ("<span>{{ comment.filePath || '项目' }} · {{ formatRevisionTime(comment.createdAt) }}</span>",
     "<span>{{ comment.filePath || ui('projectLabel') }} · {{ formatRevisionTime(comment.createdAt) }}</span>", 1),
    ("{{ comment.status === 'resolved' ? '重开' : '解决' }}",
     "{{ comment.status === 'resolved' ? ui('reopenComment') : ui('resolveComment') }}", 1),
    ('<button @click="deleteComment(comment)">删除</button>',
     '<button @click="deleteComment(comment)">{{ ui(\'delete\') }}</button>', 1),
    ("{{ loadingComments ? '加载中…' : '暂无评论' }}",
     "{{ loadingComments ? ui('loading') : ui('noComments') }}", 1),
    ("ElMessageBox.alert(error?.message || '读取评论失败', '项目评论')",
     "ElMessageBox.alert(error?.message || ui('commentLoadFailed'), ui('panelProjectComments'))", 1),
    ("ElMessageBox.alert(error?.message || '发表评论失败', '项目评论')",
     "ElMessageBox.alert(error?.message || ui('commentPostFailed'), ui('panelProjectComments'))", 1),
    ("ElMessageBox.alert(error?.message || '更新评论失败', '项目评论')",
     "ElMessageBox.alert(error?.message || ui('commentUpdateFailed'), ui('panelProjectComments'))", 1),
    ("ElMessageBox.alert(error?.message || '删除评论失败', '项目评论')",
     "ElMessageBox.alert(error?.message || ui('commentDeleteFailed'), ui('panelProjectComments'))", 1),
    ("await ElMessageBox.confirm('删除这条评论？', '项目评论', {",
     "await ElMessageBox.confirm(ui('deleteCommentConfirm'), ui('panelProjectComments'), {", 1),
    ("confirmButtonText: '删除',", "confirmButtonText: ui('delete'),", 1),
    ("cancelButtonText: '取消',", "cancelButtonText: ui('cancel'),", 1),
])

# ── MembersPanel ────────────────────────────────────────────────────────────
patch('plugins/ui/builtin/MembersPanel.vue', [
    ('我的角色：{{ roleLabel(host.snapshot.projectRole) }}',
     "{{ ui('myRolePrefix') }}{{ roleLabel(host.snapshot.projectRole) }}", 1),
    ('<input v-model="memberAccount" placeholder="用户账号" />',
     '<input v-model="memberAccount" :placeholder="ui(\'memberAccountPlaceholder\')" />', 1),
    ('<option value="editor">编辑者</option>', '<option value="editor">{{ ui(\'roleEditor\') }}</option>', 2),
    ('<option value="viewer">只读</option>', '<option value="viewer">{{ ui(\'roleViewer\') }}</option>', 2),
    ('<button type="submit" class="explorer-add">添加</button>',
     '<button type="submit" class="explorer-add">{{ ui(\'add\') }}</button>', 1),
    (':title="presenceByUser(member.userId)?.filePath || \'在线\'"',
     ':title="presenceByUser(member.userId)?.filePath || ui(\'online\')"', 1),
    ('title="移除成员"', ':title="ui(\'removeMember\')"', 1),
    ("{{ loadingMembers ? '加载中…' : '暂无成员' }}",
     "{{ loadingMembers ? ui('loading') : ui('noMembers') }}", 1),
    ("if (role === 'owner') return '所有者'", "if (role === 'owner') return ui('roleOwner')", 1),
    ("if (role === 'editor') return '编辑者'", "if (role === 'editor') return ui('roleEditor')", 1),
    ("if (role === 'viewer') return '只读'", "if (role === 'viewer') return ui('roleViewer')", 1),
    ("return '未知'", "return ui('roleUnknown')", 1),
    ("ElMessageBox.alert(error?.message || '读取项目成员失败', '项目成员')",
     "ElMessageBox.alert(error?.message || ui('memberLoadFailed'), ui('panelProjectMembers'))", 1),
    ("ElMessageBox.alert(error?.message || '添加成员失败', '项目成员')",
     "ElMessageBox.alert(error?.message || ui('memberAddFailed'), ui('panelProjectMembers'))", 1),
    ("ElMessageBox.alert(error?.message || '更新成员失败', '项目成员')",
     "ElMessageBox.alert(error?.message || ui('memberUpdateFailed'), ui('panelProjectMembers'))", 1),
    ("ElMessageBox.alert(error?.message || '移除成员失败', '项目成员')",
     "ElMessageBox.alert(error?.message || ui('memberRemoveFailed'), ui('panelProjectMembers'))", 1),
    ('`移除成员「${member.nickname || member.account}」？`,',
     "uiFormat('removeMemberConfirm', { name: member.nickname || member.account }),", 1),
    ("'项目成员',", "ui('panelProjectMembers'),", 1),
    ("{ confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' },",
     "{ confirmButtonText: ui('removeMember'), cancelButtonText: ui('cancel'), type: 'warning' },", 1),
], add_import=LOCALE_IMPORT_FMT)

# ── RevisionHistoryPanel ────────────────────────────────────────────────────
patch('plugins/ui/builtin/RevisionHistoryPanel.vue', [
    ("{{ branch.name }}{{ branch.isActive ? '（当前）' : '' }}",
     "{{ branch.name }}{{ branch.isActive ? ui('branchCurrentSuffix') : '' }}", 1),
    ('<button v-if="host.snapshot.canWrite" @click="createBranch">新建分支</button>',
     '<button v-if="host.snapshot.canWrite" @click="createBranch">{{ ui(\'newBranch\') }}</button>', 1),
    ('切换', "{{ ui('switchBranch') }}", 1),
    ('合并', "{{ ui('mergeBranch') }}", 1),
    ('＋ 创建快照', "＋ {{ ui('createSnapshot') }}", 1),
    ('<span>{{ formatRevisionTime(revision.createdAt) }} · {{ revision.fileCount }} 个文件</span>',
     "<span>{{ formatRevisionTime(revision.createdAt) }} · {{ revision.fileCount }} {{ ui('filesUnit') }}</span>", 1),
    ('恢复', "{{ ui('restore') }}", 1),
    ("{{ loadingRevisions ? '加载中…' : '暂无快照' }}",
     "{{ loadingRevisions ? ui('loading') : ui('noRevisions') }}", 1),
    ("ElMessageBox.alert(error?.message || '读取版本历史失败', '版本历史')",
     "ElMessageBox.alert(error?.message || ui('revisionsLoadFailed'), ui('panelRevisionHistory'))", 1),
    ("ElMessageBox.alert(error?.message || '恢复快照失败', '版本历史')",
     "ElMessageBox.alert(error?.message || ui('revisionRestoreFailed'), ui('panelRevisionHistory'))", 1),
    ("ElMessageBox.alert('快照已恢复', '版本历史')",
     "ElMessageBox.alert(ui('revisionRestored'), ui('panelRevisionHistory'))", 1),
    ("ElMessageBox.alert(error?.message || '读取分支失败', '版本分支')",
     "ElMessageBox.alert(error?.message || ui('branchesLoadFailed'), ui('branchTitle'))", 1),
    ("const { value } = await ElMessageBox.prompt('分支名称', '新建版本分支', {",
     "const { value } = await ElMessageBox.prompt(ui('branchNamePrompt'), ui('branchNameTitle'), {", 1),
    ("confirmButtonText: '创建',", "confirmButtonText: ui('create'),", 1),
    ("cancelButtonText: '取消',", "cancelButtonText: ui('cancel'),", 1),
    ("ElMessageBox.alert('分支已创建', '版本分支')",
     "ElMessageBox.alert(ui('branchCreated'), ui('branchTitle'))", 1),
    ("ElMessageBox.alert(error?.message || '创建分支失败', '版本分支')",
     "ElMessageBox.alert(error?.message || ui('branchCreateFailed'), ui('branchTitle'))", 1),
    ('`切换到「${branch.name}」？当前工作区会先创建自动快照。`,',
     "uiFormat('switchBranchConfirm', { name: branch.name }),", 1),
    ("'切换版本分支',", "ui('switchBranchTitle'),", 1),
    ("{ confirmButtonText: '切换', cancelButtonText: '取消', type: 'warning' },",
     "{ confirmButtonText: ui('switchBranch'), cancelButtonText: ui('cancel'), type: 'warning' },", 1),
    ("ElMessageBox.alert('分支已切换', '版本分支')",
     "ElMessageBox.alert(ui('branchSwitched'), ui('branchTitle'))", 1),
    ("ElMessageBox.alert(error?.message || '切换分支失败', '版本分支')",
     "ElMessageBox.alert(error?.message || ui('branchSwitchFailed'), ui('branchTitle'))", 1),
    ('`把「${branch.name}」合并到当前分支？同文件双方修改时会停止并列出冲突。`,',
     "uiFormat('mergeBranchConfirm', { name: branch.name }),", 1),
    ("'合并版本分支',", "ui('mergeBranchTitle'),", 1),
    ("{ confirmButtonText: '合并', cancelButtonText: '取消', type: 'warning' },",
     "{ confirmButtonText: ui('mergeBranch'), cancelButtonText: ui('cancel'), type: 'warning' },", 1),
    ("ElMessageBox.alert('分支已合并', '版本分支')",
     "ElMessageBox.alert(ui('branchMerged'), ui('branchTitle'))", 1),
    ("ElMessageBox.alert(error?.message || '合并分支失败', '版本分支')",
     "ElMessageBox.alert(error?.message || ui('branchMergeFailed'), ui('branchTitle'))", 1),
    ('`恢复「${revision.label}」会替换当前项目文件，恢复前会自动创建一份快照。`,',
     "uiFormat('restoreRevisionConfirm', { label: revision.label }),", 1),
    ("'恢复项目快照',", "ui('restoreRevisionTitle'),", 1),
    ("{ confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning' },",
     "{ confirmButtonText: ui('restore'), cancelButtonText: ui('cancel'), type: 'warning' },", 1),
], add_import=LOCALE_IMPORT_FMT)

# ── useEditorProjectActions ────────────────────────────────────────────────
patch('views/editor/useEditorProjectActions.ts', [
    ("const { value } = await ElMessageBox.prompt('项目名称', '重命名项目', {",
     "const { value } = await ElMessageBox.prompt(ui('projectName'), ui('renameProject'), {", 1),
    ("confirmButtonText: '重命名',", "confirmButtonText: ui('renameFile'),", 1),
    ("cancelButtonText: '取消',", "cancelButtonText: ui('cancel'),", 5),
    ("if (!resp || resp.code !== 200) throw new Error(resp?.msg || '重命名失败')",
     "if (!resp || resp.code !== 200) throw new Error(resp?.msg || ui('renameFailed'))", 1),
    ("ElMessageBox.alert(error?.message || '重命名失败', '重命名项目')",
     "ElMessageBox.alert(error?.message || ui('renameFailed'), ui('renameProject'))", 1),
    ("ElMessageBox.confirm('该文件有未保存修改，确定关闭？', '关闭文件', {",
     "ElMessageBox.confirm(ui('closeFileConfirm'), ui('closeFile'), {", 1),
    ("confirmButtonText: '关闭',", "confirmButtonText: ui('close'),", 1),
    ("await ElMessageBox.prompt('文件路径', '新建文件', {",
     "await ElMessageBox.prompt(ui('filePathPrompt'), ui('newFile'), {", 1),
    ("confirmButtonText: '创建',", "confirmButtonText: ui('create'),", 1),
    ("ElMessageBox.alert(error?.message || '创建文件失败', '新建文件')",
     "ElMessageBox.alert(error?.message || ui('createFileFailed'), ui('newFile'))", 1),
    ("ElMessageBox.alert(error?.message || '切换项目失败', '项目')",
     "ElMessageBox.alert(error?.message || ui('switchProjectFailed'), ui('projectLabel'))", 1),
    ("ElMessageBox.alert(error?.message || '新建项目失败', '项目')",
     "ElMessageBox.alert(error?.message || ui('createProjectFailed'), ui('projectLabel'))", 1),
    ('await ElMessageBox.confirm(`删除 ${file.path}？`, \'删除文件\', {',
     "await ElMessageBox.confirm(uiFormat('deleteFilePathConfirm', { path: file.path }), ui('deleteFileTitle'), {", 1),
    ("confirmButtonText: '删除',", "confirmButtonText: ui('delete'),", 1),
    ("ElMessageBox.alert(error?.message || '删除文件失败', '删除文件')",
     "ElMessageBox.alert(error?.message || ui('deleteFileFailed'), ui('deleteFileTitle'))", 1),
    ("ElMessageBox.alert(error?.message || '设置入口失败', '项目入口')",
     "ElMessageBox.alert(error?.message || ui('setEntryFailed'), ui('projectEntryTitle'))", 1),
    ("const { value } = await ElMessageBox.prompt('文件路径', '导入外部文件', {",
     "const { value } = await ElMessageBox.prompt(ui('filePathPrompt'), ui('importExternalFile'), {", 1),
    ("confirmButtonText: '导入',", "confirmButtonText: ui('import'),", 1),
    ("ElMessageBox.alert(error?.message || '导入外部文件失败', '导入外部文件')",
     "ElMessageBox.alert(error?.message || ui('importExternalFailed'), ui('importExternalFile'))", 1),
    ("ElMessageBox.alert(error?.message || '检查失败', '项目检查')",
     "ElMessageBox.alert(error?.message || ui('checkRunFailed'), ui('projectCheckTitle'))", 1),
], add_import=LOCALE_IMPORT_FMT)

# ── useEditorUiHost：抛错文案 ───────────────────────────────────────────────
patch('views/editor/useEditorUiHost.ts', [
    ("'当前没有可操作项目'", "ui('noActiveProject')", 1),
    ("'当前修改尚未保存，已取消版本操作'", "ui('unsavedVersionOpCancelled')", 1),
    ("'读取项目成员失败'", "ui('memberLoadFailed')", 1),
    ("'添加成员失败'", "ui('memberAddFailed')", 1),
    ("'更新成员失败'", "ui('memberUpdateFailed')", 1),
    ("'移除成员失败'", "ui('memberRemoveFailed')", 1),
    ("'读取评论失败'", "ui('commentLoadFailed')", 1),
    ("'发表评论失败'", "ui('commentPostFailed')", 1),
    ("'更新评论失败'", "ui('commentUpdateFailed')", 1),
    ("'删除评论失败'", "ui('commentDeleteFailed')", 1),
    ("'读取分支失败'", "ui('branchesLoadFailed')", 1),
    ("'读取版本历史失败'", "ui('revisionsLoadFailed')", 1),
    ("'创建分支失败'", "ui('branchCreateFailed')", 1),
    ("'切换分支失败'", "ui('branchSwitchFailed')", 1),
    ("'合并分支失败'", "ui('branchMergeFailed')", 1),
    ("'创建快照失败'", "ui('snapshotCreateFailed')", 1),
    ("'导出失败', '导出项目包'", "ui('exportError'), ui('exportPackage')", 1),
], kind='text', add_import=LOCALE_IMPORT)

# ── commands.ts：命令面板标签 ──────────────────────────────────────────────
patch('plugins/ui/builtin/commands.ts', [
    ("label: '保存当前文件'", "label: ui('saveCurrentFile')", 1),
    ("label: '保存并测试'", "label: ui('saveAndTest')", 1),
    ("label: '检查项目'", "label: ui('checkProject')", 1),
    ("label: '新建 Blockly 文件'", "label: ui('createBlocklyFile')", 1),
    ("label: '新建 Python 文件'", "label: ui('createPythonFile')", 1),
    ("label: '新建规格文件'", "label: ui('createSpecFile')", 1),
    ("label: '新建测试文件'", "label: ui('createTestFile')", 1),
    ("label: '切换到项目列表'", "label: ui('switchToProjects')", 1),
    ("label: '显示文件栏'", "label: ui('showFilesPanel')", 1),
    ("label: '显示 / 隐藏文件栏'", "label: ui('toggleFilesPanel')", 1),
    ("label: '查看版本历史'", "label: ui('viewRevisions')", 1),
    ("label: '查看项目成员'", "label: ui('viewMembers')", 1),
    ("label: '查看项目评论'", "label: ui('viewComments')", 1),
    ("label: '创建项目快照'", "label: ui('createProjectSnapshot')", 1),
    ("label: '打开函数管理'", "label: ui('openFunctions')", 1),
    ("label: '导入代码文件'", "label: ui('importCodeFile')", 1),
    ("label: '导入项目包'", "label: ui('importProjectPackage')", 1),
    ("label: '导入工作区'", "label: ui('importWorkspace')", 1),
    ("label: '导出项目包'", "label: ui('exportPackage')", 1),
    ("label: '导出当前工作区'", "label: ui('exportCurrentWorkspace')", 1),
    ("label: '重命名项目'", "label: ui('renameProject')", 1),
    ("label: '清空当前工作区'", "label: ui('clearWorkspace')", 1),
    ('label: `打开文件 ${file.path}`,', "label: uiFormat('openFileCommand', { path: file.path }),", 1),
], kind='text', add_import=LOCALE_IMPORT_FMT)

# ── snapshot.ts：快照流程对话框 ────────────────────────────────────────────
patch('plugins/ui/builtin/snapshot.ts', [
    ("const { value } = await ElMessageBox.prompt('快照说明', '创建项目快照', {",
     "const { value } = await ElMessageBox.prompt(ui('snapshotNote'), ui('createProjectSnapshot'), {", 1),
    ("confirmButtonText: '创建',", "confirmButtonText: ui('create'),", 1),
    ("cancelButtonText: '取消',", "cancelButtonText: ui('cancel'),", 1),
    ("ElMessageBox.alert('快照已创建', '版本历史')",
     "ElMessageBox.alert(ui('snapshotCreated'), ui('panelRevisionHistory'))", 1),
    ("ElMessageBox.alert(error?.message || '创建快照失败', '版本历史')",
     "ElMessageBox.alert(error?.message || ui('snapshotCreateFailed'), ui('panelRevisionHistory'))", 1),
], add_import=LOCALE_IMPORT)

print('ALL DONE')
