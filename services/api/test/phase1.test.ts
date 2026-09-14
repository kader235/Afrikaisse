import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, PASSWORD, addMember, bearer, login, registerOrg, startApp, uniqueEmail, type TestApp } from './helpers.ts';

describe.each(ENGINES)('Phase 1 — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  it('expose son état de santé', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', profile: 'cloud', database: engine === 'sqlite' ? 'sqlite' : 'postgres' });
  });

  it("l'inscription crée organisation, établissement, propriétaire, et leurs événements de synchronisation", async () => {
    const org = await registerOrg(t, 'Inscription');
    expect(org.me.role).toBe('OWNER');
    expect(org.me.tenantAccess).toBe('OK');
    expect(org.me.permissions).toContain('users.manage');
    expect(org.me.locations).toHaveLength(1);
    expect(org.me.locations[0].currency).toBe('XAF');
    expect(org.refreshToken).toBeTruthy();

    const events = await t.ctx.db
      .selectFrom('sync_events')
      .select(['entity_type', 'status', 'hlc'])
      .where('tenant_id', '=', org.me.tenant.id)
      .execute();
    expect(events.map((e) => e.entity_type).sort()).toEqual(['location', 'membership', 'station', 'station', 'tenant', 'user']);
    expect(events.every((e) => e.status === 'SYNCED')).toBe(true);

    const audit = await t.app.inject({ method: 'GET', url: '/api/audit', headers: bearer(org.token) });
    expect(audit.json().map((a: { action: string }) => a.action)).toContain('tenant.registered');
  });

  it('refuse une adresse déjà utilisée et un mot de passe trop court', async () => {
    const org = await registerOrg(t, 'Doublon');
    const dup = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Autre', locationName: 'Autre', ownerName: 'Autre', email: org.email.toUpperCase(), password: PASSWORD },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');

    const weak = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Autre', locationName: 'Autre', ownerName: 'Autre', email: uniqueEmail('faible'), password: 'court' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('VALIDATION');
  });

  it("connexion : même réponse pour un mauvais mot de passe et une adresse inconnue, échec tracé", async () => {
    const org = await registerOrg(t, 'Connexion');
    const ok = await login(t, org.email);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().me.tenant.name).toBe('Groupe Connexion');

    const wrong = await login(t, org.email, 'pas-le-bon-mot-de-passe');
    const unknown = await login(t, uniqueEmail('inconnu'), 'pas-le-bon-mot-de-passe');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);

    const trace = await t.ctx.db.selectFrom('audit_logs').select('action').where('subject', '=', org.email).where('action', '=', 'auth.login_failed').execute();
    expect(trace).toHaveLength(1);
  });

  it('verrouille après 5 échecs consécutifs, même avec le bon mot de passe ensuite', async () => {
    const org = await registerOrg(t, 'Verrou');
    for (let i = 0; i < 5; i++) expect((await login(t, org.email, 'mauvais-mot-de-passe')).statusCode).toBe(401);
    const locked = await login(t, org.email);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('fait tourner le jeton de renouvellement et révoque la session en cas de réutilisation', async () => {
    const org = await registerOrg(t, 'Rotation');
    const refresh = (refreshToken: string) => t.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } });

    const r1 = await refresh(org.refreshToken);
    expect(r1.statusCode).toBe(200);
    const next = r1.json();
    expect(next.refreshToken).not.toBe(org.refreshToken);

    // Deux onglets simultanés : refusé, mais la session survit.
    expect((await refresh(org.refreshToken)).statusCode).toBe(401);
    const r2 = await refresh(next.refreshToken);
    expect(r2.statusCode).toBe(200);

    try {
      t.clock.offsetMs = 60_000;
      // Un vieux jeton rejoué plus tard = vol probable : toute la session tombe.
      expect((await refresh(org.refreshToken)).statusCode).toBe(401);
      expect((await refresh(r2.json().refreshToken)).statusCode).toBe(401);
      const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(r2.json().accessToken) });
      expect(me.statusCode).toBe(401);
    } finally {
      t.clock.offsetMs = 0;
    }
  });

  it("mode navigateur : le jeton de renouvellement ne voyage qu'en cookie httpOnly", async () => {
    const org = await registerOrg(t, 'Cookie');
    const res = await login(t, org.email, PASSWORD, { 'x-afk-client': 'web' });
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).toBeUndefined();
    const cookie = res.cookies.find((c) => c.name === 'afk_refresh');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });

    const renewed = await t.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'x-afk-client': 'web' },
      cookies: { afk_refresh: cookie!.value },
      payload: {},
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().refreshToken).toBeUndefined();
  });

  it('la déconnexion invalide immédiatement le jeton d’accès', async () => {
    const org = await registerOrg(t, 'Sortie');
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(org.token) });
    expect(out.statusCode).toBe(204);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(org.token) });
    expect(me.statusCode).toBe(401);
  });

  it('changer son mot de passe déconnecte les autres appareils', async () => {
    const org = await registerOrg(t, 'Secret');
    const other = (await login(t, org.email)).json();
    const change = await t.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: bearer(org.token),
      payload: { currentPassword: PASSWORD, newPassword: 'nouveau-mot-de-passe-2026' },
    });
    expect(change.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(org.token) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(other.accessToken) })).statusCode).toBe(401);
    expect((await login(t, org.email)).statusCode).toBe(401);
    expect((await login(t, org.email, 'nouveau-mot-de-passe-2026')).statusCode).toBe(200);
  });

  it('isole strictement les organisations', async () => {
    const a = await registerOrg(t, 'IsoA');
    const b = await registerOrg(t, 'IsoB');
    const { res: added } = await addMember(t, a.token, 'WAITER');
    expect(added.statusCode).toBe(201);
    const waiterOfA = added.json();

    const teamB = await t.app.inject({ method: 'GET', url: '/api/team', headers: bearer(b.token) });
    expect(teamB.statusCode).toBe(200);
    expect(teamB.json()).toHaveLength(1);
    expect(teamB.json()[0].email).toBe(b.email);

    const patch = await t.app.inject({ method: 'PATCH', url: `/api/team/${waiterOfA.membershipId}`, headers: bearer(b.token), payload: { role: 'MANAGER' } });
    expect(patch.statusCode).toBe(404);
    const reset = await t.app.inject({ method: 'POST', url: `/api/team/${waiterOfA.membershipId}/password`, headers: bearer(b.token), payload: { password: 'volé-volé-volé-2026' } });
    expect(reset.statusCode).toBe(404);

    const auditB = await t.app.inject({ method: 'GET', url: '/api/audit', headers: bearer(b.token) });
    expect(auditB.json().some((e: { entityId: string }) => e.entityId === waiterOfA.membershipId)).toBe(false);

    // Un établissement d'une autre organisation ne peut pas être attribué.
    const foreignLocation = await addMember(t, b.token, 'CASHIER', { locationId: a.me.locations[0].id });
    expect(foreignLocation.res.statusCode).toBe(404);
  });

  it('applique les rôles et la hiérarchie', async () => {
    const owner = await registerOrg(t, 'Rbac');
    const manager = await addMember(t, owner.token, 'MANAGER');
    const waiter = await addMember(t, owner.token, 'WAITER');
    expect(manager.res.statusCode).toBe(201);
    expect(waiter.res.statusCode).toBe(201);

    const waiterSession = (await login(t, waiter.email)).json();
    expect(waiterSession.me.permissions).not.toContain('users.read');
    const denied = await t.app.inject({ method: 'GET', url: '/api/team', headers: bearer(waiterSession.accessToken) });
    expect(denied.statusCode).toBe(403);

    const managerToken = (await login(t, manager.email)).json().accessToken;
    expect((await addMember(t, managerToken, 'ADMIN')).res.statusCode).toBe(403);
    expect((await addMember(t, managerToken, 'CASHIER')).res.statusCode).toBe(201);

    const team = (await t.app.inject({ method: 'GET', url: '/api/team', headers: bearer(managerToken) })).json();
    const ownerMembership = team.find((m: { role: string }) => m.role === 'OWNER');
    const managerMembership = team.find((m: { role: string }) => m.role === 'MANAGER');
    const waiterMembership = team.find((m: { role: string }) => m.role === 'WAITER');

    const touchOwner = await t.app.inject({ method: 'PATCH', url: `/api/team/${ownerMembership.membershipId}`, headers: bearer(managerToken), payload: { status: 'DISABLED' } });
    expect(touchOwner.statusCode).toBe(403);
    const promoteSelf = await t.app.inject({ method: 'PATCH', url: `/api/team/${managerMembership.membershipId}`, headers: bearer(managerToken), payload: { role: 'CASHIER' } });
    expect(promoteSelf.statusCode).toBe(403);

    // Désactivation : effet immédiat, sans attendre l'expiration du jeton.
    const disable = await t.app.inject({ method: 'PATCH', url: `/api/team/${waiterMembership.membershipId}`, headers: bearer(owner.token), payload: { status: 'DISABLED' } });
    expect(disable.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(waiterSession.accessToken) })).statusCode).toBe(401);
    const again = (await login(t, waiter.email)).json();
    expect(again.me.tenantAccess).toBe('DISABLED');
    expect(again.me.permissions).toEqual([]);
    const blocked = await t.app.inject({ method: 'GET', url: '/api/tenant', headers: bearer(again.accessToken) });
    expect(blocked.json().error.code).toBe('ACCOUNT_DISABLED');
  });

  it("empêche une organisation de prendre le contrôle d'un compte partagé", async () => {
    const a = await registerOrg(t, 'PartageA');
    const b = await registerOrg(t, 'PartageB');
    const attach = await t.app.inject({
      method: 'POST',
      url: '/api/team',
      headers: bearer(b.token),
      payload: { displayName: 'Compte de A', email: a.email, role: 'MANAGER' },
    });
    expect(attach.statusCode).toBe(201);
    expect(attach.json().sharedAccount).toBe(true);

    const takeover = await t.app.inject({ method: 'POST', url: `/api/team/${attach.json().membershipId}/password`, headers: bearer(b.token), payload: { password: 'prise-de-controle-2026' } });
    expect(takeover.statusCode).toBe(403);
    const rename = await t.app.inject({ method: 'PATCH', url: `/api/team/${attach.json().membershipId}`, headers: bearer(b.token), payload: { displayName: 'Renommé' } });
    expect(rename.statusCode).toBe(403);

    const session = (await login(t, a.email)).json();
    expect(session.me.tenant).toBeNull();
    expect(session.me.tenantAccess).toBe('NONE');
    expect(session.me.memberships).toHaveLength(2);

    const switched = await t.app.inject({ method: 'POST', url: '/api/auth/switch-tenant', headers: bearer(session.accessToken), payload: { tenantId: b.me.tenant.id } });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().me).toMatchObject({ role: 'MANAGER', tenantAccess: 'OK' });
  });

  it('back-office : invisible pour un restaurant, suspension effective immédiatement', async () => {
    const client = await registerOrg(t, 'Client');
    expect((await t.app.inject({ method: 'GET', url: '/api/platform/tenants', headers: bearer(client.token) })).statusCode).toBe(404);

    const staff = await registerOrg(t, 'Globaltech');
    await t.ctx.db.updateTable('users').set({ is_platform_admin: 1 }).where('email', '=', staff.email).execute();
    const list = await t.app.inject({ method: 'GET', url: '/api/platform/tenants', headers: bearer(staff.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().find((x: { id: string }) => x.id === client.me.tenant.id)).toMatchObject({ members: 1, locations: 1, status: 'ACTIVE' });

    const url = `/api/platform/tenants/${client.me.tenant.id}`;
    expect((await t.app.inject({ method: 'POST', url: `${url}/suspend`, headers: bearer(staff.token) })).statusCode).toBe(204);
    const blocked = await t.app.inject({ method: 'GET', url: '/api/team', headers: bearer(client.token) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('TENANT_SUSPENDED');
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(client.token) })).json().tenantAccess).toBe('SUSPENDED');

    expect((await t.app.inject({ method: 'POST', url: `${url}/reactivate`, headers: bearer(staff.token) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/team', headers: bearer(client.token) })).statusCode).toBe(200);
  });

  it('publie une documentation OpenAPI', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const paths = Object.keys(res.json().paths);
    expect(paths).toEqual(expect.arrayContaining(['/api/auth/login', '/api/team/{membershipId}', '/api/platform/tenants']));
  });
});

describe('Profil local (serveur du restaurant)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp('sqlite', { AFK_PROFILE: 'local' });
  });
  afterAll(async () => {
    await t.close();
  });

  it("ne se configure qu'une fois, sans back-office, et met ses événements en attente d'envoi", async () => {
    const org = await registerOrg(t, 'Local');
    await expect(registerOrg(t, 'Intrus')).rejects.toThrow(/403/);
    expect((await t.app.inject({ method: 'GET', url: '/api/platform/tenants', headers: bearer(org.token) })).statusCode).toBe(404);

    const pending = await t.ctx.db.selectFrom('sync_events').select('status').execute();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.status === 'PENDING')).toBe(true);
  });
});
