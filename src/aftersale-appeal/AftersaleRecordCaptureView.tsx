import type { ReactNode } from 'react';
import type { AftersaleRecordDisplay } from './aftersale-record-model';

export const AFTERSALE_RECORD_PAGE_WIDTH = 920;
export const AFTERSALE_RECORD_CARD_WIDTH = 520;
export const AFTERSALE_RECORD_CAPTURE_WIDTH = AFTERSALE_RECORD_PAGE_WIDTH;

const LABEL_WIDTH = 100;
const BODY_PADDING_X = 28;
const ROW_PADDING_Y = 12;
const ROW_LINE_HEIGHT = 24;

const RED = '#ff4d4f';
const LABEL_COLOR = 'rgba(0,0,0,0.65)';
const TEXT = 'rgba(0,0,0,0.85)';
const BORDER = '#f0f0f0';
const PAGE_BG = '#f0f2f5';
const HEADER_BG = '#f5f7fa';
const WARN_BG = '#fffbe6';
const WARN_BORDER = '#ffe58f';
const WARN_TEXT = '#d48806';
const LINK = '#1890ff';
const RECIPIENT_BG = '#fafafa';
const SPEC_COLOR = 'rgba(0,0,0,0.45)';
const PRODUCT_BG = '#fafafa';
const DASH = '\u2014';

const T = {
  title: '退款申请单',
  afterId: '售后编码',
  afterType: '售后类型',
  shipStatus: '发货状态',
  refundAmt: '退款金额',
  reason: '申请原因',
  logistics: '物流公司',
  trackNo: '物流单号',
  chatImages: '消费者与商家聊天时发送的图片：',
  orderSn: '订单编号',
  copy: '复制',
  groupTime: '成团时间',
  confirmTime: '订单确认时间',
  returnFreight: '退货包运费',
  shipInfo: '收货信息',
  recipient: '收货人',
  phone: '手机号',
  address: '联系地址',
  viewPhone: '查看手机号',
  viewAddress: '查看姓名和地址',
  warn: '为保护消费者隐私，收货人姓名和地址已做脱敏处理，如需查看完整信息，请点击下方链接',
  goodsUnit: '件商品',
  discount: '优惠：',
  receive: '实收：',
  yuan: '元',
  freeShip: '(免运费)',
  goodsPrefix: '共',
} as const;

function labelText(text: string): string {
  return text.endsWith('\uFF1A') || text.endsWith(':') ? text : `${text}\uFF1A`;
}

function Row({
  label,
  children,
  highlight,
  valueColor,
}: {
  label: string;
  children: ReactNode;
  highlight?: boolean;
  valueColor?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: `${ROW_PADDING_Y}px 0`,
        fontSize: 14,
        lineHeight: `${ROW_LINE_HEIGHT}px`,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <div style={{ width: LABEL_WIDTH, flexShrink: 0, color: LABEL_COLOR }}>{labelText(label)}</div>
      <div
        style={{
          flex: 1,
          color: valueColor ?? (highlight ? RED : TEXT),
          wordBreak: 'break-all',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '6px 0',
        fontSize: 14,
        lineHeight: `${ROW_LINE_HEIGHT}px`,
      }}
    >
      <div style={{ width: LABEL_WIDTH, flexShrink: 0, color: LABEL_COLOR }}>{labelText(label)}</div>
      <div style={{ flex: 1, color: TEXT, wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

function Watermark({ text }: { text: string }): JSX.Element | null {
  if (!text) return null;
  const tiles: { top: string; left: string }[] = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 5; c++) {
      tiles.push({
        top: `${r * 11 + 2}%`,
        left: `${c * 22 - 4 + (r % 2) * 8}%`,
      });
    }
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {tiles.map((p, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: p.top,
            left: p.left,
            transform: 'rotate(-24deg)',
            fontSize: 20,
            color: 'rgba(0,0,0,0.045)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

function WarnIcon(): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#faad14',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        flexShrink: 0,
        marginRight: 6,
        lineHeight: 1,
      }}
    >
      !
    </span>
  );
}

type Props = {
  data: AftersaleRecordDisplay;
};

export function AftersaleRecordCaptureView({ data }: Props): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        width: AFTERSALE_RECORD_PAGE_WIDTH,
        background: PAGE_BG,
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        color: TEXT,
        fontSize: 14,
        boxSizing: 'border-box',
        padding: '20px 0 28px',
      }}
    >
      <Watermark text={data.shopWatermark} />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: AFTERSALE_RECORD_CARD_WIDTH,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}
      >
        <div
          style={{
            background: HEADER_BG,
            padding: '14px 28px',
            fontSize: 16,
            fontWeight: 600,
            color: TEXT,
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {T.title}
        </div>

        <div style={{ padding: `0 ${BODY_PADDING_X}px` }}>
          <Row label={T.afterId}>{data.afterSalesId}</Row>
          <Row label={T.afterType} highlight>{data.afterSalesType}</Row>
          <Row label={T.shipStatus} highlight>{data.shippingStatus}</Row>
          <Row label={T.refundAmt} highlight>{data.refundAmountYuan}</Row>
          <Row label={T.reason} highlight>{data.reason}</Row>
          <Row label={T.logistics}>{data.logisticsCompany}</Row>
          <Row label={T.trackNo}>{data.trackingNumber}</Row>

          <div
            style={{
              padding: `${ROW_PADDING_Y}px 0`,
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                fontSize: 14,
                lineHeight: `${ROW_LINE_HEIGHT}px`,
                color: TEXT,
                marginBottom: 10,
              }}
            >
              {T.chatImages}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {data.chatImageUrls.length ? (
                data.chatImageUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    referrerPolicy="no-referrer"
                    style={{
                      width: 52,
                      height: 52,
                      objectFit: 'cover',
                      borderRadius: 2,
                      border: `1px solid ${BORDER}`,
                      background: '#f5f5f5',
                    }}
                  />
                ))
              ) : (
                <span style={{ color: TEXT }}>{DASH}</span>
              )}
            </div>
          </div>

          <div style={{ margin: '14px 0', borderTop: '1px dashed #d9d9d9' }} />

          <Row label={T.orderSn} valueColor={LINK}>
            {data.orderSn}
            <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.copy}</span>
          </Row>
          <Row label={T.groupTime}>{data.groupTime}</Row>
          <Row label={T.confirmTime}>{data.confirmTime}</Row>
          <Row label={T.returnFreight}>{data.returnFreightInsurance}</Row>

          <div
            style={{
              margin: '14px 0 16px',
              padding: 12,
              border: `1px solid ${BORDER}`,
              borderRadius: 2,
              display: 'flex',
              gap: 12,
              background: PRODUCT_BG,
            }}
          >
            {data.productThumb ? (
              <img
                src={data.productThumb}
                alt=""
                referrerPolicy="no-referrer"
                style={{
                  width: 52,
                  height: 52,
                  objectFit: 'cover',
                  borderRadius: 2,
                  border: `1px solid ${BORDER}`,
                  flexShrink: 0,
                  background: '#f5f5f5',
                }}
              />
            ) : (
              <div
                style={{
                  width: 52,
                  height: 52,
                  background: '#f5f5f5',
                  borderRadius: 2,
                  border: `1px solid ${BORDER}`,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: '20px',
                  marginBottom: 4,
                  wordBreak: 'break-all',
                  color: TEXT,
                }}
              >
                {data.productName || DASH}
              </div>
              {data.productSpec ? (
                <div style={{ fontSize: 13, color: SPEC_COLOR, lineHeight: '20px', marginBottom: 8 }}>
                  {data.productSpec}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                  color: SPEC_COLOR,
                  lineHeight: '20px',
                }}
              >
                <span>{`${T.goodsPrefix}${data.goodsNumber || DASH}${T.goodsUnit}`}</span>
                <span>
                  {data.discountYuan !== DASH || data.receiveAmountYuan !== DASH ? (
                    <>
                      {T.discount}{data.discountYuan === DASH ? DASH : `${data.discountYuan}${T.yuan}`} {T.receive}{data.receiveAmountYuan === DASH ? DASH : `\u00A5${data.receiveAmountYuan}`}
                      {data.freeShipping ? T.freeShip : ''}
                    </>
                  ) : (
                    DASH
                  )}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, marginBottom: 10, fontSize: 14, fontWeight: 600, color: TEXT }}>
            {T.shipInfo}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '8px 12px',
              background: WARN_BG,
              border: `1px solid ${WARN_BORDER}`,
              borderRadius: 2,
              fontSize: 12,
              lineHeight: '20px',
              color: WARN_TEXT,
              marginBottom: 12,
            }}
          >
            <WarnIcon />
            <span>{T.warn}</span>
          </div>

          <div
            style={{
              position: 'relative',
              background: RECIPIENT_BG,
              padding: '10px 16px 10px 0',
              borderRadius: 2,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 10,
                padding: '2px 12px',
                fontSize: 14,
                color: TEXT,
                background: '#fff',
                border: '1px solid #d9d9d9',
                borderRadius: 2,
                lineHeight: '22px',
              }}
            >
              {T.copy}
            </div>
            <InfoRow label={T.recipient}>{data.recipientName}</InfoRow>
            <InfoRow label={T.phone}>
              {data.recipientPhone}
              <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.viewPhone}</span>
            </InfoRow>
            <InfoRow label={T.address}>
              {data.recipientAddress}
              <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.viewAddress}</span>
            </InfoRow>
          </div>
        </div>
      </div>
    </div>
  );
}
