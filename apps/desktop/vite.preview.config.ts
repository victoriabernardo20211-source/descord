import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify('preview') },
  resolve: { alias: { '@nexus/shared': resolve(__dirname, '../../packages/shared/src/index.ts') } },
  build: {
    outDir: resolve(__dirname, 'out/preview'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/preview.html') },
  },
});
