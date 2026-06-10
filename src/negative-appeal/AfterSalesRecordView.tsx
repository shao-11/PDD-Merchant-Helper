import { Descriptions, Image, Typography } from 'antd';
import type { AfterSalesListItem } from './types';

function formatYuanFromFen(fen: unknown): string {
  const n = typeof fen === 'number' && Number.isFinite(fen) ? fen : Number(fen);
  if (!Number.isFinite(n)) return '—';
  return `¥${(n / 100).toFixed(2)}（${n} 分）`;
}

function formatTime(sec: unknown): string {
  const n = typeof sec === 'number' ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n < 1e12 ? n * 1000 : n);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function detailPageUrl(item: AfterSalesListItem, fallbackOrderSn: string): string | null {
  const id = item.id;
  const sn = String(item.orderSn ?? fallbackOrderSn).trim();
  if (!id || !sn) return null;
  return `https://mms.pinduoduo.com/aftersales-ssr/detail?id=${id}&orderSn=${encodeURIComponent(sn)}`;
}

type Props = {
  items: AfterSalesListItem[];
  orderSn: string;
};

export function AfterSalesRecordView({ items, orderSn }: Props): JSX.Element {
  return (
    <div className="dtx-na-after-list">
      {items.map((a, idx) => {
        const url = detailPageUrl(a, orderSn);
        const thumb = typeof a.thumbUrl === 'string' ? a.thumbUrl : undefined;
        const shipNo =
          typeof a.orderTrackingNumber === 'string' && a.orderTrackingNumber
            ? a.orderTrackingNumber
            : undefined;
        const reverseNo =
          typeof a.reverseTrackingNumber === 'string' && a.reverseTrackingNumber
            ? a.reverseTrackingNumber
            : undefined;
        const shipStatus =
          typeof a.sellerAfterSalesShippingStatusDesc === 'string'
            ? a.sellerAfterSalesShippingStatusDesc
            : undefined;

        return (
          <div
            key={String(a.id ?? idx)}
            className="dtx-na-after-item"
            style={{
              marginBottom: idx < items.length - 1 ? 14 : 0,
              paddingBottom: idx < items.length - 1 ? 14 : 0,
              borderBottom: idx < items.length - 1 ? '1px dashed #e2e8f0' : undefined,
            }}
          >
            {thumb ? (
              <div style={{ marginBottom: 10 }}>
                <Image
                  src={thumb}
                  alt="商品"
                  width={72}
                  height={72}
                  style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid #f1f5f9' }}
                  referrerPolicy="no-referrer"
                  fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'/%3E"
                />
              </div>
            ) : null}
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="售后编号">{a.id ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="订单号">{a.orderSn ?? orderSn ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="售后类型">{a.afterSalesTypeName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="状态标题">
                <Typography.Text strong>{a.afterSalesTitle ?? '—'}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="退款金额">{formatYuanFromFen(a.refundAmount)}</Descriptions.Item>
              <Descriptions.Item label="申请原因">{a.afterSalesReasonDesc ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="商品名称">{a.goodsName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="规格">{a.goodsSpec ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="件数">{a.goodsNumber ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="发货状态">{shipStatus ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="发货快递单号">{shipNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="退货快递单号">{reverseNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="申请时间">{formatTime(a.createdAt)}</Descriptions.Item>
              {url ? (
                <Descriptions.Item label="后台详情">
                  <Typography.Link href={url} target="_blank" rel="noreferrer">
                    打开售后详情页
                  </Typography.Link>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </div>
        );
      })}
    </div>
  );
}
