/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET?: 'web';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
