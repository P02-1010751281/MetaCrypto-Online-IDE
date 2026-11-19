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
  constructor(tokens, diagnostics, options = {}) {
    this.tokens = tokens;
    this.pos = 0;
    this.diag = diagnostics;
    this.scopes = [new Map()]; // 变量名 -> {type, isArray, arraySize}
    // typedef 别名：别名 -> { baseType, dims }。只解析「给已有类型起别名」这一种形态。
    this.typeAliases = new Map();
    // 整函数被块吸收的样本：函数体不做结构解析，只留签名与体行数（见 parseFunctionRest）。
    this.opaqueFunctions = options.opaqueFunctions || new Set();
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
        // `#define` 已被 preprocessConditionals() 取值登记（宏表随 V1 读数给出），
        // 只有 `#include` 这类「未展开」的指令才按不支持记录，避免把已理解的宏读成缺陷。
        if (!isDefineDirective(t.value)) {
          this.diag.unsupported(t.line, 'preprocessor', `预处理行未展开：${t.value.trim().slice(0, 80)}`);
        }
        this.next();
        continue;
      }
      if (t.type === 'punct' && t.value === ';') { this.next(); continue; }
      if (t.type === 'ident' && t.value === 'typedef') {
        this.parseTypedef();
        continue;
      }
      const parsed = this.parseTopLevel();
      if (!parsed) continue;
      if (parsed.kind === 'function') functions.push(parsed.fn);
      else globals.push(...parsed.decls);
    }
    return { functions, globals, preprocs };
  }

  /**
   * `typedef <base> <name>[d1][d2];` —— 只支持「给已有标量/数组类型起别名」。
   *
   * 为什么必须支持它：真实第三方代码里 `state_t`（= uint8_t[4][4]）这类别名是常态，
   * 不支持就会在函数签名处直接抛「无法识别声明类型」，整个样本连签名都拿不到。
   * 结构体/联合体/枚举/函数指针别名仍然判 unsupported —— 块模型里没有对应形态。
   */
  parseTypedef() {
    this.next(); // typedef
    const spec = this.parseDeclSpec();
    if (spec.unsupportedDecl) { this.skipToStatementEnd(); return; }
    const nameTok = this.expect('ident');
    const dims = [];
    while (this.atPunct('[')) {
      this.next();
      if (this.atPunct(']')) {
        this.diag.unsupported(nameTok.line, 'unsized-array', '别名数组没有长度');
        dims.push(null);
        this.next();
        continue;
      }
      const expr = this.parseExpression();
      dims.push(expr.kind === 'num' ? expr.value : null);
      if (expr.kind !== 'num') this.diag.unsupported(nameTok.line, 'nonliteral-array-size', '别名数组长度不是字面量');
      this.expectPunct(']');
    }
    this.expectPunct(';');
    this.typeAliases.set(nameTok.value, {
      baseType: spec.baseType,
      dims,
      line: nameTok.line,
      source: `typedef ${spec.typeText} ${nameTok.value}`,
    });
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
    if (this.opaqueFunctions.has(nameTok.value)) {
      // 整函数被块吸收的样本（manifest.opaqueFunctions）：函数体不参与结构映射。
      // 这不是「分析通过」——V2 会把 bodySkipped 明确写进 absorbed 条目，避免把跳过读成已核。
      const startLine = this.peek().line;
      let depth = 1;
      while (depth > 0 && !this.at('eof')) {
        const tk = this.next();
        if (tk.type === 'punct' && tk.value === '{') depth += 1;
        else if (tk.type === 'punct' && tk.value === '}') depth -= 1;
      }
      return {
        kind: 'function',
        fn: {
          name: nameTok.value,
          line: nameTok.line,
          returnType: spec.typeText,
          isStatic: spec.isStatic,
          params,
          body: [],
          bodySkipped: true,
          bodyLines: Math.max(0, this.peek().line - startLine),
        },
      };
    }
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
    let isPointer = false;
    if (this.atPunct('*')) {
      this.diag.unsupported(this.peek().line, 'pointer', '不支持指针参数');
      isPointer = true;
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
      // 多维数组：块模型只有定长一维。必须消费掉多余维度，否则 expectPunct(')') 抛错、
      // 整份样本连签名都拿不到（tiny-AES-c 的 uint8_t[4][4] 实测就卡在这里）。
      while (this.atPunct('[')) {
        this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
        this.next();
        if (!this.atPunct(']')) this.parseExpression();
        this.expectPunct(']');
      }
    } else if (!isPointer && spec.aliasDims && spec.aliasDims.length > 0) {
      // 形参直接写成别名且不是指针（如 `state_t s`）：维度来自 typedef 本身。
      // 指针形参（`state_t* s`）不吃这条分支：它指向整个数组，不是「长度 4 的数组形参」。
      arraySize = spec.aliasDims[0];
      if (spec.aliasDims.length > 1) this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
    }
    return {
      name: nameTok.value,
      isPointer,
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
    let aliasDims = null;
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
      if (this.typeAliases.has(t.value)) {
        const alias = this.typeAliases.get(t.value);
        typeText += `${alias.baseType} `;
        aliasDims = alias.dims;
        this.next(); consumed = true; continue;
      }
      break;
    }
    if (!consumed) {
      const t = this.peek();
      throw new Error(`语法错误：第 ${t.line} 行无法识别声明类型（实际 ${t.value || t.type}）`);
    }
    return { typeText: typeText.trim(), baseType: typeText.replace(/const|static|volatile|register|inline|extern/g, '').trim(), isStatic, isConst, unsupportedDecl, aliasDims };
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
        // 多维数组：同上，块模型只到定长一维；多余维度必须消费掉，否则整份样本解析中断。
        while (this.atPunct('[')) {
          this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
          this.next();
          if (!this.atPunct(']')) this.parseExpression();
          this.expectPunct(']');
        }
      } else if (spec.aliasDims && spec.aliasDims.length > 0) {
        arraySize = spec.aliasDims[0];
        if (spec.aliasDims.length > 1) this.diag.unsupported(nameTok.line, 'multi-dim-array', '不支持多维数组');
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

// ---------------------------------------------------------------------------
// 预处理：只处理「影响结构」的两件事——条件编译分支与对象/函数式宏的取值登记。
//
// 为什么必须有这一层：上游 tiny-AES-c 的 KeyExpansion 体尾挂着
// `#if defined(AES256) && (AES256 == 1) ... #endif` 的 AES-256 分支。不过这一层的话，
// 解析器会把该分支当成默认配置读进结构骨架，V1/V2 的读数就是错的；而默认构建（不定义
// AES256/AES192）应取 `#else` 的 Nk=4 / Nr=10。
//
// 边界：只按行为单位评估 `#if/#ifdef/#ifndef/#elif/#else/#endif`，表达式只支持
// defined(X)、整数常量、宏名（未定义按 0）、! && || == != 与括号；不展开 #include，
// 不做宏替换（宏调用在结构里保留为 call，由 V2 判是否有块承接），也不处理注释里的
// 「伪指令」。被裁掉的行用空行占位，行号与上游保持一一对应。
// ---------------------------------------------------------------------------
const CONDITIONAL_RE = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/;
const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)(\()?/;

export function isDefineDirective(text) {
  return /^\s*#\s*define\b/.test(text);
}

function tokenizeDirective(expr, atLine) {
  const toks = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (expr.startsWith('defined', i) && !/[A-Za-z0-9_]/.test(expr[i + 7] || '')) {
      toks.push({ t: 'defined' });
      i += 7;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['&&', '||', '==', '!='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if (ch === '!' || ch === '(' || ch === ')') { toks.push({ t: ch === '!' ? 'op' : 'punct', v: ch }); i += 1; continue; }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+/.exec(expr.slice(i));
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i));
      toks.push({ t: 'ident', v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`预处理表达式无法识别：第 ${atLine} 行 ${JSON.stringify(expr)} 的 ${JSON.stringify(ch)}`);
  }
  return toks;
}

/** 评估条件编译表达式；只认 defined(X)、整数、宏名（未定义=0）、! && || == != 与括号。 */
export function evalConditional(expr, macros, atLine) {
  const toks = tokenizeDirective(expr, atLine);
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  const fail = () => { throw new Error(`预处理表达式不完整：第 ${atLine} 行 ${JSON.stringify(expr)}`); };
  const primary = () => {
    const t = eat();
    if (!t) fail();
    if (t.t === 'defined') {
      let name;
      if (peek()?.t === 'punct' && peek().v === '(') {
        eat();
        name = eat()?.v;
        if (eat()?.v !== ')') fail();
      } else {
        name = eat()?.v;
      }
      if (typeof name !== 'string') fail();
      return macros.has(name) ? 1 : 0;
    }
    if (t.t === 'num') return t.v;
    if (t.t === 'ident') {
      const m = macros.get(t.v);
      if (!m) return 0;
      const n = Number(m.value);
      return Number.isFinite(n) ? n : 0;
    }
    if (t.t === 'punct' && t.v === '(') {
      const v = orExpr();
      if (eat()?.v !== ')') fail();
      return v;
    }
    if (t.t === 'op' && t.v === '!') return primary() ? 0 : 1;
    fail();
    return 0;
  };
  const eqExpr = () => {
    let left = primary();
    while (peek()?.t === 'op' && (peek().v === '==' || peek().v === '!=')) {
      const op = eat().v;
      const right = primary();
      left = op === '==' ? (left === right ? 1 : 0) : (left !== right ? 1 : 0);
    }
    return left;
  };
  const andExpr = () => {
    let left = eqExpr();
    while (peek()?.t === 'op' && peek().v === '&&') { eat(); const right = eqExpr(); left = left && right ? 1 : 0; }
    return left;
  };
  const orExpr = () => {
    let left = andExpr();
    while (peek()?.t === 'op' && peek().v === '||') { eat(); const right = andExpr(); left = left || right ? 1 : 0; }
    return left;
  };
  const value = orExpr();
  if (p !== toks.length) fail();
  return value !== 0;
}

/**
 * 返回行号对齐后的源码（被裁分支留空行）与宏表/条件记录。
 * 宏表既用于条件评估，也作为 V1 读数（Nk=4 / Nr=10 / Nb=4 与函数式宏 getSBoxValue）。
 */
export function preprocessConditionals(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const out = lines.slice();
  const macros = new Map();
  const conditionals = [];
  const stack = [];
  const active = () => stack.length === 0 || stack[stack.length - 1].active;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = CONDITIONAL_RE.exec(line);
    if (m) {
      const kw = m[1];
      const rest = m[2].trim();
      if (kw === 'if' || kw === 'ifdef' || kw === 'ifndef') {
        const parentActive = active();
        let cond = false;
        if (parentActive) {
          if (kw === 'if') cond = evalConditional(rest, macros, i + 1);
          else {
            const name = (/^([A-Za-z_]\w*)/.exec(rest) || [])[1];
            if (!name) throw new Error(`预处理行缺少宏名：第 ${i + 1} 行 ${line.trim()}`);
            cond = kw === 'ifdef' ? macros.has(name) : !macros.has(name);
          }
        }
        const frame = { line: i + 1, kind: kw, expr: rest, parentActive, active: parentActive && cond, taken: parentActive && cond };
        stack.push(frame);
        conditionals.push({ line: i + 1, kind: kw, expr: rest, branchActive: frame.active });
      } else if (kw === 'elif') {
        const frame = stack[stack.length - 1];
        if (!frame) throw new Error(`#elif 没有对应的 #if：第 ${i + 1} 行`);
        const cond = frame.parentActive && !frame.taken ? evalConditional(rest, macros, i + 1) : false;
        frame.active = !frame.taken && cond;
        frame.taken = frame.taken || frame.active;
        conditionals.push({ line: i + 1, kind: kw, expr: rest, branchActive: frame.active });
      } else if (kw === 'else') {
        const frame = stack[stack.length - 1];
        if (!frame) throw new Error(`#else 没有对应的 #if：第 ${i + 1} 行`);
        frame.active = frame.parentActive && !frame.taken;
        frame.taken = true;
        conditionals.push({ line: i + 1, kind: kw, expr: '', branchActive: frame.active });
      } else {
        if (stack.length === 0) throw new Error(`#endif 没有对应的 #if：第 ${i + 1} 行`);
        stack.pop();
        conditionals.push({ line: i + 1, kind: 'endif', expr: '', branchActive: active() });
      }
      out[i] = '';
      continue;
    }
    if (!active()) { out[i] = ''; continue; }
    const d = DEFINE_RE.exec(line);
    if (d) {
      // 宏值要能参与条件求值：先去掉行尾 // 与块注释，再 trim。
      const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '').trim();
      const functionLike = Boolean(d[2]);
      let params = [];
      let value;
      if (functionLike) {
        const pm = /^\s*#\s*define\s+[A-Za-z_]\w*\(([^)]*)\)\s*(.*)$/.exec(line);
        params = (pm?.[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
        value = stripComments(pm?.[2] || '');
      } else {
        value = stripComments(line.replace(/^\s*#\s*define\s+[A-Za-z_]\w*\s*/, ''));
      }
      macros.set(d[1], { name: d[1], value, functionLike, params, line: i + 1 });
    }
  }
  if (stack.length > 0) throw new Error(`#if 未闭合：第 ${stack[stack.length - 1].line} 行起`);
  return { text: out.join('\n'), macros, conditionals };
}

/**
 * @param {string} sourceText
 * @param {{ opaqueFunctions?: Set<string> }} [options]
 *   opaqueFunctions：整函数被单个块吸收的样本。只解析签名，函数体按配对括号跳过
 *   （记录 bodySkipped / bodyLines）；因为这些函数的体本来就不做结构映射，
 *   强行按 C 子集解析只会把「不支持指针解引用」这类噪声当成样本缺陷。
 */
export function parseC(sourceText, options = {}) {
  // 条件编译先按行裁掉非活动分支（保留行号），再走原有词法/语法分析。
  const preprocessor = preprocessConditionals(sourceText);
  const diagnostics = new DiagnosticBag(preprocessor.text);
  const tokens = lex(preprocessor.text);
  const parser = new Parser(tokens, diagnostics, options);
  const program = parser.parseTranslationUnit();
  return {
    ...program,
    diagnostics: diagnostics.items,
    constructCounts: countConstructs(program),
    callSites: collectCallSites(program),
    preprocessor: {
      conditionals: preprocessor.conditionals,
      defines: [...preprocessor.macros.values()].map((m) => ({
        name: m.name,
        line: m.line,
        value: m.value,
        functionLike: m.functionLike,
        params: m.params,
      })),
    },
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
