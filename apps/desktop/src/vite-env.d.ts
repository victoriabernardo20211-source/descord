/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Endereço do servidor embutido no instalador. Definido em tempo de build
   * para que quem recebe o .exe não precise digitar nada:
   *   VITE_DEFAULT_SERVER_URL=http://100.x.y.z pnpm release:windows
   */
  readonly VITE_DEFAULT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Hash curto do commit que gerou este bundle. */
declare const __BUILD_ID__: string;
