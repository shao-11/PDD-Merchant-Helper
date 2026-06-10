import { useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  CalendarTwoTone,
  ClockCircleTwoTone,
  HomeTwoTone,
  MessageTwoTone,
  FlagTwoTone,
  PieChartTwoTone,
  RightOutlined,
  RocketOutlined,
  ShoppingTwoTone,
} from '@ant-design/icons';
import { Col, Empty, Flex, Row, Switch, Tabs, Typography, message } from 'antd';
import {
  STORAGE_ACTIVITY_ASSIST_ENABLED,
  STORAGE_KEEP_ALIVE_ENABLED,
  STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED,
  STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED,
  STORAGE_REPORT_REPLY_MODULE_ENABLED,
  STORAGE_REVIEWS_MODULE_ENABLED,
} from '../../constants/storage-keys';
import { LogoutLink } from '../components/LogoutLink';
import { TOOLBOX_PLATFORMS, TOOLBOX_TOOLS } from '../toolbox/tools';
import type { ToolboxHubIcon, ToolboxPlatformId, ToolboxTool, ToolboxToolId } from '../toolbox/types';
import '../styles/toolbox.css';

const logoUrl = chrome.runtime.getURL('logo.png');

const TOOL_MODULE_STORAGE_KEY: Partial<Record<ToolboxToolId, string>> = {
  'pdd-reviews': STORAGE_REVIEWS_MODULE_ENABLED,
  'pdd-activity-assistant': STORAGE_ACTIVITY_ASSIST_ENABLED,
  'pdd-report-reply': STORAGE_REPORT_REPLY_MODULE_ENABLED,
  'pdd-negative-appeal': STORAGE_NEGATIVE_APPEAL_MODULE_ENABLED,
  'pdd-aftersale-appeal': STORAGE_AFTERSALE_APPEAL_MODULE_ENABLED,
  'pdd-keep-alive': STORAGE_KEEP_ALIVE_ENABLED,
};

function HubToolTileIcon({ kind }: { kind: ToolboxHubIcon }): JSX.Element {
  const cls = 'dtx-toolbox__hub-tool-tile-icon dtx-toolbox__hub-tool-tile-icon--twotone';
  const iconStyle = { fontSize: 26 };
  if (kind === 'reviews') {
    return (
      <PieChartTwoTone className={cls} twoToneColor={['#ea580c', '#fdba74']} style={iconStyle} aria-hidden />
    );
  }
  if (kind === 'activity') {
    return (
      <CalendarTwoTone className={cls} twoToneColor={['#1d4ed8', '#93c5fd']} style={iconStyle} aria-hidden />
    );
  }
  if (kind === 'reportReply') {
    return (
      <FlagTwoTone className={cls} twoToneColor={['#cf1322', '#ffa39e']} style={iconStyle} aria-hidden />
    );
  }
  if (kind === 'negativeAppeal') {
    return (
      <MessageTwoTone className={cls} twoToneColor={['#1d4ed8', '#93c5fd']} style={iconStyle} aria-hidden />
    );
  }
  if (kind === 'aftersaleAppeal') {
    return (
      <ShoppingTwoTone className={cls} twoToneColor={['#059669', '#6ee7b7']} style={iconStyle} aria-hidden />
    );
  }
  return (
    <ClockCircleTwoTone className={cls} twoToneColor={['#08979c', '#87e8de']} style={iconStyle} aria-hidden />
  );
}

type ToolboxHubProps = {
  onOpenTool: (toolId: ToolboxToolId) => void;
};

const KEEP_ALIVE_TOOL_ID: ToolboxToolId = 'pdd-keep-alive';

export function ToolboxHub({ onOpenTool }: ToolboxHubProps): JSX.Element {
  const [activePlatform, setActivePlatform] = useState<ToolboxPlatformId>('pdd');
  const [moduleEnabled, setModuleEnabled] = useState<Partial<Record<ToolboxToolId, boolean>>>({});

  const visibleTools = useMemo(
    () => TOOLBOX_TOOLS.filter((tool) => tool.platformId === activePlatform),
    [activePlatform]
  );

  useEffect(() => {
    const keys = Array.from(
      new Set(
        visibleTools
          .map((t) => TOOL_MODULE_STORAGE_KEY[t.id])
          .filter((k): k is string => typeof k === 'string' && k.length > 0)
      )
    );
    if (keys.length === 0) {
      setModuleEnabled({});
      return;
    }
    chrome.storage.local.get(keys, (raw) => {
      if (chrome.runtime.lastError) return;
      const next: Partial<Record<ToolboxToolId, boolean>> = {};
      for (const t of visibleTools) {
        const sk = TOOL_MODULE_STORAGE_KEY[t.id];
        if (!sk) { next[t.id] = true; continue; }
        next[t.id] = raw[sk] !== false;
      }
      setModuleEnabled(next);
    });
  }, [visibleTools]);

  useEffect(() => {
    const keys = Object.values(TOOL_MODULE_STORAGE_KEY).filter(Boolean) as string[];
    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return;
      if (!keys.some((k) => changes[k])) return;
      chrome.storage.local.get(keys, (raw) => {
        if (chrome.runtime.lastError) return;
        setModuleEnabled((prev) => {
          const merged = { ...prev };
          for (const t of TOOLBOX_TOOLS) {
            const sk = TOOL_MODULE_STORAGE_KEY[t.id];
            if (!sk) continue;
            const change = changes[sk];
            if (!change) continue;
            merged[t.id] = change.newValue !== false;
          }
          return merged;
        });
      });
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const handleToolClick = (tool: ToolboxTool): void => {
    if (tool.status !== 'ready') return;
    onOpenTool(tool.id);
  };

  const handleModuleSwitch = (tool: ToolboxTool, checked: boolean): void => {
    const storageKey = TOOL_MODULE_STORAGE_KEY[tool.id];
    if (!storageKey) return;
    chrome.storage.local.set({ [storageKey]: checked }, () => {
      if (chrome.runtime.lastError) {
        void message.error('Save failed: ' + chrome.runtime.lastError.message);
        return;
      }
      setModuleEnabled((prev) => ({ ...prev, [tool.id]: checked }));
    });
  };

  const renderToolRow = (tool: ToolboxTool): JSX.Element => {
    const storageKey = TOOL_MODULE_STORAGE_KEY[tool.id];
    const switchChecked = storageKey ? moduleEnabled[tool.id] !== false : true;
    const showSwitch = tool.status === 'ready' && Boolean(storageKey);
      const switchAriaLabel = tool.id === KEEP_ALIVE_TOOL_ID ? `${tool.name}: 开启保活` : `${tool.name}: 商家后台入口`;

    return (
      <div className="dtx-toolbox__hub-row" key={tool.id}>
        <button
          type="button"
          className="dtx-toolbox__tool-row-main dtx-toolbox__hub-row-main"
          disabled={tool.status !== 'ready'}
          onClick={() => handleToolClick(tool)}
        >
          <div className="dtx-toolbox__hub-tool-tile" aria-hidden>
            <span className="dtx-toolbox__hub-tool-tile-inner">
              <HubToolTileIcon kind={tool.hubIcon} />
            </span>
          </div>
          <div className="dtx-toolbox__tool-row-text">
            <Typography.Text strong className="dtx-toolbox__tool-row-title">{tool.name}</Typography.Text>
            <Typography.Text type="secondary" className="dtx-toolbox__tool-row-desc" ellipsis>{tool.description}</Typography.Text>
          </div>
          <RightOutlined className="dtx-toolbox__hub-row-chevron" aria-hidden />
        </button>
        {showSwitch ? (
          <Switch checked={switchChecked} onChange={(c) => handleModuleSwitch(tool, c)} aria-label={switchAriaLabel} className="dtx-toolbox__hub-switch" />
        ) : null}
      </div>
    );
  };

  const emptyDescription = '????';

  return (
    <div className="dtx-toolbox dtx-toolbox--hub" role="application" aria-label="PDD Merchant Helper">
      <div className="dtx-toolbox__hub-shell">
        <header className="dtx-toolbox__hub-top">
          <Flex align="flex-start" justify="space-between" gap={12} wrap="nowrap">
            <Flex align="center" gap={14} className="dtx-toolbox__hub-brand">
              <img className="dtx-toolbox__logo" src={logoUrl} alt="PDD Helper" />
              <div className="dtx-toolbox__title-wrap">
                <Typography.Title level={5} className="dtx-toolbox__title dtx-toolbox__title--hub">PDD Merchant Helper</Typography.Title>
                <Typography.Text type="secondary" className="dtx-toolbox__meta dtx-toolbox__meta--hub">Merchant Backend Toolkit</Typography.Text>
              </div>
            </Flex>
            <LogoutLink className="dtx-toolbox__hub-logout" />
          </Flex>
          <div className="dtx-toolbox__hub-tabs-track">
            <Tabs className="dtx-toolbox__platform-tabs dtx-toolbox__platform-tabs--hub" activeKey={activePlatform} onChange={(key) => setActivePlatform(key as ToolboxPlatformId)} items={TOOLBOX_PLATFORMS.map((p) => ({ key: p.id, label: p.label }))} />
          </div>
        </header>
        <main className="dtx-toolbox__hub-main">
          <div className="dtx-toolbox__hub-section-head">
            <Typography.Text className="dtx-toolbox__hub-section-title">????</Typography.Text>
          </div>
          <div className="dtx-toolbox__hub-scroll">
            {visibleTools.length > 0 ? (
              <div className="dtx-toolbox__hub-list">{visibleTools.map((tool) => renderToolRow(tool))}</div>
            ) : (
              <Empty className="dtx-toolbox__empty dtx-toolbox__empty--hub" image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
            )}
          </div>
        </main>
        <footer className="dtx-toolbox__hub-footer">
          <Row gutter={0}>
            <Col span={12}><Typography.Text type="secondary" className="dtx-toolbox__hub-footer-text"><AppstoreOutlined /> PDD Merchant Backend</Typography.Text></Col>
            <Col span={12}><Typography.Text type="secondary" className="dtx-toolbox__hub-footer-text"><RocketOutlined /> ?????</Typography.Text></Col>
          </Row>
        </footer>
      </div>
    </div>
  );
}
