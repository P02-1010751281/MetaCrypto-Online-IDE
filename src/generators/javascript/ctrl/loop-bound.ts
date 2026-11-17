/**
 * 循环端点「只求值一次」
 *
 * Python 的 `for i in range(A, B)` 在进入循环**之前**把 A、B 各求值一次；JS 的
 * `for (let i = A; i < B; i++)` 每一轮都重算条件里的 B。两者在两种常见写法上会跑出
 * 不同次数：
 *
 *   - 端点是有副作用的表达式（`range(0, next())`）；
 *   - 循环体修改了端点变量（`for i in range(0, len(x)): x.append(0)`——Python 只跑
 *     len(x) 次，JS 会越跑越长，直到耗尽内存）。
 *
 * 这里把**非常量端点**先绑到一个临时变量，让 JS 的次数与 Python 一致；字面量不绑，
 * 因为 `for (let i = 0; i < 5; i++)` 本来就不会变，多一个临时变量只会让出码更难读。
 */

const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

export interface LoopBound {
  /** 追加在 `let VAR = FROM` 后面的声明片段，例如 `, __ctrl_range_to__ = n`；字面量时为空串。 */
  declaration: string;
  /** `for` 条件里该用的代码：临时变量名，或原表达式。 */
  reference: string;
  /** 是否真的插入了临时变量（调用方据此决定要不要补一行说明注释）。 */
  captured: boolean;
}

/**
 * 端点绑定。`tempName` 与循环变量同名时（用户把循环变量取成保留临时名的样子）加一个
 * 下划线——`let x = a, x = b` 是语法错，而这类重名只会来自用户的奇怪命名。
 */
export function captureLoopBound(code: string, tempName: string, loopVar: string): LoopBound {
  if (NUMERIC_LITERAL.test(code)) {
    return { declaration: '', reference: code, captured: false };
  }
  const temp = tempName === loopVar ? `${tempName}_` : tempName;
  return { declaration: `, ${temp} = ${code}`, reference: temp, captured: true };
}
