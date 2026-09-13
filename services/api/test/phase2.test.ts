import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLayoutIssues } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const SECOND_LOCATION = { name: 'Aéroport', type: 'CAFE', currency: 'XAF', timezone: 'Africa/Ndjamena', country: 'TD' };

describe.each(ENGINES)('Phase 2 — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  async function orgWithZone(label: string, zone: Record<string, unknown> = { name: 'Salle' }) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const res = await owner.post(`/api/locations/${locationId}/zones`, zone);
    expect(res.statusCode).toBe(201);
    return { org, owner, locationId, zone: res.json() };
  }

  it('crée un second établissement ; le premier est en mode Cloud', async () => {
    const org = await registerOrg(t, 'Etab');
    const owner = as(t, org.token);
    const list = (await owner.get('/api/locations')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ operatingMode: 'CLOUD', businessDayCutoffMin: 300, status: 'ACTIVE' });

    const created = await owner.post('/api/locations', { ...SECOND_LOCATION, address: '  ', operatingMode: 'HYBRID' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Aéroport', address: null, operatingMode: 'HYBRID' });

    expect((await owner.post('/api/locations', { ...SECOND_LOCATION, timezone: 'Mars/Olympus' })).statusCode).toBe(400);

    const me = (await owner.get('/api/auth/me')).json();
    expect(me.locations).toHaveLength(2);

    const patched = await owner.patch(`/api/locations/${created.json().id}`, { businessDayCutoffMin: 240, phone: '+235 66 00 00 00' });
    expect(patched.json()).toMatchObject({ businessDayCutoffMin: 240, phone: '+235 66 00 00 00', operatingMode: 'HYBRID', address: null });

    const audit = (await owner.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['location.created', 'location.updated']));
  });

  it("archivage : jamais le dernier établissement, jamais avec des membres qui n'ont que lui", async () => {
    const org = await registerOrg(t, 'Archive');
    const owner = as(t, org.token);
    const first = org.me.locations[0].id;
    expect((await owner.post(`/api/locations/${first}/archive`)).statusCode).toBe(409);

    const second = (await owner.post('/api/locations', SECOND_LOCATION)).json();
    const { res } = await addMember(t, org.token, 'CASHIER', { locationId: second.id });
    expect((await owner.post(`/api/locations/${second.id}/archive`)).statusCode).toBe(409);

    await owner.patch(`/api/team/${res.json().membershipId}`, { locationId: null });
    const archived = await owner.post(`/api/locations/${second.id}/archive`);
    expect(archived.json().status).toBe('ARCHIVED');
    expect((await owner.get('/api/locations')).json()).toHaveLength(1);
    expect((await owner.get('/api/locations?includeArchived=true')).json()).toHaveLength(2);
    expect((await owner.post(`/api/locations/${second.id}/restore`)).json().status).toBe('ACTIVE');
  });

  it('un membre rattaché à un établissement ne voit et ne gère que le sien', async () => {
    const org = await registerOrg(t, 'Portee');
    const owner = as(t, org.token);
    const first = org.me.locations[0].id;
    const second = (await owner.post('/api/locations', SECOND_LOCATION)).json();
    const admin = await addMember(t, org.token, 'ADMIN', { locationId: second.id });
    const adminApi = as(t, (await login(t, admin.email)).json().accessToken);

    const visible = (await adminApi.get('/api/locations')).json();
    expect(visible.map((l: { id: string }) => l.id)).toEqual([second.id]);
    expect((await adminApi.get(`/api/locations/${first}/floor`)).statusCode).toBe(404);
    expect((await adminApi.patch(`/api/locations/${first}`, { name: 'Piraté' })).statusCode).toBe(404);
    expect((await adminApi.post('/api/locations', SECOND_LOCATION)).statusCode).toBe(403);
    expect((await adminApi.post(`/api/locations/${second.id}/zones`, { name: 'Terrasse' })).statusCode).toBe(201);
  });

  it('place les tables automatiquement sans chevauchement et garde des libellés uniques', async () => {
    const { owner, zone, locationId } = await orgWithZone('Placement');
    expect(zone).toMatchObject({ planWidth: 24, planHeight: 16, sort: 0 });

    for (let i = 1; i <= 6; i++) {
      expect((await owner.post(`/api/zones/${zone.id}/tables`, { label: `T${i}` })).statusCode).toBe(201);
    }
    const rect = await owner.post(`/api/zones/${zone.id}/tables`, { label: 'Banquette', shape: 'RECT', capacity: 8 });
    expect(rect.json()).toMatchObject({ w: 4, h: 2 });

    const floor = (await owner.get(`/api/locations/${locationId}/floor`)).json();
    expect(floor.tables).toHaveLength(7);
    expect(findLayoutIssues(floor.tables, zone.planWidth, zone.planHeight)).toEqual({ outOfBounds: [], overlaps: [] });

    expect((await owner.post(`/api/zones/${zone.id}/tables`, { label: ' t1 ' })).statusCode).toBe(409);
    const t1 = floor.tables.find((x: { label: string }) => x.label === 'T1');
    expect((await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T9', x: t1.x, y: t1.y })).statusCode).toBe(409);
    expect((await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T9', x: 23, y: 0 })).statusCode).toBe(409);

    const events = await t.ctx.db.selectFrom('sync_events').select('entity_id').where('entity_type', '=', 'dining_table').where('location_id', '=', locationId).execute();
    expect(events).toHaveLength(7);
  });

  it('enregistre la disposition en tout-ou-rien et refuse les chevauchements', async () => {
    const { owner, zone, locationId } = await orgWithZone('Disposition');
    const a = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    const b = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T2' })).json();

    const bad = await owner.put(`/api/zones/${zone.id}/layout`, {
      tables: [
        { id: a.id, x: 10, y: 10, w: 2, h: 2 },
        { id: b.id, x: 11, y: 11, w: 2, h: 2 },
      ],
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.details.overlaps).toEqual([['T1', 'T2']]);
    const unchanged = (await owner.get(`/api/locations/${locationId}/floor`)).json().tables;
    expect(unchanged.find((x: { id: string }) => x.id === a.id)).toMatchObject({ x: a.x, y: a.y });

    const good = await owner.put(`/api/zones/${zone.id}/layout`, {
      tables: [
        { id: a.id, x: 10, y: 10, w: 2, h: 2 },
        { id: b.id, x: 14, y: 3, w: 2, h: 4 },
      ],
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().find((x: { id: string }) => x.id === b.id)).toMatchObject({ x: 14, y: 3, w: 2, h: 4 });
    expect((await owner.get('/api/audit')).json()[0]).toMatchObject({ action: 'floor.layout_saved' });
  });

  it('protège la réduction et l’archivage des zones ; un libellé archivé est réutilisable', async () => {
    const { owner, zone } = await orgWithZone('Zone');
    const far = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T20', x: 20, y: 2 })).json();

    const shrink = await owner.patch(`/api/zones/${zone.id}`, { planWidth: 12 });
    expect(shrink.statusCode).toBe(409);
    expect(shrink.json().error.details.tables).toEqual(['T20']);
    expect((await owner.post(`/api/zones/${zone.id}/archive`)).statusCode).toBe(409);

    expect((await owner.post(`/api/tables/${far.id}/archive`)).json().status).toBe('ARCHIVED');
    expect((await owner.post(`/api/zones/${zone.id}/tables`, { label: 't20' })).statusCode).toBe(201);
    expect((await owner.patch(`/api/zones/${zone.id}`, { planWidth: 12, name: 'Salle climatisée' })).json()).toMatchObject({ planWidth: 12, name: 'Salle climatisée' });
  });

  it('change une table de zone en lui trouvant une place libre', async () => {
    const { owner, zone, locationId } = await orgWithZone('Deplacer');
    const terrace = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Terrasse', planWidth: 10, planHeight: 8 })).json();
    expect(terrace.sort).toBe(1);
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1', x: 20, y: 12 })).json();

    const moved = await owner.patch(`/api/tables/${table.id}`, { zoneId: terrace.id, capacity: 6 });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ zoneId: terrace.id, capacity: 6 });
    expect(moved.json().x + moved.json().w).toBeLessThanOrEqual(10);
  });

  it('droits : le serveur consulte sans modifier, la cuisine ne voit pas la salle, les autres organisations non plus', async () => {
    const { org, owner, zone, locationId } = await orgWithZone('Droits');
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();

    const waiter = await addMember(t, org.token, 'WAITER');
    const waiterApi = as(t, (await login(t, waiter.email)).json().accessToken);
    expect((await waiterApi.get(`/api/locations/${locationId}/floor`)).statusCode).toBe(200);
    expect((await waiterApi.post(`/api/zones/${zone.id}/tables`, { label: 'T2' })).statusCode).toBe(403);

    const cook = await addMember(t, org.token, 'KITCHEN');
    const cookApi = as(t, (await login(t, cook.email)).json().accessToken);
    expect((await cookApi.get(`/api/locations/${locationId}/floor`)).statusCode).toBe(403);

    const other = as(t, (await registerOrg(t, 'Voisin')).token);
    expect((await other.get(`/api/locations/${locationId}/floor`)).statusCode).toBe(404);
    expect((await other.patch(`/api/tables/${table.id}`, { label: 'X' })).statusCode).toBe(404);
    expect((await other.put(`/api/zones/${zone.id}/layout`, { tables: [{ id: table.id, x: 0, y: 0, w: 2, h: 2 }] })).statusCode).toBe(404);
    expect((await other.patch(`/api/tables/${table.id}`, { zoneId: zone.id })).statusCode).toBe(404);
  });
});

describe('Phase 2 — profil local', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp('sqlite', { AFK_PROFILE: 'local' });
  });
  afterAll(async () => {
    await t.close();
  });

  it("l'établissement d'un serveur local est en mode serveur local, et le reste", async () => {
    const org = await registerOrg(t, 'Local');
    const owner = as(t, org.token);
    const location = (await owner.get('/api/locations')).json()[0];
    expect(location.operatingMode).toBe('HYBRID');
    expect((await owner.patch(`/api/locations/${location.id}`, { operatingMode: 'CLOUD' })).statusCode).toBe(409);
  });
});
