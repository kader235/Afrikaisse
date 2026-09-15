import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

type Credential = { displayName: string; role: string; email: string; password: string };

describe.each(ENGINES)('Restaurant de démonstration (§71) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('organisation de démonstration : 20 tables, postes, équipe, 14 jours de ventes, service du jour', { timeout: 240_000 }, async () => {
    // Back-office : seul un administrateur de la plateforme crée une démonstration.
    const admin = await registerOrg(t, 'Plateforme');
    await t.ctx.db.updateTable('users').set({ is_platform_admin: 1 }).where('email', '=', admin.email).execute();
    const created = await as(t, admin.token).post('/api/platform/demo-tenants', {});
    expect(created.statusCode).toBe(201);
    const demo = created.json();
    expect(demo.organizationName).toBe('AfriKaisse Demo Restaurant');
    expect(demo.status).toMatchObject({ zones: 2, tables: 20, stations: 3, categories: 6, products: 25, isDemo: true, complete: true });
    expect(demo.staff.map((s: Credential) => s.role).sort()).toEqual(['BAR', 'CASHIER', 'KITCHEN', 'MANAGER', 'STOCK_MANAGER', 'WAITER', 'WAITER']);

    // Identifiants générés : ils ouvrent vraiment une session, avec le bon rôle.
    const ownerLogin = await login(t, demo.owner.email, demo.owner.password);
    expect(ownerLogin.statusCode).toBe(200);
    expect(ownerLogin.json().me.tenant).toMatchObject({ isDemo: true, planExpiresAt: null });
    const owner = as(t, ownerLogin.json().accessToken);
    const cashierCred = demo.staff.find((s: Credential) => s.role === 'CASHIER');
    const cashierLogin = await login(t, cashierCred.email, cashierCred.password);
    expect(cashierLogin.json().me.role).toBe('CASHIER');
    const loc = demo.locationId as string;

    // Salle, postes, carte avec photos.
    const floor = (await owner.get(`/api/locations/${loc}/floor`)).json();
    expect(floor.zones.map((z: { name: string }) => z.name)).toEqual(['Salle', 'Terrasse']);
    const menu = (await owner.get(`/api/locations/${loc}/menu`)).json();
    expect(menu.stations.map((s: { name: string }) => s.name)).toEqual(['Cuisine', 'Bar', 'Grill']);
    expect(menu.products.filter((p: { photoUrl: string | null }) => p.photoUrl).length).toBeGreaterThanOrEqual(20);
    const byName = (name: string) => menu.products.find((p: { name: string }) => p.name === name);
    const station = (name: string) => menu.stations.find((s: { name: string }) => s.name === name).id;
    expect(byName('Brochettes de bœuf').stationId).toBe(station('Grill'));
    expect(byName('Café Touba').stationId).toBe(station('Bar'));
    expect(byName('Classic Burger').modifierGroupIds).toHaveLength(3);

    // Statistiques réelles sur 15 journées.
    const today = businessDate(Date.now(), 'Africa/Ndjamena', 300);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
    const report = (await owner.get(`/api/locations/${loc}/reports/sales?from=${from}&to=${today}`)).json();
    expect(report.totals.revenue).toBeGreaterThan(0);
    expect(report.totals.collected).toBeGreaterThan(0);
    expect(report.totals.orders).toBeGreaterThan(100);
    expect(report.totals.cancelledCount).toBeGreaterThan(0);
    expect(report.byDay.filter((d: { revenue: number }) => d.revenue > 0).length).toBeGreaterThanOrEqual(14);
    expect(report.byMethod.map((m: { method: string }) => m.method)).toEqual(expect.arrayContaining(['CASH', 'MOBILE_MONEY']));
    expect(report.bySource.map((s: { source: string }) => s.source)).toEqual(expect.arrayContaining(['QR', 'POS', 'WAITER']));
    expect(report.topProducts.length).toBeGreaterThan(5);

    // Service en cours : tous les états, un appel « addition », la caisse du jour ouverte, les Z passés.
    const active = (await owner.get(`/api/locations/${loc}/orders?view=active`)).json();
    expect(new Set(active.map((o: { status: string }) => o.status))).toEqual(new Set(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED']));
    const requests = (await owner.get(`/api/locations/${loc}/requests`)).json();
    expect(requests.map((r: { kind: string }) => r.kind)).toEqual(['BILL']);
    expect((await owner.get(`/api/locations/${loc}/cash-session`)).json().session.status).toBe('OPEN');
    const sessions = (await owner.get(`/api/locations/${loc}/cash-sessions`)).json();
    expect(sessions.filter((s: { status: string }) => s.status === 'CLOSED')).toHaveLength(14);
    const todayReport = (await owner.get(`/api/locations/${loc}/reports/sales?from=${today}&to=${today}`)).json();
    expect(todayReport.totals.orders).toBeGreaterThan(0);

    // Une seule fois, isolée des autres organisations.
    expect((await owner.post(`/api/locations/${loc}/demo`)).statusCode).toBe(409);
    const actions = (await owner.get('/api/audit?limit=200')).json().map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['demo.tenant_created', 'demo.loaded']));
    const neighbour = as(t, (await registerOrg(t, 'DemoIsolee')).token);
    expect((await neighbour.get(`/api/locations/${loc}/orders`)).statusCode).toBe(404);
    expect((await neighbour.get(`/api/locations/${loc}/reports/sales?from=${from}&to=${today}`)).statusCode).toBe(404);
    expect((await neighbour.get('/api/team')).json()).toHaveLength(1);
    expect((await as(t, admin.token).get(`/api/locations/${loc}/setup`)).statusCode).toBe(404);
  });

  it('organisation ordinaire : configuration sans équipe ni ventes inventées ; droits', { timeout: 120_000 }, async () => {
    const org = await registerOrg(t, 'Ordinaire');
    const owner = as(t, org.token);
    const loc = org.me.locations[0].id as string;
    expect((await owner.post('/api/platform/demo-tenants', {})).statusCode).toBe(404);

    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.post(`/api/locations/${loc}/demo`)).statusCode).toBe(403);

    const loaded = await owner.post(`/api/locations/${loc}/demo`);
    expect(loaded.statusCode).toBe(201);
    expect(loaded.json()).toMatchObject({ zones: 2, tables: 20, stations: 3, products: 25, members: 2, orders: 0, cashSessions: 0, isDemo: false, staff: [] });
    expect((await owner.get('/api/team')).json()).toHaveLength(2);
    expect((await owner.post(`/api/locations/${loc}/demo`)).statusCode).toBe(409);
  });
});
