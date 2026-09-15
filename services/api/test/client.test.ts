import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, as, registerOrg, startApp, type TestApp } from './helpers.ts';

const A = 'telephone-client-aaaaaaaa';
const B = 'telephone-client-bbbbbbbb';
const C = 'telephone-client-cccccccc';
const D = 'telephone-client-dddddddd';

describe.each(ENGINES)('Menu client — tables partagées, code de table, populaires, PWA — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  async function restaurant(label: string, settings: Record<string, unknown> = {}) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    if (Object.keys(settings).length) {
      const patched = await owner.patch(`/api/locations/${locationId}`, settings);
      expect(patched.statusCode).toBe(200);
    }
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const t1 = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T2' });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const plats = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Burger', price: 5000 })).json();
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Jus', price: 1000 })).json();
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Riz', price: 2500 })).json();
    const [burger, jus, riz] = ['Burger', 'Jus', 'Riz'].map((n) => menu.products.find((p: { name: string }) => p.name === n));
    const codes = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes;
    return { org, owner, locationId, table1: t1.id as string, burger, jus, riz, qr1: codes[0].token as string, qr2: codes[1].token as string };
  }

  const pub = (method: 'GET' | 'POST', url: string, payload?: object) => t.app.inject({ method, url: `/api/public/menu/${url}`, ...(payload && { payload }) });
  const order = (qr: string, clientToken: string, lines: object[], extra: object = {}) => pub('POST', `${qr}/orders`, { clientToken, lines, ...extra });
  const session = async (qr: string, clientToken: string) => (await pub('GET', `${qr}/session?clientToken=${clientToken}`)).json();

  it('plusieurs téléphones rejoignent la même table et voient ses commandes (surnom facultatif)', async () => {
    const r = await restaurant('Partage');
    const empty = await session(r.qr1, A);
    expect(empty).toMatchObject({ session: null, joined: false, orderingAvailable: true, tableCodeRequired: false, billMode: 'SHARED', orders: [] });

    const a = await order(r.qr1, A, [{ productId: r.burger.id, quantity: 1 }], { nickname: '  Awa ' });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ guestName: 'Awa', mine: true });
    expect((await order(r.qr1, B, [{ productId: r.jus.id, quantity: 2 }])).statusCode).toBe(201);

    const viewA = await session(r.qr1, A);
    const viewB = await session(r.qr1, B);
    expect(viewA.session.id).toBe(viewB.session.id);
    expect(viewA.guests.map((g: { name: string; isMe: boolean }) => [g.name, g.isMe])).toEqual([
      ['Awa', true],
      ['Client 2', false],
    ]);
    expect(viewB.orders).toHaveLength(2);
    expect(viewB.orders.map((o: { guestName: string; mine: boolean }) => [o.guestName, o.mine])).toEqual([
      ['Client 2', true],
      ['Awa', false],
    ]);
    expect(viewA.table).toEqual({ total: 7000, paid: 0, remaining: 7000 });
    expect(viewA.mine).toEqual({ total: 5000, paid: 0, remaining: 5000 });

    // Un troisième téléphone voit la table (pas de code exigé), puis la rejoint avec un surnom.
    const viewC = await session(r.qr1, C);
    expect([viewC.joined, viewC.orders.length]).toEqual([false, 2]);
    const joined = await pub('POST', `${r.qr1}/join`, { clientToken: C, nickname: 'Moussa' });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ joined: true, nickname: 'Moussa' });
    expect(joined.json().guests.map((g: { name: string }) => g.name)).toEqual(['Awa', 'Client 2', 'Moussa']);

    // L'autre table ne voit rien ; le personnel voit les surnoms ; la synchronisation transporte les clients.
    expect((await session(r.qr2, A)).session).toBeNull();
    const staff = (await r.owner.get(`/api/locations/${r.locationId}/orders`)).json();
    expect(staff.map((o: { guestName: string }) => o.guestName).sort()).toEqual(['Awa', 'Client 2']);
    const events = await t.ctx.db.selectFrom('sync_events').select('entity_id').where('entity_type', '=', 'session_guest').where('location_id', '=', r.locationId).execute();
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('addition partagée : une demande pour la table, avec le moyen de paiement annoncé', async () => {
    const r = await restaurant('Partagee');
    await order(r.qr1, A, [{ productId: r.burger.id, quantity: 1 }]);
    await order(r.qr1, B, [{ productId: r.jus.id, quantity: 1 }]);
    const bill = await pub('POST', `${r.qr1}/requests`, { clientToken: A, kind: 'BILL', paymentMethod: 'MOBILE_MONEY', scope: 'MINE' });
    expect(bill.statusCode).toBe(201);
    expect(bill.json()).toMatchObject({ kind: 'BILL', billScope: 'TABLE', paymentMethod: 'MOBILE_MONEY', amount: 6000, guestName: 'Client 1' });
    // Le second téléphone ne fait pas sonner une deuxième fois ; il change seulement le moyen.
    const again = (await pub('POST', `${r.qr1}/requests`, { clientToken: B, kind: 'BILL', paymentMethod: 'CARD' })).json();
    expect(again.id).toBe(bill.json().id);
    const open = (await r.owner.get(`/api/locations/${r.locationId}/requests`)).json();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ paymentMethod: 'CARD', amount: 6000 });
    expect((await session(r.qr1, B)).bill).toMatchObject({ paymentMethod: 'CARD', scope: 'TABLE', mine: false });
    const [check] = (await r.owner.get(`/api/locations/${r.locationId}/checks`)).json();
    expect(check).toMatchObject({ billMode: 'SHARED', joinCode: null, total: 6000 });
  });

  it('addition par client : chacun demande sa part, ou toute la table', async () => {
    const r = await restaurant('ParClient', { billMode: 'PER_CUSTOMER' });
    await order(r.qr1, A, [{ productId: r.burger.id, quantity: 1 }], { nickname: 'Awa' });
    await order(r.qr1, B, [{ productId: r.jus.id, quantity: 1 }], { nickname: 'Brahim' });
    const menu = (await pub('GET', r.qr1)).json();
    expect(menu.service).toEqual({ tableCodeRequired: false, billMode: 'PER_CUSTOMER' });

    const mineA = (await pub('POST', `${r.qr1}/requests`, { clientToken: A, kind: 'BILL', paymentMethod: 'CASH' })).json();
    const mineB = (await pub('POST', `${r.qr1}/requests`, { clientToken: B, kind: 'BILL', paymentMethod: 'MOBILE_MONEY' })).json();
    expect(mineA).toMatchObject({ billScope: 'MINE', amount: 5000, guestName: 'Awa', paymentMethod: 'CASH' });
    expect(mineB).toMatchObject({ billScope: 'MINE', amount: 1000, guestName: 'Brahim' });
    expect(mineB.id).not.toBe(mineA.id);
    const whole = (await pub('POST', `${r.qr1}/requests`, { clientToken: A, kind: 'BILL', scope: 'TABLE', paymentMethod: 'CARD' })).json();
    expect(whole).toMatchObject({ billScope: 'TABLE', amount: 6000 });
    expect((await r.owner.get(`/api/locations/${r.locationId}/requests`)).json()).toHaveLength(3);

    const viewB = await session(r.qr1, B);
    expect(viewB.mine).toEqual({ total: 1000, paid: 0, remaining: 1000 });
    expect(viewB.bill).toMatchObject({ scope: 'MINE', paymentMethod: 'MOBILE_MONEY', mine: true });
    expect(viewB.guests.map((g: { name: string; share: { total: number } }) => [g.name, g.share.total])).toEqual([
      ['Awa', 5000],
      ['Brahim', 1000],
    ]);

    // Brahim paie sa part à la caisse : sa demande reste lisible, sa part tombe à zéro.
    const [check] = (await r.owner.get(`/api/locations/${r.locationId}/checks`)).json();
    expect(check.billMode).toBe('PER_CUSTOMER');
    const brahimOrder = check.orders.find((o: { guestName: string }) => o.guestName === 'Brahim');
    await r.owner.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    expect((await r.owner.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: brahimOrder.id }, method: 'MOBILE_MONEY', amount: 1000 })).statusCode).toBe(201);
    expect((await session(r.qr1, B)).mine.remaining).toBe(0);
  });

  it('code de table : table à ouvrir, code exigé, invalide, valide ; gardé pour la table ouverte', async () => {
    const r = await restaurant('Code', { tableCodeRequired: true });
    const line = [{ productId: r.jus.id, quantity: 1 }];

    const notOpen = await order(r.qr1, A, line);
    expect(notOpen.statusCode).toBe(409);
    expect(notOpen.json().error.details.reason).toBe('TABLE_NOT_OPEN');
    expect((await pub('POST', `${r.qr1}/join`, { clientToken: A, code: '0000' })).statusCode).toBe(409);

    // Le serveur installe les clients : la table s'ouvre avec son code, visible sur la note.
    const opened = await r.owner.post(`/api/tables/${r.table1}/open`);
    expect(opened.statusCode).toBe(200);
    const code = opened.json().joinCode as string;
    expect(code).toMatch(/^\d{4}$/);
    expect((await r.owner.post(`/api/tables/${r.table1}/open`)).json()).toMatchObject({ sessionId: opened.json().sessionId, joinCode: code });
    const [check] = (await r.owner.get(`/api/locations/${r.locationId}/checks`)).json();
    expect(check).toMatchObject({ id: opened.json().sessionId, joinCode: code, orders: [] });

    const missing = await order(r.qr1, A, line);
    expect([missing.statusCode, missing.json().error.details.reason]).toEqual([403, 'TABLE_CODE_REQUIRED']);
    const wrong = String((Number(code) + 1) % 10_000).padStart(4, '0');
    const invalid = await order(r.qr1, A, line, { tableCode: wrong });
    expect([invalid.statusCode, invalid.json().error.details.reason]).toEqual([403, 'TABLE_CODE_INVALID']);
    expect((await order(r.qr1, A, line, { tableCode: 'abcd' })).statusCode).toBe(400);

    // Sans code, un téléphone ne voit rien de la table.
    const outsider = await session(r.qr1, A);
    expect(outsider).toMatchObject({ joined: false, guests: [], orders: [], tableCodeRequired: true });
    expect(outsider.table.total).toBe(0);

    // Code valide à la commande : le téléphone rejoint la table et n'a plus à le saisir.
    expect((await order(r.qr1, A, line, { tableCode: code, nickname: 'Awa' })).statusCode).toBe(201);
    expect((await order(r.qr1, A, line)).statusCode).toBe(201);
    // Autre téléphone : rejoint d'abord avec le code, puis commande sans le redonner.
    expect((await pub('POST', `${r.qr1}/join`, { clientToken: B, code: wrong })).statusCode).toBe(403);
    const joinB = await pub('POST', `${r.qr1}/join`, { clientToken: B, code });
    expect(joinB.json()).toMatchObject({ joined: true });
    expect(joinB.json().orders).toHaveLength(2);
    expect((await order(r.qr1, B, line)).statusCode).toBe(201);

    // Nouveau code : les téléphones installés restent, l'ancien code ne fait plus entrer personne.
    const renewed = (await r.owner.post(`/api/table-sessions/${opened.json().sessionId}/code`)).json();
    expect(renewed.joinCode).toMatch(/^\d{4}$/);
    expect((await order(r.qr1, B, line)).statusCode).toBe(201);
    if (renewed.joinCode !== code) expect((await pub('POST', `${r.qr1}/join`, { clientToken: C, code })).statusCode).toBe(403);
    expect((await pub('POST', `${r.qr1}/join`, { clientToken: C, code: renewed.joinCode })).statusCode).toBe(200);

    // Échecs tracés dans le journal ; un autre restaurant ne peut ni ouvrir la table ni changer son code.
    const audit = (await r.owner.get('/api/audit')).json().map((e: { action: string }) => e.action);
    expect(audit).toContain('table.code_failed');
    expect(audit).toContain('table.opened');
    const other = await restaurant('CodeVoisin');
    expect((await other.owner.post(`/api/tables/${r.table1}/open`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/table-sessions/${opened.json().sessionId}/code`)).statusCode).toBe(404);
  });

  it('code de table : blocage après 10 codes faux, même avec le bon code', async () => {
    const r = await restaurant('Blocage', { tableCodeRequired: true });
    const { joinCode } = (await r.owner.post(`/api/tables/${r.table1}/open`)).json();
    const wrong = String((Number(joinCode) + 5) % 10_000).padStart(4, '0');
    for (let i = 0; i < 10; i++) expect((await pub('POST', `${r.qr1}/join`, { clientToken: D, code: wrong })).statusCode).toBe(403);
    const locked = await pub('POST', `${r.qr1}/join`, { clientToken: D, code: joinCode });
    expect([locked.statusCode, locked.json().error.details.reason]).toEqual([429, 'TABLE_CODE_LOCKED']);
    // Après la fenêtre de 10 minutes, le bon code passe.
    try {
      t.clock.offsetMs = 11 * 60_000;
      expect((await pub('POST', `${r.qr1}/join`, { clientToken: D, code: joinCode })).statusCode).toBe(200);
    } finally {
      t.clock.offsetMs = 0;
    }
  });

  it('populaires : calculés sur les ventes terminées des 30 derniers jours, isolés par organisation', async () => {
    const r = await restaurant('Populaire');
    const other = await restaurant('PopulaireVoisin');
    expect((await pub('GET', r.qr1)).json().popular).toEqual([]);

    await r.owner.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    async function completedSale(lines: { productId: string; quantity: number }[]) {
      const placed = (await r.owner.post(`/api/locations/${r.locationId}/orders`, { serviceType: 'TAKEAWAY', lines })).json();
      expect((await r.owner.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: placed.id }, method: 'CASH', amount: placed.total })).statusCode).toBe(201);
      for (const status of ['READY', 'SERVED']) expect((await r.owner.post(`/api/orders/${placed.id}/status`, { status })).statusCode).toBe(200);
      const done = (await r.owner.get(`/api/locations/${r.locationId}/orders?view=today`)).json().find((o: { id: string }) => o.id === placed.id);
      expect(done.status).toBe('COMPLETED');
    }
    const burger = { productId: r.burger.id, quantity: 1 };
    const jus = { productId: r.jus.id, quantity: 2 };
    await completedSale([burger, jus]);
    await completedSale([burger, jus]);
    await completedSale([burger]);
    await completedSale([{ productId: r.riz.id, quantity: 3 }]);
    // Commandes QR en attente : pas des ventes, elles ne comptent pas.
    for (const phone of [A, B, C]) await order(r.qr1, phone, [{ productId: r.riz.id, quantity: 5 }]);
    expect((await pub('GET', r.qr1)).json().popular).toEqual([]); // 4 ventes terminées : trop peu

    await completedSale([burger]);
    expect((await pub('GET', r.qr1)).json().popular).toEqual([r.burger.id, r.jus.id]);

    // Un produit épuisé n'est pas recommandé ; l'autre organisation ne voit rien de ces ventes.
    await r.owner.post(`/api/products/${r.jus.id}/availability`, { isAvailable: false });
    expect((await pub('GET', r.qr1)).json().popular).toEqual([]);
    await r.owner.post(`/api/products/${r.jus.id}/availability`, { isAvailable: true });
    expect((await pub('GET', other.qr1)).json().popular).toEqual([]);

    try {
      t.clock.offsetMs = 31 * 24 * 3600_000;
      expect((await pub('GET', r.qr1)).json().popular).toEqual([]);
    } finally {
      t.clock.offsetMs = 0;
    }
  });

  it('commande en ligne indisponible (serveur local muet) : signalée à la vue du client', async () => {
    const r = await restaurant('Muet');
    await r.owner.patch(`/api/locations/${r.locationId}`, { operatingMode: 'HYBRID' });
    expect((await session(r.qr1, A)).orderingAvailable).toBe(false);
    const refused = await order(r.qr1, A, [{ productId: r.jus.id, quantity: 1 }]);
    expect([refused.statusCode, refused.json().error.details.reason]).toEqual([503, 'ORDERING_UNAVAILABLE']);
  });

  it('application installable : manifeste, service worker et politique de sécurité du contenu', async () => {
    const r = await restaurant('Pwa');
    const manifest = await pub('GET', `${r.qr1}/manifest.webmanifest`);
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    expect(manifest.json()).toMatchObject({ name: 'Pwa Centre', start_url: `/m/${r.qr1}`, scope: '/m/', display: 'standalone' });
    expect(manifest.json().icons.map((i: { src: string }) => i.src)).toEqual(['/m/icon-192.png', '/m/icon-512.png', '/m/icon-maskable-512.png']);
    expect((await pub('GET', 'QRinconnuQRinconnuQR/manifest.webmanifest')).statusCode).toBe(404);

    // Le vrai service worker et les icônes du dépôt, servis comme en production.
    const publicDir = resolve(import.meta.dirname, '../../../apps/web/public');
    const sw = readFileSync(join(publicDir, 'm', 'sw.js'), 'utf8');
    const dir = mkdtempSync(join(tmpdir(), 'afk-menu-'));
    mkdirSync(join(dir, 'm'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AfriKaisse</title>');
    writeFileSync(join(dir, 'menu.html'), '<!doctype html><title>Menu</title>');
    writeFileSync(join(dir, 'm', 'sw.js'), sw);
    writeFileSync(join(dir, 'm', 'icon-192.png'), readFileSync(join(publicDir, 'm', 'icon-192.png')));
    const web = await startApp(engine, { AFK_WEB_DIR: dir });
    try {
      const worker = await web.app.inject({ method: 'GET', url: '/m/sw.js' });
      expect(worker.statusCode).toBe(200);
      expect(worker.headers['content-type']).toContain('text/javascript');
      expect(worker.headers['cache-control']).toBe('no-cache');
      expect(worker.body).toContain('afk-menu-');
      const icon = await web.app.inject({ method: 'GET', url: '/m/icon-192.png' });
      expect([icon.statusCode, icon.headers['content-type']]).toEqual([200, 'image/png']);
      expect(icon.rawPayload.subarray(1, 4).toString()).toBe('PNG');
      const page = await web.app.inject({ method: 'GET', url: `/m/${r.qr1}` });
      expect(page.headers['content-security-policy']).toContain("worker-src 'self'");
      expect(page.headers['content-security-policy']).toContain("manifest-src 'self'");
    } finally {
      await web.close();
      rmSync(dir, { recursive: true, force: true });
    }
    // Le script est du JavaScript valide pour le navigateur (pas de TypeScript ni d'import).
    expect(() => new Function(sw)).not.toThrow();
  });
});
