import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Sem Electron nos testes: o stub fornece app.getPath e safeStorage.
    alias: {
      electron: resolve(__dirname, 'test/electron-stub.ts'),
      '@nexus/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
