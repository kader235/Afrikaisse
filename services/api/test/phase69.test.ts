import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { filesToPrune, type BackupFile } from '../src/lib/backup.ts';
import { PASSWORD, addMember, as, login, startApp, type TestApp } from './helpers.ts';

describe('§69 — sauvegardes du serveur local', () => {
  let dir: string;
  let database: AppDatabase;
  let local: TestApp;
  let cloud: TestApp;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'afk-sauvegarde-'));
    database = await createDatabase({ kind: 'sqlite', file: join(dir, 'afrikaisse.sqlite') });
    await migrateToLatest(database);
    const config = loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-de-test-'.padEnd(48, 'x'), AFK_BACKUP_DIR: join(dir, 'sauvegardes') });
    const { app, ctx } = await buildApp({ database, config });
    local = { app, ctx, clock: { offsetMs: 0 }, close: async () => app.close() };
    cloud = await startApp('sqlite');
  });
  afterAll(async () => {
    await local.close();
    await database.close();
    await cloud.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rotation : les 24 plus récentes, puis une par jour sur 30 jours', () => {
    const now = Date.now();
    const hour = 3_600_000;
    const files: BackupFile[] = [
      ...Array.from({ length: 72 }, (_, i) => ({ name: `h${i}`, size: 1, createdAt: now - i * hour })),
      ...Array.from({ length: 40 }, (_, i) => ({ name: `d${i}`, size: 1, createdAt: now - (4 + i) * 24 * hour })),
    ];
    const pruned = new Set(filesToPrune(files, now));
    const kept = files.filter((f) => !pruned.has(f.name));
    expect(pruned.size).toBeGreaterThan(0);
    for (let i = 0; i < 24; i++) expect(pruned.has(`h${i}`)).toBe(false);
    expect(kept.filter((f) => now - f.createdAt > 30 * 24 * hour)).toEqual([]);
    const older = kept.filter((f) => !/^h(\d|1\d|2[0-3])$/.test(f.name));
    expect(new Set(older.map((f) => new Date(f.createdAt).toDateString())).size).toBe(older.length);
  });

  it('sauvegarde cohérente et vérifiée, listée ; réservée aux administrateurs ; absente du Cloud', async () => {
    const reg = await local.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Maquis Sauvegarde', locationName: 'Maquis Centre', ownerName: 'Patron Sauvegarde', email: 'patron@sauvegarde.td', password: PASSWORD },
    });
    expect(reg.statusCode).toBe(201);
    const owner = as(local, reg.json().accessToken);

    const made = await owner.post('/api/system/backups');
    expect(made.statusCode).toBe(201);
    const file = join(dir, 'sauvegardes', made.json().name);
    expect(existsSync(file)).toBe(true);

    const { DatabaseSync } = await import('node:sqlite');
    const copy = new DatabaseSync(file, { readOnly: true });
    expect((copy.prepare('select name from tenants').get() as { name: string }).name).toBe('Maquis Sauvegarde');
    copy.close();

    const list = (await owner.get('/api/system/backups')).json();
    expect(list.enabled).toBe(true);
    expect(list.files[0].name).toBe(made.json().name);
    expect((await owner.get('/api/audit')).json().some((a: { action: string }) => a.action === 'system.backup')).toBe(true);

    const manager = as(local, (await login(local, (await addMember(local, reg.json().accessToken, 'MANAGER')).email)).json().accessToken);
    expect((await manager.post('/api/system/backups')).statusCode).toBe(403);

    const cloudOwner = await cloud.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Groupe Cloud', locationName: 'Cloud Centre', ownerName: 'Patron Cloud', email: 'patron@cloud-sauvegarde.td', password: PASSWORD },
    });
    const remote = as(cloud, cloudOwner.json().accessToken);
    expect((await remote.get('/api/system/backups')).json()).toEqual({ enabled: false, dir: null, files: [] });
    expect((await remote.post('/api/system/backups')).statusCode).toBe(409);
  });
});
