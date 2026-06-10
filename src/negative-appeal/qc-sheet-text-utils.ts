/** 规格名识别与模糊匹配用归一化（飞牛文件名 / 旺店通 skuName） */

const HEADER_RE = /^(规格名称|质检报道|质检报告|工作表\d*|质检表)$/i;

/** 商品规格名（宽松，过滤表头与纯数字噪声） */
export function isLikelySpecName(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 150) return false;
  if (HEADER_RE.test(t)) return false;
  if (!/[\u4e00-\u9fa5]/.test(t)) return false;
  if (/^[\d.,/\\s#]+$/.test(t)) return false;
  if (/^[A-Z]\d+$/.test(t)) return false;
  return true;
}

export function normalizeForMatch(s: string): string {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[，,]/g, '')
    .replace(/\*[0-9.]+/g, '')
    .replace(/[x×＊][0-9.]+/gi, '')
    // 统一包装写法：有无斜杠都视为同一规格（如 鸡枞菌/瓶 与 鸡枞菌瓶）
    .replace(/瓶装/g, '瓶')
    .replace(/[\/\\]/g, '')
    .replace(/\/袋|\/盒|\/包|\/罐/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, '$1千克')
    .replace(/(\d+)\s*g\b/gi, '$1克')
    .toLowerCase();
}

/** 提取统一重量键：250克、1千克 */
export function extractWeightKey(text: string): string | null {
  const n = normalizeForMatch(text);
  const kg = n.match(/(\d+(?:\.\d+)?)千克/);
  if (kg) return `${kg[1]}千克`;
  const g = n.match(/(\d+(?:\.\d+)?)克/);
  if (g) return `${g[1]}克`;
  return null;
}

/** 匹配时忽略的通用词（品牌、产地、包装、营销词），避免「云南」等误配到无关规格 */
const MATCH_STOP_TOKENS = new Set([
  '滇同学',
  '云南',
  '森谷',
  '特产',
  '袋装',
  '袋',
  '盒',
  '包',
  '罐',
  '装',
  '克',
  '千克',
  '公斤',
  '即食',
  '下饭菜',
  '宿舍',
  '商用',
  '批发',
  '同学',
  '正宗',
  '精选',
  '手工',
  '新鲜',
  '特级',
]);

/** 品类核心词（整词优先，如菌子炒饭 / 黑糖） */
const PRODUCT_PHRASE_RE =
  /菌子炒饭|黑糖|火锅料|过桥米线|米线|年糕|菌子酱|油鸡枞|松茸|牛肝菌|鸡枞|香菇|蘑菇/g;

/** 用于规格匹配的核心 token（去掉品牌/包装噪声） */
export function extractCoreMatchTokens(text: string): string[] {
  const n = normalizeForMatch(text);
  if (!n) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  const push = (t: string): void => {
    const x = t.trim();
    if (x.length < 2 || MATCH_STOP_TOKENS.has(x)) return;
    if (/^\d+(\.\d+)?(克|千克)$/.test(x)) return;
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  for (const m of n.matchAll(PRODUCT_PHRASE_RE)) push(m[0]);

  for (const t of tokenizeForMatch(text)) push(t);

  return out;
}

/** 分词：按分隔符 + 连续中文二元组 */
export function tokenizeForMatch(text: string): string[] {
  const n = normalizeForMatch(text);
  if (!n) return [];

  const tokens = new Set<string>();
  for (const part of n.split(/[-_、,，/\\（）()【】\[\]+]+/)) {
    if (part.length >= 2) tokens.add(part);
  }
  for (let i = 0; i < n.length - 1; i++) {
    const pair = n.slice(i, i + 2);
    if (/[\u4e00-\u9fa5]{2}/.test(pair)) tokens.add(pair);
  }
  if (n.length >= 4) tokens.add(n.slice(0, Math.min(12, n.length)));
  return [...tokens];
}
