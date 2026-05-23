/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the admin API. Empty string in dev — the Vite proxy forwards /admin. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
