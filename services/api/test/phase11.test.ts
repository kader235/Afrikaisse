import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers.ts';

describe('Phase 11 — serveur local : application web servie par l’API', () => {
  let t: TestApp;
  let cloud: TestApp;
  let web: string;

  beforeAll(async () => {
    web = mkdtempSync(join(tmpdir(), 'afk-web-'));
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>AfriKaisse</title><div id="app-racine"></div>');
    writeFileSync(join(web, 'menu.html'), '<!doctype html><title>Menu</title><div id="menu-racine"></div>');
    writeFileSync(join(web, 'assets', 'index-a1b2c3.js'), 'console.log("afrikaisse")');
    writeFileSync(join(web, 'afk-ping.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    t = await startApp('sqlite', { AFK_PROFILE: 'local', AFK_WEB_DIR: web });
    cloud = await startApp('sqlite');
  });
  afterAll(async () => {
    await t.close();
    await cloud.close();
    rmSync(web, { recursive: true, force: true });
  });

  const get = (app: TestApp, url: string) => app.app.inject({ method: 'GET', url });

  it('pages, fichiers et menu client servis avec le bon type et le bon cache', async () => {
    const home = await get(t, '/');
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.headers['cache-control']).toBe('no-cache');
    expect(home.body).toContain('app-racine');

    const asset = await get(t, '/assets/index-a1b2c3.js');
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    expect((await get(t, '/afk-ping.svg')).headers['content-type']).toBe('image/svg+xml');
    expect((await get(t, '/m/t8VSvUX0yinl7ighwE1fsQ')).body).toContain('menu-racine');
  });

  it('écrans de l’application (rechargement de page) → index.html ; fichier absent → 404', async () => {
    expect((await get(t, '/caisse')).body).toContain('app-racine');
    expect((await get(t, '/assets/absent.js')).statusCode).toBe(404);
  });

  it('jamais de fichier hors du dossier web, ni de page à la place d’une route API', async () => {
    for (const url of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%2f..%2findex.html%00']) {
      const res = await get(t, url);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('"workspaces"');
    }
    const api = await get(t, '/api/inconnue');
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
    expect((await get(t, '/api/health')).json().status).toBe('ok');
  });

  it('santé du serveur local : adresses du réseau pour les tablettes ; rien de tel dans le Cloud', async () => {
    const local = (await get(t, '/api/health')).json();
    expect(local.profile).toBe('local');
    expect(Array.isArray(local.lanUrls)).toBe(true);
    for (const url of local.lanUrls) expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);

    const remote = (await get(cloud, '/api/health')).json();
    expect(remote.lanUrls).toBeUndefined();
    expect((await get(cloud, '/')).statusCode).toBe(404);
  });
});
