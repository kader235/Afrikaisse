import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Beaucoup de téléphones et tablettes de restaurant embarquent une WebView
    // ancienne (Chrome 83 constaté au Tchad) : on n'émet pas de syntaxe récente.
    target: 'es2019',
    cssTarget: 'chrome80',
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.AFK_API_URL ?? 'http://127.0.0.1:4300' },
  },
});
