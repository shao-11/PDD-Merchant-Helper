/**
 * 活动确认页：与 Desktop dist 中 `pdd-shipping-template-button.js` 的 XPATH_CHECKBOX_RULES 对齐，
 * 通过 XPath 命中 beast 复选框方框，将协议/运费相关勾选拨到固定策略（on=勾选，off=取消）。
 * 另提供 MutationObserver + 首屏多次重试，应对 SPA 晚挂载。
 */

const TARGET_URL_KEY = 'mms.pinduoduo.com/act/goods_price/confirm';

/** 与 dist 白名单一致：policy 为固定目标 */
const CHECKBOX_BOX_SELECTOR = 'div[class*="CBX_square_"]';

type CheckboxPolicy = 'on' | 'off';

type XpathCheckboxRule = {
  id: string;
  policy: CheckboxPolicy;
  xpath: string;
};

const XPATH_CHECKBOX_RULES: XpathCheckboxRule[] = [
  /**
   * `#isCheckedOuterProtocol` 表单项即「降价补差 / 外场说明」一体 beast 复选框（见页内 label 文案）。
   * Desktop dist 里曾为 on；本工具箱若与其它脚本同时对该节点一勾一消，会无限闪。
   * 此处固定为 off：保持不参加降价补差（与运费模板 off、流量保护 off 并列）。
   */
  {
    id: 'isCheckedOuterProtocol',
    policy: 'off',
    xpath: '//*[@id="isCheckedOuterProtocol"]/div/div/div/label/div[1]/div',
  },
  {
    id: 'enroll_goods_shipping_config',
    policy: 'off',
    xpath: '//*[@id="enroll_goods_shipping_config"]/div[2]/div/div/div/div/div/div/label/div[1]',
  },
  {
    id: 'traffic_protect_info',
    policy: 'off',
    xpath: '//*[@id="traffic_protect_info"]/div/div/div/div/div[1]/label/div[1]/div',
  },
];

function isTargetConfirmPage(): boolean {
  try {
    return window.location.href.includes(TARGET_URL_KEY);
  } catch {
    return false;
  }
}

function getActivityIdParam(): string {
  try {
    return new URLSearchParams(window.location.search).get('activityId') || '';
  } catch {
    return '';
  }
}

let beastCheckboxPolicyActivityId = '';
const beastCheckboxTargetByKey = new Map<string, CheckboxPolicy>();
const beastCheckboxUserOverrideKeys = new Set<string>();
let checkboxUserOverridePointerBound = false;
let distAlignObserver: MutationObserver | null = null;
let distAlignBootIntervalId: number | null = null;
let distAlignDebounceTimer: number | null = null;
let distAlignPointerHandler: ((ev: PointerEvent) => void) | null = null;
/** 已安装时重复调用返回同一卸载函数 */
let distAlignUnmount: (() => void) | null = null;

function resetBeastCheckboxPolicyIfActivityChanged(): void {
  const act = getActivityIdParam();
  if (act !== beastCheckboxPolicyActivityId) {
    beastCheckboxTargetByKey.clear();
    beastCheckboxUserOverrideKeys.clear();
    beastCheckboxPolicyActivityId = act;
  }
}

function isBeastSquareChecked(box: HTMLElement): boolean {
  const wrap = box.closest('[class*="CBX_squareInputWrapper_"]') || box.parentElement;
  const inp = wrap?.querySelector?.('input[type="checkbox"]');
  if (inp instanceof HTMLInputElement) return !!inp.checked;
  const label = box.closest('label[data-testid="beast-core-checkbox"]');
  if (label instanceof HTMLElement && label.getAttribute('data-checked') === 'true') return true;
  const svg = box.querySelector('svg[data-testid="beast-core-icon-check"]');
  if (svg instanceof SVGElement) {
    const c = svg.getAttribute('class') || '';
    if (c.includes('CBX_active_') || c.includes('CBXG_active_')) return true;
  }
  return false;
}

function clickBeastCheckboxSquare(box: HTMLElement): void {
  const labelPrecise = box.closest('label[data-testid="beast-core-checkbox"]');
  const labelAny = box.closest('label');
  const wrap =
    box.closest('[data-testid="beast-core-checkbox-checkIcon"]') ||
    box.closest('[class*="CBX_squareInputWrapper_"]');
  (labelPrecise || labelAny || wrap || box).click();
}

function xpathFirstOrderedNode(expression: string, contextNode: Node): Node | null {
  const root = contextNode instanceof Node ? contextNode : document;
  try {
    const r = document.evaluate(expression, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  } catch {
    return null;
  }
}

function resolveBeastSquareFromXpathTarget(el: HTMLElement): HTMLElement | null {
  const sel = CHECKBOX_BOX_SELECTOR;
  try {
    if (el.matches?.(sel)) return el;
  } catch {
    /* ignore */
  }
  const inner = el.querySelector?.(sel);
  if (inner instanceof HTMLElement) return inner;
  const lab = el.closest('label');
  const inLab = lab?.querySelector?.(sel);
  if (inLab instanceof HTMLElement) return inLab;
  const up = el.closest?.(sel);
  return up instanceof HTMLElement ? up : null;
}

function checkboxRuleInteractiveAreaContains(rule: XpathCheckboxRule, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  const el = xpathFirstOrderedNode(rule.xpath, document);
  if (!(el instanceof HTMLElement)) return false;
  const box = resolveBeastSquareFromXpathTarget(el);
  if (!(box instanceof HTMLElement)) return false;
  if (box.contains(target)) return true;
  if (el.contains(target)) return true;
  const labelPrecise = box.closest('label[data-testid="beast-core-checkbox"]');
  const labelAny = box.closest('label');
  const wrap =
    box.closest('[data-testid="beast-core-checkbox-checkIcon"]') ||
    box.closest('[class*="CBX_squareInputWrapper_"]');
  if (labelPrecise instanceof HTMLElement && labelPrecise.contains(target)) return true;
  if (labelAny instanceof HTMLElement && labelAny.contains(target)) return true;
  if (wrap instanceof HTMLElement && wrap.contains(target)) return true;
  return false;
}

function onPointerDownCaptureForCheckboxUserOverride(ev: PointerEvent): void {
  if (!ev.isTrusted || !isTargetConfirmPage()) return;
  resetBeastCheckboxPolicyIfActivityChanged();
  const act = getActivityIdParam();
  for (const rule of XPATH_CHECKBOX_RULES) {
    if (!checkboxRuleInteractiveAreaContains(rule, ev.target)) continue;
    beastCheckboxUserOverrideKeys.add(`${act}|xpath|${rule.id}`);
  }
}

function applyXpathCheckboxRule(rule: XpathCheckboxRule): boolean {
  if (!rule.xpath || !rule.id || (rule.policy !== 'on' && rule.policy !== 'off')) return false;
  const el = xpathFirstOrderedNode(rule.xpath, document);
  if (!(el instanceof HTMLElement)) return false;
  const box = resolveBeastSquareFromXpathTarget(el);
  if (!(box instanceof HTMLElement)) return false;
  const policyKey = `${getActivityIdParam()}|xpath|${rule.id}`;
  if (beastCheckboxUserOverrideKeys.has(policyKey)) return false;
  if (!beastCheckboxTargetByKey.has(policyKey)) beastCheckboxTargetByKey.set(policyKey, rule.policy);
  const pol = beastCheckboxTargetByKey.get(policyKey);
  if (pol !== 'on' && pol !== 'off') return false;
  const checked = isBeastSquareChecked(box);
  if (pol === 'on' && !checked) {
    clickBeastCheckboxSquare(box);
    return true;
  }
  if (pol === 'off' && checked) {
    clickBeastCheckboxSquare(box);
    return true;
  }
  return false;
}

export type ActivityCheckboxApplyResult = {
  /** 实际发生点击以纠偏的次数（0～3） */
  stateChanges: number;
  /** XPath 至少解析到节点的规则条数 */
  rulesResolved: number;
};

/**
 * 与 dist `ensureCheckboxDefaults` 等价：对当前 DOM 应用各条 XPath 策略各一次（同价大促规则已移除；isCheckedOuterProtocol 在本仓库为 off）。
 */
export function ensureActivityConfirmCheckboxDefaultsLikeDist(): ActivityCheckboxApplyResult {
  if (!isTargetConfirmPage()) return { stateChanges: 0, rulesResolved: 0 };
  resetBeastCheckboxPolicyIfActivityChanged();
  let stateChanges = 0;
  let rulesResolved = 0;
  for (const rule of XPATH_CHECKBOX_RULES) {
    const el = xpathFirstOrderedNode(rule.xpath, document);
    if (el instanceof HTMLElement && resolveBeastSquareFromXpathTarget(el)) rulesResolved += 1;
    if (applyXpathCheckboxRule(rule)) stateChanges += 1;
  }
  return { stateChanges, rulesResolved };
}

/**
 * dist 的 queueMicrotask + rAF×2 + load + 短 interval 引导，首屏晚挂载时尽快对齐勾选。
 */
export function scheduleActivityConfirmCheckboxDefaultsAfterLoadLikeDist(): void {
  if (!isTargetConfirmPage()) return;
  if (distAlignBootIntervalId != null) {
    window.clearInterval(distAlignBootIntervalId);
    distAlignBootIntervalId = null;
  }
  queueMicrotask(() => {
    if (isTargetConfirmPage()) ensureActivityConfirmCheckboxDefaultsLikeDist();
  });
  requestAnimationFrame(() => {
    if (!isTargetConfirmPage()) return;
    ensureActivityConfirmCheckboxDefaultsLikeDist();
    requestAnimationFrame(() => {
      if (isTargetConfirmPage()) ensureActivityConfirmCheckboxDefaultsLikeDist();
    });
  });
  const run = (): void => {
    if (isTargetConfirmPage()) ensureActivityConfirmCheckboxDefaultsLikeDist();
  };
  if (document.readyState === 'complete') setTimeout(run, 0);
  else window.addEventListener('load', run, { once: true });

  let n = 0;
  distAlignBootIntervalId = window.setInterval(() => {
    if (!isTargetConfirmPage() || n++ >= 24) {
      if (distAlignBootIntervalId != null) {
        window.clearInterval(distAlignBootIntervalId);
        distAlignBootIntervalId = null;
      }
      return;
    }
    ensureActivityConfirmCheckboxDefaultsLikeDist();
  }, 280);
}

function debouncedEnsureCheckboxDefaults(): void {
  if (distAlignDebounceTimer != null) window.clearTimeout(distAlignDebounceTimer);
  distAlignDebounceTimer = window.setTimeout(() => {
    distAlignDebounceTimer = null;
    if (isTargetConfirmPage()) ensureActivityConfirmCheckboxDefaultsLikeDist();
  }, 150);
}

/**
 * 在活动确认页安装与 dist 类似的持续纠偏：pointer 捕获记录用户手动点过的白名单项不再自动改；MutationObserver 防抖触发。
 * @returns 卸载函数（离开页面时应调用）
 */
export function installActivityConfirmCheckboxDistAlign(): () => void {
  if (distAlignUnmount) return distAlignUnmount;

  if (!checkboxUserOverridePointerBound) {
    checkboxUserOverridePointerBound = true;
    distAlignPointerHandler = (ev: PointerEvent) => {
      onPointerDownCaptureForCheckboxUserOverride(ev);
    };
    document.addEventListener('pointerdown', distAlignPointerHandler, true);
  }

  scheduleActivityConfirmCheckboxDefaultsAfterLoadLikeDist();

  distAlignObserver = new MutationObserver(() => {
    debouncedEnsureCheckboxDefaults();
  });
  distAlignObserver.observe(document.documentElement, { childList: true, subtree: true });

  const unmount = (): void => {
    if (distAlignUnmount !== unmount) return;
    distAlignUnmount = null;
    if (distAlignObserver) {
      distAlignObserver.disconnect();
      distAlignObserver = null;
    }
    if (distAlignDebounceTimer != null) {
      window.clearTimeout(distAlignDebounceTimer);
      distAlignDebounceTimer = null;
    }
    if (distAlignBootIntervalId != null) {
      window.clearInterval(distAlignBootIntervalId);
      distAlignBootIntervalId = null;
    }
    if (distAlignPointerHandler) {
      document.removeEventListener('pointerdown', distAlignPointerHandler, true);
      distAlignPointerHandler = null;
    }
    checkboxUserOverridePointerBound = false;
  };
  distAlignUnmount = unmount;
  return unmount;
}

/**
 * @returns 成功纠偏的点击次数（与旧版「0～2」不同，现为 0～3；供刷新后一次性协议任务判断进度）
 */
export function runActivityConfirmUncheckProtocolBoxes(): number {
  const r = ensureActivityConfirmCheckboxDefaultsLikeDist();
  return r.stateChanges;
}
