import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Spin } from 'antd';
import { getValidAuthSession } from '../auth/local-auth';
import { STORAGE_AUTH_SESSION } from '../auth/storage-keys';
import { LoginPage } from './pages/LoginPage';
import './styles/login.css';

type AuthPhase = 'loading' | 'authed' | 'guest';

type PopupAuthGateProps = {
  children: ReactNode;
};

/** 弹窗 / 独立标签页：校验本地登录会话（30 天），未登录则展示登录页 */
export function PopupAuthGate({ children }: PopupAuthGateProps): JSX.Element {
  const [phase, setPhase] = useState<AuthPhase>('loading');

  const refresh = useCallback(() => {
    void getValidAuthSession().then((session) => {
      setPhase(session ? 'authed' : 'guest');
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_AUTH_SESSION]) return;
      refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  if (phase === 'loading') {
    return (
      <div className="dtx-login__loading" aria-busy="true" aria-label="正在检查登录状态">
        <Spin size="large" />
      </div>
    );
  }

  if (phase === 'guest') {
    return <LoginPage onSuccess={() => setPhase('authed')} />;
  }

  return <>{children}</>;
}
