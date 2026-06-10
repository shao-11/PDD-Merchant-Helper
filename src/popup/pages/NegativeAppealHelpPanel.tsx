import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircleFilled,
  CloudSyncOutlined,
  MessageTwoTone,
  ExclamationCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Typography, message } from 'antd';
import { APPEAL_LIST_URL, FEINIU_SHARE_PAGE_URL } from '../../negative-appeal/constants';
import { MSG_FEINIU_OPEN_AND_SYNC } from '../../negative-appeal/feiniu-share-messages';
import {
  formatCatalogAge,
  getQcSheetCatalogStatus,
} from '../../negative-appeal/qc-sheet-storage';

export function NegativeAppealHelpPanel(): JSX.Element {
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
          <MessageTwoTone twoToneColor={['#1677ff', '#93c5fd']} style={{ fontSize: 28 }} />
        </span>
        <div className="dtx-na-help__head-text">
          <Typography.Title level={5} className="dtx-na-help__title">
            负向反馈申诉
          </Typography.Title>
          <Typography.Paragraph className="dtx-na-help__intro">
            在商家后台「负向体验申诉」详情页使用：采集四要素、AI 推荐申诉方案并自动填入；质检图来自飞牛分享链接，与售后申诉共用缓存。
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
            <Typography.Text className="dtx-na-help__step-title">同步质检图</Typography.Text>
            <Typography.Paragraph className="dtx-na-help__step-desc">
              推荐点上方按钮：后台打开分享页、自动进入「质检报告」并同步；也可打开
              <Typography.Link href={FEINIU_SHARE_PAGE_URL} target="_blank" rel="noreferrer">
                分享链接
              </Typography.Link>
              后点页面右下角「同步质检图」。图片命名示例：滇同学-云南黑糖-100克袋-1.png、…-2.png
            </Typography.Paragraph>
          </div>
        </article>
        <article className="dtx-na-help__step">
          <span className="dtx-na-help__step-num">2</span>
          <div className="dtx-na-help__step-body">
            <Typography.Text className="dtx-na-help__step-title">分析 / 填入</Typography.Text>
            <Typography.Paragraph className="dtx-na-help__step-desc">
              打开
              <Typography.Link href={APPEAL_LIST_URL} target="_blank" rel="noreferrer">
                负向体验申诉
              </Typography.Link>
              详情 → 点击「自动申诉」：自动上传聊天截图与匹配到的质检图。
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
