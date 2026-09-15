import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate, shiftDate, weekStart } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const MIN = 60_000;

describe.each(ENGINES)('§30 §38-39 — rapports détaillés et temps de préparation — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  type Client = ReturnType<typeof as>;
  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);
  /** Les requêtes prennent quelques millisecondes : durées comparées à 10 s près. */
  const near = (actual: number, expected: number) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThan(10_000);

  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    const loc = await t.ctx.db.selectFrom('locations').select(['timezone', 'business_day_cutoff_min']).where('id', '=', locationId).executeTakeFirstOrThrow();
    const today = () => businessDate(t.ctx.now(), loc.timezone, loc.business_day_cutoff_min);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const report = async (who: Client, kind: string, from: string, to = from) => who.get(`/api/locations/${locationId}/reports/${kind}?from=${from}&to=${to}`);
    const order = async (who: Client, body: object) => {
      const res = await who.post(`/api/locations/${locationId}/orders`, body);
      expect(res.statusCode, res.body).toBe(201);
      return res.json();
    };
    return { org, owner, locationId, table, today, qr, report, order };
  }

  it('cuisine : durée confirmation → prête, retard sur le temps prévu, par poste et par produit', async () => {
    const r = await restaurant('Chrono');
    const o = r.owner;
    const stations: { id: string; kind: string; name: string }[] = (await o.get(`/api/locations/${r.locationId}/stations`)).json();
    const bar = stations.find((s) => s.kind === 'BAR')!;
    const grill = (await o.post(`/api/locations/${r.locationId}/stations`, { name: 'Grill', kind: 'KITCHEN' })).json().find((s: { name: string }) => s.name === 'Grill');
    let menu = (await o.post(`/api/locations/${r.locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await o.post(`/api/categories/${cat}/products`, { name: 'Brochettes', price: 3000, stationId: grill.id, prepTimeMin: 10 })).json();
    menu = (await o.post(`/api/categories/${cat}/products`, { name: 'Bissap', price: 1000, stationId: bar.id, prepTimeMin: 2 })).json();
    menu = (await o.post(`/api/categories/${cat}/products`, { name: 'Riz gras', price: 2500 })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const cook = await member(r.org.token, 'KITCHEN');
    const barman = await member(r.org.token, 'BAR');

    const day = r.today();
    const a = await r.order(o, { tableId: r.table.id, lines: [{ productId: byName('Brochettes').id, quantity: 2 }, { productId: byName('Bissap').id, quantity: 1 }] });
    const b = await r.order(o, { serviceType: 'TAKEAWAY', lines: [{ productId: byName('Riz gras').id, quantity: 1 }] });
    const cancelled = await r.order(o, { lines: [{ productId: byName('Riz gras').id, quantity: 1 }] });
    await o.post(`/api/orders/${cancelled.id}/status`, { status: 'CANCELLED', reason: 'Erreur' });
    await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr}/orders`, payload: { clientToken: 'client-chrono-000001', lines: [{ productId: byName('Riz gras').id, quantity: 1 }] } });

    const kds = (who: Client, id: string, stationId: string | null) => who.post(`/api/orders/${id}/kitchen`, { stationId, action: 'READY' });
    try {
      t.clock.offsetMs = 3 * MIN;
      expect((await kds(barman, a.id, bar.id)).statusCode).toBe(200);
      t.clock.offsetMs = 5 * MIN;
      expect((await kds(o, b.id, null)).json().status).toBe('READY');
      t.clock.offsetMs = 12 * MIN;
      expect((await kds(cook, a.id, grill.id)).json().status).toBe('READY');
    } finally {
      t.clock.offsetMs = 0;
    }

    const res = await r.report(o, 'kitchen', day);
    expect(res.statusCode, res.body).toBe(200);
    const k = res.json();
    expect(k.totals).toMatchObject({ measured: 2, lateCount: 1, itemsMeasured: 3 });
    near(k.totals.averageMs, 8.5 * MIN);
    near(k.totals.maxMs, 12 * MIN);
    near(k.totals.averageLateMs, 2 * MIN);
    expect(k.byStation.map((s: { name: string; items: number; lateCount: number }) => [s.name, s.items, s.lateCount])).toEqual([
      ['Grill', 1, 1],
      ['Cuisine', 1, 0],
      ['Bar', 1, 1],
    ]);
    near(k.byStation[2].averageMs, 3 * MIN);
    expect(k.byProduct.map((p: { name: string; quantity: number; expectedMs: number; lateCount: number }) => [p.name, p.quantity, p.expectedMs, p.lateCount])).toEqual([
      ['Brochettes', 2, 10 * MIN, 1],
      ['Riz gras', 1, 15 * MIN, 0],
      ['Bissap', 1, 2 * MIN, 1],
    ]);
    expect(k.lateTickets).toHaveLength(1);
    expect(k.lateTickets[0]).toMatchObject({ orderId: a.id, number: a.number, businessDate: day, tableLabel: 'T1', expectedMs: 10 * MIN });
    near(k.lateTickets[0].lateMs, 2 * MIN);
    expect(k.byDay).toHaveLength(1);

    const earlier = (await r.report(o, 'kitchen', shiftDate(day, -3), shiftDate(day, -1))).json();
    expect(earlier.totals.measured).toBe(0);
  });

  it('périodes, produits, catégories, personnel et paiements', async () => {
    const r = await restaurant('Rapports');
    const o = r.owner;
    let menu = (await o.post(`/api/locations/${r.locationId}/categories`, { name: 'Plats' })).json();
    menu = (await o.post(`/api/locations/${r.locationId}/categories`, { name: 'Boissons' })).json();
    const catId = (n: string) => menu.categories.find((c: { name: string }) => c.name === n).id;
    menu = (await o.post(`/api/categories/${catId('Plats')}/products`, { name: 'Burger', price: 5000 })).json();
    menu = (await o.post(`/api/categories/${catId('Boissons')}/products`, { name: 'Jus', price: 1000 })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const waiter = await member(r.org.token, 'WAITER');
    const cashier = await member(r.org.token, 'CASHIER');
    const day = r.today();

    const byWaiter = await r.order(waiter, { tableId: r.table.id, lines: [{ productId: byName('Burger').id, quantity: 1 }] });
    const byOwner = await r.order(o, { serviceType: 'TAKEAWAY', lines: [{ productId: byName('Jus').id, quantity: 2 }] });
    const cancelled = await r.order(o, { lines: [{ productId: byName('Burger').id, quantity: 1 }] });
    await o.post(`/api/orders/${cancelled.id}/status`, { status: 'CANCELLED', reason: 'Erreur' });
    const qr = (await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr}/orders`, payload: { clientToken: 'client-rapport2-00001', lines: [{ productId: byName('Jus').id, quantity: 1 }] } })).json();
    expect((await cashier.post(`/api/orders/${qr.id}/status`, { status: 'CONFIRMED' })).statusCode).toBe(200);

    await o.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    const pay = async (who: Client, id: string, method: string, amount: number) => {
      const res = await who.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id }, method, amount });
      expect(res.statusCode, res.body).toBe(201);
      return res.json();
    };
    await pay(o, byOwner.id, 'CASH', 2000);
    await pay(cashier, byWaiter.id, 'MOBILE_MONEY', 5000);
    const wrong = await pay(o, qr.id, 'CARD', 1000);
    expect((await o.post(`/api/payments/${wrong.payment.id}/void`, { reason: 'Mauvais mode' })).statusCode).toBe(200);

    const res = await r.report(o, 'breakdown', day);
    expect(res.statusCode, res.body).toBe(200);
    const b = res.json();
    expect(b.categories).toEqual([
      { name: 'Plats', quantity: 1, revenue: 5000 },
      { name: 'Boissons', quantity: 3, revenue: 3000 },
    ]);
    expect(b.products).toEqual([
      { productId: byName('Burger').id, name: 'Burger', categoryName: 'Plats', quantity: 1, revenue: 5000 },
      { productId: byName('Jus').id, name: 'Jus', categoryName: 'Boissons', quantity: 3, revenue: 3000 },
    ]);
    expect(b.staff.map((s: { name: string; orders: number; revenue: number; averageTicket: number; payments: number; collected: number }) => [s.name, s.orders, s.revenue, s.averageTicket, s.payments, s.collected])).toEqual([
      ['WAITER test', 1, 5000, 5000, 0, 0],
      ['Patron Rapports', 1, 2000, 2000, 1, 2000],
      ['CASHIER test', 1, 1000, 1000, 1, 5000],
    ]);
    expect(b.payments).toEqual({
      byMethod: [
        { method: 'CASH', count: 1, amount: 2000 },
        { method: 'MOBILE_MONEY', count: 1, amount: 5000 },
      ],
      byDay: [
        { date: day, method: 'CASH', count: 1, amount: 2000 },
        { date: day, method: 'MOBILE_MONEY', count: 1, amount: 5000 },
      ],
      voidedCount: 1,
      voidedAmount: 1000,
    });
    expect(b.byWeek).toEqual([{ date: weekStart(day), from: day, to: day, revenue: 8000, orders: 3, collected: 7000 }]);
    expect(b.byMonth).toEqual([{ date: day.slice(0, 7), from: day, to: day, revenue: 8000, orders: 3, collected: 7000 }]);

    // Une année entière : toutes les semaines et tous les mois, même vides.
    const year = (await r.report(o, 'breakdown', shiftDate(day, -364), day)).json();
    expect(year.byMonth.length).toBeGreaterThanOrEqual(12);
    expect(year.byWeek.length).toBeGreaterThanOrEqual(52);
    expect(year.byMonth.at(-1)).toMatchObject({ revenue: 8000, orders: 3 });
  });

  it('stock : début, réceptions, consommation, pertes, ajustements, fin, valeurs', async () => {
    const r = await restaurant('StockRapport');
    const o = r.owner;
    let menu = (await o.post(`/api/locations/${r.locationId}/categories`, { name: 'Carte' })).json();
    menu = (await o.post(`/api/categories/${menu.categories[0].id}/products`, { name: 'Poulet yassa', price: 4000 })).json();
    const yassa = menu.products[0];
    const poulet = (await o.post(`/api/locations/${r.locationId}/inventory`, { name: 'Poulet', unit: 'KG', minLevel: 2 })).json();
    const move = (body: object) => o.post(`/api/inventory/${poulet.id}/movements`, body);
    expect((await move({ kind: 'IN', quantity: 10, unitCost: 3000 })).statusCode).toBe(200);
    await o.put(`/api/products/${yassa.id}/recipe`, { items: [{ itemId: poulet.id, quantity: 0.5 }] });
    await r.order(o, { lines: [{ productId: yassa.id, quantity: 2 }] });
    await move({ kind: 'LOSS', quantity: 0.5, reason: 'Avarié' });
    await move({ kind: 'COUNT', quantity: 8 });
    const day = r.today();

    const res = await r.report(o, 'stock', day);
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json();
    expect(s.items).toEqual([
      { itemId: poulet.id, name: 'Poulet', unit: 'KG', opening: 0, received: 10, consumed: 1, losses: 0.5, outs: 0, adjustments: -0.5, closing: 8, unitCost: 3000, consumedValue: 3000, lossValue: 1500 },
    ]);
    expect(s.totals).toEqual({ receivedValue: 30000, consumedValue: 3000, lossValue: 1500 });
    expect(s.events.map((e: { kind: string; quantity: number; value: number; reason: string | null; by: string | null }) => [e.kind, e.quantity, e.value, e.reason, e.by]).sort()).toEqual([
      ['COUNT', -0.5, -1500, null, 'Patron StockRapport'],
      ['LOSS', 0.5, 1500, 'Avarié', 'Patron StockRapport'],
    ]);

    const tomorrow = (await r.report(o, 'stock', shiftDate(day, 1))).json();
    expect(tomorrow.items[0]).toMatchObject({ opening: 8, received: 0, consumed: 0, closing: 8 });
    expect(tomorrow.events).toEqual([]);
    const before = (await r.report(o, 'stock', shiftDate(day, -5), shiftDate(day, -1))).json();
    expect(before.items[0]).toMatchObject({ opening: 0, closing: 0 });
  });

  it('droits, période invalide, isolation entre organisations', async () => {
    const r = await restaurant('RapportsDroits');
    const day = r.today();
    const waiter = await member(r.org.token, 'WAITER');
    const cashier = await member(r.org.token, 'CASHIER');
    const storekeeper = await member(r.org.token, 'STOCK_MANAGER');
    const manager = await member(r.org.token, 'MANAGER');
    for (const kind of ['breakdown', 'kitchen', 'stock']) {
      expect((await r.report(waiter, kind, day)).statusCode, kind).toBe(403);
      expect((await r.report(manager, kind, day)).statusCode, kind).toBe(200);
      expect((await r.report(r.owner, kind, day, shiftDate(day, -1))).statusCode, kind).toBe(400);
      expect((await r.report(r.owner, kind, day, shiftDate(day, 400))).statusCode, kind).toBe(400);
    }
    expect((await r.report(cashier, 'kitchen', day)).statusCode).toBe(403);
    expect((await r.report(storekeeper, 'stock', day)).statusCode).toBe(200);
    expect((await r.report(storekeeper, 'breakdown', day)).statusCode).toBe(403);
    expect((await r.owner.get(`/api/locations/pas-un-uuid/reports/kitchen?from=${day}&to=${day}`)).statusCode).toBe(400);

    const other = await restaurant('RapportsVoisin');
    for (const kind of ['breakdown', 'kitchen', 'stock']) {
      expect((await r.report(other.owner, kind, day)).statusCode, kind).toBe(404);
    }
  });
});
