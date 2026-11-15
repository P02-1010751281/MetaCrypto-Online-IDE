/**
 * D 线「查块」的查询术语层（用户侧 AI Helper · 浏览器端内核）
 *
 * 问题：221 个块里只有 47 个带中文显示文本，其余标签是英文字面量
 * （`GF(2) PolyGCD(`、`PKCS7(`、`ModPow(`）。用户用中文口语描述意图时
 * （「求两个多项式的最大公因式」），子串匹配打不中任何英文字段。
 *
 * 做法：把中文口语意图映射成**索引里真实存在的英文词元**，在查询侧扩展词项，
 * 不改索引、不改块定义，因此完全确定性、可离线、浏览器可跑。
 *
 * 纪律：
 * - 术语表只做「中文 → 英文词元」，不做打分规则的例外；权重只表达信号强度。
 * - 每条扩展都带 via（来源术语），命中结果必须能回答「为什么命中」。
 * - 这里不引入任何块名/算法名，否则等于把答案写进查询。
 */

export interface WeightedTerm {
  term: string;
  weight: number;
  /** 术语层来源（如「术语「查表」⇒ sbox」）；原生分词产生的词项没有该字段。 */
  via?: string;
}

interface GlossaryEntry {
  /** 中文口语别名，任一出现即触发（子串匹配，按 NFKC + 小写后比较）。 */
  zh: string[];
  /** 注入的英文词元，必须能在索引的 label / blockType / python / definitions 中找到。 */
  en: string[];
  /** 信号强度：1.6 强（区分度高的术语）/ 0.9 弱（通用动词、类型名）。 */
  weight: number;
}

/** 中文口语 → 英文词元。顺序不影响结果（每个词项取最大权重）。 */
export const GLOSSARY: GlossaryEntry[] = [
  // ---- 区分度高的密码语义 ----
  { zh: ['最大公因式', '最大公约数', '公因式', '公因子'], en: ['gcd'], weight: 1.6 },
  { zh: ['多项式'], en: ['poly'], weight: 1.6 },
  { zh: ['椭圆曲线'], en: ['elliptic', 'curve', 'ecc'], weight: 1.6 },
  { zh: ['两倍点', '倍点', '2倍点'], en: ['double'], weight: 1.6 },
  { zh: ['倍乘', '多倍点', '标量乘'], en: ['multiply', 'scalar'], weight: 1.6 },
  { zh: ['二元域', 'gf(2', 'gf2'], en: ['gf(2'], weight: 1.5 },
  { zh: ['查表'], en: ['sbox', 'lookup', 'substitute'], weight: 1.6 },
  { zh: ['认证标签', '完整性标签', '消息认证码', '防篡改'], en: ['mac', 'tag'], weight: 1.6 },
  { zh: ['伪随机', '随机字节', '随机数'], en: ['random', 'drbg'], weight: 1.6 },
  { zh: ['密钥流'], en: ['keystream'], weight: 1.6 },
  { zh: ['默克尔', '哈希树'], en: ['merkle'], weight: 1.6 },
  { zh: ['数论变换', 'ntt'], en: ['ntt'], weight: 1.6 },
  { zh: ['模幂', '幂运算'], en: ['modpow'], weight: 1.6 },
  { zh: ['逆元', '模逆'], en: ['inv'], weight: 1.6 },
  { zh: ['异或', 'xor'], en: ['xor'], weight: 1.6 },
  { zh: ['取反', '按位取反', '非运算'], en: ['not'], weight: 1.4 },
  { zh: ['轮密钥'], en: ['roundkey', 'round key'], weight: 1.6 },
  { zh: ['初始密钥', '种子密钥', '种子'], en: ['seed'], weight: 1.3 },
  { zh: ['有限域'], en: ['gf', 'field'], weight: 1.4 },
  { zh: ['长度'], en: ['length'], weight: 1.4 },
  { zh: ['切成', '切分', '切段'], en: ['split', 'slice'], weight: 1.2 },
  // 下拉算子：这些词只出现在块的选项文本里（索引的 option 字段），不在默认显示文本里。
  { zh: ['按位或'], en: ['按位或'], weight: 1.6 },
  { zh: ['按位左移'], en: ['按位左移'], weight: 1.4 },
  { zh: ['按位右移'], en: ['按位右移'], weight: 1.4 },
  { zh: ['拼接', '连接', '合并'], en: ['concat'], weight: 1.3 },
  { zh: ['交换', '字节序'], en: ['swap', 'endian'], weight: 1.2 },
  { zh: ['吸收'], en: ['absorb'], weight: 1.4 },
  { zh: ['挤出', '挤压'], en: ['squeeze'], weight: 1.4 },
  { zh: ['采样', '抽样'], en: ['sample'], weight: 1.3 },
  { zh: ['按位与', '与运算'], en: ['and'], weight: 1.6 },
  { zh: ['循环左移'], en: ['rotate left'], weight: 1.6 },
  { zh: ['循环右移'], en: ['rotate right'], weight: 1.6 },
  { zh: ['计数器'], en: ['ctr'], weight: 1.6 },
  { zh: ['压缩函数', '压缩'], en: ['compress'], weight: 1.6 },
  { zh: ['海绵'], en: ['sponge'], weight: 1.6 },
  { zh: ['十六进制'], en: ['hex'], weight: 1.5 },
  { zh: ['64 进制', '64进制', 'base64'], en: ['base64'], weight: 1.5 },
  { zh: ['公私钥', '密钥对'], en: ['keygen'], weight: 1.4 },
  { zh: ['分组', '块长度'], en: ['block'], weight: 0.8 },
  { zh: ['哈希', '散列', '摘要', '指纹'], en: ['hash', 'digest'], weight: 1.4 },
  { zh: ['矩阵'], en: ['mat'], weight: 1.3 },
  { zh: ['乘积', '相乘', '乘法'], en: ['mul'], weight: 1.3 },
  { zh: ['大整数', '大数'], en: ['bn', 'bignum', 'to int', 'integer'], weight: 1.6 },
  { zh: ['比特串', '位串', '比特序列', '比特'], en: ['bit'], weight: 0.4 },
  { zh: ['字节串', '字节序列', '字节数组', '字节'], en: ['byte'], weight: 0.5 },
  { zh: ['填充', '补齐'], en: ['pad'], weight: 1.4 },
  { zh: ['口令', '密码短语'], en: ['password'], weight: 1.2 },
  { zh: ['盐'], en: ['salt'], weight: 1.2 },
  { zh: ['迭代'], en: ['iter'], weight: 1.2 },
  { zh: ['派生', '扩展'], en: ['derive', 'expand', 'extract'], weight: 1.2 },
  { zh: ['分段', '切片', '分割'], en: ['slice', 'partition'], weight: 1.1 },
  { zh: ['相加', '求和', '加法'], en: ['add'], weight: 1.2 },
  { zh: ['取模', '模运算', '模数'], en: ['mod'], weight: 1.2 },
  { zh: ['文本'], en: ['text'], weight: 0.5 },
  { zh: ['消息'], en: ['msg'], weight: 0.6 },
  { zh: ['篡改'], en: ['tamper'], weight: 0.6 },
  { zh: ['生成'], en: ['generate'], weight: 0.5 },
  { zh: ['转换', '转成', '变成', '解释成', '还原成'], en: ['convert'], weight: 0.8 },
  { zh: ['密钥'], en: ['key'], weight: 0.5 },
  { zh: ['加密'], en: ['encrypt'], weight: 0.5 },
  { zh: ['解密'], en: ['decrypt'], weight: 0.5 },
  { zh: ['签名'], en: ['sign'], weight: 0.8 },
  { zh: ['验签', '校验签名'], en: ['verify'], weight: 1.1 },
];

/** 已有的中英同义词组（原生分词后的双向扩展，与术语表互补）。 */
export const SYNONYM_GROUPS: string[][] = [
  ['mac', 'hmac', 'cmac', 'gmac', '消息认证码', '认证码'],
  ['xor', '异或', '按位异或'],
  ['sbox', 's-box', 's盒', 's 盒'],
  ['substitute', 'substitution', '替换', '代换'],
  ['modexp', 'modpow', 'mod pow', '模幂', '幂模'],
  ['inverse', 'inv', '逆元', '模逆'],
  ['hash', '散列', '哈希', '摘要'],
  ['encrypt', '加密'],
  ['encode', '编码'],
  ['decode', '解码'],
  ['signature', 'sign', '签名'],
  ['verify', '验签', '校验'],
  ['padding', 'pad', '填充'],
  ['compress', '压缩', '压缩函数'],
  ['roundkey', 'round key', '轮密钥', '轮密钥加'],
  ['keystream', 'key stream', '密钥流'],
  ['random', '随机', '随机数'],
  ['nonce', '随机数'],
  ['keygen', 'key generation', '密钥生成', '生成密钥'],
  ['bytes', '字节', '字节序列'],
  ['bits', '比特', '位串'],
  ['hex', '十六进制'],
  ['base64', 'b64'],
  ['permutation', '置换'],
  ['matrix', '矩阵'],
  ['polynomial', 'poly', '多项式'],
  ['add', '加法'],
  ['bn', '大数', 'bignum'],
  ['mix', '混合'],
  ['round', 'round function', '轮函数'],
  ['root', '根', '树根'],
  ['expand', '扩展'],
  ['gcd', '公因式', '最大公因式'],
];

const CJK = /[\u3400-\u9fff]/;

/** 归一化：NFKC + 小写，并去掉中英之间的空格（「16 字节」→「16字节」）。 */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([a-z0-9])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/([\u3400-\u9fff])\s+(?=[a-z0-9])/g, '$1');
}

/**
 * 把一句原始查询拆成带权词项：分词 + 中文二元组 + 同义词扩展 + 术语表扩展。
 * 纯函数，无 I/O；相同输入永远得到相同输出（排序按码点）。
 */
export function buildTerms(raw: string): WeightedTerm[] {
  // 注意：先按「带空格」的原文切词，否则「SM4 轮函数」会被并成一个词元，
  // 算法名 sm4 与「轮函数」都从词项里消失（v1 真出过这个回归）。
  const text = raw.normalize('NFKC').toLowerCase();
  const collapsed = normalizeQuery(raw);
  const weights = new Map<string, { weight: number; via?: string }>();
  const add = (term: string, weight: number, via?: string): void => {
    const value = term.trim();
    if (!value || /^[a-z0-9]$/i.test(value)) return;
    // 纯数字（32、64、128、512…）只表示位宽/长度，不能压过语义词：
    // 「对两个 32 位字做按位或」曾因 32 命中四个字段而把按位或块挤出前 5。
    const effective = /^\d+$/.test(value) ? weight * 0.4 : weight;
    const weight_ = effective;
    const current = weights.get(value);
    if (current && current.weight >= weight_) return;
    weights.set(value, via ? { weight: weight_, via } : { weight: weight_ });
  };

  const variants = [text, collapsed];
  for (const variant of variants) {
    for (const chunk of variant.split(/[^\p{L}\p{N}^+\-.]+/u)) {
      if (!chunk) continue;
      add(chunk, 1);
      for (const part of chunk.split(/[-_.]+/)) if (part.length > 1 && part !== chunk) add(part, 0.8);
      if (CJK.test(chunk)) {
        for (let i = 0; i < chunk.length - 1; i += 1) {
          const bigram = chunk.slice(i, i + 2);
          if (bigram.length === 2 && CJK.test(bigram)) add(bigram, 0.4);
        }
      }
    }
  }

  const snapshot = [...weights.entries()];
  for (const group of SYNONYM_GROUPS) {
    for (const [term, entry] of snapshot) {
      if (!group.includes(term)) continue;
      for (const alias of group) if (alias !== term) add(alias, entry.weight * 0.7);
    }
  }

  // 术语层：把中文口语意图映射成索引里真实存在的英文词元。
  for (const entry of GLOSSARY) {
    const alias = entry.zh.find((item) => collapsed.includes(item));
    if (!alias) continue;
    for (const en of entry.en) add(en, entry.weight, `术语「${alias}」⇒ ${en}`);
  }

  return [...weights.entries()]
    .map(([term, entry]) => (entry.via ? { term, weight: entry.weight, via: entry.via } : { term, weight: entry.weight }))
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}
