/**
 * 分步构建（调试用）。与 postbuild.mjs 相同规则：不用 cpSync，esbuild 延迟加载。
 * 用法：node scripts/postbuild-step.mjs [copy|background|content|all]
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const step = process.argv[2] || 'all';

const prodDefine = { 'process.env.NODE_ENV': '"production"' };
const reactLoader = { '.tsx': 'tsx', '.ts': 'ts', '.css': 'text' };

function copyStaticAssets() {
  mkdirSync(dist, { recursive: true });
  copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
  copyFileSync(join(root, 'public', 'logo.png'), join(dist, 'logo.png'));
  copyFileSync(join(root, 'public', 'ollama-offscreen.html'), join(dist, 'ollama-offscreen.html'));
  copyFileSync(join(root, 'public', 'pdd-page-anti-hook.js'), join(dist, 'pdd-page-anti-hook.js'));
  copyFileSync(
    join(root, 'public', 'pdd-carriage-template-cleaner.js'),
    join(dist, 'pdd-carriage-template-cleaner.js'),
  );
}

const bundleSteps = {
  'ollama-offscreen': {
    entry: 'src/background/ollama-offscreen-page.ts',
    outfile: 'ollama-offscreen.js',
  },
  background: { entry: 'src/background/index.ts', outfile: 'background.js' },
  'inject-anti-hook-loader': {
    entry: 'src/content/inject-anti-hook-loader.ts',
    outfile: 'inject-anti-hook-loader.js',
  },
  inject: { entry: 'src/content/inject-hook.ts', outfile: 'inject.js' },
  'report-reply-inject': {
    entry: 'src/report-reply/inject-main.ts',
    outfile: 'report-reply-inject.js',
  },
  'negative-appeal-inject': {
    entry: 'src/negative-appeal/inject-fetch.ts',
    outfile: 'negative-appeal-inject.js',
  },
  'activity-inject': {
    entry: 'src/activity-assistant/inject-enroll-hook.ts',
    outfile: 'activity-inject.js',
  },
  'report-reply-content': {
    entry: 'src/content/report-reply-overlay.tsx',
    outfile: 'report-reply-content.js',
    jsx: true,
  },
  'negative-appeal-content': {
    entry: 'src/content/negative-appeal-overlay.tsx',
    outfile: 'negative-appeal-content.js',
    jsx: true,
  },
  content: {
    entry: 'src/content/overlay-entry.tsx',
    outfile: 'content.js',
    jsx: true,
  },
};

const order = [
  'copy',
  'ollama-offscreen',
  'background',
  'inject-anti-hook-loader',
  'inject',
  'report-reply-inject',
  'negative-appeal-inject',
  'activity-inject',
  'report-reply-content',
  'negative-appeal-content',
  'content',
];

async function runBundle(name) {
  const cfg = bundleSteps[name];
  if (!cfg) throw new Error(`unknown bundle step: ${name}`);
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [join(root, cfg.entry)],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    outfile: join(dist, cfg.outfile),
    target: 'es2022',
    jsx: cfg.jsx ? 'automatic' : undefined,
    loader: cfg.jsx ? reactLoader : undefined,
    define: prodDefine,
    minify: true,
    legalComments: 'none',
  });
}

async function main() {
  const keys = step === 'all' ? order : [step];
  for (const k of keys) {
    console.log('[postbuild] start', k);
    if (k === 'copy') {
      copyStaticAssets();
    } else {
      await runBundle(k);
    }
    console.log('[postbuild] done', k);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
