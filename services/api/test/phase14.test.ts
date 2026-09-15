import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate, shiftDate } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Phase 14 — rapports de ventes — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);

  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Burger', price: 5000 })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Jus', price: 1000 })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const loc = await t.ctx.db.selectFrom('locations').select(['timezone', 'business_day_cutoff_min']).where('id', '=', locationId).executeTakeFirstOrThrow();
    const today = () => businessDate(t.ctx.now(), loc.timezone, loc.business_day_cutoff_min);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token;
    return { org, owner, locationId, table, burger: byName('Burger'), jus: byName('Jus'), today, qr };
  }

  it('totaux, jours, modes de paiement, produits ; commandes annulées et en attente exclues ; remises', async () => {
    const r = await restaurant('Rapport');
    const o = r.owner;
    const order = async (body: object) => (await o.post(`/api/locations/${r.locationId}/orders`, body)).json();
    const pay = async (id: string, method: string, amount: number) => {
      const res = await o.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id }, method, amount });
      expect(res.statusCode, `${method} ${amount} : ${res.body}`).toBe(201);
      return res;
    };

    await o.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    const day1 = r.today();
    const a = await order({ serviceType: 'TAKEAWAY', lines: [{ productId: r.burger.id, quantity: 1 }, { productId: r.jus.id, quantity: 1 }] });
    expect((await pay(a.id, 'CASH', 6000)).statusCode).toBe(201);
    const b = await order({ tableId: r.table.id, lines: [{ productId: r.jus.id, quantity: 2 }] });
    await o.post(`/api/orders/${b.id}/discount`, { kind: 'PERCENT', value: 10, reason: 'Client fidèle' });
    expect((await pay(b.id, 'MOBILE_MONEY', 1800)).statusCode).toBe(201);
    const c = await order({ lines: [{ productId: r.jus.id, quantity: 1 }] });
    expect((await o.post(`/api/orders/${c.id}/status`, { status: 'CANCELLED', reason: 'Erreur de saisie' })).statusCode).toBe(200);
    await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr}/orders`, payload: { clientToken: 'client-rapport-000001', lines: [{ productId: r.jus.id, quantity: 1 }] } });

    let day2: string;
    try {
      t.clock.offsetMs = 26 * 3600_000;
      day2 = r.today();
      // Le lendemain, le jeton d'accès (15 min) a expiré : on se reconnecte.
      const late = as(t, (await login(t, r.org.email)).json().accessToken);
      const e = (await late.post(`/api/locations/${r.locationId}/orders`, { lines: [{ productId: r.burger.id, quantity: 1 }] })).json();
      const paid = await late.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: e.id }, method: 'CARD', amount: 5000 });
      expect(paid.statusCode, paid.body).toBe(201);
    } finally {
      t.clock.offsetMs = 0;
    }

    const report = (await o.get(`/api/locations/${r.locationId}/reports/sales?from=${day1}&to=${day2}`)).json();
    expect(report.totals).toEqual({ revenue: 12800, orders: 3, averageTicket: 4266, collected: 12800, discounts: 200, promotions: 0, taxCollected: 0, revenueExclTax: 12800, itemsSold: 5, cancelledCount: 1, cancelledAmount: 1000 });
    expect(report.byDay[0]).toEqual({ date: day1, revenue: 7800, orders: 2, collected: 7800 });
    expect(report.byDay.at(-1)).toEqual({ date: day2, revenue: 5000, orders: 1, collected: 5000 });
    expect(report.byMethod).toEqual([
      { method: 'CASH', count: 1, amount: 6000 },
      { method: 'MOBILE_MONEY', count: 1, amount: 1800 },
      { method: 'CARD', count: 1, amount: 5000 },
    ]);
    expect(report.topProducts).toEqual([
      { name: 'Burger', quantity: 2, revenue: 10000 },
      { name: 'Jus', quantity: 3, revenue: 3000 },
    ]);
    expect(report.bySource).toEqual([{ source: 'POS', orders: 3, revenue: 12800 }]);
    expect(report.byServiceType).toEqual([
      { serviceType: 'DINE_IN', orders: 2, revenue: 6800 },
      { serviceType: 'TAKEAWAY', orders: 1, revenue: 6000 },
    ]);
    expect(report.byHour.reduce((s: number, h: { orders: number }) => s + h.orders, 0)).toBe(3);
    for (const h of report.byHour) expect(h.hour).toBeGreaterThanOrEqual(0);

    const second = (await o.get(`/api/locations/${r.locationId}/reports/sales?from=${day2}&to=${day2}`)).json();
    expect(second.totals).toMatchObject({ revenue: 5000, orders: 1, cancelledCount: 0 });
    expect(second.byDay).toHaveLength(1);
  });

  it('période invalide, droits, isolation', async () => {
    const r = await restaurant('RapportDroits');
    const day = r.today();
    const url = (from: string, to: string, id = r.locationId) => `/api/locations/${id}/reports/sales?from=${from}&to=${to}`;
    expect((await r.owner.get(url(day, shiftDate(day, -1)))).statusCode).toBe(400);
    expect((await r.owner.get(url(day, shiftDate(day, 400)))).statusCode).toBe(400);
    expect((await r.owner.get(url('13/09/2026', day))).statusCode).toBe(400);
    expect((await (await member(r.org.token, 'WAITER')).get(url(day, day))).statusCode).toBe(403);
    expect((await (await member(r.org.token, 'CASHIER')).get(url(day, day))).statusCode).toBe(403);
    const manager = (await (await member(r.org.token, 'MANAGER')).get(url(day, day))).json();
    expect(manager.totals.orders).toBe(0);
    expect(manager.byDay).toEqual([{ date: day, revenue: 0, orders: 0, collected: 0 }]);
    const other = await restaurant('RapportVoisin');
    expect((await other.owner.get(url(day, day))).statusCode).toBe(404);
  });
});
