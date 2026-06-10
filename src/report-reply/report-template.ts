import { REPORT_TYPE_PEER_MALICIOUS } from './constants';

/** 默认举报文案（与接口示例一致） */
export const DEFAULT_REPORT_DESCRIBES =
  '此评价者在购买我们商品后，未与我们进行任何售后沟通，就直接给出了差评。通过我们的调查，发现该账号的购买行为和评价风格与我们的同行非常相似，且其在短时间内对多家类似店铺都给出了差评，存在明显的同行恶意竞争嫌疑。希望平台能仔细核实，还我们一个公平的竞争环境';

export function buildCreateReportBody(reviewId: string): Record<string, unknown> {
  return {
    reviewId: String(reviewId),
    reportType: REPORT_TYPE_PEER_MALICIOUS,
    pictureUrls: [],
    describes: DEFAULT_REPORT_DESCRIBES,
  };
}
