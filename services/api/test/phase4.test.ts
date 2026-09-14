import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const CLIENT_A = 'client-telephone-aaaaaaaa';
const CLIENT_B = 'client-telephone-bbbbbbbb';

describe.each(ENGINES)('Phases 4-5 — commandes — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  /** Restaurant prêt à servir : 2 tables avec QR, un burger à options, une boisson, un article épuisé. */
  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T2' });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const plats = menu.categories[0].id;
    menu = (await owner.post(`/api/locations/${locationId}/modifier-groups`, { name: 'Cuisson', minSelect: 1, modifiers: [{ name: 'Saignant' }, { name: 'À point' }] })).json();
    const cuisson = menu.modifierGroups[0];
    menu = (await owner.post(`/api/locations/${locationId}/modifier-groups`, { name: 'Suppléments', maxSelect: 2, modifiers: [{ name: 'Fromage', priceDelta: 500 }, { name: 'Bacon', priceDelta: 1000 }] })).json();
    const supplements = menu.modifierGroups[1];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Burger', price: 5000, variants: [{ name: 'Simple' }, { name: 'Double', priceDelta: 1500 }], modifierGroupIds: [cuisson.id, supplements.id] })).json();
    const burger = menu.products[0];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Jus', price: 1000 })).json();
    const jus = menu.products[1];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Riz', price: 2500 })).json();
    const riz = menu.products[2];
    await owner.post(`/api/products/${riz.id}/availability`, { isAvailable: false });
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes;
    return { org, owner, locationId, burger, jus, riz, cuisson, supplements, t1: qr[0].token as string, t2: qr[1].token as string };
  }

  const order = (token: string, body: object) => t.app.inject({ method: 'POST', url: `/api/public/menu/${token}/orders`, payload: body });

  it('commande QR : prix recalculés par le serveur, en attente, numérotée, session de table partagée', async () => {
    const r = await restaurant('Commande');
    const burgerLine = {
      productId: r.burger.id,
      variantId: r.burger.variants[1].id,
      modifierIds: [r.cuisson.modifiers[1].id, r.supplements.modifiers[0].id],
      quantity: 2,
      note: 'Sans oignons',
      // Un client malin qui envoie un prix : ignoré, le schéma ne le connaît même pas.
      unitPrice: 1,
    };
    const first = await order(r.t1, { clientToken: CLIENT_A, lines: [burgerLine, { productId: r.jus.id, quantity: 1 }], note: 'Table près de la fenêtre' });
    expect(first.statusCode).toBe(201);
    const placed = first.json();
    expect(placed).toMatchObject({ number: 1, status: 'PENDING', tableLabel: 'T1', currency: 'XAF', total: (5000 + 1500 + 500) * 2 + 1000 });
    expect(placed.items[0]).toMatchObject({ name: 'Burger', variantName: 'Double', quantity: 2, total: 14000, note: 'Sans oignons', modifiers: ['À point', 'Fromage'] });

    const second = (await order(r.t1, { clientToken: CLIENT_B, lines: [{ productId: r.jus.id, quantity: 3 }] })).json();
    const other = (await order(r.t2, { clientToken: CLIENT_B, lines: [{ productId: r.jus.id, quantity: 1 }] })).json();
    expect([second.number, other.number]).toEqual([2, 3]);

    const staff = (await r.owner.get(`/api/locations/${r.locationId}/orders`)).json();
    const byNumber = (n: number) => staff.find((o: { number: number }) => o.number === n);
    expect(byNumber(1).sessionId).toBe(byNumber(2).sessionId);
    expect(byNumber(3).sessionId).not.toBe(byNumber(1).sessionId);
    expect(byNumber(1).history).toEqual([expect.objectContaining({ from: null, to: 'PENDING', by: 'Client (QR)' })]);

    const mine = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${r.t1}/orders?clientToken=${CLIENT_A}` })).json();
    expect(mine.map((o: { number: number }) => o.number)).toEqual([1]);

    const events = await t.ctx.db.selectFrom('sync_events').select(['operation']).where('entity_type', '=', 'order').where('location_id', '=', r.locationId).execute();
    expect(events.filter((e) => e.operation === 'ORDER_PLACED')).toHaveLength(3);
  });

  it('refuse proprement les paniers invalides', async () => {
    const r = await restaurant('Panier');
    const code = async (lines: object[]) => {
      const res = await order(r.t1, { clientToken: CLIENT_A, lines });
      return [res.statusCode, res.json().error?.message];
    };
    expect((await code([{ productId: r.burger.id, quantity: 1, modifierIds: [r.cuisson.modifiers[0].id] }]))[0]).toBe(409); // version manquante
    expect((await code([{ productId: r.burger.id, variantId: r.burger.variants[0].id, quantity: 1 }]))[1]).toContain('Cuisson');
    expect((await code([{ productId: r.riz.id, quantity: 1 }]))[1]).toContain("n'est plus disponible");
    const foreign = await restaurant('PanierVoisin');
    expect((await code([{ productId: foreign.jus.id, quantity: 1 }]))[1]).toContain("n'est plus au menu");
    expect((await order(r.t1, { clientToken: CLIENT_A, lines: [] })).statusCode).toBe(400);
    expect((await order('QRinconnuQRinconnuQR', { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).statusCode).toBe(404);
  });

  it('numéros : repartent à 1 à la nouvelle journée d’exploitation', async () => {
    const r = await restaurant('Numeros');
    const n1 = (await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).json().number;
    try {
      t.clock.offsetMs = 26 * 3600_000;
      const next = (await order(r.t1, { clientToken: CLIENT_B, lines: [{ productId: r.jus.id, quantity: 1 }] })).json();
      expect([n1, next.number]).toEqual([1, 1]);
    } finally {
      t.clock.offsetMs = 0;
    }
  });

  it('personnel : confirmer, faire avancer, annuler avec motif ; rôles respectés ; double geste refusé', async () => {
    const r = await restaurant('Service');
    const placed = (await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 2 }] })).json();
    const waiter = as(t, (await login(t, (await addMember(t, r.org.token, 'WAITER')).email)).json().accessToken);
    const cook = as(t, (await login(t, (await addMember(t, r.org.token, 'KITCHEN')).email)).json().accessToken);
    const status = (api: ReturnType<typeof as>, to: string, reason?: string) => api.post(`/api/orders/${placed.id}/status`, { status: to, ...(reason && { reason }) });

    expect((await status(cook, 'CONFIRMED')).statusCode).toBe(403);
    expect((await status(waiter, 'CONFIRMED')).json().status).toBe('CONFIRMED');
    expect((await status(waiter, 'CONFIRMED')).statusCode).toBe(200); // déjà confirmée : sans effet
    expect((await status(cook, 'PREPARING')).json().status).toBe('PREPARING');
    expect((await status(waiter, 'PENDING')).statusCode).toBe(409);
    expect((await status(waiter, 'CANCELLED', 'Client parti')).statusCode).toBe(403);
    expect((await status(r.owner, 'CANCELLED')).statusCode).toBe(400);
    const cancelled = (await status(r.owner, 'CANCELLED', 'Client parti')).json();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.history.map((h: { to: string }) => h.to)).toEqual(['PENDING', 'CONFIRMED', 'PREPARING', 'CANCELLED']);
    expect(cancelled.history[3]).toMatchObject({ reason: 'Client parti' });

    const audit = (await r.owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(audit).toContain('order.cancelled');

    const suivi = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${r.t1}/orders?clientToken=${CLIENT_A}` })).json();
    expect(suivi[0].status).toBe('CANCELLED');
    expect((await t.app.inject({ method: 'GET', url: `/api/public/menu/${r.t1}/orders?clientToken=${CLIENT_B}` })).json()).toEqual([]);
  });

  it('flux d’activité : liste complète puis seulement ce qui change', async () => {
    const r = await restaurant('Flux');
    await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] });
    const initial = (await r.owner.get(`/api/locations/${r.locationId}/activity`)).json();
    expect(initial.full).toBe(true);
    expect(initial.orders).toHaveLength(1);

    const empty = (await r.owner.get(`/api/locations/${r.locationId}/activity?since=${initial.cursor}`)).json();
    expect(empty).toMatchObject({ full: false, orders: [], requests: [] });

    const second = (await order(r.t2, { clientToken: CLIENT_B, lines: [{ productId: r.jus.id, quantity: 4 }] })).json();
    await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.t2}/requests`, payload: { clientToken: CLIENT_B, kind: 'BILL' } });
    const delta = (await r.owner.get(`/api/locations/${r.locationId}/activity?since=${initial.cursor}`)).json();
    expect(delta.full).toBe(false);
    expect(delta.orders.map((o: { id: string }) => o.id)).toEqual([second.id]);
    expect(delta.requests).toHaveLength(1);
    expect(delta.cursor).toBeGreaterThan(initial.cursor);
  });

  it('appels du client : sans doublon, traités par le personnel', async () => {
    const r = await restaurant('Appels');
    const call = () => t.app.inject({ method: 'POST', url: `/api/public/menu/${r.t1}/requests`, payload: { clientToken: CLIENT_A, kind: 'CALL_WAITER' } });
    const a = (await call()).json();
    const b = (await call()).json();
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ tableLabel: 'T1', kind: 'CALL_WAITER', status: 'OPEN' });

    const open = (await r.owner.get(`/api/locations/${r.locationId}/requests`)).json();
    expect(open).toHaveLength(1);
    const done = (await r.owner.post(`/api/requests/${a.id}/resolve`)).json();
    expect(done.status).toBe('DONE');
    expect(done.handledBy).toBe('Patron Appels');
    expect((await call()).json().id).not.toBe(a.id);
  });

  it('libérer une table : refusé tant qu’une commande est en cours', async () => {
    const r = await restaurant('Liberer');
    const placed = (await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).json();
    const session = (await r.owner.get(`/api/locations/${r.locationId}/orders`)).json()[0].sessionId;
    expect((await r.owner.post(`/api/table-sessions/${session}/close`)).statusCode).toBe(409);
    // Depuis la phase 6, une commande ne se termine qu'une fois encaissée.
    await r.owner.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    expect((await r.owner.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: placed.id }, method: 'CASH', amount: 1000 })).statusCode).toBe(201);
    for (const to of ['CONFIRMED', 'READY', 'SERVED', 'COMPLETED']) {
      expect((await r.owner.post(`/api/orders/${placed.id}/status`, { status: to })).statusCode).toBe(200);
    }
    expect((await r.owner.post(`/api/table-sessions/${session}/close`)).statusCode).toBe(204);
    const next = (await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).json();
    const sessions = (await r.owner.get(`/api/locations/${r.locationId}/orders`)).json();
    expect(sessions.find((o: { id: string }) => o.id === next.id).sessionId).not.toBe(session);
  });

  it('limites anti-abus et établissement en mode serveur local', async () => {
    const r = await restaurant('Abus');
    for (let i = 0; i < 5; i++) expect((await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).statusCode).toBe(201);
    expect((await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).statusCode).toBe(429);

    await r.owner.patch(`/api/locations/${r.locationId}`, { operatingMode: 'HYBRID' });
    const offline = await order(r.t2, { clientToken: CLIENT_B, lines: [{ productId: r.jus.id, quantity: 1 }] });
    expect(offline.statusCode).toBe(503);
    expect(offline.json().error.message).toContain('Adressez-vous à un serveur');
  });

  it('isolation : une autre organisation ne voit ni ne touche ces commandes', async () => {
    const r = await restaurant('IsoCmdA');
    const placed = (await order(r.t1, { clientToken: CLIENT_A, lines: [{ productId: r.jus.id, quantity: 1 }] })).json();
    const other = await restaurant('IsoCmdB');
    expect((await other.owner.get(`/api/locations/${r.locationId}/orders`)).statusCode).toBe(404);
    expect((await other.owner.get(`/api/locations/${r.locationId}/activity`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' })).statusCode).toBe(404);
  });
});
