# PDD Merchant Helper

拼多多商家后台效率工具集。基于 React + TypeScript + Vite 构建的 Chrome 扩展，为拼多多商家后台（mms.pinduoduo.com）提供一系列效率辅助功能。

## 功能特性

- **评价分析** — 抓取、筛选、统计客户评价，支持批量操作
- **活动助手** — 自动报名拼多多促销活动，辅助确认页操作
- **负向反馈申诉** — 结合 AI 自动生成申诉话术，自动填写申诉表单
- **售后申诉** — 自动填充售后申诉单，AI 生成申诉理由
- **一键举报/回复** — 定时自动举报低星评价并批量回复
- **防掉线保活** — 后台定时刷新商家后台首页，模拟页面活跃
- **虎澈 ERP 代理** — 对接虎澈 ERP（erp.huice.com）的交易查询等功能
- **AI 集成** — 支持本地 Ollama 或云端阿里云 DashScope/Qwen 模型

## 环境要求

- [Node.js](https://nodejs.org/)（推荐 LTS 版本）
- Chrome / Chromium 浏览器

## 开发指南

`ash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
`

## 安装到 Chrome

1. 打开 Chrome，进入 chrome://extensions/
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 dist/ 文件夹

## 配置说明

### 登录认证

扩展内置了本地认证系统，不包含任何硬编码凭据，你需要自行配置：

- 弹窗登录页支持任意非空账号密码用于本地测试
- 生产环境需部署 server/ 下的认证服务，并修改 src/auth/api-config.ts 指向你的服务器地址

### AI API Key

在扩展弹窗中设置你的 AI 提供商 API Key（负向反馈申诉面板 → 设置）。扩展不捆绑任何 API Key。

### 服务端（可选）

server/ 目录包含一个可选的认证后端服务：

`ash
cd server

# 复制并编辑环境变量模板
cp .env.example .env

# 安装依赖
npm install

# 启动服务
npm start
`

- 设置 DB_MODE=local 使用内置的 JSON 用户存储（适合测试）
- 设置 DB_MODE=postgres 或 DB_MODE=mysql 连接真实数据库

## 项目结构

`
dist/                  # 构建产物
├── background.js      # Service Worker
├── content.js         # Content Scripts
├── popup.html         # 扩展弹窗
├── panel.html         # 侧边面板
└── manifest.json      # 扩展清单

src/
├── popup/             # 弹窗 UI（React）
├── reviews-analyzer/  # 评价分析模块
├── activity-assistant/# 活动助手模块
├── negative-appeal/   # 负向反馈申诉
├── aftersale-appeal/  # 售后申诉
├── report-reply/      # 举报与回复
├── keep-alive/        # 防掉线保活
├── background/        # Service Worker 逻辑
├── content/           # Content Script 注入
└── auth/              # 认证模块
`

## 技术栈

- **前端：** React 18、Ant Design、ECharts
- **构建：** Vite、esbuild、TypeScript
- **扩展：** Chrome Manifest V3
- **AI：** Ollama（本地）、阿里云 DashScope

## 注意事项

- 本工具专为拼多多商家后台设计，请合规使用。
- 部分功能（负向反馈申诉、售后申诉）需要 AI 模型支持。
- 防掉线保活功能会在后台打开隐藏标签页，定期刷新商家后台首页以维持会话。

## 许可

仅供内部使用。
