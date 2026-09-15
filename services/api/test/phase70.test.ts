import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Mise en route et restaurant de démonstration (§70-71) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('état de mise en route, démonstration complète et utilisable, une seule fois', { timeout: 60_000 }, async () => {
    const org = await registerOrg(t, 'Demo');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;

    expect((await owner.get(`/api/locations/${locationId}/setup`)).json()).toMatchObject({ tables: 0, products: 0, stations: 2, members: 1, cashSessions: 0, orders: 0, complete: false });

    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.post(`/api/locations/${locationId}/demo`)).statusCode).toBe(403);

    const loaded = await owner.post(`/api/locations/${locationId}/demo`);
    expect(loaded.statusCode).toBe(201);
    expect(loaded.json()).toMatchObject({ zones: 2, tables: 20, categories: 6, products: 25, stations: 3, members: 2, complete: true });
    expect((await owner.post(`/api/locations/${locationId}/demo`)).statusCode).toBe(409);

    const menu = (await owner.get(`/api/locations/${locationId}/menu`)).json();
    const station = (name: string) => menu.stations.find((s: { name: string }) => s.name === name).id;
    const product = (name: string) => menu.products.find((p: { name: string }) => p.name === name);
    expect(product('Brochettes de bœuf').stationId).toBe(station('Grill'));
    expect(product('Café Touba').stationId).toBe(station('Bar'));
    expect(product('Classic Burger').modifierGroupIds).toHaveLength(3);

    // Chaque table a son QR et le menu client est complet.
    const codes = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes;
    expect(codes).toHaveLength(20);
    const pub = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${codes[0].token}` })).json();
    expect(pub.categories.map((c: { name: string }) => c.name)).toEqual(['Entrées', 'Plats', 'Grillades', 'Fast-food', 'Boissons', 'Desserts']);

    // Une vraie vente est possible tout de suite.
    const burger = product('Classic Burger');
    const groups = menu.modifierGroups;
    const pick = (group: string, option: string) => groups.find((g: { name: string }) => g.name === group).modifiers.find((m: { name: string }) => m.name === option).id;
    const order = await owner.post(`/api/locations/${locationId}/orders`, {
      tableId: null,
      lines: [
        { productId: burger.id, variantId: burger.variants[1].id, modifierIds: [pick('Cuisson', 'À point'), pick('Accompagnement', 'Attiéké'), pick('Suppléments', 'Fromage')], quantity: 1 },
        { productId: product('Brochettes de bœuf').id, modifierIds: [pick('Accompagnement', 'Alloco')], quantity: 2 },
      ],
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().total).toBe(5500 + 1500 + 500 + 500 + 2 * 3500);
    expect(order.json().items[1].stationId).toBe(station('Grill'));

    const actions = (await owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(actions).toContain('demo.loaded');
    expect((await owner.get(`/api/locations/${locationId}/setup`)).json()).toMatchObject({ orders: 1, complete: true });
  });

  it('refusée sur un établissement déjà rempli ; autre organisation : 404', async () => {
    const org = await registerOrg(t, 'DemoPlein');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    await owner.post(`/api/locations/${locationId}/categories`, { name: 'Ma carte' });
    const cat = (await owner.get(`/api/locations/${locationId}/menu`)).json().categories[0].id;
    await owner.post(`/api/categories/${cat}/products`, { name: 'Mon plat', price: 2000 });
    const refused = await owner.post(`/api/locations/${locationId}/demo`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('vide');

    const other = as(t, (await registerOrg(t, 'DemoVoisin')).token);
    expect((await other.get(`/api/locations/${locationId}/setup`)).statusCode).toBe(404);
    expect((await other.post(`/api/locations/${locationId}/demo`)).statusCode).toBe(404);
  });
});
