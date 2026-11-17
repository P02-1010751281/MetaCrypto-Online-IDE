/**
 * 两条反解析路径共用的诊断文案（模板路径 `core/` 与 AST 路径 `ast/`）。
 *
 * 同一段代码在两条路径上必须说同一句话：面板只显示文本时，措辞不同会让用户以为遇到两个
 * 问题。文案里一律写清**缺的是哪个原语**，而不是笼统的「不支持」。
 */

/** 非字面量区间的推导式：缺的正是「往列表末尾追加」这一个原语。 */
export const MISSING_APPEND =
  '缺 list append（追加）原语：lists_setIndex 被覆盖成只做按下标赋值，lists_create_with 的项数必须静态确定';

/** 所以只认「生成器全是字面量 range」的推导式。 */
export const COMP_RANGE = `推导式只认 range(字面量) 的生成器（展开次数要能静态确定）：${MISSING_APPEND}`;

/** 带 `if` 的推导式：先收集再筛选，两步都落在同一个缺席的原语上。 */
export const COMP_IF = `带 if 的推导式要先追加进列表再筛选，同样缺 list append（追加）与条件过滤原语：${MISSING_APPEND}`;

/** 展开后的项数超过列表块上限。 */
export const compTooLong = (count: number): string => `推导式展开后过长（${count} 项，上限 64）`;

/** 两/三参数 range 的常量空区间：Python 不执行，块模型没有「零次」的闭区间。 */
export const RANGE_EMPTY = 'range 在常量上是空区间（起点 ≥ 终点）：Python 不执行循环体，块模型没有空区间';

/**
 * 两/三参数 range 的非常量端点：块出来了，但空区间会倒序执行（语义漂移）。
 *
 * 缺的原语是「起点 + 次数」的计数循环：`ctrl_iterate` 只接次数（变量恒从 0 起），
 * `controls_for` 是闭区间且自适应方向。所以这里不能整条拒绝（`range(0, len(x))` 这类写法
 * 会全部丢掉），只能出块并明确告诉用户差在哪。
 */
export const RANGE_ENDPOINT =
  'range 的起点/终点不是字面量：缺「起点 + 次数」的两参数计数循环原语——ctrl_iterate 只接次数（变量恒从 0 起），controls_for 是闭区间且起点 ≥ 终点时倒序执行；非常量端点无法静态判定空区间，Python 一次也不执行';

/** range 的参数个数超出块模型：`ctrl_iterate` 只接次数，`controls_for` 只接闭区间两端与步长。 */
export const RANGE_ARITY =
  'range 只接 1–3 个参数：循环块只有「次数」（ctrl_iterate）与「闭区间终点」（controls_for）两种形态';

/** 步长不是 1：`controls_for` 的 TO 是闭区间终点，换算不成任意步长。 */
export const RANGE_STEP =
  '只支持步长为 1 的 range：controls_for 的 TO 是闭区间终点，步长非 1 时区间换算不对（BY 只是块内递增量）';

/** 带步长的切片：`arr_slice` 只有起点与长度两个输入。 */
export const SLICE_STEP = '带步长的切片没有对应块：arr_slice 只有起点与长度，没有步长';

/** 切片终点小于起点：块要求长度非负，而 Python 返回空列表。 */
export const SLICE_LENGTH = '切片终点小于起点：arr_slice 的长度必须非负，Python 返回空列表';

/** 切片起终点一正一负：负起点会先按长度归一，`j - i` 不再是元素个数。 */
export const SLICE_SIGN =
  '切片起终点一正一负：arr_slice 的负起点会先按长度归一，`j - i` 不再是元素个数';

/**
 * 省略终点的切片：长度只能用 `len(源) - 起点` 表示。起点为正且源比它还短时，块会算出负长度
 * 并抛错，Python 返回空列表——缺的是一个 min/钳位原语（列表块里没有标量 min）。
 */
export const SLICE_TAIL_DRIFT =
  '省略终点的切片用 len(源) - 起点 表示长度：起点为正且源比它还短时，块会算出负长度并抛错，Python 返回空列表（缺 min/钳位原语）';

/** 起终点都不是字面量：块会因负长度报错，Python 返回空列表。 */
export const SLICE_DRIFT =
  '切片起终点不是字面量：终点小于起点时块会因负长度报错，Python 返回空列表';
