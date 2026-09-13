import { createDatabase, migrateToLatest } from '@afrikaisse/database';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

export type Engine = 'sqlite' | 'pglite';
/** Chaque scénario tourne sur SQLite (serveur local) ET PostgreSQL (Cloud). */
export const ENGINES: Engine[] = ['sqlite', 'pglite'];
export const PASSWORD = 'motdepasse-solide-2026';

export async function startApp(engine: Engine, env: Record<string, string> = {}) {
  const database = await createDatabase(engine === 'sqlite' ? { kind: 'sqlite', file: ':memory:' } : { kind: 'pglite' });
  await migrateToLatest(database);
  const clock = { offsetMs: 0 };
  const config = loadConfig({ AFK_PROFILE: 'cloud', AFK_JWT_SECRET: 'secret-de-test-'.padEnd(48, 'x'), ...env });
  const { app, ctx } = await buildApp({ database, config, now: () => Date.now() + clock.offsetMs });
  return {
    app,
    ctx,
    clock,
    async close() {
      await app.close();
      await database.close();
    },
  };
}
export type TestApp = Awaited<ReturnType<typeof startApp>>;

let counter = 0;
export function uniqueEmail(label: string) {
  counter += 1;
  return `${label.toLowerCase()}.${counter}.${Date.now()}@test.td`;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Client HTTP authentifié : `as(t, token).post('/api/…', corps)`. */
export function as(t: TestApp, token: string) {
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: bearer(token), ...(payload !== undefined && { payload: payload as object }) });
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, payload: unknown = {}) => send('POST', url, payload),
    patch: (url: string, payload: unknown) => send('PATCH', url, payload),
    put: (url: string, payload: unknown) => send('PUT', url, payload),
  };
}

export async function registerOrg(t: TestApp, label: string) {
  const email = uniqueEmail(`owner-${label}`);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { organizationName: `Groupe ${label}`, locationName: `${label} Centre`, ownerName: `Patron ${label}`, email, password: PASSWORD },
  });
  if (res.statusCode !== 201) throw new Error(`inscription ${label} : ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, refreshToken: body.refreshToken as string, me: body.me };
}

export async function login(t: TestApp, email: string, password = PASSWORD, headers: Record<string, string> = {}) {
  return t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers });
}

export async function addMember(t: TestApp, token: string, role: string, extra: Record<string, unknown> = {}) {
  const email = uniqueEmail(role);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/team',
    headers: bearer(token),
    payload: { displayName: `${role} test`, email, password: PASSWORD, role, ...extra },
  });
  return { res, email };
}
