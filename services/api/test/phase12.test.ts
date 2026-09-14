import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { SyncTransport } from '../src/services/sync/client.ts';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/**
 * Un vrai Cloud (SQLite ou PostgreSQL) et un vrai serveur local (SQLite), reliés par un
 * transport qui remplace le réseau : appairage, ventes hors ligne remontées, modifications
 * en ligne redescendues, rejeu sans doublon, QR en ligne d'un établissement hybride, sécurité.
 */
describe.each(ENGINES)('Phase 12 — synchronisation serveur local ↔ Cloud (%s)', (engine) => {
  let cloud: TestApp;
  let local: TestApp;
  let localDb: AppDatabase;

  beforeAll(async () => {
    cloud = await startApp(engine);
    const transport: SyncTransport = async ({ method, url, body, headers }) => {
      const u = new URL(url);
      const res = await cloud.app.inject({ method, url: u.pathname + u.search, headers, ...(body !== undefined && { payload: body as object }) });
      return { status: res.statusCode, body: res.body ? res.json() : null };
    };
    localDb = await createDatabase({ kind: 'sqlite', file: ':memory:' });
    await migrateToLatest(localDb);
    const config = loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-local-de-test-'.padEnd(48, 'y') });
    const { app, ctx } = await buildApp({ database: localDb, config, syncTransport: transport });
    local = { app, ctx, clock: { offsetMs: 0 }, close: async () => { await app.close(); await localDb.close(); } };
  });
  afterAll(async () => {
    await local.close();
    await cloud.close();
  });

  it('appairage, ventes locales remontées, modifications en ligne redescendues, rejeu, QR hybride, sécurité', async () => {
    // Le restaurant existe dans le Cloud.
    const org = await registerOrg(cloud, 'SyncResto');
    const owner = as(cloud, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const t1 = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T2' });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Boissons' })).json();
    menu = (await owner.post(`/api/categories/${menu.categories[0].id}/products`, { name: 'Jus', price: 1000 })).json();
    const jus = menu.products[0];
    const waiter = as(cloud, (await login(cloud, (await addMember(cloud, org.token, 'WAITER')).email)).json().accessToken);

    // Code d'appairage : responsable seulement.
    expect((await waiter.post(`/api/locations/${locationId}/pairing-code`)).statusCode).toBe(403);
    const { code } = (await owner.post(`/api/locations/${locationId}/pairing-code`)).json();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const pair = (body: object) => local.app.inject({ method: 'POST', url: '/api/system/sync/pair', payload: body });
    expect((await local.app.inject({ method: 'GET', url: '/api/health' })).json().configured).toBe(false);
    expect((await pair({ cloudUrl: 'https://cloud.test', code: 'AAAA-AAAA' })).statusCode).toBe(404);
    const paired = await pair({ cloudUrl: 'https://cloud.test/', code: code.toLowerCase() });
    expect(paired.statusCode).toBe(201);
    expect(paired.json()).toEqual({ organization: 'Groupe SyncResto', location: 'SyncResto Centre' });
    expect((await pair({ cloudUrl: 'https://cloud.test', code })).statusCode).toBe(403);
    expect((await local.app.inject({ method: 'GET', url: '/api/health' })).json().configured).toBe(true);
    expect((await owner.get('/api/locations')).json().find((l: { id: string }) => l.id === locationId).operatingMode).toBe('HYBRID');

    // Sur place, sans Internet : l'équipe du Cloud se connecte, la carte et les QR sont là.
    const localLogin = await login(local, org.email);
    expect(localLogin.statusCode).toBe(200);
    const lo = as(local, localLogin.json().accessToken);
    expect((await lo.get(`/api/locations/${locationId}/menu`)).json().products.map((p: { name: string }) => p.name)).toEqual(['Jus']);
    expect((await lo.get(`/api/locations/${locationId}/qr-codes`)).json().codes).toHaveLength(2);

    // Une vente locale remonte : commande, paiement, caisse.
    await lo.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 0 });
    const sale = (await lo.post(`/api/locations/${locationId}/orders`, { tableId: t1.id, lines: [{ productId: jus.id, quantity: 2 }] })).json();
    expect((await lo.post(`/api/locations/${locationId}/payments`, { target: { kind: 'order', id: sale.id }, method: 'CASH', amount: 2000 })).statusCode).toBe(201);
    const run = (await lo.post('/api/system/sync/now')).json();
    expect(run).toMatchObject({ conflicts: 0, status: { paired: true, pending: 0, lastError: null } });
    expect(run.pushed).toBeGreaterThanOrEqual(5);
    const cloudOrders = (await owner.get(`/api/locations/${locationId}/orders?view=today`)).json();
    expect(cloudOrders.map((o: { number: number; total: number; paymentStatus: string }) => [o.number, o.total, o.paymentStatus])).toEqual([[1, 2000, 'PAID']]);
    const report = (await owner.get(`/api/locations/${locationId}/reports/sales?from=${sale.businessDate}&to=${sale.businessDate}`)).json();
    expect(report.totals).toMatchObject({ revenue: 2000, collected: 2000 });

    // Une modification faite en ligne redescend.
    await owner.patch(`/api/products/${jus.id}`, { price: 1500 });
    const back = (await lo.post('/api/system/sync/now')).json();
    expect(back.pulled).toBeGreaterThan(0);
    expect((await lo.get(`/api/locations/${locationId}/menu`)).json().products[0].price).toBe(1500);

    // Rejeu complet (coupure pendant un envoi) : aucun doublon.
    await localDb.db.updateTable('sync_events').set({ status: 'PENDING' }).where('device_id', '=', local.ctx.nodeId).execute();
    expect((await lo.post('/api/system/sync/now')).json()).toMatchObject({ conflicts: 0, status: { pending: 0 } });
    expect((await owner.get(`/api/locations/${locationId}/orders?view=today`)).json()).toHaveLength(1);

    // QR en ligne d'un établissement hybride : numéroté 901, confirmé sur place, suivi en ligne.
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes.find((c: { tableLabel: string }) => c.tableLabel === 'T2').token;
    const placed = await cloud.app.inject({ method: 'POST', url: `/api/public/menu/${token}/orders`, payload: { clientToken: 'client-sync-0000000001', lines: [{ productId: jus.id, quantity: 1 }] } });
    expect(placed.statusCode).toBe(201);
    expect(placed.json().number).toBe(901);
    await lo.post('/api/system/sync/now');
    const pending = (await lo.get(`/api/locations/${locationId}/orders`)).json().find((o: { number: number }) => o.number === 901);
    expect(pending).toMatchObject({ status: 'PENDING', total: 1500, tableLabel: 'T2' });
    expect((await lo.post(`/api/orders/${pending.id}/status`, { status: 'CONFIRMED' })).statusCode).toBe(200);
    await lo.post('/api/system/sync/now');
    const tracked = (await cloud.app.inject({ method: 'GET', url: `/api/public/menu/${token}/orders?clientToken=client-sync-0000000001` })).json();
    expect(tracked[0].status).toBe('CONFIRMED');

    // Sécurité : secret faux, organisation voisine, élévation de droits.
    const state = Object.fromEntries((await localDb.db.selectFrom('node_state').selectAll().execute()).map((r) => [r.key, r.value]));
    const headers = { 'x-afk-device': state.sync_device_id!, 'x-afk-device-secret': state.sync_device_secret! };
    expect((await cloud.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: { ...headers, 'x-afk-device-secret': 'faux' } })).statusCode).toBe(401);

    const neighbour = await registerOrg(cloud, 'SyncVoisin');
    const forged = {
      eventId: randomUUID(),
      deviceId: headers['x-afk-device'],
      tenantId: neighbour.me.tenant.id,
      locationId: null,
      entityType: 'tenant',
      entityId: neighbour.me.tenant.id,
      operation: 'UPSERT',
      payload: { id: neighbour.me.tenant.id, name: 'Pirate' },
      hlc: '001789999999999-00000-forge',
      createdAt: Date.now(),
    };
    const malformed = await cloud.app.inject({ method: 'POST', url: '/api/sync/push', headers, payload: { events: [{ ...forged, eventId: 'pas-un-uuid' }] } });
    expect(malformed.statusCode).toBe(400);
    const refused = await cloud.app.inject({ method: 'POST', url: '/api/sync/push', headers, payload: { events: [forged] } });
    expect(refused.json().results?.[0]?.status, refused.body.slice(0, 600)).toBe('REJECTED');

    const ownerRow = await cloud.ctx.db.selectFrom('users').selectAll().where('id', '=', org.me.user.id).executeTakeFirstOrThrow();
    const escalate = { ...forged, eventId: randomUUID(), tenantId: org.me.tenant.id, entityType: 'user', entityId: ownerRow.id, payload: { ...ownerRow, is_platform_admin: 1, display_name: 'Patron renommé', updated_hlc: '001789999999999-00000-forge' } };
    const escalated = await cloud.app.inject({ method: 'POST', url: '/api/sync/push', headers, payload: { events: [escalate] } });
    expect(escalated.json().results?.[0]?.status, escalated.body.slice(0, 600)).toBe('APPLIED');
    const after = await cloud.ctx.db.selectFrom('users').select(['is_platform_admin', 'display_name']).where('id', '=', ownerRow.id).executeTakeFirstOrThrow();
    expect(after).toEqual({ is_platform_admin: 0, display_name: 'Patron renommé' });
  });
});
