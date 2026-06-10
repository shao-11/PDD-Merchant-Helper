/**
 * 订单聊天记录：支持气泡式（评价分析）与 MMS 官方列表式（负向申诉截图）
 */
import type { CSSProperties, ReactElement } from 'react';
import { Avatar } from 'antd';
import { CustomerServiceOutlined, InfoCircleOutlined, SoundOutlined, UserOutlined } from '@ant-design/icons';
import type { ChatHistoryRow } from '../utils/chat-history-parse';
import { isLikelyChatImageUrl, isPlatformSystemChatContent } from '../utils/chat-history-parse';
import mmsChatCss from './chat-history-mms.css?raw';

export type ChatHistoryLayout = 'bubble' | 'mms';

type BubbleSide = 'buyer' | 'staff' | 'system';

function classifyBubble(roleLabel: string, content: string): BubbleSide {
  if (roleLabel === '系统' || isPlatformSystemChatContent(content)) {
    return 'system';
  }
  if (roleLabel === '客服') return 'staff';
  if (roleLabel === '买家') return 'buyer';
  if (/客服|mall_cs/i.test(roleLabel)) return 'staff';
  if (/买家|^user$/i.test(roleLabel)) return 'buyer';
  return 'buyer';
}

function displaySenderName(
  side: BubbleSide,
  roleLabel: string,
  senderDisplayName?: string,
): string {
  if (side === 'system') return '系统消息';
  if (senderDisplayName) return senderDisplayName;
  if (side === 'staff') return roleLabel && roleLabel !== '客服' ? roleLabel : '商家客服';
  return '消费者';
}

const shell: CSSProperties = {
  padding: '12px 10px',
  borderRadius: 12,
  maxWidth: 'min(78%, 420px)',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
  fontSize: 14,
  lineHeight: 1.55,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
};

const CHAT_IMAGE_URL_RE =
  /https?:\/\/(?:chat-img[^\s<>"']+|[^\s<>"']+\.(?:jpe?g|png|gif|webp|bmp)(?:\?[^\s<>"']*)?|[^\s<>"']*(?:pddpic|yangkeduo|savatar|commimg|funimg)[^\s<>"']*)/gi;

function isStandaloneImageUrl(text: string): boolean {
  return isLikelyChatImageUrl(text.trim());
}

function ChatImage({ src, className }: { src: string; className?: string }): ReactElement {
  return (
    <img
      src={src}
      alt="聊天图片"
      className={className}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      style={
        className
          ? undefined
          : {
              display: 'block',
              maxWidth: '100%',
              maxHeight: 280,
              borderRadius: 8,
              objectFit: 'contain',
              background: '#fafafa',
            }
      }
      onError={(e) => {
        const el = e.currentTarget;
        el.style.display = 'none';
        const fb = el.nextElementSibling;
        if (fb instanceof HTMLElement) fb.style.display = 'block';
      }}
    />
  );
}

function BubbleContent({
  content,
  imageUrl,
  imageClassName,
  skipRemoteImages,
}: {
  content: string;
  imageUrl?: string;
  imageClassName?: string;
  skipRemoteImages?: boolean;
}): ReactElement {
  const trimmed = content.trim();
  const resolvedImage = imageUrl || (isStandaloneImageUrl(trimmed) ? trimmed : undefined);

  if (resolvedImage && (trimmed === '[图片]' || trimmed === '图片' || isStandaloneImageUrl(trimmed))) {
    if (skipRemoteImages) {
      return <span style={{ color: '#64748b', fontSize: 12 }}>[图片]</span>;
    }
    return (
      <span>
        <ChatImage src={resolvedImage} className={imageClassName} />
        <span style={{ display: 'none', fontSize: 12, color: '#64748b', wordBreak: 'break-all' }}>
          图片加载失败：{resolvedImage}
        </span>
      </span>
    );
  }

  if (skipRemoteImages && isStandaloneImageUrl(trimmed)) {
    return <span style={{ color: '#64748b', fontSize: 12 }}>[图片]</span>;
  }
  if (isStandaloneImageUrl(trimmed)) {
    return (
      <span>
        <ChatImage src={trimmed} className={imageClassName} />
        <span style={{ display: 'none', fontSize: 12, color: '#64748b', wordBreak: 'break-all' }}>
          图片加载失败：{trimmed}
        </span>
      </span>
    );
  }

  const parts: ReactElement[] = [];
  let last = 0;
  const re = new RegExp(CHAT_IMAGE_URL_RE.source, CHAT_IMAGE_URL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const url = match[0];
    const start = match.index;
    if (start > last) {
      const text = content.slice(last, start);
      if (text) parts.push(<span key={`t-${last}`}>{text}</span>);
    }
    if (skipRemoteImages) {
      parts.push(
        <span key={`img-${start}`} style={{ color: '#64748b', fontSize: 12 }}>
          [图片]
        </span>,
      );
      last = start + url.length;
      continue;
    }
    parts.push(
      <span key={`img-${start}`} style={{ display: 'block', margin: imageClassName ? '4px 0' : '6px 0' }}>
        <ChatImage src={url} className={imageClassName} />
        <span style={{ display: 'none', fontSize: 12, color: '#64748b', wordBreak: 'break-all' }}>
          图片加载失败：{url}
        </span>
      </span>,
    );
    last = start + url.length;
  }
  if (parts.length === 0) {
    return <>{content}</>;
  }
  if (last < content.length) {
    parts.push(<span key={`t-${last}`}>{content.slice(last)}</span>);
  }
  return <>{parts}</>;
}

function MmsChatAvatar({ side, avatarUrl }: { side: BubbleSide; avatarUrl?: string }): ReactElement {
  if (side === 'system') {
    return (
      <div className="dtx-mms-chat__avatar dtx-mms-chat__avatar--system">
        <SoundOutlined />
      </div>
    );
  }
  const cls =
    side === 'staff' ? 'dtx-mms-chat__avatar dtx-mms-chat__avatar--staff' : 'dtx-mms-chat__avatar dtx-mms-chat__avatar--buyer';
  if (avatarUrl) {
    return (
      <div className={cls}>
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" />
      </div>
    );
  }
  const iconStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#fff',
  };
  return (
    <div className={cls}>
      <span style={{ ...iconStyle, background: side === 'staff' ? '#52c41a' : '#e891a8' }}>
        {side === 'staff' ? <CustomerServiceOutlined /> : <UserOutlined />}
      </span>
    </div>
  );
}

function ChatHistoryMmsList({
  rows,
  skipRemoteImages,
}: {
  rows: ChatHistoryRow[];
  skipRemoteImages?: boolean;
}): ReactElement {
  return (
    <div className="dtx-mms-chat">
      <style>{mmsChatCss}</style>
      <div className="dtx-mms-chat__title">聊天记录</div>
      <div className="dtx-mms-chat__list">
        {rows.map((row, i) => {
          const side = classifyBubble(row.roleLabel, row.content);
          const rowCls =
            side === 'system' ? 'dtx-mms-chat__row dtx-mms-chat__row--system' : 'dtx-mms-chat__row';
          return (
            <div key={`${row.tsLabel}-${i}`} className={rowCls}>
              <div className="dtx-mms-chat__head">
                <MmsChatAvatar side={side} avatarUrl={row.avatarUrl} />
                <span className="dtx-mms-chat__name">
                  {displaySenderName(side, row.roleLabel, row.senderDisplayName)}
                </span>
                <span className="dtx-mms-chat__time">{row.tsLabel}</span>
              </div>
              <div className="dtx-mms-chat__body">
                <BubbleContent
                  content={row.content}
                  imageUrl={row.imageUrl}
                  imageClassName="dtx-mms-chat__img"
                  skipRemoteImages={skipRemoteImages}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatHistoryBubbleList({ rows }: { rows: ChatHistoryRow[] }): ReactElement {
  return (
    <div
      style={{
        padding: '4px 0 8px',
        background: 'var(--ant-color-fill-alter, #f5f5f5)',
        borderRadius: 12,
        minHeight: 120,
      }}
    >
      {rows.map((row, i) => {
        const side = classifyBubble(row.roleLabel, row.content);
        const timeLine = `${row.tsLabel}${row.roleLabel && row.roleLabel !== '—' ? ` · ${row.roleLabel}` : ''}`;

        if (side === 'system') {
          return (
            <div key={`${row.tsLabel}-${i}`} style={{ marginBottom: 14, padding: '0 12px' }}>
              <div style={{ margin: '0 auto', maxWidth: '92%', textAlign: 'center' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    background: 'rgba(0,0,0,0.04)',
                    color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.65))',
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <InfoCircleOutlined style={{ flexShrink: 0, opacity: 0.75 }} />
                  <span>
                    <BubbleContent content={row.content} imageUrl={row.imageUrl} />
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--ant-color-text-quaternary, rgba(0,0,0,0.45))',
                  }}
                >
                  {timeLine}
                </div>
              </div>
            </div>
          );
        }

        const isStaff = side === 'staff';
        return (
          <div
            key={`${row.tsLabel}-${i}`}
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: isStaff ? 'flex-start' : 'flex-end',
              alignItems: 'flex-end',
              gap: 8,
              marginBottom: 12,
              padding: '0 10px',
            }}
          >
            {isStaff ? (
              <Avatar
                size={36}
                src={row.avatarUrl}
                style={{
                  flexShrink: 0,
                  ...(row.avatarUrl ? {} : { backgroundColor: 'var(--ant-color-primary, #1677ff)' }),
                }}
                icon={<CustomerServiceOutlined />}
              />
            ) : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isStaff ? 'flex-start' : 'flex-end',
                maxWidth: 'calc(100% - 48px)',
              }}
            >
              <div
                style={{
                  ...shell,
                  background: isStaff
                    ? 'var(--ant-color-bg-container, #fff)'
                    : 'var(--ant-color-primary-bg, #e6f4ff)',
                  border: isStaff ? '1px solid var(--ant-color-border-secondary, #f0f0f0)' : 'none',
                  color: 'var(--ant-color-text, rgba(0,0,0,0.88))',
                }}
              >
                <BubbleContent content={row.content} imageUrl={row.imageUrl} />
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: 'var(--ant-color-text-quaternary, rgba(0,0,0,0.45))',
                  paddingLeft: isStaff ? 2 : 0,
                  paddingRight: isStaff ? 0 : 2,
                }}
              >
                {timeLine}
              </div>
            </div>
            {!isStaff ? (
              <Avatar
                size={36}
                src={row.avatarUrl}
                style={{
                  flexShrink: 0,
                  ...(row.avatarUrl ? {} : { backgroundColor: 'var(--ant-color-success, #52c41a)' }),
                }}
                icon={<UserOutlined />}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ChatHistoryThread({
  rows,
  layout = 'bubble',
  skipRemoteImages,
}: {
  rows: ChatHistoryRow[];
  layout?: ChatHistoryLayout;
  /** 自动填入截图时避免加载聊天外链图（防止 Network 出现 invalid） */
  skipRemoteImages?: boolean;
}): ReactElement {
  if (layout === 'mms') {
    return <ChatHistoryMmsList rows={rows} skipRemoteImages={skipRemoteImages} />;
  }
  return <ChatHistoryBubbleList rows={rows} />;
}
