import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENU_THEMES } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Thème du menu client — %s', (engine) => {
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
    const category = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Grillades' })).json().categories[0];
    await owner.post(`/api/categories/${category.id}/products`, { name: 'Poulet braisé', price: 4500 });
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const publicMenu = async () => (await t.app.inject({ method: 'GET', url: `/api/public/menu/${token}` })).json();
    const location = async () => (await owner.get('/api/locations')).json().find((l: { id: string }) => l.id === locationId);
    return { org, owner, locationId, publicMenu, location };
  }

  it('par défaut « bleu », sur l’établissement comme sur le menu public', async () => {
    const r = await restaurant('Defaut');
    expect((await r.location()).menuTheme).toBe('bleu');
    expect((await r.publicMenu()).restaurant.theme).toBe('bleu');
  });

  it('chaque thème s’enregistre, se relit, s’applique au menu public et laisse une trace', async () => {
    const r = await restaurant('Themes');
    for (const theme of MENU_THEMES) {
      const res = await r.owner.patch(`/api/locations/${r.locationId}`, { menuTheme: theme });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: r.locationId, menuTheme: theme });
      expect((await r.location()).menuTheme).toBe(theme);
      expect((await r.publicMenu()).restaurant.theme).toBe(theme);
    }
    const audits = await t.ctx.db.selectFrom('audit_logs').select(['action']).where('entity_id', '=', r.locationId).where('action', '=', 'location.menu_theme_changed').execute();
    expect(audits).toHaveLength(MENU_THEMES.length);
    const events = await t.ctx.db.selectFrom('sync_events').select(['entity_type']).where('entity_id', '=', r.locationId).where('entity_type', '=', 'location').execute();
    expect(events.length).toBeGreaterThanOrEqual(MENU_THEMES.length);
    // Les autres réglages ne sont pas touchés.
    expect(await r.location()).toMatchObject({ name: 'Themes Centre', billMode: 'SHARED', tableCodeRequired: false });
  });

  it('thème inconnu refusé (400), sans rien changer', async () => {
    const r = await restaurant('Invalide');
    await r.owner.patch(`/api/locations/${r.locationId}`, { menuTheme: 'nuit' });
    for (const menuTheme of ['rose', '', null, 3]) {
      expect((await r.owner.patch(`/api/locations/${r.locationId}`, { menuTheme })).statusCode).toBe(400);
    }
    expect((await r.publicMenu()).restaurant.theme).toBe('nuit');
  });

  it('serveur et gérant sans droit sur l’établissement : 403 ; autre organisation : 404', async () => {
    const r = await restaurant('Droits');
    const { email } = await addMember(t, r.org.token, 'WAITER');
    const waiter = as(t, (await login(t, email)).json().accessToken);
    expect((await waiter.patch(`/api/locations/${r.locationId}`, { menuTheme: 'savane' })).statusCode).toBe(403);
    const manager = await addMember(t, r.org.token, 'MANAGER');
    const managerApi = as(t, (await login(t, manager.email)).json().accessToken);
    expect((await managerApi.patch(`/api/locations/${r.locationId}`, { menuTheme: 'savane' })).statusCode).toBe(403);

    const other = await restaurant('Voisin');
    expect((await other.owner.patch(`/api/locations/${r.locationId}`, { menuTheme: 'savane' })).statusCode).toBe(404);
    expect((await r.publicMenu()).restaurant.theme).toBe('bleu');
  });
});
