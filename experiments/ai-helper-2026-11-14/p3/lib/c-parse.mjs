/**
 * P3 第一步切片的 C 子集解析器（无依赖，纯 JS）。
 *
 * 声明支持的构造（与 P3-FIRST-SLICE.md 的表一一对应）：
 *   - 预处理行：只记录，不展开（#include / #define 都记为 unsupported:preprocessor）
 *   - 函数定义：`[static] [const] <type> name(<params>) { ... }`，参数支持标量、定长数组、const 修饰
 *   - 声明：[const] <type> a[<N>]; / a[<N>] = { ... }; / a = expr; / 一条语句多个声明符
 *   - 语句：复合块、for(;;)、if/else、return、break、continue、表达式语句（赋值/调用）
 *   - 表达式：算术 + - * / %、位运算 & | ^ ~ << >>、比较、一元 ! -、强制转换 (T)expr、
 *     调用 f(a,b)、下标 a[i]、赋值（= 与 ^= |= &= += -= *= /= %= <<= >>=）、++/--（语句级）
 * 明确不支持（逐条带行号报 unsupported，不静默吞）：
 *   switch/case、do-while、goto、struct/union/enum/typedef、指针（*p / &x / p+i）、
 *   成员访问 . ->、三元 ?:、逗号表达式、sizeof、函数指针、多维数组。
 * 语义可能不同（与 P3-SCOPE R2 同源，报 semantic-drift 而非 unsupported）：
 *   - 显式整型窄化转换 (uint8_t)/(uint16_t)…
 *   - 窄类型（<32 位）变量或数组元素的「声明初始化 / 赋值」右侧是算术表达式（隐式截断）
 */

const TYPE_KEYWORDS = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'size_t', 'bool', '_Bool', 'uintptr_t',
]);
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'register', 'inline', 'extern']);
const UNSUPPORTED_DECL_KEYWORDS = new Set(['struct', 'union', 'enum', 'typedef']);
const NARROW_TYPES = new Set(['uint8_t', 'int8_t', 'char', 'unsigned char', 'uint16_t', 'int16_t', 'short']);
const CAST_TYPES = new Set([
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'int', 'unsigned', 'char', 'short', 'long', 'size_t',
]);

const PUNCT3 = ['<<=', '>>='];
const PUNCT2 = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--', '->'];
const PUNCT1 = '{}()[];,=<>+-*/%^&|~!?:.';

export class DiagnosticBag {
  constructor(sourceText) {
    this.lines = sourceText.split(/\r?\n/);
    this.items = [];
    this.seen = new Set();
  }

  add({ line, kind, code, message }) {
    const key = `${line}:${kind}:${code}:${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({
      stage: 'V1',
      line,
      kind, // 'unsupported' | 'semantic-drift'
      code,
      message,
      snippet: (this.lines[line - 1] || '').trim().slice(0, 120),
    });
  }

  unsupported(line, code, message) {
    this.add({ line, kind: 'unsupported', code, message });
  }

  drift(line, code, message) {
    this.add({ line, kind: 'semantic-drift', code, message });
  }
}

export function lex(sourceText) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const push = (type, value, startLine) => tokens.push({ type, value, line: startLine });

  while (i < sourceText.length) {
    const ch = sourceText[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    // 行注释
    if (ch === '/' && sourceText[i + 1] === '/') {
      while (i < sourceText.length && sourceText[i] !== '\n') i += 1;
      continue;
    }
    // 块注释（跨行要数行号）
    if (ch === '/' && sourceText[i + 1] === '*') {
      i += 2;
      while (i < sourceText.length && !(sourceText[i] === '*' && sourceText[i + 1] === '/')) {
        if (sourceText[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    // 预处理行：整行一个 token（含续行反斜杠）
    if (ch === '#') {
      const start = line;
      let text = '';
      while (i < sourceText.length) {
        const c = sourceText[i];
        if (c === '\n') break;
        text += c;
        i += 1;
        if (c === '\\' && sourceText[i] === '\n') { text += '\n'; i += 1; line += 1; }
      }
      push('preproc', text, start);
      continue;
    }
    // 数字
    if (/[0-9]/.test(ch)) {
      const start = i;
      if (ch === '0' && (sourceText[i + 1] === 'x' || sourceText[i + 1] === 'X')) {
        i += 2;
        while (i < sourceText.length && /[0-9a-fA-F]/.test(sourceText[i])) i += 1;
      } else {
        while (i < sourceText.length && /[0-9]/.test(sourceText[i])) i += 1;
      }
      while (i < sourceText.length && /[uUlL]/.test(sourceText[i])) i += 1;
      push('num', sourceText.slice(start, i), line);
      continue;
    }
    // 标识符
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < sourceText.length && /[A-Za-z0-9_]/.test(sourceText[i])) i += 1;
      push('ident', sourceText.slice(start, i), line);
      continue;
    }
    // 字符/字符串（样本里没有字面量字符串；只为 #include 之类不误切）
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < sourceText.length) {
        if (sourceText[i] === '\\') { i += 2; continue; }
        if (sourceText[i] === quote) { i += 1; break; }
        if (sourceText[i] === '\n') line += 1;
        i += 1;
      }
      push(quote === '"' ? 'str' : 'char', sourceText.slice(start, i), line);
      continue;
    }
    // 标点
    const three = sourceText.slice(i, i + 3);
    if (PUNCT3.includes(three)) { push('punct', three, line); i += 3; continue; }
    const two = sourceText.slice(i, i + 2);
    if (PUNCT2.includes(two)) { push('punct', two, line); i += 2; continue; }
    if (PUNCT1.includes(ch)) { push('punct', ch, line); i += 1; continue; }
    throw new Error(`词法错误：第 ${line} 行出现未识别字符 ${JSON.stringify(ch)}`);
  }
  tokens.push({ type: 'eof', value: '', line });
  return tokens;
}

class Parser {
  constructor(tokens, diagnostics) {
    this.tokens = tokens;
    this.pos = 0;
    this.diag = diagnostics;
    this.scopes = [new Map()]; // 变量名 -> {type, isArray, arraySize}
  }

  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  next() { return this.tokens[this.pos++]; }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  atPunct(value) { return this.at('punct', value); }
  atIdent(value) { return this.at('ident', value); }
  expect(type, value) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`语法错误：第 ${t.line} 行期望 ${type}${value ? ` ${value}` : ''}，实际 ${t.type} ${JSON.stringify(t.value)}`);
    }
    return this.next();
  }
  expectPunct(value) { return this.expect('punct', value); }

  lookupVar(name) {
    for (let s = this.scopes.length - 1; s >= 0; s -= 1) {
      if (this.scopes[s].has(name)) return this.scopes[s].get(name);
    }
    return null;
  }

  declare(name, info) {
    this.scopes[this.scopes.length - 1].set(name, info);
  }

  parseTranslationUnit() {
    const functions = [];
    const globals = [];
    const preprocs = [];
    while (!this.at('eof')) {
      const t = this.peek();
      if (t.type === 'preproc') {
        preprocs.push({ line: t.line, text: t.value });
        this.diag.unsupported(t.line, 'preprocessor', `预处理行未展开：${t.value.trim().slice(0, 80)}`);
        this.next();
        continue;
      }
      if (t.type === 'punct' && t.value === ';') { this.next(); continue; }
      const parsed = this.parseTopLevel();
      if (!parsed) continue;
      if (parsed.kind === 'function') functions.push(parsed.fn);
      else globals.push(...parsed.decls);
    }
    return { functions, globals, preprocs };
  }

  parseTopLevel() {
    const spec = this.parseDeclSpec();
    if (spec.unsupportedDecl) {
      this.skipToStatementEnd();
      return null;
    }
    // 指针返回/指针声明：不支持
    if (this.atPunct('*')) {
      this.diag.unsupported(this.peek().line, 'pointer', '不支持指针声明/返回类型');
      while (this.atPunct('*')) this.next();
    }
    const nameTok = this.expect('ident');
    if (this.atPunct('(')) {
      return this.parseFunctionRest(spec, nameTok);
    }
    // 全局变量声明
    const decl = this.parseDeclarators(spec, nameTok);
    return { kind: 'decls', decls: decl };
  }

  parseFunctionRest(spec, nameTok) {
    this.expectPunct('(');
    const params = [];
    if (!this.atPunct(')')) {
      if (this.atIdent('void') && this.peek(1).type === 'punct' && this.peek(1).value === ')') {
        this.next();
      } else {
        while (true) {
          const p = this.parseParam();
          if (p) params.push(p);
          if (this.atPunct(',')) { this.next(); continue; }
          break;
        }
      }
    }
    this.expectPunct(')');
    if (this.atPunct(';')) { // 函数原型声明
      this.next();
      return { kind: 'decls', decls: [] };
    }
    this.expectPunct('{');
    this.scopes.push(new Map());
    for (const p of params) {
      this.declare(p.name, { type: p.type, isArray: p.arraySize != null, arraySize: p.arraySize });
    }
    const body = this.parseStatementsUntil('}');
    this.expectPunct('}');
    this.scopes.pop();
    return {
      kind: 'function',
      fn: {
        name: nameTok.value,
        line: nameTok.line,
        returnType: spec.typeText,
        isStatic: spec.isStatic,
        params,
        body,
      },
    };
  }

  parseParam() {
    const spec = this.parseDeclSpec();
    if (spec.unsupportedDecl) { this.skipToStatementEnd(); return null; }
    if (this.atPunct('*')) {
      this.diag.unsupported(this.peek().line, 'pointer', '不支持指针参数');
      this.next();
    }
    if (this.atPunct(')')) return null;
    const nameTok = this.expect('ident');
    let arraySize = null;
    if (this.atPunct('[')) {
      this.next();
      if (this.atPunct(']')) {
        this.diag.unsupported(this.peek().line, 'unsized-array', '不定长数组形参没有长度，块模型需要定长');
      } else {
        const expr = this.parseExpression();
        arraySize = expr.kind === 'num' ? expr.value : null;
        if (arraySize == null) this.diag.unsupported(nameTok.line, 'nonliteral-array-size', '数组长度不是字面量');
      }
      this.expectPunct(']');
      if (this.atPunct('[')) this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
    }
    return {
      name: nameTok.value,
      type: spec.typeText,
      isConst: spec.isConst,
      arraySize,
      line: nameTok.line,
    };
  }

  parseDeclSpec() {
    let typeText = '';
    let isStatic = false;
    let isConst = false;
    let unsupportedDecl = false;
    let consumed = false;
    while (true) {
      const t = this.peek();
      if (t.type !== 'ident') break;
      if (UNSUPPORTED_DECL_KEYWORDS.has(t.value)) {
        this.diag.unsupported(t.line, 'aggregate-type', `不支持 ${t.value} 声明`);
        unsupportedDecl = true;
        this.next();
        // 跳过类型名
        if (this.peek().type === 'ident') this.next();
        consumed = true;
        break;
      }
      if (QUALIFIERS.has(t.value)) {
        if (t.value === 'static') isStatic = true;
        if (t.value === 'const') isConst = true;
        typeText += `${t.value} `;
        this.next(); consumed = true; continue;
      }
      if (TYPE_KEYWORDS.has(t.value)) {
        typeText += `${t.value} `;
        this.next(); consumed = true; continue;
      }
      break;
    }
    if (!consumed) {
      const t = this.peek();
      throw new Error(`语法错误：第 ${t.line} 行无法识别声明类型（实际 ${t.value || t.type}）`);
    }
    return { typeText: typeText.trim(), baseType: typeText.replace(/const|static|volatile|register|inline|extern/g, '').trim(), isStatic, isConst, unsupportedDecl };
  }

  skipToStatementEnd() {
    let depth = 0;
    while (!this.at('eof')) {
      if (this.atPunct('{')) depth += 1;
      if (this.atPunct('}')) {
        if (depth === 0) { this.next(); return; }
        depth -= 1;
      }
      if (this.atPunct(';') && depth === 0) { this.next(); return; }
      this.next();
    }
  }

  parseDeclarators(spec, firstIdent) {
    const out = [];
    let nameTok = firstIdent;
    while (true) {
      let arraySize = null;
      if (this.atPunct('[')) {
        this.next();
        if (this.atPunct(']')) {
          this.diag.unsupported(nameTok.line, 'unsized-array', '数组没有长度');
        } else {
          const expr = this.parseExpression();
          arraySize = expr.kind === 'num' ? expr.value : null;
          if (arraySize == null) this.diag.unsupported(nameTok.line, 'nonliteral-array-size', '数组长度不是字面量');
        }
        this.expectPunct(']');
        if (this.atPunct('[')) this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
      }
      let init = null;
      let initKind = null;
      if (this.atPunct('=')) {
        this.next();
        if (this.atPunct('{')) {
          init = this.parseInitializerList();
          initKind = 'list';
        } else {
          init = this.parseExpression();
          initKind = 'expr';
        }
      }
      if (arraySize != null) {
        this.declare(nameTok.value, { type: spec.baseType, isArray: true, arraySize });
        if (initKind === 'list') {
          const want = arraySize;
          const got = init.elements.length;
          if (want != null && got !== want) {
            this.diag.unsupported(nameTok.line, 'initializer-size-mismatch', `数组声明长度 ${want} 与初始化元素数 ${got} 不一致`);
          }
        }
      } else {
        this.declare(nameTok.value, { type: spec.baseType, isArray: false, arraySize: null });
        if (initKind === 'expr') this.checkNarrowing(nameTok.line, spec.baseType, init, '声明初始化');
      }
      out.push({ name: nameTok.value, line: nameTok.line, type: spec.baseType, arraySize, init, initKind, isStatic: spec.isStatic });
      if (!this.atPunct(',')) break;
      this.next();
      if (this.atPunct('*')) {
        this.diag.unsupported(this.peek().line, 'pointer', '不支持指针声明符');
        while (this.atPunct('*')) this.next();
      }
      nameTok = this.expect('ident');
    }
    this.expectPunct(';');
    return out;
  }

  parseInitializerList() {
    this.expectPunct('{');
    const elements = [];
    while (!this.atPunct('}')) {
      elements.push(this.parseExpression());
      if (this.atPunct(',')) { this.next(); continue; }
      break;
    }
    this.expectPunct('}');
    return { kind: 'initlist', elements };
  }

  checkNarrowing(line, declaredType, expr, why) {
    if (!NARROW_TYPES.has(declaredType)) return;
    if (expr && expr.kind === 'bin' && ['+', '-', '*', '/', '%', '^', '&', '|', '<<', '>>'].includes(expr.op)) {
      this.diag.drift(line, 'implicit-narrowing', `${why}：${declaredType} 右侧是算术表达式，C 会按声明宽度截断，块模型按 32 位整数`);
    }
  }

  parseStatementsUntil(endPunct) {
    const stmts = [];
    while (!this.at('eof') && !this.atPunct(endPunct)) {
      const s = this.parseStatement();
      if (s) stmts.push(s);
    }
    return stmts;
  }

  parseStatement() {
    const t = this.peek();
    if (t.type === 'preproc') {
      this.diag.unsupported(t.line, 'preprocessor', '函数体内不支持预处理行');
      this.next();
      return null;
    }
    if (this.atPunct(';')) { this.next(); return null; }
    if (this.atPunct('{')) {
      this.next();
      this.scopes.push(new Map());
      const body = this.parseStatementsUntil('}');
      this.expectPunct('}');
      this.scopes.pop();
      return { kind: 'compound', body, line: t.line };
    }
    if (t.type === 'ident') {
      switch (t.value) {
        case 'for': return this.parseFor();
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'return': return this.parseReturn();
        case 'break': this.next(); this.expectPunct(';'); return { kind: 'break', line: t.line };
        case 'continue': this.next(); this.expectPunct(';'); return { kind: 'continue', line: t.line };
        case 'do': {
          this.diag.unsupported(t.line, 'do-while', 'do-while 无对应块（只能用 while 手工前置一次循环体）');
          this.next();
          this.parseStatement();
          if (this.atIdent('while')) {
            this.next();
            this.expectPunct('('); this.parseExpression(); this.expectPunct(')');
          }
          this.expectPunct(';');
          return { kind: 'unsupported', construct: 'do-while', line: t.line };
        }
        case 'switch': {
          this.diag.unsupported(t.line, 'switch', 'switch/case 无对应块（fallthrough 与 default 落位无法表达）');
          this.next();
          this.expectPunct('('); this.parseExpression(); this.expectPunct(')');
          if (this.atPunct('{')) this.next();
          let depth = 1;
          while (!this.at('eof') && depth > 0) {
            if (this.atPunct('{')) depth += 1;
            if (this.atPunct('}')) depth -= 1;
            this.next();
          }
          return { kind: 'unsupported', construct: 'switch', line: t.line };
        }
        case 'goto': {
          this.diag.unsupported(t.line, 'goto', 'goto 无对应块');
          this.skipToStatementEnd();
          return { kind: 'unsupported', construct: 'goto', line: t.line };
        }
        case 'case':
        case 'default':
          this.diag.unsupported(t.line, 'switch-label', `函数体出现 ${t.value} 标签但没有 switch 承接`);
          this.skipToStatementEnd();
          return { kind: 'unsupported', construct: t.value, line: t.line };
        default:
          break;
      }
      if (TYPE_KEYWORDS.has(t.value) || QUALIFIERS.has(t.value) || UNSUPPORTED_DECL_KEYWORDS.has(t.value)) {
        const spec = this.parseDeclSpec();
        if (spec.unsupportedDecl) {
          this.skipToStatementEnd();
          return { kind: 'unsupported', construct: 'aggregate-decl', line: t.line };
        }
        if (this.atPunct('*')) {
          this.diag.unsupported(this.peek().line, 'pointer', '不支持指针局部变量');
          while (this.atPunct('*')) this.next();
        }
        const nameTok = this.expect('ident');
        const decls = this.parseDeclarators(spec, nameTok);
        return { kind: 'decl', decls, line: t.line };
      }
    }
    // 表达式语句
    const expr = this.parseExpression();
    this.expectPunct(';');
    return { kind: 'expr', expr, line: t.line };
  }

  parseFor() {
    const t = this.next(); // for
    this.expectPunct('(');
    this.scopes.push(new Map());
    let init = null;
    if (!this.atPunct(';')) {
      const start = this.peek();
      if (start.type === 'ident' && (TYPE_KEYWORDS.has(start.value) || QUALIFIERS.has(start.value))) {
        const spec = this.parseDeclSpec();
        const nameTok = this.expect('ident');
        const decls = this.parseDeclarators(spec, nameTok); // 吃掉 ';'
        init = { kind: 'decl', decls, line: start.line };
      } else {
        init = { kind: 'expr', expr: this.parseExpression(), line: start.line };
        this.expectPunct(';');
      }
    } else {
      this.next();
    }
    let cond = null;
    if (!this.atPunct(';')) cond = this.parseExpression();
    this.expectPunct(';');
    let incr = null;
    if (!this.atPunct(')')) incr = this.parseExpression();
    this.expectPunct(')');
    const body = this.parseStatement();
    this.scopes.pop();
    return { kind: 'for', init, cond, incr, body, line: t.line };
  }

  parseIf() {
    const t = this.next();
    this.expectPunct('(');
    const cond = this.parseExpression();
    this.expectPunct(')');
    const then = this.parseStatement();
    let alternate = null;
    if (this.atIdent('else')) {
      this.next();
      alternate = this.parseStatement();
    }
    return { kind: 'if', cond, then, alternate, line: t.line };
  }

  parseWhile() {
    const t = this.next();
    this.expectPunct('(');
    const cond = this.parseExpression();
    this.expectPunct(')');
    const body = this.parseStatement();
    return { kind: 'while', cond, body, line: t.line };
  }

  parseReturn() {
    const t = this.next();
    let expr = null;
    if (!this.atPunct(';')) expr = this.parseExpression();
    this.expectPunct(';');
    return { kind: 'return', expr, line: t.line };
  }

  // ---- 表达式（优先级爬升） ----
  parseExpression() { return this.parseAssignment(); }

  parseAssignment() {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.type === 'punct' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.value)) {
      this.next();
      const right = this.parseAssignment();
      if (t.value === '=') this.checkNarrowing(t.line, this.inferType(left), right, '赋值');
      return { kind: 'assign', op: t.value, target: left, value: right, line: t.line };
    }
    return left;
  }

  parseTernary() {
    const cond = this.parseBinary(1);
    if (this.atPunct('?')) {
      const line = this.next().line;
      this.diag.unsupported(line, 'ternary', '三元表达式按诊断记录（块有 logic_ternary，但本切片不落块）');
      this.parseExpression();
      this.expectPunct(':');
      this.parseExpression();
      return { kind: 'unsupported-expr', construct: 'ternary', line };
    }
    return cond;
  }

  static PRECEDENCE = new Map([
    ['||', 1], ['&&', 2], ['|', 3], ['^', 4], ['&', 5],
    ['==', 6], ['!=', 6], ['<', 7], ['>', 7], ['<=', 7], ['>=', 7],
    ['<<', 8], ['>>', 8], ['+', 9], ['-', 9], ['*', 10], ['/', 10], ['%', 10],
  ]);

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t.type !== 'punct') break;
      const prec = Parser.PRECEDENCE.get(t.value);
      if (prec == null || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { kind: 'bin', op: t.value, left, right, line: t.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'punct') {
      if (t.value === '!' || t.value === '-' || t.value === '+' || t.value === '~') {
        this.next();
        return { kind: 'un', op: t.value, expr: this.parseUnary(), line: t.line };
      }
      if (t.value === '++' || t.value === '--') {
        this.next();
        const expr = this.parseUnary();
        return { kind: 'incdec', op: t.value, prefix: true, expr, line: t.line };
      }
      if (t.value === '*' || t.value === '&') {
        this.diag.unsupported(t.line, 'pointer', `不支持指针运算 ${t.value}`);
        this.next();
        return { kind: 'unsupported-expr', construct: 'pointer', line: t.line };
      }
      if (t.value === '(') {
        // 强制转换 vs 括号表达式
        const nextTok = this.peek(1);
        if (nextTok.type === 'ident' && CAST_TYPES.has(nextTok.value) && this.peek(2).type === 'punct' && this.peek(2).value === ')') {
          this.next(); this.next(); this.next();
          const expr = this.parseUnary();
          this.diag.drift(t.line, 'narrow-cast', `显式转换 (${nextTok.value}) 的截断语义在块模型里没有对应（按 32 位整数）`);
          return { kind: 'cast', type: nextTok.value, expr, line: t.line };
        }
      }
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.type !== 'punct') break;
      if (t.value === '(') {
        // 调用（callee 可能是 ident 或别的表达式）
        this.next();
        const args = [];
        if (!this.atPunct(')')) {
          while (true) {
            args.push(this.parseExpression());
            if (this.atPunct(',')) { this.next(); continue; }
            break;
          }
        }
        this.expectPunct(')');
        if (expr.kind !== 'ident') {
          this.diag.unsupported(t.line, 'indirect-call', '不支持函数指针/间接调用');
          expr = { kind: 'unsupported-expr', construct: 'indirect-call', line: t.line };
          continue;
        }
        expr = { kind: 'call', callee: expr.name, args, line: t.line };
        continue;
      }
      if (t.value === '[') {
        this.next();
        const index = this.parseExpression();
        this.expectPunct(']');
        expr = { kind: 'index', base: expr, index, line: t.line };
        continue;
      }
      if (t.value === '++' || t.value === '--') {
        this.next();
        expr = { kind: 'incdec', op: t.value, prefix: false, expr, line: t.line };
        continue;
      }
      if (t.value === '.' || t.value === '->') {
        this.diag.unsupported(t.line, 'member-access', '不支持结构体成员访问');
        this.next();
        if (this.peek().type === 'ident') this.next();
        expr = { kind: 'unsupported-expr', construct: 'member-access', line: t.line };
        continue;
      }
      break;
    }
    return expr;
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === 'num') {
      this.next();
      const value = t.value.toLowerCase().startsWith('0x') ? parseInt(t.value.slice(2), 16) : parseInt(t.value, 10);
      return { kind: 'num', value, text: t.value, line: t.line };
    }
    if (t.type === 'char') {
      this.next();
      const inner = t.value.slice(1, -1);
      const value = inner.length === 1 ? inner.charCodeAt(0) : 0;
      return { kind: 'num', value, text: t.value, line: t.line };
    }
    if (t.type === 'str') {
      this.diag.unsupported(t.line, 'string-literal', '字符串字面量不参与密码运算，按不支持记录');
      this.next();
      return { kind: 'unsupported-expr', construct: 'string-literal', line: t.line };
    }
    if (t.type === 'ident') {
      this.next();
      return { kind: 'ident', name: t.value, line: t.line };
    }
    if (t.type === 'punct' && t.value === '(') {
      this.next();
      const expr = this.parseExpression();
      this.expectPunct(')');
      return expr;
    }
    throw new Error(`语法错误：第 ${t.line} 行无法开始表达式（实际 ${t.type} ${JSON.stringify(t.value)}）`);
  }

  inferType(expr) {
    if (!expr) return null;
    if (expr.kind === 'index' && expr.base.kind === 'ident') {
      const v = this.lookupVar(expr.base.name);
      return v ? v.type : null;
    }
    if (expr.kind === 'ident') {
      const v = this.lookupVar(expr.name);
      return v ? v.type : null;
    }
    return null;
  }
}

export function parseC(sourceText) {
  const diagnostics = new DiagnosticBag(sourceText);
  const tokens = lex(sourceText);
  const parser = new Parser(tokens, diagnostics);
  const program = parser.parseTranslationUnit();
  return {
    ...program,
    diagnostics: diagnostics.items,
    constructCounts: countConstructs(program),
    callSites: collectCallSites(program),
  };
}

export function countConstructs(program) {
  const counts = {
    functions: program.functions.length,
    params: 0,
    returns: 0,
    for: 0,
    while: 0,
    if: 0,
    else: 0,
    compound: 0,
    assignments: 0,
    declarations: 0,
    arrayInitializers: 0,
    subscriptReads: 0,
    subscriptWrites: 0,
    calls: 0,
    casts: 0,
    break: 0,
    continue: 0,
    binaryOps: 0,
    binaryByOp: {},
  };
  const bump = (op) => {
    counts.binaryOps += 1;
    counts.binaryByOp[op] = (counts.binaryByOp[op] || 0) + 1;
  };
  const visitExpr = (e) => {
    if (!e) return;
    if (e.kind === 'bin') bump(e.op);
    if (e.kind === 'cast') counts.casts += 1;
    if (e.kind === 'call') counts.calls += 1;
    if (e.kind === 'index') counts.subscriptReads += 1;
    if (e.kind === 'assign') {
      counts.assignments += 1;
      if (e.target?.kind === 'index') counts.subscriptWrites += 1;
    }
    if (e.kind === 'incdec') counts.assignments += 1;
    switch (e.kind) {
      case 'bin': visitExpr(e.left); visitExpr(e.right); break;
      case 'un': visitExpr(e.expr); break;
      case 'cast': visitExpr(e.expr); break;
      case 'assign': visitExpr(e.target); visitExpr(e.value); break;
      case 'call': e.args.forEach(visitExpr); break;
      case 'index': visitExpr(e.base); visitExpr(e.index); break;
      case 'incdec': visitExpr(e.expr); break;
      default: break;
    }
  };
  const visitStmt = (s) => {
    if (!s) return;
    switch (s.kind) {
      case 'compound':
        counts.compound += 1;
        s.body.forEach(visitStmt);
        break;
      case 'for':
        counts.for += 1;
        if (s.init?.kind === 'decl') s.init.decls.forEach((d) => { counts.declarations += 1; visitExpr(d.init); });
        else if (s.init?.kind === 'expr') visitExpr(s.init.expr);
        visitExpr(s.cond);
        visitExpr(s.incr);
        visitStmt(s.body);
        break;
      case 'while':
        counts.while += 1;
        visitExpr(s.cond);
        visitStmt(s.body);
        break;
      case 'if':
        counts.if += 1;
        if (s.alternate) counts.else += 1;
        visitExpr(s.cond);
        visitStmt(s.then);
        visitStmt(s.alternate);
        break;
      case 'return':
        counts.returns += 1;
        visitExpr(s.expr);
        break;
      case 'break': counts.break += 1; break;
      case 'continue': counts.continue += 1; break;
      case 'decl':
        s.decls.forEach((d) => {
          counts.declarations += 1;
          if (d.initKind === 'list') counts.arrayInitializers += 1;
          if (d.initKind === 'expr') visitExpr(d.init);
        });
        break;
      case 'expr':
        visitExpr(s.expr);
        break;
      default:
        break;
    }
  };
  for (const fn of program.functions) {
    counts.params += fn.params.length;
    fn.body.forEach(visitStmt);
  }
  for (const g of program.globals) {
    counts.declarations += 1;
    if (g.initKind === 'list') counts.arrayInitializers += 1;
  }
  return counts;
}

export function collectCallSites(program) {
  const sites = [];
  const visitExpr = (e, fn) => {
    if (!e) return;
    if (e.kind === 'call') sites.push({ callee: e.callee, line: e.line, argc: e.args.length, fn: fn.name });
    switch (e.kind) {
      case 'bin': visitExpr(e.left, fn); visitExpr(e.right, fn); break;
      case 'un': visitExpr(e.expr, fn); break;
      case 'cast': visitExpr(e.expr, fn); break;
      case 'assign': visitExpr(e.target, fn); visitExpr(e.value, fn); break;
      case 'call': e.args.forEach((a) => visitExpr(a, fn)); break;
      case 'index': visitExpr(e.base, fn); visitExpr(e.index, fn); break;
      case 'incdec': visitExpr(e.expr, fn); break;
      default: break;
    }
  };
  const visitStmt = (s, fn) => {
    switch (s.kind) {
      case 'compound': s.body.forEach((x) => visitStmt(x, fn)); break;
      case 'expr': visitExpr(s.expr, fn); break;
      case 'decl': s.decls.forEach((d) => visitExpr(d.init, fn)); break;
      case 'for':
        if (s.init) visitStmt(s.init, fn);
        visitExpr(s.cond, fn); visitExpr(s.incr, fn);
        if (s.body) visitStmt(s.body, fn);
        break;
      case 'if':
        visitExpr(s.cond, fn);
        if (s.then) visitStmt(s.then, fn);
        if (s.alternate) visitStmt(s.alternate, fn);
        break;
      case 'while':
        visitExpr(s.cond, fn);
        if (s.body) visitStmt(s.body, fn);
        break;
      case 'return': visitExpr(s.expr, fn); break;
      default: break;
    }
  };
  program.functions.forEach((fn) => fn.body.forEach((s) => visitStmt(s, fn)));
  return sites;
}
