import { LogoutOutlined } from '@ant-design/icons';
import { App, Typography } from 'antd';
import { clearAuthSession } from '../../auth/local-auth';

type LogoutLinkProps = {
  className?: string;
};

/** 清除本地登录会话；PopupAuthGate / content 脚本会随 storage 变化自动切换 */
export function LogoutLink({ className }: LogoutLinkProps): JSX.Element {
  const { message } = App.useApp();

  const handleLogout = (): void => {
    void clearAuthSession()
      .then(() => {
        void message.success('已退出登录');
      })
      .catch((e) => {
        void message.error(`退出失败：${e instanceof Error ? e.message : String(e)}`);
      });
  };

  return (
    <Typography.Link
      className={className}
      onClick={handleLogout}
      aria-label="退出登录"
      title="退出登录"
    >
      <LogoutOutlined /> 退出登录
    </Typography.Link>
  );
}
