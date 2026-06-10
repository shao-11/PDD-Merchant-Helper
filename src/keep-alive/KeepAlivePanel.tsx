import { useCallback, useEffect, useState } from 'react';

import { ClockCircleTwoTone } from '@ant-design/icons';

import { Button, Switch, Typography, message } from 'antd';

import {

  STORAGE_KEEP_ALIVE_ENABLED,

  STORAGE_KEEP_ALIVE_LAST_RESULT,

} from '../constants/storage-keys';

import { formatKeepAliveIntervalLabel } from './constants';

import { MSG_KEEP_ALIVE_TRIGGER_NOW, type KeepAliveLastResult } from './messages';



const intervalLabel = formatKeepAliveIntervalLabel();



function formatLastRun(r: KeepAliveLastResult | null): { summary: string; ok: boolean } {

  if (!r) return { summary: '尚无执行记录', ok: true };

  const t = new Date(r.at).toLocaleString('zh-CN', {

    month: 'numeric',

    day: 'numeric',

    hour: '2-digit',

    minute: '2-digit',

    second: '2-digit',

  });

  return { summary: `${t} · ${r.message}`, ok: r.ok };

}



export function KeepAlivePanel(): JSX.Element {

  const [enabled, setEnabled] = useState(true);

  const [lastRun, setLastRun] = useState<KeepAliveLastResult | null>(null);

  const [busy, setBusy] = useState(false);



  const load = useCallback(() => {

    chrome.storage.local.get(

      [STORAGE_KEEP_ALIVE_ENABLED, STORAGE_KEEP_ALIVE_LAST_RESULT],

      (raw) => {

        if (chrome.runtime.lastError) return;

        setEnabled(raw[STORAGE_KEEP_ALIVE_ENABLED] !== false);

        const lr = raw[STORAGE_KEEP_ALIVE_LAST_RESULT] as KeepAliveLastResult | undefined;

        setLastRun(lr && typeof lr.at === 'number' ? lr : null);

      }

    );

  }, []);



  useEffect(() => {

    load();

    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {

      if (area !== 'local') return;

      if (changes[STORAGE_KEEP_ALIVE_ENABLED] || changes[STORAGE_KEEP_ALIVE_LAST_RESULT]) load();

    };

    chrome.storage.onChanged.addListener(onChange);

    return () => chrome.storage.onChanged.removeListener(onChange);

  }, [load]);



  const onToggle = (checked: boolean) => {

    chrome.storage.local.set({ [STORAGE_KEEP_ALIVE_ENABLED]: checked }, () => {

      if (chrome.runtime.lastError) {

        void message.error(`保存失败：${chrome.runtime.lastError.message}`);

        return;

      }

      setEnabled(checked);

    });

  };



  const onManual = () => {

    setBusy(true);

    chrome.runtime.sendMessage({ type: MSG_KEEP_ALIVE_TRIGGER_NOW }, (res) => {

      setBusy(false);

      if (chrome.runtime.lastError) {

        void message.error(chrome.runtime.lastError.message);

        return;

      }

      if (res?.ok === false) void message.warning(res?.message ?? '保活失败');

      else void message.success('已执行一次保活');

      load();

    });

  };



  const status = formatLastRun(lastRun);



  return (

    <div className="dtx-toolbox__tool-panel-pad dtx-rr-settings dtx-rr-settings--keep-alive">

      <article className="dtx-rr-settings__block">

        <div className="dtx-rr-settings__row">

          <span className="dtx-rr-settings__tile" aria-hidden>

            <ClockCircleTwoTone twoToneColor={['#08979c', '#87e8de']} style={{ fontSize: 26 }} />

          </span>

          <div className="dtx-rr-settings__row-text">

            <Typography.Text className="dtx-rr-settings__row-title">防账号掉线</Typography.Text>

            <Typography.Text className="dtx-rr-settings__row-desc">

              扩展会单独开一个后台标签页（不打扰正在操作的页面），每隔 {intervalLabel}{' '}

              随机刷新拼多多商家首页，并模拟轻微页面活动。

            </Typography.Text>

          </div>

          <Switch checked={enabled} onChange={onToggle} className="dtx-rr-settings__switch" />

        </div>

        <div

          className={

            status.ok ? 'dtx-rr-settings__status' : 'dtx-rr-settings__status dtx-rr-settings__status--fail'

          }

        >

          {enabled ? '已开启（默认开启）' : '已关闭'} · {status.summary}

        </div>

      </article>



      <div className="dtx-rr-settings__footer">

        <Button

          type="primary"

          block

          loading={busy}

          disabled={!enabled}

          onClick={onManual}

          className="dtx-rr-settings__run-btn"

        >

          立即保活一次

        </Button>

        <Typography.Text className="dtx-rr-settings__footer-note">

          需先登录滇同学工具箱后才会定时保活；退出登录后自动停止。无法保证 100% 不掉线，关闭本功能时会关闭专用保活标签页。

        </Typography.Text>

      </div>

    </div>

  );

}


