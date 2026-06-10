# -*- coding: utf-8 -*-
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/aftersale-appeal/AftersaleRecordCaptureView.tsx"

T = {
    "title": "\u9000\u6b3e\u7533\u8bf7\u5355",
    "afterId": "\u552e\u540e\u7f16\u7801",
    "afterType": "\u552e\u540e\u7c7b\u578b",
    "shipStatus": "\u53d1\u8d27\u72b6\u6001",
    "refundAmt": "\u9000\u6b3e\u91d1\u989d",
    "reason": "\u7533\u8bf7\u539f\u56e0",
    "logistics": "\u7269\u6d41\u516c\u53f8",
    "trackNo": "\u7269\u6d41\u5355\u53f7",
    "chatImages": "\u6d88\u8d39\u8005\u4e0e\u5546\u5bb6\u804a\u5929\u65f6\u53d1\u9001\u7684\u56fe\u7247\uff1a",
    "orderSn": "\u8ba2\u5355\u7f16\u53f7",
    "copy": "\u590d\u5236",
    "groupTime": "\u6210\u56e2\u65f6\u95f4",
    "confirmTime": "\u8ba2\u5355\u786e\u8ba4\u65f6\u95f4",
    "returnFreight": "\u9000\u8d27\u5305\u8fd0\u8d39",
    "shipInfo": "\u6536\u8d27\u4fe1\u606f",
    "recipient": "\u6536\u8d27\u4eba",
    "phone": "\u624b\u673a\u53f7",
    "address": "\u8054\u7cfb\u5730\u5740",
    "viewPhone": "\u67e5\u770b\u624b\u673a\u53f7",
    "viewAddress": "\u67e5\u770b\u59d3\u540d\u548c\u5730\u5740",
    "warn": "\u4e3a\u4fdd\u62a4\u6d88\u8d39\u8005\u9690\u79c1\uff0c\u6536\u8d27\u4eba\u59d3\u540d\u548c\u5730\u5740\u5df2\u505a\u8131\u654f\u5904\u7406\uff0c\u5982\u9700\u67e5\u770b\u5b8c\u6574\u4fe1\u606f\uff0c\u8bf7\u70b9\u51fb\u4e0b\u65b9\u94fe\u63a5",
    "goodsUnit": "\u4ef6\u5546\u54c1",
    "discount": "\u4f18\u60e0\uff1a",
    "receive": "\u5b9e\u6536\uff1a",
    "yuan": "\u5143",
    "freeShip": "(\u514d\u8fd0\u8d39)",
    "goodsPrefix": "\u5171",
}

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")

parts: list[str] = []

parts.append(
    """import type { ReactNode } from 'react';
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
const DASH = '\\u2014';

const T = {
"""
)

for k, v in T.items():
    parts.append(f"  {k}: '{esc(v)}',\n")

parts.append(
    """} as const;

function labelText(text: string): string {
  return text.endsWith('\\uFF1A') || text.endsWith(':') ? text : `${text}\\uFF1A`;
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
    <__TAG__
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: `${ROW_PADDING_Y}px 0`,
        fontSize: 14,
        lineHeight: `${ROW_LINE_HEIGHT}px`,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <__TAG__ style={{ width: LABEL_WIDTH, flexShrink: 0, color: LABEL_COLOR }}>{labelText(label)}</__TAG__>
      <__TAG__
        style={{
          flex: 1,
          color: valueColor ?? (highlight ? RED : TEXT),
          wordBreak: 'break-all',
        }}
      >
        {children}
      </__TAG__>
    </__TAG__>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <__TAG__
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '6px 0',
        fontSize: 14,
        lineHeight: `${ROW_LINE_HEIGHT}px`,
      }}
    >
      <__TAG__ style={{ width: LABEL_WIDTH, flexShrink: 0, color: LABEL_COLOR }}>{labelText(label)}</__TAG__>
      <__TAG__ style={{ flex: 1, color: TEXT, wordBreak: 'break-all' }}>{children}</__TAG__>
    </__TAG__>
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
    <__TAG__
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
    </__TAG__>
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
    <__TAG__
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

      <__TAG__
        style={{
          position: 'relative',
          zIndex: 1,
          width: AFTERSALE_RECORD_CARD_WIDTH,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}
      >
        <__TAG__
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
        </__TAG__>

        <__TAG__ style={{ padding: `0 ${BODY_PADDING_X}px` }}>
          <Row label={T.afterId}>{data.afterSalesId}</Row>
          <Row label={T.afterType} highlight>{data.afterSalesType}</Row>
          <Row label={T.shipStatus} highlight>{data.shippingStatus}</Row>
          <Row label={T.refundAmt} highlight>{data.refundAmountYuan}</Row>
          <Row label={T.reason} highlight>{data.reason}</Row>
          <Row label={T.logistics}>{data.logisticsCompany}</Row>
          <Row label={T.trackNo}>{data.trackingNumber}</Row>

          <__TAG__
            style={{
              padding: `${ROW_PADDING_Y}px 0`,
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <__TAG__
              style={{
                fontSize: 14,
                lineHeight: `${ROW_LINE_HEIGHT}px`,
                color: TEXT,
                marginBottom: 10,
              }}
            >
              {T.chatImages}
            </__TAG__>
            <__TAG__ style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
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
            </__TAG__>
          </__TAG__>

          <__TAG__ style={{ margin: '14px 0', borderTop: '1px dashed #d9d9d9' }} />

          <Row label={T.orderSn} valueColor={LINK}>
            {data.orderSn}
            <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.copy}</span>
          </Row>
          <Row label={T.groupTime}>{data.groupTime}</Row>
          <Row label={T.confirmTime}>{data.confirmTime}</Row>
          <Row label={T.returnFreight}>{data.returnFreightInsurance}</Row>

          <__TAG__
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
              <__TAG__
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
            <__TAG__ style={{ flex: 1, minWidth: 0 }}>
              <__TAG__
                style={{
                  fontSize: 14,
                  lineHeight: '20px',
                  marginBottom: 4,
                  wordBreak: 'break-all',
                  color: TEXT,
                }}
              >
                {data.productName || DASH}
              </__TAG__>
              {data.productSpec ? (
                <__TAG__ style={{ fontSize: 13, color: SPEC_COLOR, lineHeight: '20px', marginBottom: 8 }}>
                  {data.productSpec}
                </__TAG__>
              ) : null}
              <__TAG__
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
                      {T.discount}{data.discountYuan === DASH ? DASH : `${data.discountYuan}${T.yuan}`} {T.receive}{data.receiveAmountYuan === DASH ? DASH : `\\u00A5${data.receiveAmountYuan}`}
                      {data.freeShipping ? T.freeShip : ''}
                    </>
                  ) : (
                    DASH
                  )}
                </span>
              </__TAG__>
            </__TAG__>
          </__TAG__>

          <__TAG__ style={{ marginTop: 16, marginBottom: 10, fontSize: 14, fontWeight: 600, color: TEXT }}>
            {T.shipInfo}
          </__TAG__>

          <__TAG__
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
          </__TAG__>

          <__TAG__
            style={{
              position: 'relative',
              background: RECIPIENT_BG,
              padding: '10px 16px 10px 0',
              borderRadius: 2,
              marginBottom: 20,
            }}
          >
            <__TAG__
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
            </__TAG__>
            <InfoRow label={T.recipient}>{data.recipientName}</InfoRow>
            <InfoRow label={T.phone}>
              {data.recipientPhone}
              <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.viewPhone}</span>
            </InfoRow>
            <InfoRow label={T.address}>
              {data.recipientAddress}
              <span style={{ marginLeft: 8, color: LINK, fontSize: 14 }}>{T.viewAddress}</span>
            </InfoRow>
          </__TAG__>
        </__TAG__>
      </__TAG__>
    </__TAG__>
  );
}
"""
)

content = "".join(parts).replace("__TAG__", "div")
OUT.write_text(content, encoding="utf-8")
print("written", OUT, "bytes", OUT.stat().st_size)
