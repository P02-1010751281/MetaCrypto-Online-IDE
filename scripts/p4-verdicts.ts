/**
 * P4 A 线纵向切片 · 第 2 段：三档判定器（能搭 / 部分 / 不能）
 *
 * 输入：experiments/ai-helper-2026-11-14/p4/anchors.json（第 1 段的条款锚点）+ 五个条目页
 *      + src/services/ai-helper/block-index.json（222 块的产品索引）+ 契约里的块类型集合。
 * 输出：experiments/ai-helper-2026-11-14/p4/verdicts.json
 *
 * 纪律（P4-SCOPE.md §3.2/§3.3/§2.3）：
 *   1. **不读「项目状态」字段**——语料里 39 处状态与映射互相矛盾，状态只作人工备注，不进判据。
 *   2. 三级证据：L1 = 条目「项目映射」点名的真实块（条款→块）；L2 = 块 tooltip 引标准号（块→条款，
 *      须与同条款的检索候选相交，避免把全库提到标准的块都算进来）；L3 = block-search BM25 候选。
 *      L3 只作候选，永不单独升级为「能搭」。
 *   3. 档位由**步骤表**算：每一步标 canvas（画布上可见的块/块组合）、internal（只在生成器闭包里）
 *      或 none（没有块）。全 canvas → build；全 none 或不可执行 → missing；其余 → partial。
 *      步骤表是人工语义分解（依据条目页的「公式或伪代码」与「标准定义」），档位是机器按规则算的。
 *   4. 语义等价永远 `unverified`：本脚本不判断块与标准逐行等价。
 *
 * 复跑（隔离构建，不碰 verify:build / verify:all）：
 *   AIVERIFY_ENTRY=scripts/p4-verdicts.ts AIVERIFY_OUTDIR=dist-verify/p4 \
 *     npx vite build --config vite.verify.config.ts && node dist-verify/p4/p4-verdicts.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { search, type BlockIndex, type SearchHit } from '@/services/ai-helper/block-search';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'experiments/ai-helper-2026-11-14/p4');
const INDEX = resolve(ROOT, 'src/services/ai-helper/block-index.json');
const MANIFEST = resolve(ROOT, 'docs/standards/standards-manifest.json');

/**
 * 每个标准一份判定配置。**判定口径本身不在这里**（档位规则、证据层优先级、语义等价永远
 * unverified 都是共享代码），这里只放「随语料版式变化」的三项：
 *
 * - `anchors` / `out`：第 1 段的产物与本文产物路径；
 * - `standardNumberRe`：L2 用的标准号写法（tooltip 里怎么引这部标准）；
 * - `mappingHeading`：条目页里「块映射到哪」那一节的标题。FIPS 180-4 的五个条目页用「…映射」，
 *   SP 800-38B 的 03-MAC 用「…边界」（原文就写着「没有独立验证、截断策略」），只认「映射」会
 *   把 03 的 L1 证据整段漏掉——这是第二份切片抓到的第一处口径耦合。
 *
 * `designPartition` / `variantRe`：`sameVariant` 的判法随标准不同（FIPS 的条款只认 256 路径，
 * CMAC 的条款只认 cmac_* 块）。
 */
interface StandardConfig {
  id: string;
  anchors: string;
  out: string;
  standardNumberRe: RegExp;
  mappingHeading: RegExp;
  variantRe: RegExp;
  models: ClauseModel[];
  /** 是否把步骤的 note（探针/缺口证据）追加进 gaps；默认关闭以保持前两份产物逐字节不变。 */
  stepNotesInGaps?: boolean;
}

function selectStandard(argv: string[]): StandardConfig {
  const at = argv.indexOf('--standard');
  const id = at >= 0 ? argv[at + 1] : 'fips180-4-SHA2';
  const config = CONFIGS[id];
  if (!config) {
    console.error(`未知标准 ${id}；可选：${Object.keys(CONFIGS).join(' / ')}`);
    process.exit(2);
  }
  return config;
}

type Tier = 'build' | 'partial' | 'missing';
type Visibility = 'canvas' | 'internal' | 'none';
type Layer = 'L1' | 'L2' | 'L3' | 'none';

interface ClauseStep {
  id: string;
  section: string;
  text: string;
  blocks: string[];
  visibility: Visibility;
  note?: string;
}

interface ClauseModel {
  entryId: string;
  nonExecutable?: string;
  steps: ClauseStep[];
  /** 标准要求但块模型不表达的约束：单列，不参与档位计算。 */
  claimBoundaries: string[];
  extraGaps: string[];
}

interface AnchorFile {
  counts: Record<string, number>;
  standard: { id: string; name: string; version: string; source_checked_at: string; artifacts: Array<{ path: string; sha256: string }> };
  source: { path: string; lines: number; sha256: string };
  entries: Array<{ clauseId: string; entryPath: string; standardPosition: string | null; declaredPosition: string | null }>;
  clauseUnits: Array<{ clauseId: string; entryId: string; section: string; anchorLevel: string; click: unknown; source: { line_start: number; line_end: number; heading: string; slice_sha256: string }; matchesDeclared: boolean }>;
}

/**
 * 步骤表（人工语义分解，依据条目页的「标准定义」与「公式或伪代码」）。
 * blocks 里的核心块（variables_set / math_* / ctrl_iterate）只有 ctrl_iterate 属 222 项目块，
 * 其余是画布上原生的 Blockly 核心块——它们也算「画布可见」，但不参与 L1/L2 的块名匹配。
 */
const CLAUSE_MODELS: ClauseModel[] = [
  {
    entryId: '01-SHA2',
    nonExecutable: '本页是 SHA-2 算法族导航（参数表 + 算法清单），条目页自己写明「没有独立归属的公式或伪代码规范单元」；没有可执行单元，不能判「能搭」',
    steps: [
      { id: 's1', section: '§6.1–§6.7', text: '算法族导航与参数表（字长/分组/输出长度）', blocks: [], visibility: 'none' },
    ],
    claimBoundaries: ['参数表不是算法步骤；哈希函数的语义由 03/04/05 三页承载'],
    extraGaps: [],
  },
  {
    entryId: '02-Padding',
    steps: [
      { id: 's1', section: '§5.1', text: '追加 1 位（字节 0x80）', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's2', section: '§5.1', text: '追加 k 个 0 位，使长度 ≡ 448 (mod 512)', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's3', section: '§5.1', text: '追加原消息 bit 长度的 64-bit 大端编码', blocks: ['hash_sha256_pad'], visibility: 'canvas' },
      { id: 's4', section: '§5.2', text: '按 512-bit 切分填充后消息（N = bitlen/512 个分组）', blocks: ['data_bit_length', 'math_arithmetic', 'math_round', 'ctrl_iterate', 'pq_bytes_slice'], visibility: 'canvas', note: '试点工程里这一段是 ctrl_iterate + pq_bytes_slice + 两个原生数学块' },
    ],
    claimBoundaries: ['标准要求 0 ≤ λ < 2^64；填充块不强制该上限（块模型没有长度域约束）'],
    extraGaps: [],
  },
  {
    entryId: '03-MessageExpansion',
    steps: [
      { id: 's1', section: '§6.2.2', text: 'W[0..15] ← 分组的 16 个大端 32-bit 字', blocks: ['hash_sha256_compress'], visibility: 'internal', note: '在 compress 生成器闭包内展开' },
      { id: 's2', section: '§6.2.2', text: 'W[16..63] 递推（σ0/σ1）', blocks: ['hash_sha256_compress'], visibility: 'internal' },
    ],
    claimBoundaries: [],
    extraGaps: ['消息扩展没有独立块：语义在 hash_sha256_compress 的生成器闭包里，画布上无法逐步核'],
  },
  {
    entryId: '04-Compression',
    steps: [
      { id: 's1', section: '§6.2.2', text: '每分组初始化 a..h ← H(i−1)', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's2', section: '§6.2.2', text: '64 轮 T1/T2 与工作字轮转', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's3', section: '§6.2.2', text: '工作字加回链状态 H(i)', blocks: ['hash_sha256_compress'], visibility: 'internal' },
      { id: 's4', section: '§6.2.2', text: 'For i=1 to N 依次处理全部分组', blocks: ['ctrl_iterate', 'pq_bytes_slice', 'hash_sha256_compress'], visibility: 'canvas', note: 'P4-SCOPE 判 partial 的理由是这段迭代缺块；本切片用 ctrl_iterate 组合出来了（B.2 两分组向量通过）' },
    ],
    claimBoundaries: [],
    extraGaps: ['64 轮压缩在生成器闭包里，画布无法逐步核；块边界上的输入/输出契约有单测覆盖'],
  },
  {
    entryId: '05-Digest',
    steps: [
      { id: 's1', section: '§6', text: '选变体初值 H(0)（SHA-256 的 8 个 32-bit IV）', blocks: ['data_value'], visibility: 'canvas', note: '用 data_value 字面量表达，可编辑但不是专门块' },
      { id: 's2', section: '§6', text: '8 个工作字按大端串成 32 字节摘要', blocks: [], visibility: 'none' },
      { id: 's3', section: '§6', text: '按变体截断输出长度（SHA-512/224、SHA-512/256）', blocks: [], visibility: 'none' },
    ],
    claimBoundaries: [],
    extraGaps: ['缺 words→bytes 的大端打包块：8 个 32-bit 字无法在画布上拼成 32 字节（试点由 driver 格式化）'],
  },
];

/**
 * SP 800-38B CMAC 的步骤表（人工语义分解，依据 01/02/03 三页的「原文摘录」与「公式或伪代码」）。
 *
 * 与 FIPS 切片同样的口径：**整段过程被一个块吸收时，被吸收的那些步骤记 internal，不记 canvas**。
 * CMAC 这里对应 `cmac_mac`（子密钥 + 最后块掩码 + CBC-MAC + 截断全在一个闭包里），所以
 * 「最后块掩码」这一步不能因为「cmac_mac 能算」就算能搭；能算的是它外圈的通用块组合。
 */
const CMAC_CLAUSE_MODELS: ClauseModel[] = [
  {
    entryId: '01-CMAC',
    steps: [
      { id: 's1', section: '§6', text: '子密钥生成（L=E_K(0^b)，K1/K2 加倍）', blocks: ['cmac_subkeys', 'cmac_double'], visibility: 'canvas' },
      { id: 's2', section: '§6', text: '最后块掩码（整块 xor K1；空消息/不完整块 pad 后 xor K2）', blocks: ['cmac_mac'], visibility: 'internal', note: '只在 cmac_mac 闭包里；画布没有「与 K1/K2 异或 + 10^j 填充」的独立块' },
      { id: 's3', section: '§6', text: '以 X0=0 做 CBC-MAC：Xi=E_K(X(i−1) xor Mi)', blocks: ['mode_cbc_encrypt', 'ctrl_iterate'], visibility: 'canvas', note: '用零 IV 的 mode_cbc_encrypt 组合；不是专门的 CMAC 链块' },
      { id: 's4', section: '§6', text: '输出 Xn，必要时按协议指定长度截断', blocks: ['arr_slice'], visibility: 'canvas', note: '按字节切片；标准允许任意 bit 长度 Tlen' },
    ],
    claimBoundaries: ['标准允许 1 ≤ Tlen ≤ b 的任意 bit 长度；块模型按字节切片，bit 级截断不表达'],
    extraGaps: [],
  },
  {
    entryId: '02-Subkeys',
    steps: [
      { id: 's1', section: '§6.1', text: 'L = CIPH_K(0^b)', blocks: ['mode_ecb_encrypt', 'cmac_subkeys'], visibility: 'internal', note: '唯一能在画布上产出 L 的块 mode_ecb_encrypt 输出 Bytes，而 cmac_double 只收 IntList，224 块里没有 Bytes→IntList 转换块（探针 connect-probe subkey-l 被拒）；能用的是 cmac_subkeys 内部那一步' },
      { id: 's2', section: '§6.1', text: 'MSB1(L)=0 → K1=L<<1，否则 K1=(L<<1) xor Rb', blocks: ['cmac_double'], visibility: 'internal', note: 'cmac_double 只吃 IntList，接不上 s1 的 Bytes 产物（探针 subkey-l）；该步随 cmac_subkeys 闭包一起被吸收' },
      { id: 's3', section: '§6.1', text: 'MSB1(K1)=0 → K2=K1<<1，否则 K2=(K1<<1) xor Rb', blocks: ['cmac_double'], visibility: 'internal', note: '同上：加倍链在 cmac_double/cmac_subkeys 闭包内完成' },
      { id: 's4', section: '§6.1', text: 'Return K1, K2', blocks: ['cmac_subkeys'], visibility: 'canvas', note: 'cmac_subkeys 返回 K1‖K2；过程只能返回一个值，拆包在调用方' },
    ],
    claimBoundaries: ['Rb 的取值依赖分组长度（128 位为 0x87）；块固定 128 位路径，SM4 同构但 b=128 相同'],
    extraGaps: [
      '§6.1 的四步在画布上拼不出来：L 的产物是 Bytes、cmac_double 入口是 IntList，画布拒绝这次连接且没有转换块（p4/connect-probe-sp800-38b.json 三条用例：两条被拒 + Bytes→cmac_mac 正对照通过）',
    ],
  },
  {
    entryId: '03-MAC',
    steps: [
      { id: 's1', section: '§6.2', text: 'Apply SUBK(K) from §6.1 to produce K1 and K2', blocks: ['cmac_subkeys'], visibility: 'canvas' },
      { id: 's2', section: '§6.2', text: 'Mlen=0 → n=1，否则 n=ceil(Mlen/b)', blocks: ['data_bit_length', 'math_arithmetic', 'math_round'], visibility: 'canvas' },
      { id: 's3', section: '§6.2', text: '把 M 切成 M1..M(n-1), Mn*', blocks: ['arr_partition_to_array', 'ctrl_iterate'], visibility: 'canvas' },
      { id: 's4', section: '§6.2', text: 'Mn* 整块 → Mn=K1 xor Mn*；否则 Mn=K2 xor (Mn*‖1‖0^j)', blocks: ['cmac_mac'], visibility: 'internal', note: '只在 cmac_mac 闭包里；画布没有「最后块条件掩码」块' },
      { id: 's5', section: '§6.2', text: 'C0 = 0^b', blocks: ['data_value'], visibility: 'canvas' },
      { id: 's6', section: '§6.2', text: 'for i=1..n: Ci = CIPH_K(C(i−1) xor Mi)', blocks: ['mode_cbc_encrypt', 'ctrl_iterate'], visibility: 'canvas', note: '零 IV 的 CBC 链；单分组加密走同块的 ECB/AES 路径' },
      { id: 's7', section: '§6.2', text: 'T = MSB_Tlen(Cn)', blocks: ['arr_slice'], visibility: 'canvas', note: '按字节切片；bit 级 Tlen 不表达' },
      { id: 's8', section: '§6.2', text: 'Return T', blocks: ['procedures_defreturn'], visibility: 'canvas' },
    ],
    claimBoundaries: ['块模型不表达 bit 级截断（Tlen 非 8 的倍数）', '没有独立验证块（VER 路径不在块集合里）'],
    extraGaps: [],
  },
];

/**
 * SP 800-38C CCM 的步骤表（人工语义分解，依据 01–04 四页的「标准定义」「公式或伪代码」与
 * Appendix A 的格式化 / 计数器函数）。口径与前两份一致：整段被一个块吸收的步骤记 internal。
 *
 * CCM 的分解链比 CMAC 长（格式化 → CBC-MAC → CTR → 标签掩码），画布上的类型门也更硬：
 * ccm_b0 / ccm_counter_block / ccm_aad_len_prefix 输出 IntList，而 AES 块（mode_ecb_encrypt）
 * 与明文入口（ccm_cbc_mac.MSG / ccm_ctr.MSG）要 Bytes。三条被拒的边见
 * p4/connect-probe-sp800-38c-ccm.json；它们决定了 02 与 04 只能判「部分」。
 */
const CCM_CLAUSE_MODELS: ClauseModel[] = [
  {
    entryId: '01-CCM',
    nonExecutable: '本页是 CCM 组合导航页，条目页自己写明「没有独立归属的公式或伪代码规范单元」；§6.1/§6.2 的过程在 02–04 三页拆开判，本页不能重复记「能搭」',
    steps: [
      { id: 's1', section: '§6.1', text: '生成-加密：格式化 (N,A,P) → CBC-MAC → CTR → C‖T', blocks: ['ccm_encrypt'], visibility: 'none', note: '整段过程由 ccm_encrypt 一步吸收；L1 记在 evidence.l1，不进档位' },
      { id: 's2', section: '§6.2', text: '解密-验证：CTR 解出 P → 重算标签 → 比对，失败不返回明文', blocks: ['ccm_decrypt'], visibility: 'none', note: '同上：整段由 ccm_decrypt 吸收，Clen ≤ Tlen 判 INVALID' },
    ],
    claimBoundaries: ['导航页的「能搭」应读成 02–04 三页的并集，不是本页自身可执行'],
    extraGaps: [],
  },
  {
    entryId: '02-Formatting',
    steps: [
      { id: 's1', section: '§6.1', text: 'L = 15 − len(nonce)；B0 = Flags(hasAAD, tagLen, L) ‖ nonce ‖ BE(len(M), L)', blocks: ['ccm_b0'], visibility: 'canvas', note: 'ccm_b0 一个块吸收 L 与 flags 编码（Appendix A.2）' },
      { id: 's2', section: '§6.1', text: 'AAD 长度前缀：a < 0xFF00 用 2 字节，否则 0xFFFE ‖ 4 字节', blocks: ['ccm_aad_len_prefix'], visibility: 'canvas' },
      { id: 's3', section: '§6.1', text: 'AAD 正文拼接与零填充到 16 字节边界', blocks: ['ccm_cbc_mac', 'ccm_encrypt'], visibility: 'internal', note: '画布只有长度前缀；正文拼接与填充在 ccm_formatted 闭包里，ccm_aad_len_prefix 输出 IntList 接不上 ccm_cbc_mac.MSG 的 Bytes，探针 aadprefix-msg 被拒' },
      { id: 's4', section: '§6.1', text: 'Ctr(i) = Flags(0, 0, L) ‖ nonce ‖ BE(i, L)', blocks: ['ccm_counter_block'], visibility: 'canvas' },
      { id: 's5', section: '§6.1', text: 'S_i = AES_K(Ctr(i))', blocks: ['ccm_ctr', 'ccm_encrypt'], visibility: 'internal', note: '计数器块输出 IntList、AES 块入口是 Bytes，224 块里没有 IntList→Bytes 转换块，探针 counter-ecb 被拒；AES 只在 ccm_ctr/ccm_encrypt 闭包内做' },
      { id: 's6', section: '§6.1', text: 'B = B0 ‖ A 编码块 ‖ Pad(P) 的整串组装', blocks: ['ccm_cbc_mac', 'ccm_encrypt'], visibility: 'internal', note: 'ccm_formatted 闭包内完成；画布没有 IntList 拼接/填充块' },
    ],
    claimBoundaries: [
      '标准允许 7–13 字节 nonce 与 4–16 偶数 tagLen 的取值域；块模型已固定 AES-128 路径，非 128-bit 分组不表达',
      'AAD 长度 ≥ 0xFF00 的分支只在 ccm_aad_len_prefix 内表达（a < 2^32）',
    ],
    extraGaps: [],
  },
  {
    entryId: '03-CBC-MAC',
    steps: [
      { id: 's1', section: '§6.1', text: 'X0 = 0^128', blocks: ['data_int_list'], visibility: 'canvas', note: '16 字节零块用 data_int_list 字面量表达' },
      { id: 's2', section: '§6.1', text: '对 B0 ‖ EncodeAAD(A) ‖ Pad(P) 逐块 Xi = AES_K(X(i−1) ⊕ Bi)', blocks: ['ccm_cbc_mac'], visibility: 'canvas', note: 'ccm_cbc_mac 的契约就是这条链（含 CCM 专用格式化输入），与裸 CBC-MAC 不同' },
      { id: 's3', section: '§6.1', text: 'T = MSB_t(X_last ⊕ AES_K(Ctr(0)))', blocks: ['ccm_encrypt'], visibility: 'internal', note: '没有独立的标签掩码块；S0 与异或截断只在 ccm_encrypt 闭包内，03 页自己写明' },
    ],
    claimBoundaries: ['CBC-MAC 的输入编码是 CCM 专用（B0 / AAD 长度编码 / 各自零填充），不能替换成裸 CBC-MAC'],
    extraGaps: ['标签掩码没有独立块：ccm_cbc_mac 只输出 16 字节 X，T 的掩码与截断只能整体走 ccm_encrypt'],
  },
  {
    entryId: '04-CTR',
    steps: [
      { id: 's1', section: '§5.5', text: '计数器块 Ctr_0 … Ctr_m（A_i 格式，i 从 0 起）', blocks: ['ccm_counter_block', 'ctrl_iterate'], visibility: 'canvas', note: 'ccm_counter_block 给单块，多块用 ctrl_iterate 组合' },
      { id: 's2', section: '§6.1', text: 'S_j = AES_K(Ctr_j)', blocks: ['ccm_ctr', 'ccm_encrypt'], visibility: 'internal', note: '同 02：IntList 计数器块接不上 Bytes 入口的 AES 块，探针 counter-ecb 被拒' },
      { id: 's3', section: '§6.1', text: 'C_i = P_i ⊕ S_i', blocks: ['ccm_ctr'], visibility: 'canvas' },
      { id: 's4', section: '§6.1', text: 'T = MSB_t(X ⊕ S0)', blocks: ['ccm_encrypt'], visibility: 'internal', note: 'ccm_ctr 只输出密文段；标签掩码在 ccm_encrypt（04 页自己写明）' },
    ],
    claimBoundaries: ['同一 key 下 nonce 重用会破坏 CCM 安全性；块模型没有 nonce 唯一性检查'],
    extraGaps: [],
  },
];

const CONFIGS: Record<string, StandardConfig> = {
  'fips180-4-SHA2': {
    id: 'fips180-4-SHA2',
    anchors: `${OUT_DIR}/anchors.json`,
    out: `${OUT_DIR}/verdicts.json`,
    standardNumberRe: /FIPS\s*180-4|180-4/i,
    mappingHeading: /^## .*映射/,
    variantRe: /^(?!.*(?:224|512)).*256/,
    models: CLAUSE_MODELS,
  },
  'sp800-38b-cmac': {
    id: 'sp800-38b-cmac',
    anchors: `${OUT_DIR}/anchors-sp800-38b-cmac.json`,
    out: `${OUT_DIR}/verdicts-sp800-38b-cmac.json`,
    standardNumberRe: /SP\s*800-38B|800-38B/i,
    mappingHeading: /^## .*(映射|边界)/,
    variantRe: /cmac/,
    models: CMAC_CLAUSE_MODELS,
  },
  'sp800-38c-ccm': {
    id: 'sp800-38c-ccm',
    anchors: `${OUT_DIR}/anchors-sp800-38c-ccm.json`,
    out: `${OUT_DIR}/verdicts-sp800-38c-ccm.json`,
    standardNumberRe: /SP\s*800-38C|800-38C/i,
    mappingHeading: /^## .*(映射|边界)/,
    variantRe: /ccm/,
    models: CCM_CLAUSE_MODELS,
    stepNotesInGaps: true,
  },
};

interface EntryPage {
  entryId: string;
  entryPath: string;
  title: string;
  mappingText: string;
  mappingLine: number;
  definition: string;
  formula: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 取某个 `## ` 二级标题下的正文，直到下一个二级标题。找不到返回空串。 */
function sectionOf(md: string, heading: RegExp): { text: string; line: number } {
  const lines = md.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return { text: '', line: 0 };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }
  return { text: lines.slice(start + 1, end).join('\n').trim(), line: start + 1 };
}

function loadEntryPage(entry: { clauseId: string; entryPath: string }, mappingHeading: RegExp): EntryPage {
  const md = readFileSync(resolve(ROOT, entry.entryPath), 'utf8');
  const mapping = sectionOf(md, mappingHeading);
  const definition = sectionOf(md, /^## 标准定义/);
  const formula = sectionOf(md, /^## 公式或伪代码/);
  const title = (md.split('\n').find((line) => line.startsWith('# ')) || '').replace(/^#\s*/, '');
  return {
    entryId: entry.clauseId,
    entryPath: entry.entryPath,
    title,
    mappingText: mapping.text,
    mappingLine: mapping.line,
    definition: definition.text,
    formula: formula.text,
  };
}

/** 映射小节里反引号点名的块，只保留产品索引里真有的块类型。 */
function mappingBlocks(text: string, index: BlockIndex): Array<{ blockType: string; quote: string }> {
  const known = new Set(index.blocks.map((block) => block.blockType));
  const found = new Map<string, string>();
  // 两种写法都认：裸块名 `` `hash_sha256_pad` `` 与带调用签名的 `` `hash_sha256_compress(V, W)` ``
  for (const match of text.matchAll(/`([a-z][a-z0-9_]*)(\([^`]*\))?`/g)) {
    const name = match[1];
    if (!known.has(name) || found.has(name)) continue;
    const at = text.indexOf(match[0]);
    const quote = text.slice(Math.max(0, at - 40), Math.min(text.length, at + match[0].length + 40)).replace(/\s+/g, ' ');
    found.set(name, quote);
  }
  return [...found.entries()].map(([blockType, quote]) => ({ blockType, quote }));
}

/** 块 tooltip 里引了标准号的块（L2 的候选池）。标准号写法随标准不同，由配置给。 */
function tooltipStandardBlocks(index: BlockIndex, standardNumberRe: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of index.blocks) {
    const tooltip = `${block.tooltips.en}\n${block.tooltips.zh}`;
    if (!standardNumberRe.test(tooltip)) continue;
    out.set(block.blockType, tooltip.replace(/\s+/g, ' ').slice(0, 160));
  }
  return out;
}

/** L3 查询：页面标题 + 标准定义首句（不含映射小节的块名，避免把 L1 信息灌进候选）。 */
function queryFor(page: EntryPage, standardName: string): string {
  const firstSentence = page.definition.split(/[。\n]/).find((part) => part.trim().length > 4) || page.definition;
  return `${standardName} ${page.title} ${firstSentence.trim()}`;
}

function tierOf(model: ClauseModel, layer: Layer): { tier: Tier; reason: string } {
  if (model.nonExecutable) return { tier: 'missing', reason: 'non-executable' };
  const canvas = model.steps.filter((step) => step.visibility === 'canvas').length;
  const none = model.steps.filter((step) => step.visibility === 'none').length;
  if (none === model.steps.length) return { tier: 'missing', reason: 'no-block' };
  if (canvas === model.steps.length && layer !== 'none') return { tier: 'build', reason: 'all-steps-canvas' };
  return { tier: 'partial', reason: canvas > 0 ? 'mixed-steps' : 'internal-only' };
}

function main(): void {
  const config = selectStandard(process.argv.slice(2));
  const anchors = readJson<AnchorFile>(config.anchors);
  const index = readJson<BlockIndex>(INDEX);
  const manifest = readJson<{ entries: Array<{ id: string; standard: string; version: string }> }>(MANIFEST);
  const standard = manifest.entries.find((entry) => entry.id === config.id);
  if (!standard) throw new Error(`manifest 缺 ${config.id}`);
  if (anchors.standard.id !== standard.id) throw new Error('anchors 与 manifest 的标准 id 不一致，先重跑第 1 段');

  const standardBlocks = tooltipStandardBlocks(index, config.standardNumberRe);
  const clauses = config.models.map((model) => {
    const anchorEntry = anchors.entries.find((entry) => entry.clauseId === model.entryId);
    if (!anchorEntry) throw new Error(`anchors 缺条目 ${model.entryId}`);
    const page = loadEntryPage(anchorEntry, config.mappingHeading);
    const l1Blocks = mappingBlocks(page.mappingText, index);
    const hits: SearchHit[] = search(index, {
      inTypes: [],
      outTypes: [],
      text: queryFor(page, standard.standard),
      limit: 10,
    });
    const top5 = hits.slice(0, 5).map((hit) => ({ blockType: hit.blockType, score: Math.round(hit.score * 100) / 100 }));
    const l2Blocks = hits.slice(0, 5)
      .filter((hit) => standardBlocks.has(hit.blockType))
      .map((hit) => ({
        blockType: hit.blockType,
        tooltip: standardBlocks.get(hit.blockType) || '',
        /** 是否就是本条路径的变体：FIPS 的条款只认 256 路径；CMAC 的条款只认 cmac_* 块。 */
        sameVariant: config.variantRe.test(hit.blockType),
      }));
    const layer: Layer = l1Blocks.length > 0 ? 'L1' : l2Blocks.length > 0 ? 'L2' : top5.length > 0 ? 'L3' : 'none';
    const { tier, reason } = tierOf(model, layer);
    const sectionUnits = anchors.clauseUnits
      .filter((unit) => unit.entryId === model.entryId)
      .map((unit) => ({
        section: unit.section,
        click: unit.click,
        anchorLevel: unit.anchorLevel,
        matchesDeclared: unit.matchesDeclared,
        slice_sha256: unit.source.slice_sha256,
        heading: unit.source.heading,
      }));
    // 不可执行条款只报一条原因：导航页不该被拆成「某步没有块」的噪音。
    const gaps = model.nonExecutable ? [model.nonExecutable] : [
      ...model.extraGaps,
      ...model.steps
        .filter((step) => step.visibility !== 'canvas')
        .map((step) => `${step.section} 步骤「${step.text}」${step.visibility === 'internal' ? '只在生成器闭包里，画布无法逐步核' : '没有对应块'}${config.stepNotesInGaps && step.note ? `（${step.note}）` : ''}`),
    ];
    return {
      clauseId: page.entryId,
      entryPath: page.entryPath,
      title: page.title,
      standardPosition: anchorEntry.standardPosition,
      tier,
      tierReason: reason,
      evidenceLayer: layer,
      anchors: sectionUnits,
      evidence: {
        l1: {
          hit: l1Blocks.length > 0,
          blocks: l1Blocks,
          source: { path: page.entryPath, line: page.mappingLine, heading: '项目映射' },
        },
        l2: {
          hit: l2Blocks.length > 0,
          blocks: l2Blocks,
          note: '标准号取自块 tooltip，且该块须出现在同一查询的前 5 个 BM25 候选里；sameVariant 标出是否就是本条路径的变体',
        },
        l3: {
          hit: top5.length > 0,
          query: queryFor(page, standard.standard),
          top5,
          note: 'L3 只作候选，不单独升级档位',
        },
      },
      steps: model.steps,
      stepCounts: {
        total: model.steps.length,
        canvas: model.steps.filter((step) => step.visibility === 'canvas').length,
        internal: model.steps.filter((step) => step.visibility === 'internal').length,
        none: model.steps.filter((step) => step.visibility === 'none').length,
      },
      gaps,
      claimBoundaries: model.claimBoundaries,
      semantic_equivalence: 'unverified',
    };
  });

  const count = (tier: Tier): number => clauses.filter((clause) => clause.tier === tier).length;
  const layers = { L1: 0, L2: 0, L3: 0, none: 0 };
  for (const clause of clauses) layers[clause.evidenceLayer] += 1;

  const payload = {
    schemaVersion: 1,
    generatedBy: 'scripts/p4-verdicts.ts',
    standard: { id: standard.id, name: standard.standard, version: standard.version, source_checked_at: anchors.standard.source_checked_at },
    inputs: {
      anchors: config.anchors.replace(`${ROOT}/`, ''),
      anchorsSource: anchors.source,
      blockIndex: 'src/services/ai-helper/block-index.json',
      blockTypes: index.blocks.length,
      tooltipStandardPool: { size: standardBlocks.size, blocks: [...standardBlocks.keys()] },
    },
    rules: {
      noProjectStatusField: true,
      tiers: 'build = 全部步骤 canvas 且有 L1/L2；partial = 混合或仅内部；missing = 无可执行单元 / 全无块',
      evidence: 'L1 映射块名 > L2 tooltip 标准号 ∩ BM25 候选 > L3 BM25 候选（只作候选）',
      semanticEquivalence: 'unverified',
    },
    counts: {
      clauses: clauses.length,
      build: count('build'),
      partial: count('partial'),
      missing: count('missing'),
      evidenceLayers: layers,
      clausesWithSameVariantL2: clauses.filter((clause) => clause.evidence.l2.blocks.some((block) => block.sameVariant)).length,
      gaps: clauses.reduce((sum, clause) => sum + clause.gaps.length, 0),
    },
    clauses,
  };
  writeFileSync(config.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  for (const clause of clauses) {
    console.log(`VERDICT ${clause.clauseId.padEnd(22)} ${clause.tier.padEnd(8)} layer=${clause.evidenceLayer} ` +
      `steps=${clause.stepCounts.canvas}/${clause.stepCounts.total} canvas, L1=${clause.evidence.l1.blocks.length} ` +
      `L2=${clause.evidence.l2.blocks.length} L3top5=${clause.evidence.l3.top5.slice(0, 3).map((hit) => hit.blockType).join(',')}`);
  }
  console.log(`VERDICTS build=${count('build')} partial=${count('partial')} missing=${count('missing')} ` +
    `layers=${JSON.stringify(layers)} gaps=${payload.counts.gaps}`);
  console.log(`VERDICTS out=${config.out.replace(`${ROOT}/`, '')}`);
}

main();
