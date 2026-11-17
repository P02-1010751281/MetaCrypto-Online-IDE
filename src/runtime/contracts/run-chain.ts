/**
 * 浏览器内运行链（run chain）的公共契约 —— 纯类型，零运行时依赖。
 *
 * 这是 MetaCrypto Online IDE 与 metacrypt_server 两侧共用的唯一权威定义：调用方只依赖本文件
 * 的类型与函数形状，具体执行由各宿主实现提供。契约只描述「调用方看到什么」，
 * 不描述「怎么执行」，因此两侧实现可以完全不同而调用方无感。
 *
 * 本文件由 scripts/sync-to-metacrypt.sh 镜像到
 * `frontend/src/features/blockly/runtime/contracts/run-chain.ts`，两侧必须逐字节一致；
 * 改动请先改这里。
 */

/**
 * 结构化错误码。
 *
 * 实现层只上报错误码，自然语言文案由调用方按 i18n 映射——这条边界保证同一份运行链
 * 在两种语言、两个宿主下行为一致，也避免工具层硬编码中文。
 */
export type RunErrorCode =
  | 'busy'
  | 'timeout'
  | 'run_timeout'
  | 'load_timeout'
  | 'output_limit'
  | 'worker_unavailable'
  | 'worker_failed'
  | 'load_failed'
  | 'run_failed';

/** 一次试运行的结果。线程与资源错误都折成 `errorCode`，不向调用方抛异常。 */
export interface RunResult {
  ok: boolean;
  /** 表达式返回值（Python 最后一行表达式的值；JS 主要看 console 输出） */
  result?: string;
  error?: string;
  errorCode?: RunErrorCode;
}

/** 运行时装载进度：`loaded`/`total` 单位为字节，`total` 为 0 表示分母未知。 */
export interface RunProgress {
  loaded: number;
  total: number;
  /** 运行时就绪、开始执行代码；此后再报进度已无意义 */
  ready: boolean;
}

/**
 * 运行时资源定位。
 *
 * 运行链不假设资源从哪来：单机版由构建期把 Pyodide 复制到同源 `public/pyodide/`，
 * 服务器版可以用别的路径或 CDN。把定位信息作为参数注入，是这条链唯一的外部依赖，
 * 也是它能够脱离宿主复用的原因。
 */
export interface RuntimeAssets {
  /** Pyodide 运行时目录的绝对 URL（末尾带斜杠），如 `https://host/pyodide/`。 */
  pyodideIndexUrl: string;
  /** 构建期写入的字节清单 URL；缺省时进度退化为「分母未知」。 */
  manifestUrl?: string;
}

/**
 * 两个入口目前的位置参数语义不同：Python 的第 3 参是 `onProgress`，
 * JavaScript 的第 3 参是 `{ timeoutMs }` 选项。
 *
 * 契约因此只固定 `RunResult` / `RunProgress` / `RuntimeAssets` 三样，不定义统一的
 * 函数类型——提前给出一个「看起来统一」的签名，会在调用处撒谎。
 *
 * 收敛顺序：先让两侧都用 `RuntimeAssets` 注入资源，再把第 3 参合并为 `RunOptions`，
 * 届时才在契约里补 `RunCode`。
 */
