import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZONE_COLORS, findLayoutIssues } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Couleurs de zone et tables en série — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  async function org(label: string) {
    const o = await registerOrg(t, label);
    return { org: o, owner: as(t, o.token), locationId: o.me.locations[0].id as string };
  }

  it('chaque nouvelle zone reçoit une couleur différente ; une couleur choisie est gardée', async () => {
    const { owner, locationId } = await org('Couleurs');
    const colors: string[] = [];
    for (const name of ['Salle', 'Terrasse', 'VIP']) {
      const res = await owner.post(`/api/locations/${locationId}/zones`, { name });
      expect(res.statusCode).toBe(201);
      colors.push(res.json().color);
    }
    expect(new Set(colors).size).toBe(3);
    for (const c of colors) expect(ZONE_COLORS).toContain(c);

    const custom = await owner.post(`/api/locations/${locationId}/zones`, { name: 'Jardin', color: '#0f766e' });
    expect(custom.statusCode).toBe(201);
    expect(custom.json().color).toBe('#0F766E');

    // Couleur déjà prise par Jardin : la zone suivante en reçoit une autre.
    const next = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Bar' })).json();
    expect([...colors, '#0F766E']).not.toContain(next.color);

    const floor = (await owner.get(`/api/locations/${locationId}/floor`)).json();
    expect(floor.zones.map((z: { color: string }) => z.color)).toEqual([...colors, '#0F766E', next.color]);
  });

  it('refuse une couleur invalide et modifie la couleur d’une zone', async () => {
    const { owner, locationId } = await org('CouleurModif');
    for (const color of ['bleu', '#12345', '#GGGGGG', 'rgb(0,0,0)']) {
      expect((await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle', color })).statusCode).toBe(400);
    }
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    expect((await owner.patch(`/api/zones/${zone.id}`, { color: 'red' })).statusCode).toBe(400);
    const updated = await owner.patch(`/api/zones/${zone.id}`, { color: '#be185d' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().color).toBe('#BE185D');
    const floor = (await owner.get(`/api/locations/${locationId}/floor`)).json();
    expect(floor.zones[0].color).toBe('#BE185D');
  });

  it('crée T1 à T5 en passant le libellé déjà pris, chacune avec son QR', async () => {
    const { owner, locationId } = await org('Serie');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const other = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Terrasse' })).json();
    // T3 existe dans une autre zone : le libellé est unique dans l'établissement.
    expect((await owner.post(`/api/zones/${other.id}/tables`, { label: 'T3' })).statusCode).toBe(201);

    const res = await owner.post(`/api/zones/${zone.id}/tables/range`, { prefix: 'T', from: 1, to: 5, capacity: 6, shape: 'ROUND' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created.map((x: { label: string }) => x.label)).toEqual(['T1', 'T2', 'T4', 'T5']);
    expect(body.skipped).toEqual(['T3']);
    expect(body.full).toEqual([]);
    expect(body.created.every((x: { capacity: number; shape: string; zoneId: string }) => x.capacity === 6 && x.shape === 'ROUND' && x.zoneId === zone.id)).toBe(true);

    const floor = (await owner.get(`/api/locations/${locationId}/floor`)).json();
    const inZone = floor.tables.filter((x: { zoneId: string }) => x.zoneId === zone.id);
    expect(inZone).toHaveLength(4);
    expect(findLayoutIssues(inZone, zone.planWidth, zone.planHeight)).toEqual({ outOfBounds: [], overlaps: [] });

    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes as { tableId: string }[];
    for (const table of body.created) expect(qr.some((c) => c.tableId === table.id)).toBe(true);

    // Préfixe vide : « 10 », « 11 ».
    const bare = (await owner.post(`/api/zones/${other.id}/tables/range`, { prefix: '', from: 10, to: 11 })).json();
    expect(bare.created.map((x: { label: string }) => x.label)).toEqual(['10', '11']);
  });

  it('s’arrête quand le plan est plein et rend les libellés restants', async () => {
    const { owner, locationId } = await org('Plein');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Coin', planWidth: 8, planHeight: 6 })).json();
    const res = await owner.post(`/api/zones/${zone.id}/tables/range`, { from: 1, to: 20 });
    expect(res.statusCode).toBe(201);
    const { created, skipped, full } = res.json();
    expect(created.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(0);
    expect(skipped).toEqual([]);
    expect(created.length + full.length).toBe(20);
    expect(full[0]).toBe(`T${created.length + 1}`);
    expect(full[full.length - 1]).toBe('T20');
    const floor = (await owner.get(`/api/locations/${locationId}/floor`)).json();
    expect(findLayoutIssues(floor.tables, 8, 6)).toEqual({ outOfBounds: [], overlaps: [] });
  });

  it('refuse plus de 100 tables et un intervalle à l’envers', async () => {
    const { owner, locationId } = await org('Borne');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    expect((await owner.post(`/api/zones/${zone.id}/tables/range`, { from: 1, to: 101 })).statusCode).toBe(400);
    expect((await owner.post(`/api/zones/${zone.id}/tables/range`, { from: 5, to: 2 })).statusCode).toBe(400);
    expect((await owner.post(`/api/zones/${zone.id}/tables/range`, { prefix: 'TABLEXX', from: 1, to: 2 })).statusCode).toBe(400);
    expect((await owner.post(`/api/zones/${zone.id}/tables/range`, { from: 0, to: 1000 })).statusCode).toBe(400);
  });

  it('droits : le serveur ne crée pas de tables, une autre organisation ne voit pas la zone', async () => {
    const { org: o, owner, locationId } = await org('DroitsSerie');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const waiter = await addMember(t, o.token, 'WAITER');
    const waiterApi = as(t, (await login(t, waiter.email)).json().accessToken);
    expect((await waiterApi.post(`/api/zones/${zone.id}/tables/range`, { from: 1, to: 3 })).statusCode).toBe(403);
    expect((await waiterApi.patch(`/api/zones/${zone.id}`, { color: '#15803D' })).statusCode).toBe(403);

    const other = as(t, (await registerOrg(t, 'VoisinSerie')).token);
    expect((await other.post(`/api/zones/${zone.id}/tables/range`, { from: 1, to: 3 })).statusCode).toBe(404);
    expect((await other.patch(`/api/zones/${zone.id}`, { color: '#15803D' })).statusCode).toBe(404);
    expect((await owner.get(`/api/locations/${locationId}/floor`)).json().tables).toHaveLength(0);
  });
});
