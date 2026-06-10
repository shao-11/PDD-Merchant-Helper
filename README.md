# PDD Merchant Helper

A Chrome extension toolkit for Pinduoduo (PDD) merchant backend (mms.pinduoduo.com). Built with React + TypeScript + Vite.

## Features

- **Review Analyzer** — List, analyze, and batch reply customer reviews
- **Activity Assistant** — Auto-enroll in PDD promotional activities
- **Negative Appeal** — AI-assisted negative feedback appeal with screenshot capture
- **After-Sales Appeal** — Auto-fill after-sales appeal forms with AI-generated explanations
- **Auto Report & Reply** — Scheduled举报 and reply automation
- **Keep-Alive** — Anti-idle tab to keep the merchant session alive
- **Huice ERP Proxy** — Proxy for erp.huice.com integrations
- **AI Integration** — Local Ollama or cloud DashScope/Qwen for intelligent analysis

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- Chrome / Chromium browser

## Development

`ash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
`

## Chrome Extension Installation

1. Open Chrome and navigate to chrome://extensions/
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the dist/ folder

## Configuration

### Authentication

The extension includes a local auth system. No hardcoded credentials are included — you must configure your own:

- The popup login accepts any non-empty username/password for local testing
- For production, deploy the server and configure src/auth/api-config.ts to point to your server

### AI API Key

Set your AI provider API key in the extension popup (Negative Appeal panel → Settings). No API key is bundled with the extension.

### Server (Optional)

The server/ directory contains an optional auth backend:

`ash
cd server

# Copy and edit the env template
cp .env.example .env

# Install dependencies
npm install

# Start server
npm start
`

Set DB_MODE=local to use the built-in JSON user storage (for testing).  
Set DB_MODE=postgres or DB_MODE=mysql to connect to a real database.

## Architecture

`
dist/                  # Built output
├── background.js      # Service worker
├── content.js         # Content scripts
├── popup.html         # Extension popup
├── panel.html         # Side panel
└── manifest.json      # Extension manifest

src/
├── popup/             # Popup UI (React)
├── reviews-analyzer/  # Review analysis module
├── activity-assistant/# Activity enrollment helper
├── negative-appeal/   # Negative feedback appeal
├── aftersale-appeal/  # After-sales appeal
├── report-reply/      # Auto report & reply
├── keep-alive/        # Anti-idle keep-alive
├── background/        # Service worker logic
├── content/           # Content script injections
└── auth/              # Authentication
`

## Tech Stack

- **Frontend:** React 18, Ant Design, ECharts
- **Build:** Vite, esbuild, TypeScript
- **Extension:** Chrome Manifest V3
- **AI:** Ollama (local), Alibaba Cloud DashScope

## Notes

- This tool is designed for the Pinduoduo merchant backend. Use responsibly.
- Some features (negative appeal, after-sales appeal) require AI model access.
- The keep-alive feature opens a hidden tab to periodically refresh the session.

## License

Private / Internal use.
