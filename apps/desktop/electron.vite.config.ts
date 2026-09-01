import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Identificação do build, gravada no bundle.
 *
 * Existe porque duas vezes já perdemos horas com duas pessoas rodando builds
 * diferentes sem ter como perceber: o sintoma aparecia no computador de quem
 * estava em dia. Agora dá para comparar em um olhar.
 */
function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Fora de um clone git (a imagem do electron-builder, por exemplo).
    return 'desconhecido';
  }
}

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
    define: { __BUILD_ID__: JSON.stringify(buildId()) },
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
