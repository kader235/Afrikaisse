import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Phase 6 — caisse — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);

  /** Restaurant : 3 tables, un burger à cuisson obligatoire, un jus, un repas du personnel (catégorie masquée). */
  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const tables = [];
    for (const l of ['T1', 'T2', 'T3']) tables.push((await owner.post(`/api/zones/${zone.id}/tables`, { label: l })).json());
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const plats = menu.categories[0].id;
    menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Personnel', isVisible: false })).json();
    const personnel = menu.categories.find((c: { name: string }) => c.name === 'Personnel').id;
    menu = (await owner.post(`/api/locations/${locationId}/modifier-groups`, { name: 'Cuisson', minSelect: 1, modifiers: [{ name: 'Saignant' }, { name: 'À point' }] })).json();
    const cuisson = menu.modifierGroups[0];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Burger', price: 5000, variants: [{ name: 'Simple' }, { name: 'Double', priceDelta: 1500 }], modifierGroupIds: [cuisson.id] })).json();
    const burger = menu.products[0];
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Jus', price: 1000 })).json();
    const jus = menu.products.find((p: { name: string }) => p.name === 'Jus');
    menu = (await owner.post(`/api/categories/${personnel}/products`, { name: 'Repas du personnel', price: 500 })).json();
    const staffMeal = menu.products.find((p: { name: string }) => p.name === 'Repas du personnel');
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes;

    const burgerLine = (quantity = 1) => ({ productId: burger.id, variantId: burger.variants[1].id, modifierIds: [cuisson.modifiers[1].id], quantity });
    const jusLine = (quantity = 1) => ({ productId: jus.id, quantity });
    const api = (who: ReturnType<typeof as>) => ({
      order: (body: object) => who.post(`/api/locations/${locationId}/orders`, body),
      pay: (body: object) => who.post(`/api/locations/${locationId}/payments`, body),
      open: (openingFloat = 0) => who.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat }),
      current: async () => (await who.get(`/api/locations/${locationId}/cash-session`)).json().session,
      checks: async () => (await who.get(`/api/locations/${locationId}/checks`)).json(),
      status: (orderId: string, status: string, reason?: string) => who.post(`/api/orders/${orderId}/status`, { status, ...(reason && { reason }) }),
    });
    return { org, owner, locationId, tables, burger, jus, staffMeal, qr, burgerLine, jusLine, api };
  }

  it('prise de commande par le personnel : confirmée d’emblée, en salle ou à emporter, droits respectés', async () => {
    const r = await restaurant('Saisie');
    const cashier = await member(r.org.token, 'CASHIER');
    const waiter = await member(r.org.token, 'WAITER');
    const cook = await member(r.org.token, 'KITCHEN');

    const salle = await r.api(cashier).order({ tableId: r.tables[0].id, lines: [r.burgerLine()] });
    expect(salle.statusCode).toBe(201);
    expect(salle.json()).toMatchObject({ number: 1, status: 'CONFIRMED', source: 'POS', tableLabel: 'T1', serviceType: 'DINE_IN', total: 6500, paymentStatus: 'UNPAID' });
    expect(salle.json().history).toEqual([expect.objectContaining({ from: null, to: 'CONFIRMED', by: 'CASHIER test' })]);

    const emporter = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', customerName: 'Moussa', lines: [r.jusLine(2)] })).json();
    expect(emporter).toMatchObject({ number: 2, tableId: null, sessionId: null, serviceType: 'TAKEAWAY', customerName: 'Moussa', total: 2000 });

    expect((await r.api(waiter).order({ tableId: r.tables[1].id, lines: [r.jusLine()] })).json().source).toBe('WAITER');
    expect((await r.api(cook).order({ tableId: r.tables[1].id, lines: [r.jusLine()] })).statusCode).toBe(403);

    // Catégorie masquée au client : vendable en caisse, pas depuis le QR.
    expect((await r.api(cashier).order({ lines: [{ productId: r.staffMeal.id, quantity: 1 }] })).statusCode).toBe(201);
    const viaQr = await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr[0].token}/orders`, payload: { clientToken: 'client-telephone-aaaaaaaa', lines: [{ productId: r.staffMeal.id, quantity: 1 }] } });
    expect(viaQr.statusCode).toBe(409);

    const sansCuisson = await r.api(cashier).order({ lines: [{ productId: r.burger.id, variantId: r.burger.variants[0].id, quantity: 1 }] });
    expect(sansCuisson.statusCode).toBe(409);
    expect(sansCuisson.json().error.message).toContain('Cuisson');

    const voisin = await restaurant('SaisieVoisin');
    expect((await r.api(cashier).order({ tableId: voisin.tables[0].id, lines: [r.jusLine()] })).statusCode).toBe(404);
  });

  it('caisse : encaissement refusé tant qu’elle est fermée ; une seule caisse ouverte', async () => {
    const r = await restaurant('Ouverture');
    const cashier = await member(r.org.token, 'CASHIER');
    const waiter = await member(r.org.token, 'WAITER');
    const order = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.jusLine()] })).json();

    const closed = await r.api(cashier).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 1000 });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.message).toContain('Ouvrez la caisse');

    expect((await r.api(waiter).open(5000)).statusCode).toBe(403);
    const opened = await r.api(cashier).open(20000);
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({ status: 'OPEN', openingFloat: 20000, openedBy: 'CASHIER test', summary: { expectedCash: 20000 } });
    expect((await r.api(r.owner).open(0)).statusCode).toBe(409);
    expect((await r.api(cashier).current()).id).toBe(opened.json().id);
  });

  it('vente au comptoir en espèces : monnaie rendue, reçu numéroté, terminée une fois servie', async () => {
    const r = await restaurant('Comptoir');
    const cashier = await member(r.org.token, 'CASHIER');
    await r.api(cashier).open(10000);
    const order = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.burgerLine(), r.jusLine(2)] })).json();
    expect(order.total).toBe(8500);

    const paid = await r.api(cashier).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 8500, tendered: 10000 });
    expect(paid.statusCode).toBe(201);
    const receipt = paid.json();
    expect(receipt.payment).toMatchObject({ receiptNumber: 1, method: 'CASH', amount: 8500, tendered: 10000, change: 1500, by: 'CASHIER test' });
    expect(receipt).toMatchObject({ remaining: 0, organization: 'Groupe Comptoir', location: { name: 'Comptoir Centre' } });
    expect(receipt.orders[0]).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    expect((await r.api(cashier).checks()).some((c: { id: string }) => c.id === order.id)).toBe(false);

    expect((await r.api(cashier).status(order.id, 'READY')).json().status).toBe('READY');
    const served = (await r.api(cashier).status(order.id, 'SERVED')).json();
    expect(served.status).toBe('COMPLETED');
    expect(served.history.slice(-2).map((h: { to: string }) => h.to)).toEqual(['SERVED', 'COMPLETED']);

    const jus = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.jusLine()] })).json();
    const trop = await r.api(cashier).pay({ target: { kind: 'order', id: jus.id }, method: 'CARD', amount: 1500 });
    expect(trop.statusCode).toBe(409);
    expect(trop.json().error.message).toContain('dépasse');
    expect((await r.api(cashier).pay({ target: { kind: 'order', id: jus.id }, method: 'CASH', amount: 1000, tendered: 500 })).statusCode).toBe(400);
    expect((await r.api(cashier).pay({ target: { kind: 'order', id: jus.id }, method: 'CARD', amount: 1000 })).json().payment.receiptNumber).toBe(2);

    const events = await t.ctx.db.selectFrom('sync_events').select('operation').where('entity_type', '=', 'payment').where('location_id', '=', r.locationId).execute();
    expect(events.map((e) => e.operation)).toEqual(['PAYMENT_RECORDED', 'PAYMENT_RECORDED']);
  });

  it('addition d’une table réglée en deux fois : répartition, terminaison, table libérée seule', async () => {
    const r = await restaurant('Addition');
    await r.api(r.owner).open(5000);
    const qr = (await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr[0].token}/orders`, payload: { clientToken: 'client-telephone-aaaaaaaa', lines: [r.jusLine(3)] } })).json();
    await r.api(r.owner).status(qr.id, 'CONFIRMED');
    const pos = (await r.api(r.owner).order({ tableId: r.tables[0].id, lines: [r.burgerLine()] })).json();

    const [check] = await r.api(r.owner).checks();
    expect(check).toMatchObject({ kind: 'session', tableLabel: 'T1', total: 9500, paid: 0, remaining: 9500 });
    expect(check.orders).toHaveLength(2);

    for (const id of [qr.id, pos.id]) {
      await r.api(r.owner).status(id, 'READY');
      await r.api(r.owner).status(id, 'SERVED');
    }
    const early = await r.api(r.owner).status(pos.id, 'COMPLETED');
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('Encaissez');

    const first = (await r.api(r.owner).pay({ target: { kind: 'session', id: check.id }, method: 'MOBILE_MONEY', amount: 4750, provider: 'Airtel Money', reference: 'TX-2026-001' })).json();
    expect(first.payment.allocations).toEqual([
      { orderId: qr.id, orderNumber: qr.number, amount: 3000 },
      { orderId: pos.id, orderNumber: pos.number, amount: 1750 },
    ]);
    expect(first.payment).toMatchObject({ provider: 'Airtel Money', reference: 'TX-2026-001', change: 0 });
    expect(first.remaining).toBe(4750);
    const after = new Map(first.orders.map((o: { id: string }) => [o.id, o]));
    expect(after.get(qr.id)).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID' });
    expect(after.get(pos.id)).toMatchObject({ status: 'SERVED', paymentStatus: 'PARTIAL', paid: 1750 });
    expect((await r.api(r.owner).checks())[0].remaining).toBe(4750);

    const second = (await r.api(r.owner).pay({ target: { kind: 'session', id: check.id }, method: 'CASH', amount: 4750 })).json();
    expect(second.remaining).toBe(0);
    expect(second.orders.every((o: { status: string }) => o.status === 'COMPLETED')).toBe(true);
    expect(await r.api(r.owner).checks()).toEqual([]);
    const session = await t.ctx.db.selectFrom('table_sessions').select('status').where('id', '=', check.id).executeTakeFirstOrThrow();
    expect(session.status).toBe('CLOSED');
    expect((await r.api(r.owner).pay({ target: { kind: 'session', id: check.id }, method: 'CASH', amount: 100 })).statusCode).toBe(409);

    const drawer = await r.api(r.owner).current();
    expect(drawer.summary).toMatchObject({ paymentsTotal: 9500, paymentCount: 2, cashPayments: 4750, expectedCash: 9750 });
    expect(drawer.summary.byMethod).toEqual([
      { method: 'CASH', count: 1, amount: 4750 },
      { method: 'MOBILE_MONEY', count: 1, amount: 4750 },
    ]);
  });

  it('remise : réservée aux responsables, motivée, tracée ; impossible après un paiement', async () => {
    const r = await restaurant('Remise');
    const cashier = await member(r.org.token, 'CASHIER');
    const manager = await member(r.org.token, 'MANAGER');
    const order = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.burgerLine()] })).json();
    const discount = (who: ReturnType<typeof as>, body: object) => who.post(`/api/orders/${order.id}/discount`, body);

    expect((await discount(cashier, { kind: 'PERCENT', value: 10, reason: 'Fidèle' })).statusCode).toBe(403);
    expect((await discount(manager, { kind: 'PERCENT', value: 10 })).statusCode).toBe(400);
    expect((await discount(manager, { kind: 'PERCENT', value: 120, reason: 'x' })).statusCode).toBe(400);
    expect((await discount(manager, { kind: 'PERCENT', value: 10, reason: 'Client fidèle' })).json()).toMatchObject({ subtotal: 6500, discount: 650, total: 5850, discountReason: 'Client fidèle' });
    expect((await discount(manager, { kind: 'AMOUNT', value: 10000, reason: 'Offert' })).json()).toMatchObject({ discount: 6500, total: 0, paymentStatus: 'PAID' });
    expect((await discount(manager, { kind: 'AMOUNT', value: 0 })).json()).toMatchObject({ discount: 0, total: 6500, paymentStatus: 'UNPAID', discountReason: null });

    expect((await r.owner.get('/api/audit')).json().filter((a: { action: string }) => a.action === 'order.discount')).toHaveLength(3);

    await r.api(cashier).open();
    await r.api(cashier).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 1000 });
    expect((await discount(manager, { kind: 'PERCENT', value: 5, reason: 'Geste' })).statusCode).toBe(409);
  });

  it('annulation d’un paiement : droits, motif, note rouverte ; commande payée non annulable', async () => {
    const r = await restaurant('AnnulPaiement');
    const cashier = await member(r.org.token, 'CASHIER');
    const manager = await member(r.org.token, 'MANAGER');
    await r.api(cashier).open();
    const order = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.jusLine(2)] })).json();
    const receipt = (await r.api(cashier).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 2000 })).json();
    const voidIt = (who: ReturnType<typeof as>, body: object) => who.post(`/api/payments/${receipt.payment.id}/void`, body);

    expect((await voidIt(cashier, { reason: 'Erreur' })).statusCode).toBe(403);
    expect((await voidIt(manager, {})).statusCode).toBe(400);
    expect((await voidIt(manager, { reason: 'Mauvais mode de paiement' })).json()).toMatchObject({ status: 'VOIDED', voidReason: 'Mauvais mode de paiement' });
    expect((await voidIt(manager, { reason: 'Encore' })).json().status).toBe('VOIDED');
    const [check] = await r.api(cashier).checks();
    expect(check).toMatchObject({ kind: 'order', id: order.id, remaining: 2000 });
    expect((await r.owner.get('/api/audit')).json().some((a: { action: string }) => a.action === 'payment.voided')).toBe(true);

    await r.api(cashier).pay({ target: { kind: 'order', id: order.id }, method: 'CARD', amount: 500 });
    const cancel = await r.api(r.owner).status(order.id, 'CANCELLED', 'Client parti');
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().error.message).toContain('paiement');

    const drawer = await r.api(cashier).current();
    expect(drawer.summary).toMatchObject({ paymentsTotal: 500, voidedCount: 1, voidedAmount: 2000, cashPayments: 0 });
  });

  it('clôture de caisse (Z) : espèces attendues, écart, historique ; plus rien après', async () => {
    const r = await restaurant('Cloture');
    const cashier = await member(r.org.token, 'CASHIER');
    const opened = (await r.api(cashier).open(10000)).json();
    const burger = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.burgerLine()] })).json();
    const receipt = (await r.api(cashier).pay({ target: { kind: 'order', id: burger.id }, method: 'CASH', amount: 6500, tendered: 10000 })).json();
    const jus = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.jusLine()] })).json();
    await r.api(cashier).pay({ target: { kind: 'order', id: jus.id }, method: 'CARD', amount: 1000 });

    const move = (body: object) => cashier.post(`/api/cash-sessions/${opened.id}/movements`, body);
    expect((await move({ kind: 'OUT', amount: 2000, reason: 'Achat de glace' })).statusCode).toBe(200);
    expect((await move({ kind: 'IN', amount: 500, reason: 'Monnaie' })).statusCode).toBe(200);
    expect((await move({ kind: 'OUT', amount: 100000, reason: 'Trop' })).statusCode).toBe(409);
    expect((await move({ kind: 'OUT', amount: 100 })).statusCode).toBe(400);

    const live = await r.api(cashier).current();
    expect(live.summary.expectedCash).toBe(10000 + 6500 + 500 - 2000);
    expect(live.movements.map((m: { kind: string; by: string }) => [m.kind, m.by])).toEqual([
      ['OUT', 'CASHIER test'],
      ['IN', 'CASHIER test'],
    ]);
    expect(live.payments).toHaveLength(2);

    const closed = (await cashier.post(`/api/cash-sessions/${opened.id}/close`, { countedCash: 14800, note: 'Pièce manquante' })).json();
    expect(closed).toMatchObject({ status: 'CLOSED', countedCash: 14800, difference: -200, closedBy: 'CASHIER test', note: 'Pièce manquante', summary: { expectedCash: 15000, paymentsTotal: 7500 } });
    expect((await cashier.post(`/api/cash-sessions/${opened.id}/close`, { countedCash: 1 })).statusCode).toBe(409);
    expect((await move({ kind: 'IN', amount: 500, reason: 'Tard' })).statusCode).toBe(409);
    expect(await r.api(cashier).current()).toBeNull();

    const other = (await r.api(cashier).order({ serviceType: 'TAKEAWAY', lines: [r.jusLine()] })).json();
    expect((await r.api(cashier).pay({ target: { kind: 'order', id: other.id }, method: 'CASH', amount: 1000 })).statusCode).toBe(409);
    expect((await r.owner.post(`/api/payments/${receipt.payment.id}/void`, { reason: 'Trop tard' })).statusCode).toBe(409);

    const history = (await cashier.get(`/api/locations/${r.locationId}/cash-sessions`)).json();
    expect(history[0]).toMatchObject({ id: opened.id, status: 'CLOSED', difference: -200 });
    expect((await r.owner.get('/api/audit')).json().some((a: { action: string }) => a.action === 'cash.closed')).toBe(true);
    expect((await r.api(cashier).open(0)).statusCode).toBe(201);
  });

  it('changer de table, puis regrouper deux tables', async () => {
    const r = await restaurant('Transfert');
    const [t1, t2, t3] = r.tables;
    const first = (await r.api(r.owner).order({ tableId: t1.id, lines: [r.jusLine()] })).json();
    expect((await r.owner.post(`/api/table-sessions/${first.sessionId}/transfer`, { tableId: t2.id })).statusCode).toBe(204);
    let checks = await r.api(r.owner).checks();
    expect(checks.map((c: { tableLabel: string }) => c.tableLabel)).toEqual(['T2']);
    expect(checks[0].orders[0].tableLabel).toBe('T2');

    const second = (await r.api(r.owner).order({ tableId: t1.id, lines: [r.burgerLine()] })).json();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect((await r.owner.post(`/api/table-sessions/${second.sessionId}/transfer`, { tableId: t2.id })).statusCode).toBe(204);
    checks = await r.api(r.owner).checks();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ id: first.sessionId, tableLabel: 'T2', total: 7500 });
    expect((await r.owner.post(`/api/table-sessions/${second.sessionId}/transfer`, { tableId: t3.id })).statusCode).toBe(409);

    await r.owner.post(`/api/tables/${t3.id}/archive`);
    expect((await r.owner.post(`/api/table-sessions/${first.sessionId}/transfer`, { tableId: t3.id })).statusCode).toBe(404);
    expect((await r.owner.get('/api/audit')).json().map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['table.transferred', 'table.merged']));
  });

  it('isolation : une autre organisation ne voit ni n’encaisse rien', async () => {
    const r = await restaurant('IsoCaisseA');
    await r.api(r.owner).open();
    const order = (await r.api(r.owner).order({ tableId: r.tables[0].id, lines: [r.jusLine()] })).json();
    const receipt = (await r.api(r.owner).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 500 })).json();
    const other = await restaurant('IsoCaisseB');
    await other.api(other.owner).open();
    expect((await other.owner.get(`/api/locations/${r.locationId}/checks`)).statusCode).toBe(404);
    expect((await other.owner.get(`/api/locations/${r.locationId}/cash-session`)).statusCode).toBe(404);
    expect((await other.api(other.owner).pay({ target: { kind: 'order', id: order.id }, method: 'CASH', amount: 500 })).statusCode).toBe(404);
    expect((await other.owner.get(`/api/payments/${receipt.payment.id}/receipt`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/payments/${receipt.payment.id}/void`, { reason: 'x' })).statusCode).toBe(404);
    expect((await other.owner.post(`/api/orders/${order.id}/discount`, { kind: 'AMOUNT', value: 0 })).statusCode).toBe(404);
    expect((await other.owner.post(`/api/table-sessions/${order.sessionId}/transfer`, { tableId: other.tables[0].id })).statusCode).toBe(404);
    expect((await other.owner.get(`/api/cash-sessions/${receipt.payment.cashSessionId}`)).statusCode).toBe(404);
  });
});
