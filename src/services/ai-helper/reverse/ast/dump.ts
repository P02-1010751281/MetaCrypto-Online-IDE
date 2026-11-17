/**
 * Python 源码 → AST 转储（B 线 B2 / S3 第一段）
 *
 * 反解析的第二条路径不再逐字匹配模板：先用标准库 `ast.parse` 拿到语法树，再由
 * `ir.ts` 把它翻成白名单 IR。本文件只负责「把 Python 的解释结果安全地交给 JS」。
 *
 * 四条纪律：
 *   - **只 parse，不执行**：脚本里没有 `exec` / `eval` / `compile(..., 'exec')`，
 *     用户代码永远不会被运行（与「用户代码只在浏览器沙箱里跑」的既有约束一致，
 *     这里连沙箱都不进执行阶段）。
 *   - **源码走 base64**：直接拼进字符串字面量会被引号、换行、反斜杠、emoji 咬；
 *     base64 只含 ASCII，`b64decode(...).decode('utf-8')` 一行搞定。
 *   - **输出走 runPython 的返回值**：stdout 通道属于「试运行」面板，两者混用会让
 *     解析结果和试运行输出串台。
 *   - **转换是通用的**：`ast.iter_fields` 全量遍历，不手写字段清单——手写清单会漏掉
 *     新版本新增的字段，而且这里本来就要把不认识的部分交给 JS 侧白名单去丢。
 */

/** AST 节点在转储里的最小形状：`_` 是 Python 的节点类名，其余字段原样保留。 */
export interface AstNode {
  _: string;
  lineno?: number;
  end_lineno?: number;
  [key: string]: unknown;
}

export interface AstSyntaxError {
  message: string;
  line?: number;
  offset?: number;
  text?: string;
}

export type AstDump =
  | { ok: true; module: AstNode }
  | { ok: false; error: AstSyntaxError };

/** 把源码编成 base64：浏览器与 Node 都有 btoa/TextEncoder，不引第三方依赖。 */
export function encodeSource(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 造出在 Pyodide（或本机 python3）里跑的转储脚本。脚本的最后一行是表达式，
 * `runPython` 会把它作为返回值交回 JS；解析失败时返回 `{"ok": false, ...}`。
 */
export function buildAstDumpScript(code: string): string {
  return [
    'import ast, base64, json',
    'def _conv(o):',
    '    if isinstance(o, ast.AST):',
    '        d = {"_": type(o).__name__}',
    '        for k, v in ast.iter_fields(o):',
    '            d[k] = _conv(v)',
    '        for a in ("lineno", "col_offset", "end_lineno", "end_col_offset"):',
    '            if hasattr(o, a):',
    '                d[a] = getattr(o, a)',
    '        return d',
    '    if isinstance(o, (list, tuple)):',
    '        return [_conv(x) for x in o]',
    '    if o is None or isinstance(o, (bool, int, float, str)):',
    '        return o',
    '    if isinstance(o, bytes):',
    '        return o.decode("latin-1")',
    '    return repr(o)',
    `_SRC = base64.b64decode("${encodeSource(code)}").decode("utf-8")`,
    'try:',
    '    _out = {"ok": True, "module": _conv(ast.parse(_SRC))}',
    'except SyntaxError as e:',
    '    _out = {"ok": False, "error": {"message": e.msg, "line": e.lineno,',
    '            "offset": e.offset, "text": e.text}}',
    // 两个宿主读法不同，所以两个通道都给：
    //   - Pyodide 的 runPython 返回最后一个表达式的值（浏览器走这条）；
    //   - `python3 -c` 不返回值，只把 print 的输出交给 stdout（单测走这条）。
    '_json = json.dumps(_out, ensure_ascii=False)',
    'print(_json)',
    '_json',
  ].join('\n');
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { _?: unknown })._ === 'string'
  );
}

/**
 * 读回转储。结构不对时抛错（这是本模块自己的 bug，不该被当成用户代码错误），
 * 只有 Python 语法错误才走 `ok: false` 的正常分支。
 */
export function readAstDump(text: string): AstDump {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `AST 转储不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const payload = parsed as { ok?: unknown; module?: unknown; error?: unknown };
  if (payload?.ok === true) {
    if (!isNode(payload.module)) throw new Error('AST 转储缺少 module 节点');
    return { ok: true, module: payload.module };
  }
  const error = payload?.error as Partial<AstSyntaxError> | undefined;
  if (payload?.ok === false && error && typeof error.message === 'string') {
    return {
      ok: false,
      error: {
        message: error.message,
        line: typeof error.line === 'number' ? error.line : undefined,
        offset: typeof error.offset === 'number' ? error.offset : undefined,
        text: typeof error.text === 'string' ? error.text : undefined,
      },
    };
  }
  throw new Error('AST 转储结构不认识：既不是 ok 也不是语法错误');
}
