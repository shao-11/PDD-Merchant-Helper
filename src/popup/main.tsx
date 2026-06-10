import '../dev/chrome-dev-shim';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import { App } from './App';
import { PopupAuthGate } from './PopupAuthGate';

const needsAuthGate =
  typeof window !== 'undefined' &&
  (window.location.pathname.endsWith('popup.html') || window.location.pathname.endsWith('panel.html'));

const embed =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('embed') === '1';
if (embed) {
  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.body.style.margin = '0';
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root 不存在');
}
if (embed) {
  rootEl.style.height = '100%';
}

createRoot(rootEl).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorLink: '#1677ff',
          colorBgLayout: '#f5f8ff',
          colorBgContainer: '#ffffff',
          borderRadius: 10,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Layout: {
            headerBg: 'transparent',
            bodyBg: '#ffffff',
            footerBg: '#f7faff',
          },
          Tabs: {
            inkBarColor: 'transparent',
            itemColor: 'rgba(255, 255, 255, 0.88)',
            itemSelectedColor: '#1677ff',
            itemHoverColor: '#ffffff',
          },
          Button: {
            colorLink: '#1677ff',
            colorLinkHover: '#4096ff',
          },
        },
      }}
    >
      <AntApp>
        {needsAuthGate ? (
          <PopupAuthGate>
            <App />
          </PopupAuthGate>
        ) : (
          <App />
        )}
      </AntApp>
    </ConfigProvider>
  </StrictMode>
);
