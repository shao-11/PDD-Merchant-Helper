import {
  AUTO_PASS_APPEAL_REASON,
  MANUAL_REVIEW_HINT_ID,
} from './constants';

function norm(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

export function isAutoPassAppealReason(subReasonDesc: string): boolean {
  return norm(subReasonDesc) === norm(AUTO_PASS_APPEAL_REASON);
}

function readReasonFromModal(modal: HTMLElement): string {
  const field =
    modal.querySelector('#subInfoVOS\\[0\\]\\.reason') ??
    modal.querySelector('[id="subInfoVOS[0].reason"]');
  const input =
    field?.querySelector<HTMLInputElement>('[data-testid="beast-core-cascader-htmlInput"]') ??
    modal.querySelector<HTMLInputElement>('[data-testid="beast-core-cascader-htmlInput"]');
  const val = (input?.value ?? input?.getAttribute('value') ?? '').trim();
  if (val && val !== '请选择') return val;
  return '';
}

function findFooterActionRow(modal: HTMLElement): {
  row: HTMLElement;
  buttonsWrap: HTMLElement;
} | null {
  const submit = modal.querySelector<HTMLElement>(
    '[data-tracking-click-viewid="el_click_appeal_to_submit"]',
  );
  if (!submit) return null;
  const buttonsWrap = submit.parentElement;
  if (!buttonsWrap) return null;
  const row = buttonsWrap.parentElement;
  if (!row) return null;
  return { row, buttonsWrap };
}

function removeManualReviewHint(modal: HTMLElement): void {
  modal.querySelector(`#${MANUAL_REVIEW_HINT_ID}`)?.remove();
}

function renderManualReviewHint(row: HTMLElement, buttonsWrap: HTMLElement): void {
  let hint = row.querySelector<HTMLElement>(`#${MANUAL_REVIEW_HINT_ID}`);
  if (!hint) {
    hint = document.createElement('div');
    hint.id = MANUAL_REVIEW_HINT_ID;
  }
  row.insertBefore(hint, buttonsWrap);

  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.justifyContent = 'flex-end';
  row.style.gap = '12px';
  row.style.flexWrap = 'wrap';

  for (const child of Array.from(row.children)) {
    if (child === hint || child === buttonsWrap) continue;
    if (child instanceof HTMLElement && !child.contains(buttonsWrap)) {
      child.style.display = 'none';
    }
  }

  hint.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'flex:none',
    'padding:8px 12px',
    'background:#fff1f0',
    'border:1px solid #ffccc7',
    'border-radius:4px',
    'color:#cf1322',
    'font-size:14px',
    'font-weight:600',
    'line-height:20px',
    'box-sizing:border-box',
    'white-space:nowrap',
  ].join(';');
  hint.textContent = '需要人工判断';
}

/** 在维权申诉弹窗底部（提交按钮左侧）显示或隐藏「需要人工判断」 */
export function updateManualReviewHint(
  modal: HTMLElement,
  subReasonDesc?: string,
): { shown: boolean; reason: string } {
  const reason = (subReasonDesc?.trim() || readReasonFromModal(modal)).trim();
  if (!reason || isAutoPassAppealReason(reason)) {
    removeManualReviewHint(modal);
    return { shown: false, reason };
  }

  const footer = findFooterActionRow(modal);
  if (!footer) return { shown: false, reason };

  renderManualReviewHint(footer.row, footer.buttonsWrap);
  return { shown: true, reason };
}
