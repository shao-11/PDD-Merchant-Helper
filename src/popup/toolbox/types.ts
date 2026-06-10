export type ToolboxPlatformId = 'pdd' | 'tb' | 'jd' | 'more';

export type ToolboxToolId =
  | 'pdd-reviews'
  | 'pdd-activity-assistant'
  | 'pdd-report-reply'
  | 'pdd-negative-appeal'
  | 'pdd-aftersale-appeal'
  | 'pdd-keep-alive';

export type ToolboxToolStatus = 'ready' | 'coming_soon';

/** 工具箱首页列表图标样式（与 Ant Design 图标搭配） */
export type ToolboxHubIcon =
  | 'reviews'
  | 'activity'
  | 'reportReply'
  | 'negativeAppeal'
  | 'aftersaleAppeal'
  | 'keepAlive';

export type ToolboxPlatform = {
  id: ToolboxPlatformId;
  label: string;
};

export type ToolboxTool = {
  id: ToolboxToolId;
  platformId: ToolboxPlatformId;
  name: string;
  description: string;
  status: ToolboxToolStatus;
  /** 首页列表左侧图标块 */
  hubIcon: ToolboxHubIcon;
};
