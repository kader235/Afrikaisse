import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETUP_TEST_REASON, findLayoutIssues } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/** PNG 1 × 1 : une vraie image, acceptée par le contrôle de signature du serveur. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Step = { id: string; done: boolean; skipped: boolean };
const doneSteps = (s: { steps: Step[] }) => s.steps.filter((x) => x.done).map((x) => x.id);
const step = (s: { steps: Step[] }, id: string) => s.steps.find((x) => x.id === id);

describe.each(ENGINES)('Assistant de mise en route (§70) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('avancement calculé depuis les données, étapes passées, reprise et fin', async () => {
    const org = await registerOrg(t, 'Assistant');
    const owner = as(t, org.token);
    const loc = org.me.locations[0].id as string;
    const url = `/api/locations/${loc}/setup`;

    let s = (await owner.get(url)).json();
    expect(s).toMatchObject({ started: false, nextStep: 'restaurant', completedAt: null, hasLogo: false, hasAddress: false, stations: 2, members: 1, printers: 0, testDone: false, isDemo: false });
    expect(doneSteps(s)).toEqual(['stations']);
    expect(s.steps).toHaveLength(12);
    expect((await owner.post(`${url}/finish`)).statusCode).toBe(409);

    // 1. Restaurant : écrit par la route de l'établissement, puis validé.
    expect((await owner.patch(`/api/locations/${loc}`, { name: 'Assistant Centre', type: 'CAFE' })).statusCode).toBe(200);
    s = (await owner.post(`${url}/steps/restaurant`, { skipped: false })).json();
    expect(s).toMatchObject({ started: true, nextStep: 'logo' });
    expect(doneSteps(s)).toEqual(['restaurant', 'currency', 'stations']);

    // 2-3. Logo et adresse.
    const media = (await owner.post(`/api/locations/${loc}/media`, { contentType: 'image/png', dataBase64: PNG })).json();
    const patched = await owner.patch(`/api/locations/${loc}`, { logoMediaId: media.id, address: 'Avenue Charles de Gaulle', phone: '+235 66 00 00 00' });
    expect(patched.json()).toMatchObject({ logoMediaId: media.id, logoUrl: `/api/media/${media.id}` });
    s = (await owner.get(url)).json();
    expect(s).toMatchObject({ hasLogo: true, hasAddress: true, nextStep: 'categories' });

    // 5. Passée, puis faite pour de vrai : une étape faite n'est plus « passée ».
    s = (await owner.post(`${url}/steps/categories`, { skipped: true })).json();
    expect(step(s, 'categories')).toMatchObject({ done: false, skipped: true });
    expect(s.nextStep).toBe('products');
    await owner.post(`/api/locations/${loc}/categories`, { name: 'Plats' });
    const cat = (await owner.get(`/api/locations/${loc}/menu`)).json().categories[0].id;
    await owner.post(`/api/categories/${cat}/products`, { name: 'Riz gras', price: 2500 });
    s = (await owner.get(url)).json();
    expect(step(s, 'categories')).toMatchObject({ done: true, skipped: false });
    expect(s).toMatchObject({ categories: 1, products: 1, nextStep: 'tables' });

    // 7-10. Tables (QR compris) et un membre invité.
    await owner.post(`${url}/tables`, { zones: [{ name: 'Salle', count: 2 }] });
    await addMember(t, org.token, 'CASHIER');
    s = (await owner.get(url)).json();
    expect(doneSteps(s)).toEqual(['restaurant', 'logo', 'address', 'currency', 'categories', 'products', 'tables', 'qr', 'stations', 'users']);
    expect(s.nextStep).toBe('printers');

    // 11-12 passées : l'assistant peut se terminer.
    await owner.post(`${url}/steps/printers`, { skipped: true });
    expect((await owner.post(`${url}/finish`)).statusCode).toBe(409);
    s = (await owner.post(`${url}/steps/test`, { skipped: true })).json();
    expect(s.nextStep).toBeNull();
    const finished = await owner.post(`${url}/finish`);
    expect(finished.statusCode).toBe(200);
    expect(finished.json().completedAt).toBeTypeOf('number');
    const actions = (await owner.get('/api/audit?limit=100')).json().map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.completed', 'setup.step_skipped', 'setup.tables_generated']));

    // Droits : lecture pour l'équipe, écriture pour le propriétaire et l'administrateur.
    const manager = as(t, (await login(t, (await addMember(t, org.token, 'MANAGER')).email)).json().accessToken);
    expect((await manager.get(url)).statusCode).toBe(200);
    expect((await manager.post(`${url}/steps/logo`, { skipped: true })).statusCode).toBe(403);
    expect((await manager.post(`${url}/finish`)).statusCode).toBe(403);
    expect((await owner.post(`${url}/steps/inconnue`, { skipped: true })).statusCode).toBe(400);
    expect((await owner.get('/api/locations/pas-un-uuid/setup')).statusCode).toBe(400);

    const other = as(t, (await registerOrg(t, 'AssistantVoisin')).token);
    expect((await other.get(url)).statusCode).toBe(404);
    expect((await other.post(`${url}/steps/logo`, { skipped: true })).statusCode).toBe(404);
  });

  it('logo : fiche, chevalets QR, menu client et reçu ; image d’une autre organisation refusée', async () => {
    const org = await registerOrg(t, 'Logo');
    const owner = as(t, org.token);
    const loc = org.me.locations[0].id as string;
    const media = (await owner.post(`/api/locations/${loc}/media`, { contentType: 'image/png', dataBase64: PNG })).json();
    expect((await owner.patch(`/api/locations/${loc}`, { logoMediaId: media.id })).statusCode).toBe(200);
    const logoUrl = `/api/media/${media.id}`;

    await owner.post(`/api/locations/${loc}/setup/tables`, { zones: [{ name: 'Salle', count: 1 }] });
    const qr = (await owner.get(`/api/locations/${loc}/qr-codes`)).json();
    expect(qr.logoUrl).toBe(logoUrl);
    await owner.post(`/api/locations/${loc}/categories`, { name: 'Boissons' });
    const cat = (await owner.get(`/api/locations/${loc}/menu`)).json().categories[0].id;
    const product = (await owner.post(`/api/categories/${cat}/products`, { name: 'Citronnade', price: 1000 })).json().products[0];
    const pub = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${qr.codes[0].token}` })).json();
    expect(pub.restaurant.logoUrl).toBe(logoUrl);
    expect((await t.app.inject({ method: 'GET', url: logoUrl })).statusCode).toBe(200);

    await owner.post(`/api/locations/${loc}/cash-sessions`, { openingFloat: 0 });
    const order = (await owner.post(`/api/locations/${loc}/orders`, { tableId: null, lines: [{ productId: product.id, quantity: 1 }] })).json();
    const receipt = await owner.post(`/api/locations/${loc}/payments`, { target: { kind: 'order', id: order.id }, method: 'CASH', amount: 1000 });
    expect(receipt.statusCode).toBe(201);
    expect(receipt.json().location.logoUrl).toBe(logoUrl);

    const other = as(t, (await registerOrg(t, 'LogoVoisin')).token);
    const otherLoc = (await other.get('/api/locations')).json()[0].id;
    expect((await other.patch(`/api/locations/${otherLoc}`, { logoMediaId: media.id })).statusCode).toBe(404);

    expect((await owner.patch(`/api/locations/${loc}`, { logoMediaId: null })).json().logoUrl).toBeNull();
    expect((await owner.get(`/api/locations/${loc}/setup`)).json().hasLogo).toBe(false);
  });

  it('tables en série : plan en rangées sans chevauchement, QR, numérotation continue, droits', async () => {
    const org = await registerOrg(t, 'Tables');
    const owner = as(t, org.token);
    const loc = org.me.locations[0].id as string;
    const url = `/api/locations/${loc}/setup/tables`;

    const res = await owner.post(url, { zones: [{ name: 'Salle', count: 10 }, { name: 'Terrasse', count: 4, capacity: 2 }] });
    expect(res.statusCode).toBe(201);
    const floor = res.json();
    expect(floor.zones.map((z: { name: string }) => z.name)).toEqual(['Salle', 'Terrasse']);
    expect(floor.tables).toHaveLength(14);
    const inZone = (zoneId: string) => floor.tables.filter((x: { zoneId: string }) => x.zoneId === zoneId);
    for (const zone of floor.zones) {
      const issues = findLayoutIssues(inZone(zone.id), zone.planWidth, zone.planHeight);
      expect(issues).toEqual({ outOfBounds: [], overlaps: [] });
    }
    const [salle, terrasse] = floor.zones;
    const labels = (zoneId: string) => inZone(zoneId).map((x: { label: string }) => x.label).sort(new Intl.Collator('fr', { numeric: true }).compare);
    expect(labels(salle.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']);
    expect(labels(terrasse.id)).toEqual(['TE1', 'TE2', 'TE3', 'TE4']);
    expect(new Set(inZone(salle.id).map((x: { y: number }) => x.y)).size).toBeGreaterThan(1);
    expect((await owner.get(`/api/locations/${loc}/qr-codes`)).json().codes).toHaveLength(14);

    // Zone existante (même nom, casse différente) : places libres et suite de la numérotation.
    const more = (await owner.post(url, { zones: [{ name: 'salle', count: 2, capacity: 6 }] })).json();
    expect(more.zones).toHaveLength(2);
    expect(more.tables).toHaveLength(16);
    const added = more.tables.filter((x: { label: string }) => x.label === 'T11' || x.label === 'T12');
    expect(added.map((x: { shape: string; zoneId: string }) => [x.shape, x.zoneId])).toEqual([
      ['RECT', salle.id],
      ['RECT', salle.id],
    ]);
    expect(findLayoutIssues(more.tables.filter((x: { zoneId: string }) => x.zoneId === salle.id), salle.planWidth, salle.planHeight).overlaps).toEqual([]);

    // Une grande salle tient dans les limites du plan.
    const big = (await owner.post(url, { zones: [{ name: 'Grande salle', count: 60, capacity: 8, prefix: 'G' }] })).json();
    const grande = big.zones.find((z: { name: string }) => z.name === 'Grande salle');
    expect(big.tables.filter((x: { zoneId: string }) => x.zoneId === grande.id)).toHaveLength(60);

    expect((await owner.post(url, { zones: [{ name: 'VIP', count: 0 }] })).statusCode).toBe(400);
    expect((await owner.post(url, { zones: [] })).statusCode).toBe(400);
    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.post(url, { zones: [{ name: 'VIP', count: 1 }] })).statusCode).toBe(403);
    const other = as(t, (await registerOrg(t, 'TablesVoisin')).token);
    expect((await other.post(url, { zones: [{ name: 'VIP', count: 1 }] })).statusCode).toBe(404);
  }, 120_000);

  it('commande de test : arrive au poste, annulation motivée et tracée, étape validée', async () => {
    const org = await registerOrg(t, 'Test');
    const owner = as(t, org.token);
    const loc = org.me.locations[0].id as string;
    const url = `/api/locations/${loc}/setup/test-order`;
    expect((await owner.post(url)).statusCode).toBe(409);

    // Premier produit : un groupe d'options obligatoire, que le test sait remplir.
    const group = (await owner.post(`/api/locations/${loc}/modifier-groups`, { name: 'Cuisson', minSelect: 1, maxSelect: 1, modifiers: [{ name: 'À point' }, { name: 'Bien cuit' }] })).json().modifierGroups[0];
    await owner.post(`/api/locations/${loc}/categories`, { name: 'Grillades' });
    const cat = (await owner.get(`/api/locations/${loc}/menu`)).json().categories[0].id;
    const menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Steak', price: 4500, modifierGroupIds: [group.id] })).json();
    const steak = menu.products[0];
    const kitchen = menu.stations.find((s: { name: string }) => s.name === 'Cuisine');

    const manager = as(t, (await login(t, (await addMember(t, org.token, 'MANAGER')).email)).json().accessToken);
    expect((await manager.post(url)).statusCode).toBe(403);

    const run = await owner.post(url);
    expect(run.statusCode).toBe(201);
    const { order, stations } = run.json();
    expect(order).toMatchObject({ status: 'CONFIRMED', note: SETUP_TEST_REASON, total: 4500 });
    expect(order.items[0]).toMatchObject({ productId: steak.id, kdsStatus: 'QUEUED', stationId: kitchen.id });
    expect(order.items[0].modifiers).toHaveLength(1);
    expect(stations).toEqual([{ id: kitchen.id, name: 'Cuisine', kind: 'KITCHEN', items: 1 }]);
    const active = (await owner.get(`/api/locations/${loc}/orders?view=active`)).json();
    expect(active.map((o: { id: string }) => o.id)).toContain(order.id);

    // Cette route n'annule que la commande créée par le test.
    const normal = await owner.post(`/api/locations/${loc}/orders`, { tableId: null, lines: [{ productId: steak.id, modifierIds: [group.modifiers[0].id], quantity: 1 }] });
    expect(normal.statusCode).toBe(201);
    expect((await owner.post(`${url}/${normal.json().id}/finish`)).statusCode).toBe(404);
    expect((await manager.post(`${url}/${order.id}/finish`)).statusCode).toBe(403);

    const finished = await owner.post(`${url}/${order.id}/finish`);
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toMatchObject({ testDone: true });
    expect(step(finished.json(), 'test')).toMatchObject({ done: true });
    const today = (await owner.get(`/api/locations/${loc}/orders?view=today`)).json();
    const cancelled = today.find((o: { id: string }) => o.id === order.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.history.at(-1)).toMatchObject({ to: 'CANCELLED', reason: SETUP_TEST_REASON });
    expect(today.find((o: { id: string }) => o.id === normal.json().id).status).toBe('CONFIRMED');
    expect((await owner.post(`${url}/${order.id}/finish`)).statusCode).toBe(200);

    const audit = (await owner.get('/api/audit?limit=100')).json();
    expect(audit.filter((a: { action: string }) => a.action === 'setup.test_completed')).toHaveLength(1);
    expect(audit.find((a: { action: string; entityId: string }) => a.action === 'order.cancelled' && a.entityId === order.id).data.reason).toBe(SETUP_TEST_REASON);

    const other = as(t, (await registerOrg(t, 'TestVoisin')).token);
    expect((await other.post(url)).statusCode).toBe(404);
    expect((await other.post(`${url}/${order.id}/finish`)).statusCode).toBe(404);
  });
});
