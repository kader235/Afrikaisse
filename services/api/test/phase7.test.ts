import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Phase 7 — postes et écran cuisine — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  type Row = { id: string; name: string; kind: string; productCount: number };
  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);

  /** Brochettes au grill, bissap au bar, riz gras sans poste (part à la cuisine par défaut). */
  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    const defaults: Row[] = (await owner.get(`/api/locations/${locationId}/stations`)).json();
    const created: Row[] = (await owner.post(`/api/locations/${locationId}/stations`, { name: 'Grill', kind: 'KITCHEN' })).json();
    const cuisine = defaults.find((s) => s.kind === 'KITCHEN')!;
    const bar = defaults.find((s) => s.kind === 'BAR')!;
    const grill = created.find((s) => s.name === 'Grill')!;
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Brochettes', price: 3000, stationId: grill.id })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Bissap', price: 1000, stationId: bar.id })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Riz gras', price: 2500 })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes;
    const lines = [
      { productId: byName('Brochettes').id, quantity: 2 },
      { productId: byName('Bissap').id, quantity: 1 },
      { productId: byName('Riz gras').id, quantity: 1 },
    ];
    return { org, owner, locationId, defaults, cuisine, bar, grill, menu, brochettes: byName('Brochettes'), bissap: byName('Bissap'), riz: byName('Riz gras'), qr, lines };
  }

  it('postes : cuisine et bar par défaut, gestion réservée, archivage protégé', async () => {
    const r = await restaurant('Postes');
    expect(r.defaults.map((s) => [s.name, s.kind])).toEqual([
      ['Cuisine', 'KITCHEN'],
      ['Bar', 'BAR'],
    ]);
    const list: Row[] = (await r.owner.get(`/api/locations/${r.locationId}/stations`)).json();
    expect(list.map((s) => [s.name, s.productCount])).toEqual([
      ['Cuisine', 0],
      ['Bar', 1],
      ['Grill', 1],
    ]);
    expect(r.brochettes.stationId).toBe(r.grill.id);
    expect(r.menu.stations).toHaveLength(3);

    const waiter = await member(r.org.token, 'WAITER');
    expect((await waiter.post(`/api/locations/${r.locationId}/stations`, { name: 'Pâtisserie', kind: 'KITCHEN' })).statusCode).toBe(403);
    const cook = await member(r.org.token, 'KITCHEN');
    expect((await cook.get(`/api/locations/${r.locationId}/stations`)).statusCode).toBe(200);

    const renamed: Row[] = (await r.owner.patch(`/api/stations/${r.bar.id}`, { name: 'Bar principal' })).json();
    expect(renamed.find((s) => s.id === r.bar.id)!.name).toBe('Bar principal');
    const blocked = await r.owner.post(`/api/stations/${r.bar.id}/archive`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain('1 produit');

    await r.owner.patch(`/api/products/${r.bissap.id}`, { stationId: r.grill.id });
    const archived: Row[] = (await r.owner.post(`/api/stations/${r.bar.id}/archive`)).json();
    expect(archived.map((s) => s.name)).toEqual(['Cuisine', 'Grill']);
    const toArchived = await r.owner.patch(`/api/products/${r.riz.id}`, { stationId: r.bar.id });
    expect(toArchived.statusCode).toBe(409);
    expect(toArchived.json().error.message).toContain('archivé');

    const other = await restaurant('PostesVoisin');
    expect((await r.owner.patch(`/api/products/${r.riz.id}`, { stationId: other.grill.id })).statusCode).toBe(404);
    expect((await other.owner.get(`/api/locations/${r.locationId}/stations`)).statusCode).toBe(404);
    expect((await other.owner.patch(`/api/stations/${r.grill.id}`, { name: 'Pirate' })).statusCode).toBe(404);
  });

  it('chaque article part au poste de son produit', async () => {
    const r = await restaurant('Routage');
    const order = (await r.owner.post(`/api/locations/${r.locationId}/orders`, { serviceType: 'TAKEAWAY', lines: r.lines })).json();
    expect(order.items.map((i: { name: string; stationId: string; kdsStatus: string }) => [i.name, i.stationId, i.kdsStatus])).toEqual([
      ['Brochettes', r.grill.id, 'QUEUED'],
      ['Bissap', r.bar.id, 'QUEUED'],
      ['Riz gras', r.cuisine.id, 'QUEUED'],
    ]);
  });

  it('écran cuisine : commencer, prêt poste par poste, commande prête quand tout est prêt', async () => {
    const r = await restaurant('Kds');
    const cook = await member(r.org.token, 'KITCHEN');
    const barman = await member(r.org.token, 'BAR');
    const waiter = await member(r.org.token, 'WAITER');
    const order = (await r.owner.post(`/api/locations/${r.locationId}/orders`, { tableId: null, lines: r.lines })).json();
    const kds = (who: ReturnType<typeof as>, stationId: string | null, action: string) => who.post(`/api/orders/${order.id}/kitchen`, { stationId, action });
    const statuses = (o: { items: { kdsStatus: string }[] }) => o.items.map((i) => i.kdsStatus);

    expect((await kds(waiter, r.grill.id, 'START')).statusCode).toBe(403);
    let o = (await kds(cook, r.grill.id, 'START')).json();
    expect(o.status).toBe('PREPARING');
    expect(statuses(o)).toEqual(['PREPARING', 'QUEUED', 'QUEUED']);

    o = (await kds(cook, r.grill.id, 'READY')).json();
    expect(o.status).toBe('PREPARING');
    expect((await kds(cook, r.bar.id, 'READY')).statusCode).toBe(403);
    expect((await kds(cook, null, 'READY')).statusCode).toBe(403); // tous les postes, bar compris

    o = (await kds(barman, r.bar.id, 'READY')).json();
    expect(statuses(o)).toEqual(['READY', 'READY', 'QUEUED']);
    o = (await kds(cook, r.grill.id, 'RECALL')).json();
    expect(statuses(o)[0]).toBe('PREPARING');
    await kds(cook, r.grill.id, 'READY');

    o = (await kds(cook, r.cuisine.id, 'READY')).json();
    expect(o.status).toBe('READY');
    expect(o.history.map((h: { to: string }) => h.to)).toEqual(['CONFIRMED', 'PREPARING', 'READY']);
    expect((await kds(cook, r.grill.id, 'RECALL')).statusCode).toBe(409);

    const foreign = await restaurant('KdsVoisin');
    expect((await kds(cook, foreign.grill.id, 'READY')).statusCode).toBe(404);
    expect((await foreign.owner.post(`/api/orders/${order.id}/kitchen`, { stationId: null, action: 'START' })).statusCode).toBe(404);
  });

  it('tout prêt d’un coup : l’étape « en préparation » reste dans l’historique', async () => {
    const r = await restaurant('KdsDirect');
    const order = (await r.owner.post(`/api/locations/${r.locationId}/orders`, { lines: [r.lines[2]] })).json();
    const o = (await r.owner.post(`/api/orders/${order.id}/kitchen`, { stationId: null, action: 'READY' })).json();
    expect(o.status).toBe('READY');
    expect(o.history.map((h: { to: string }) => h.to)).toEqual(['CONFIRMED', 'PREPARING', 'READY']);
  });

  it('commande QR en attente : pas en cuisine ; « prête » depuis l’écran Commandes marque tous les articles', async () => {
    const r = await restaurant('KdsQr');
    const cook = await member(r.org.token, 'KITCHEN');
    const placed = (
      await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr[0].token}/orders`, payload: { clientToken: 'client-telephone-aaaaaaaa', lines: [r.lines[2], r.lines[1]] } })
    ).json();
    const pending = await cook.post(`/api/orders/${placed.id}/kitchen`, { stationId: r.cuisine.id, action: 'START' });
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.message).toContain('pas encore confirmée');

    await r.owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    const ready = (await r.owner.post(`/api/orders/${placed.id}/status`, { status: 'READY' })).json();
    expect(ready.items.every((i: { kdsStatus: string }) => i.kdsStatus === 'READY')).toBe(true);

    const feed = (await cook.get(`/api/locations/${r.locationId}/activity`)).json();
    expect(feed.orders[0].items.map((i: { stationId: string }) => i.stationId)).toEqual([r.cuisine.id, r.bar.id]);
  });
});
