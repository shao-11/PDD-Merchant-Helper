import type { ToolboxPlatform, ToolboxTool } from './types';

export const TOOLBOX_VERSION = '1.0.0';

export const TOOLBOX_PLATFORMS: ToolboxPlatform[] = [
  { id: 'pdd', label: '拼多多' },
  { id: 'tb', label: '淘宝' },
  { id: 'jd', label: '京东' },
  { id: 'more', label: '更多' },
];

export const TOOLBOX_TOOLS: ToolboxTool[] = [
  {
    id: 'pdd-reviews',
    platformId: 'pdd',
    name: '评价分析',
    description: '商家后台评价列表抓取、筛选与导出',
    status: 'ready',
    hubIcon: 'reviews',
  },
  {
    id: 'pdd-activity-assistant',
    platformId: 'pdd',
    name: '活动助手',
    description: '活动报名与确认页辅助',
    status: 'ready',
    hubIcon: 'activity',
  },
  {
    id: 'pdd-report-reply',
    platformId: 'pdd',
    name: '一键举报（回复）',
    description: '评价管理页批量举报低星评价',
    status: 'ready',
    hubIcon: 'reportReply',
  },
  {
    id: 'pdd-negative-appeal',
    platformId: 'pdd',
    name: '负向反馈申诉',
    description: '申诉详情页：采集四要素、AI 推荐、截图（入口在详情页按钮）',
    status: 'ready',
    hubIcon: 'negativeAppeal',
  },
  {
    id: 'pdd-aftersale-appeal',
    platformId: 'pdd',
    name: '售后申诉',
    description: '售后申诉列表：维权货款申诉 AI 分析与自动填入',
    status: 'ready',
    hubIcon: 'aftersaleAppeal',
  },
  {
    id: 'pdd-keep-alive',
    platformId: 'pdd',
    name: '防账号掉线',
    description: '定时刷新商家后台首页，降低长时间无操作被踢下线概率',
    status: 'ready',
    hubIcon: 'keepAlive',
  },
];
