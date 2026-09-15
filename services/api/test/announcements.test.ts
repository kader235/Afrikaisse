import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { announcementLive } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe('Annonces — période', () => {
  const at = (date: string, weekday: number, minute: number) => ({ date, weekday, minute });
  const soir = { startDate: null, endDate: null, days: [], startMinute: 20 * 60, endMinute: 2 * 60 };

  it('publiée, archivée, période qui passe minuit, promotion liée inactive', () => {
    const on = { isPublished: true, status: 'ACTIVE' };
    expect(announcementLive(on, soir, at('2026-09-15', 2, 21 * 60))).toBe(true);
    expect(announcementLive(on, soir, at('2026-09-16', 3, 60))).toBe(true);
    expect(announcementLive(on, soir, at('2026-09-15', 2, 12 * 60))).toBe(false);
    expect(announcementLive({ ...on, isPublished: false }, soir, at('2026-09-15', 2, 21 * 60))).toBe(false);
    expect(announcementLive({ ...on, status: 'ARCHIVED' }, soir, at('2026-09-15', 2, 21 * 60))).toBe(false);
    expect(announcementLive(on, null, at('2026-09-15', 2, 21 * 60))).toBe(false);
    expect(announcementLive(on, { ...soir, startMinute: null, endMinute: null, endDate: '2026-09-14' }, at('2026-09-15', 2, 600))).toBe(false);
  });
});

describe.each(ENGINES)('Annonces du menu client — %s', (engine) => {
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
    await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' });
    const menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Grillades' })).json();
    const category = menu.categories[0];
    const product = (await owner.post(`/api/categories/${category.id}/products`, { name: 'Poulet braisé', price: 4500 })).json().products[0];
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const publicMenu = async () => (await t.app.inject({ method: 'GET', url: `/api/public/menu/${token}` })).json();
    const create = (body: object, who = owner) => who.post(`/api/locations/${locationId}/announcements`, body);
    return { org, owner, locationId, category, product, publicMenu, create };
  }

  it('créée, publiée, visible sur le menu client avec sa cible ; retirée puis archivée, elle disparaît', async () => {
    const r = await restaurant('Annonce');
    const created = await r.create({ title: 'Grillades du soir', body: 'Braisées au feu de bois', buttonLabel: 'Voir', targetKind: 'CATEGORY', targetId: r.category.id, startMinute: 18 * 60, endMinute: 23 * 60 });
    expect(created.statusCode).toBe(201);
    const [a] = created.json();
    expect(a).toMatchObject({ title: 'Grillades du soir', isPublished: true, displaySeconds: 6, schedule: { startMinute: 1080, endMinute: 1380, days: [] } });

    const shown = (await r.publicMenu()).announcements;
    expect(shown).toEqual([expect.objectContaining({ id: a.id, title: 'Grillades du soir', buttonLabel: 'Voir', target: { kind: 'CATEGORY', id: r.category.id } })]);

    const hidden = await r.owner.post(`/api/announcements/${a.id}/published`, { isPublished: false });
    expect(hidden.json()[0].isPublished).toBe(false);
    expect((await r.publicMenu()).announcements).toEqual([]);

    await r.owner.post(`/api/announcements/${a.id}/published`, { isPublished: true });
    expect((await r.owner.post(`/api/announcements/${a.id}/archive`)).json()).toEqual([]);
    expect((await r.publicMenu()).announcements).toEqual([]);
  });

  it('liée à une promotion : prend sa période, disparaît quand la promotion est suspendue', async () => {
    const r = await restaurant('AnnoncePromo');
    const config = (
      await r.owner.post(`/api/locations/${r.locationId}/promotions`, { name: 'Soirée grillades', kind: 'PERCENT', scope: 'CATEGORY', targetId: r.category.id, value: 1000, startMinute: 20 * 60, endMinute: 23 * 60 })
    ).json();
    const promotion = config.promotions[0];

    // La période saisie sur l'annonce est ignorée : c'est celle de la promotion qui compte.
    const [a] = (await r.create({ title: '−10 % sur les grillades', promotionId: promotion.id, startMinute: 8 * 60, endMinute: 9 * 60 })).json();
    expect(a.startMinute).toBeNull();
    expect(a.schedule).toMatchObject({ startMinute: 1200, endMinute: 1380 });
    expect((await r.publicMenu()).announcements[0].schedule).toMatchObject({ startMinute: 1200, endMinute: 1380 });

    await r.owner.post(`/api/promotions/${promotion.id}/active`, { isActive: false });
    expect((await r.publicMenu()).announcements).toEqual([]);
    const list = (await r.owner.get(`/api/locations/${r.locationId}/announcements`)).json();
    expect(list[0]).toMatchObject({ schedule: null, live: false });
  });

  it('refuse une cible, une promotion ou une photo d’un autre établissement, et les saisies incohérentes', async () => {
    const a = await restaurant('Maison');
    const b = await restaurant('Voisine');
    expect((await a.create({ title: 'Ailleurs', targetKind: 'PRODUCT', targetId: b.product.id })).statusCode).toBe(404);
    expect((await a.create({ title: 'Sans cible', targetKind: 'PRODUCT' })).statusCode).toBe(400);
    expect((await a.create({ title: 'Heure seule', startMinute: 600 })).statusCode).toBe(400);
    expect((await a.create({ title: 'Dates', startDate: '2026-09-20', endDate: '2026-09-10' })).statusCode).toBe(400);

    const [mine] = (await a.create({ title: 'À moi' })).json();
    expect((await b.owner.put(`/api/announcements/${mine.id}`, { title: 'Volée' })).statusCode).toBe(404);
  });

  it('droits : le serveur lit, seul qui gère le menu crée ou modifie', async () => {
    const r = await restaurant('Droits');
    const waiter = as(t, (await login(t, (await addMember(t, r.org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.get(`/api/locations/${r.locationId}/announcements`)).statusCode).toBe(200);
    expect((await r.create({ title: 'Interdit' }, waiter)).statusCode).toBe(403);
  });
});
