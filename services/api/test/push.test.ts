import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushMessage, PushResult, PushSender } from '../src/lib/fcm.ts';
import { notify } from '../src/lib/notify.ts';
import { PUSH_FRESH_MS, dispatchPushes } from '../src/services/push.ts';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

describe.each(ENGINES)('§42 — notifications push (tablette fermée) — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  let counter = 0;
  const fakeToken = (label: string) => {
    counter += 1;
    return `fcm-${label}-${String(counter).padStart(6, '0')}-${'x'.repeat(30)}`;
  };

  function fakeFcm() {
    const sent: PushMessage[] = [];
    const verdicts = new Map<string, PushResult>();
    const sender: PushSender = {
      async send(message) {
        sent.push(message);
        return verdicts.get(message.token) ?? 'sent';
      },
    };
    return { sent, verdicts, sender };
  }

  async function restaurant(label: string) {
    const org = await registerOrg(t, label);
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const tenantId = org.me.tenant.id as string;
    const staff = async (role: string) => {
      const { email } = await addMember(t, org.token, role);
      const session = (await login(t, email)).json();
      const client = as(t, session.accessToken);
      const token = fakeToken(role.toLowerCase());
      const res = await client.post(`/api/locations/${locationId}/push-tokens`, { token });
      expect(res.statusCode, res.body).toBe(204);
      return { client, token, userId: session.me.user.id as string };
    };
    const ready = (createdBy: string | null = null) =>
      notify(t.ctx.db, t.ctx, { tenantId, locationId, kind: 'ORDER_READY', data: { orderNumber: 12, tableLabel: 'T1', serviceType: 'DINE_IN' }, entityType: 'order', entityId: null, createdBy });
    return { org, owner, locationId, tenantId, staff, ready };
  }

  it("envoie à la salle et à la caisse, pas à la cuisine ; l'auteur du geste ne reçoit rien", async () => {
    const r = await restaurant('PushRoles');
    const waiter = await r.staff('WAITER');
    const cashier = await r.staff('CASHIER');
    const cook = await r.staff('KITCHEN');
    const fcm = fakeFcm();

    // Première exécution : le curseur part de l'existant, rien n'est envoyé.
    expect(await dispatchPushes(t.ctx, fcm.sender)).toBe(0);

    await r.ready(waiter.userId);
    expect(await dispatchPushes(t.ctx, fcm.sender)).toBe(1);

    const tokens = fcm.sent.map((m) => m.token);
    expect(tokens).toContain(cashier.token);
    expect(tokens).not.toContain(waiter.token);
    expect(tokens).not.toContain(cook.token);
    const message = fcm.sent.find((m) => m.token === cashier.token)!;
    expect(message.title).toBe('Commande n°12 prête');
    expect(message.body).toBe('Table T1');
    expect(message.data).toMatchObject({ target: 'orders', kind: 'ORDER_READY' });
  });

  it('un lot n’est envoyé qu’une fois (curseur) et rien ne part sans nouvelle notification', async () => {
    const r = await restaurant('PushOnce');
    const waiter = await r.staff('WAITER');
    const fcm = fakeFcm();
    await dispatchPushes(t.ctx, fcm.sender);

    await r.ready();
    expect(await dispatchPushes(t.ctx, fcm.sender)).toBe(1);
    expect(await dispatchPushes(t.ctx, fcm.sender)).toBe(0);
    expect(fcm.sent.filter((m) => m.token === waiter.token)).toHaveLength(1);
  });

  it('un jeton mort (appli désinstallée) est supprimé ; une panne passagère le garde', async () => {
    const r = await restaurant('PushDead');
    const dead = await r.staff('WAITER');
    const flaky = await r.staff('CASHIER');
    const fcm = fakeFcm();
    fcm.verdicts.set(dead.token, 'invalid');
    fcm.verdicts.set(flaky.token, 'failed');
    await dispatchPushes(t.ctx, fcm.sender);

    await r.ready();
    await dispatchPushes(t.ctx, fcm.sender);
    const left = (await t.ctx.db.selectFrom('push_tokens').select('token').where('location_id', '=', r.locationId).execute()).map((row) => row.token);
    expect(left).not.toContain(dead.token);
    expect(left).toContain(flaky.token);
  });

  it('une alerte périmée (serveur resté arrêté) ne part pas', async () => {
    const r = await restaurant('PushStale');
    await r.staff('WAITER');
    const fcm = fakeFcm();
    await dispatchPushes(t.ctx, fcm.sender);

    await r.ready();
    t.clock.offsetMs += PUSH_FRESH_MS + 1_000;
    try {
      expect(await dispatchPushes(t.ctx, fcm.sender)).toBe(0);
      expect(fcm.sent).toHaveLength(0);
    } finally {
      t.clock.offsetMs -= PUSH_FRESH_MS + 1_000;
    }
  });

  it("un autre restaurant ne reçoit jamais les alertes du premier", async () => {
    const a = await restaurant('PushA');
    const b = await restaurant('PushB');
    const inA = await a.staff('WAITER');
    const inB = await b.staff('WAITER');
    const fcm = fakeFcm();
    await dispatchPushes(t.ctx, fcm.sender);

    await a.ready();
    await dispatchPushes(t.ctx, fcm.sender);
    const tokens = fcm.sent.map((m) => m.token);
    expect(tokens).toContain(inA.token);
    expect(tokens).not.toContain(inB.token);
  });

  it('déconnexion : /push-tokens/remove retire son propre jeton, jamais celui d’un autre', async () => {
    const r = await restaurant('PushLogout');
    const waiter = await r.staff('WAITER');
    const cashier = await r.staff('CASHIER');

    const foreign = await waiter.client.post('/api/push-tokens/remove', { token: cashier.token });
    expect(foreign.statusCode).toBe(204);
    const stillThere = await t.ctx.db.selectFrom('push_tokens').select('token').where('token', '=', cashier.token).executeTakeFirst();
    expect(stillThere).toBeTruthy();

    const own = await waiter.client.post('/api/push-tokens/remove', { token: waiter.token });
    expect(own.statusCode).toBe(204);
    const gone = await t.ctx.db.selectFrom('push_tokens').select('token').where('token', '=', waiter.token).executeTakeFirst();
    expect(gone).toBeUndefined();
  });
});
