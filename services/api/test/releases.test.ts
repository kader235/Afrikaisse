import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, compareSemver, parseSemver, releaseManifestSchema, type ReleaseManifest } from '@afrikaisse/core';
import { createDatabase, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { generateReleaseKeys, publicKeyOf, signRelease, verifyRelease } from '../src/lib/releases.ts';
import { latestRelease, publishRelease } from '../src/services/releases.ts';
import type { SyncTransport } from '../src/services/sync/client.ts';
import { ENGINES, PASSWORD, addMember, as, login, startApp, type TestApp } from './helpers.ts';

const SHA = 'a'.repeat(64);
const manifest = (version: string, extra: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  channel: 'stable',
  version,
  releasedAt: Date.UTC(2026, 8, 15),
  notes: `Version ${version} : corrections.`,
  downloadUrl: `https://afrikaisse.dametta.com/telechargements/AfriKaisse-Setup-${version}.exe`,
  sha256: SHA,
  ...extra,
});

describe('§73 — versions (semver) et signature Ed25519', () => {
  it('compare les versions selon semver 2.0, pas dans l’ordre alphabétique', () => {
    const ordered = ['0.1.0', '0.9.0', '0.10.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i]!, ordered[i + 1]!)).toBe(-1);
      expect(compareSemver(ordered[i + 1]!, ordered[i]!)).toBe(1);
    }
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.3+build.7', '1.2.3+autre')).toBe(0);
    expect(parseSemver('01.0.0')).toBeNull();
    expect(parseSemver('1.0')).toBeNull();
    expect(() => compareSemver('v1.0.0', '1.0.0')).toThrow();
  });

  it('signature valide seulement pour ces champs exacts et cette clé', () => {
    const keys = generateReleaseKeys();
    expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey);
    const signed = signRelease(manifest('1.2.0'), keys.privateKey);
    expect(verifyRelease(signed, keys.publicKey)).toBe(true);

    for (const tampered of [{ notes: 'autre' }, { version: '1.2.1' }, { downloadUrl: 'https://pirate.example/AfriKaisse.exe' }, { sha256: 'b'.repeat(64) }, { releasedAt: signed.releasedAt + 1 }, { channel: 'beta' as const }]) {
      expect(verifyRelease({ ...signed, ...tampered }, keys.publicKey)).toBe(false);
    }
    expect(verifyRelease(signed, generateReleaseKeys().publicKey)).toBe(false);
    expect(verifyRelease(signed, 'pas-une-cle')).toBe(false);
    expect(verifyRelease({ ...signed, signature: 'AAAA' }, keys.publicKey)).toBe(false);
  });

  it('annonce refusée : lien non https, empreinte mal formée, version illisible', () => {
    expect(releaseManifestSchema.safeParse(manifest('1.0.0')).success).toBe(true);
    expect(releaseManifestSchema.safeParse(manifest('1.0.0', { downloadUrl: 'http://x.example/a.exe' })).success).toBe(false);
    expect(releaseManifestSchema.safeParse(manifest('1.0.0', { sha256: 'ABC' })).success).toBe(false);
    expect(releaseManifestSchema.safeParse(manifest('version-1')).success).toBe(false);
  });
});

describe.each(ENGINES)('§73 — annonce du Cloud et vérification par le serveur local (%s)', (engine) => {
  const keys = generateReleaseKeys();
  let cloud: TestApp;
  let local: TestApp;
  let localDb: AppDatabase;
  let tamper: ((body: any) => any) | null = null;
  let offline = false;

  beforeAll(async () => {
    cloud = await startApp(engine);
    const transport: SyncTransport = async ({ method, url, headers }) => {
      if (offline) throw new Error('réseau coupé');
      const u = new URL(url);
      const res = await cloud.app.inject({ method, url: u.pathname + u.search, headers });
      const body = res.body ? res.json() : null;
      return { status: res.statusCode, body: tamper && res.statusCode === 200 ? tamper(body) : body };
    };
    localDb = await createDatabase({ kind: 'sqlite', file: ':memory:' });
    await migrateToLatest(localDb);
    const config = loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-local-de-test-'.padEnd(48, 'y'), AFK_RELEASE_PUBLIC_KEY: keys.publicKey, AFK_UPDATE_URL: 'https://cloud.test' });
    const { app, ctx } = await buildApp({ database: localDb, config, syncTransport: transport });
    local = { app, ctx, clock: { offsetMs: 0 }, close: async () => app.close() };
  });
  afterAll(async () => {
    await local.close();
    await localDb.close();
    await cloud.close();
  });

  it('le Cloud sert la plus haute version signée, sans connexion ; doublon refusé', async () => {
    const empty = await cloud.app.inject({ method: 'GET', url: '/api/public/releases/latest' });
    expect(empty.statusCode).toBe(404);

    for (const v of ['0.2.0', '0.10.0', '0.9.0']) await publishRelease(cloud.ctx.db, signRelease(manifest(v), keys.privateKey), Date.now());
    await expect(publishRelease(cloud.ctx.db, signRelease(manifest('0.9.0'), keys.privateKey), Date.now())).rejects.toBeInstanceOf(AppError);

    const res = await cloud.app.inject({ method: 'GET', url: '/api/public/releases/latest?channel=stable' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.json().version).toBe('0.10.0');
    expect(verifyRelease(res.json(), keys.publicKey)).toBe(true);
    expect((await cloud.app.inject({ method: 'GET', url: '/api/public/releases/latest?channel=beta' })).statusCode).toBe(404);
    expect((await cloud.app.inject({ method: 'GET', url: '/api/public/releases/latest?channel=nuit' })).statusCode).toBe(400);
    expect((await latestRelease(cloud.ctx.db, 'stable'))?.version).toBe('0.10.0');
  });

  it('le serveur local vérifie la signature, compare les versions, n’installe rien ; réservé aux administrateurs', async () => {
    const reg = await local.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Maquis Mise à jour', locationName: 'Centre', ownerName: 'Patron', email: `patron.maj.${engine}@test.td`, password: PASSWORD },
    });
    expect(reg.statusCode).toBe(201);
    const owner = as(local, reg.json().accessToken);

    const before = (await owner.get('/api/system/update')).json();
    expect(before).toMatchObject({ enabled: true, currentVersion: local.ctx.version, channel: 'stable', latest: null, updateAvailable: false, lastCheckAt: null, lastError: null });

    const checked = await owner.post('/api/system/update/check');
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({ updateAvailable: true, lastError: null, latest: { version: '0.10.0', sha256: SHA } });
    expect(checked.json().latest.signature).toBeUndefined();

    // Annonce modifiée en chemin : refusée, la dernière annonce vérifiée reste affichée.
    tamper = (body) => ({ ...body, downloadUrl: 'https://pirate.example/AfriKaisse.exe' });
    const forged = (await owner.post('/api/system/update/check')).json();
    expect(forged.lastError).toContain('Signature');
    expect(forged.latest.downloadUrl).not.toContain('pirate');
    tamper = null;

    offline = true;
    expect((await owner.post('/api/system/update/check')).json().lastError).toContain('injoignable');
    offline = false;
    expect((await owner.post('/api/system/update/check')).json().lastError).toBeNull();

    const manager = as(local, (await login(local, (await addMember(local, reg.json().accessToken, 'MANAGER')).email)).json().accessToken);
    expect((await manager.get('/api/system/update')).statusCode).toBe(403);
    expect((await manager.post('/api/system/update/check')).statusCode).toBe(403);
    expect((await local.app.inject({ method: 'GET', url: '/api/system/update' })).statusCode).toBe(401);
  });

  it('version déjà à jour ; sans clé embarquée la vérification est impossible ; le Cloud ne cherche pas de mise à jour', async () => {
    const db = await createDatabase({ kind: 'sqlite', file: ':memory:' });
    await migrateToLatest(db);
    const transport: SyncTransport = async () => ({ status: 200, body: signRelease(manifest('0.0.9'), keys.privateKey) });
    const make = async (env: Record<string, string>) => buildApp({ database: db, config: loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-local-de-test-'.padEnd(48, 'z'), AFK_UPDATE_URL: 'https://cloud.test', ...env }), syncTransport: transport });
    try {
      const { app, ctx } = await make({ AFK_RELEASE_PUBLIC_KEY: keys.publicKey });
      const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: 'Bar à jour', locationName: 'Centre', ownerName: 'Patronne', email: `patronne.${engine}@test.td`, password: PASSWORD } });
      const tok = { authorization: `Bearer ${reg.json().accessToken}` };
      const res = (await app.inject({ method: 'POST', url: '/api/system/update/check', headers: tok })).json();
      expect(res).toMatchObject({ updateAvailable: false, latest: { version: '0.0.9' }, lastError: null });
      await app.close();

      const noKey = await make({});
      expect(noKey.ctx.config.releasePublicKey).toBe('');
      const login2 = await noKey.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `patronne.${engine}@test.td`, password: PASSWORD } });
      const tok2 = { authorization: `Bearer ${login2.json().accessToken}` };
      const status = (await noKey.app.inject({ method: 'POST', url: '/api/system/update/check', headers: tok2 })).json();
      expect(status.enabled).toBe(false);
      expect(status.lastError).toContain('clé');
      await noKey.app.close();
      void ctx;
    } finally {
      await db.close();
    }

    const cloudOwner = await cloud.app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: 'Groupe Cloud MAJ', locationName: 'Centre', ownerName: 'Patron', email: `cloud.maj.${engine}@test.td`, password: PASSWORD } });
    const remote = as(cloud, cloudOwner.json().accessToken);
    expect((await remote.post('/api/system/update/check')).statusCode).toBe(409);
    expect((await remote.get('/api/system/update')).json().enabled).toBe(false);
  });
});
