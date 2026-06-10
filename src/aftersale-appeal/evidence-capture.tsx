import React, { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import resetCssText from 'antd/dist/reset.css';
import { AftersaleRecordCaptureView, AFTERSALE_RECORD_CAPTURE_WIDTH } from './AftersaleRecordCaptureView';
import { buildAftersaleRecordDisplay } from './aftersale-record-model';
import { captureElementToBlob, waitForRemoteImages } from '../negative-appeal/capture-screenshot';
import { ChatHistoryThread } from '../popup/ChatHistoryThread';
import type { AftersaleAppealSnapshot } from './types';

const CAPTURE_SHELL_STYLE =
  'position:fixed;left:-9999px;top:0;z-index:-1;pointer-events:none;background:#fff;box-sizing:border-box;';

async function mountCaptureHost(widthPx: number): Promise<{
  host: HTMLDivElement;
  root: Root;
  dispose: () => void;
}> {
  const host = document.createElement('div');
  host.style.cssText = `${CAPTURE_SHELL_STYLE}width:${widthPx}px;`;
  const style = document.createElement('style');
  style.textContent = resetCssText;
  host.appendChild(style);
  const mount = document.createElement('div');
  host.appendChild(mount);
  document.body.appendChild(host);
  const root = createRoot(mount);
  return {
    host,
    root,
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}

async function waitPaint(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  await new Promise((r) => setTimeout(r, 520));
}

export async function captureAftersaleRecordFile(
  snapshot: AftersaleAppealSnapshot,
): Promise<File> {
  const data = buildAftersaleRecordDisplay(snapshot);
  if (!data) throw new Error('无售后记录，无法生成「退款申请单」截图');

  const { host, root, dispose } = await mountCaptureHost(AFTERSALE_RECORD_CAPTURE_WIDTH);
  try {
    root.render(
      <StrictMode>
        <ConfigProvider locale={zhCN}>
          <AftersaleRecordCaptureView data={data} />
        </ConfigProvider>
      </StrictMode>,
    );
    await waitPaint();
    await waitForRemoteImages(host);
    const blob = await captureElementToBlob(host);
    if (!blob.size) throw new Error('售后记录截图为空');
    return new File([blob], `售后记录-${snapshot.orderSn}.png`, { type: 'image/png' });
  } finally {
    dispose();
  }
}

export async function captureChatRecordFile(
  snapshot: AftersaleAppealSnapshot,
): Promise<File> {
  if (!snapshot.chatRows.length) throw new Error('无聊天记录，无法生成聊天截图');

  const { host, root, dispose } = await mountCaptureHost(520);
  try {
    root.render(
      <StrictMode>
        <ChatHistoryThread rows={snapshot.chatRows} layout="mms" />
      </StrictMode>,
    );
    await waitPaint();
    await waitForRemoteImages(host);
    const blob = await captureElementToBlob(host);
    if (!blob.size) throw new Error('聊天截图为空');
    return new File([blob], `聊天-${snapshot.orderSn}.png`, { type: 'image/png' });
  } finally {
    dispose();
  }
}
