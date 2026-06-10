import { AFTERSALE_APPEAL_LIST_PATH } from './constants';

export function isAftersaleAppealListPage(href = window.location.href): boolean {
  try {
    const u = new URL(href);
    return u.pathname.includes(AFTERSALE_APPEAL_LIST_PATH);
  } catch {
    return false;
  }
}

const ORDER_SN_RE = /\d{6}-\d{10,}/;

/** 从维权申诉弹窗 DOM 解析订单号、售后单号 */
export function parseOrderFromRightsAppealModal(root: ParentNode = document): {
  orderSn: string;
  afterSalesId: number;
} | null {
  const modals = root.querySelectorAll<HTMLElement>('[data-testid="beast-core-modal"]');
  for (const modal of modals) {
    const header = modal.querySelector('.MDL_header_5-189-0, [class*="MDL_header"]');
    const title = (header?.textContent ?? '').trim();
    if (!title.includes('维权申诉')) continue;

    let orderSn = '';
    const orderLink = modal.querySelector<HTMLElement>(
      'a[data-testid="beast-core-button-link"] span, .Form_itemContentBody_5-189-0 a span',
    );
    const linkText = (orderLink?.textContent ?? '').trim();
    const m = linkText.match(ORDER_SN_RE);
    if (m) orderSn = m[0];

    if (!orderSn) {
      const labels = modal.querySelectorAll('label');
      for (const lb of labels) {
        if (!(lb.textContent ?? '').includes('申诉订单号')) continue;
        const row = lb.closest('[data-testid="beast-core-form-item"]');
        const span = row?.querySelector('span');
        const mm = (span?.textContent ?? '').match(ORDER_SN_RE);
        if (mm) orderSn = mm[0];
      }
    }

    let afterSalesId = 0;
    const submitBtn = modal.querySelector<HTMLElement>(
      '[data-tracking-click-viewid="el_click_appeal_to_submit"]',
    );
    const params = submitBtn?.getAttribute('data-tracking-params') ?? '';
    const idMatch = params.match(/aftersales_id=(\d+)/i);
    if (idMatch) afterSalesId = Number(idMatch[1]);

    if (orderSn && afterSalesId > 0) return { orderSn, afterSalesId };
    if (orderSn) return { orderSn, afterSalesId: afterSalesId || 0 };
  }
  return null;
}

/** 弹窗「最多可申诉 X 元」→ 分（与平台校验一致） */
export function parseMaxCargoAppealFenFromModal(root: ParentNode = document): number | undefined {
  const modal = findRightsAppealModal();
  if (!modal) return undefined;
  const compact = (modal.textContent ?? '').replace(/\s+/g, '');
  const m = compact.match(/最多可申诉([\d.]+)元/);
  if (!m) return undefined;
  const yuan = Number(m[1]);
  if (!Number.isFinite(yuan) || yuan <= 0) return undefined;
  return Math.round(yuan * 100);
}

export function findRightsAppealModal(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>('[data-testid="beast-core-modal"]');
  for (const modal of modals) {
    const header = modal.querySelector('.MDL_header_5-189-0, [class*="MDL_header"]');
    if ((header?.textContent ?? '').includes('维权申诉')) return modal;
  }
  return null;
}

/** 弹窗「申诉项」当前值，如 货款申诉 / 运费申诉 */
export function parseAppealSubTypeLabelFromModal(modal: HTMLElement): string {
  for (const lb of modal.querySelectorAll('label')) {
    const t = (lb.textContent ?? '').replace(/\s+/g, '');
    if (!t.includes('申诉项')) continue;
    const row = lb.closest('[data-testid="beast-core-form-item"]');
    const content = row?.querySelector('.Form_itemContentBody_5-189-0, [class*="Form_itemContentBody"]');
    const text = (content?.textContent ?? row?.textContent ?? '').replace(/\s+/g, '');
    if (text.includes('货款申诉')) return '货款申诉';
    if (text.includes('运费申诉')) return '运费申诉';
  }
  const compact = (modal.textContent ?? '').replace(/\s+/g, '');
  if (compact.includes('申诉项') && compact.includes('货款申诉')) return '货款申诉';
  if (compact.includes('申诉项') && compact.includes('运费申诉')) return '运费申诉';
  return '';
}
