import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/**
 * Historique d'une commande : identifiant de l'auteur de chaque geste (`byUserId`). Les tablettes
 * s'en servent pour ne pas alerter quelqu'un de son propre geste (apps/web/src/alertRules.ts).
 */
describe.each(ENGINES)('historique des commandes : auteur du geste — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('commande saisie par le personnel, commande QR confirmée par un serveur', async () => {
    const org = await registerOrg(t, 'Auteur');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    menu = (await owner.post(`/api/categories/${menu.categories[0].id}/products`, { name: 'Riz gras', price: 2500 })).json();
    const productId = menu.products[0].id as string;

    const staff = await owner.post(`/api/locations/${locationId}/orders`, { tableId: table.id, lines: [{ productId, quantity: 1 }] });
    expect(staff.statusCode, staff.body).toBe(201);
    const staffOrder = staff.json();
    expect(staffOrder.history[0]).toMatchObject({ byUserId: org.me.user.id, by: `Patron Auteur` });

    const { email } = await addMember(t, org.token, 'WAITER');
    const session = (await login(t, email)).json();
    const waiter = as(t, session.accessToken);

    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const placed = await t.app.inject({ method: 'POST', url: `/api/public/menu/${qr}/orders`, payload: { clientToken: 'client-auteur-000001', lines: [{ productId, quantity: 1 }] } });
    expect(placed.statusCode, placed.body).toBe(201);
    const confirmed = await waiter.post(`/api/orders/${placed.json().id}/status`, { status: 'CONFIRMED' });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const history = confirmed.json().history as { to: string; byUserId: string | null }[];
    expect(history.map((h) => [h.to, h.byUserId])).toEqual([
      ['PENDING', null],
      ['CONFIRMED', session.me.user.id],
    ]);

    // Le flux d'activité des tablettes porte la même information.
    const activity = (await waiter.get(`/api/locations/${locationId}/activity?since=0`)).json();
    const fromFeed = activity.orders.find((o: { id: string }) => o.id === staffOrder.id);
    expect(fromFeed.history[0].byUserId).toBe(org.me.user.id);
  });
});
