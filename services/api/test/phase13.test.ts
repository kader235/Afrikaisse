import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Phase 13 — stock et recettes — %s', (engine) => {
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
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Poulet yassa', price: 4000 })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Bissap', price: 1000, variants: [{ name: '33 cl' }, { name: '1 litre', priceDelta: 1500 }] })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Pain', price: 200 })).json();
    const byName = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const inv = async (body: object) => (await owner.post(`/api/locations/${locationId}/inventory`, body)).json();
    const poulet = await inv({ name: 'Poulet', unit: 'PIECE', minLevel: 3 });
    const riz = await inv({ name: 'Riz', unit: 'KG', minLevel: 2 });
    const bissapJus = await inv({ name: 'Jus de bissap', unit: 'L', minLevel: 1 });
    const move = (who: ReturnType<typeof as>, itemId: string, body: object) => who.post(`/api/inventory/${itemId}/movements`, body);
    const levels = async () => Object.fromEntries((await owner.get(`/api/locations/${locationId}/inventory`)).json().map((i: { name: string; level: number }) => [i.name, i.level]));
    const product = async (name: string) => (await owner.get(`/api/locations/${locationId}/menu`)).json().products.find((p: { name: string }) => p.name === name);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token;
    return { org, owner, locationId, yassa: byName('Poulet yassa'), bissap: byName('Bissap'), pain: byName('Pain'), poulet, riz, bissapJus, move, levels, product, qr };
  }

  it('réceptions, recettes, consommation à la confirmation, restitution à l’annulation', async () => {
    const r = await restaurant('Stock');
    expect(r.poulet).toMatchObject({ level: 0, state: 'OUT', unit: 'PIECE' });
    expect((await r.move(r.owner, r.poulet.id, { kind: 'IN', quantity: 10, unitCost: 1500 })).json()).toMatchObject({ level: 10, state: 'OK', unitCost: 1500, value: 15000 });
    await r.move(r.owner, r.riz.id, { kind: 'IN', quantity: 5.5 });
    await r.move(r.owner, r.bissapJus.id, { kind: 'IN', quantity: 2 });

    const recipe = await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: r.poulet.id, quantity: 1 }, { itemId: r.riz.id, quantity: 0.2 }] });
    expect(recipe.json().items.map((i: { itemName: string; quantity: number }) => [i.itemName, i.quantity])).toEqual([
      ['Poulet', 1],
      ['Riz', 0.2],
    ]);
    await r.owner.put(`/api/products/${r.bissap.id}/recipe`, {
      items: [
        { itemId: r.bissapJus.id, variantId: r.bissap.variants[0].id, quantity: 0.33 },
        { itemId: r.bissapJus.id, variantId: r.bissap.variants[1].id, quantity: 1 },
      ],
    });
    expect((await r.owner.get(`/api/locations/${r.locationId}/inventory`)).json().find((i: { name: string }) => i.name === 'Poulet').usedBy).toBe(1);

    const order = (
      await r.owner.post(`/api/locations/${r.locationId}/orders`, {
        lines: [
          { productId: r.yassa.id, quantity: 2 },
          { productId: r.bissap.id, variantId: r.bissap.variants[1].id, quantity: 1 },
          { productId: r.pain.id, quantity: 3 },
        ],
      })
    ).json();
    expect(await r.levels()).toEqual({ Poulet: 8, Riz: 5.1, 'Jus de bissap': 1 });
    const moves = (await r.owner.get(`/api/inventory/${r.poulet.id}/movements`)).json();
    expect(moves[0]).toMatchObject({ kind: 'SALE', quantity: -2, orderNumber: order.number });

    expect((await r.owner.post(`/api/orders/${order.id}/status`, { status: 'CANCELLED', reason: 'Client parti' })).statusCode).toBe(200);
    expect(await r.levels()).toEqual({ Poulet: 10, Riz: 5.5, 'Jus de bissap': 2 });

    // Commande QR : rien tant que le personnel n'a pas confirmé.
    const placed = (await t.app.inject({ method: 'POST', url: `/api/public/menu/${r.qr}/orders`, payload: { clientToken: 'client-stock-00000001', lines: [{ productId: r.yassa.id, quantity: 1 }] } })).json();
    expect((await r.levels()).Poulet).toBe(10);
    await r.owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    await r.owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' }); // répété : sans double déduction
    expect((await r.levels()).Poulet).toBe(9);

    const actions = (await r.owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['stock.in', 'stock.recipe_updated']));
  });

  it('épuisé automatique quand un ingrédient manque, retour au réapprovisionnement ; le geste manuel prime', async () => {
    const r = await restaurant('Rupture');
    await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: r.poulet.id, quantity: 1 }] });
    await r.move(r.owner, r.poulet.id, { kind: 'IN', quantity: 10 });
    const count = (await r.move(r.owner, r.poulet.id, { kind: 'COUNT', quantity: 1 })).json();
    expect(count).toMatchObject({ level: 1, state: 'LOW' });
    expect((await r.owner.get(`/api/inventory/${r.poulet.id}/movements`)).json()[0]).toMatchObject({ kind: 'COUNT', quantity: -9 });

    await r.owner.post(`/api/locations/${r.locationId}/orders`, { lines: [{ productId: r.yassa.id, quantity: 1 }] });
    expect(await r.product('Poulet yassa')).toMatchObject({ isAvailable: false });
    const pub = (await t.app.inject({ method: 'GET', url: `/api/public/menu/${r.qr}` })).json();
    expect(pub.categories[0].products.find((p: { name: string }) => p.name === 'Poulet yassa').isAvailable).toBe(false);
    expect((await r.owner.post(`/api/locations/${r.locationId}/orders`, { lines: [{ productId: r.yassa.id, quantity: 1 }] })).statusCode).toBe(409);

    await r.move(r.owner, r.poulet.id, { kind: 'IN', quantity: 4 });
    expect(await r.product('Poulet yassa')).toMatchObject({ isAvailable: true });

    // Épuisé à la main : le stock ne le remet pas en vente.
    await r.owner.post(`/api/products/${r.yassa.id}/availability`, { isAvailable: false });
    await r.move(r.owner, r.poulet.id, { kind: 'COUNT', quantity: 0 });
    await r.move(r.owner, r.poulet.id, { kind: 'IN', quantity: 5 });
    expect(await r.product('Poulet yassa')).toMatchObject({ isAvailable: false });
  });

  it('contrôles : motif de perte, stock insuffisant, recette invalide, archivage, droits, isolation', async () => {
    const r = await restaurant('StockControle');
    await r.move(r.owner, r.riz.id, { kind: 'IN', quantity: 2 });
    expect((await r.move(r.owner, r.riz.id, { kind: 'LOSS', quantity: 1 })).statusCode).toBe(400);
    expect((await r.move(r.owner, r.riz.id, { kind: 'LOSS', quantity: 0.5, reason: 'Sac percé' })).json().level).toBe(1.5);
    expect((await r.move(r.owner, r.riz.id, { kind: 'OUT', quantity: 3, reason: 'Transfert' })).statusCode).toBe(409);
    expect((await r.move(r.owner, r.riz.id, { kind: 'IN', quantity: 0.0001 })).statusCode).toBe(400);

    expect((await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: r.riz.id, variantId: r.bissap.variants[0].id, quantity: 1 }] })).statusCode).toBe(404);
    expect((await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: r.riz.id, quantity: 1 }, { itemId: r.riz.id, quantity: 2 }] })).statusCode).toBe(400);
    await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: r.riz.id, quantity: 0.25 }] });
    const blocked = await r.owner.post(`/api/inventory/${r.riz.id}/archive`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.products).toEqual(['Poulet yassa']);
    expect((await r.owner.post(`/api/inventory/${r.poulet.id}/archive`)).statusCode).toBe(204);

    const waiter = await member(r.org.token, 'WAITER');
    expect((await waiter.get(`/api/locations/${r.locationId}/inventory`)).statusCode).toBe(403);
    const keeper = await member(r.org.token, 'STOCK_MANAGER');
    expect((await keeper.post(`/api/locations/${r.locationId}/inventory`, { name: 'Huile', unit: 'L' })).statusCode).toBe(201);

    const other = await restaurant('StockVoisin');
    expect((await other.owner.get(`/api/locations/${r.locationId}/inventory`)).statusCode).toBe(404);
    expect((await r.move(other.owner, r.riz.id, { kind: 'IN', quantity: 1 })).statusCode).toBe(404);
    expect((await other.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [] })).statusCode).toBe(404);
    expect((await r.owner.put(`/api/products/${r.yassa.id}/recipe`, { items: [{ itemId: other.riz.id, quantity: 1 }] })).statusCode).toBe(404);
  });
});
