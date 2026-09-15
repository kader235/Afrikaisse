import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@afrikaisse/core';
import { ENGINES, as, registerOrg, startApp, type TestApp } from './helpers.ts';

/** Tablette hors ligne : la commande garde l'identifiant créé sur l'appareil et part au retour du réseau. */
describe.each(ENGINES)('Commandes prises hors ligne — %s', (engine) => {
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
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    const menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const jus = (await owner.post(`/api/categories/${menu.categories[0].id}/products`, { name: 'Jus', price: 1000 })).json().products[0];
    const order = (body: object) => owner.post(`/api/locations/${locationId}/orders`, body);
    const count = async () => (await t.ctx.db.selectFrom('orders').select('id').where('location_id', '=', locationId).execute()).length;
    return { owner, locationId, table, jus, order, count };
  }

  it('renvoyée plusieurs fois, la commande n’est enregistrée qu’une fois', async () => {
    const r = await restaurant('HorsLigne');
    const id = uuidv7();
    const body = { id, tableId: r.table.id, lines: [{ productId: r.jus.id, quantity: 2 }] };

    const first = await r.order(body);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ id, number: 1, status: 'CONFIRMED', total: 2000 });

    const again = await r.order(body);
    expect(again.json()).toMatchObject({ id, number: 1 });
    expect(await r.count()).toBe(1);

    // Sans identifiant : comportement inchangé, une nouvelle commande.
    expect((await r.order({ tableId: r.table.id, lines: [{ productId: r.jus.id, quantity: 1 }] })).json().number).toBe(2);
    expect(await r.count()).toBe(2);
  });

  it('deux envois simultanés du même identifiant donnent une seule commande', async () => {
    const r = await restaurant('Simultane');
    const id = uuidv7();
    const body = { id, tableId: r.table.id, lines: [{ productId: r.jus.id, quantity: 1 }] };
    const [a, b] = await Promise.all([r.order(body), r.order(body)]);
    expect(a.json().id).toBe(id);
    expect(b.json().id).toBe(id);
    expect(await r.count()).toBe(1);
  });

  it('un identifiant déjà pris par une autre organisation est refusé', async () => {
    const a = await restaurant('Proprietaire');
    const b = await restaurant('Voisin');
    const id = uuidv7();
    expect((await a.order({ id, tableId: a.table.id, lines: [{ productId: a.jus.id, quantity: 1 }] })).statusCode).toBe(201);
    const stolen = await b.order({ id, tableId: b.table.id, lines: [{ productId: b.jus.id, quantity: 1 }] });
    expect(stolen.statusCode).toBe(409);
    expect(await b.count()).toBe(0);
  });
});
