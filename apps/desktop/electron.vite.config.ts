import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, 'electron/main.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, 'electron/preload.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    resolve: {
      // O pacote compartilhado é consumido direto do TypeScript: o Vite compila
      // junto e o renderer não depende do build CommonJS usado pelo servidor.
      alias: {
        '@nexus/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
});
