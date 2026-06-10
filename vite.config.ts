import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /** 避免 popup/panel 产物带 source map 引用，在商家后台页 CSP 下制造多余 connect 报错 */
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        popup: resolve(rootDir, 'popup.html'),
        panel: resolve(rootDir, 'panel.html'),
      },
    },
  },
});
