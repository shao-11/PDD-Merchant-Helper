import { useState } from 'react';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Flex, Form, Input, Typography } from 'antd';
import { AUTH_SESSION_TTL_MS, loginWithCredentials } from '../../auth/local-auth';
import '../styles/login.css';

const logoUrl = chrome.runtime.getURL('logo.png');

type LoginFormValues = {
  username: string;
  password: string;
};

type LoginPageProps = {
  onSuccess: () => void;
};

export function LoginPage({ onSuccess }: LoginPageProps): JSX.Element {
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<LoginFormValues>();

  const handleFinish = async (values: LoginFormValues): Promise<void> => {
    setSubmitting(true);
    try {
      const ok = await loginWithCredentials(values.username, values.password);
      if (!ok) {
        void message.error('登录失败');
        return;
      }
      void message.success('登录成功');
      onSuccess();
    } catch (e) {
      void message.error("登录失败：${e instanceof Error ? e.message : String(e)}");
    } finally {
      setSubmitting(false);
    }
  };

  const sessionDays = Math.round(AUTH_SESSION_TTL_MS / (24 * 60 * 60 * 1000));

  return (
    <div className="dtx-login" role="application" aria-label="PDD Merchant Helper Login">
      <div className="dtx-login__shell">
        <header className="dtx-login__top">
          <Flex align="center" gap={14} className="dtx-login__brand">
            <img className="dtx-login__logo" src={logoUrl} alt="PDD Helper" />
            <div>
              <Typography.Title level={5} className="dtx-login__title">
                PDD Merchant Helper
              </Typography.Title>
              <Typography.Text type="secondary" className="dtx-login__subtitle">
                Extension Manager · Please Log In
              </Typography.Text>
            </div>
          </Flex>
        </header>

        <main className="dtx-login__main">
          <div className="dtx-login__card">
            <Typography.Title level={5} className="dtx-login__card-title">
              账号登录
            </Typography.Title>
            <Typography.Text type="secondary" className="dtx-login__card-hint">
              Login valid for {sessionDays} days (saved locally on this browser)
            </Typography.Text>

            <Form<LoginFormValues>
              form={form}
              layout="vertical"
              className="dtx-login__form"
              initialValues={{ username: '' }}
              onFinish={(v) => void handleFinish(v)}
              autoComplete="off"
            >
              <Form.Item
                name="username"
                label="账号"
                rules={[{ required: true, message: '请输入账号' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="请输入账号" allowClear />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 12 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={submitting}
                  className="dtx-login__submit"
                >
                  登录
                </Button>
              </Form.Item>
            </Form>
          </div>
        </main>

        <footer className="dtx-login__footer">
          <Typography.Text type="secondary" className="dtx-login__footer-text">
            Open Source Pinduoduo Merchant Tool
          </Typography.Text>
        </footer>
      </div>
    </div>
  );
}
