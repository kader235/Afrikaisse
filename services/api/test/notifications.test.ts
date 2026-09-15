import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@afrikaisse/core';
import { notifyReceived } from '../src/lib/notify.ts';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('§42 — centre de notifications — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  type Client = ReturnType<typeof as>;
  type Item = { id: string; kind: string; title: string; body: string | null; read: boolean; urgent: boolean; entityId: string | null };
  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);
  let clientCounter = 0;

  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    const stations: { id: string; kind: string; name: string }[] = (await owner.get(`/api/locations/${locationId}/stations`)).json();
    const cuisine = stations.find((s) => s.kind === 'KITCHEN')!;
    const bar = stations.find((s) => s.kind === 'BAR')!;
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Riz gras', price: 2500 })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Bissap', price: 1000, stationId: bar.id })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const feed = async (who: Client, since = 0) => {
      const res = await who.get(`/api/locations/${locationId}/notifications?since=${since}`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { cursor: number; full: boolean; unread: number; items: Item[] };
    };
    clientCounter += 1;
    const clientToken = `client-notif-${String(clientCounter).padStart(6, '0')}`;
    const qrOrder = () => t.app.inject({ method: 'POST', url: `/api/public/menu/${qr}/orders`, payload: { clientToken, lines: [{ productId: byName('Riz gras').id, quantity: 1 }] } });
    const call = (kind: string) => t.app.inject({ method: 'POST', url: `/api/public/menu/${qr}/requests`, payload: { clientToken, kind } });
    const staffOrder = async (who: Client, lines: object[]) => {
      const res = await who.post(`/api/locations/${locationId}/orders`, { tableId: table.id, lines });
      expect(res.statusCode, res.body).toBe(201);
      return res.json();
    };
    return { org, owner, locationId, table, cuisine, bar, riz: byName('Riz gras'), bissap: byName('Bissap'), qr, feed, qrOrder, call, staffOrder };
  }

  it('commande QR et appels de table : la salle et la caisse, lu par personne, curseur since', async () => {
    const r = await restaurant('Notif');
    const waiter = await member(r.org.token, 'WAITER');
    const cashier = await member(r.org.token, 'CASHIER');
    const cook = await member(r.org.token, 'KITCHEN');
    const storekeeper = await member(r.org.token, 'STOCK_MANAGER');

    const placed = await r.qrOrder();
    expect(placed.statusCode, placed.body).toBe(201);
    const first = await r.feed(waiter);
    expect(first).toMatchObject({ full: true, unread: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ kind: 'ORDER_NEW', urgent: true, title: 'Nouvelle commande n°1', body: 'Table T1 · QR', entityId: placed.json().id, read: false });
    expect((await r.feed(cook)).items).toEqual([]);
    expect((await r.feed(storekeeper)).items).toEqual([]);
    expect((await r.feed(cashier)).unread).toBe(1);

    expect((await waiter.post(`/api/notifications/${first.items[0]!.id}/read`)).statusCode).toBe(204);
    expect((await waiter.post(`/api/notifications/${first.items[0]!.id}/read`)).statusCode).toBe(204);
    const after = await r.feed(waiter);
    expect(after.unread).toBe(0);
    expect(after.items[0]!.read).toBe(true);
    expect((await r.feed(cashier)).unread).toBe(1);

    expect(await r.feed(waiter, after.cursor)).toMatchObject({ full: false, items: [] });
    await r.call('CALL_WAITER');
    await r.call('BILL');
    await r.call('CALL_WAITER'); // déjà signalé : pas de deuxième alerte
    const next = await r.feed(waiter, after.cursor);
    expect(next.full).toBe(false);
    expect(next.items.map((i) => [i.kind, i.title])).toEqual([
      ['BILL_REQUESTED', "Table T1 demande l'addition"],
      ['WAITER_CALL', 'Table T1 appelle un serveur'],
    ]);
    expect(next.unread).toBe(2);
    // Curseur au-delà du connu (base restaurée) : liste complète.
    expect((await r.feed(waiter, next.cursor + 1000)).full).toBe(true);
  });

  it('commande prête : la salle est prévenue, pas l’auteur du geste ; jamais en double', async () => {
    const r = await restaurant('NotifPrete');
    const waiter = await member(r.org.token, 'WAITER');
    const cashier = await member(r.org.token, 'CASHIER');
    const cook = await member(r.org.token, 'KITCHEN');

    const one = await r.staffOrder(r.owner, [{ productId: r.riz.id, quantity: 1 }]);
    expect((await r.feed(waiter)).items).toEqual([]); // commande saisie par le personnel : pas « nouvelle »
    expect((await cook.post(`/api/orders/${one.id}/kitchen`, { stationId: r.cuisine.id, action: 'READY' })).json().status).toBe('READY');
    const w = await r.feed(waiter);
    expect(w.items.map((i) => [i.kind, i.title, i.body])).toEqual([['ORDER_READY', 'Commande n°1 prête', 'Table T1']]);
    expect((await r.feed(r.owner)).items).toHaveLength(1);

    const two = await r.staffOrder(r.owner, [{ productId: r.riz.id, quantity: 2 }]);
    expect((await waiter.post(`/api/orders/${two.id}/status`, { status: 'READY' })).statusCode).toBe(200);
    expect((await r.feed(waiter)).items).toHaveLength(1);
    expect((await r.feed(cashier)).items.map((i) => i.title)).toEqual(['Commande n°2 prête', 'Commande n°1 prête']);

    const rows = await t.ctx.db.selectFrom('notifications').select('id').where('entity_id', '=', one.id).execute();
    expect(rows).toHaveLength(1);
  });

  it('problème cuisine : signalé par son poste, reçu par la salle et la caisse, audité', async () => {
    const r = await restaurant('NotifProbleme');
    const waiter = await member(r.org.token, 'WAITER');
    const cashier = await member(r.org.token, 'CASHIER');
    const cook = await member(r.org.token, 'KITCHEN');
    const order = await r.staffOrder(r.owner, [
      { productId: r.riz.id, quantity: 1 },
      { productId: r.bissap.id, quantity: 1 },
    ]);
    const problem = (who: Client, body: object, id = order.id) => who.post(`/api/orders/${id}/kitchen/problem`, body);

    expect((await problem(cook, { stationId: r.cuisine.id, message: 'Produit manquant' })).statusCode).toBe(204);
    const seen = await r.feed(cashier);
    expect(seen.items[0]).toMatchObject({ kind: 'KITCHEN_PROBLEM', urgent: true, title: 'Problème cuisine · commande n°1', body: 'Cuisine : Produit manquant', entityId: order.id });
    expect((await r.feed(waiter)).unread).toBe(1);
    expect((await r.feed(cook)).items).toEqual([]);

    expect((await problem(cook, { stationId: null, message: 'Retard' })).statusCode).toBe(403); // le bar en fait partie
    expect((await problem(cook, { stationId: r.bar.id, message: 'Retard' })).statusCode).toBe(403);
    expect((await problem(waiter, { stationId: r.cuisine.id, message: 'Retard' })).statusCode).toBe(403);
    expect((await problem(cook, { stationId: r.cuisine.id, message: '   ' })).statusCode).toBe(400);
    expect((await problem(cook, { stationId: r.cuisine.id, message: 'x' }, 'pas-un-uuid')).statusCode).toBe(400);

    const pending = (await r.qrOrder()).json();
    expect((await problem(cook, { stationId: r.cuisine.id, message: 'Retard' }, pending.id)).statusCode).toBe(409);

    const audit = await t.ctx.db.selectFrom('audit_logs').select('data').where('action', '=', 'kitchen.problem').where('entity_id', '=', order.id).execute();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.data!)).toMatchObject({ number: 1, station: 'Cuisine', message: 'Produit manquant' });

    const other = await restaurant('NotifProblemeVoisin');
    expect((await problem(other.owner, { stationId: null, message: 'Pirate' })).statusCode).toBe(404);
  });

  it('stock faible et rupture : au franchissement du seuil, pour qui gère le stock', async () => {
    const r = await restaurant('NotifStock');
    const waiter = await member(r.org.token, 'WAITER');
    const storekeeper = await member(r.org.token, 'STOCK_MANAGER');
    const poulet = (await storekeeper.post(`/api/locations/${r.locationId}/inventory`, { name: 'Poulet', unit: 'KG', minLevel: 2 })).json();
    const move = (who: Client, itemId: string, body: object) => who.post(`/api/inventory/${itemId}/movements`, body);

    expect((await move(storekeeper, poulet.id, { kind: 'IN', quantity: 3 })).statusCode).toBe(200);
    expect((await r.feed(r.owner)).items).toEqual([]);
    await move(storekeeper, poulet.id, { kind: 'LOSS', quantity: 1.5, reason: 'Avarié' });
    await move(storekeeper, poulet.id, { kind: 'LOSS', quantity: 1, reason: 'Avarié' }); // reste sous le seuil : pas de nouvelle alerte
    await move(storekeeper, poulet.id, { kind: 'LOSS', quantity: 0.5, reason: 'Avarié' });
    const owner = await r.feed(r.owner);
    expect(owner.items.map((i) => [i.kind, i.title, i.body, i.urgent])).toEqual([
      ['STOCK_LOW', 'Rupture : Poulet', 'Reste 0 kg', false],
      ['STOCK_LOW', 'Stock faible : Poulet', 'Reste 1,5 kg', false],
    ]);
    expect((await r.feed(storekeeper)).items).toEqual([]); // ses propres gestes
    expect((await r.feed(waiter)).items).toEqual([]);

    // Rupture causée par une vente : visible de tous ceux qui gèrent le stock, y compris qui a vendu.
    const riz = (await r.owner.post(`/api/locations/${r.locationId}/inventory`, { name: 'Riz blanc', unit: 'KG', minLevel: 1 })).json();
    await move(r.owner, riz.id, { kind: 'IN', quantity: 1.4 });
    expect((await r.owner.put(`/api/products/${r.riz.id}/recipe`, { items: [{ itemId: riz.id, quantity: 0.5 }] })).statusCode).toBe(200);
    await r.staffOrder(r.owner, [{ productId: r.riz.id, quantity: 1 }]);
    expect((await r.feed(storekeeper)).items.map((i) => i.title)).toEqual(['Stock faible : Riz blanc']);
    expect((await r.feed(r.owner)).items[0]!.title).toBe('Stock faible : Riz blanc');
  });

  it('tout marquer lu, droits et isolation entre organisations', async () => {
    const r = await restaurant('NotifLu');
    const waiter = await member(r.org.token, 'WAITER');
    await r.qrOrder();
    await r.call('CALL_WAITER');
    const before = await r.feed(r.owner);
    expect(before.unread).toBe(2);
    const done = await r.owner.post(`/api/locations/${r.locationId}/notifications/read-all`, { upTo: before.cursor });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toEqual({ unread: 0 });
    await r.call('BILL');
    const later = await r.feed(r.owner);
    expect(later.unread).toBe(1);
    expect(later.items.map((i) => i.read)).toEqual([false, true, true]);
    expect((await r.feed(waiter)).unread).toBe(3); // lu par le propriétaire seulement
    expect((await r.owner.post(`/api/locations/${r.locationId}/notifications/read-all`, {})).json()).toEqual({ unread: 0 });

    const item = (await r.owner.post(`/api/locations/${r.locationId}/inventory`, { name: 'Huile', unit: 'L', minLevel: 1 })).json();
    await r.owner.post(`/api/inventory/${item.id}/movements`, { kind: 'IN', quantity: 2 });
    await r.owner.post(`/api/inventory/${item.id}/movements`, { kind: 'LOSS', quantity: 1.5, reason: 'Renversée' });
    const stockAlert = await t.ctx.db.selectFrom('notifications').select('id').where('location_id', '=', r.locationId).where('kind', '=', 'STOCK_LOW').executeTakeFirstOrThrow();
    expect((await waiter.post(`/api/notifications/${stockAlert.id}/read`)).statusCode).toBe(404); // hors de son public

    const other = await restaurant('NotifLuVoisin');
    expect((await other.owner.get(`/api/locations/${r.locationId}/notifications`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/notifications/${later.items[0]!.id}/read`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/locations/${r.locationId}/notifications/read-all`, {})).statusCode).toBe(404);
    expect((await other.feed(other.owner)).items).toEqual([]);
    expect((await r.owner.post('/api/notifications/pas-un-uuid/read')).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: `/api/locations/${r.locationId}/notifications` })).statusCode).toBe(401);
  });

  it('événement reçu par synchronisation : le nœud qui le reçoit prévient la salle, une seule fois, et pas pour un événement ancien', async () => {
    const r = await restaurant('NotifSync');
    const waiter = await member(r.org.token, 'WAITER');
    const fresh = await r.staffOrder(r.owner, [{ productId: r.riz.id, quantity: 1 }]);
    const old = await r.staffOrder(r.owner, [{ productId: r.riz.id, quantity: 1 }]);
    await t.ctx.db.updateTable('orders').set({ status: 'READY' }).where('id', 'in', [fresh.id, old.id]).execute();
    const event = (orderId: string, createdAt: number) => ({
      eventId: uuidv7(),
      deviceId: uuidv7(),
      tenantId: r.org.me.tenant.id as string,
      locationId: r.locationId,
      entityType: 'order',
      entityId: orderId,
      operation: 'ORDER_STATUS_CHANGED',
      payload: { rows: { order: { status: 'READY', source: 'POS' } } },
      hlc: t.ctx.clock.now(),
      createdAt,
    });
    await notifyReceived(t.ctx.db, t.ctx, event(fresh.id, t.ctx.now()));
    await notifyReceived(t.ctx.db, t.ctx, event(fresh.id, t.ctx.now()));
    await notifyReceived(t.ctx.db, t.ctx, event(old.id, t.ctx.now() - 11 * 60_000));
    expect((await r.feed(waiter)).items.map((i) => [i.title, i.entityId])).toEqual([['Commande n°1 prête', fresh.id]]);
  });
});
