import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINES, PASSWORD, addMember, as, login, registerOrg, startApp, uniqueEmail, type TestApp } from './helpers.ts';

const QUESTION = 'Dans quelle ville êtes-vous né(e) ?';
const NEW_PASSWORD = 'nouveau-mot-de-passe-2026';

describe.each(ENGINES)('Récupération du compte par question secrète — %s', (engine) => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp(engine);
  });
  afterAll(async () => {
    await t.close();
  });

  const register = (email: string, extra: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { organizationName: 'Maquis Secret', locationName: 'Centre', ownerName: 'Patron', email, password: PASSWORD, ...extra },
    });
  const question = (email: string) => t.app.inject({ method: 'POST', url: '/api/auth/recovery/question', payload: { email } });
  const reset = (email: string, answer: string, newPassword = NEW_PASSWORD) =>
    t.app.inject({ method: 'POST', url: '/api/auth/recovery/reset', payload: { email, answer, newPassword } });

  it("l'inscription enregistre la question secrète, et la retrouve par l'adresse", async () => {
    const email = uniqueEmail('secret');
    const res = await register(email, { recoveryQuestion: QUESTION, recoveryAnswer: "N'Djaména" });
    expect(res.statusCode).toBe(201);
    expect(res.json().me.user.hasRecovery).toBe(true);
    const user = await t.ctx.db.selectFrom('users').select(['recovery_question', 'recovery_answer_hash']).where('email', '=', email).executeTakeFirstOrThrow();
    expect(user.recovery_question).toBe(QUESTION);
    expect(user.recovery_answer_hash).toMatch(/^scrypt\$/);

    const q = await question(email.toUpperCase());
    expect(q.statusCode).toBe(200);
    expect(q.json()).toEqual({ question: QUESTION });
  });

  it('refuse une question sans réponse', async () => {
    const res = await register(uniqueEmail('incomplet'), { recoveryQuestion: QUESTION });
    expect(res.statusCode).toBe(400);
  });

  it('mauvaise réponse refusée et tracée ; la bonne (casse, accents, espaces ignorés) change le mot de passe, déconnecte les appareils et connecte', async () => {
    const email = uniqueEmail('oubli');
    const reg = await register(email, { recoveryQuestion: QUESTION, recoveryAnswer: "N'Djaména" });
    const oldRefresh = reg.json().refreshToken as string;

    const bad = await reset(email, 'Moundou');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');

    const good = await reset(email, '  N DJAMENA ');
    expect(good.statusCode).toBe(200);
    expect(good.json().accessToken).toBeTruthy();
    expect(good.json().me.user.email).toBe(email);

    expect((await login(t, email)).statusCode).toBe(401);
    expect((await login(t, email, NEW_PASSWORD)).statusCode).toBe(200);
    const refresh = await t.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: oldRefresh } });
    expect(refresh.statusCode).toBe(401);

    const actions = await t.ctx.db.selectFrom('audit_logs').select('action').where('subject', '=', email).execute();
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['auth.recovery_failed', 'auth.recovered']));
  });

  it('bloque après 5 mauvaises réponses, même avec la bonne ensuite', async () => {
    const email = uniqueEmail('devine');
    await register(email, { recoveryQuestion: QUESTION, recoveryAnswer: 'Abéché' });
    for (let i = 0; i < 5; i += 1) expect((await reset(email, `faux ${i}`)).statusCode).toBe(401);
    expect((await reset(email, 'Abéché')).statusCode).toBe(429);
  });

  it('une récupération réussie lève le blocage de connexion', async () => {
    const email = uniqueEmail('bloque');
    await register(email, { recoveryQuestion: QUESTION, recoveryAnswer: 'Sarh' });
    for (let i = 0; i < 5; i += 1) await login(t, email, `mauvais-${i}-mot-de-passe`);
    expect((await login(t, email)).statusCode).toBe(429);
    expect((await reset(email, 'sarh')).statusCode).toBe(200);
    expect((await login(t, email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('adresse inconnue ou compte sans question : rien à récupérer', async () => {
    const owner = await registerOrg(t, 'SansQuestion');
    expect(owner.me.user.hasRecovery).toBe(false);
    expect((await question(owner.email)).statusCode).toBe(404);
    expect((await question(uniqueEmail('inconnu'))).statusCode).toBe(404);
    expect((await reset(owner.email, 'peu importe')).statusCode).toBe(404);
    expect((await reset(uniqueEmail('inconnu'), 'peu importe')).statusCode).toBe(401);
  });

  it('un membre choisit sa question depuis son compte (mot de passe exigé), la synchronise, puis récupère son compte', async () => {
    const owner = await registerOrg(t, 'Membre');
    const { email } = await addMember(t, owner.token, 'WAITER');
    const session = (await login(t, email)).json();
    const client = as(t, session.accessToken as string);

    const wrong = await client.put('/api/auth/recovery', { currentPassword: 'pas-le-bon-mot-de-passe', question: QUESTION, answer: 'Achta' });
    expect(wrong.statusCode).toBe(401);

    const ok = await client.put('/api/auth/recovery', { currentPassword: PASSWORD, question: 'Quel est le prénom de votre mère ?', answer: 'Achta' });
    expect(ok.statusCode).toBe(204);
    expect((await client.get('/api/auth/me')).json().user.hasRecovery).toBe(true);

    const events = await t.ctx.db.selectFrom('sync_events').select('payload').where('entity_type', '=', 'user').where('entity_id', '=', session.me.user.id).execute();
    const last = events.map((e) => (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload)).pop();
    expect(last.recovery_question).toBe('Quel est le prénom de votre mère ?');

    expect((await reset(email, 'ACHTA')).statusCode).toBe(200);
  });
});
