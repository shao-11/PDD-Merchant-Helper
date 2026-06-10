/** 从申诉详情页 URL / __NEXT_DATA__ 读取 ticketSn、orderSn */

export function parseTicketSnFromUrl(href = window.location.href): string {
  try {
    const u = new URL(href);
    const q = u.searchParams.get('ticketSn')?.trim();
    if (q) return q;
  } catch {
    /* ignore */
  }
  return parseTicketSnFromNextData() ?? '';
}

export function parseTicketSnFromNextData(): string | null {
  try {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el?.textContent) return null;
    const data = JSON.parse(el.textContent) as {
      props?: { pageProps?: { coreData?: { extra?: { query?: { ticketSn?: string } } } } };
    };
    const sn = data?.props?.pageProps?.coreData?.extra?.query?.ticketSn;
    return typeof sn === 'string' && sn.trim() ? sn.trim() : null;
  } catch {
    return null;
  }
}

export function isAppealDetailPage(href = window.location.href): boolean {
  try {
    return new URL(href).pathname.includes('/aftersales/customer_complain_appeal/detail');
  } catch {
    return false;
  }
}
