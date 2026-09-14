import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectImage } from '../src/lib/images.ts';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/** En-tête PNG minimal (signature + IHDR) complété d'octets : le serveur ne lit que l'en-tête. */
function png(width: number, height: number, padding = 0): Buffer {
  const b = Buffer.alloc(33 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe('Photos — lecture des en-têtes', () => {
  it('reconnaît PNG, JPEG et WebP et lit leurs dimensions', () => {
    expect(inspectImage(png(64, 48))).toEqual({ contentType: 'image/png', width: 64, height: 48 });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, ...Array(9).fill(0)]);
    expect(inspectImage(jpeg)).toEqual({ contentType: 'image/jpeg', width: 640, height: 480 });

    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    webp.write('VP8X', 12, 'ascii');
    webp.writeUIntLE(1023, 24, 3);
    webp.writeUIntLE(767, 27, 3);
    expect(inspectImage(webp)).toEqual({ contentType: 'image/webp', width: 1024, height: 768 });
  });

  it('refuse ce qui n’est pas une image', () => {
    expect(inspectImage(Buffer.from('<script>alert(1)</script> déguisé en photo'))).toBeNull();
    expect(inspectImage(png(0, 10))).toBeNull();
    expect(inspectImage(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });
});

describe.each(ENGINES)('Phase 3 — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine, { AFK_PUBLIC_URL: 'https://menu.test/' });
  });
  afterAll(async () => {
    await t.close();
  });

  async function menuOrg(label: string) {
    const org = await registerOrg(t, label);
    return { org, owner: as(t, org.token), locationId: org.me.locations[0].id as string };
  }

  async function category(owner: ReturnType<typeof as>, locationId: string, name: string, extra: object = {}) {
    const res = await owner.post(`/api/locations/${locationId}/categories`, { name, ...extra });
    expect(res.statusCode).toBe(201);
    return res.json().categories.find((c: { name: string }) => c.name === name);
  }

  async function group(owner: ReturnType<typeof as>, locationId: string, body: object) {
    const res = await owner.post(`/api/locations/${locationId}/modifier-groups`, body);
    expect(res.statusCode).toBe(201);
    const groups = res.json().modifierGroups;
    return groups[groups.length - 1];
  }

  async function product(owner: ReturnType<typeof as>, categoryId: string, body: object) {
    const res = await owner.post(`/api/categories/${categoryId}/products`, body);
    expect(res.statusCode).toBe(201);
    const products = res.json().products;
    return products[products.length - 1];
  }

  it('catégories : création, ordre, masquage, archivage protégé', async () => {
    const { owner, locationId } = await menuOrg('Categories');
    const plats = await category(owner, locationId, 'Plats');
    const boissons = await category(owner, locationId, 'Boissons');
    const desserts = await category(owner, locationId, 'Desserts');

    const ordered = await owner.put(`/api/locations/${locationId}/categories/order`, { ids: [desserts.id, plats.id, boissons.id] });
    expect(ordered.json().categories.map((c: { name: string }) => c.name)).toEqual(['Desserts', 'Plats', 'Boissons']);
    expect((await owner.put(`/api/locations/${locationId}/categories/order`, { ids: [plats.id, boissons.id] })).statusCode).toBe(400);

    const hidden = await owner.patch(`/api/categories/${boissons.id}`, { isVisible: false });
    expect(hidden.json().categories.find((c: { id: string }) => c.id === boissons.id).isVisible).toBe(false);

    const riz = await product(owner, plats.id, { name: 'Riz sauce arachide', price: 2500 });
    expect((await owner.post(`/api/categories/${plats.id}/archive`)).statusCode).toBe(409);
    await owner.post(`/api/products/${riz.id}/archive`);
    const archived = await owner.post(`/api/categories/${plats.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().categories.map((c: { name: string }) => c.name)).toEqual(['Desserts', 'Boissons']);
  });

  it('produit complet : variantes et options, listes remplacées proprement', async () => {
    const { owner, locationId } = await menuOrg('Produit');
    const plats = await category(owner, locationId, 'Burgers');
    const cuisson = await group(owner, locationId, { name: 'Cuisson', minSelect: 1, maxSelect: 1, modifiers: [{ name: 'Saignant' }, { name: 'À point' }] });
    const supplements = await group(owner, locationId, { name: 'Suppléments', maxSelect: 2, modifiers: [{ name: 'Fromage', priceDelta: 500 }, { name: 'Bacon', priceDelta: 1000 }] });

    const burger = await product(owner, plats.id, {
      name: 'Classic Burger',
      description: 'Pain brioché, steak haché, tomate.',
      price: 5000,
      variants: [{ name: 'Simple' }, { name: 'Double', priceDelta: 1500 }],
      modifierGroupIds: [cuisson.id, supplements.id],
      tags: ['Signature'],
      allergens: ['GLUTEN', 'MILK', 'MILK'],
    });
    expect(burger.variants.map((v: { name: string }) => v.name)).toEqual(['Simple', 'Double']);
    expect(burger.modifierGroupIds).toEqual([cuisson.id, supplements.id]);
    expect(burger.allergens).toEqual(['GLUTEN', 'MILK']);

    const simple = burger.variants[0];
    const replaced = await owner.patch(`/api/products/${burger.id}`, {
      variants: [{ id: simple.id, name: 'Simple' }, { name: 'Triple', priceDelta: 2500 }],
      modifierGroupIds: [supplements.id],
    });
    expect(replaced.statusCode).toBe(200);
    const updated = replaced.json().products.find((p: { id: string }) => p.id === burger.id);
    expect(updated.variants.map((v: { name: string; id: string }) => v.name)).toEqual(['Simple', 'Triple']);
    expect(updated.variants[0].id).toBe(simple.id);
    expect(updated.modifierGroupIds).toEqual([supplements.id]);
    expect(replaced.json().modifierGroups.find((g: { id: string }) => g.id === cuisson.id).productCount).toBe(0);

    expect((await owner.patch(`/api/products/${burger.id}`, { variants: [{ id: randomUUID(), name: 'Pirate' }] })).statusCode).toBe(400);
    expect((await owner.patch(`/api/products/${burger.id}`, { promoPrice: 4000 })).statusCode).toBe(200);
    expect((await owner.patch(`/api/products/${burger.id}`, { price: 3500 })).statusCode).toBe(400);
    expect((await owner.patch(`/api/products/${burger.id}`, { price: 6000 })).statusCode).toBe(200);

    const audit = (await owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['menu.product_created', 'menu.price_changed']));

    const events = await t.ctx.db.selectFrom('sync_events').select(['entity_type', 'operation']).where('location_id', '=', locationId).execute();
    const kinds = new Set(events.map((e) => `${e.entity_type}:${e.operation}`));
    for (const kind of ['product:UPSERT', 'product_variant:UPSERT', 'product_modifier_group:UPSERT', 'product_modifier_group:DELETE', 'modifier:UPSERT']) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("groupe d'options : règles min/max et archivage protégé", async () => {
    const { owner, locationId } = await menuOrg('Options');
    const sauces = await group(owner, locationId, { name: 'Sauces', maxSelect: 2, modifiers: [{ name: 'BBQ' }, { name: 'Piquante' }] });
    expect((await owner.patch(`/api/modifier-groups/${sauces.id}`, { maxSelect: 5 })).statusCode).toBe(400);
    expect((await owner.patch(`/api/modifier-groups/${sauces.id}`, { minSelect: 3 })).statusCode).toBe(400);

    const frites = await product(owner, (await category(owner, locationId, 'Accompagnements')).id, { name: 'Frites', price: 1000, modifierGroupIds: [sauces.id] });
    const blocked = await owner.post(`/api/modifier-groups/${sauces.id}/archive`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.products).toEqual(['Frites']);

    await owner.patch(`/api/products/${frites.id}`, { modifierGroupIds: [] });
    expect((await owner.post(`/api/modifier-groups/${sauces.id}/archive`)).statusCode).toBe(200);
  });

  it('disponibilité : la cuisine marque épuisé sans pouvoir changer le prix ; le serveur ne peut pas', async () => {
    const { org, owner, locationId } = await menuOrg('Epuise');
    const grill = await category(owner, locationId, 'Grillades');
    const piment = await group(owner, locationId, { name: 'Piment', modifiers: [{ name: 'Fort' }] });
    const poulet = await product(owner, grill.id, { name: 'Poulet braisé', price: 4500, modifierGroupIds: [piment.id] });

    const cook = as(t, (await login(t, (await addMember(t, org.token, 'KITCHEN')).email)).json().accessToken);
    const soldOut = await cook.post(`/api/products/${poulet.id}/availability`, { isAvailable: false });
    expect(soldOut.statusCode).toBe(200);
    expect(soldOut.json().products[0].isAvailable).toBe(false);
    expect((await cook.post(`/api/modifiers/${piment.modifiers[0].id}/availability`, { isAvailable: false })).statusCode).toBe(200);
    expect((await cook.patch(`/api/products/${poulet.id}`, { price: 100 })).statusCode).toBe(403);

    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.post(`/api/products/${poulet.id}/availability`, { isAvailable: true })).statusCode).toBe(403);
    expect((await waiter.get(`/api/locations/${locationId}/menu`)).statusCode).toBe(200);
  });

  it('photos : contenu vérifié, service immuable, isolation', async () => {
    const { owner, locationId } = await menuOrg('Photos');
    const upload = await owner.post(`/api/locations/${locationId}/media`, { contentType: 'image/png', dataBase64: png(64, 48, 200).toString('base64') });
    expect(upload.statusCode).toBe(201);
    const media = upload.json();
    expect(media).toMatchObject({ width: 64, height: 48, contentType: 'image/png', url: `/api/media/${media.id}` });

    const served = await t.app.inject({ method: 'GET', url: media.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(served.rawPayload.length).toBe(233);
    expect((await t.app.inject({ method: 'GET', url: media.url, headers: { 'if-none-match': served.headers.etag as string } })).statusCode).toBe(304);

    expect((await owner.post(`/api/locations/${locationId}/media`, { contentType: 'image/jpeg', dataBase64: png(64, 48).toString('base64') })).statusCode).toBe(400);
    expect((await owner.post(`/api/locations/${locationId}/media`, { contentType: 'image/png', dataBase64: png(64, 48, 850_000).toString('base64') })).statusCode).toBe(400);

    const cat = await category(owner, locationId, 'Entrées');
    const salade = await product(owner, cat.id, { name: 'Salade', price: 2000, photoMediaId: media.id });
    expect(salade.photoUrl).toBe(media.url);

    const other = await menuOrg('PhotosVoisin');
    const otherCat = await category(other.owner, other.locationId, 'Plats');
    expect((await other.owner.post(`/api/categories/${otherCat.id}/products`, { name: 'Vol', price: 1, photoMediaId: media.id })).statusCode).toBe(404);
  });

  it('QR : un par table, régénération, révocation ; menu public sans session', async () => {
    const { org, owner, locationId } = await menuOrg('QR');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const t1 = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    const t2 = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T2' })).json();

    const plats = await category(owner, locationId, 'Plats');
    const secret = await category(owner, locationId, 'Réserve', { isVisible: false });
    const cuisson = await group(owner, locationId, { name: 'Cuisson', minSelect: 1, modifiers: [{ name: 'À point' }] });
    await product(owner, plats.id, { name: 'Burger', price: 5000, variants: [{ name: 'Simple' }], modifierGroupIds: [cuisson.id] });
    const riz = await product(owner, plats.id, { name: 'Riz', price: 2500 });
    await owner.post(`/api/products/${riz.id}/availability`, { isAvailable: false });
    await product(owner, secret.id, { name: 'Plat du personnel', price: 0 });

    const list = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json();
    expect(list.codes.map((c: { tableLabel: string }) => c.tableLabel)).toEqual(['T1', 'T2']);
    expect(list.menuBaseUrl).toBe('https://menu.test/m/');
    const code1 = list.codes[0];
    expect(code1.url).toBe(`https://menu.test/m/${code1.token}`);

    const pub = await t.app.inject({ method: 'GET', url: `/api/public/menu/${code1.token}` });
    expect(pub.statusCode).toBe(200);
    const menu = pub.json();
    expect(menu.restaurant).toMatchObject({ name: 'QR Centre', organization: 'Groupe QR', currency: 'XAF' });
    expect(menu.table.label).toBe('T1');
    expect(menu.categories.map((c: { name: string }) => c.name)).toEqual(['Plats']);
    expect(menu.categories[0].products.map((p: { name: string; isAvailable: boolean }) => [p.name, p.isAvailable])).toEqual([
      ['Burger', true],
      ['Riz', false],
    ]);
    expect(menu.categories[0].products[0].modifierGroups[0]).toMatchObject({ name: 'Cuisson', minSelect: 1 });

    expect((await owner.post(`/api/tables/${t1.id}/qr/regenerate`)).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: `/api/public/menu/${code1.token}` })).statusCode).toBe(404);
    const fresh = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0];
    expect(fresh.token).not.toBe(code1.token);
    expect((await t.app.inject({ method: 'GET', url: `/api/public/menu/${fresh.token}` })).statusCode).toBe(200);

    const code2 = list.codes[1].token;
    await owner.post(`/api/tables/${t2.id}/archive`);
    expect((await t.app.inject({ method: 'GET', url: `/api/public/menu/${code2}` })).statusCode).toBe(404);

    await t.ctx.db.updateTable('tenants').set({ status: 'SUSPENDED' }).where('id', '=', org.me.tenant.id).execute();
    expect((await t.app.inject({ method: 'GET', url: `/api/public/menu/${fresh.token}` })).statusCode).toBe(404);
    await t.ctx.db.updateTable('tenants').set({ status: 'ACTIVE' }).where('id', '=', org.me.tenant.id).execute();
    expect((await t.app.inject({ method: 'GET', url: '/api/public/menu/<script>' })).statusCode).toBe(400);
  });

  it('isolation : une autre organisation ne voit ni ne modifie ce menu', async () => {
    const { owner, locationId } = await menuOrg('MenuA');
    const cat = await category(owner, locationId, 'Plats');
    const sauces = await group(owner, locationId, { name: 'Sauces', modifiers: [{ name: 'BBQ' }] });
    const plat = await product(owner, cat.id, { name: 'Plat', price: 1000 });
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();

    const other = await menuOrg('MenuB');
    const otherCat = await category(other.owner, other.locationId, 'Plats');
    expect((await other.owner.get(`/api/locations/${locationId}/menu`)).statusCode).toBe(404);
    expect((await other.owner.patch(`/api/products/${plat.id}`, { price: 1 })).statusCode).toBe(404);
    expect((await other.owner.post(`/api/categories/${cat.id}/products`, { name: 'Intrus', price: 1 })).statusCode).toBe(404);
    expect((await other.owner.post(`/api/categories/${otherCat.id}/products`, { name: 'Vol', price: 1, modifierGroupIds: [sauces.id] })).statusCode).toBe(404);
    expect((await other.owner.post(`/api/products/${plat.id}/availability`, { isAvailable: false })).statusCode).toBe(404);
    expect((await other.owner.get(`/api/locations/${locationId}/qr-codes`)).statusCode).toBe(404);
    expect((await other.owner.post(`/api/tables/${table.id}/qr/regenerate`)).statusCode).toBe(404);
  });
});
