/*
 * Service worker du menu client AfriKaisse (§49). Portée : /m/ (pages des tables).
 *
 * - page du menu (même HTML pour toutes les tables) : réseau d'abord, copie de secours hors ligne ;
 * - fichiers nommés par empreinte (/assets/), icônes et photos (/api/media/) : cache d'abord ;
 * - menu d'une table (/api/public/menu/<jeton>) : copie immédiate puis mise à jour en arrière-plan,
 *   la page est prévenue si la carte a changé ;
 * - tout le reste (commandes, suivi, appels) : réseau seulement, jamais servi depuis le cache.
 * Caches bornés en nombre d'entrées, réponses de plus de 1 Mo ignorées (forfaits data limités).
 * Pas de syntaxe plus récente que Chrome 80 : ce fichier n'est pas transpilé.
 */
'use strict';

const VERSION = 'v1';
const PREFIX = 'afk-menu-';
const SHELL = PREFIX + 'shell-' + VERSION;
const STATIC = PREFIX + 'static-' + VERSION;
const IMAGES = PREFIX + 'images-' + VERSION;
const DATA = PREFIX + 'data-' + VERSION;
const CURRENT = [SHELL, STATIC, IMAGES, DATA];
const LIMITS = { [SHELL]: 1, [STATIC]: 40, [IMAGES]: 80, [DATA]: 5 };
const MAX_BYTES = 1024 * 1024;
const SHELL_KEY = '/m/__page';
const MENU_PAGE = /^\/m\/[A-Za-z0-9_-]+\/?$/;
const MENU_DATA = /^\/api\/public\/menu\/[A-Za-z0-9_-]{16,64}$/;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf(PREFIX) === 0 && CURRENT.indexOf(k) < 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function storable(res) {
  if (!res || !res.ok || res.type !== 'basic') return false;
  const length = Number(res.headers.get('content-length') || 0);
  return length <= MAX_BYTES;
}

/** Les plus anciennes entrées partent en premier (ordre d'insertion). */
function trim(cache, max) {
  return cache.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k))));
}

function put(cacheName, key, res) {
  return caches.open(cacheName).then((cache) => cache.put(key, res).then(() => trim(cache, LIMITS[cacheName])));
}

function kindOf(url) {
  const path = url.pathname;
  if (MENU_PAGE.test(path)) return 'page';
  if (path.indexOf('/assets/') === 0 || /^\/m\/icon-[a-z0-9-]+\.png$/.test(path) || path === '/favicon.svg') return STATIC;
  if (path.indexOf('/api/media/') === 0) return IMAGES;
  if (MENU_DATA.test(path)) return DATA;
  return null;
}

function page(event) {
  return fetch(event.request)
    .then((res) => {
      if (storable(res)) event.waitUntil(put(SHELL, SHELL_KEY, res.clone()));
      return res;
    })
    .catch(() =>
      caches
        .open(SHELL)
        .then((cache) => cache.match(SHELL_KEY))
        .then((hit) => hit || new Response('<!doctype html><meta charset="utf-8"><title>Menu</title><p>Hors connexion.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })),
    );
}

function cacheFirst(event, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (storable(res)) event.waitUntil(put(cacheName, event.request, res.clone()));
          return res;
        }),
    ),
  );
}

function notifyUpdated(url) {
  return self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((client) => client.postMessage({ type: 'afk-menu-updated', url })));
}

function staleWhileRevalidate(event) {
  return caches.open(DATA).then((cache) =>
    cache.match(event.request).then((hit) => {
      const before = hit ? hit.clone() : null;
      const network = fetch(event.request).then((res) => {
        if (!storable(res)) return res;
        const copy = res.clone();
        const compare = copy.clone();
        event.waitUntil(
          Promise.all([before ? before.text() : Promise.resolve(null), compare.text()])
            .then((texts) => put(DATA, event.request, copy).then(() => (texts[0] !== null && texts[0] !== texts[1] ? notifyUpdated(event.request.url) : undefined)))
            .catch(() => undefined),
        );
        return res;
      });
      if (hit) {
        event.waitUntil(network.catch(() => undefined));
        return hit;
      }
      return network;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const kind = kindOf(url);
  if (request.mode === 'navigate') {
    if (kind === 'page') event.respondWith(page(event));
    return;
  }
  if (kind === STATIC || kind === IMAGES) event.respondWith(cacheFirst(event, kind));
  else if (kind === DATA) event.respondWith(staleWhileRevalidate(event));
});

/** La page signale ce qu'elle a chargé avant l'installation du service worker, pour l'avoir hors ligne. */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'afk-menu-warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    Promise.all(
      data.urls.slice(0, 60).map((raw) => {
        let url;
        try {
          url = new URL(raw, self.location.origin);
        } catch (err) {
          return null;
        }
        const kind = url.origin === self.location.origin ? kindOf(url) : null;
        if (!kind) return null;
        const cacheName = kind === 'page' ? SHELL : kind;
        const key = kind === 'page' ? SHELL_KEY : url.href;
        return caches
          .open(cacheName)
          .then((cache) => cache.match(key))
          .then((hit) => hit || fetch(url.href, { credentials: 'same-origin' }).then((res) => (storable(res) ? put(cacheName, key, res) : null)))
          .catch(() => null);
      }),
    ),
  );
});
