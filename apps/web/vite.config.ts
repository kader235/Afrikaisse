import { resolve } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** `/m/<jeton>` sert la page du menu client (en production : règle de réécriture du serveur web). */
function menuRoute(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url && /^\/m\/[A-Za-z0-9_-]+\/?(\?.*)?$/.test(req.url)) req.url = '/menu.html';
    next();
  };
  return {
    name: 'afrikaisse-menu-route',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig({
  plugins: [react(), menuRoute()],
  build: {
    // Beaucoup de téléphones et tablettes de restaurant embarquent une WebView
    // ancienne (Chrome 83 constaté au Tchad) : on n'émet pas de syntaxe récente.
    target: 'es2019',
    cssTarget: 'chrome80',
    rollupOptions: {
      // Deux applications : le logiciel de gestion et le menu client, bundles séparés.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        menu: resolve(import.meta.dirname, 'menu.html'),
      },
      output: {
        // React partagé entre les deux applications, mis en cache une seule fois par le téléphone.
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client'] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.AFK_API_URL ?? 'http://127.0.0.1:4300' },
  },
});
