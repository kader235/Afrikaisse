import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { authenticate } from '../src/lib/access.ts';
import { ENGINES, PASSWORD, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/** Routes du back-office §67 : toutes doivent répondre 404 à un client, même avec un identifiant mal formé. */
const ROUTES: { method: 'GET' | 'POST'; url: (id: string) => string }[] = [
  { method: 'GET', url: () => '/api/platform/restaurants' },
  { method: 'GET', url: () => '/api/platform/restaurants?q=a' },
  { method: 'GET', url: () => '/api/platform/users' },
  { method: 'GET', url: () => '/api/platform/users?q=patron&limit=999' },
  { method: 'POST', url: (id) => `/api/platform/users/${id}/suspend` },
  { method: 'POST', url: (id) => `/api/platform/users/${id}/reactivate` },
  { method: 'POST', url: () => '/api/platform/users/pas-un-uuid/suspend' },
  { method: 'GET', url: () => '/api/platform/devices' },
  { method: 'GET', url: () => '/api/platform/sync' },
  { method: 'GET', url: () => '/api/platform/errors' },
  { method: 'GET', url: () => '/api/platform/errors?limit=abc' },
  { method: 'GET', url: () => '/api/platform/stats' },
  { method: 'GET', url: () => '/api/platform/tenants' },
];

describe.each(ENGINES)('§67 — back-office GLOBALTECH (%s)', (engine) => {
  let t: TestApp;
  let staff: Awaited<ReturnType<typeof registerOrg>>;
  let admin: ReturnType<typeof as>;
  let client: Awaited<ReturnType<typeof registerOrg>>;

  beforeAll(async () => {
    t = await startApp(engine);
    // Route d'essai qui échoue avec des données personnelles dans le message (ajoutée avant le démarrage).
    t.app.get('/api/essai/panne/:token', async (request) => {
      request.auth = await authenticate(t.ctx, request);
      throw new Error('Échec pour awa.diallo@exemple.td avec le jeton abcdefghijklmnopqrstuvwxyz0123456789ABCD, tél. +235 66 12 34 56');
    });
    staff = await registerOrg(t, 'Globaltech');
    await t.ctx.db.updateTable('users').set({ is_platform_admin: 1 }).where('email', '=', staff.email).execute();
    admin = as(t, (await login(t, staff.email)).json().accessToken);
    client = await registerOrg(t, 'Maquis');
  });
  afterAll(async () => {
    await t.close();
  });

  it('restaurants, installations, synchronisations, erreurs et statistiques', async () => {
    const owner = as(t, client.token);
    const locationId = client.me.locations[0].id as string;
    const tenantId = client.me.tenant.id as string;

    // Une vraie vente encaissée.
    await owner.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 0 });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Boissons' })).json();
    menu = (await owner.post(`/api/categories/${menu.categories[0].id}/products`, { name: 'Bissap', price: 1500 })).json();
    const order = (await owner.post(`/api/locations/${locationId}/orders`, { serviceType: 'TAKEAWAY', lines: [{ productId: menu.products[0].id, quantity: 2 }] })).json();
    expect((await owner.post(`/api/locations/${locationId}/payments`, { target: { kind: 'order', id: order.id }, method: 'CASH', amount: 3000 })).statusCode).toBe(201);

    const restaurants = (await admin.get('/api/platform/restaurants')).json();
    const maquis = restaurants.find((r: { id: string }) => r.id === tenantId);
    expect(maquis).toMatchObject({ name: 'Groupe Maquis', status: 'ACTIVE', plan: 'TRIAL', subscriptionState: 'TRIAL', isDemo: false, members: 1 });
    expect(maquis.locations).toMatchObject([{ id: locationId, name: 'Maquis Centre', status: 'ACTIVE', operatingMode: 'CLOUD' }]);
    expect(maquis.lastActivityAt).toBeGreaterThan(0);
    expect(maquis.locations[0].lastActivityAt).toBeGreaterThan(0);
    expect((await admin.get('/api/platform/restaurants?q=MAQ')).json().map((r: { name: string }) => r.name)).toEqual(['Groupe Maquis']);
    expect((await admin.get('/api/platform/restaurants?q=%25')).json()).toHaveLength(2); // « % » ne sert pas de joker

    const users = (await admin.get(`/api/platform/users?q=${encodeURIComponent(client.email.slice(0, 12).toUpperCase())}`)).json();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: client.email, status: 'ACTIVE', isPlatformAdmin: false, memberships: [{ tenantId, tenantName: 'Groupe Maquis', role: 'OWNER', status: 'ACTIVE' }] });
    expect(users[0].lastSeenAt).toBeGreaterThan(0);
    expect(users[0].password_hash).toBeUndefined();

    // Un serveur local relié appelle le Cloud avec sa version et ses compteurs.
    const secret = 'secret-du-pc-comptoir-de-test';
    const deviceId = randomUUID();
    const now = t.ctx.now();
    await t.ctx.db
      .insertInto('devices')
      .values({ id: deviceId, tenant_id: tenantId, location_id: locationId, kind: 'LOCAL_SERVER', name: 'PC comptoir', status: 'ACTIVE', last_seen_at: null, created_at: now, updated_at: now, secret_hash: createHash('sha256').update(secret).digest('hex') })
      .execute();
    const device = { 'x-afk-device': deviceId, 'x-afk-device-secret': secret, 'x-afk-version': '0.9.1', 'x-afk-pending': '3', 'x-afk-failed': '1', 'x-afk-conflicts': '2' };
    expect((await t.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: device })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/sync/push', headers: device, payload: { events: [] } })).statusCode).toBe(200);
    // Mauvais secret : rien n'est enregistré.
    expect((await t.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: { ...device, 'x-afk-device-secret': 'faux', 'x-afk-version': '6.6.6' } })).statusCode).toBe(401);

    const devices = (await admin.get('/api/platform/devices')).json();
    expect(devices.find((d: { id: string }) => d.id === deviceId)).toMatchObject({ kind: 'LOCAL_SERVER', name: 'PC comptoir', status: 'ACTIVE', tenantName: 'Groupe Maquis', locationName: 'Maquis Centre', appVersion: '0.9.1' });
    expect(devices.some((d: { kind: string }) => d.kind === 'CLOUD')).toBe(false);
    const sync = (await admin.get('/api/platform/sync')).json();
    expect(sync).toHaveLength(1);
    expect(sync[0]).toMatchObject({ deviceId, pending: 3, failed: 1, conflicts: 2, cloudConflicts: 0, appVersion: '0.9.1' });
    expect(sync[0].lastPushAt).not.toBeNull();
    expect(sync[0].lastPullAt).not.toBeNull();

    // Erreur serveur : journalisée sans donnée personnelle, reliée à la réponse par l'identifiant de requête.
    const boom = await owner.get('/api/essai/panne/jeton-secret-dans-l-adresse');
    expect(boom.statusCode).toBe(500);
    expect(boom.json().error).toMatchObject({ code: 'INTERNAL', message: 'Erreur interne. Réessayez.' });
    const requestId = boom.json().error.details.requestId as string;
    const errors = (await admin.get('/api/platform/errors')).json();
    expect(errors[0]).toMatchObject({ requestId, method: 'GET', route: '/api/essai/panne/:token', status: 500, code: 'INTERNAL', tenantId, tenantName: 'Groupe Maquis' });
    expect(errors[0].message).not.toMatch(/awa|diallo|abcdefghijkl|66 12|jeton-secret/);
    expect((await admin.get(`/api/platform/errors?before=${errors[0].createdAt}`)).json()).toEqual([]);

    // Statistiques : organisations de démonstration exclues des ventes.
    await t.ctx.db.updateTable('tenants').set({ is_demo: 1 }).where('id', '=', staff.me.tenant.id).execute();
    const counted = ['PENDING', 'CANCELLED'].includes(order.status) ? 0 : 1;
    const stats = (await admin.get('/api/platform/stats')).json();
    expect(stats.tenants).toEqual({ total: 2, active: 1, suspended: 0, demo: 1 });
    expect(stats.locations).toEqual({ active: 1, hybrid: 0 });
    expect(stats.localServers.active).toBe(1);
    expect(stats.periods.map((p: { days: number }) => p.days)).toEqual([7, 30]);
    const currency = client.me.locations[0].currency;
    for (const period of stats.periods) {
      expect(period.currencies).toEqual([{ currency, orders: counted, revenue: counted * 3000, collected: 3000 }]);
      expect(period.activeLocations).toBe(counted);
    }
    await t.ctx.db.updateTable('tenants').set({ is_demo: 0 }).where('id', '=', staff.me.tenant.id).execute();
  });

  it('suspendre un compte : sessions révoquées, connexion refusée, changement envoyé aux serveurs locaux ; garde-fous', async () => {
    const { email } = await addMember(t, client.token, 'WAITER');
    const waiterLogin = (await login(t, email)).json();
    const waiter = as(t, waiterLogin.accessToken);
    const userId = waiterLogin.me.user.id as string;
    expect((await waiter.get('/api/auth/me')).statusCode).toBe(200);

    expect((await admin.post(`/api/platform/users/${userId}/suspend`)).statusCode).toBe(204);
    expect((await admin.post(`/api/platform/users/${userId}/suspend`)).statusCode).toBe(204); // idempotent
    expect([401, 403]).toContain((await waiter.get('/api/auth/me')).statusCode);
    expect((await login(t, email)).statusCode).not.toBe(200);
    const [listed] = (await admin.get(`/api/platform/users?q=${encodeURIComponent(email)}`)).json();
    expect(listed.status).toBe('DISABLED');

    const event = await t.ctx.db.selectFrom('sync_events').select(['payload', 'tenant_id']).where('entity_type', '=', 'user').where('entity_id', '=', userId).orderBy('seq', 'desc').executeTakeFirstOrThrow();
    expect(event.tenant_id).toBe(client.me.tenant.id);
    expect(JSON.parse(event.payload).status).toBe('DISABLED');
    const audit = (await as(t, client.token).get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(audit).toContain('platform.user_suspended');

    expect((await admin.post(`/api/platform/users/${userId}/reactivate`)).statusCode).toBe(204);
    expect((await login(t, email)).statusCode).toBe(200);

    expect((await admin.post(`/api/platform/users/${staff.me.user.id}/suspend`)).statusCode).toBe(409);
    const otherStaff = await addMember(t, staff.token, 'ADMIN');
    await t.ctx.db.updateTable('users').set({ is_platform_admin: 1 }).where('email', '=', otherStaff.email).execute();
    const otherId = (await login(t, otherStaff.email)).json().me.user.id;
    expect((await admin.post(`/api/platform/users/${otherId}/suspend`)).statusCode).toBe(409);
    expect((await admin.post(`/api/platform/users/${randomUUID()}/suspend`)).statusCode).toBe(404);
    expect((await admin.post('/api/platform/users/pas-un-uuid/suspend')).statusCode).toBe(400);
  });

  it('propriétaire, responsable ou anonyme : 404 ou 401 partout, sans aucune donnée', async () => {
    const owner = as(t, client.token);
    const manager = as(t, (await login(t, (await addMember(t, client.token, 'MANAGER')).email)).json().accessToken);
    const targetId = client.me.user.id as string;
    for (const who of [owner, manager]) {
      for (const route of ROUTES) {
        const res = route.method === 'GET' ? await who.get(route.url(targetId)) : await who.post(route.url(targetId));
        expect(res.statusCode, `${route.method} ${route.url(targetId)}`).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
        expect(res.body).not.toContain('Groupe');
      }
    }
    for (const route of ROUTES) {
      const res = await t.app.inject({ method: route.method, url: route.url(targetId) });
      expect(res.statusCode).toBe(401);
    }
    // La suspension demandée par un client n'a rien changé.
    expect((await login(t, client.email)).statusCode).toBe(200);
  });
});

describe('§67 — back-office absent du serveur local', () => {
  it('404 même pour un compte marqué back-office', async () => {
    const database = await createDatabase({ kind: 'sqlite', file: ':memory:' });
    await migrateToLatest(database);
    const { app, ctx } = await buildApp({ database, config: loadConfig({ AFK_PROFILE: 'local', AFK_JWT_SECRET: 'secret-de-test-'.padEnd(48, 'x') }) });
    try {
      const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { organizationName: 'Maquis Local', locationName: 'Centre', ownerName: 'Patron', email: 'patron@local-platform.td', password: PASSWORD } });
      await ctx.db.updateTable('users').set({ is_platform_admin: 1 }).execute();
      const relog = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'patron@local-platform.td', password: PASSWORD } });
      const headers = { authorization: `Bearer ${relog.json().accessToken}` };
      void reg;
      for (const route of ROUTES) {
        const res = await app.inject({ method: route.method, url: route.url(randomUUID()), headers });
        expect(res.statusCode).toBe(404);
      }
    } finally {
      await app.close();
      await database.close();
    }
  });
});
