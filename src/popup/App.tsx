import { useState } from 'react';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Flex, Layout, Typography } from 'antd';
import { ActivityAssistantPanel } from '../activity-assistant/ActivityAssistantPanel';
import { KeepAlivePanel } from '../keep-alive/KeepAlivePanel';
import { AftersaleAppealHelpPanel } from './pages/AftersaleAppealHelpPanel';
import { NegativeAppealHelpPanel } from './pages/NegativeAppealHelpPanel';
import { ReportReplySettingsPanel } from './pages/ReportReplySettingsPanel';
import { ReviewsTable } from './pages/ReviewsTable';
import { LogoutLink } from './components/LogoutLink';
import { ToolboxHub } from './pages/ToolboxHub';
import type { ToolboxToolId } from './toolbox/types';
import './styles/toolbox.css';

const TOOL_TITLES: Record<ToolboxToolId, string> = {
  'pdd-reviews': 'PDD · Review Analyzer',
  'pdd-activity-assistant': 'PDD · Activity Assistant',
  'pdd-report-reply': 'PDD · Auto Report & Reply',
  'pdd-negative-appeal': 'PDD · Negative Appeal',
  'pdd-aftersale-appeal': 'PDD · After-Sales Appeal',
  'pdd-keep-alive': 'PDD · Keep Alive',
};

export function App(): JSX.Element {
  const isPanel = typeof window !== 'undefined' && window.location.pathname.endsWith('panel.html');
  const isEmbed =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('embed') === '1';
  const isPopup = !isPanel && !isEmbed;

  const [activeTool, setActiveTool] = useState<ToolboxToolId | null>(null);

  if (isPopup && activeTool === null) {
    return <ToolboxHub onOpenTool={setActiveTool} />;
  }

  const toolTitle = activeTool ? TOOL_TITLES[activeTool] : '';
  const hubWidthTools: ToolboxToolId[] = [
    'pdd-report-reply',
    'pdd-negative-appeal',
    'pdd-aftersale-appeal',
    'pdd-keep-alive',
    'pdd-activity-assistant',
  ];
  const popupToolClass =
    isPopup && activeTool
      ? `dtx-toolbox__tool-view`
      : undefined;

  return (
    <Layout
      className={popupToolClass}
      style={
        isPopup
          ? undefined
          : {
              width: isPanel ? '100%' : 560,
              maxHeight: isPanel ? (isEmbed ? '100%' : undefined) : 560,
              height: isEmbed ? '100%' : undefined,
              minHeight: isPanel ? (isEmbed ? '100%' : '100vh') : undefined,
              overflow: 'hidden',
              background: '#fff',
            }
      }
    >
      {isPopup ? (
        <Layout.Header className="dtx-toolbox__tool-view-header">
          <Flex align="center" justify="space-between" gap={8}>
            <Flex align="center" gap={8} style={{ minWidth: 0, flex: 1 }}>
              <Button
                type="link"
                icon={<ArrowLeftOutlined />}
                className="dtx-toolbox__back-btn"
                onClick={() => setActiveTool(null)}
              >
                返回工具
              </Button>
              <Typography.Title level={5} className="dtx-toolbox__tool-view-title" title={toolTitle}>
                {toolTitle}
              </Typography.Title>
            </Flex>
            <LogoutLink className="dtx-toolbox__hub-logout" />
          </Flex>
        </Layout.Header>
      ) : null}
      <Layout.Content
        className={isPopup ? 'dtx-toolbox__tool-view-body' : undefined}
        style={isPopup ? undefined : { flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        {activeTool === 'pdd-activity-assistant' ? (
          <ActivityAssistantPanel />
        ) : activeTool === 'pdd-report-reply' ? (
          <ReportReplySettingsPanel />
        ) : activeTool === 'pdd-negative-appeal' ? (
          <NegativeAppealHelpPanel />
        ) : activeTool === 'pdd-aftersale-appeal' ? (
          <AftersaleAppealHelpPanel />
        ) : activeTool === 'pdd-keep-alive' ? (
          <KeepAlivePanel />
        ) : (
          <ReviewsTable compact={!isPanel} embedded={isEmbed} />
        )}
      </Layout.Content>
    </Layout>
  );
}
