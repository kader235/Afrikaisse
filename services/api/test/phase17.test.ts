import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY_MS } from '@afrikaisse/core';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

const LOCATION = { type: 'CAFE', currency: 'XAF', timezone: 'Africa/Ndjamena', country: 'TD' };

describe.each(ENGINES)('Abonnements (phase 17) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it("essai de 30 jours à l'inscription ; limites de l'offre ; à l'échéance la croissance s'arrête, jamais le service", async () => {
    const org = await registerOrg(t, 'Abo');
    const locationId = org.me.locations[0].id as string;
    expect(org.me.tenant.plan).toBe('TRIAL');
    expect(org.me.tenant.planExpiresAt - Date.now()).toBeGreaterThan(29 * DAY_MS);
    const owner = as(t, org.token);
    expect((await owner.get('/api/tenant')).json().subscription).toMatchObject({
      plan: 'TRIAL',
      label: 'Essai gratuit',
      state: 'TRIAL',
      daysLeft: 30,
      limits: { locations: 3, members: 25, localServers: 1 },
      usage: { locations: 1, members: 1, localServers: 0 },
    });

    expect((await owner.post('/api/locations', { ...LOCATION, name: 'Annexe 2' })).statusCode).toBe(201);
    expect((await owner.post('/api/locations', { ...LOCATION, name: 'Annexe 3' })).statusCode).toBe(201);
    const refused = await owner.post('/api/locations', { ...LOCATION, name: 'Annexe 4' });
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error).toMatchObject({ code: 'PLAN_LIMIT', details: { resource: 'locations', limit: 3, used: 3 } });

    try {
      // Échu depuis un jour : délai de grâce, tout reste permis.
      t.clock.offsetMs = 31 * DAY_MS;
      const grace = (await login(t, org.email)).json().accessToken as string;
      expect((await as(t, grace).get('/api/tenant')).json().subscription).toMatchObject({ state: 'GRACE', daysLeft: -1 });
      expect((await addMember(t, grace, 'WAITER')).res.statusCode).toBe(201);

      // Grâce écoulée : plus d'ajout, mais la caisse s'ouvre et le personnel se connecte.
      t.clock.offsetMs = 38 * DAY_MS;
      const late = (await login(t, org.email)).json().accessToken as string;
      const lateOwner = as(t, late);
      expect((await lateOwner.get('/api/tenant')).json().subscription.state).toBe('EXPIRED');
      const blocked = await addMember(t, late, 'CASHIER');
      expect(blocked.res.statusCode).toBe(402);
      expect(blocked.res.json().error.message).toContain('le service continue');
      expect((await lateOwner.post(`/api/locations/${locationId}/pairing-code`)).statusCode).toBe(402);
      const opened = await lateOwner.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 5000 });
      expect(opened.statusCode).toBeLessThan(300);
    } finally {
      t.clock.offsetMs = 0;
    }
  });

  it("le back-office GLOBALTECH change l'offre et prolonge ; le client ne le peut pas", async () => {
    const client = await registerOrg(t, 'Client17');
    const staff = await registerOrg(t, 'Globaltech17');
    await t.ctx.db.updateTable('users').set({ is_platform_admin: 1 }).where('email', '=', staff.email).execute();
    const url = `/api/platform/tenants/${client.me.tenant.id}/subscription`;
    const clientApi = as(t, client.token);
    const admin = as(t, staff.token);

    expect((await clientApi.post(url, { plan: 'ENTERPRISE', months: 0, unlimited: true })).statusCode).toBe(404);
    expect((await admin.post(url, { plan: 'GOLD', months: 1 })).statusCode).toBe(400);

    const pro = await admin.post(url, { plan: 'PRO', months: 12 });
    expect(pro.statusCode).toBe(200);
    expect(pro.json()).toMatchObject({ plan: 'PRO', label: 'Pro', state: 'ACTIVE', monthlyPrice: 35000, limits: { locations: 3, localServers: 3 } });
    // Les 12 mois s'ajoutent aux 30 jours d'essai restants.
    expect(Math.round((pro.json().expiresAt - Date.now()) / DAY_MS)).toBe(30 + 12 * 30);
    const listed = (await admin.get('/api/platform/tenants')).json().find((x: { id: string }) => x.id === client.me.tenant.id);
    expect(listed).toMatchObject({ plan: 'PRO', planExpiresAt: pro.json().expiresAt });

    // Changer d'offre sans prolonger garde l'échéance ; l'offre Essentiel n'a qu'un établissement.
    const starter = (await admin.post(url, { plan: 'STARTER', months: 0 })).json();
    expect(starter).toMatchObject({ plan: 'STARTER', expiresAt: pro.json().expiresAt, limits: { locations: 1 } });
    expect((await clientApi.post('/api/locations', { ...LOCATION, name: 'Refusé' })).statusCode).toBe(402);

    const group = (await admin.post(url, { plan: 'ENTERPRISE', months: 0, unlimited: true })).json();
    expect(group).toMatchObject({ state: 'ACTIVE', expiresAt: null, daysLeft: null, monthlyPrice: null, limits: { locations: null } });
    expect((await clientApi.post('/api/locations', { ...LOCATION, name: 'Accepté' })).statusCode).toBe(201);

    const actions = (await clientApi.get('/api/audit')).json().map((a: { action: string }) => a.action);
    expect(actions.filter((a: string) => a === 'platform.subscription_changed')).toHaveLength(3);
  });

  it("liste et révoque un serveur local : il est refusé, l'établissement repasse en ligne, la place se libère", async () => {
    const org = await registerOrg(t, 'Revoque');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const code = (await owner.post(`/api/locations/${locationId}/pairing-code`)).json().code;
    const paired = await t.app.inject({ method: 'POST', url: '/api/sync/pair', payload: { code, deviceName: 'PC comptoir' } });
    expect(paired.statusCode).toBe(200);
    const { deviceId, deviceSecret } = paired.json();
    const headers = { 'x-afk-device': deviceId, 'x-afk-device-secret': deviceSecret };
    const pull = () => t.app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers });
    expect((await pull()).statusCode).toBe(200);

    expect((await owner.get('/api/tenant')).json().subscription.usage.localServers).toBe(1);
    // L'essai compte un seul serveur local.
    expect((await owner.post(`/api/locations/${locationId}/pairing-code`)).statusCode).toBe(402);
    expect((await owner.get(`/api/locations/${locationId}/devices`)).json()).toEqual([expect.objectContaining({ id: deviceId, name: 'PC comptoir', status: 'ACTIVE' })]);

    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    expect((await waiter.get(`/api/locations/${locationId}/devices`)).statusCode).toBe(403);
    expect((await waiter.post(`/api/devices/${deviceId}/revoke`)).statusCode).toBe(403);
    const intruder = as(t, (await registerOrg(t, 'Intrus17')).token);
    expect((await intruder.post(`/api/devices/${deviceId}/revoke`)).statusCode).toBe(404);

    expect((await owner.post(`/api/devices/${deviceId}/revoke`)).statusCode).toBe(204);
    expect((await pull()).statusCode).toBe(401);
    expect((await owner.get(`/api/locations/${locationId}/devices`)).json()[0].status).toBe('REVOKED');
    const location = (await owner.get('/api/locations')).json().find((l: { id: string }) => l.id === locationId);
    expect(location.operatingMode).toBe('CLOUD');
    expect((await owner.post(`/api/locations/${locationId}/pairing-code`)).statusCode).toBe(200);
    expect((await owner.get('/api/audit')).json().map((a: { action: string }) => a.action)).toContain('sync.device_revoked');
  });
});
