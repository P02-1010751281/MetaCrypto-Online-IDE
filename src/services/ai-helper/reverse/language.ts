/**
 * 代码 → 工作区：输入语言判别（用户侧 AI Helper · B 线 B1b）
 *
 * 反解析器只实现了「本平台生成的 Python 形态」一条路径。JavaScript 形态由同一批生成器
 * 产出，但块名（camelCase）、语句分号、`Uint8Array` 字面量、JSDoc 与花括号布局都与
 * Python 不同；模板表也只采过 Python（见 RESULTS §34 的实测：60 个 demo 的 JS 形态
 * 0/60 能还原）。不先判别语言，用户粘 JS 进来只会得到「未识别」和一条 `}`，看不出是
 * 「形态不支持」还是「代码写错了」。
 *
 * 判别只分两档，宁可漏判也不误判：
 *   - `javascript`：有生成器/JS 的强痕迹（`function name(`、JSDoc 的 `Crypto function`、
 *     或 `const/let/var` 声明加行尾分号），且没有 `def`；
 *   - `python`：其余一切（包括短的 Python 片段、C/C++ 片段）。这些片段仍走 Python
 *     反解析路径，认不出的语句照旧逐条进诊断——把「不认识的形态」一律说成 JS 会是
 *     更糟的谎。
 *
 * 没有 fs / Blockly 依赖：这条判别在浏览器与脚本里用同一份实现。
 */

export type ReverseInputLanguage = 'python' | 'javascript';

/** 顶格或缩进的 `def name(`：Python 生成器与它内嵌的闭包都长这样。 */
const PYTHON_DEF = /^[ \t]*def\s+[A-Za-z_]\w*\s*\(/m;

/**
 * JS 函数声明。生成器的 procedure 与内嵌闭包都是 `function name(...) {`；
 * 允许 `async` 前缀但不放宽到箭头函数——箭头函数多半是用户手写代码，不该被当成
 * 「本平台生成的 JS」。
 */
const JS_FUNCTION = /^[ \t]*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m;

/** `const/let/var name =` 或 `var a, b;`：生成器的变量前导行与过程变量表都用它。 */
const JS_DECLARATION = /^[ \t]*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*=|\s*,)/m;

/** 行尾分号：JS 语句的硬痕迹；单独出现不足以判 JS，与声明同现才采信。 */
const JS_STATEMENT_END = /;\s*$/m;

/** 生成器写在 procedure 题头的 JSDoc 首行，Python 侧对应的是 `"""` 块。 */
const JS_GENERATOR_DOC = /Crypto function:/;

export function detectInputLanguage(code: string): ReverseInputLanguage {
  if (PYTHON_DEF.test(code)) return 'python';
  if (JS_FUNCTION.test(code)) return 'javascript';
  if (JS_DECLARATION.test(code) && JS_STATEMENT_END.test(code)) return 'javascript';
  // 生成器注释块单独出现也认：极短的摘录可能只剩题头。
  if (/^\s*\/\*\*/m.test(code) && JS_GENERATOR_DOC.test(code)) return 'javascript';
  return 'python';
}
