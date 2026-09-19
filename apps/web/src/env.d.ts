/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du Cloud proposée par défaut sur la tablette (ex. https://app.afrikaisse.com). */
  readonly VITE_AFK_CLOUD_URL?: string;
}

/** Vrai si l'APK est construit avec google-services.json (vite.config.ts) : seul cas où le plugin push peut être appelé. */
declare const __AFK_PUSH__: boolean;
