/**
 * MAIN world：报名运费改写（定稿 + 与旧版时序对齐）：
 * **主确认**：仅 **T_modal=2s 低价/页面探测**，不跑 upsert/updateV2；探测结束记 **mainGateTs**。
 * **运费改写**：仅 **`enrollV2` 发起观测**（`prevFetch` 前快照 body/headers）→ **防抖** → 在 `max(mainGateTs|modalGateTs, now+短缓冲)` 时刻跑链，使 **updateV2 与旧版「约 2s+流水线」** 同量级，避免再叠 2s 长 T_pipe。
 * **低价路径**：`confirm_enroll_shared` 记 `modalConfirmAt`、**modalGateTs=确认+T_modal**、清残留；仅接受确认后的 enroll 快照。
 * `cost_template/create` 仍仅「创建模板」按钮路径。
 */
import { buildCostTemplateCreateBody, buildCostTemplateUpdateV2Body } from './build-update-v2-body';
import {
  ACTIVITY_MSG_SOURCE,
  ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE,
  ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE_RESULT,
  ACTIVITY_MSG_TYPE_WARM_MMS_ANTI,
  COST_TEMPLATE_BATCH_SUBMIT_URL,
  COST_TEMPLATE_CREATE_URL,
  COST_TEMPLATE_GET_LIST_URL,
  ENROLL_URL_MARKER,
  INNER_MO_PROVINCE_ID,
  UPDATE_COST_TEMPLATE_V2_URL,
  UPSERT_SHIPPING_URL,
  UPSERT_SHIPPING_V4_URL,
} from './constants';
import { emitActivityDebug } from './debug-log';
import {
  extractGoodsIdsFromEnrollJson,
  goodsIdsFingerprintFromCsv,
  mergeGoodsIdsFromSources,
  parseGoodsIdsCsv,
} from './extract-goods-ids';
import { parseActivityConfirmGoodsIdsFromDom } from './parse-activity-page';

type ActivityCfg = {
  enabled: boolean;
  costTemplateId: number;
  templateName: string;
  goodsIdsCsv: string;
};

(function injectActivityAssistantEnrollHook(): void {
  try {
    const w = window as unknown as { __PDD_ACTIVITY_ASSIST_HOOK__?: boolean };
    if (w.__PDD_ACTIVITY_ASSIST_HOOK__) return;
    w.__PDD_ACTIVITY_ASSIST_HOOK__ = true;
  } catch {
    return;
  }

  let cfg: ActivityCfg = {
    enabled: true,
    costTemplateId: 0,
    templateName: '',
    goodsIdsCsv: '',
  };

  let activityMmsAntiCache = '';
  const LS_ACTIVITY_ANTI_KEY = 'pdd_activity_assist_mms_anti_v1';
  const ACTIVITY_ANTI_MAX_AGE_MS = 45 * 60 * 1000;

  function hydrateActivityAntiFromStorage(): void {
    try {
      const raw = localStorage.getItem(LS_ACTIVITY_ANTI_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as { ac?: string; ts?: number };
      if (!o.ts || Date.now() - o.ts > ACTIVITY_ANTI_MAX_AGE_MS) {
        localStorage.removeItem(LS_ACTIVITY_ANTI_KEY);
        return;
      }
      if (o.ac) activityMmsAntiCache = o.ac;
    } catch {
      /* ignore */
    }
  }

  function persistActivityAnti(): void {
    if (!activityMmsAntiCache) return;
    try {
      localStorage.setItem(
        LS_ACTIVITY_ANTI_KEY,
        JSON.stringify({ ac: activityMmsAntiCache, ts: Date.now() })
      );
    } catch {
      /* ignore */
    }
  }

  function setActivityAntiCache(ac: string): void {
    const v = ac.trim();
    if (!v) return;
    activityMmsAntiCache = v;
    persistActivityAnti();
  }

  function extractAntiFromHeaders(h: Headers): string {
    return (h.get('anti-content') || h.get('Anti-Content') || '').trim();
  }

  /** 与 dist `pdd-page-anti-hook.js` 一致：从 JSON / x-www-form-urlencoded 体取 anti 字段 */
  function pickAntiFromBody(bodyText: string): string {
    if (typeof bodyText !== 'string' || !bodyText.trim()) return '';
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          const lower = key.toLowerCase();
          if (lower === 'anti-content' || lower === 'anti_content' || lower === 'anticontent') {
            return String(parsed[key] ?? '').trim();
          }
        }
      }
    } catch {
      try {
        const params = new URLSearchParams(bodyText);
        for (const [k, v] of params.entries()) {
          const lower = k.toLowerCase();
          if (lower === 'anti-content' || lower === 'anti_content' || lower === 'anticontent') {
            return String(v ?? '').trim();
          }
        }
      } catch {
        /* ignore */
      }
    }
    return '';
  }

  function cacheAntiFromOutgoingFetch(url: string, input: RequestInfo | URL, init?: RequestInit): void {
    if (!url.includes('mms.pinduoduo.com')) return;
    try {
      if (typeof init?.body === 'string' && init.body) {
        const fromInitBody = pickAntiFromBody(init.body);
        if (fromInitBody) setActivityAntiCache(fromInitBody);
      }
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const ac = extractAntiFromHeaders(input.headers);
        if (ac) {
          setActivityAntiCache(ac);
          return;
        }
        void input
          .clone()
          .text()
          .then((txt) => {
            const fb = pickAntiFromBody(txt);
            if (fb) setActivityAntiCache(fb);
          })
          .catch(() => {
            /* ignore */
          });
        return;
      }
      if (init?.headers) {
        const ac = extractAntiFromHeaders(new Headers(init.headers as HeadersInit));
        if (ac) setActivityAntiCache(ac);
      }
    } catch {
      /* ignore */
    }
  }

  hydrateActivityAntiFromStorage();

  /**
   * dist 侧通过注入脚本在 Headers.set/append 时把 anti 推入队列；扩展内直接写入与 fetch/XHR 共用的缓存。
   */
  function installHeadersAntiContentTap(): void {
    const w = window as unknown as { __PDD_ACTIVITY_HEADERS_ANTI__?: boolean };
    if (w.__PDD_ACTIVITY_HEADERS_ANTI__) return;
    w.__PDD_ACTIVITY_HEADERS_ANTI__ = true;

    const origSet = Headers.prototype.set;
    Headers.prototype.set = function (this: Headers, name: string, value: string): void {
      try {
        if (String(name).toLowerCase() === 'anti-content') {
          const v = String(value ?? '').trim();
          if (v) setActivityAntiCache(v);
        }
      } catch {
        /* ignore */
      }
      return origSet.call(this, name, value);
    };

    const origAppend = Headers.prototype.append;
    Headers.prototype.append = function (this: Headers, name: string, value: string): void {
      try {
        if (String(name).toLowerCase() === 'anti-content') {
          const v = String(value ?? '').trim();
          if (v) setActivityAntiCache(v);
        }
      } catch {
        /* ignore */
      }
      return origAppend.call(this, name, value);
    };
  }

  installHeadersAntiContentTap();

  /** 页面 postMessage（pdd-page-anti-hook）+ 孤立世界 content 转发的 webRequest 令牌（与 Desktop dist 一致） */
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as { __dtx__?: boolean; type?: string; token?: unknown };
    if (d && d.__dtx__ === true && d.type === 'dtxAntiContent') {
      const t = typeof d.token === 'string' ? d.token.trim() : '';
      if (t) setActivityAntiCache(t);
    }
  });

  /**
   * 拼多多 MMS 大量接口仍走 XMLHttpRequest；`setRequestHeader` / `send` 体（JSON 内 anti 字段）写入与 fetch 共用的缓存。
   */
  function installXhrAntiContentCapture(): void {
    const w = window as unknown as { __PDD_ACTIVITY_ASSIST_XHR_ANTI__?: boolean };
    if (w.__PDD_ACTIVITY_ASSIST_XHR_ANTI__) return;
    w.__PDD_ACTIVITY_ASSIST_XHR_ANTI__ = true;

    const xhrOpenUrl = new WeakMap<XMLHttpRequest, string>();

    const resolveXhrUrl = (urlArg: string | URL): string => {
      try {
        const s = typeof urlArg === 'string' ? urlArg : urlArg.href;
        if (s.startsWith('http://') || s.startsWith('https://')) return s;
        if (s.startsWith('//')) return `${window.location.protocol}${s}`;
        if (s.startsWith('/')) return `${window.location.origin}${s}`;
        return new URL(s, window.location.href).href;
      } catch {
        return String(urlArg);
      }
    };

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      try {
        xhrOpenUrl.set(this, resolveXhrUrl(url));
      } catch {
        /* ignore */
      }
      (origOpen as (this: XMLHttpRequest, m: string, u: string | URL, ...r: unknown[]) => void).apply(this, [
        method,
        url,
        ...rest,
      ]);
    };

    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string): void {
      try {
        const rawUrl = xhrOpenUrl.get(this) ?? '';
        if (rawUrl.includes('mms.pinduoduo.com')) {
          const lk = String(name ?? '').toLowerCase();
          const v = String(value ?? '').trim();
          if ((lk === 'anti-content' || lk === 'anti_content') && v) {
            setActivityAntiCache(v);
          }
        }
      } catch {
        /* ignore */
      }
      origSetHeader.call(this, name, value);
    };

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
      try {
        const rawUrl = xhrOpenUrl.get(this) ?? '';
        if (rawUrl.includes('mms.pinduoduo.com') && typeof body === 'string' && body) {
          const fb = pickAntiFromBody(body);
          if (fb) setActivityAntiCache(fb);
        }
      } catch {
        /* ignore */
      }
      return origSend.apply(this, [body] as [Document | XMLHttpRequestBodyInit | null | undefined]);
    };
  }

  installXhrAntiContentCapture();

  /** 历史：以 enroll 检测为锚的短延迟（点击模式下不再使用） */
  const ENROLL_PARALLEL_DEFER_BEFORE_UPSERT_MS = 100;

  /** dist 原版 2000ms；此处仅整体提前 100ms 试跑，其余与最初版一致，降低 4301「模板锁定」概率 */
  const SUBMIT_SHARED_FOLLOWUP_DELAY_MS = 1900;
  /** dist `pdd-shipping-template-button.js`：mangosteen upsert 后再隔本毫秒数 → get_list 解析模板 → updateV2 */
  const AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS = 500;
  /** 无低价弹窗时更早打 updateV2 易 4301：首次失败后按次递增退避并换新 anti 再试 */
  const UPDATE_V2_4301_MAX_RETRIES = 3;
  const UPDATE_V2_4301_BACKOFF_BASE_MS = 4200;

  /** 与桌面 dist `pdd-shipping-template-button.js` 的 `TARGET_URL_KEY` 一致（定时器触发时用于中止判断） */
  const ACT_GOODS_PRICE_CONFIRM_PATH_KEY = 'mms.pinduoduo.com/act/goods_price/confirm';

  /** enroll 多条合并防抖（定稿 400～800ms 中取中） */
  const ENROLL_ARM_DEBOUNCE_MS = 550;
  /**
   * enroll 快照后的短缓冲（替代过长 T_pipe）。与旧版「约 2s 到 upsert」对齐主要靠 max(mainGateTs|modalGateTs, …)，本值仅作小幅落定。
   */
  const ENROLL_SNAPSHOT_BUFFER_MS = 450;
  const ENROLL_ARM_DEDUPE_MS = 12000;
  const ENROLL_SNAPSHOT_IGNORE_BEFORE_MODAL_SLACK_MS = 50;

  let mainModalProbeTimer: ReturnType<typeof setTimeout> | undefined;
  let enrollDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let enrollRunDelayTimer: ReturnType<typeof setTimeout> | undefined;
  /** 主确认低价探测结束时刻（Date.now()）；0 表示尚未完成本轮探测 */
  let mainGateTs = 0;
  /** 弹窗确认后再等 T_modal 的最早跑链时刻；0 表示未走弹窗锚点 */
  let modalGateTs = 0;
  let modalConfirmAt = 0;
  let lastEnrollArmFingerprint = '';
  let lastEnrollArmFingerprintAt = 0;
  type EnrollPipelineSnapshot = {
    baseHeaders: Record<string, string>;
    enrollBodyText: string;
    enrollSeenAt: number;
  };
  let pendingEnrollSnap: EnrollPipelineSnapshot | null = null;
  let pendingSnapWaitingMainGate: EnrollPipelineSnapshot | null = null;

  let submitPipelineRunning = false;

  const prevFetch = window.fetch.bind(window);

  function safeActivityDebug(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
    try {
      emitActivityDebug(level, message, detail);
    } catch {
      /* ignore */
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function mergedGoodsIdsFingerprint(enrollBodyText: string, csv: string, domIds: number[]): string {
    return [
      ...new Set([
        ...extractGoodsIdsFromEnrollJson(enrollBodyText),
        ...parseGoodsIdsCsv(csv),
        ...domIds.filter((n) => n > 0),
      ]),
    ]
      .sort((a, b) => a - b)
      .join(',');
  }

  function clipText(s: string, max: number): string {
    const t = s.trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…(共${t.length}字符)`;
  }

  function extractUrlString(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    return String(input);
  }

  /** 最终 Headers 是否已带 anti-content（键名大小写不敏感） */
  function headersBagHasAnti(out: Headers): boolean {
    let found = false;
    out.forEach((_v, k) => {
      if (k.toLowerCase() === 'anti-content') found = true;
    });
    return found;
  }

  function isVisibleNativeTrigger(el: HTMLElement): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    return true;
  }

  /** dist `pdd-shipping-template-button.js`：等不到签时点「刷新/查询」逼出 MMS 请求（仅当前 document） */
  function triggerNativeTokenRequest(reason: string): boolean {
    try {
      const doc = document;
      const root = doc.body;
      if (!root) return false;
      const buttons = Array.from(doc.querySelectorAll('button')).filter(
        (btn): btn is HTMLButtonElement => btn instanceof HTMLButtonElement && isVisibleNativeTrigger(btn)
      );
      const candidates: { el: HTMLButtonElement; score: number; text: string }[] = [];
      for (const btn of buttons) {
        const txt = String(btn.textContent || '').trim();
        if (!txt) continue;
        let score = 0;
        if (/刷新|查询|搜索|重新加载|筛选/.test(txt)) score += 8;
        if (/确定|提交/.test(txt)) score -= 4;
        if (btn.disabled) score -= 10;
        if (score > 0) candidates.push({ el: btn, score, text: txt });
      }
      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        candidates[0].el.click();
        emitActivityDebug('info', `已触发原生请求（${reason}）：${candidates[0].text}`);
        return true;
      }
      const input = doc.querySelector('input[placeholder*="搜索"], input[placeholder*="查询"]');
      if (input instanceof HTMLInputElement && isVisibleNativeTrigger(input)) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        emitActivityDebug('info', `已在输入框触发 Enter（${reason}）`);
        return true;
      }
    } catch {
      /* ignore */
    }
    emitActivityDebug('warn', `未找到可触发请求的原生控件（${reason}）`);
    return false;
  }

  /**
   * 等待 fetch/XHR/postMessage/LS 写入的 anti 满足 `hasAntiProbe`。
   * `nativeTrigger=true` 时对齐 dist `waitToken`：首次 + 每约 2.4s 点刷新类按钮（仅提交跟单 4301 等路径使用）。
   */
  async function waitUntilAntiAvailable(
    context: string,
    hasAntiProbe: () => boolean,
    maxWaitMs = 15000,
    intervalMs = 180,
    nativeTrigger = false,
    nativeTriggerResendMs = 2400
  ): Promise<void> {
    const t0 = Date.now();
    let warned = false;
    let lastTriggerAt = 0;
    if (nativeTrigger) {
      triggerNativeTokenRequest(`${context}-首次`);
      lastTriggerAt = Date.now();
    }
    while (Date.now() - t0 < maxWaitMs) {
      hydrateActivityAntiFromStorage();
      if (hasAntiProbe()) {
        emitActivityDebug('info', `${context} anti-content 已就绪（${Date.now() - t0}ms）`);
        return;
      }
      if (nativeTrigger && Date.now() - lastTriggerAt > nativeTriggerResendMs) {
        triggerNativeTokenRequest(`${context}-重试`);
        lastTriggerAt = Date.now();
      }
      if (!warned && Date.now() - t0 > 1800) {
        warned = true;
        emitActivityDebug(
          'warn',
          `${context} 仍未检测到 anti-content，继续等待页面 MMS 请求…（最长 ${maxWaitMs}ms；缺签易 40002）`
        );
      }
      await sleep(intervalMs);
    }
    hydrateActivityAntiFromStorage();
    if (hasAntiProbe()) return;
    throw new Error(
      '缺少 anti-content：请在本页触发一次列表/刷新（或刷新页面）后再试。未带签易被拼多多返回 error_code=40002。'
    );
  }

  function summarizePddResponse(j: unknown): Record<string, unknown> {
    if (j === null || j === undefined) return { raw: 'null' };
    if (typeof j !== 'object') return { raw: j };
    const o = j as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    if ('success' in o) summary.success = o.success;
    if ('errorCode' in o) summary.errorCode = o.errorCode;
    if ('errorMsg' in o) summary.errorMsg = o.errorMsg;
    if ('result' in o && o.result !== null && typeof o.result === 'object') {
      const r = o.result as Record<string, unknown>;
      if ('modifyResult' in r) summary['result.modifyResult'] = r.modifyResult;
      if ('failReasonByGoods' in r) summary['result.failReasonByGoods'] = r.failReasonByGoods;
      if ('successGoodsList' in r) summary['result.successGoodsList'] = r.successGoodsList;
      if ('failGoodsList' in r) summary['result.failGoodsList'] = r.failGoodsList;
      if ('update_goods_list' in r) summary['result.update_goods_list'] = r.update_goods_list;
    } else if ('result' in o) {
      summary.result = o.result;
    }
    if (Object.keys(summary).length === 0) return { keys: Object.keys(o).slice(0, 20) };
    return summary;
  }

  type BizInterpret = {
    bizOk: boolean;
    errorCode?: unknown;
    errorMsg?: unknown;
    notes: string[];
  };

  function interpretBizResponse(j: unknown): BizInterpret {
    const notes: string[] = [];
    if (j === null || typeof j !== 'object') {
      return { bizOk: false, notes: ['响应不是 JSON 对象，无法判断业务码'] };
    }
    const o = j as Record<string, unknown>;
    const success = o.success;
    const rawCode = o.errorCode ?? o.error_code;
    const errorMsg = o.errorMsg ?? o.error_msg ?? o.message ?? o.msg;

    let codeNum: number | undefined;
    if (typeof rawCode === 'number' && Number.isFinite(rawCode)) {
      codeNum = rawCode;
    } else if (typeof rawCode === 'string' && rawCode.trim() !== '') {
      const n = Number(rawCode);
      if (Number.isFinite(n)) codeNum = n;
    }
    const errorCode = codeNum !== undefined ? codeNum : rawCode;

    let bizOk = success !== false;
    if (codeNum !== undefined && codeNum !== 1000000) {
      bizOk = false;
      notes.push(`errorCode=${codeNum}（常见成功为 1000000）`);
      if (codeNum === 14038) {
        notes.push('频率限制：运费模板编辑过快，服务端通常要求冷却约 10 分钟后再调用 updateV2。');
      }
      if (codeNum === 40002) {
        notes.push('常见为创建/调用过频（非名称重复），宜退避数秒后再试。');
      }
    }

    const result = o.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if ('modifyResult' in r && r.modifyResult === false) {
        bizOk = false;
        notes.push('result.modifyResult=false');
      }
      if (r.failReasonByGoods != null && r.failReasonByGoods !== '') {
        bizOk = false;
        const fr = r.failReasonByGoods;
        notes.push(
          typeof fr === 'object'
            ? `failReasonByGoods=${JSON.stringify(fr).slice(0, 420)}`
            : `failReasonByGoods=${String(fr).slice(0, 220)}`
        );
      }
    }

    if (success === false) {
      bizOk = false;
      notes.push('success=false');
    }

    return {
      bizOk,
      errorCode,
      errorMsg,
      notes,
    };
  }

  function formatCostTemplateCreateFailure(biz: BizInterpret): string {
    const code = String(biz.errorCode ?? 'unknown');
    const em = biz.errorMsg != null && String(biz.errorMsg).trim() !== '' ? String(biz.errorMsg).trim() : '';
    if (biz.bizOk && !em) {
      return '接口判定成功但未返回可解析的模板 ID（已按需调用 get_list）；请到商家后台运费模板列表核对是否已创建';
    }
    return em ? `errorCode=${code}：${em.slice(0, 420)}` : `errorCode=${code}（无 errorMsg）`;
  }

  function bizFromResponseText(text: string): BizInterpret {
    try {
      if (text.trim().startsWith('{')) {
        return interpretBizResponse(JSON.parse(text) as unknown);
      }
    } catch {
      /* ignore */
    }
    return { bizOk: false, notes: ['响应不是合法 JSON 对象'] };
  }

  function extractCostTemplateIdFromCreateResult(j: unknown): number | null {
    const pick = (o: Record<string, unknown>): number | null => {
      const keys = ['costTemplateId', 'cost_template_id', 'templateId', 'template_id', 'id'];
      for (const k of keys) {
        const v = o[k];
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
      }
      return null;
    };
    if (j === null || typeof j !== 'object') return null;
    const o = j as Record<string, unknown>;
    const top = pick(o);
    if (top != null) return top;
    const r = o.result;
    if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
      return pick(r as Record<string, unknown>);
    }
    return null;
  }

  /** 在任意 JSON 子树中查找「模板名与 wantName 一致」的对象并取其 id（用于 create 未返回标准字段或 get_list） */
  function findCostTemplateIdByNameInJson(j: unknown, wantName: string): number | null {
    const want = wantName.trim();
    if (!want) return null;
    const seen = new Set<unknown>();

    function step(x: unknown): number | null {
      if (x === null || typeof x !== 'object') return null;
      if (seen.has(x)) return null;
      seen.add(x);
      if (Array.isArray(x)) {
        for (const it of x) {
          const r = step(it);
          if (r != null) return r;
        }
        return null;
      }
      const o = x as Record<string, unknown>;
      const nStr =
        (typeof o.costTemplateName === 'string' && o.costTemplateName) ||
        (typeof o.cost_template_name === 'string' && o.cost_template_name) ||
        (typeof o.templateName === 'string' && o.templateName) ||
        (typeof o.name === 'string' && o.name) ||
        '';
      const idRaw = o.costTemplateId ?? o.cost_template_id ?? o.templateId ?? o.template_id ?? o.id;
      const idNum = typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : NaN;
      if (
        typeof nStr === 'string' &&
        nStr.trim() !== '' &&
        nStr.trim() === want &&
        Number.isFinite(idNum) &&
        idNum > 0
      ) {
        return Math.floor(idNum);
      }
      for (const v of Object.values(o)) {
        const r = step(v);
        if (r != null) return r;
      }
      return null;
    }

    return step(j);
  }

  /** 仅在 create 业务已成功但响应里未带出 ID 时调用；避免在 40002/4003 等失败场景连打 get_list 触发频控 */
  function shouldTryCostTemplateGetListAfterCreate(biz: BizInterpret): boolean {
    return biz.bizOk === true;
  }

  async function fetchCostTemplateIdByNameFromGetList(
    apiHeaders: Headers,
    mkBracketPrefix: () => string,
    templateName: string
  ): Promise<number | null> {
    const body = { pageNo: 1, pageSize: 200, sourceKey: 'MMS' };
    const delays = [0, 420];
    for (const delayMs of delays) {
      if (delayMs > 0) await sleep(delayMs);
      try {
        const r = await prevFetch(COST_TEMPLATE_GET_LIST_URL, {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(body),
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
        const txt = await r.text().catch(() => '');
        let j: unknown;
        try {
          j = JSON.parse(txt);
        } catch {
          continue;
        }
        const listBiz = interpretBizResponse(j);
        if (!r.ok) continue;
        const id = findCostTemplateIdByNameInJson(j, templateName);
        if (id != null) {
          emitActivityDebug(
            'info',
            `${mkBracketPrefix()} cost_template/get_list 按名称「${templateName}」反查到 costTemplateId=${id}（success=${String(listBiz.bizOk)}）`
          );
          return id;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  type CostTemplateListPair = { costTemplateId: number; costTemplateName: string };

  /**
   * 报名并行链：与 dist 类似，在 upsert 后、updateV2 前用 get_list 取服务端当前模板 id/名称（优先 CONFIG id，其次名称，再按商品 ID 匹配「ID: goods」或「goodsId-时间戳」类名称）。
   */
  async function resolveCostTemplatePairFromGetList(
    apiHeaders: Headers,
    goodsIds: number[],
    panelId: number,
    panelName: string,
    mkBracketPrefix: () => string
  ): Promise<CostTemplateListPair | null> {
    const body = { pageNo: 1, pageSize: 200, sourceKey: 'MMS' };
    let j: unknown = null;
    let httpStatus = 0;
    try {
      const r = await prevFetch(COST_TEMPLATE_GET_LIST_URL, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(body),
        credentials: 'include',
        mode: 'cors',
        cache: 'no-cache',
      });
      httpStatus = r.status;
      const txt = await r.text().catch(() => '');
      if (txt.trim().startsWith('{')) {
        try {
          j = JSON.parse(txt) as unknown;
        } catch {
          j = null;
        }
      }
    } catch {
      return null;
    }
    if (j === null || typeof j !== 'object') {
      emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：响应非 JSON（HTTP ${httpStatus}）`);
      return null;
    }
    const biz = interpretBizResponse(j);
    if (!biz.bizOk) {
      emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：业务未成功`, {
        errorCode: biz.errorCode,
        errorMsg: biz.errorMsg,
        httpStatus,
      });
      return null;
    }
    const o = j as Record<string, unknown>;
    const result = o.result;
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：无 result 列表`);
      return null;
    }
    const listRaw = (result as Record<string, unknown>).list;
    if (!Array.isArray(listRaw)) {
      emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：result.list 非数组`);
      return null;
    }
    const items: CostTemplateListPair[] = [];
    for (const row of listRaw) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
      const rec = row as Record<string, unknown>;
      const idRaw = rec.costTemplateId ?? rec.cost_template_id;
      const n = typeof idRaw === 'number' ? idRaw : Number(idRaw);
      const name = String(rec.costTemplateName ?? rec.cost_template_name ?? '').trim();
      if (!Number.isFinite(n) || n <= 0 || !name) continue;
      items.push({ costTemplateId: Math.floor(n), costTemplateName: name });
    }
    if (items.length === 0) {
      emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：列表为空`);
      return null;
    }

    const nameTrim = panelName.trim();
    if (panelId > 0) {
      const byId = items.find((x) => x.costTemplateId === panelId);
      if (byId) {
        emitActivityDebug(
          'info',
          `${mkBracketPrefix()} get_list 解析：按 CONFIG costTemplateId=${panelId} 命中「${byId.costTemplateName.slice(0, 80)}」`
        );
        return { costTemplateId: byId.costTemplateId, costTemplateName: byId.costTemplateName };
      }
    }
    if (nameTrim) {
      const byName = items.find((x) => x.costTemplateName === nameTrim);
      if (byName) {
        emitActivityDebug('info', `${mkBracketPrefix()} get_list 解析：按 CONFIG 模板名称精确命中 id=${byName.costTemplateId}`);
        return { costTemplateId: byName.costTemplateId, costTemplateName: byName.costTemplateName };
      }
    }

    const gid = goodsIds.length > 0 ? goodsIds[0]! : 0;
    if (gid > 0) {
      const gidStr = String(gid);
      const re = new RegExp(`^ID: ${gidStr}(-\\d+)?$`);
      const idPrefix = `ID: ${gidStr}`;
      const tsSuffix = new RegExp(`^${gidStr}-\\d+$`);
      const matched = items.filter(
        (x) => re.test(x.costTemplateName) || x.costTemplateName.includes(idPrefix) || tsSuffix.test(x.costTemplateName)
      );
      if (matched.length > 0) {
        matched.sort((a, b) => b.costTemplateId - a.costTemplateId);
        const top = matched[0]!;
        emitActivityDebug(
          'info',
          `${mkBracketPrefix()} get_list 解析：按商品 ID=${gidStr} 名称规则命中 id=${top.costTemplateId}「${top.costTemplateName.slice(0, 80)}」`
        );
        return { costTemplateId: top.costTemplateId, costTemplateName: top.costTemplateName };
      }
    }

    emitActivityDebug('warn', `${mkBracketPrefix()} get_list 解析：未匹配到模板行（共 ${items.length} 条），将沿用 CONFIG`);
    return null;
  }

  type PipelineDiag = {
    goodsIdsFromEnrollBody: number[];
    goodsIdsFromPanelCsv: number[];
    goodsIdsForBatchSubmit: number[];
    innerMoProvinceId: number;
    effectiveCostTemplateId: number;
    effectiveTemplateName: string;
    createTemplate:
      | { ran: false; reason: string }
      | {
          ran: true;
          costTemplateId: number;
          templateName: string;
          httpStatus: number;
          biz: BizInterpret;
        };
    batchSubmit:
      | { ran: false; reason: string }
      | { ran: true; httpStatus: number; biz: BizInterpret };
    upsertAttempts: Array<{ label: string; httpStatus: number; biz: BizInterpret }>;
    updateV2: { httpStatus: number; biz: BizInterpret };
    totalPipelineMs: number;
  };

  async function headersFromFetchArgs(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        input.headers.forEach((v, k) => {
          out[k] = v;
        });
        return out;
      }
      const h = init?.headers;
      if (!h) return out;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          out[k] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) out[k] = v;
      } else {
        Object.assign(out, h as Record<string, string>);
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  function buildApiHeaders(base: Record<string, string>): Headers {
    const headers = new Headers();
    Object.entries(base).forEach(([k, v]) => {
      const lk = k.toLowerCase();
      if (lk === 'content-length') return;
      headers.set(k, v);
    });
    headers.set('content-type', 'application/json;charset=UTF-8');
    return headers;
  }

  function buildPipelineHeaders(base: Record<string, string>, logAntiSupplement = true): Headers {
    const headers = buildApiHeaders(base);
    let hasAnti = false;
    headers.forEach((_v, k) => {
      if (k.toLowerCase() === 'anti-content') hasAnti = true;
    });
    if (!hasAnti && activityMmsAntiCache) {
      headers.set('anti-content', activityMmsAntiCache);
      if (logAntiSupplement) {
        emitActivityDebug('info', '流水线请求头已补全 anti-content（来自页面近期 MMS 请求缓存）');
      }
    }
    return headers;
  }

  async function readEnrollRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
    try {
      if (typeof init?.body === 'string') return init.body;
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return await input.clone().text();
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  /** 模板名：`{goodsId}-{Date.now()}`；遇 4003 且无反查 ID 则换名重试；create 失败不调 get_list，减轻 40002 频控。 */
  async function runCostTemplateCreateFirstAvailable(
    goodsId: number,
    apiHeaders: Headers,
    mkBracketPrefix: () => string
  ): Promise<{
    costTemplateId: number;
    templateName: string;
    httpStatus: number;
    lastBiz: BizInterpret;
  }> {
    let nm = `${goodsId}-${Date.now()}`;
    const maxAttempts = 8;
    let lastCreateBiz: BizInterpret = { bizOk: false, notes: [] };
    let lastCreateStatus = 0;

    for (let ci = 0; ci < maxAttempts; ci++) {
      const p = mkBracketPrefix();
      const createPayload = buildCostTemplateCreateBody(nm);
      emitActivityDebug('info', `${p} cost_template/create ${ci + 1}/${maxAttempts} name=${nm}`);
      const cr = await prevFetch(COST_TEMPLATE_CREATE_URL, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(createPayload),
        credentials: 'include',
        mode: 'cors',
        cache: 'no-cache',
      });
      lastCreateStatus = cr.status;
      let crText = '';
      try {
        crText = await cr.clone().text();
      } catch {
        crText = '';
      }
      let crJson: unknown;
      try {
        crJson = JSON.parse(crText);
      } catch {
        crJson = null;
      }
      lastCreateBiz =
        crJson !== null && typeof crJson === 'object'
          ? interpretBizResponse(crJson)
          : bizFromResponseText(crText);
      const extracted =
        crJson !== null && typeof crJson === 'object' ? extractCostTemplateIdFromCreateResult(crJson) : null;
      let resolvedId =
        extracted ??
        (crJson !== null && typeof crJson === 'object' ? findCostTemplateIdByNameInJson(crJson, nm) : null);
      if (resolvedId == null && shouldTryCostTemplateGetListAfterCreate(lastCreateBiz)) {
        resolvedId = await fetchCostTemplateIdByNameFromGetList(apiHeaders, () => mkBracketPrefix(), nm);
      } else if (resolvedId == null && !shouldTryCostTemplateGetListAfterCreate(lastCreateBiz)) {
        emitActivityDebug(
          'info',
          `${p} create 业务未成功（errorCode=${String(lastCreateBiz.errorCode ?? 'n/a')}），跳过 cost_template/get_list，避免无效列表请求触发频控`
        );
      }

      if (cr.ok && lastCreateBiz.bizOk && resolvedId != null && resolvedId > 0) {
        return {
          costTemplateId: resolvedId,
          templateName: nm,
          httpStatus: lastCreateStatus,
          lastBiz: lastCreateBiz,
        };
      }

      if (resolvedId != null && resolvedId > 0 && cr.ok && !lastCreateBiz.bizOk) {
        emitActivityDebug('warn', `${p} create 业务未成功但已反查/解析到模板 ID=${resolvedId}，继续 batch_submit`, {
          errorCode: lastCreateBiz.errorCode,
          errorMsg: lastCreateBiz.errorMsg,
        });
        return {
          costTemplateId: resolvedId,
          templateName: nm,
          httpStatus: lastCreateStatus,
          lastBiz: {
            ...lastCreateBiz,
            bizOk: true,
            notes: [...lastCreateBiz.notes, '已根据响应或 get_list 反查 ID，视为可继续绑定'],
          },
        };
      }

      emitActivityDebug('warn', `${p} cost_template/create 未成功`, {
        name: nm,
        httpStatus: cr.status,
        bizOk: lastCreateBiz.bizOk,
        errorCode: lastCreateBiz.errorCode,
        extractedId: extracted,
        resolvedId,
        preview: crText.slice(0, 400),
      });

      if (lastCreateBiz.errorCode === 4003 && resolvedId == null) {
        emitActivityDebug(
          'warn',
          `${p} create errorCode=4003 且无反查 ID → 换新时间戳重试（疑似模板名冲突）`
        );
        nm = `${goodsId}-${Date.now()}`;
        continue;
      }

      throw new Error(formatCostTemplateCreateFailure(lastCreateBiz));
    }

    throw new Error(
      `已换名重试 ${maxAttempts} 次仍未取到模板 ID（最后一次 ${formatCostTemplateCreateFailure(lastCreateBiz)}）`
    );
  }

  async function runBeforeEnrollPipeline(
    baseHeaders: Record<string, string>,
    enrollBodyText: string,
    opts?: {
      usePanelTemplateOnly?: boolean;
      enrollParallel?: boolean;
      /** 检测到 enrollV2 的时刻（ms）；与 `parallelClickMode` 互斥 */
      parallelEnrollSince?: number;
      /** dist 点击跟单：跳过 enroll 后短延迟，并在 upsert 整段结束后插入 `afterUpsertDelayMs` */
      parallelClickMode?: boolean;
      afterUpsertDelayMs?: number;
      /** 点击跟单调试：与活动助手面板日志对齐，便于对照 Network「请求 ID 不存在」等时序 */
      pipelineTraceId?: string;
      /** DOM 商品 id，与 enroll 体、面板 CSV 合并 */
      extraGoodsIdsFromDom?: number[];
    }
  ): Promise<PipelineDiag> {
    const usePanelTemplateOnly = opts?.usePanelTemplateOnly === true;
    const enrollParallel = opts?.enrollParallel === true;
    const parallelClickMode = opts?.parallelClickMode === true;
    const parallelEnrollSince = opts?.parallelEnrollSince;
    const afterUpsertDelayMs = opts?.afterUpsertDelayMs ?? 0;
    const pipelineTraceId =
      typeof opts?.pipelineTraceId === 'string' && opts.pipelineTraceId.trim()
        ? opts.pipelineTraceId.trim()
        : `pl-${Date.now().toString(36)}`;
    const pipelineT0 = performance.now();
    const elapsed = (): number => Math.round(performance.now() - pipelineT0);

    const goodsIdsFromEnrollBody = extractGoodsIdsFromEnrollJson(enrollBodyText);
    const goodsIdsFromPanelCsv = parseGoodsIdsCsv(cfg.goodsIdsCsv);
    const extraDom = (opts?.extraGoodsIdsFromDom ?? []).filter((n) => n > 0);
    const goodsIds = [...new Set([...mergeGoodsIdsFromSources(enrollBodyText, cfg.goodsIdsCsv), ...extraDom])];

    let apiHeaders = buildPipelineHeaders(baseHeaders);
    if (!headersBagHasAnti(apiHeaders)) {
      await waitUntilAntiAvailable(
        `[+${elapsed()}ms] enroll`,
        () => headersBagHasAnti(buildPipelineHeaders(baseHeaders, false)),
        15000,
        180,
        false
      );
      apiHeaders = buildPipelineHeaders(baseHeaders);
    }
    const upsertAttempts: PipelineDiag['upsertAttempts'] = [];

    let effectiveCostTemplateId = cfg.costTemplateId;
    let effectiveTemplateName = cfg.templateName.trim();

    if (!usePanelTemplateOnly) {
      throw new Error('报名运费改写需面板已配置模板 ID 与名称（请先「创建模板」或面板填写并保存）');
    }
    if (effectiveCostTemplateId <= 0 || !effectiveTemplateName) {
      throw new Error('沿用面板模板时需要已在面板填写 costTemplateId 与 templateName');
    }
    const createDiag: PipelineDiag['createTemplate'] = {
      ran: false,
      reason: '报名侧跳过 create（新建与绑定已由「创建模板」或面板配置完成）',
    };

    emitActivityDebug('info', `[+${elapsed()}ms] 流水线`, {
      pipelineTraceId,
      goodsIds,
      usePanelTemplateOnly,
      mode: enrollParallel
        ? parallelClickMode
          ? `enrollV2 观测 + max(主探测|弹窗锚点)+${ENROLL_SNAPSHOT_BUFFER_MS}ms 缓冲 → upsert/shipping → ${AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS}ms → get_list → updateV2（对齐旧版约 2s 量级）`
          : `enroll 并行：检测后 ${ENROLL_PARALLEL_DEFER_BEFORE_UPSERT_MS}ms → upsert → get_list → updateV2（跳过 create / batch①）`
        : '面板模板 → upsert → updateV2（跳过 create / batch①）',
      effectiveCostTemplateId,
      effectiveTemplateName: effectiveTemplateName.slice(0, 48),
      panelCostTemplateId: cfg.costTemplateId,
    });

    const batchSubmitDiag: PipelineDiag['batchSubmit'] = {
      ran: false,
      reason: '报名侧跳过 batch_submit①（商品绑定已由「创建模板」完成）',
    };

    if (enrollParallel && parallelEnrollSince != null && !parallelClickMode) {
      const waitUntil = parallelEnrollSince + ENROLL_PARALLEL_DEFER_BEFORE_UPSERT_MS;
      const gapInit = Math.max(0, waitUntil - Date.now());
      if (gapInit > 0) {
        emitActivityDebug(
          'info',
          `[+${elapsed()}ms] enroll 并行：对齐至检测后 ${ENROLL_PARALLEL_DEFER_BEFORE_UPSERT_MS}ms，再 sleep ${gapInit}ms → upsert`
        );
        await sleep(gapInit);
      } else {
        emitActivityDebug(
          'info',
          `[+${elapsed()}ms] enroll 并行：已过检测后 ${ENROLL_PARALLEL_DEFER_BEFORE_UPSERT_MS}ms 锚点，立即 upsert`
        );
      }
    }

    const delayMs = enrollParallel ? 0 : 200;
    if (delayMs > 0) {
      emitActivityDebug('info', `[+${elapsed()}ms] 延时 ${delayMs}ms（串行）→ upsert / updateV2`);
      await sleep(delayMs);
    }

    const body1 = JSON.stringify({
      provinceId: INNER_MO_PROVINCE_ID,
      shippingMethod: 2,
    });
    emitActivityDebug('info', `[+${elapsed()}ms] upsert/shipping`);
    let r1 = await prevFetch(UPSERT_SHIPPING_URL, {
      method: 'POST',
      headers: apiHeaders,
      body: body1,
      credentials: 'include',
      mode: 'cors',
      cache: 'no-cache',
    });

    let r1Text = '';
    try {
      r1Text = await r1.clone().text();
    } catch {
      r1Text = '';
    }
    const shippingBiz = bizFromResponseText(r1Text);
    upsertAttempts.push({ label: 'upsert/shipping', httpStatus: r1.status, biz: shippingBiz });
    if (!r1.ok || !shippingBiz.bizOk) {
      emitActivityDebug('warn', `[+${elapsed()}ms] upsert/shipping`, {
        httpStatus: r1.status,
        bizOk: shippingBiz.bizOk,
        errorCode: shippingBiz.errorCode,
        preview: r1Text.slice(0, 400),
      });
    }

    if (!r1.ok) {
      emitActivityDebug('warn', `[+${elapsed()}ms] upsert/shipping HTTP 失败 → 尝试 upsert/v4`);
      const v4Body = JSON.stringify({
        provinceId: INNER_MO_PROVINCE_ID,
        quota: '1',
        shippingMethod: 1,
      });
      const tryV4 = (): Promise<Response> =>
        prevFetch(UPSERT_SHIPPING_V4_URL, {
          method: 'POST',
          headers: apiHeaders,
          body: v4Body,
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
      r1 = await tryV4();
      let t = '';
      try {
        t = await r1.clone().text();
      } catch {
        /* ignore */
      }
      const v4Biz1 = bizFromResponseText(t);
      upsertAttempts.push({ label: 'upsert/v4 第1次', httpStatus: r1.status, biz: v4Biz1 });
      if (!r1.ok || !v4Biz1.bizOk) {
        emitActivityDebug('warn', `[+${elapsed()}ms] upsert/v4 ①`, {
          httpStatus: r1.status,
          bizOk: v4Biz1.bizOk,
          preview: t.slice(0, 400),
        });
      }
      if (!r1.ok) {
        r1 = await tryV4();
        try {
          t = await r1.clone().text();
        } catch {
          t = '';
        }
        const v4Biz2 = bizFromResponseText(t);
        upsertAttempts.push({ label: 'upsert/v4 第2次', httpStatus: r1.status, biz: v4Biz2 });
        if (!r1.ok || !v4Biz2.bizOk) {
          emitActivityDebug('warn', `[+${elapsed()}ms] upsert/v4 ②`, {
            httpStatus: r1.status,
            bizOk: v4Biz2.bizOk,
            preview: t.slice(0, 400),
          });
        }
      }
    }

    if (enrollParallel && afterUpsertDelayMs > 0) {
      emitActivityDebug(
        'info',
        `[+${elapsed()}ms] upsert 整段结束，延时 ${afterUpsertDelayMs}ms（对齐 dist mangosteen→updateV2）→ get_list / updateV2`
      );
      await sleep(afterUpsertDelayMs);
    }

    if (enrollParallel) {
      const resolved = await resolveCostTemplatePairFromGetList(
        apiHeaders,
        goodsIds,
        cfg.costTemplateId,
        cfg.templateName,
        () => `[+${elapsed()}ms]`
      );
      if (resolved) {
        effectiveCostTemplateId = resolved.costTemplateId;
        effectiveTemplateName = resolved.costTemplateName;
      }
    }

    const primaryTemplateName = effectiveTemplateName;
    const fallbackTemplateName =
      goodsIds.length > 0 ? `${goodsIds[0]}-2` : `${primaryTemplateName}-2`;
    const updateNameAttempts =
      primaryTemplateName === fallbackTemplateName
        ? [primaryTemplateName]
        : [primaryTemplateName, fallbackTemplateName];

    let r2: Response | undefined;
    let preview: unknown = null;
    let updateBiz: BizInterpret = { bizOk: false, notes: ['updateV2 未执行'] };

    for (let ti = 0; ti < updateNameAttempts.length; ti++) {
      const nm = updateNameAttempts[ti];
      const updatePayload = buildCostTemplateUpdateV2Body(effectiveCostTemplateId, nm);

      for (let r4301 = 0; r4301 <= UPDATE_V2_4301_MAX_RETRIES; r4301++) {
        emitActivityDebug(
          'info',
          `[+${elapsed()}ms] updateV2 ${ti + 1}/${updateNameAttempts.length} name=${nm}${
            r4301 > 0 ? `（4301 退避重试 ${r4301}/${UPDATE_V2_4301_MAX_RETRIES}）` : ''
          }`
        );
        const updateV2T0 = performance.now();
        emitActivityDebug('info', `[+${elapsed()}ms] updateV2 即将发起 fetch`, {
          pipelineTraceId,
          name: nm,
          attempt: `${ti + 1}/${updateNameAttempts.length}`,
          r4301,
          visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
          hidden: typeof document !== 'undefined' ? document.hidden : null,
          href: typeof location !== 'undefined' ? String(location.href).slice(0, 240) : '',
          templateId: effectiveCostTemplateId,
        });
        r2 = await prevFetch(UPDATE_COST_TEMPLATE_V2_URL, {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(updatePayload),
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
        const updateV2RoundMs = Math.round(performance.now() - updateV2T0);
        let ct = '';
        try {
          ct = r2.headers.get('content-type') ?? '';
        } catch {
          ct = '';
        }
        emitActivityDebug('info', `[+${elapsed()}ms] updateV2 fetch 已返回（面板可看；Network 偶发「请求 ID 不存在」多为 SPA/切帧导致 DevTools 丢引用，不代表未发出）`, {
          pipelineTraceId,
          httpStatus: r2.status,
          ok: r2.ok,
          type: r2.type,
          contentType: ct.slice(0, 80),
          roundTripMs: updateV2RoundMs,
          visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
        });
        if (!r2.ok) {
          const errText = await r2.text().catch(() => '');
          emitActivityDebug('error', `updateV2 失败 HTTP ${r2.status}`, errText.slice(0, 1200));
          throw new Error(`updateV2 ${r2.status}`);
        }

        try {
          preview = await r2.clone().json();
        } catch {
          preview = null;
        }
        updateBiz = interpretBizResponse(preview);
        if (!updateBiz.bizOk) {
          emitActivityDebug('warn', `[+${elapsed()}ms] updateV2 失败`, {
            pipelineTraceId,
            name: nm,
            errorCode: updateBiz.errorCode,
            errorMsg: updateBiz.errorMsg,
            r4301,
          });
        }

        if (updateBiz.bizOk) {
          emitActivityDebug('info', `[+${elapsed()}ms] updateV2 ✓ ${nm}`, { pipelineTraceId, roundTripMs: updateV2RoundMs });
          break;
        }

        const is4301 =
          enrollParallel &&
          updateBiz.errorCode === 4301 &&
          r4301 < UPDATE_V2_4301_MAX_RETRIES;
        if (is4301) {
          const backoffMs = UPDATE_V2_4301_BACKOFF_BASE_MS + r4301 * 1200;
          emitActivityDebug('warn', `[+${elapsed()}ms] updateV2 errorCode=4301 模板锁定，${backoffMs}ms 后换新 anti 重试`, {
            pipelineTraceId,
            templateId: effectiveCostTemplateId,
          });
          await sleep(backoffMs);
          activityMmsAntiCache = '';
          try {
            localStorage.removeItem(LS_ACTIVITY_ANTI_KEY);
          } catch {
            /* ignore */
          }
          await waitUntilAntiAvailable(
            `[+${elapsed()}ms] updateV2-4301`,
            () => headersBagHasAnti(buildPipelineHeaders(baseHeaders, false)),
            12000,
            180,
            parallelClickMode === true
          );
          apiHeaders = buildPipelineHeaders(baseHeaders);
          continue;
        }

        const retry4003 =
          updateBiz.errorCode === 4003 &&
          ti === 0 &&
          updateNameAttempts.length > 1 &&
          primaryTemplateName !== fallbackTemplateName;
        if (retry4003) {
          emitActivityDebug('warn', `[+${elapsed()}ms] updateV2 4003 名称冲突 → 重试 name=${fallbackTemplateName}`);
          break;
        }
        break;
      }

      if (updateBiz.bizOk) {
        break;
      }

      if (
        updateBiz.errorCode === 4003 &&
        ti === 0 &&
        updateNameAttempts.length > 1 &&
        primaryTemplateName !== fallbackTemplateName
      ) {
        continue;
      }
      break;
    }

    if (!r2) {
      throw new Error('updateV2 未发起');
    }

    if (!updateBiz.bizOk) {
      const detailMsg =
        typeof updateBiz.errorMsg === 'string' && updateBiz.errorMsg.trim().length > 0
          ? updateBiz.errorMsg.trim()
          : '运费模板未保存成功';
      emitActivityDebug(
        enrollParallel ? 'warn' : 'error',
        `[+${elapsed()}ms] ${enrollParallel ? '并行：报名未拦截，' : '拦截 enroll：'}updateV2 未保存（${updateBiz.errorCode === 14038 ? '频控约10分钟后再试' : '见 errorMsg'}）`,
        { errorCode: updateBiz.errorCode, errorMsg: updateBiz.errorMsg }
      );
      throw new Error(
        `updateV2 未保存：${detailMsg}（errorCode=${String(updateBiz.errorCode ?? 'unknown')}）`
      );
    }

    emitActivityDebug('info', `[+${elapsed()}ms] 流水线挂点摘要`, {
      effectiveCostTemplateId,
      effectiveTemplateName,
      goodsIds,
      panelCostTemplateId: cfg.costTemplateId,
    });

    const diag: PipelineDiag = {
      goodsIdsFromEnrollBody,
      goodsIdsFromPanelCsv,
      goodsIdsForBatchSubmit: goodsIds,
      innerMoProvinceId: INNER_MO_PROVINCE_ID,
      effectiveCostTemplateId,
      effectiveTemplateName,
      createTemplate: createDiag,
      batchSubmit: batchSubmitDiag,
      upsertAttempts,
      updateV2: { httpStatus: r2.status, biz: updateBiz },
      totalPipelineMs: elapsed(),
    };

    return diag;
  }

  /** 浮动按钮「创建模板」：同 frame 单路；create 前短轮询抢签；batch 先复用当前头（秒开），仅 40002/频控等再换新签重试一次。 */
  let prepareTemplateBusy = false;

  async function runPrepareTemplateFromCsv(csv: string): Promise<void> {
    const t0 = Date.now();
    const elapsed = (): string => String(Date.now() - t0);

    const postResult = (payload: {
      ok: boolean;
      error?: string;
      templateId?: number;
      templateName?: string;
      goodsFingerprint?: string;
    }): void => {
      try {
        window.postMessage(
          {
            source: ACTIVITY_MSG_SOURCE,
            type: ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE_RESULT,
            ...payload,
          },
          '*'
        );
      } catch {
        /* ignore */
      }
    };

    if (prepareTemplateBusy) {
      postResult({ ok: false, error: '创建模板进行中，请勿重复点击' });
      return;
    }
    prepareTemplateBusy = true;

    try {
      const goodsIds = parseGoodsIdsCsv(csv);
      if (goodsIds.length === 0) {
        postResult({ ok: false, error: '未解析到有效商品 ID' });
        return;
      }

      /** 与「分析按钮」同源：先极短轮询 hydrate/webRequest 刚写入的签，再进入长等 */
      async function microSpinAntiReady(maxMs: number, stepMs: number): Promise<boolean> {
        const t0 = Date.now();
        while (Date.now() - t0 < maxMs) {
          hydrateActivityAntiFromStorage();
          if (activityMmsAntiCache.trim()) return true;
          await sleep(stepMs);
        }
        return activityMmsAntiCache.trim().length > 0;
      }

      hydrateActivityAntiFromStorage();
      if (!(await microSpinAntiReady(500, 24))) {
        await waitUntilAntiAvailable(
          `[PREPARE_TEMPLATE +${elapsed()}ms] create`,
          () => {
            hydrateActivityAntiFromStorage();
            return activityMmsAntiCache.trim().length > 0;
          },
          15000,
          180,
          true
        );
      }
      let apiHeaders = buildPipelineHeaders({});

      const gid = goodsIds[0]!;

      let effectiveCostTemplateId = 0;
      let effectiveTemplateName = '';
      try {
        const created = await runCostTemplateCreateFirstAvailable(gid, apiHeaders, () => `[PREPARE_TEMPLATE +${elapsed()}ms]`);
        effectiveCostTemplateId = created.costTemplateId;
        effectiveTemplateName = created.templateName;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        postResult({
          ok: false,
          error: msg,
        });
        return;
      }

      if (effectiveCostTemplateId <= 0 || !effectiveTemplateName) {
        postResult({ ok: false, error: 'cost_template/create 未返回有效模板 ID' });
        return;
      }

      /** 秒开：batch 先复用当前签（create 过程中 hook/webRequest 常已写入新签），不再先清空再等；仅疑似缺签时再换新 */
      const batchBody = JSON.stringify({
        update_goods_list: goodsIds.map((goods_id) => ({ goods_id, weight: null })),
        cost_template_id: effectiveCostTemplateId,
      });
      emitActivityDebug('info', `[PREPARE_TEMPLATE +${elapsed()}ms] batch_submit①（先试当前缓存头）`, {
        cost_template_id: effectiveCostTemplateId,
        goodsIds,
        requestPreview: clipText(batchBody, 720),
      });

      const looksLikeAntiOrRate = (biz: BizInterpret, httpOk: boolean, status: number): boolean => {
        if (!httpOk && (status === 403 || status === 429)) return true;
        if (biz.errorCode === 40002) return true;
        const em = String(biz.errorMsg ?? '').toLowerCase();
        if (em.includes('频繁') || em.includes('太过频繁')) return true;
        return false;
      };

      const runBatchOnce = async (h: Headers): Promise<{ rb: Response; rbText: string; batchBiz: BizInterpret }> => {
        const rb = await prevFetch(COST_TEMPLATE_BATCH_SUBMIT_URL, {
          method: 'POST',
          headers: h,
          body: batchBody,
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache',
        });
        let rbText = '';
        try {
          rbText = await rb.clone().text();
        } catch {
          rbText = '';
        }
        let rbJson: unknown;
        try {
          rbJson = JSON.parse(rbText);
        } catch {
          rbJson = null;
        }
        const batchBiz =
          typeof rbJson === 'object' && rbJson !== null ? interpretBizResponse(rbJson) : bizFromResponseText(rbText);
        return { rb, rbText, batchBiz };
      };

      let batchHeaders = buildPipelineHeaders({});
      let { rb, rbText, batchBiz } = await runBatchOnce(batchHeaders);

      if (!(rb.ok && batchBiz.bizOk) && looksLikeAntiOrRate(batchBiz, rb.ok, rb.status)) {
        emitActivityDebug('info', `[PREPARE_TEMPLATE +${elapsed()}ms] batch 疑似缺签/频控 → 清签换新 anti 后重试一次`);
        activityMmsAntiCache = '';
        try {
          localStorage.removeItem(LS_ACTIVITY_ANTI_KEY);
        } catch {
          /* ignore */
        }
        if (!(await microSpinAntiReady(400, 20))) {
          await waitUntilAntiAvailable(
            `[PREPARE_TEMPLATE +${elapsed()}ms] batch`,
            () => {
              hydrateActivityAntiFromStorage();
              return activityMmsAntiCache.trim().length > 0;
            },
            15000,
            180,
            true
          );
        }
        batchHeaders = buildPipelineHeaders({});
        ({ rb, rbText, batchBiz } = await runBatchOnce(batchHeaders));
      }

      if (!rb.ok) {
        postResult({ ok: false, error: `batch_submit HTTP ${rb.status}：${rbText.slice(0, 240)}` });
        return;
      }
      if (!batchBiz.bizOk) {
        postResult({
          ok: false,
          error: `batch_submit 业务未成功：${String(batchBiz.errorMsg ?? (batchBiz.notes.join('；') || 'unknown'))}`,
        });
        return;
      }

      const gfp = goodsIdsFingerprintFromCsv(csv);
      emitActivityDebug('info', `[PREPARE_TEMPLATE +${elapsed()}ms] 完成`, {
        templateId: effectiveCostTemplateId,
        templateName: effectiveTemplateName,
        goodsFingerprint: gfp,
      });
      /** dist `persistShipTemplateForGoods`：后续跟单 `resolveCostTemplatePair` 优先读此 key */
      try {
        const firstGid = String(goodsIds[0] ?? '').replace(/\D/g, '');
        if (firstGid) {
          sessionStorage.setItem(
            `dtx_pdd_ship_tpl_${firstGid}`,
            JSON.stringify({
              costTemplateId: effectiveCostTemplateId,
              costTemplateName: effectiveTemplateName,
            })
          );
        }
      } catch {
        /* ignore */
      }
      postResult({
        ok: true,
        templateId: effectiveCostTemplateId,
        templateName: effectiveTemplateName,
        goodsFingerprint: gfp,
      });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emitActivityDebug('error', `[PREPARE_TEMPLATE +${elapsed()}ms] 异常`, msg);
        postResult({ ok: false, error: msg });
      } finally {
        prepareTemplateBusy = false;
      }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    /** isolated world ↔ MAIN 互发 postMessage 时，ev.source 常与当前 window 引用不等；用同源校验即可 */
    if (e.origin !== window.location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      goodsIdsCsvForPrepare?: string;
    };
    if (d?.source !== ACTIVITY_MSG_SOURCE || d.type !== ACTIVITY_MSG_TYPE_PREPARE_TEMPLATE) return;
    const csv = typeof d.goodsIdsCsvForPrepare === 'string' ? d.goodsIdsCsvForPrepare : '';
    emitActivityDebug('info', 'MAIN 收到 PREPARE_TEMPLATE', {
      csvLen: csv.length,
      csvPreview: csv.slice(0, 160),
      frame: window.self === window.top ? 'top' : 'iframe',
    });
    void runPrepareTemplateFromCsv(csv);
  });

  let lastWarmMmsAntiTriggerAt = 0;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as { source?: string; type?: string };
    if (d?.source !== ACTIVITY_MSG_SOURCE || d.type !== ACTIVITY_MSG_TYPE_WARM_MMS_ANTI) return;
    hydrateActivityAntiFromStorage();
    if (activityMmsAntiCache.trim()) {
      return;
    }
    const now = Date.now();
    if (now - lastWarmMmsAntiTriggerAt < 2200) return;
    lastWarmMmsAntiTriggerAt = now;
    triggerNativeTokenRequest('活动页 anti 预热');
  });

  window.addEventListener('message', (e: MessageEvent) => {
    /** isolated world ↔ MAIN 互发 postMessage 时，ev.source 常与当前 window 引用不等；用同源校验即可 */
    if (e.origin !== window.location.origin) return;
    const d = e.data as {
      source?: string;
      type?: string;
      enabled?: boolean;
      costTemplateId?: number;
      templateName?: string;
      goodsIdsCsv?: string;
    };
    if (d?.source !== ACTIVITY_MSG_SOURCE || d.type !== 'CONFIG') return;
    cfg = {
      enabled: d.enabled !== false,
      costTemplateId: Math.floor(Number(d.costTemplateId)) || 0,
      templateName: typeof d.templateName === 'string' ? d.templateName : '',
      goodsIdsCsv: typeof d.goodsIdsCsv === 'string' ? d.goodsIdsCsv : '',
    };
    emitActivityDebug('info', 'CONFIG 已更新（来自扩展存储）', {
      enabled: cfg.enabled,
      costTemplateId: cfg.costTemplateId,
      hasTemplateName: cfg.templateName.trim().length > 0,
      goodsIdsCsvLen: cfg.goodsIdsCsv.trim().length,
    });
  });

  type EnrollOutcome = {
    bizOk: boolean;
    topErrorCode?: unknown;
    topErrorMsg?: unknown;
    enrollFailed: Array<{ goods_id?: unknown; error_code?: unknown; error_msg?: unknown }>;
    enrollSuccessCount: number;
    notes: string[];
  };

  function interpretEnrollV2Response(j: unknown): EnrollOutcome {
    const notes: string[] = [];
    const enrollFailed: EnrollOutcome['enrollFailed'] = [];
    if (j === null || typeof j !== 'object') {
      return { bizOk: false, enrollFailed: [], enrollSuccessCount: 0, notes: ['响应不是 JSON 对象'] };
    }
    const o = j as Record<string, unknown>;
    const topErrorCode = o.error_code ?? o.errorCode;
    const topErrorMsg = o.error_msg ?? o.errorMsg;
    let bizOk = o.success !== false;
    if (typeof topErrorCode === 'number' && topErrorCode !== 1000000) {
      bizOk = false;
      notes.push(`顶层 error_code=${topErrorCode}`);
    }

    const result = o.result;
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      const fl = r.enroll_fail_goods_list;
      if (Array.isArray(fl)) {
        for (const it of fl) {
          if (it && typeof it === 'object') {
            const x = it as Record<string, unknown>;
            enrollFailed.push({
              goods_id: x.goods_id ?? x.goodsId,
              error_code: x.error_code ?? x.errorCode,
              error_msg: x.error_msg ?? x.errorMsg,
            });
          }
        }
      }
      if (enrollFailed.length > 0) {
        bizOk = false;
        notes.push(`活动侧驳回 ${enrollFailed.length} 个商品（见下方 enrollFailed）`);
      }
      const sl = r.enroll_success_goods_list;
      const enrollSuccessCount = Array.isArray(sl) ? sl.length : 0;
      return {
        bizOk,
        topErrorCode,
        topErrorMsg,
        enrollFailed,
        enrollSuccessCount,
        notes,
      };
    }

    return {
      bizOk,
      topErrorCode,
      topErrorMsg,
      enrollFailed: [],
      enrollSuccessCount: 0,
      notes,
    };
  }

  /** dist `isTargetPage()`：仍在活动价确认页才继续跟单 */
  function isActivityGoodsPriceConfirmPage(): boolean {
    try {
      return String(location.href || '').includes(ACT_GOODS_PRICE_CONFIRM_PATH_KEY);
    } catch {
      return false;
    }
  }

  /** dist：低价风险预警弹窗（`confirm_enroll_shared` 可见或 modal 内文案） */
  function isLowPriceRiskModalPresent(): boolean {
    const btn = document.querySelector('button[data-tracking-click-viewid="confirm_enroll_shared"]');
    if (btn instanceof HTMLElement && isVisibleNativeTrigger(btn)) return true;
    const inner = document.querySelector('[data-testid="beast-core-modal-inner"]');
    if (!(inner instanceof HTMLElement) || !isVisibleNativeTrigger(inner)) return false;
    return String(inner.textContent || '').includes('低价风险预警');
  }

  function clearEnrollArmChain(reason: string): void {
    try {
      if (enrollDebounceTimer) {
        clearTimeout(enrollDebounceTimer);
        enrollDebounceTimer = undefined;
      }
      if (enrollRunDelayTimer) {
        clearTimeout(enrollRunDelayTimer);
        enrollRunDelayTimer = undefined;
      }
      pendingEnrollSnap = null;
      pendingSnapWaitingMainGate = null;
      lastEnrollArmFingerprint = '';
      lastEnrollArmFingerprintAt = 0;
      safeActivityDebug('info', `[enroll arm] 已清除防抖/延时与去重（${reason}）`);
    } catch (e) {
      safeActivityDebug('warn', '[enroll arm] 清除异常（已吞掉）', e instanceof Error ? e.message : String(e));
    }
  }

  function flushMainGateAndPending(): void {
    mainGateTs = Date.now();
    if (pendingSnapWaitingMainGate) {
      const s = pendingSnapWaitingMainGate;
      pendingSnapWaitingMainGate = null;
      scheduleEnrollPipelineAfterGates(s);
    }
  }

  /** 与旧版「约 T_modal 后进 upsert」对齐：取 max(主探测结束 | 弹窗锚点, now+短缓冲) */
  function scheduleEnrollPipelineAfterGates(snap: EnrollPipelineSnapshot): void {
    try {
      if (enrollRunDelayTimer) {
        clearTimeout(enrollRunDelayTimer);
        enrollRunDelayTimer = undefined;
      }
      const notBeforeTs = modalGateTs > 0 ? modalGateTs : mainGateTs;
      if (notBeforeTs <= 0) {
        pendingSnapWaitingMainGate = snap;
        safeActivityDebug('info', '[enroll arm] 已缓存快照，等待主确认低价探测结束（mainGateTs）', {
          enrollSeenAt: snap.enrollSeenAt,
        });
        return;
      }
      const runTs = Math.max(Date.now() + ENROLL_SNAPSHOT_BUFFER_MS, notBeforeTs);
      const delay = Math.max(0, runTs - Date.now());
      safeActivityDebug('info', `[enroll arm] ${delay}ms 后跑运费链`, {
        notBeforeTs,
        modalGateTs: modalGateTs || undefined,
        mainGateTs: mainGateTs || undefined,
        bufferMs: ENROLL_SNAPSHOT_BUFFER_MS,
      });
      enrollRunDelayTimer = window.setTimeout(() => {
        enrollRunDelayTimer = undefined;
        void runEnrollShippingPipeline(snap);
      }, delay);
    } catch (e) {
      safeActivityDebug('warn', '[enroll arm] schedule 异常（已吞掉）', e instanceof Error ? e.message : String(e));
    }
  }

  async function runMainModalProbe(reason: string): Promise<void> {
    try {
      if (!cfg.enabled || cfg.costTemplateId <= 0 || !cfg.templateName.trim()) {
        safeActivityDebug('info', '[低价探测] 跳过：活动助手未启用或未配置模板');
        flushMainGateAndPending();
        return;
      }
      const onConfirmPage = isActivityGoodsPriceConfirmPage();
      const lowPriceModal = isLowPriceRiskModalPresent();
      safeActivityDebug('info', `[低价探测] T_modal 到点（${reason}）`, {
        stillOnActivityConfirmPage: onConfirmPage,
        lowPriceRiskModal: lowPriceModal,
        href: String(location.href).slice(0, 240),
      });
      if (!onConfirmPage) {
        safeActivityDebug('warn', '[低价探测] 已离开活动价确认页');
      } else if (lowPriceModal) {
        safeActivityDebug(
          'warn',
          '[低价探测] 检测到低价风险弹窗：不在此跑运费链；请在弹窗内确认报名；改写仅在后续 enrollV2 后触发'
        );
      } else {
        safeActivityDebug(
          'info',
          '[低价探测] 未检测到低价弹窗；改写仅在 enrollV2 观测后触发（时刻与旧版对齐：max(T_modal 结束, enroll 防抖)+短缓冲）'
        );
      }
    } catch (e) {
      safeActivityDebug('warn', '[低价探测] 异常（已吞掉）', e instanceof Error ? e.message : String(e));
    } finally {
      flushMainGateAndPending();
    }
  }

  function armEnrollPipelineDebounced(snap: EnrollPipelineSnapshot): void {
    try {
      if (enrollRunDelayTimer) {
        clearTimeout(enrollRunDelayTimer);
        enrollRunDelayTimer = undefined;
        safeActivityDebug('info', '[enroll arm] 取消尚未执行的跑链定时器（新 enroll 观测）');
      }
      pendingEnrollSnap = snap;
      if (enrollDebounceTimer) clearTimeout(enrollDebounceTimer);
      enrollDebounceTimer = window.setTimeout(() => {
        enrollDebounceTimer = undefined;
        const toRun = pendingEnrollSnap;
        pendingEnrollSnap = null;
        if (!toRun) return;
        const domIds = parseActivityConfirmGoodsIdsFromDom();
        const fp = mergedGoodsIdsFingerprint(toRun.enrollBodyText, cfg.goodsIdsCsv, domIds);
        const now = Date.now();
        if (
          fp &&
          fp === lastEnrollArmFingerprint &&
          now - lastEnrollArmFingerprintAt < ENROLL_ARM_DEDUPE_MS
        ) {
          safeActivityDebug('info', `[enroll arm] 跳过：${now - lastEnrollArmFingerprintAt}ms 内同指纹`, { fp });
          return;
        }
        lastEnrollArmFingerprint = fp;
        lastEnrollArmFingerprintAt = now;
        scheduleEnrollPipelineAfterGates(toRun);
      }, ENROLL_ARM_DEBOUNCE_MS);
    } catch (e) {
      safeActivityDebug('warn', '[enroll arm] debounce 异常（已吞掉）', e instanceof Error ? e.message : String(e));
    }
  }

  async function runEnrollShippingPipeline(snap: EnrollPipelineSnapshot): Promise<void> {
    if (submitPipelineRunning) {
      safeActivityDebug('warn', '[enroll 运费改写] 跳过：submitPipelineRunning');
      return;
    }
    if (!cfg.enabled || cfg.costTemplateId <= 0 || !cfg.templateName.trim()) {
      safeActivityDebug('info', '[enroll 运费改写] 跳过：未配置模板');
      return;
    }
    if (!isActivityGoodsPriceConfirmPage()) {
      safeActivityDebug('warn', '[enroll 运费改写] 已离开活动价确认页');
      return;
    }
    if (isLowPriceRiskModalPresent()) {
      safeActivityDebug('warn', '[enroll 运费改写] 低价弹窗仍展示，放弃（双保险）');
      return;
    }
    const domGoodsIds = parseActivityConfirmGoodsIdsFromDom();
    submitPipelineRunning = true;
    const pipelineTraceId = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      safeActivityDebug('info', '[enroll 运费改写] 开始', {
        pipelineTraceId,
        enrollSeenAt: snap.enrollSeenAt,
        domGoodsIds,
      });
      await runBeforeEnrollPipeline(snap.baseHeaders, snap.enrollBodyText, {
        usePanelTemplateOnly: true,
        enrollParallel: true,
        parallelClickMode: true,
        afterUpsertDelayMs: AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS,
        pipelineTraceId,
        extraGoodsIdsFromDom: domGoodsIds,
      });
      safeActivityDebug('info', '[enroll 运费改写] 已结束', { pipelineTraceId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      safeActivityDebug('warn', `[enroll 运费改写] 失败：${msg}`);
    } finally {
      submitPipelineRunning = false;
    }
  }

  function scheduleSubmitSharedFollowup(reason: string): void {
    modalGateTs = 0;
    mainGateTs = 0;
    modalConfirmAt = 0;
    if (!cfg.enabled || cfg.costTemplateId <= 0 || !cfg.templateName.trim()) {
      emitActivityDebug('info', `[提交跟单] 未启 T_modal：面板未配置模板（${reason}）`);
      return;
    }
    if (mainModalProbeTimer) {
      clearTimeout(mainModalProbeTimer);
      mainModalProbeTimer = undefined;
    }
    clearEnrollArmChain('主确认重置');
    emitActivityDebug(
      'info',
      `[提交跟单] 主「确认提交」（${reason}）：${SUBMIT_SHARED_FOLLOWUP_DELAY_MS}ms 仅低价/页面探测；运费改写跟进 enrollV2；updateV2 时刻与旧版对齐（max(T_modal 结束, enroll 防抖)+${ENROLL_SNAPSHOT_BUFFER_MS}ms）`
    );
    mainModalProbeTimer = window.setTimeout(() => {
      mainModalProbeTimer = undefined;
      void runMainModalProbe(reason);
    }, SUBMIT_SHARED_FOLLOWUP_DELAY_MS);
  }

  function onDocumentClickCaptureForSubmit(e: MouseEvent): void {
    if (!cfg.enabled) return;
    const t = e.target;
    if (!(t instanceof Element)) return;

    if (t.closest('button[data-tracking-click-viewid="confirm_enroll_shared"]')) {
      modalConfirmAt = Date.now();
      modalGateTs = modalConfirmAt + SUBMIT_SHARED_FOLLOWUP_DELAY_MS;
      mainGateTs = 0;
      if (mainModalProbeTimer) {
        clearTimeout(mainModalProbeTimer);
        mainModalProbeTimer = undefined;
      }
      clearEnrollArmChain('弹窗内确认报名');
      emitActivityDebug('info', '[提交跟单] confirm_enroll_shared：已记 modalConfirmAt 与弹窗锚点；不启旧版 2s 全链定时器；等 enrollV2', {
        modalConfirmAt,
        modalGateTs,
      });
      return;
    }

    if (t.closest('button[data-tracking-click-viewid="submit_shared"]')) {
      emitActivityDebug('info', '[提交跟单] 点击链路：submit_shared（主确认提交）');
      scheduleSubmitSharedFollowup('submit_shared');
      return;
    }

    const actBtn = t.closest('button[data-testid="beast-core-button"]');
    if (actBtn instanceof HTMLButtonElement && /提交活动/.test(String(actBtn.textContent || '').trim())) {
      emitActivityDebug('info', '[提交跟单] 点击链路：按钮文案「提交活动」');
      scheduleSubmitSharedFollowup('提交活动');
    }
  }

  window.fetch = async function fetchPatched(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = extractUrlString(input);
    cacheAntiFromOutgoingFetch(url, input, init);
    const isEnroll = url.includes(ENROLL_URL_MARKER);
    const enrollSeenAt = isEnroll ? Date.now() : 0;
    let enrollBodyText = '';
    if (isEnroll && cfg.enabled) {
      enrollBodyText = await readEnrollRequestBody(input, init);
    }
    const mergedForGate = mergeGoodsIdsFromSources(enrollBodyText, cfg.goodsIdsCsv);
    const needsPipeline =
      isEnroll &&
      cfg.enabled &&
      cfg.costTemplateId > 0 &&
      cfg.templateName.trim().length > 0;

    let enrollHeaderSnapshot: Record<string, string> | undefined;
    if (needsPipeline) {
      enrollHeaderSnapshot = await headersFromFetchArgs(input, init);
    }

    if (isEnroll && !needsPipeline) {
      emitActivityDebug('warn', 'enrollV2：未跑运费改写（请开启活动助手；并先用「创建模板」或在面板填写「模板 ID + 名称」并保存）', {
        costTemplateId: cfg.costTemplateId,
        nameLen: cfg.templateName.trim().length,
        mergedGoodsIds: mergedForGate.length,
      });
    }

    if (needsPipeline && enrollHeaderSnapshot) {
      if (modalConfirmAt > 0 && enrollSeenAt < modalConfirmAt - ENROLL_SNAPSHOT_IGNORE_BEFORE_MODAL_SLACK_MS) {
        safeActivityDebug('info', '[enroll arm] 跳过：enroll 进入 fetch 早于弹窗确认（陈旧）', {
          enrollSeenAt,
          modalConfirmAt,
        });
      } else {
        safeActivityDebug('info', '[enroll arm] enrollV2 发起观测 → 防抖', {
          enrollSeenAt,
          bodyLen: enrollBodyText.length,
          headerKeys: Object.keys(enrollHeaderSnapshot).length,
        });
        armEnrollPipelineDebounced({
          baseHeaders: enrollHeaderSnapshot,
          enrollBodyText,
          enrollSeenAt,
        });
      }
    }

    const enrollWireT0 = isEnroll ? Date.now() : 0;
    const response = await prevFetch(input, init);
    const enrollRoundTripMs = isEnroll ? Date.now() - enrollWireT0 : 0;

    if (isEnroll) {
      try {
        const enrollText = await response.clone().text();
        let enrollJson: unknown;
        try {
          enrollJson = JSON.parse(enrollText);
        } catch {
          enrollJson = null;
        }
        const outcome =
          enrollJson !== null && typeof enrollJson === 'object'
            ? interpretEnrollV2Response(enrollJson)
            : {
                bizOk: false,
                enrollFailed: [] as EnrollOutcome['enrollFailed'],
                enrollSuccessCount: 0,
                notes: ['响应非 JSON'],
              };
        const level: 'info' | 'warn' = outcome.bizOk ? 'info' : 'warn';
        const detail: Record<string, unknown> = {
          httpStatus: response.status,
          ok: outcome.bizOk,
          enrollSuccessCount: outcome.enrollSuccessCount,
          enrollFailed: outcome.enrollFailed,
        };
        if (isEnroll) {
          detail.enrollRoundTripMs = enrollRoundTripMs;
          if (needsPipeline) {
            detail.enrollParallelRewriteMode = true;
            detail.enrollArmDebounceMs = ENROLL_ARM_DEBOUNCE_MS;
            detail.enrollSnapshotBufferMs = ENROLL_SNAPSHOT_BUFFER_MS;
            detail.afterUpsertDelayMs = AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS;
            detail.parallelPipeline = `enrollV2→max(主探测|弹窗锚点)+${ENROLL_SNAPSHOT_BUFFER_MS}ms→upsert→${AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS}ms→get_list→updateV2`;
          }
        }
        if (outcome.notes.length > 0) detail.notes = outcome.notes;
        if (outcome.topErrorCode !== undefined) detail.topErrorCode = outcome.topErrorCode;
        if (
          outcome.topErrorMsg !== undefined &&
          outcome.topErrorMsg !== null &&
          String(outcome.topErrorMsg).trim() !== ''
        ) {
          detail.topErrorMsg = outcome.topErrorMsg;
        }
        if (
          !outcome.bizOk &&
          outcome.enrollFailed.length === 0 &&
          outcome.topErrorCode !== undefined &&
          outcome.topErrorCode !== 1000000
        ) {
          detail.hint =
            '整单被顶层 error_code 拒绝（非 1000000），无 per-goods 列表。请同时查看 topErrorMsg，常见为参数/会话/活动状态/限流等，与 2003980 商品物流模板不是同一类。';
        }
        emitActivityDebug(level, 'enrollV2 报名结果', detail);
      } catch (e) {
        emitActivityDebug('warn', '读取 enrollV2 响应失败', e instanceof Error ? e.message : String(e));
      }
    }

    return response;
  };

  document.addEventListener('click', onDocumentClickCaptureForSubmit, true);

  emitActivityDebug(
    'info',
    `活动助手 MAIN 注入完成（主确认 ${SUBMIT_SHARED_FOLLOWUP_DELAY_MS}ms 仅低价探测；enrollV2 后 max(主探测|弹窗锚点)+${ENROLL_SNAPSHOT_BUFFER_MS}ms→upsert→${AFTER_MANGOSTEEN_UPSERT_BEFORE_UPDATEV2_MS}ms→get_list→updateV2；商品 id=enroll+DOM+CSV）`
  );
})();
