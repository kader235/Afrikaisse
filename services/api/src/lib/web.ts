import { createReadStream, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Le serveur local sert lui-même l'application web : le PC du restaurant n'a besoin d'aucun
 * autre logiciel (pas d'Apache, pas d'IIS). Dans le Cloud, Apache s'en charge (DEPLOYMENT.md).
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Pages de l'application : aucun script ni ressource hors du serveur lui-même. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Menu client installable (§49) : manifeste et service worker servis par le serveur lui-même.
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const notFound = (reply: FastifyReply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route introuvable.' } });

export function registerWebApp(app: FastifyInstance, dir: string) {
  const root = resolve(dir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`Application web introuvable : ${index}`);

  const send = (reply: FastifyReply, file: string, immutable: boolean) => {
    if (extname(file).toLowerCase() === '.html') reply.header('content-security-policy', CSP);
    return reply
      .header('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      // Fichiers de assets/ nommés par empreinte : cache définitif ; les pages, jamais en cache.
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(createReadStream(file));
  };

  app.get('/*', { schema: { hide: true } }, async (request, reply) => {
    let path: string;
    try {
      path = decodeURIComponent((request.params as { '*'?: string })['*'] ?? '');
    } catch {
      return notFound(reply);
    }
    if (path === 'api' || path.startsWith('api/')) return notFound(reply);
    if (/^m\/[A-Za-z0-9_-]+\/?$/.test(path)) return send(reply, join(root, 'menu.html'), false);

    const file = normalize(join(root, path));
    if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) return send(reply, file, path.startsWith('assets/'));
    // Un fichier absent reste absent ; toute autre adresse est un écran de l'application.
    if (extname(path)) return notFound(reply);
    return send(reply, index, false);
  });
}

/** Adresses auxquelles les tablettes et téléphones du restaurant joignent ce serveur. */
export function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) continue;
      urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}
