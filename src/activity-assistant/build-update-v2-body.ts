const NO_SHIP_CONFIG: Array<Record<string, unknown>> = [
  {
    province: 33,
    noShipReasonType: 5,
    cbType: null,
    fs: null,
    fc: null,
    as: null,
    ac: null,
    exceptConfigBackDate: null,
    edetail: null,
    etype: null,
    configBackFlag: null,
  },
  {
    province: 34,
    noShipReasonType: 5,
    cbType: null,
    fs: null,
    fc: null,
    as: null,
    ac: null,
    exceptConfigBackDate: null,
    edetail: null,
    etype: null,
    configBackFlag: null,
  },
  {
    province: 35,
    noShipReasonType: 5,
    cbType: null,
    fs: null,
    fc: null,
    as: null,
    ac: null,
    exceptConfigBackDate: null,
    edetail: null,
    etype: null,
    configBackFlag: null,
  },
];

const noShipConfigEntry = (province: number): Record<string, unknown> => ({
  province,
  noShipReasonType: 5,
  cbType: null,
  fs: null,
  fc: null,
  as: null,
  ac: null,
  exceptConfigBackDate: null,
  edetail: null,
  etype: null,
  configBackFlag: null,
});

/** updateV2 专用：19/28/29 不配送 + 33/34/35（与运费编辑页抓包一致） */
const UPDATE_V2_NO_SHIP_CONFIG = [19, 28, 29, 33, 34, 35].map(noShipConfigEntry);

/** updateV2：5/20/21 各 3 元首重续重（分） */
const DISPATCH_COST_ACTIVITY_UPDATE_V2 = [
  { areaList: [{ province: 5 }], firstStandard: 1, firstCost: 300, addStandard: 1, addCost: 300 },
  { areaList: [{ province: 20 }], firstStandard: 1, firstCost: 300, addStandard: 1, addCost: 300 },
  { areaList: [{ province: 21 }], firstStandard: 1, firstCost: 300, addStandard: 1, addCost: 300 },
];

/**
 * `cost_template/create` 抓包：`dispatchFree.areaList` 顺序（32 紧接在 3 后，含 19）；与 `updateV2` 包邮列表不同。
 */
const DISPATCH_FREE_PROVINCES_COST_TEMPLATE_CREATE = [
  2, 3, 32, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31,
];

/** `cost_template/create`：`dispatchCost` 仅两段，29 在前、28 在后 */
const DISPATCH_COST_COST_TEMPLATE_CREATE = [
  { areaList: [{ province: 29 }], firstStandard: 1, firstCost: 2800, addStandard: 1, addCost: 2500 },
  { areaList: [{ province: 28 }], firstStandard: 1, firstCost: 2800, addStandard: 1, addCost: 2500 },
];

const DISPATCH_FREE_AREA_LIST_ACTIVITY_UPDATE: Array<{ province: number }> = [
  { province: 2 },
  { province: 3 },
  { province: 4 },
  { province: 6 },
  { province: 7 },
  { province: 8 },
  { province: 9 },
  { province: 10 },
  { province: 11 },
  { province: 12 },
  { province: 13 },
  { province: 14 },
  { province: 15 },
  { province: 16 },
  { province: 17 },
  { province: 18 },
  { province: 22 },
  { province: 23 },
  { province: 24 },
  { province: 25 },
  { province: 26 },
  { province: 27 },
  { province: 30 },
  { province: 31 },
  { province: 32 },
];

/**
 * 构造 updateV2 请求体：与运费编辑页抓包一致（19/28/29 不配送；5/20/21 计费 3 元；包邮区不含 5/19/20/21/28/29）。
 */
export function buildCostTemplateUpdateV2Body(
  costTemplateId: number,
  costTemplateName: string
): Record<string, unknown> {
  return {
    costTemplateId,
    provinceId: 30,
    cityId: 367,
    districtId: 3106,
    costType: 0,
    costTemplateName,
    shipFromOutsideMainland: false,
    dispatchFree: {
      areaList: DISPATCH_FREE_AREA_LIST_ACTIVITY_UPDATE.map((x) => ({ ...x })),
      sfFreeType: 0,
    },
    dispatchCost: DISPATCH_COST_ACTIVITY_UPDATE_V2.map((b) => ({ ...b })),
    noShipConfig: UPDATE_V2_NO_SHIP_CONFIG.map((c) => ({ ...c })),
    templateType: 0,
    sourceKey: 'MMS',
  };
}

/**
 * `https://mms.pinduoduo.com/express_inf/cost_template/create` 请求体（与活动页抓包一致：`dispatchFree` 含 19、32 在 3 后；`dispatchCost` 仅 29+28）。
 * **活动跟单改写**（`updateV2` 等）：MAIN **检测到 enrollV2** 后先 upsert，再在 **检测后 300~500ms 内随机一刻** 发起 `updateV2`，见 `inject-enroll-hook.ts`，不在此处调用。
 */
export function buildCostTemplateCreateBody(costTemplateName: string): Record<string, unknown> {
  return {
    provinceId: 30,
    cityId: 367,
    districtId: 3106,
    costType: 0,
    costTemplateName,
    shipFromOutsideMainland: false,
    dispatchFree: {
      areaList: DISPATCH_FREE_PROVINCES_COST_TEMPLATE_CREATE.map((province) => ({ province })),
      sfFreeType: 0,
    },
    dispatchCost: DISPATCH_COST_COST_TEMPLATE_CREATE.map((b) => ({ ...b })),
    noShipConfig: NO_SHIP_CONFIG.map((c) => ({ ...c })),
    templateType: 0,
    sourceKey: 'MMS',
  };
}
