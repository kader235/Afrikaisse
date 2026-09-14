import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/**
 * Scénario du cahier des charges (§76), de bout en bout par HTTP, avec les vrais rôles :
 * client (QR, sans compte), serveur, cuisinier, barman, caissier.
 */
describe.each(ENGINES)('Scénario §76 — du QR au rapport Z — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);
  const CLIENT = 'client-table-douze-0001';

  it('table 12 : QR → confirmation → cuisine et bar → servie → addition → ajout → paiement → reçu → table libérée → Z', async () => {
    // Mise en place par le propriétaire.
    const org = await registerOrg(t, 'Scenario');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table12 = (await owner.post(`/api/zones/${zone.id}/tables`, { label: '12', capacity: 4 })).json();
    const stations = (await owner.get(`/api/locations/${locationId}/stations`)).json();
    const bar = stations.find((s: { kind: string }) => s.kind === 'BAR');
    const cuisine = stations.find((s: { kind: string }) => s.kind === 'KITCHEN');
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const plats = menu.categories[0].id;
    menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Boissons' })).json();
    const boissons = menu.categories.find((c: { name: string }) => c.name === 'Boissons').id;
    menu = (await owner.post(`/api/locations/${locationId}/modifier-groups`, { name: 'Suppléments', maxSelect: 1, modifiers: [{ name: 'Fromage', priceDelta: 500 }] })).json();
    const fromage = menu.modifierGroups[0].modifiers[0];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Burger', price: 5000, modifierGroupIds: [menu.modifierGroups[0].id] })).json();
    const burger = menu.products.find((p: { name: string }) => p.name === 'Burger');
    menu = (await owner.post(`/api/categories/${boissons}/products`, { name: 'Jus de gingembre', price: 1000, stationId: bar.id })).json();
    const jus = menu.products.find((p: { name: string }) => p.name === 'Jus de gingembre');
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes.find((c: { tableLabel: string }) => c.tableLabel === '12').token;

    const waiter = await member(org.token, 'WAITER');
    const cook = await member(org.token, 'KITCHEN');
    const barman = await member(org.token, 'BAR');
    const cashier = await member(org.token, 'CASHIER');
    const pub = (method: 'GET' | 'POST', url: string, payload?: object) => t.app.inject({ method, url: `/api/public/menu/${token}${url}`, ...(payload && { payload }) });

    // 1. Le client scanne le QR de la table 12 et commande burger + fromage et 2 jus.
    expect((await pub('GET', '')).json().table.label).toBe('12');
    const qr = (await pub('POST', '/orders', { clientToken: CLIENT, lines: [{ productId: burger.id, modifierIds: [fromage.id], quantity: 1 }, { productId: jus.id, quantity: 2 }] })).json();
    expect(qr).toMatchObject({ status: 'PENDING', total: 7500, tableLabel: '12' });

    // 2. Le serveur la voit sur la table et la confirme ; elle part en cuisine et au bar.
    const [check0] = (await waiter.get(`/api/locations/${locationId}/checks`)).json();
    expect(check0).toMatchObject({ kind: 'session', tableId: table12.id, total: 7500 });
    expect((await waiter.post(`/api/orders/${qr.id}/status`, { status: 'CONFIRMED' })).json().status).toBe('CONFIRMED');

    // 3. Cuisine et bar préparent chacun leur part ; la commande devient prête.
    const kds = (who: ReturnType<typeof as>, orderId: string, stationId: string, action: string) => who.post(`/api/orders/${orderId}/kitchen`, { stationId, action });
    expect((await kds(cook, qr.id, cuisine.id, 'START')).json().status).toBe('PREPARING');
    expect((await kds(barman, qr.id, bar.id, 'READY')).json().status).toBe('PREPARING');
    expect((await kds(cook, qr.id, cuisine.id, 'READY')).json().status).toBe('READY');

    // 4. Le serveur sert ; le client suit « servie » sur son téléphone.
    expect((await waiter.post(`/api/orders/${qr.id}/status`, { status: 'SERVED' })).json().status).toBe('SERVED');
    expect((await pub('GET', `/orders?clientToken=${CLIENT}`)).json()[0].status).toBe('SERVED');

    // 5. Le client demande l'addition… puis reprend un jus auprès du serveur.
    expect((await pub('POST', '/requests', { clientToken: CLIENT, kind: 'BILL' })).statusCode).toBe(201);
    const extra = (await waiter.post(`/api/locations/${locationId}/orders`, { tableId: table12.id, lines: [{ productId: jus.id, quantity: 1 }] })).json();
    expect(extra).toMatchObject({ source: 'WAITER', status: 'CONFIRMED', sessionId: check0.id });
    await kds(barman, extra.id, bar.id, 'READY');
    await waiter.post(`/api/orders/${extra.id}/status`, { status: 'SERVED' });

    // 6. Le serveur ne peut pas encaisser ; le caissier ouvre sa caisse et encaisse l'addition.
    expect((await waiter.post(`/api/locations/${locationId}/payments`, { target: { kind: 'session', id: check0.id }, method: 'CASH', amount: 8500 })).statusCode).toBe(403);
    await cashier.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 5000 });
    const [check] = (await cashier.get(`/api/locations/${locationId}/checks`)).json();
    expect(check).toMatchObject({ id: check0.id, total: 8500, remaining: 8500 });
    expect(check.orders).toHaveLength(2);
    const receipt = (await cashier.post(`/api/locations/${locationId}/payments`, { target: { kind: 'session', id: check.id }, method: 'CASH', amount: 8500, tendered: 10000 })).json();
    expect(receipt.payment).toMatchObject({ receiptNumber: 1, change: 1500 });
    expect(receipt.remaining).toBe(0);

    // 7. Tout est terminé, la table est libérée seule, la demande d'addition est close.
    expect(receipt.orders.map((o: { status: string }) => o.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect((await waiter.get(`/api/locations/${locationId}/checks`)).json()).toEqual([]);
    expect((await waiter.get(`/api/locations/${locationId}/requests`)).json()).toEqual([]);
    expect((await pub('GET', `/orders?clientToken=${CLIENT}`)).json()[0].status).toBe('COMPLETED');

    // 8. Clôture : espèces attendues 5 000 + 8 500, comptées juste.
    const drawer = (await cashier.get(`/api/locations/${locationId}/cash-session`)).json().session;
    const closed = (await cashier.post(`/api/cash-sessions/${drawer.id}/close`, { countedCash: 13500 })).json();
    expect(closed).toMatchObject({ status: 'CLOSED', difference: 0, summary: { expectedCash: 13500, paymentsTotal: 8500 } });

    // 9. Traçabilité : événements de synchronisation et journal.
    const events = await t.ctx.db.selectFrom('sync_events').select(['entity_type', 'operation']).where('location_id', '=', locationId).execute();
    expect(events.filter((e) => e.operation === 'ORDER_PLACED')).toHaveLength(2);
    expect(events.filter((e) => e.operation === 'PAYMENT_RECORDED')).toHaveLength(1);
    const actions = (await owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['order.qr_placed', 'cash.opened', 'cash.closed']));
  });
});
