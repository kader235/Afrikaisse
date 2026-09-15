import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Slogan du menu client — %s', (engine) => {
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
    const token = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token as string;
    const publicMenu = async () => (await t.app.inject({ method: 'GET', url: `/api/public/menu/${token}` })).json();
    const location = async () => (await owner.get('/api/locations')).json().find((l: { id: string }) => l.id === locationId);
    return { org, owner, locationId, publicMenu, location };
  }

  it('sans slogan par défaut, sur l’établissement comme sur le menu public', async () => {
    const r = await restaurant('SansSlogan');
    expect((await r.location()).slogan).toBeNull();
    expect((await r.publicMenu()).restaurant.slogan).toBeNull();
  });

  it('définir puis retirer le slogan : relu, exposé au menu public, journalisé et synchronisé', async () => {
    const r = await restaurant('Slogan');
    const res = await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: '  Le goût   du feu de bois  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: r.locationId, slogan: 'Le goût du feu de bois' });
    expect((await r.location()).slogan).toBe('Le goût du feu de bois');
    expect((await r.publicMenu()).restaurant.slogan).toBe('Le goût du feu de bois');

    // Vide (ou espaces) : retour à la phrase d'accueil ; null aussi.
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: '   ' })).json().slogan).toBeNull();
    expect((await r.publicMenu()).restaurant.slogan).toBeNull();
    await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: 'Chez nous, c’est chez vous' });
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: null })).json().slogan).toBeNull();

    const audits = await t.ctx.db.selectFrom('audit_logs').select(['action']).where('entity_id', '=', r.locationId).where('action', '=', 'location.menu_slogan_changed').execute();
    expect(audits).toHaveLength(4);
    const events = await t.ctx.db.selectFrom('sync_events').select(['entity_type']).where('entity_id', '=', r.locationId).where('entity_type', '=', 'location').execute();
    expect(events.length).toBeGreaterThanOrEqual(4);
    // Les autres réglages ne bougent pas.
    expect(await r.location()).toMatchObject({ name: 'Slogan Centre', menuTheme: 'bleu', billMode: 'SHARED' });
  });

  it('80 caractères au plus (400 au-delà), sans rien changer', async () => {
    const r = await restaurant('Limite');
    const max = 'a'.repeat(80);
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: max })).json().slogan).toBe(max);
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: 'b'.repeat(81) })).statusCode).toBe(400);
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: 42 })).statusCode).toBe(400);
    // Les espaces autour ne comptent pas.
    expect((await r.owner.patch(`/api/locations/${r.locationId}`, { slogan: `  ${'c'.repeat(80)}  ` })).statusCode).toBe(200);
    expect((await r.publicMenu()).restaurant.slogan).toBe('c'.repeat(80));
  });

  it('serveur : 403 ; autre organisation : 404', async () => {
    const r = await restaurant('DroitsSlogan');
    const { email } = await addMember(t, r.org.token, 'WAITER');
    const waiter = as(t, (await login(t, email)).json().accessToken);
    expect((await waiter.patch(`/api/locations/${r.locationId}`, { slogan: 'Pirate' })).statusCode).toBe(403);

    const other = await restaurant('VoisinSlogan');
    expect((await other.owner.patch(`/api/locations/${r.locationId}`, { slogan: 'Pirate' })).statusCode).toBe(404);
    expect((await r.publicMenu()).restaurant.slogan).toBeNull();
  });
});
