import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONITORING_THRESHOLDS, ageState, worstState } from '@afrikaisse/core';
import { createDatabase, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { captureError, scrubMessage } from '../src/lib/errorLog.ts';
import { RotatingFile, categoryFileStream } from '../src/lib/logger.ts';
import { ENGINES, PASSWORD, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const MIN = 60_000;

describe('§68 et §74 — règles d’état, journaux par catégorie, journal d’erreurs', () => {
  it('états : le plus grave l’emporte ; signe de vie récent, en retard, absent', () => {
    expect(worstState([])).toBe('NONE');
    expect(worstState(['NONE', 'OK'])).toBe('OK');
    expect(worstState(['OK', 'WARN', 'NONE'])).toBe('WARN');
    expect(worstState(['WARN', 'ERROR', 'OK'])).toBe('ERROR');
    const now = 1_000_000_000;
    expect(ageState(now - 10_000, now, MIN, 10 * MIN)).toBe('OK');
    expect(ageState(now - 5 * MIN, now, MIN, 10 * MIN)).toBe('WARN');
    expect(ageState(now - 11 * MIN, now, MIN, 10 * MIN)).toBe('ERROR');
    expect(ageState(null, now, MIN, 10 * MIN)).toBe('ERROR');
  });

  it('rotation par taille et par jour, nombre d’archives borné, anciennes supprimées', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afk-journaux-'));
    try {
      let now = Date.UTC(2026, 8, 15, 10);
      const file = new RotatingFile(dir, 'sync', { maxBytes: 200, keep: 3, maxAgeMs: 2 * 24 * 3600_000 }, () => now);
      for (let i = 0; i < 40; i++) file.write(`{"category":"sync","n":${i},"msg":"${'x'.repeat(40)}"}\n`);
      const names = readdirSync(dir).sort();
      expect(names).toEqual(['sync.1.log', 'sync.2.log', 'sync.3.log', 'sync.log']);
      for (const n of names) expect(readFileSync(join(dir, n), 'utf8').length).toBeLessThanOrEqual(200);
      expect(readFileSync(join(dir, 'sync.log'), 'utf8')).toContain('"n":39');

      // Jour suivant : nouveau fichier même s'il reste de la place.
      now += 24 * 3600_000;
      file.write('{"category":"sync","msg":"lendemain"}\n');
      expect(readFileSync(join(dir, 'sync.log'), 'utf8')).toBe('{"category":"sync","msg":"lendemain"}\n');
      file.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pino : chaque catégorie dans son fichier, application par défaut', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afk-categories-'));
    const stream = categoryFileStream(dir);
    const app = Fastify({ logger: { level: 'info', stream } });
    try {
      app.log.child({ category: 'sync' }).warn('Cloud injoignable');
      app.log.child({ category: 'security' }).warn({ code: 'TOO_MANY_ATTEMPTS' }, 'Trop d’essais');
      app.log.child({ category: 'printer' }).error('Imprimante hors ligne');
      app.log.info('sans catégorie');
      expect(readFileSync(join(dir, 'sync.log'), 'utf8')).toContain('Cloud injoignable');
      expect(readFileSync(join(dir, 'security.log'), 'utf8')).toContain('TOO_MANY_ATTEMPTS');
      expect(readFileSync(join(dir, 'printer.log'), 'utf8')).toContain('Imprimante hors ligne');
      expect(readFileSync(join(dir, 'application.log'), 'utf8')).toContain('sans catégorie');
      expect(existsSync(join(dir, 'database.log'))).toBe(false);
    } finally {
      await app.close();
      stream.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('message nettoyé (e-mail, jeton, numéro) ; table bornée', async () => {
    const cleaned = scrubMessage('Échec pour awa.diallo@exemple.td, jeton eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstu et téléphone +235 66 12 34 56');
    expect(cleaned).not.toMatch(/awa|eyJ|66 12/);
    expect(cleaned).toContain('[e-mail]');
    expect(cleaned).toContain('[jeton]');
    expect(cleaned).toContain('[nombre]');

    const t = await startApp('sqlite');
    try {
      for (let i = 0; i < 8; i++) {
        t.clock.offsetMs = i * 1000;
        await captureError(t.ctx, { requestId: `r${i}`, method: 'GET', route: '/api/x', status: 500, code: 'INTERNAL', message: `erreur ${i}`, tenantId: null }, 5);
      }
      const rows = await t.ctx.db.selectFrom('error_logs').select('request_id').orderBy('created_at').execute();
      expect(rows.map((r) => r.request_id)).toEqual(['r3', 'r4', 'r5', 'r6', 'r7']);
    } finally {
      await t.close();
    }
  });
});

describe.each(ENGINES)('§68-69 — supervision d’un établissement dans le Cloud (%s)', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('état réel : base, API, imprimantes, écrans cuisine, serveur local annoncé ; accès responsable seulement', async () => {
    t.clock.offsetMs = 0;
    const org = await registerOrg(t, 'Supervise');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const url = `/api/locations/${locationId}/monitoring`;

    const first = await owner.get(url);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      profile: 'cloud',
      overall: 'OK',
      api: { state: 'OK', version: t.ctx.version },
      database: { state: 'OK', engine: engine === 'pglite' ? 'postgres' : 'sqlite', error: null },
      cloud: { state: 'OK' },
      localServer: { state: 'NONE', mode: 'CLOUD', servers: [] },
      sync: { state: 'NONE' },
      printers: { state: 'NONE', items: [] },
      kds: { state: 'NONE', screens: [] },
      backup: { state: 'NONE', enabled: false },
    });

    // Imprimante : sans travail, normale ; un échec plus récent que le dernier succès la met en défaut.
    const printer = (await owner.post(`/api/locations/${locationId}/printers`, { name: 'Cuisine', host: '192.168.1.50' })).json();
    expect((await owner.get(url)).json().printers).toMatchObject({ state: 'OK', items: [{ id: printer.id, state: 'OK', pendingJobs: 0 }] });
    const now = t.ctx.now();
    const job = (status: 'PENDING' | 'SENT' | 'FAILED', createdAt: number, extra: object = {}) =>
      t.ctx.db
        .insertInto('print_jobs')
        .values({ id: randomUUID(), tenant_id: org.me.tenant.id, location_id: locationId, printer_id: printer.id, kind: 'TEST', status, payload: '', attempts: 1, last_error: null, order_id: null, next_attempt_at: createdAt, created_at: createdAt, sent_at: null, ...extra })
        .execute();
    await job('SENT', now - 10 * MIN, { sent_at: now - 10 * MIN });
    await job('PENDING', now - 2 * MIN);
    let printers = (await owner.get(url)).json().printers;
    expect(printers).toMatchObject({ state: 'WARN', items: [{ state: 'WARN', pendingJobs: 1, lastSuccessAt: now - 10 * MIN }] });
    await job('FAILED', now - MIN, { last_error: 'Délai dépassé' });
    printers = (await owner.get(url)).json().printers;
    expect(printers).toMatchObject({ state: 'ERROR', items: [{ state: 'ERROR', lastFailureAt: now - MIN, lastError: 'Délai dépassé' }] });
    expect((await owner.get(url)).json().overall).toBe('ERROR');

    // Écran cuisine : signe de vie du cuisinier, puis silence.
    const cook = as(t, (await login(t, (await addMember(t, org.token, 'KITCHEN')).email)).json().accessToken);
    const screenId = randomUUID();
    const stations = (await owner.get(`/api/locations/${locationId}/stations`)).json();
    expect((await cook.post(`/api/locations/${locationId}/screens/heartbeat`, { screenId, stationId: stations[0].id })).statusCode).toBe(204);
    expect((await cook.post(`/api/locations/${locationId}/screens/heartbeat`, { screenId, stationId: stations[0].id })).statusCode).toBe(204);
    expect((await owner.get(url)).json().kds).toMatchObject({ state: 'OK', screens: [{ id: screenId, stationName: stations[0].name, state: 'OK' }] });
    t.clock.offsetMs = 5 * MIN;
    expect((await owner.get(url)).json().kds).toMatchObject({ state: 'WARN', screens: [{ state: 'WARN' }] });
    // 12 min : au-delà du seuil de 10 min, en deçà de la durée du jeton d'accès (15 min).
    t.clock.offsetMs = 12 * MIN;
    expect((await owner.get(url)).json().kds.state).toBe('ERROR');
    t.clock.offsetMs = 0;

    // Serveur local relié : le Cloud voit son dernier appel, sa version et ses compteurs.
    const secret = 'secret-du-serveur-local-de-test';
    const deviceId = randomUUID();
    await t.ctx.db
      .insertInto('devices')
      .values({ id: deviceId, tenant_id: org.me.tenant.id, location_id: locationId, kind: 'LOCAL_SERVER', name: 'PC comptoir', status: 'ACTIVE', last_seen_at: null, created_at: now, updated_at: now, secret_hash: createHash('sha256').update(secret).digest('hex') })
      .execute();
    await t.ctx.db.updateTable('locations').set({ operating_mode: 'HYBRID' }).where('id', '=', locationId).execute();
    const pull = await t.app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=0',
      headers: { 'x-afk-device': deviceId, 'x-afk-device-secret': secret, 'x-afk-version': '0.9.1', 'x-afk-pending': '4', 'x-afk-failed': '0', 'x-afk-conflicts': 'pas-un-nombre' },
    });
    expect(pull.statusCode).toBe(200);
    let m = (await owner.get(url)).json();
    expect(m.localServer).toMatchObject({ state: 'OK', mode: 'HYBRID', servers: [{ id: deviceId, name: 'PC comptoir', state: 'OK', appVersion: '0.9.1' }] });
    expect(m.sync).toMatchObject({ state: 'OK', paired: true, pending: 4, failed: 0, conflicts: 0 });
    expect(m.sync.lastSuccessAt).not.toBeNull();
    t.clock.offsetMs = 12 * MIN;
    m = (await owner.get(url)).json();
    expect(m.localServer.state).toBe('ERROR');
    expect(m.sync.state).toBe('ERROR');
    t.clock.offsetMs = 0;

    // Accès : propriétaire, administrateur, responsable. Pas le cuisinier, le serveur ni le caissier.
    const manager = as(t, (await login(t, (await addMember(t, org.token, 'MANAGER')).email)).json().accessToken);
    expect((await manager.get(url)).statusCode).toBe(200);
    for (const role of ['WAITER', 'CASHIER']) {
      const member = as(t, (await login(t, (await addMember(t, org.token, role)).email)).json().accessToken);
      expect((await member.get(url)).statusCode).toBe(403);
    }
    expect((await cook.get(url)).statusCode).toBe(403);
    const stock = as(t, (await login(t, (await addMember(t, org.token, 'STOCK_MANAGER')).email)).json().accessToken);
    expect((await stock.post(`/api/locations/${locationId}/screens/heartbeat`, { screenId: randomUUID() })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await owner.get('/api/locations/pas-un-uuid/monitoring')).statusCode).toBe(400);

    // Autre organisation : rien, ni lecture ni écran usurpé.
    const other = await registerOrg(t, 'Voisin');
    const neighbour = as(t, other.token);
    expect((await neighbour.get(url)).statusCode).toBe(404);
    expect((await neighbour.post(`/api/locations/${locationId}/screens/heartbeat`, { screenId: randomUUID() })).statusCode).toBe(404);
    const otherLocation = other.me.locations[0].id as string;
    expect((await neighbour.post(`/api/locations/${otherLocation}/screens/heartbeat`, { screenId })).statusCode).toBe(404);
    expect((await neighbour.post(`/api/locations/${otherLocation}/screens/heartbeat`, { screenId: randomUUID(), stationId: stations[0].id })).statusCode).toBe(404);
  });
});

describe('§68-69 — supervision du serveur local', () => {
  let dir: string;
  let database: AppDatabase;
  let local: TestApp;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'afk-supervision-'));
    database = await createDatabase({ kind: 'sqlite', file: join(dir, 'afrikaisse.sqlite') });
    await migrateToLatest(database);
    const config = loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-de-test-'.padEnd(48, 'x'), AFK_BACKUP_DIR: join(dir, 'sauvegardes') });
    const { app, ctx } = await buildApp({ database, config });
    local = { app, ctx, clock: { offsetMs: 0 }, close: async () => app.close() };
  });
  afterAll(async () => {
    await local.close();
    await database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('dernière sauvegarde, liaison au Cloud, erreurs de synchronisation, ce serveur', async () => {
    const reg = await local.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Maquis Supervision', locationName: 'Centre', ownerName: 'Patron', email: 'patron@supervision.td', password: PASSWORD },
    });
    const owner = as(local, reg.json().accessToken);
    const url = `/api/locations/${reg.json().me.locations[0].id}/monitoring`;

    let m = (await owner.get(url)).json();
    expect(m).toMatchObject({ profile: 'local', cloud: { state: 'NONE' }, sync: { state: 'NONE', paired: false }, backup: { state: 'ERROR', enabled: true, lastAt: null } });
    expect(m.localServer).toMatchObject({ state: 'OK', servers: [{ id: local.ctx.nodeId, state: 'OK', appVersion: local.ctx.version }] });
    expect(m.overall).toBe('ERROR');

    const backup = (await owner.post('/api/system/backups')).json();
    m = (await owner.get(url)).json();
    expect(m.backup).toMatchObject({ state: 'OK', lastName: backup.name });
    expect(m.overall).toBe('OK');

    // Relié au Cloud : contact récent, puis erreur de liaison et événements en attente.
    const set = (key: string, value: string) => database.db.insertInto('node_state').values({ key, value }).onConflict((oc) => oc.column('key').doUpdateSet({ value })).execute();
    await set('sync_device_id', randomUUID());
    await set('sync_cloud_url', 'https://cloud.test');
    await set('sync_last_push_at', String(Date.now()));
    m = (await owner.get(url)).json();
    expect(m.cloud).toMatchObject({ state: 'OK', url: 'https://cloud.test', error: null });
    expect(m.sync.state).toBe('OK');
    expect(m.sync.pending).toBeGreaterThan(0); // l'inscription a écrit des événements à envoyer

    await set('sync_last_error', 'AfriKaisse Cloud injoignable : réseau coupé');
    m = (await owner.get(url)).json();
    expect(m.cloud).toMatchObject({ state: 'WARN', error: 'AfriKaisse Cloud injoignable : réseau coupé' });
    await set('sync_last_push_at', String(Date.now() - MONITORING_THRESHOLDS.heartbeatWarnMs - MIN));
    m = (await owner.get(url)).json();
    expect(m.cloud.state).toBe('ERROR');
    expect(m.sync.state).toBe('ERROR');
    expect(m.overall).toBe('ERROR');
  });
});
