import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircleFilled,
  CloudSyncOutlined,
  ExclamationCircleFilled,
  ReloadOutlined,
  ShoppingTwoTone,
} from '@ant-design/icons';
import { Button, Typography, message } from 'antd';
import { FEINIU_SHARE_PAGE_URL } from '../../negative-appeal/feiniu-share-constants';
import { MSG_FEINIU_OPEN_AND_SYNC } from '../../negative-appeal/feiniu-share-messages';
import {
  formatCatalogAge,
  getQcSheetCatalogStatus,
} from '../../negative-appeal/qc-sheet-storage';

const AFTERSALE_APPEAL_LIST_URL = 'https://mms.pinduoduo.com/orders/appeals/aftersale/order?';

export function AftersaleAppealHelpPanel(): JSX.Element {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getQcSheetCatalogStatus>> | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatus(await getQcSheetCatalogStatus());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleOpenAndSync = (): void => {
    setSyncing(true);
    void message.loading('后台打开飞牛页并同步中…', 0);
    chrome.runtime.sendMessage({ type: MSG_FEINIU_OPEN_AND_SYNC }, (res) => {
      message.destroy();
      setSyncing(false);
      if (chrome.runtime.lastError) {
        void message.error(chrome.runtime.lastError.message || '无法启动同步');
        return;
      }
      const r = res as { ok?: boolean; message?: string } | undefined;
      if (r?.ok) {
        void message.success(r.message ?? '同步完成');
        void refreshStatus();
      } else {
        void message.error(r?.message ?? '同步失败');
      }
    });
  };

  const cacheOk = status?.ok === true;
  const cacheMessage = cacheOk
    ? `已缓存 ${status.imageCount} 张图片${
        status.syncedAt ? ` · ${formatCatalogAge(status.syncedAt)}` : ''
      }`
    : status?.reason ?? '加载中…';

  return (
    <div className="dtx-toolbox__tool-panel-pad dtx-na-help">
      <header className="dtx-na-help__head">
        <span className="dtx-na-help__head-icon" aria-hidden>
          <ShoppingTwoTone twoToneColor={['#1677ff', '#93c5fd']} style={{ fontSize: 28 }} />
        </span>
        <div className="dtx-na-help__head-text">
          <Typography.Title level={5} className="dtx-na-help__title">
            售后申诉
          </Typography.Title>
          <Typography.Paragraph className="dtx-na-help__intro">
            在商家后台「售后申诉」列表页使用：拉取可申诉订单、售后/物流/聊天，AI 推荐货款申诉方案并自动填入维权申诉弹窗。质检图与负向反馈共用飞牛分享缓存。
          </Typography.Paragraph>
        </div>
      </header>

      <section
        className={
          cacheOk ? 'dtx-na-help__cache dtx-na-help__cache--ok' : 'dtx-na-help__cache dtx-na-help__cache--warn'
        }
      >
        <div className="dtx-na-help__cache-row">
          {cacheOk ? (
            <CheckCircleFilled className="dtx-na-help__cache-icon dtx-na-help__cache-icon--ok" />
          ) : (
            <ExclamationCircleFilled className="dtx-na-help__cache-icon dtx-na-help__cache-icon--warn" />
          )}
          <Typography.Text className="dtx-na-help__cache-msg">{cacheMessage}</Typography.Text>
        </div>
      </section>

      <div className="dtx-na-help__action">
        <Button
          type="primary"
          size="large"
          block
          icon={<CloudSyncOutlined />}
          loading={syncing}
          onClick={handleOpenAndSync}
        >
          一键打开并同步质检图
        </Button>
        <Typography.Text className="dtx-na-help__action-note">
          分享页：{FEINIU_SHARE_PAGE_URL}
        </Typography.Text>
      </div>

      <div className="dtx-na-help__steps">
        <article className="dtx-na-help__step">
          <span className="dtx-na-help__step-num">1</span>
          <div className="dtx-na-help__step-body">
            <Typography.Text className="dtx-na-help__step-title">打开申诉列表</Typography.Text>
            <Typography.Paragraph className="dtx-na-help__step-desc">
              登录后打开
              <Typography.Link href={AFTERSALE_APPEAL_LIST_URL} target="_blank" rel="noreferrer">
                售后申诉列表
              </Typography.Link>
              ，对目标订单点击「发起申诉」。
            </Typography.Paragraph>
          </div>
        </article>
        <article className="dtx-na-help__step">
          <span className="dtx-na-help__step-num">2</span>
          <div className="dtx-na-help__step-body">
            <Typography.Text className="dtx-na-help__step-title">分析 / 填入</Typography.Text>
            <Typography.Paragraph className="dtx-na-help__step-desc">
              点击右下角「售后申诉」查看 AI 分析；或「自动填入」一键写入原因、金额、描述、投诉项与凭证图。
            </Typography.Paragraph>
          </div>
        </article>
      </div>

      <Button
        type="link"
        size="small"
        icon={<ReloadOutlined />}
        className="dtx-na-help__refresh"
        onClick={() => void refreshStatus()}
      >
        刷新质检缓存状态
      </Button>
    </div>
  );
}
