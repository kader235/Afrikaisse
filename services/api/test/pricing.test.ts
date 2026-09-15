import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { localMoment } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const TZ = 'Africa/Ndjamena';

describe.each(ENGINES)('Taxes et promotions (§47-48) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => {
    t.clock.offsetMs = 0;
  });

  const member = async (token: string, role: string) => as(t, (await login(t, (await addMember(t, token, role)).email)).json().accessToken);

  /** Avance l'horloge du serveur jusqu'à `minute` (heure locale de N'Djamena), au début de la minute. */
  function moveToLocal(minute: number) {
    const now = Date.now() + t.clock.offsetMs;
    let delta = minute - localMoment(now, TZ).minute;
    if (delta <= 0) delta += 1440;
    t.clock.offsetMs += delta * 60_000 - (now % 60_000);
  }

  /** Boissons (bière 1000, jus 800, soda 1000 à prix barré 700), plats (burger 5000), une table et son QR. */
  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    let owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Boissons' })).json();
    const boissons = menu.categories[0].id as string;
    menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Plats' })).json();
    const plats = menu.categories.find((c: { name: string }) => c.name === 'Plats').id as string;
    await owner.post(`/api/categories/${boissons}/products`, { name: 'Bière', price: 1000 });
    await owner.post(`/api/categories/${boissons}/products`, { name: 'Jus', price: 800 });
    await owner.post(`/api/categories/${boissons}/products`, { name: 'Soda', price: 1000, promoPrice: 700 });
    menu = (await owner.post(`/api/categories/${plats}/products`, { name: 'Burger', price: 5000 })).json();
    const product = (name: string) => menu.products.find((p: { name: string }) => p.name === name).id as string;
    const ids = { biere: product('Bière'), jus: product('Jus'), soda: product('Soda'), burger: product('Burger'), boissons, plats };
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const line = (productId: string, quantity = 1) => ({ productId, quantity });
    const api = {
      relogin: async () => (owner = as(t, (await login(t, org.email)).json().accessToken)),
      get owner() {
        return owner;
      },
      config: async () => (await owner.get(`/api/locations/${locationId}/pricing`)).json(),
      order: (lines: object[], extra: object = {}, who = owner) => who.post(`/api/locations/${locationId}/orders`, { serviceType: 'TAKEAWAY', lines, ...extra }),
      qrOrder: (lines: object[], promoCode?: string) =>
        t.app.inject({ method: 'POST', url: `/api/public/menu/${token}/orders`, payload: { clientToken: `client-${label}-telephone-aaaa`.slice(0, 60), lines, ...(promoCode && { promoCode }) } }),
      promotion: (body: object, who = owner) => who.post(`/api/locations/${locationId}/promotions`, body),
      rate: (body: object, who = owner) => who.post(`/api/locations/${locationId}/tax-rates`, body),
    };
    return { org, locationId, ids, token, line, api };
  }

  it('taxes : TVA incluse par défaut, taux par catégorie et produit, hors taxe, arrondi, historique figé', async () => {
    const r = await restaurant('Taxes');
    const { api, ids, line } = r;
    expect(await api.config()).toMatchObject({ taxMode: 'INCLUSIVE', defaultTaxRateId: null, taxRates: [] });

    // Sans taux : aucune taxe, total inchangé.
    expect((await api.order([line(ids.burger)])).json()).toMatchObject({ total: 5000, taxTotal: 0, taxes: [] });

    const tva = (await api.rate({ name: 'TVA', rateBp: 1800, isDefault: true })).json();
    expect(tva.defaultTaxRateId).toBe(tva.taxRates[0].id);
    const tvaId = tva.taxRates[0].id as string;
    const reduit = (await api.rate({ name: 'TVA réduite', rateBp: 1000 })).json().taxRates.find((x: { name: string }) => x.name === 'TVA réduite');
    expect((await api.rate({ name: 'tva', rateBp: 500 })).statusCode).toBe(409);

    // 6000 TTC à 18 % : taxe 915,25 → 915.
    const a = (await api.order([line(ids.burger), line(ids.biere)])).json();
    expect(a).toMatchObject({ taxMode: 'INCLUSIVE', subtotal: 6000, total: 6000, taxTotal: 915, taxes: [{ rateId: tvaId, name: 'TVA', rateBp: 1800, base: 5085, tax: 915 }] });

    // Catégorie au taux réduit, produit revenu au taux normal.
    expect((await api.owner.put(`/api/categories/${ids.boissons}/tax-rate`, { taxRateId: reduit.id })).statusCode).toBe(200);
    const overridden = (await api.owner.put(`/api/products/${ids.jus}/tax-rate`, { taxRateId: tvaId })).json();
    expect(overridden.categories.find((c: { id: string }) => c.id === ids.boissons).taxRateId).toBe(reduit.id);
    expect(overridden.taxRates.find((x: { id: string }) => x.id === reduit.id).overrides).toBe(1);
    const b = (await api.order([line(ids.biere, 3), line(ids.jus)])).json();
    expect(b.taxes).toEqual([
      { rateId: tvaId, name: 'TVA', rateBp: 1800, base: 678, tax: 122 },
      { rateId: reduit.id, name: 'TVA réduite', rateBp: 1000, base: 2727, tax: 273 },
    ]);
    expect(b).toMatchObject({ total: 3800, taxTotal: 395 });

    // Hors taxe : la taxe s'ajoute ; demi-unité arrondie vers le haut (962,5 → 963).
    expect((await api.owner.patch(`/api/locations/${r.locationId}/pricing`, { taxMode: 'EXCLUSIVE' })).json().taxMode).toBe('EXCLUSIVE');
    const c = (await api.order([line(ids.burger)])).json();
    expect(c).toMatchObject({ taxMode: 'EXCLUSIVE', subtotal: 5000, taxTotal: 900, total: 5900 });
    expect((await api.owner.patch(`/api/tax-rates/${tvaId}`, { rateBp: 1925 })).statusCode).toBe(200);
    const d = (await api.order([line(ids.burger)])).json();
    expect(d).toMatchObject({ taxTotal: 963, total: 5963, taxes: [{ name: 'TVA', rateBp: 1925, base: 5000, tax: 963 }] });

    // Les commandes passées gardent leur mode, leur taux et leurs montants.
    const checks = (await api.owner.get(`/api/locations/${r.locationId}/checks`)).json();
    const byId = new Map(checks.map((x: { id: string; orders: unknown[] }) => [x.id, x.orders[0]]));
    expect(byId.get(a.id)).toMatchObject({ taxMode: 'INCLUSIVE', total: 6000, taxTotal: 915 });
    expect(byId.get(c.id)).toMatchObject({ taxMode: 'EXCLUSIVE', total: 5900, taxes: [{ rateBp: 1800, tax: 900 }] });

    // Remise manuelle : taxes recalculées avec le taux figé de la commande (19,25 %).
    const discounted = (await api.owner.post(`/api/orders/${d.id}/discount`, { kind: 'AMOUNT', value: 1000, reason: 'Geste' })).json();
    expect(discounted).toMatchObject({ discount: 1000, taxTotal: 770, total: 4770, taxes: [{ base: 4000, tax: 770 }] });

    // Reçu : détail des taxes de la commande payée.
    await api.owner.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });
    const receipt = (await api.owner.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: c.id }, method: 'CASH', amount: 5900 })).json();
    expect(receipt.orders[0]).toMatchObject({ total: 5900, taxTotal: 900, taxMode: 'EXCLUSIVE' });

    // Archivage : ni le taux par défaut, ni un taux encore utilisé.
    expect((await api.owner.post(`/api/tax-rates/${tvaId}/archive`)).statusCode).toBe(409);
    expect((await api.owner.post(`/api/tax-rates/${reduit.id}/archive`)).statusCode).toBe(409);
    await api.owner.put(`/api/categories/${ids.boissons}/tax-rate`, { taxRateId: null });
    const archived = (await api.owner.post(`/api/tax-rates/${reduit.id}/archive`)).json();
    expect(archived.taxRates.map((x: { name: string }) => x.name)).toEqual(['TVA']);
  });

  it('promotions automatiques : happy hour dans le fuseau de l’établissement, meilleure par ligne, article offert, commande, prix barré exclu', async () => {
    // 18:30 à N'Djamena, 17:30 UTC : une plage 18:00–19:00 évaluée en UTC échouerait.
    moveToLocal(18 * 60 + 30);
    const r = await restaurant('Happy');
    const { api, ids, line } = r;
    const weekday = localMoment(Date.now() + t.clock.offsetMs, TZ).weekday;
    await api.promotion({ name: 'Happy hour', kind: 'PERCENT', scope: 'CATEGORY', targetId: ids.boissons, value: 5000, startMinute: 18 * 60, endMinute: 19 * 60 });
    const biere = (await api.promotion({ name: 'Bière −100', kind: 'AMOUNT', scope: 'PRODUCT', targetId: ids.biere, value: 100 })).json().promotions[1];
    await api.promotion({ name: '2 + 1 burgers', kind: 'FREE_ITEM', scope: 'PRODUCT', targetId: ids.burger, buyQuantity: 2, freeQuantity: 1 });
    await api.promotion({ name: '−1000 dès 10 000', kind: 'AMOUNT', scope: 'ORDER', value: 1000, minAmount: 10000, days: [weekday] });
    await api.promotion({ name: 'Suspendue', kind: 'PERCENT', scope: 'ORDER', value: 9000, isActive: false });

    // Bière 2000 → happy hour 1000 (mieux que −200) ; soda à prix barré : rien ; 3 burgers : 1 offert ; commande ≥ 10 000 : −1000.
    const order = (await api.order([line(ids.biere, 2), line(ids.soda), line(ids.burger, 3)])).json();
    expect(order).toMatchObject({ subtotal: 17700, promotionDiscount: 7000, total: 10700 });
    expect(order.promotions.map((p: { name: string; amount: number }) => [p.name, p.amount])).toEqual([
      ['Happy hour', 1000],
      ['2 + 1 burgers', 5000],
      ['−1000 dès 10 000', 1000],
    ]);
    expect(order.items.map((i: { name: string; promotionName: string | null; promotionDiscount: number }) => [i.name, i.promotionName, i.promotionDiscount])).toEqual([
      ['Bière', 'Happy hour', 1000],
      ['Soda', null, 0],
      ['Burger', '2 + 1 burgers', 5000],
    ]);

    // Même calcul pour le client au QR, et devis identique.
    const qr = await api.qrOrder([line(ids.biere, 2)]);
    expect(qr.statusCode).toBe(201);
    expect(qr.json()).toMatchObject({ subtotal: 2000, promotionDiscount: 1000, total: 1000, promotions: [{ name: 'Happy hour', amount: 1000 }] });
    const quote = (await api.owner.post(`/api/locations/${r.locationId}/orders/quote`, { lines: [line(ids.biere, 2)] })).json();
    expect(quote).toMatchObject({ total: 1000, lines: [{ promotionName: 'Happy hour', promotionDiscount: 1000 }] });

    const pub = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${r.token}/pricing` })).json();
    expect(pub.timezone).toBe(TZ);
    expect(pub.productCategories[ids.biere]).toBe(ids.boissons);
    expect(pub.promotions.map((p: { name: string }) => p.name).sort()).toEqual(['2 + 1 burgers', 'Bière −100', 'Happy hour', '−1000 dès 10 000']);

    const config = await api.config();
    expect(config.promotions.find((p: { name: string }) => p.name === 'Happy hour').usesCount).toBe(2);

    // 19:30 : l'happy hour est fini, la remise produit reprend la main.
    moveToLocal(19 * 60 + 30);
    await api.relogin();
    expect((await api.order([line(ids.biere, 2)])).json()).toMatchObject({ total: 1800, promotions: [{ name: 'Bière −100', amount: 200 }] });
    await api.owner.post(`/api/promotions/${biere.id}/active`, { isActive: false });
    expect((await api.order([line(ids.biere, 2)])).json()).toMatchObject({ total: 2000, promotionDiscount: 0, promotions: [] });
    expect((await r.api.owner.get('/api/audit')).json().map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['pricing.promotion_created', 'pricing.promotion_paused']));
  });

  it('code promo : casse indifférente, inconnu, minimum, nombre maximal libéré par annulation, expiré, suspendu, cumul', async () => {
    const r = await restaurant('Codes');
    const { api, ids, line } = r;
    const created = await api.promotion({ name: 'Bienvenue', kind: 'PERCENT', scope: 'ORDER', value: 1000, code: 'bienvenue', minAmount: 2000, maxUses: 2 });
    expect(created.statusCode).toBe(201);
    expect(created.json().promotions[0]).toMatchObject({ code: 'BIENVENUE', maxUses: 2, usesCount: 0 });
    expect((await api.promotion({ name: 'Doublon', kind: 'AMOUNT', scope: 'ORDER', value: 100, code: 'BienVenue' })).statusCode).toBe(409);

    const check = (code: string) => api.owner.post(`/api/locations/${r.locationId}/promo-codes/check`, { code });
    expect((await check(' bienvenue ')).json()).toMatchObject({ code: 'BIENVENUE', kind: 'PERCENT', value: 1000 });
    const unknown = await check('NOPE');
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error.message).toBe('Code promo inconnu.');

    const quote = (body: object) => api.owner.post(`/api/locations/${r.locationId}/orders/quote`, body);
    const tooSmall = await quote({ lines: [line(ids.biere)], promoCode: 'bienvenue' });
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json().error.message).toContain('au moins');
    expect((await quote({ lines: [line(ids.biere, 3)], promoCode: 'bienvenue' })).json()).toMatchObject({ total: 2700, promoCode: 'BIENVENUE', promotions: [{ code: 'BIENVENUE', amount: 300 }] });

    const first = (await api.order([line(ids.biere, 3)], { promoCode: 'Bienvenue' })).json();
    expect(first).toMatchObject({ subtotal: 3000, promotionDiscount: 300, total: 2700, promoCode: 'BIENVENUE' });
    const second = await api.qrOrder([line(ids.biere, 3)], 'BIENVENUE');
    expect(second.statusCode).toBe(201);
    const third = await api.order([line(ids.biere, 3)], { promoCode: 'bienvenue' });
    expect(third.statusCode).toBe(409);
    expect(third.json().error.message).toContain('nombre maximal');
    expect((await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.token}/promo-code`, payload: { code: 'bienvenue' } })).statusCode).toBe(409);
    // Commande QR refusée : son utilisation est rendue.
    expect((await api.owner.post(`/api/orders/${second.json().id}/status`, { status: 'CANCELLED' })).json().status).toBe('CANCELLED');
    expect((await api.order([line(ids.biere, 3)], { promoCode: 'bienvenue' })).statusCode).toBe(201);

    // Remise manuelle après le code : sur le reste.
    expect((await api.owner.post(`/api/orders/${first.id}/discount`, { kind: 'PERCENT', value: 10, reason: 'Fidèle' })).json()).toMatchObject({ subtotal: 3000, promotionDiscount: 300, discount: 270, total: 2430 });

    const yesterday = new Date(Date.parse(`${localMoment(Date.now(), TZ).date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    await api.promotion({ name: 'Été', kind: 'AMOUNT', scope: 'ORDER', value: 500, code: 'ETE', endDate: yesterday });
    const expired = await api.order([line(ids.burger)], { promoCode: 'ete' });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.message).toContain('pas valable');

    const pause = (await api.promotion({ name: 'Pause', kind: 'AMOUNT', scope: 'ORDER', value: 500, code: 'PAUSE' })).json().promotions.find((p: { code: string }) => p.code === 'PAUSE');
    await api.owner.post(`/api/promotions/${pause.id}/active`, { isActive: false });
    expect((await api.order([line(ids.burger)], { promoCode: 'PAUSE' })).json().error.message).toContain('pas actif');
    await api.owner.post(`/api/promotions/${pause.id}/archive`);
    expect((await api.order([line(ids.burger)], { promoCode: 'PAUSE' })).json().error.message).toBe('Code promo inconnu.');
    expect((await api.promotion({ name: 'Pause 2', kind: 'AMOUNT', scope: 'ORDER', value: 300, code: 'pause' })).statusCode).toBe(201);

    // Cumul sur une ligne : promotion automatique, puis code (article offert) sur le reste.
    await api.promotion({ name: 'Jus −20 %', kind: 'PERCENT', scope: 'PRODUCT', targetId: ids.jus, value: 2000 });
    await api.promotion({ name: 'Jus offert', kind: 'FREE_ITEM', scope: 'PRODUCT', targetId: ids.jus, buyQuantity: 1, freeQuantity: 1, code: 'JUS' });
    const stacked = (await api.order([line(ids.jus, 2)], { promoCode: 'jus' })).json();
    expect(stacked).toMatchObject({ subtotal: 1600, promotionDiscount: 1120, total: 480, items: [{ promotionName: 'Jus −20 % + Jus offert', promotionDiscount: 1120 }] });
    expect(stacked.promotions).toEqual([expect.objectContaining({ name: 'Jus −20 %', code: null, amount: 320 }), expect.objectContaining({ name: 'Jus offert', code: 'JUS', amount: 800 })]);
    expect((await api.order([line(ids.biere)], { promoCode: 'JUS' })).json().error.message).toContain('aucun article');

    const qrUnknown = await api.qrOrder([line(ids.biere)], 'INCONNU');
    expect(qrUnknown.statusCode).toBe(409);
    expect((await api.owner.get('/api/audit')).json().some((a: { action: string }) => a.action === 'order.promo_code')).toBe(true);
  });

  it('reçu, addition et rapport : taxes collectées et remises des promotions, montants figés', async () => {
    const r = await restaurant('Rapport');
    const { api, ids, line } = r;
    await api.rate({ name: 'TVA', rateBp: 1800, isDefault: true });
    await api.promotion({ name: 'Plats −10 %', kind: 'PERCENT', scope: 'CATEGORY', targetId: ids.plats, value: 1000 });
    await api.promotion({ name: 'Fidèle', kind: 'AMOUNT', scope: 'ORDER', value: 500, code: 'FIDELE' });
    await api.owner.post(`/api/locations/${r.locationId}/cash-sessions`, { openingFloat: 0 });

    // 2 burgers 10 000 −1000 ; bière 1000 ; code −500 → 9500 TTC ; TVA 1449,15 → 1449.
    const first = (await api.order([line(ids.burger, 2), line(ids.biere)], { promoCode: 'fidele' })).json();
    expect(first).toMatchObject({ total: 9500, promotionDiscount: 1500, taxTotal: 1449, taxes: [{ base: 8051, tax: 1449 }] });
    const receipt = (await api.owner.post(`/api/locations/${r.locationId}/payments`, { target: { kind: 'order', id: first.id }, method: 'CASH', amount: 9500 })).json();
    expect(receipt.orders[0]).toMatchObject({ total: 9500, taxTotal: 1449, promoCode: 'FIDELE' });
    expect(receipt.orders[0].promotions.map((p: { name: string; code: string | null; amount: number }) => [p.name, p.code, p.amount])).toEqual([
      ['Plats −10 %', null, 1000],
      ['Fidèle', 'FIDELE', 500],
    ]);

    const second = (await api.order([line(ids.biere, 2)])).json();
    const [bill] = (await api.owner.get(`/api/locations/${r.locationId}/checks`)).json();
    expect(bill.orders[0]).toMatchObject({ id: second.id, total: 2000, taxes: [{ base: 1695, tax: 305 }] });
    const cancelled = (await api.order([line(ids.burger)])).json();
    await api.owner.post(`/api/orders/${cancelled.id}/status`, { status: 'CANCELLED', reason: 'Erreur de saisie' });

    // Un réglage modifié après coup ne change pas le rapport.
    await api.owner.patch(`/api/locations/${r.locationId}/pricing`, { taxMode: 'EXCLUSIVE' });
    const day = first.businessDate as string;
    const report = (await api.owner.get(`/api/locations/${r.locationId}/reports/sales?from=${day}&to=${day}`)).json();
    expect(report.totals).toMatchObject({ revenue: 11500, promotions: 1500, taxCollected: 1754, revenueExclTax: 9746, cancelledCount: 1 });
    expect(report.byTax).toEqual([{ name: 'TVA', rateBp: 1800, base: 9746, tax: 1754 }]);
    expect(report.byPromotion).toEqual([
      { name: 'Plats −10 %', code: null, orders: 1, amount: 1000 },
      { name: 'Fidèle', code: 'FIDELE', orders: 1, amount: 500 },
    ]);
  });

  it('droits, validation, synchronisation et isolation entre organisations', async () => {
    const r = await restaurant('DroitsA');
    const { api, ids, line } = r;
    const cashier = await member(r.org.token, 'CASHIER');
    const cook = await member(r.org.token, 'KITCHEN');
    const manager = await member(r.org.token, 'MANAGER');

    expect((await cashier.get(`/api/locations/${r.locationId}/pricing`)).statusCode).toBe(200);
    expect((await api.rate({ name: 'TVA', rateBp: 1800 }, cashier)).statusCode).toBe(403);
    expect((await api.promotion({ name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 100 }, cashier)).statusCode).toBe(403);
    expect((await cashier.patch(`/api/locations/${r.locationId}/pricing`, { taxMode: 'EXCLUSIVE' })).statusCode).toBe(403);
    expect((await cashier.post(`/api/locations/${r.locationId}/orders/quote`, { lines: [line(ids.biere)] })).statusCode).toBe(200);
    expect((await cook.post(`/api/locations/${r.locationId}/orders/quote`, { lines: [line(ids.biere)] })).statusCode).toBe(403);
    expect((await cook.post(`/api/locations/${r.locationId}/promo-codes/check`, { code: 'X' })).statusCode).toBe(403);

    const rate = (await api.rate({ name: 'TVA', rateBp: 1800, isDefault: true })).json().taxRates[0];
    const promo = (await api.promotion({ name: 'Secret', kind: 'AMOUNT', scope: 'PRODUCT', targetId: ids.burger, value: 500, code: 'SECRET' }, manager)).json().promotions[0];
    expect(promo).toMatchObject({ name: 'Secret', targetId: ids.burger });
    expect((await api.owner.put(`/api/products/${ids.burger}/tax-rate`, { taxRateId: rate.id })).statusCode).toBe(200);

    // Validation : identifiants, règles incohérentes, cible d'un autre établissement.
    expect((await api.owner.put('/api/promotions/pas-un-uuid', { name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 1 })).statusCode).toBe(400);
    expect((await api.promotion({ name: 'x', kind: 'FREE_ITEM', scope: 'ORDER', buyQuantity: 1, freeQuantity: 1 })).statusCode).toBe(400);
    expect((await api.rate({ name: 'Trop', rateBp: 10001 })).statusCode).toBe(400);

    const sync = await t.ctx.db.selectFrom('sync_events').select('entity_type').where('location_id', '=', r.locationId).execute();
    expect(sync.map((e) => e.entity_type)).toEqual(expect.arrayContaining(['tax_rate', 'pricing_settings', 'promotion', 'product']));
    expect((await api.owner.get('/api/audit')).json().map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['pricing.tax_rate_created', 'pricing.promotion_created', 'pricing.tax_override']));

    const other = await restaurant('DroitsB');
    const b = other.api.owner;
    expect((await b.get(`/api/locations/${r.locationId}/pricing`)).statusCode).toBe(404);
    expect((await b.patch(`/api/locations/${r.locationId}/pricing`, { taxMode: 'EXCLUSIVE' })).statusCode).toBe(404);
    expect((await b.put(`/api/promotions/${promo.id}`, { name: 'Pirate', kind: 'AMOUNT', scope: 'ORDER', value: 1 })).statusCode).toBe(404);
    expect((await b.post(`/api/promotions/${promo.id}/active`, { isActive: false })).statusCode).toBe(404);
    expect((await b.post(`/api/promotions/${promo.id}/archive`)).statusCode).toBe(404);
    expect((await b.patch(`/api/tax-rates/${rate.id}`, { rateBp: 0 })).statusCode).toBe(404);
    expect((await b.post(`/api/tax-rates/${rate.id}/archive`)).statusCode).toBe(404);
    expect((await b.put(`/api/products/${ids.burger}/tax-rate`, { taxRateId: null })).statusCode).toBe(404);
    expect((await b.put(`/api/categories/${other.ids.plats}/tax-rate`, { taxRateId: rate.id })).statusCode).toBe(404);
    expect((await other.api.promotion({ name: 'Vol', kind: 'AMOUNT', scope: 'PRODUCT', targetId: ids.burger, value: 100 })).statusCode).toBe(404);
    expect((await b.post(`/api/locations/${r.locationId}/orders/quote`, { lines: [line(ids.biere)] })).statusCode).toBe(404);
    expect((await b.post(`/api/locations/${r.locationId}/promo-codes/check`, { code: 'SECRET' })).statusCode).toBe(404);
    // Le code d'un autre restaurant n'existe pas ici.
    expect((await other.api.qrOrder([other.line(other.ids.burger)], 'SECRET')).json().error.message).toBe('Code promo inconnu.');
    expect((await api.config()).promotions[0]).toMatchObject({ name: 'Secret', isActive: true });
  });
});
