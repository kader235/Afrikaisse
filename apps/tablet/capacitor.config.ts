import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Enveloppe Android de la tablette (ADR-011).
 *
 * Les écrans sont ceux de apps/web, embarqués dans l'APK : la tablette démarre même
 * quand Internet est coupé, et se connecte au serveur choisi (Cloud ou serveur local).
 *
 * Les appels à l'API passent par le HTTP natif (CapacitorHttp) et non par la WebView :
 * - pas de CORS ni de « contenu mixte » entre l'enveloppe (https://localhost) et un
 *   serveur local en HTTP ;
 * - indépendant de la version de la WebView, souvent ancienne sur les tablettes de
 *   restaurant (Chrome 83 constaté).
 */
const config: CapacitorConfig = {
  // Identifiant Android définitif une fois publié sur le Play Store : à confirmer avant publication.
  appId: 'com.afrikaisse.tablette',
  appName: 'AfriKaisse',
  webDir: '../web/dist',
  android: {
    appendUserAgent: 'AfriKaisseTablette',
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    SystemBars: {
      // WebView < Chromium 140 : posée sous les barres système avec une marge. Cette marge
      // montre le fond de fenêtre, mis au bleu AfriKaisse dans styles.xml.
      insetsHandling: 'native',
      // Icônes claires sur le bleu foncé de l'application.
      style: 'DARK',
    },
  },
};

export default config;
