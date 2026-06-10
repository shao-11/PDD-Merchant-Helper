;(function () {
  const TARGET_URL_KEY = 'mms.pinduoduo.com/orders/order/carriage/list'
  const HOOK_SCRIPT_ID = 'dtx-pdd-anti-hook-carriage-cleaner'
  const TOKEN_WAIT_MS = 15000
  const INSERT_BTN_ATTR = 'data-dtx-carriage-cleaner-btn'
  const MODAL_ID = 'dtx-carriage-cleaner-modal'

  const state = {
    antiQueue: [],
    rows: [],
    filterText: '',
    loading: false,
    deleting: false,
    /** 批量删除进度（与表格渲染解耦，避免 renderTable 与 loadList 交错时显示被冲成 0） */
    deleteProgress: { active: false, total: 0, ok: 0, processed: 0 },
    /** 用户确认「暂停删除」后置 true，删除循环内会检测并退出 */
    deleteAborted: false,
    /** 删除结束后的结果汇报遮罩未点「知道了」时为 true */
    deleteAwaitingAck: false,
  }

  function isTargetPage() {
    return window.location.href.includes(TARGET_URL_KEY)
  }

  function ensureHookInjected() {
    if (document.getElementById(HOOK_SCRIPT_ID)) return
    const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('pdd-page-anti-hook.js') : ''
    if (!url) return
    const script = document.createElement('script')
    script.id = HOOK_SCRIPT_ID
    script.src = url
    script.async = false
    ;(document.head || document.documentElement).appendChild(script)
    script.onload = () => script.remove()
  }

  function onMessage(event) {
    const data = event?.data
    if (!data || data.__dtx__ !== true || data.type !== 'dtxAntiContent') return
    const token = String(data.token || '')
    if (!token) return
    const last = state.antiQueue[state.antiQueue.length - 1]
    if (last && last.token === token) return
    state.antiQueue.push({ token, ts: Date.now(), source: String(data.source || '') })
    if (state.antiQueue.length > 16) state.antiQueue.shift()
  }

  function onRuntimeMessage(message) {
    if (!message || message.__dtx__ !== true || message.type !== 'dtxAntiContent') return
    const token = String(message.token || '').trim()
    if (!token) return
    const last = state.antiQueue[state.antiQueue.length - 1]
    if (last && last.token === token) return
    state.antiQueue.push({ token, ts: Date.now(), source: String(message.source || 'runtime') })
    if (state.antiQueue.length > 16) state.antiQueue.shift()
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false
    return true
  }

  function triggerNativeTokenRequest(reason) {
    try {
      const root = document.body
      if (!root) return false
      const buttons = Array.from(root.querySelectorAll('button')).filter((b) => b instanceof HTMLButtonElement && isVisible(b))
      const candidates = []
      for (const btn of buttons) {
        const txt = String(btn.textContent || '').trim()
        if (!txt) continue
        let score = 0
        if (/刷新|查询|搜索|重新加载|筛选/.test(txt)) score += 8
        if (/确定|提交|新建/.test(txt)) score -= 3
        if (btn.disabled) score -= 10
        if (score > 0) candidates.push({ el: btn, score, text: txt })
      }
      candidates.sort((a, b) => b.score - a.score)
      if (candidates.length > 0) {
        candidates[0].el.click()
        return true
      }
    } catch (_) {
      // ignore
    }
    return false
  }

  async function waitToken(stageLabel) {
    const start = Date.now()
    let lastTriggerAt = 0
    triggerNativeTokenRequest(`${stageLabel}-首次`)
    lastTriggerAt = Date.now()
    while (Date.now() - start < TOKEN_WAIT_MS) {
      const item = state.antiQueue.shift()
      if (item?.token) return item.token
      if (Date.now() - lastTriggerAt > 2400) {
        triggerNativeTokenRequest(`${stageLabel}-重试`)
        lastTriggerAt = Date.now()
      }
      await new Promise((r) => setTimeout(r, 180))
    }
    throw new Error('等待 anti-content 超时，请在页面点击「刷新」或切换筛选后再试')
  }

  async function postJson(path, antiContent, body) {
    const resp = await fetch(`https://mms.pinduoduo.com${path}`, {
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        'anti-content': antiContent,
      },
      body: JSON.stringify(body),
    })
    const text = await resp.text().catch(() => '')
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch (_) {
      json = null
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text || ''}`)
    return json
  }

  function findNewTemplateButton() {
    const list = document.querySelectorAll('button[data-testid="beast-core-button"]')
    for (const b of list) {
      if (!(b instanceof HTMLElement)) continue
      if (String(b.textContent || '').includes('新建运费模板')) return b
    }
    return null
  }

  /**
   * 优先：文案恰为「新建运费模板」的 span（与页面结构一致，避免只认外层 button 时插错）。
   * 退回：仍用含该文案的 beast 主按钮（旧版 DOM）。
   */
  function findNewTemplateAnchor() {
    for (const s of document.querySelectorAll('span')) {
      if (!(s instanceof HTMLElement)) continue
      const t = String(s.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (t === '新建运费模板') return s
    }
    return findNewTemplateButton()
  }

  /**
   * 清理按钮必须插在「整块新建按钮」外侧，不能与 span 同级留在 button 内部，否则会与蓝按钮重叠。
   */
  function getCleanButtonInsertHost(anchor) {
    if (!(anchor instanceof HTMLElement)) return null
    const btn =
      anchor.closest?.('button[data-testid="beast-core-button"]') || anchor.closest?.('button')
    if (btn instanceof HTMLElement && String(btn.textContent || '').includes('新建运费模板')) return btn
    return anchor
  }

  function ensureStyle() {
    if (document.getElementById('dtx-carriage-cleaner-style')) return
    const style = document.createElement('style')
    style.id = 'dtx-carriage-cleaner-style'
    style.textContent = `
      .dtx-carriage-clean-wrap {
        display: inline-flex;
        align-items: center;
        margin-left: 12px;
        vertical-align: middle;
        flex-shrink: 0;
      }
      .dtx-carriage-clean-trigger {
        box-sizing: border-box; border: 0; border-radius: 4px; height: 32px; padding: 0 14px;
        font-size: 13px; font-weight: 600; line-height: 32px; cursor: pointer;
        background: #d92a2a; color: #fff; white-space: nowrap;
      }
      .dtx-carriage-clean-trigger:hover { background: #c41e1e; }
      .dtx-carriage-clean-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
      #${MODAL_ID} {
        position: fixed; inset: 0; z-index: 2147483646; background: rgba(12, 22, 44, 0.48);
        display: none;
      }
      #${MODAL_ID}.show { display: block; }
      #${MODAL_ID} .dtx-cc-shell {
        min-height: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      #${MODAL_ID} .dtx-cc-card {
        width: min(1100px, calc(100vw - 40px));
        height: min(860px, 86vh);
        min-height: min(860px, 86vh);
        max-height: min(860px, 86vh);
        background: #fff; border-radius: 14px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.25); display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid #e2e8f0;
      }
      #${MODAL_ID} .dtx-cc-head {
        flex-shrink: 0;
        padding: 16px 20px; background: linear-gradient(90deg, #2f63f6, #4f7fff); color: #fff;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      }
      #${MODAL_ID} .dtx-cc-head h2 { margin: 0; font-size: 17px; font-weight: 800; }
      #${MODAL_ID} .dtx-cc-close {
        border: 0; background: rgba(255,255,255,0.2); color: #fff; width: 32px; height: 32px;
        border-radius: 8px; font-size: 20px; line-height: 1; cursor: pointer;
      }
      #${MODAL_ID} .dtx-cc-close:hover { background: rgba(255,255,255,0.3); }
      #${MODAL_ID} .dtx-cc-toolbar {
        flex-shrink: 0;
        padding: 12px 16px;
        border-bottom: 1px solid #edf1f7;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        justify-content: flex-start;
        row-gap: 10px;
      }
      #${MODAL_ID} .dtx-cc-toolbar-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        flex: 1 1 auto;
        min-width: 0;
        justify-content: flex-start;
      }
      /* 删除进行中固定占位，避免横幅/进度显隐导致整张卡片高度抖动 */
      #${MODAL_ID} .dtx-cc-slot-aux {
        flex-shrink: 0;
        height: 0;
        overflow: hidden;
        background: #f8fafc;
        border-bottom: 1px solid #edf1f7;
      }
      #${MODAL_ID} .dtx-cc-card.dtx-cc-deleting .dtx-cc-slot-aux {
        height: 58px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #${MODAL_ID} .dtx-cc-slot-aux [data-cc-el="progressWrap"] {
        display: none !important;
      }
      #${MODAL_ID} .dtx-cc-del-progress-mask {
        position: absolute;
        inset: 0;
        z-index: 30;
        display: none;
        align-items: center;
        justify-content: center;
        padding: min(48px, 6vw) min(40px, 5vw);
        box-sizing: border-box;
        background: rgba(6, 16, 38, 0.78);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      #${MODAL_ID} .dtx-cc-del-progress-mask.show {
        display: flex;
      }
      #${MODAL_ID} .dtx-cc-del-progress-card {
        width: min(600px, calc(100vw - 56px));
        max-width: 100%;
        border-radius: 24px;
        overflow: hidden;
        box-shadow:
          0 32px 80px rgba(8, 24, 56, 0.55),
          0 12px 32px rgba(29, 78, 216, 0.12),
          0 0 0 1px rgba(255, 255, 255, 0.12);
      }
      #${MODAL_ID} .dtx-cc-dpc-head {
        padding: 28px 32px 26px;
        background: linear-gradient(145deg, #1d4ed8 0%, #2563eb 38%, #3b82f6 72%, #60a5fa 100%);
        color: #eff6ff;
      }
      #${MODAL_ID} .dtx-cc-dpc-h-title {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.04em;
        line-height: 1.25;
      }
      #${MODAL_ID} .dtx-cc-dpc-h-sub {
        margin-top: 14px;
        font-size: 15px;
        font-weight: 600;
        color: rgba(241, 245, 255, 0.96);
        line-height: 1.55;
        max-width: 36em;
      }
      #${MODAL_ID} .dtx-cc-dpc-body {
        padding: 28px 32px 32px;
        background: linear-gradient(180deg, #f8faff 0%, #ffffff 45%);
      }
      #${MODAL_ID} .dtx-cc-dpc-stats {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 14px 36px;
        font-size: 15px;
        color: #334155;
        margin-bottom: 22px;
      }
      #${MODAL_ID} .dtx-cc-dpc-stats strong {
        font-weight: 800;
        color: #1d4ed8;
        font-size: 1.08em;
        font-variant-numeric: tabular-nums;
      }
      #${MODAL_ID} .dtx-cc-dpc-track {
        height: 14px;
        border-radius: 999px;
        background: #e0edff;
        overflow: hidden;
        border: 1px solid #93c5fd;
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.65);
      }
      #${MODAL_ID} .dtx-cc-dpc-bar {
        height: 100%;
        border-radius: 999px;
        width: 0%;
        background: linear-gradient(90deg, #1e40af, #2563eb 40%, #60a5fa 88%, #93c5fd);
        box-shadow: 0 0 18px rgba(37, 99, 235, 0.45);
        transition: width 0.26s cubic-bezier(0.33, 1, 0.68, 1);
      }
      #${MODAL_ID} .dtx-cc-dpc-running.is-hidden { display: none !important; }
      #${MODAL_ID} .dtx-cc-dpc-report { display: none; }
      #${MODAL_ID} .dtx-cc-dpc-report.is-visible { display: block !important; }
      #${MODAL_ID} .dtx-cc-dpc-report-lines { font-size: 15px; color: #1e3a5f; line-height: 1.8; margin-bottom: 22px; }
      #${MODAL_ID} .dtx-cc-dpc-report-lines p { margin: 0 0 10px; }
      #${MODAL_ID} .dtx-cc-dpc-report-lines strong {
        color: #1d4ed8; font-weight: 800; font-size: 1.06em; font-variant-numeric: tabular-nums;
      }
      #${MODAL_ID} .dtx-cc-dpc-ok {
        width: 100%; margin-top: 8px; padding: 14px 22px; border: 0; border-radius: 14px;
        font-size: 16px; font-weight: 800; cursor: pointer; color: #fff;
        letter-spacing: 0.06em;
        background: linear-gradient(90deg, #1e40af, #2563eb 45%, #3b82f6);
        box-shadow: 0 8px 24px rgba(29, 78, 216, 0.38);
      }
      #${MODAL_ID} .dtx-cc-dpc-ok:hover { opacity: 0.97; filter: brightness(1.03); }
      #${MODAL_ID} .dtx-cc-delete-started-banner {
        display: none;
        align-self: stretch;
        margin: 6px 12px 0;
        padding: 8px 12px;
        border-radius: 10px;
        background: linear-gradient(90deg, #0f766e, #14b8a6); color: #f0fdfa; font-size: 13px; font-weight: 700;
        border: 1px solid #0d9488; box-shadow: 0 4px 14px rgba(15, 118, 110, 0.22); line-height: 1.4;
        overflow: hidden;
      }
      #${MODAL_ID} .dtx-cc-delete-started-banner.show { display: block; }
      #${MODAL_ID} .dtx-cc-progress-wrap {
        display: none;
        min-height: 0;
        padding: 8px 12px 10px;
        background: #f8fafc;
        overflow: hidden;
      }
      #${MODAL_ID} .dtx-cc-progress-wrap.show {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
      }
      #${MODAL_ID} .dtx-cc-progress-line {
        display: flex; flex-wrap: wrap; gap: 16px 24px; font-size: 13px; color: #334155; margin-bottom: 10px;
      }
      #${MODAL_ID} .dtx-cc-progress-line strong { color: #1e3a5f; font-weight: 800; }
      #${MODAL_ID} .dtx-cc-progress-track {
        height: 10px; border-radius: 999px; background: #e2e8f0; overflow: hidden;
      }
      #${MODAL_ID} .dtx-cc-progress-bar {
        height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2f63f6, #5b8cff);
        width: 0%;
      }
      #${MODAL_ID} .dtx-cc-toolbar input[type="search"] {
        flex: 0 0 auto;
        width: min(380px, 36vw);
        min-width: 160px;
        max-width: 100%;
        height: 34px;
        padding: 0 12px;
        border: 1px solid #d5deef;
        border-radius: 8px;
        font-size: 13px;
      }
      #${MODAL_ID} .dtx-cc-toolbar [data-cc-el="count"] {
        flex: 0 0 auto;
        min-width: 13em;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #${MODAL_ID} .dtx-cc-btn {
        height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid #cfd8ea; background: #f7f9ff;
        font-size: 13px; font-weight: 700; color: #2a4578; cursor: pointer;
      }
      #${MODAL_ID} .dtx-cc-btn.primary { background: #2f63f6; color: #fff; border-color: #2f63f6; }
      #${MODAL_ID} .dtx-cc-btn.danger { background: #d92a2a; color: #fff; border-color: #d92a2a; }
      #${MODAL_ID} .dtx-cc-body {
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
      }
      #${MODAL_ID} .dtx-cc-table-wrap {
        flex: 1 1 0;
        min-height: 0;
        overflow: auto;
        overflow-x: auto;
        scrollbar-gutter: stable;
        border: 1px solid #e4eaf5;
        border-radius: 10px;
      }
      #${MODAL_ID} table.dtx-cc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      #${MODAL_ID} table.dtx-cc-table th, #${MODAL_ID} table.dtx-cc-table td {
        border-bottom: 1px solid #eef2f8; padding: 10px 10px; text-align: left; vertical-align: middle;
      }
      #${MODAL_ID} table.dtx-cc-table th {
        position: sticky; top: 0; background: #f4f7fc; font-weight: 800; color: #1b2e55; z-index: 1;
      }
      #${MODAL_ID} table.dtx-cc-table tr:hover td { background: #fafbff; }
      #${MODAL_ID} .dtx-cc-foot {
        flex-shrink: 0;
        min-height: 40px;
        max-height: 52px;
        overflow-y: auto;
        padding: 8px 16px;
        border-top: 1px solid #edf1f7;
        font-size: 12px;
        color: #5a6b8a;
        line-height: 1.45;
      }
      #${MODAL_ID} .dtx-cc-muted { color: #8a9ab5; font-size: 12px; }
      #${MODAL_ID} .dtx-cc-err { color: #b42318; font-size: 12px; }
      #dtx-cc-inline-confirm-host {
        position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center;
        padding: 20px; background: rgba(0, 0, 0, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      #dtx-cc-inline-confirm-host.dtx-cc-ic-show { display: flex !important; }
      .dtx-cc-ic-card {
        width: min(416px, 94vw); background: #fff; border-radius: 8px;
        box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12);
        overflow: hidden;
      }
      .dtx-cc-ic-head { padding: 20px 24px 8px; font-size: 16px; font-weight: 600; color: rgba(0, 0, 0, 0.88); }
      .dtx-cc-ic-body { padding: 0 24px 20px; font-size: 14px; color: rgba(0, 0, 0, 0.65); line-height: 1.6; }
      .dtx-cc-ic-foot { padding: 10px 16px; border-top: 1px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 8px; background: #fff; }
      .dtx-cc-ic-foot .dtx-cc-ic-btn {
        height: 32px; padding: 0 15px; border-radius: 6px; font-size: 14px; cursor: pointer;
        border: 1px solid #d9d9d9; background: #fff; color: rgba(0, 0, 0, 0.88);
      }
      .dtx-cc-ic-foot .dtx-cc-ic-btn.primary { background: #1677ff; border-color: #1677ff; color: #fff; }
      .dtx-cc-ic-foot .dtx-cc-ic-btn:hover { opacity: 0.9; }
    `
    document.documentElement.appendChild(style)
  }

  function formatTime(ms) {
    const n = Number(ms)
    if (!Number.isFinite(n) || n <= 0) return '—'
    try {
      const d = new Date(n)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch (_) {
      return String(ms)
    }
  }

  function getFilteredRows() {
    const q = String(state.filterText || '')
      .trim()
      .toLowerCase()
    if (!q) return state.rows.slice()
    return state.rows.filter((r) => {
      const id = String(r.costTemplateId || '')
      const name = String(r.costTemplateName || '').toLowerCase()
      return id.includes(q) || name.includes(q)
    })
  }

  /** 旧版弹窗：把横幅（及历史进度节点）包进固定高度 slot，避免布局跳动 */
  function ensureSlotAux(cardRoot) {
    if (!(cardRoot instanceof HTMLElement)) return
    if (cardRoot.querySelector('[data-cc-el="slotAux"]')) return
    const banner = cardRoot.querySelector('[data-cc-el="deleteStartedBanner"]')
    const progress = cardRoot.querySelector('[data-cc-el="progressWrap"]')
    if (!(banner instanceof HTMLElement) && !(progress instanceof HTMLElement)) return
    const slot = document.createElement('div')
    slot.className = 'dtx-cc-slot-aux'
    slot.setAttribute('data-cc-el', 'slotAux')
    const first = banner instanceof HTMLElement ? banner : progress
    const p = first.parentNode
    if (!(p instanceof HTMLElement)) return
    p.insertBefore(slot, first)
    if (banner instanceof HTMLElement && banner.parentNode !== slot) slot.appendChild(banner)
    if (progress instanceof HTMLElement && progress.parentNode !== slot) slot.appendChild(progress)
  }

  /** 旧版弹窗 DOM 无横幅时补插，避免必须整页刷新 */
  function ensureDeleteStartedBannerHost(cardRoot) {
    if (!(cardRoot instanceof HTMLElement)) return
    if (cardRoot.querySelector('[data-cc-el="deleteStartedBanner"]')) return
    const slot = cardRoot.querySelector('[data-cc-el="slotAux"]')
    const progress = cardRoot.querySelector('[data-cc-el="progressWrap"]')
    const tb = cardRoot.querySelector('.dtx-cc-toolbar')
    const ban = document.createElement('div')
    ban.className = 'dtx-cc-delete-started-banner'
    ban.setAttribute('data-cc-el', 'deleteStartedBanner')
    ban.setAttribute('aria-live', 'polite')
    const span = document.createElement('span')
    span.setAttribute('data-cc-el', 'deleteStartedText')
    ban.appendChild(span)
    if (slot instanceof HTMLElement) {
      slot.insertBefore(ban, slot.firstChild)
    } else if (progress instanceof HTMLElement && progress.parentNode instanceof HTMLElement) {
      progress.parentNode.insertBefore(ban, progress)
    } else if (tb instanceof HTMLElement) {
      tb.insertAdjacentElement('afterend', ban)
    } else {
      return
    }
  }

  /** 进度遮罩层 HTML（蓝色居中卡片；结束后切换为汇报区 +「知道了」） */
  function buildDeleteProgressMaskInnerHtml() {
    return `
      <div class="dtx-cc-del-progress-card" role="dialog" aria-modal="true" aria-labelledby="dtx-cc-dpc-title">
        <div class="dtx-cc-dpc-head">
          <div id="dtx-cc-dpc-title" class="dtx-cc-dpc-h-title">批量删除进度</div>
          <div class="dtx-cc-dpc-h-sub" data-cc-el="delProgressSub"></div>
        </div>
        <div class="dtx-cc-dpc-body">
          <div class="dtx-cc-dpc-running" data-cc-el="delProgressRunning">
            <div class="dtx-cc-dpc-stats">
              <span>待删除 <strong id="dtx-cc-ov-prog-total">0</strong> 条</span>
              <span>已删除 <strong id="dtx-cc-ov-prog-ok">0</strong> 条</span>
              <span>剩余 <strong id="dtx-cc-ov-prog-remain">0</strong> 条</span>
            </div>
            <div class="dtx-cc-dpc-track">
              <div class="dtx-cc-dpc-bar" id="dtx-cc-ov-prog-bar"></div>
            </div>
          </div>
          <div class="dtx-cc-dpc-report" data-cc-el="delProgressReport">
            <div class="dtx-cc-dpc-report-lines" data-cc-el="delProgressReportLines"></div>
            <button type="button" class="dtx-cc-dpc-ok" data-cc-act="del-progress-dismiss">知道了</button>
          </div>
        </div>
      </div>
    `
  }

  /** 旧版遮罩无汇报区时整体替换内部结构 */
  function ensureDelProgressReportDom() {
    const modal = document.getElementById(MODAL_ID)
    const mask = modal?.querySelector('[data-cc-el="delProgressMask"]')
    if (!(mask instanceof HTMLElement)) return
    if (mask.querySelector('[data-cc-el="delProgressReport"]')) return
    mask.innerHTML = buildDeleteProgressMaskInnerHtml()
  }

  function resetDeleteProgressMaskUi() {
    const modal = document.getElementById(MODAL_ID)
    if (!modal) return
    const title = modal.querySelector('#dtx-cc-dpc-title')
    if (title) title.textContent = '批量删除进度'
    const sub = modal.querySelector('[data-cc-el="delProgressSub"]')
    if (sub) sub.textContent = ''
    const run = modal.querySelector('[data-cc-el="delProgressRunning"]')
    const rep = modal.querySelector('[data-cc-el="delProgressReport"]')
    const lines = modal.querySelector('[data-cc-el="delProgressReportLines"]')
    if (run instanceof HTMLElement) run.classList.remove('is-hidden')
    if (rep instanceof HTMLElement) rep.classList.remove('is-visible')
    if (lines instanceof HTMLElement) lines.innerHTML = ''
  }

  /** @param {{ ok: number, fail: number, total: number, processed: number, userPaused: boolean }} p */
  function showDeleteProgressReport(p) {
    ensureDelProgressReportDom()
    state.deleteAwaitingAck = true
    const modal = document.getElementById(MODAL_ID)
    const run = modal?.querySelector('[data-cc-el="delProgressRunning"]')
    const rep = modal?.querySelector('[data-cc-el="delProgressReport"]')
    const lines = modal?.querySelector('[data-cc-el="delProgressReportLines"]')
    const title = modal?.querySelector('#dtx-cc-dpc-title')
    const sub = modal?.querySelector('[data-cc-el="delProgressSub"]')
    if (run instanceof HTMLElement) run.classList.add('is-hidden')
    if (rep instanceof HTMLElement) rep.classList.add('is-visible')
    if (sub instanceof HTMLElement) sub.textContent = ''
    const { ok, fail, total, processed, userPaused } = p
    const left = Math.max(0, total - processed)
    if (title instanceof HTMLElement) {
      title.textContent = userPaused ? '删除已暂停' : '删除完成'
    }
    if (lines instanceof HTMLElement) {
      if (userPaused) {
        lines.innerHTML = `<p>已成功 <strong>${ok}</strong> 条。</p><p>失败 <strong>${fail}</strong> 条。</p><p>未执行 <strong>${left}</strong> 条（已暂停）。</p>`
      } else {
        lines.innerHTML = `<p>计划删除 <strong>${total}</strong> 条。</p><p>成功 <strong>${ok}</strong> 条。</p><p>失败或未删 <strong>${fail}</strong> 条。</p>`
      }
    }
    setDeleteProgressVisible(true)
  }

  function dismissDeleteProgressReport() {
    state.deleteAwaitingAck = false
    clearDeleteProgressState()
    setDeleteProgressVisible(false)
    resetDeleteProgressMaskUi()
    renderTable()
    syncModalToolbar()
  }

  function bindDeleteProgressMaskDismiss(mask) {
    if (!(mask instanceof HTMLElement)) return
    if (mask.dataset.dtxCcDismissBound === '1') return
    mask.dataset.dtxCcDismissBound = '1'
    mask.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.closest('[data-cc-act="del-progress-dismiss"]')) {
        e.stopPropagation()
        dismissDeleteProgressReport()
      }
    })
  }

  function ensureDeleteProgressOverlay(modalEl) {
    if (!(modalEl instanceof HTMLElement)) return
    let mask = modalEl.querySelector('[data-cc-el="delProgressMask"]')
    if (!(mask instanceof HTMLElement)) {
      mask = document.createElement('div')
      mask.className = 'dtx-cc-del-progress-mask'
      mask.setAttribute('data-cc-el', 'delProgressMask')
      mask.setAttribute('aria-hidden', 'true')
      mask.innerHTML = buildDeleteProgressMaskInnerHtml()
      bindDeleteProgressMaskDismiss(mask)
      modalEl.appendChild(mask)
      return
    }
    bindDeleteProgressMaskDismiss(mask)
  }

  /** 将主卡片包入 shell，并挂载删除进度遮罩；移除卡槽内旧版内联进度节点 */
  function ensureShellStructure(modalEl) {
    if (!(modalEl instanceof HTMLElement)) return
    if (!modalEl.querySelector('.dtx-cc-shell')) {
      const card = modalEl.querySelector('.dtx-cc-card')
      if (!(card instanceof HTMLElement)) return
      const shell = document.createElement('div')
      shell.className = 'dtx-cc-shell'
      modalEl.insertBefore(shell, card)
      shell.appendChild(card)
    }
    ensureDeleteProgressOverlay(modalEl)
    const legacy = modalEl.querySelector('.dtx-cc-card [data-cc-el="progressWrap"]')
    if (legacy) legacy.remove()
    if (modalEl.dataset.dtxCcBackdropCloseV2 === '1') return
    modalEl.dataset.dtxCcBackdropCloseV2 = '1'
    modalEl.addEventListener(
      'click',
      (e) => {
        const t = e.target
        if (!(t instanceof HTMLElement)) return
        if (t.closest('[data-cc-el="delProgressMask"]')) return
        if (t === modalEl || t.classList.contains('dtx-cc-shell')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          closeModal()
        }
      },
      true,
    )
  }

  function syncModalDeletingClass() {
    const card = document.querySelector(`#${MODAL_ID} .dtx-cc-card`)
    if (!(card instanceof HTMLElement)) return
    card.classList.toggle('dtx-cc-deleting', !!state.deleting)
  }

  /** 旧版工具栏：把按钮与统计包进左侧对齐的 actions 容器，避免勾选后整行重排抖动 */
  function ensureToolbarActionsWrap(cardRoot) {
    if (!(cardRoot instanceof HTMLElement)) return
    if (cardRoot.querySelector('.dtx-cc-toolbar-actions')) return
    const tb = cardRoot.querySelector('.dtx-cc-toolbar')
    const inp = tb?.querySelector?.('input[data-cc-el="filter"]')
    if (!(tb instanceof HTMLElement) || !(inp instanceof HTMLElement)) return
    const wrap = document.createElement('div')
    wrap.className = 'dtx-cc-toolbar-actions'
    inp.insertAdjacentElement('afterend', wrap)
    let n = wrap.nextSibling
    while (n) {
      const nx = n.nextSibling
      wrap.appendChild(n)
      n = nx
    }
  }

  function ensureModal() {
    let el = document.getElementById(MODAL_ID)
    if (el) {
      ensureShellStructure(el)
      const card = el.querySelector('.dtx-cc-card') || el
      ensureToolbarActionsWrap(card)
      ensureSlotAux(card)
      ensureDeleteStartedBannerHost(card)
      return el
    }
    el = document.createElement('div')
    el.id = MODAL_ID
    el.innerHTML = `
      <div class="dtx-cc-shell">
        <div class="dtx-cc-card" role="dialog" aria-modal="true" aria-labelledby="dtx-cc-title">
          <div class="dtx-cc-head">
            <h2 id="dtx-cc-title">滇同学·运费模板清理工具</h2>
            <button type="button" class="dtx-cc-close" data-cc-act="close" aria-label="关闭">×</button>
          </div>
          <div class="dtx-cc-toolbar">
            <input type="search" placeholder="按模板名称或 ID 筛选…" data-cc-el="filter" />
            <div class="dtx-cc-toolbar-actions">
              <button type="button" class="dtx-cc-btn" data-cc-act="refresh">刷新列表</button>
              <button type="button" class="dtx-cc-btn" data-cc-act="all">全选可见</button>
              <button type="button" class="dtx-cc-btn" data-cc-act="none">全不选</button>
              <button type="button" class="dtx-cc-btn danger" data-cc-act="batchdel">批量删除选中</button>
              <span class="dtx-cc-muted" data-cc-el="count"></span>
            </div>
          </div>
          <div class="dtx-cc-slot-aux" data-cc-el="slotAux">
            <div class="dtx-cc-delete-started-banner" data-cc-el="deleteStartedBanner" aria-live="polite">
              <span data-cc-el="deleteStartedText"></span>
            </div>
          </div>
          <div class="dtx-cc-body">
            <div class="dtx-cc-table-wrap" data-cc-el="tablewrap"></div>
          </div>
          <div class="dtx-cc-foot" data-cc-el="foot">勾选后可批量删除；是否删除成功以拼多多删除接口返回为准，工具不做「能否删除」的前端限制。</div>
        </div>
      </div>
      <div class="dtx-cc-del-progress-mask" data-cc-el="delProgressMask" aria-hidden="true">
        ${buildDeleteProgressMaskInnerHtml()}
      </div>
    `
    el.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.closest('[data-cc-act="del-progress-dismiss"]')) {
        dismissDeleteProgressReport()
        return
      }
      if (t.closest('[data-cc-el="delProgressMask"]')) return
      if (t === el || t.classList.contains('dtx-cc-shell')) {
        closeModal()
        return
      }
      const act = t.getAttribute('data-cc-act') || ''
      if (act === 'close') closeModal()
      else if (act === 'refresh') void loadList()
      else if (act === 'all') selectAllVisible(true)
      else if (act === 'none') selectAllVisible(false)
      else if (act === 'batchdel') void onBatchDeleteToolbarClick()
    })
    el.querySelector('[data-cc-el="filter"]')?.addEventListener('input', (e) => {
      const inp = e.target
      if (inp instanceof HTMLInputElement) {
        state.filterText = inp.value
        renderTable()
      }
    })
    document.documentElement.appendChild(el)
    ensureShellStructure(el)
    return el
  }

  function openModal() {
    ensureStyle()
    const el = ensureModal()
    dismissDeleteProgressReport()
    const inp = el.querySelector('[data-cc-el="filter"]')
    if (inp instanceof HTMLInputElement) {
      inp.value = ''
      state.filterText = ''
    }
    el.classList.add('show')
    void loadList()
  }

  function closeModal() {
    const el = document.getElementById(MODAL_ID)
    const wasShown = !!(el instanceof HTMLElement && el.classList.contains('show'))
    dismissDeleteProgressReport()
    el?.classList.remove('show')
    if (wasShown) {
      window.location.reload()
    }
  }

  function setFoot(msg, isErr) {
    const foot = document.querySelector(`#${MODAL_ID} [data-cc-el="foot"]`)
    if (!(foot instanceof HTMLElement)) return
    foot.textContent = msg
    foot.className = `dtx-cc-foot${isErr ? ' dtx-cc-err' : ''}`
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  async function sleepInterruptible(ms) {
    let left = Math.max(0, Math.floor(Number(ms) || 0))
    const step = 200
    while (left > 0) {
      if (state.deleteAborted) return
      const chunk = Math.min(step, left)
      await sleep(chunk)
      left -= chunk
    }
  }

  /** 相邻两条删除请求之间的随机间隔（毫秒），含端点 500～3000 */
  function randomDeleteIntervalMs() {
    return 500 + Math.floor(Math.random() * 2501)
  }

  const RATE_LIMIT_WAIT_MS = 20000

  function isDeleteRateLimitedMessage(msg) {
    const s = String(msg || '')
    return /操作太过频繁|操作过于频繁|请稍后再试|太过频繁|请求过于频繁|访问过于频繁/.test(s)
  }

  function setDeleteProgressVisible(show) {
    const modal = document.getElementById(MODAL_ID)
    const mask = modal?.querySelector('[data-cc-el="delProgressMask"]')
    if (!(mask instanceof HTMLElement)) return
    mask.classList.toggle('show', !!show)
    mask.setAttribute('aria-hidden', show ? 'false' : 'true')
  }

  /** @param {number} total @param {number} ok @param {number} processed */
  function setDeleteProgress(total, ok, processed) {
    const t = Math.max(0, Math.floor(Number(total) || 0))
    const o = Math.max(0, Math.floor(Number(ok) || 0))
    const p = Math.max(0, Math.min(t, Math.floor(Number(processed) || 0)))
    state.deleteProgress = { active: true, total: t, ok: o, processed: p }
    paintDeleteProgressFromState()
  }

  function paintDeleteProgressFromState() {
    const dp = state.deleteProgress
    if (!dp || !dp.active) return
    const t = dp.total
    const o = dp.ok
    const p = Math.max(0, Math.min(t, Math.floor(Number(dp.processed) || 0)))
    const remain = Math.max(0, t - p)
    const pct = t > 0 ? Math.min(100, Math.round((p / t) * 1000) / 10) : 0
    const totalEl =
      document.getElementById('dtx-cc-ov-prog-total') || document.getElementById('dtx-cc-prog-total')
    const okEl = document.getElementById('dtx-cc-ov-prog-ok') || document.getElementById('dtx-cc-prog-ok')
    const remEl =
      document.getElementById('dtx-cc-ov-prog-remain') || document.getElementById('dtx-cc-prog-remain')
    const bar =
      document.getElementById('dtx-cc-ov-prog-bar') || document.getElementById('dtx-cc-prog-bar')
    if (totalEl) totalEl.textContent = String(t)
    if (okEl) okEl.textContent = String(o)
    if (remEl) remEl.textContent = String(remain)
    if (bar instanceof HTMLElement) bar.style.width = `${pct}%`
  }

  function clearDeleteProgressState() {
    state.deleteProgress = { active: false, total: 0, ok: 0, processed: 0 }
  }

  function syncDeleteStartedBanner() {
    const ban = document.querySelector(`#${MODAL_ID} [data-cc-el="deleteStartedBanner"]`)
    const txt = document.querySelector(`#${MODAL_ID} [data-cc-el="deleteStartedText"]`)
    const sub = document.querySelector(`#${MODAL_ID} [data-cc-el="delProgressSub"]`)
    if (!(ban instanceof HTMLElement)) return
    if (state.deleting && state.deleteProgress.active) {
      const t = state.deleteProgress.total
      ban.classList.add('show')
      if (txt) {
        txt.textContent = `已开始执行删除任务：本次共 ${t} 条，正按随机间隔调用删除接口，请勿关闭本窗口。`
      }
      if (sub) {
        sub.textContent = `本次共 ${t} 条，正按随机间隔调用删除接口，请勿关闭本窗口。`
      }
    } else {
      ban.classList.remove('show')
      if (txt) txt.textContent = ''
      if (sub) sub.textContent = ''
    }
  }

  /** 让浏览器先绘制「正在打开确认」等提示，再弹出确认框 */
  function yieldForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(undefined))
      })
    })
  }

  function syncModalToolbar() {
    const modal = document.getElementById(MODAL_ID)
    if (!modal) return
    const busy = state.deleting || state.loading
    const acts = ['refresh', 'all', 'none', 'batchdel', 'close']
    for (const a of acts) {
      const btn = modal.querySelector(`[data-cc-act="${a}"]`)
      if (btn instanceof HTMLButtonElement) {
        if (a === 'close') btn.disabled = state.deleting
        else if (a === 'refresh') btn.disabled = busy
        else if (a === 'batchdel') {
          btn.disabled = state.loading
          btn.textContent = state.deleting ? '正执行删除任务' : '批量删除选中'
        } else btn.disabled = state.deleting
      }
    }
    const filter = modal.querySelector('[data-cc-el="filter"]')
    if (filter instanceof HTMLInputElement) filter.disabled = state.deleting
  }

  async function loadList() {
    const modal = document.getElementById(MODAL_ID)
    if (!modal?.classList.contains('show')) return
    if (state.deleting) return
    if (state.loading) return
    state.loading = true
    setFoot('正在拉取模板列表…')
    renderTable()
    try {
      ensureHookInjected()
      const token = await waitToken('carriage-list')
      const res = await postJson('/express_inf/cost_template/get_list', token, {
        pageNo: 1,
        pageSize: 1000,
        sourceKey: 'MMS',
      })
      if (!res || res.success !== true) {
        throw new Error(String(res?.errorMsg || res?.error_msg || JSON.stringify(res || {})))
      }
      if (state.deleting) {
        state.loading = false
        renderTable()
        return
      }
      const list = Array.isArray(res?.result?.list) ? res.result.list : []
      state.rows = list.map((item) => ({
        costTemplateId: Number(item?.costTemplateId || 0),
        costTemplateName: String(item?.costTemplateName || ''),
        updateTime: item?.updateTime,
        selected: false,
        note: '',
      }))
      state.filterText = String(modal.querySelector('[data-cc-el="filter"]')?.value || '')
      setFoot(`共 ${state.rows.length} 条模板（最多展示 1000 条）`)
    } catch (err) {
      if (!state.deleting) {
        setFoot(String(err?.message || err), true)
        state.rows = []
      }
    } finally {
      state.loading = false
      renderTable()
    }
  }

  function selectAllVisible(select) {
    const visible = new Set(getFilteredRows().map((r) => r.costTemplateId))
    for (const r of state.rows) {
      if (!visible.has(r.costTemplateId)) continue
      r.selected = !!select
    }
    renderTable()
  }

  function renderTable() {
    const wrap = document.querySelector(`#${MODAL_ID} [data-cc-el="tablewrap"]`)
    const countEl = document.querySelector(`#${MODAL_ID} [data-cc-el="count"]`)
    syncModalToolbar()
    syncModalDeletingClass()
    if (!(wrap instanceof HTMLElement)) {
      paintDeleteProgressFromState()
      syncDeleteStartedBanner()
      return
    }
    const rows = getFilteredRows()
    if (countEl instanceof HTMLElement) {
      const nSel = state.rows.filter((r) => r.selected).length
      countEl.textContent = `显示 ${rows.length} 条 · 已选 ${nSel} 条`
    }
    if (state.loading && !state.rows.length) {
      wrap.innerHTML = '<p class="dtx-cc-muted" style="padding:16px">加载中…</p>'
      paintDeleteProgressFromState()
      syncDeleteStartedBanner()
      return
    }
    if (!state.rows.length && !state.loading) {
      wrap.innerHTML = '<p class="dtx-cc-muted" style="padding:16px">暂无数据或加载失败，可点击「刷新列表」重试。</p>'
      paintDeleteProgressFromState()
      syncDeleteStartedBanner()
      return
    }
    const masterDis = state.deleting || rows.length === 0
    const masterTitle = rows.length === 0 ? '当前筛选结果为空' : '全选/全不选当前筛选结果中的模板'
    const headDis = masterDis ? ' disabled' : ''
    const head = `<table class="dtx-cc-table"><thead><tr>
      <th style="width:44px"><input type="checkbox" data-cc-act="toggle-all-visible" title="${escapeHtml(masterTitle)}"${headDis} /></th>
      <th style="width:140px">模板 ID</th>
      <th>模板名称</th>
      <th style="width:160px">更新时间</th>
      <th style="width:200px">备注</th>
    </tr></thead><tbody>`
    const body = rows
      .map((r) => {
        const id = r.costTemplateId
        const note = r.note ? `<span class="dtx-cc-err">${escapeHtml(r.note)}</span>` : ''
        const dis = state.deleting ? ' disabled' : ''
        return `<tr data-cc-id="${id}">
        <td><input type="checkbox" data-cc-row="${id}" ${r.selected ? 'checked' : ''}${dis} /></td>
        <td>${id}</td>
        <td>${escapeHtml(r.costTemplateName)}</td>
        <td>${escapeHtml(formatTime(r.updateTime))}</td>
        <td>${note}</td>
      </tr>`
      })
      .join('')
    wrap.innerHTML = head + body + '</tbody></table>'
    const master = wrap.querySelector('input[data-cc-act="toggle-all-visible"]')
    if (master instanceof HTMLInputElement) {
      const allSel = rows.length > 0 && rows.every((r) => r.selected)
      const noneSel = !rows.some((r) => r.selected)
      master.checked = allSel
      master.indeterminate = !allSel && !noneSel && rows.some((r) => r.selected)
      master.onclick = (ev) => {
        ev.stopPropagation()
        if (state.deleting) return
        if (rows.length === 0) return
        const on = master.checked
        for (const r of rows) {
          const row = state.rows.find((x) => x.costTemplateId === r.costTemplateId)
          if (row) row.selected = on
        }
        renderTable()
      }
    }
    wrap.querySelectorAll('input[data-cc-row]').forEach((inp) => {
      if (!(inp instanceof HTMLInputElement)) return
      inp.addEventListener('change', () => {
        if (state.deleting) return
        const id = Number(inp.getAttribute('data-cc-row'))
        const row = state.rows.find((x) => x.costTemplateId === id)
        if (!row) {
          inp.checked = false
          return
        }
        row.selected = inp.checked
        renderTable()
      })
    })
    paintDeleteProgressFromState()
    syncDeleteStartedBanner()
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** 不依赖 antd 分包时的页内二次确认（与 Ant Design 风格接近，非系统弹窗） */
  function showDtxInlineConfirmModal(opts) {
    const title = String(opts.title || '确认')
    const content = String(opts.content || '')
    const okText = String(opts.okText || '确定')
    const cancelText = String(opts.cancelText || '取消')
    ensureStyle()
    return new Promise((resolve) => {
      let host = document.getElementById('dtx-cc-inline-confirm-host')
      if (!host) {
        host = document.createElement('div')
        host.id = 'dtx-cc-inline-confirm-host'
        document.documentElement.appendChild(host)
      }
      const cleanup = (v) => {
        window.removeEventListener('keydown', onKey)
        host.removeEventListener('click', onClick)
        host.classList.remove('dtx-cc-ic-show')
        host.innerHTML = ''
        resolve(!!v)
      }
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false)
      }
      const onClick = (e) => {
        const raw = e.target
        const t = raw instanceof HTMLElement ? raw : raw instanceof Node ? raw.parentElement : null
        if (!t) return
        if (t === host) {
          cleanup(false)
          return
        }
        const btn = t.closest?.('button[data-dtx-ic]')
        if (!(btn instanceof HTMLButtonElement)) return
        const a = btn.getAttribute('data-dtx-ic')
        if (a === 'ok') cleanup(true)
        else if (a === 'cancel') cleanup(false)
      }
      host.classList.add('dtx-cc-ic-show')
      host.innerHTML = `
        <div class="dtx-cc-ic-card" role="dialog" aria-modal="true" aria-labelledby="dtx-cc-ic-title">
          <div class="dtx-cc-ic-head" id="dtx-cc-ic-title">${escapeHtml(title)}</div>
          <div class="dtx-cc-ic-body">${escapeHtml(content)}</div>
          <div class="dtx-cc-ic-foot">
            <button type="button" class="dtx-cc-ic-btn" data-dtx-ic="cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="dtx-cc-ic-btn primary" data-dtx-ic="ok">${escapeHtml(okText)}</button>
          </div>
        </div>
      `
      window.addEventListener('keydown', onKey)
      host.addEventListener('click', onClick)
    })
  }

  async function showBatchDeleteConfirm(count) {
    const n = Number(count) || 0
    const text = `确定删除选中的 ${n} 个运费模板？不可恢复的将跳过并取消勾选。`
    const payload = {
      title: '确认删除',
      content: text,
      okText: '确定',
      cancelText: '取消',
    }
    if (typeof window.__dtxCarriageShowConfirm === 'function') {
      try {
        return !!(await window.__dtxCarriageShowConfirm(payload))
      } catch (_) {
        // antd 脚本异常时走页内确认
      }
    }
    return showDtxInlineConfirmModal(payload)
  }

  async function handlePauseDeleteRequest() {
    if (!state.deleting) return
    const payload = {
      title: '暂停删除',
      content: '是否暂停删除？暂停后将保留已删除的结果，尚未执行的条目不再继续删除。',
      okText: '暂停删除',
      cancelText: '继续删除',
    }
    let ok = false
    if (typeof window.__dtxCarriageShowConfirm === 'function') {
      try {
        ok = !!(await window.__dtxCarriageShowConfirm(payload))
      } catch (_) {
        ok = !!(await showDtxInlineConfirmModal(payload))
      }
    } else {
      ok = !!(await showDtxInlineConfirmModal(payload))
    }
    if (ok) state.deleteAborted = true
  }

  async function onBatchDeleteToolbarClick() {
    if (state.deleting) {
      await handlePauseDeleteRequest()
      return
    }
    await batchDeleteSelected()
  }

  async function batchDeleteSelected() {
    if (state.deleting) return
    const targets = state.rows.filter((r) => r.selected)
    if (!targets.length) {
      setFoot('请先勾选要删除的模板', true)
      return
    }
    if (state.deleteAwaitingAck) {
      setFoot('请先在上次删除结果窗口中点击「知道了」后再操作。', true)
      renderTable()
      return
    }
    setFoot('正在打开确认框…')
    renderTable()
    await yieldForPaint()
    if (!(await showBatchDeleteConfirm(targets.length))) {
      setFoot(`共 ${state.rows.length} 条模板（最多展示 1000 条）`)
      renderTable()
      return
    }
    const total = targets.length
    state.deleteAborted = false
    state.deleting = true
    clearDeleteProgressState()
    setDeleteProgressVisible(true)
    setDeleteProgress(total, 0, 0)
    setFoot('删除任务已启动：下方为实时进度；相邻请求间隔随机 0.5～3 秒；若提示操作过于频繁将暂停约 20 秒后重试本条。')
    renderTable()
    let ok = 0
    let fail = 0
    let processed = 0
    for (let i = 0; i < targets.length; i += 1) {
      if (state.deleteAborted) break
      if (i > 0) {
        await sleepInterruptible(randomDeleteIntervalMs())
        if (state.deleteAborted) break
      }
      const t = targets[i]
      let row = state.rows.find((x) => x.costTemplateId === t.costTemplateId)
      if (!row || !row.selected) {
        processed += 1
        setDeleteProgress(total, ok, processed)
        renderTable()
        continue
      }
      let itemDone = false
      while (!itemDone) {
        if (state.deleteAborted) {
          itemDone = true
          break
        }
        try {
          const token = await waitToken(`carriage-del-${row.costTemplateId}`)
          const res = await postJson('/express_inf/cost_template/delete', token, {
            costTemplateId: row.costTemplateId,
            sourceKey: 'MMS',
          })
          if (res && res.success === true) {
            ok += 1
            row.selected = false
            row.note = '已删除'
            const idx = state.rows.indexOf(row)
            if (idx >= 0) state.rows.splice(idx, 1)
            itemDone = true
          } else {
            const msg = String(res?.errorMsg || res?.error_msg || JSON.stringify(res || {}))
            if (isDeleteRateLimitedMessage(msg)) {
              row.note = '操作过于频繁，已暂停约 20 秒后重试本条…'
              setFoot('检测到删除频率限制，已暂停发起删除约 20 秒…')
              renderTable()
              await sleepInterruptible(RATE_LIMIT_WAIT_MS)
              if (state.deleteAborted) {
                itemDone = true
                break
              }
              row.note = ''
              row = state.rows.find((x) => x.costTemplateId === t.costTemplateId)
              if (!row || !row.selected) {
                itemDone = true
                break
              }
              setFoot('继续删除中（相邻请求仍为随机 0.5～3 秒间隔）…')
              renderTable()
              continue
            }
            fail += 1
            row.selected = false
            row.note = msg.length > 80 ? `${msg.slice(0, 80)}…` : msg
            itemDone = true
          }
        } catch (err) {
          const msg = String(err?.message || err)
          if (isDeleteRateLimitedMessage(msg)) {
            if (row) {
              row.note = '操作过于频繁，已暂停约 20 秒后重试本条…'
            }
            setFoot('检测到删除频率限制，已暂停发起删除约 20 秒…')
            renderTable()
            await sleepInterruptible(RATE_LIMIT_WAIT_MS)
            if (state.deleteAborted) {
              itemDone = true
              break
            }
            if (row) row.note = ''
            row = state.rows.find((x) => x.costTemplateId === t.costTemplateId)
            if (!row || !row.selected) {
              itemDone = true
              break
            }
            setFoot('继续删除中（相邻请求仍为随机 0.5～3 秒间隔）…')
            renderTable()
            continue
          }
          fail += 1
          if (row) {
            row.selected = false
            row.note = msg.length > 80 ? `${msg.slice(0, 80)}…` : msg
          }
          itemDone = true
        }
      }
      if (state.deleteAborted) break
      processed += 1
      setDeleteProgress(total, ok, processed)
      renderTable()
    }
    const userPaused = state.deleteAborted
    state.deleting = false
    state.deleteAborted = false
    syncModalDeletingClass()
    syncDeleteStartedBanner()
    syncModalToolbar()
    showDeleteProgressReport({ ok, fail, total, processed, userPaused })
    if (userPaused) {
      const left = Math.max(0, total - processed)
      setFoot(`已暂停删除：已成功 ${ok} 条，失败 ${fail} 条；尚有 ${left} 条未执行。`, false)
    } else {
      setFoot(`删除完成：成功 ${ok} 条，失败或未删 ${fail} 条（失败项已自动取消勾选）`, fail > 0)
    }
    renderTable()
  }

  /** 与「新建运费模板」主按钮同高、同圆角（拼多多改版后仍对齐） */
  function syncCleanTriggerToRef(trigger, ref) {
    if (!(trigger instanceof HTMLElement) || !(ref instanceof HTMLElement)) return
    const apply = () => {
      const cs = window.getComputedStyle(ref)
      const h = cs.height
      if (!h || h === '0px') return
      trigger.style.boxSizing = cs.boxSizing || 'border-box'
      trigger.style.height = h
      trigger.style.minHeight = h
      trigger.style.maxHeight = h
      const lh = cs.lineHeight
      trigger.style.lineHeight = lh === 'normal' || lh === '0px' ? h : lh
      trigger.style.borderRadius = cs.borderRadius
      trigger.style.paddingTop = cs.paddingTop
      trigger.style.paddingBottom = cs.paddingBottom
      trigger.style.paddingLeft = cs.paddingLeft
      trigger.style.paddingRight = cs.paddingRight
      trigger.style.fontSize = cs.fontSize
      trigger.style.fontWeight = cs.fontWeight
    }
    apply()
    requestAnimationFrame(apply)
  }

  function ensureToolbarButton() {
    if (!isTargetPage()) return
    const anchor = findNewTemplateAnchor()
    if (!(anchor instanceof HTMLElement)) return
    const insertHost = getCleanButtonInsertHost(anchor)
    if (!(insertHost instanceof HTMLElement)) return
    const styleRef =
      insertHost instanceof HTMLButtonElement
        ? insertHost
        : anchor.closest('button[data-testid="beast-core-button"]') ||
          anchor.closest('button') ||
          anchor

    let wrap = document.querySelector(`[${INSERT_BTN_ATTR}="1"]`)
    if (wrap instanceof HTMLElement) {
      const rb = wrap.querySelector('button.dtx-carriage-clean-trigger')
      if (rb instanceof HTMLElement) {
        if (insertHost.nextElementSibling !== wrap) {
          insertHost.insertAdjacentElement('afterend', wrap)
        }
        syncCleanTriggerToRef(rb, styleRef)
      }
      return
    }

    wrap = document.createElement('span')
    wrap.setAttribute(INSERT_BTN_ATTR, '1')
    wrap.className = 'dtx-carriage-clean-wrap'
    const rb = document.createElement('button')
    rb.type = 'button'
    rb.className = 'dtx-carriage-clean-trigger'
    rb.textContent = '清理运费模板'
    rb.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openModal()
    })
    wrap.appendChild(rb)
    insertHost.insertAdjacentElement('afterend', wrap)
    syncCleanTriggerToRef(rb, styleRef)
  }

  const observer = new MutationObserver(() => {
    if (!isTargetPage()) return
    ensureToolbarButton()
  })

  function start() {
    if (!isTargetPage()) return
    ensureStyle()
    ensureHookInjected()
    window.addEventListener('message', onMessage, false)
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage)
    }
    ensureToolbarButton()
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
