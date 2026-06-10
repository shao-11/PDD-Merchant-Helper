/**
 * 解析 latitude/message/getHistoryMessage 返回 JSON（messageList 为 JSON 字符串数组）。
 * 纯本地展示用，不涉及接口。
 */
import { formatUnixSeconds } from './time';

export type ChatHistoryRow = {
  tsLabel: string;
  roleLabel: string;
  content: string;
  /**
   * 接口顶层 userInfo.avatar（买家） / mallInfo.logo（店铺，用于客服侧气泡）。
   * 单条消息内通常不含头像，按发送方 role 选用。
   */
  avatarUrl?: string;
  /** 图片消息解析出的 URL（type=1 等），便于展示与截图 */
  imageUrl?: string;
  /** MMS 列表展示：userInfo.nickName / mallInfo.mallName（与平台聊天页一致） */
  senderDisplayName?: string;
};

/** 与聊天记录接口文档一致的来源页（校验头多在该场景生成） */
export const MMS_CHAT_SEARCH_REFERER =
  'https://mms.pinduoduo.com/mms-chat/search?msfrom=mms_sidenav';

/** 区分：有消息 / 接口成功但无消息 / 接口失败或无法识别 */
export type ChatHistoryOutcome = 'has_messages' | 'no_messages' | 'failed';

export type ChatHistoryParseResult = {
  rows: ChatHistoryRow[];
  total?: number;
  outcome: ChatHistoryOutcome;
  /** outcome === failed 时展示 */
  failureDetail?: string;
  /** outcome === no_messages 时的补充说明 */
  emptyHint?: string;
  /** 灰色状态行（一行） */
  summaryLine: string;
  /**
   * success=true + error_code=1000000 + total 为 0 或未给出：按产品约定视为「无数据」，非接口故障
   */
  treatAsNoDataSignal?: boolean;
};

type BizFields = {
  success?: unknown;
  errorCode: unknown;
  errorMsg: string;
  total?: number;
};

function collectBizFields(j: Record<string, unknown>): BizFields {
  const r =
    j.result && typeof j.result === 'object' && !Array.isArray(j.result)
      ? (j.result as Record<string, unknown>)
      : null;
  const code = j.error_code ?? j.errorCode ?? r?.error_code ?? r?.errorCode;
  const msg =
    (typeof j.errorMsg === 'string' && j.errorMsg) ||
    (typeof j.error_msg === 'string' && j.error_msg) ||
    (r && typeof r.errorMsg === 'string' && r.errorMsg) ||
    (r && typeof (r as { error_msg?: string }).error_msg === 'string' &&
      (r as { error_msg: string }).error_msg) ||
    '';
  const totalRaw = j.total ?? r?.total;
  const total = typeof totalRaw === 'number' ? totalRaw : undefined;
  const success = j.success !== undefined ? j.success : r?.success;
  return { success, errorCode: code, errorMsg: msg, total };
}

function codeLooksLikeError(code: unknown): boolean {
  if (code == null || code === '') return false;
  const n = Number(code);
  if (Number.isFinite(n)) return n !== 0;
  return true;
}

/** 服务端明确业务失败，或无法当作「无聊天记录」处理 */
function isBizFailure(f: BizFields): boolean {
  if (isNoDataSignal(f)) return false;
  if (f.success === false) return true;
  if (f.errorMsg.trim()) return true;
  if (codeLooksLikeError(f.errorCode)) return true;
  return false;
}

/** success=true + error_code=1000000 + total 为 0 或未返回 → 展示为「无数据」 */
function isNoDataSignal(biz: BizFields): boolean {
  if (String(biz.errorCode) !== '1000000') return false;
  if (biz.success !== true) return false;
  if (biz.total != null && biz.total !== 0) return false;
  return true;
}

function buildNoDataSignalSummaryLine(biz: BizFields): string {
  const tot = typeof biz.total === 'number' ? `total=${biz.total}` : 'total 未给出';
  return `结论：无数据 · ${tot} · success=true · error_code=1000000`;
}

function pickHttpUrl(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const s = c.trim();
      if (/^https?:\/\//i.test(s)) return s;
    }
  }
  return undefined;
}

/** 聊天图片 URL（与 ChatHistoryThread 展示逻辑一致） */
export function isLikelyChatImageUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/chat-img/i.test(u)) return true;
  if (/\.(?:jpe?g|png|gif|webp|bmp)(?:\?|$)/i.test(u)) return true;
  if (/(?:pddpic|yangkeduo|pinduoduoimg|funimg|commimg|savatar|avatar\d*\.pddpic)/i.test(u)) {
    return true;
  }
  return false;
}

const MSG_TYPE_IMAGE = 1;

function extractImageUrlFromMessage(m: Record<string, unknown>): string | undefined {
  const rawContent = typeof m.content === 'string' ? m.content.trim() : '';
  if (rawContent && isLikelyChatImageUrl(rawContent)) return rawContent;

  const info = m.info && typeof m.info === 'object' ? (m.info as Record<string, unknown>) : undefined;
  const fromInfo = pickHttpUrl(
    info?.url,
    info?.imageUrl,
    info?.image_url,
    info?.picUrl,
    info?.pic_url,
    info?.thumbUrl,
    info?.thumb_url,
  );
  if (fromInfo && isLikelyChatImageUrl(fromInfo)) return fromInfo;

  const type = Number(m.type);
  if (type === MSG_TYPE_IMAGE && rawContent && /^https?:\/\//i.test(rawContent)) {
    return rawContent;
  }

  if (rawContent === '[图片]' || rawContent === '图片') {
    const nested = pickHttpUrl(
      (m as { url?: string }).url,
      (m as { imageUrl?: string }).imageUrl,
      info?.goodsThumbUrl,
    );
    if (nested && isLikelyChatImageUrl(nested)) return nested;
  }

  return undefined;
}

function formatRichTemplateContent(m: Record<string, unknown>): string | undefined {
  const info = m.info && typeof m.info === 'object' ? (m.info as Record<string, unknown>) : undefined;
  if (!info) return undefined;

  const content = info.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((x) => x && typeof x === 'object' && (x as { type?: string }).type === 'text')
      .map((x) => String((x as { text?: string }).text ?? '').trim())
      .filter(Boolean);
    if (texts.length) return texts.join(' ');
  }

  for (const key of ['mall_content', 'mallContent', 'content'] as const) {
    const v = info[key];
    if (typeof v === 'string' && v.trim() && v !== '[常见问题列表]') return v.trim();
  }

  for (const key of ['item_content', 'mall_item_content'] as const) {
    const arr = info[key];
    if (!Array.isArray(arr)) continue;
    const texts = arr
      .map((x) => (x && typeof x === 'object' ? String((x as { text?: string }).text ?? '').trim() : ''))
      .filter(Boolean);
    if (texts.length) return texts.join('');
  }

  return undefined;
}

function normalizeChatContent(m: Record<string, unknown>): { content: string; imageUrl?: string } {
  const imageUrl = extractImageUrlFromMessage(m);
  const raw =
    typeof m.content === 'string' ? m.content : m.content != null ? JSON.stringify(m.content) : '';

  if (imageUrl) {
    if (raw.trim() === '[图片]' || raw.trim() === '图片') {
      return { content: raw.trim(), imageUrl };
    }
    return { content: imageUrl, imageUrl };
  }

  const rich = formatRichTemplateContent(m);
  if (rich) return { content: rich };

  return { content: raw };
}

function resolveAvatarUrl(
  role: string | undefined,
  fromObj: Record<string, unknown> | undefined,
  m: Record<string, unknown>,
  sessionMeta: ReturnType<typeof extractSessionMeta>,
): string | undefined {
  if (role === 'mall_cs') {
    return pickHttpUrl(
      fromObj?.avatar,
      fromObj?.avatarUrl,
      fromObj?.logo,
      m.logo,
      (m as { mallLogo?: string }).mallLogo,
      sessionMeta.mallLogo,
    );
  }
  if (role === 'user') {
    return pickHttpUrl(fromObj?.avatar, fromObj?.avatarUrl, fromObj?.headUrl, sessionMeta.buyerAvatar);
  }
  return undefined;
}

function resolveSenderName(
  role: string | undefined,
  fromObj: Record<string, unknown> | undefined,
  m: Record<string, unknown>,
  sessionMeta: ReturnType<typeof extractSessionMeta>,
): string | undefined {
  if (role === 'mall_cs') {
    return pickNonEmptyString(
      fromObj?.csid,
      m.csid,
      m.name,
      m.nickName,
      m.nickname,
      fromObj?.name,
      fromObj?.nickName,
      m.mallName,
      sessionMeta.mallName,
    );
  }
  if (role === 'user') {
    return pickNonEmptyString(
      m.name,
      m.nickName,
      m.nickname,
      fromObj?.name,
      fromObj?.nickName,
      sessionMeta.buyerNickName,
    );
  }
  return pickNonEmptyString(m.name, fromObj?.name);
}

function pickNonEmptyString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * 拼多多 MMS 聊天中的平台/系统卡片文案（接口常标 role=user，勿当买家发言）。
 * 与 ChatHistoryThread.classifyBubble 共用，解析阶段即纠正 roleLabel。
 */
export function isPlatformSystemChatContent(content: string): boolean {
  const t = content.trim();
  if (!t) return false;

  if (t.startsWith('[') && t.endsWith(']') && t.length <= 120) return true;

  if (/机器人未找到|智能助理|平台将|消费者反馈的订单问题|创建为工单|工单/.test(t)) return true;
  if (/暂停接待|恢复接待|催促客服|一键添加/.test(t)) return true;

  if (/^平台/.test(t)) return true;
  if (/平台(?:暂时|已帮|介入|梳理|为您|帮您)/.test(t)) return true;
  if (/消费者申请售后[，,]?\s*建议/.test(t)) return true;
  if (/建议先与消费者(?:友好)?协商/.test(t)) return true;
  if (/为消费者提供(?:售后)?方案/.test(t)) return true;
  if (/以便(?:于)?您更好地解决/.test(t)) return true;
  if (/平台客服|拼多多平台|系统消息|系统提示/.test(t)) return true;

  return false;
}

function resolveChatRoleLabel(apiRole: string | undefined, content: string): string {
  if (isPlatformSystemChatContent(content)) return '系统';
  if (apiRole === 'mall_cs') return '客服';
  if (apiRole === 'user') return '买家';
  if (apiRole === 'system' || apiRole === 'platform' || apiRole === 'robot') return '系统';
  return apiRole ? String(apiRole) : '—';
}

/** 买家或商家客服对话（供 AI 选因/写描述；不含平台系统通知） */
export function isDialogueChatRow(row: ChatHistoryRow): boolean {
  const role = (row.roleLabel ?? '').trim();
  if (!role || role === '—') return false;
  if (role === '系统' || /系统|平台/i.test(role)) return false;
  if (isPlatformSystemChatContent(row.content)) return false;
  if (role === '买家' || role === '客服') return true;
  if (/买家|消费者|^user$/i.test(role)) return true;
  if (/客服|商家|店铺|卖家|mall_cs/i.test(role)) return true;
  return false;
}

export function filterDialogueChatRows(rows: ChatHistoryRow[]): ChatHistoryRow[] {
  return rows.filter(isDialogueChatRow);
}

/** AI 用聊天摘要：仅买家/客服，默认最近 24 条 */
export function buildChatSampleForAi(rows: ChatHistoryRow[], max = 24): string[] {
  const lines = filterDialogueChatRows(rows).map((r) => `[${r.roleLabel}] ${r.content}`);
  return lines.length > max ? lines.slice(-max) : lines;
}

/** getHistoryMessage 顶层 mallInfo / userInfo（与 messageList 并列，与平台聊天页赋值逻辑一致） */
function extractSessionMeta(j: Record<string, unknown>): {
  buyerAvatar?: string;
  mallLogo?: string;
  buyerNickName?: string;
  mallName?: string;
} {
  const r =
    j.result && typeof j.result === 'object' && !Array.isArray(j.result)
      ? (j.result as Record<string, unknown>)
      : null;
  const mallRaw = (j.mallInfo ?? r?.mallInfo) as Record<string, unknown> | undefined;
  const userRaw = (j.userInfo ?? r?.userInfo) as Record<string, unknown> | undefined;
  const logo = mallRaw?.logo;
  const avatar = userRaw?.avatar;
  const mallLogo = pickHttpUrl(logo);
  const buyerAvatar = pickHttpUrl(avatar);
  const buyerNickName = pickNonEmptyString(userRaw?.nickName, userRaw?.nickname, userRaw?.nick_name);
  const mallName = pickNonEmptyString(mallRaw?.mallName, mallRaw?.mall_name, mallRaw?.name);
  return { buyerAvatar, mallLogo, buyerNickName, mallName };
}

const CHAT_CONTEXT_TIP =
  '请先在本浏览器打开并加载「客服聊天搜索」页，再回评价页重试；仍失败请在该页用订单号搜索后再试。';

export function parseChatHistoryResponse(bodyText: string): ChatHistoryParseResult {
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>;
    const biz = collectBizFields(j);

    let list: unknown[] | undefined;
    let listPresent = false;
    if (Array.isArray(j.messageList)) {
      list = j.messageList;
      listPresent = true;
    } else if (j.result && typeof j.result === 'object' && !Array.isArray(j.result)) {
      const rm = (j.result as Record<string, unknown>).messageList;
      if (Array.isArray(rm)) {
        list = rm;
        listPresent = true;
      }
    }

    if (!listPresent) {
      if (isNoDataSignal(biz)) {
        return {
          rows: [],
          total: biz.total,
          outcome: 'no_messages',
          treatAsNoDataSignal: true,
          emptyHint: '暂无聊天数据。',
          summaryLine: buildNoDataSignalSummaryLine(biz),
        };
      }
      if (isBizFailure(biz)) {
        return {
          rows: [],
          total: biz.total,
          outcome: 'failed',
          failureDetail: buildFailureDetail(biz),
          summaryLine: buildSummaryLine('failed', biz, 0),
        };
      }
      return {
        rows: [],
        total: biz.total,
        outcome: 'failed',
        failureDetail: `响应中未包含 messageList，无法区分是「无聊天记录」还是格式变更。${CHAT_CONTEXT_TIP}`,
        summaryLine: buildSummaryLine('failed', biz, 0),
      };
    }

    const rows: ChatHistoryRow[] = [];
    const sessionMeta = extractSessionMeta(j);
    for (const item of list!) {
      try {
        const m =
          typeof item === 'string'
            ? (JSON.parse(item) as Record<string, unknown>)
            : (item as Record<string, unknown>);
        const tsRaw = m.ts;
        const tsNum = typeof tsRaw === 'string' ? Number(tsRaw) : typeof tsRaw === 'number' ? tsRaw : NaN;
        const tsLabel = Number.isFinite(tsNum) ? formatUnixSeconds(tsNum) : '—';
        const fromObj =
          m.from && typeof m.from === 'object' ? (m.from as Record<string, unknown>) : undefined;
        const role = fromObj?.role != null ? String(fromObj.role) : undefined;
        const normalized = normalizeChatContent(m);
        const roleLabel = resolveChatRoleLabel(role, normalized.content);
        const isSystemRow = roleLabel === '系统';
        const avatarUrl = isSystemRow
          ? undefined
          : resolveAvatarUrl(role, fromObj, m, sessionMeta);
        const senderDisplayName = isSystemRow
          ? undefined
          : resolveSenderName(role, fromObj, m, sessionMeta);
        rows.push({
          tsLabel,
          roleLabel,
          content: normalized.content,
          avatarUrl,
          imageUrl: normalized.imageUrl,
          senderDisplayName,
        });
      } catch {
        rows.push({
          tsLabel: '—',
          roleLabel: '—',
          content: typeof item === 'string' ? item : String(item),
        });
      }
    }

    const total = typeof biz.total === 'number' ? biz.total : typeof j.total === 'number' ? j.total : undefined;

    if (rows.length > 0) {
      return {
        rows,
        total,
        outcome: 'has_messages',
        summaryLine: buildSummaryLine('has_messages', biz, rows.length),
      };
    }

    if (isNoDataSignal(biz)) {
      return {
        rows: [],
        total,
        outcome: 'no_messages',
        treatAsNoDataSignal: true,
        emptyHint: '暂无聊天数据。',
        summaryLine: buildNoDataSignalSummaryLine(biz),
      };
    }

    if (isBizFailure(biz)) {
      return {
        rows: [],
        total,
        outcome: 'failed',
        failureDetail: buildFailureDetail(biz),
        summaryLine: buildSummaryLine('failed', biz, 0),
      };
    }

    return {
      rows: [],
      total,
      outcome: 'no_messages',
      emptyHint:
        typeof total === 'number' && total === 0
          ? '接口返回列表为空且 total 为 0，通常表示该订单在最近 180 天内没有可展示的客服聊天消息（或未命中会话）。'
          : '接口返回 messageList 为空数组，通常表示未查到该订单相关聊天记录（也可能需在客服聊天页搜索该订单后重试）。',
      summaryLine: buildSummaryLine('no_messages', biz, 0),
    };
  } catch {
    return {
      rows: [],
      outcome: 'failed',
      failureDetail: '响应不是合法 JSON，无法解析。',
      summaryLine: '解析失败',
    };
  }
}

function buildFailureDetail(biz: BizFields): string {
  const parts: string[] = [];
  parts.push('接口未正常返回聊天记录（失败）。');
  if (biz.success === true && codeLooksLikeError(biz.errorCode)) {
    parts.push(
      '说明：响应里可能同时为 success=true 与非零 error_code——拼多多后台常用这种方式表示「请求已处理，但业务未通过」，不要把 success=true 理解成「有聊天记录」。'
    );
  }
  if (biz.errorMsg.trim()) parts.push(`服务端说明：${biz.errorMsg.trim()}`);
  if (codeLooksLikeError(biz.errorCode)) {
    parts.push(`错误码：${String(biz.errorCode)}`);
    if (String(biz.errorCode) === '1000000') {
      parts.push(
        '常见原因：① 未在同一浏览器先打开并加载「客服聊天搜索」页，anti-content/etag 未生成或未写入缓存；② 校验头来自其它接口、已过期或与 getHistoryMessage 不匹配；③ 子账号无客服会话权限。'
      );
    }
  }
  if (biz.success === false) parts.push('success=false');
  parts.push(CHAT_CONTEXT_TIP);
  return parts.join(' ');
}

function buildSummaryLine(
  kind: ChatHistoryOutcome,
  biz: BizFields,
  parsedCount: number
): string {
  const httpBiz =
    biz.success === true ? 'success=true' : biz.success === false ? 'success=false' : 'success 未给出';
  const code =
    biz.errorCode != null && String(biz.errorCode) !== ''
      ? `error_code=${String(biz.errorCode)}`
      : '无 error_code';
  const tot =
    typeof biz.total === 'number' ? `total=${biz.total}` : 'total 未给出';

  if (kind === 'has_messages') {
    return `结论：已加载聊天消息 · ${tot} · 本页解析 ${parsedCount} 条 · ${httpBiz} · ${code}`;
  }
  if (kind === 'no_messages') {
    return `结论：未查到记录（接口返回空列表） · ${tot} · ${httpBiz} · ${code}`;
  }
  return `结论：请求失败或无法识别列表 · ${tot} · ${httpBiz} · ${code}`;
}
