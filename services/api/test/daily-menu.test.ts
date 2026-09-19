import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate, shiftDate } from '@afrikaisse/core';
import { ENGINES, as, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Menu du jour â€” %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    const category = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json().categories[0];
    const make = async (name: string, price: number) => (await owner.post(`/api/categories/${category.id}/products`, { name, price })).json().products.find((p: { name: string }) => p.name === name);
    const poulet = await make('Poulet braisÃ©', 4500);
    const riz = await make('Riz gras', 2500);
    const jus = await make('Jus de bissap', 1000);
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const publicMenu = async () => (await t.app.inject({ method: 'GET', url: `/api/public/menu/${token}` })).json();
    const names = async () => (await publicMenu()).categories.flatMap((c: { products: { name: string }[] }) => c.products.map((p) => p.name)).sort();
    const order = (productId: string) => t.app.inject({ method: 'POST', url: `/api/public/menu/${token}/orders`, payload: { clientToken: 'client-menu-jour-000001', lines: [{ productId, quantity: 1 }] } });
    const state = async () => (await owner.get(`/api/locations/${locationId}/daily-menu`)).json();
    return { owner, locationId, poulet, riz, jus, publicMenu, names, order, state };
  }

  it('sans menu du jour : toute la carte est proposÃ©e et commandable', async () => {
    const r = await restaurant('Sansmenu');
    expect(await r.names()).toEqual(['Jus de bissap', 'Poulet braisÃ©', 'Riz gras']);
    expect((await r.order(r.jus.id)).statusCode).toBe(201);
    expect((await r.state()).current).toBeNull();
  });

  it("menu d'un jour : le client ne voit que ces plats, le serveur refuse les autres, la caisse reste libre", async () => {
    const r = await restaurant('Menujour');
    const today = (await r.state()).today as string;
    const saved = await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, { startDate: today, endDate: today, productIds: [r.poulet.id, r.riz.id] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().current.productIds.sort()).toEqual([r.poulet.id, r.riz.id].sort());
    expect(await r.names()).toEqual(['Poulet braisÃ©', 'Riz gras']);

    const refused = await r.order(r.jus.id);
    expect(refused.statusCode).toBe(409);
    expect((await r.order(r.riz.id)).statusCode).toBe(201);

    // La caisse (personnel) n'est pas limitÃ©e par le menu du jour.
    const staff = await r.owner.post(`/api/locations/${r.locationId}/orders`, { serviceType: 'TAKEAWAY', lines: [{ productId: r.jus.id, quantity: 1 }] });
    expect(staff.statusCode).toBeLessThan(300);
  });

  it('ajustÃ© Ã  tout moment (mÃªmes dates = mÃªme menu) ; plat Ã©puisÃ© grisÃ© et refusÃ© ; retirÃ© : retour Ã  toute la carte', async () => {
    const r = await restaurant('Ajuste');
    const today = (await r.state()).today as string;
    const body = (ids: string[]) => ({ startDate: today, endDate: today, productIds: ids });
    await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, body([r.poulet.id]));
    const second = (await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, body([r.poulet.id, r.jus.id]))).json();
    expect(second.menus).toHaveLength(1);
    expect(await r.names()).toEqual(['Jus de bissap', 'Poulet braisÃ©']);

    await r.owner.post(`/api/products/${r.jus.id}/availability`, { isAvailable: false });
    const grey = (await r.publicMenu()).categories[0].products.find((p: { name: string }) => p.name === 'Jus de bissap');
    expect(grey.isAvailable).toBe(false);
    expect((await r.order(r.jus.id)).statusCode).toBe(409);

    await r.owner.post(`/api/daily-menus/${second.current.id}/archive`, {});
    expect((await r.state()).current).toBeNull();
    expect(await r.names()).toEqual(['Jus de bissap', 'Poulet braisÃ©', 'Riz gras']);
  });

  it("pÃ©riode : un menu d'un seul jour l'emporte ; menus passÃ©s et plats inconnus refusÃ©s", async () => {
    const r = await restaurant('Periode');
    const today = (await r.state()).today as string;
    await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, { startDate: today, endDate: shiftDate(today, 6), productIds: [r.poulet.id, r.riz.id, r.jus.id] });
    expect(await r.names()).toEqual(['Jus de bissap', 'Poulet braisÃ©', 'Riz gras']);
    await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, { startDate: today, endDate: today, productIds: [r.riz.id] });
    expect(await r.names()).toEqual(['Riz gras']);

    const past = await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, { startDate: shiftDate(today, -3), endDate: shiftDate(today, -1), productIds: [r.riz.id] });
    expect(past.statusCode).toBe(409);
    const unknown = await r.owner.put(`/api/locations/${r.locationId}/daily-menu`, { startDate: today, endDate: today, productIds: ['0192f3f8-7b6a-7000-8000-000000000001'] });
    expect(unknown.statusCode).toBe(404);
  });

  it('le jour suit le fuseau et la coupure de lâ€™Ã©tablissement (jamais le serveur)', () => {
    // 02:00 heure de N'Djamena (UTC+1) le 20 : avec une coupure Ã  05:00, on est encore dans le service du 19.
    const ms = Date.UTC(2026, 8, 20, 1, 0);
    expect(businessDate(ms, 'Africa/Ndjamena', 300)).toBe('2026-09-19');
    expect(businessDate(ms, 'Africa/Ndjamena', 0)).toBe('2026-09-20');
  });
});

