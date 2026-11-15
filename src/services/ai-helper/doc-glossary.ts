/**
 * 文档检索的同义词/中英术语层。
 *
 * 词面检索打不中两种情况（RESULTS §17.4 实测）：
 *   1. 用户按意图提问而不出现标准里的词——「带认证的加密」vs 标准页里的 CCM/GCM/GB/T 36624；
 *   2. 英文提问查中文标准页——`round function` vs 「轮函数」。
 * 做法与块检索一致：**只扩查询、不改索引**，每条扩展带 via，命中可解释。
 *
 * 纪律：这里只放「标准与技术通用」的对照，不放答案（不写具体算法结论）。
 */

import { stripMarkdown, tokenize } from './doc-tokenize';

export interface DocGlossaryEntry {
  /** 中文别名（子串匹配，NFKC 后小写比较）。 */
  zh: string[];
  /** 英文/拉丁别名（按词元整词匹配，避免 `pad` 命中 `padding` 之外的噪音）。 */
  en: string[];
  /** 扩展权重：1.6 强区分术语 / 1.0 通用术语。 */
  weight: number;
}

export const DOC_GLOSSARY: DocGlossaryEntry[] = [
  // ---- 认证加密与工作模式 ----
  { zh: ['认证加密', '带认证的加密', '可鉴别'], en: ['aead', 'gcm', 'ccm', 'eax', 'ocb'], weight: 1.6 },
  { zh: ['分组密码'], en: ['block', 'cipher', 'modes'], weight: 1.2 },
  { zh: ['工作模式', '操作模式'], en: ['modes', 'mode'], weight: 1.3 },
  { zh: ['初始向量', '初始计数器'], en: ['iv', 'nonce', 'counter'], weight: 1.4 },
  { zh: ['填充'], en: ['padding', 'pad'], weight: 1.4 },
  { zh: ['密钥扩展', '轮密钥'], en: ['key', 'expansion', 'schedule', 'rcon'], weight: 1.6 },
  // ---- 散列与派生 ----
  { zh: ['哈希', '杂凑', '散列'], en: ['hash', 'digest'], weight: 1.4 },
  { zh: ['消息认证码'], en: ['mac', 'cmac', 'hmac'], weight: 1.4 },
  { zh: ['密钥派生'], en: ['kdf', 'derive', 'hkdf', 'pbkdf2', 'argon2'], weight: 1.5 },
  { zh: ['海绵结构'], en: ['sponge', 'absorb', 'squeeze'], weight: 1.6 },
  { zh: ['压缩函数'], en: ['compression', 'compress'], weight: 1.5 },
  // ---- 公钥与后量子 ----
  { zh: ['椭圆曲线'], en: ['elliptic', 'curve', 'ecc'], weight: 1.5 },
  { zh: ['数字签名'], en: ['signature', 'sign', 'verify'], weight: 1.3 },
  { zh: ['密钥协商', '密钥交换'], en: ['key', 'exchange', 'agreement', 'ecdh'], weight: 1.4 },
  { zh: ['标识密码'], en: ['identity', 'based', 'sm9'], weight: 1.5 },
  { zh: ['后量子', '抗量子'], en: ['post', 'quantum', 'pqc'], weight: 1.4 },
  { zh: ['格基', '格密码'], en: ['lattice', 'lwe', 'sis'], weight: 1.5 },
  { zh: ['密钥封装'], en: ['kem', 'encaps'], weight: 1.5 },
  { zh: ['拒绝采样'], en: ['rejection', 'sampling', 'sample'], weight: 1.5 },
  { zh: ['参数集'], en: ['parameter', 'params', 'set'], weight: 1.2 },
  // ---- 随机性 ----
  { zh: ['随机数', '随机性'], en: ['random', 'rng', 'drbg'], weight: 1.4 },
  { zh: ['熵输入', '熵源'], en: ['entropy', 'seed'], weight: 1.5 },
  { zh: ['检测', '测试'], en: ['test', 'tests'], weight: 1.1 },
  // ---- 工程与文档 ----
  { zh: ['测试向量'], en: ['test', 'vector'], weight: 1.3 },
  { zh: ['安全强度', '安全级别'], en: ['security', 'strength', 'level', 'bits'], weight: 1.2 },
  { zh: ['字节序', '端序'], en: ['endian', 'byte', 'order'], weight: 1.3 },
  { zh: ['实现边界', '适用范围'], en: ['scope', 'implementation', 'limits'], weight: 1.1 },
  { zh: ['轮函数'], en: ['round', 'function'], weight: 1.6 },
  { zh: ['线性变换'], en: ['linear', 'transform'], weight: 1.4 },
  { zh: ['s 盒', 's盒'], en: ['sbox', 's-box', 'substitution'], weight: 1.6 },
  { zh: ['模运算', '模加', '模乘'], en: ['modular', 'mod', 'multiply'], weight: 1.3 },
  // ---- 文献检索补充（英文论文里的标准术语；中文提问要靠它跨语言）----
  { zh: ['数论变换'], en: ['ntt', 'number', 'theoretic', 'transform'], weight: 1.5 },
  { zh: ['拒绝采样'], en: ['rejection', 'sampling'], weight: 1.6 },
  { zh: ['最小熵'], en: ['min', 'entropy', 'min-entropy'], weight: 1.5 },
  { zh: ['模数', '模 q'], en: ['modulus', 'moduli'], weight: 1.4 },
  { zh: ['随机预言机'], en: ['random', 'oracle'], weight: 1.5 },
  { zh: ['形式化验证', '机器验证', '可验证'], en: ['formal', 'verification', 'verified'], weight: 1.4 },
  { zh: ['常数时间', '恒定时间'], en: ['constant', 'time', 'constant-time'], weight: 1.6 },
  { zh: ['侧信道'], en: ['side', 'channel'], weight: 1.5 },
  { zh: ['安全模型', '安全性证明'], en: ['security', 'model', 'proof'], weight: 1.2 },
  { zh: ['无状态', '哈希签名', '哈希基签名'], en: ['stateless', 'hash', 'based', 'signature'], weight: 1.4 },
  { zh: ['实现指南'], en: ['implementation', 'guidance'], weight: 1.2 },
  { zh: ['测试套件'], en: ['test', 'suite'], weight: 1.2 },
  { zh: ['已验证的密码库', '密码库'], en: ['verified', 'library'], weight: 1.3 },
];

/** 词元 → 扩展权重（基础词元权重 1）。 */
export function expandQuery(query: string): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number): void => {
    for (const term of tokenize(text)) {
      const current = weights.get(term) ?? 0;
      if (weight > current) weights.set(term, weight);
    }
  };

  const lower = stripMarkdown(query).toLowerCase();
  const words = new Set(tokenize(query));
  for (const entry of DOC_GLOSSARY) {
    const zhHit = entry.zh.some((alias) => lower.includes(alias));
    const enHit = entry.en.some((alias) => words.has(alias));
    if (!zhHit && !enHit) continue;
    // 中英两侧都注入：中文问句要能命中标准页里的英文缩写，英文问句要能命中中文正文。
    for (const alias of entry.zh) add(alias, entry.weight);
    for (const alias of entry.en) add(alias, entry.weight);
  }
  return weights;
}
