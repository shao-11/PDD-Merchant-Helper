/**
 * 构建 dist 静态资源 + esbuild 打包 content/background 等。
 *
 * Windows 注意：不可在 import esbuild 之后调用 fs.cpSync，会触发原生模块冲突导致
 * 进程 ACCESS_VIOLATION (-1073741819)。静态复制只用 copyFileSync，esbuild 延迟加载。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

const prodDefine = { 'process.env.NODE_ENV': '"production"' };

const reactLoader = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.css': 'text',
};

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

const esbuildEntries = [
  {
    name: 'ollama-offscreen',
    entry: 'src/background/ollama-offscreen-page.ts',
    outfile: 'ollama-offscreen.js',
  },
  { name: 'background', entry: 'src/background/index.ts', outfile: 'background.js' },
  {
    name: 'inject-anti-hook-loader',
    entry: 'src/content/inject-anti-hook-loader.ts',
    outfile: 'inject-anti-hook-loader.js',
  },
  { name: 'inject', entry: 'src/content/inject-hook.ts', outfile: 'inject.js' },
  {
    name: 'report-reply-inject',
    entry: 'src/report-reply/inject-main.ts',
    outfile: 'report-reply-inject.js',
  },
  {
    name: 'negative-appeal-inject',
    entry: 'src/negative-appeal/inject-fetch.ts',
    outfile: 'negative-appeal-inject.js',
  },
  {
    name: 'activity-inject',
    entry: 'src/activity-assistant/inject-enroll-hook.ts',
    outfile: 'activity-inject.js',
  },
  {
    name: 'report-reply-content',
    entry: 'src/content/report-reply-overlay.tsx',
    outfile: 'report-reply-content.js',
    jsx: true,
  },
  {
    name: 'negative-appeal-content',
    entry: 'src/content/negative-appeal-overlay.tsx',
    outfile: 'negative-appeal-content.js',
    jsx: true,
  },
  {
    name: 'content',
    entry: 'src/content/overlay-entry.tsx',
    outfile: 'content.js',
    jsx: true,
  },
  {
    name: 'feiniu-share-inject',
    entry: 'src/negative-appeal/feiniu-share-inject.ts',
    outfile: 'feiniu-share-inject.js',
  },
  {
    name: 'feiniu-share-content',
    entry: 'src/content/feiniu-share-content.ts',
    outfile: 'feiniu-share-content.js',
  },
  {
    name: 'huice-content',
    entry: 'src/content/huice-content.ts',
    outfile: 'huice-content.js',
  },
  {
    name: 'huice-inject',
    entry: 'src/negative-appeal/huice/inject-main.ts',
    outfile: 'huice-inject.js',
  },
  {
    name: 'aftersale-appeal-inject',
    entry: 'src/aftersale-appeal/inject-fetch.ts',
    outfile: 'aftersale-appeal-inject.js',
  },
  {
    name: 'aftersale-appeal-content',
    entry: 'src/content/aftersale-appeal-overlay.tsx',
    outfile: 'aftersale-appeal-content.js',
    jsx: true,
  },
];

async function runEsbuildBundles() {
  const esbuild = await import('esbuild');

  for (const item of esbuildEntries) {
    console.log('[postbuild] esbuild', item.name);
    await esbuild.build({
      entryPoints: [join(root, item.entry)],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: join(dist, item.outfile),
      target: 'es2022',
      jsx: item.jsx ? 'automatic' : undefined,
      loader: item.jsx ? reactLoader : undefined,
      define: prodDefine,
      minify: true,
      legalComments: 'none',
    });
  }
}

async function main() {
  console.log('[postbuild] copy static assets');
  copyStaticAssets();
  console.log('[postbuild] copy ok');

  await runEsbuildBundles();
  console.log('[postbuild] all done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
