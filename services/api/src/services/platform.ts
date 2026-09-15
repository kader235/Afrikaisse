import { sql } from 'kysely';
import {
  AppError,
  DAY_MS,
  subscriptionState,
  type ErrorLogEntry,
  type PlatformDevice,
  type PlatformRestaurant,
  type PlatformStats,
  type PlatformSyncState,
  type PlatformUser,
} from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { AuthState } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { revokeUserSessions } from './auth.ts';

/**
 * Back-office GLOBALTECH BUSINESS TD (§67). Lecture transverse à toutes les organisations : chaque
 * fonction est appelée APRÈS `requirePlatformAdmin`, et les routes n'existent que dans le Cloud.
 */

/** Motif LIKE sans caractères génériques saisis par l'utilisateur. */
const likePattern = (term: string) => `%${term.toLowerCase().replace(/[%_\\]/g, '')}%`;

export async function listRestaurants(ctx: AppContext, search?: string): Promise<PlatformRestaurant[]> {
  let q = ctx.db
    .selectFrom('tenants as t')
    .select((eb) => [
      't.id',
      't.name',
      't.status',
      't.plan',
      't.plan_expires_at',
      't.is_demo',
      't.created_at',
      eb.selectFrom('memberships as m').select((e) => e.fn.countAll().as('n')).whereRef('m.tenant_id', '=', 't.id').where('m.status', '=', 'ACTIVE').as('members'),
    ]);
  if (search?.trim()) q = q.where(sql<boolean>`lower(t.name) like ${likePattern(search.trim())}`);
  const tenants = await q.orderBy('t.created_at', 'desc').limit(500).execute();
  if (tenants.length === 0) return [];
  const ids = tenants.map((t) => t.id);
  const [locations, activity] = await Promise.all([
    ctx.db.selectFrom('locations').select(['id', 'tenant_id', 'name', 'status', 'operating_mode', 'currency', 'country', 'created_at']).where('tenant_id', 'in', ids).orderBy('created_at').execute(),
    // Dernière écriture métier : toute modification passe par le journal de synchronisation.
    ctx.db
      .selectFrom('sync_events')
      .select((eb) => ['tenant_id', 'location_id', eb.fn.max('created_at').as('at')])
      .where('tenant_id', 'in', ids)
      .groupBy(['tenant_id', 'location_id'])
      .execute(),
  ]);
  const now = ctx.now();
  return tenants.map((t) => {
    const mine = activity.filter((a) => a.tenant_id === t.id);
    const last = mine.reduce<number | null>((m, a) => Math.max(m ?? 0, Number(a.at)), null);
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      plan: t.plan,
      planExpiresAt: t.plan_expires_at,
      subscriptionState: subscriptionState(t.plan, t.plan_expires_at, now).state,
      isDemo: t.is_demo === 1,
      createdAt: t.created_at,
      members: Number(t.members),
      lastActivityAt: last,
      locations: locations
        .filter((l) => l.tenant_id === t.id)
        .map((l) => {
          const at = mine.find((a) => a.location_id === l.id)?.at;
          return { id: l.id, name: l.name, status: l.status, operatingMode: l.operating_mode, currency: l.currency, country: l.country, createdAt: l.created_at, lastActivityAt: at === undefined || at === null ? null : Number(at) };
        }),
    };
  });
}

export async function listUsers(ctx: AppContext, search: string | undefined, limit: number): Promise<PlatformUser[]> {
  let q = ctx.db
    .selectFrom('users as u')
    .select((eb) => [
      'u.id',
      'u.email',
      'u.display_name',
      'u.status',
      'u.is_platform_admin',
      'u.created_at',
      eb.selectFrom('auth_sessions as s').select((e) => e.fn.max('s.last_used_at').as('m')).whereRef('s.user_id', '=', 'u.id').as('last_seen'),
    ]);
  if (search?.trim()) {
    const p = likePattern(search.trim());
    q = q.where(sql<boolean>`(lower(coalesce(u.email, '')) like ${p} or lower(u.display_name) like ${p})`);
  }
  const users = await q.orderBy('u.created_at', 'desc').limit(limit).execute();
  if (users.length === 0) return [];
  const memberships = await ctx.db
    .selectFrom('memberships as m')
    .innerJoin('tenants as t', 't.id', 'm.tenant_id')
    .select(['m.user_id', 'm.tenant_id', 't.name', 'm.role', 'm.status'])
    .where('m.user_id', 'in', users.map((u) => u.id))
    .orderBy('t.name')
    .execute();
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    status: u.status,
    isPlatformAdmin: u.is_platform_admin === 1,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen === null || u.last_seen === undefined ? null : Number(u.last_seen),
    memberships: memberships.filter((m) => m.user_id === u.id).map((m) => ({ tenantId: m.tenant_id, tenantName: m.name, role: m.role, status: m.status })),
  }));
}

/**
 * Suspendre un compte dans toutes ses organisations : statut du compte, sessions révoquées tout de
 * suite, et changement envoyé aux serveurs locaux de chaque organisation (connexion refusée sur place).
 */
export async function setUserStatus(ctx: AppContext, admin: AuthState, userId: string, status: 'ACTIVE' | 'DISABLED', meta: RequestMeta): Promise<void> {
  if (userId === admin.userId) throw new AppError('CONFLICT', 'Impossible de modifier votre propre compte depuis le back-office.');
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const user = await trx.selectFrom('users').select(['status', 'is_platform_admin']).where('id', '=', userId).executeTakeFirst();
    if (!user) throw new AppError('NOT_FOUND', 'Compte introuvable.');
    if (status === 'DISABLED' && user.is_platform_admin === 1) throw new AppError('CONFLICT', 'Compte du back-office : retirez d’abord son accès (cli revoke-platform-admin).');
    if (user.status === status) return;
    const hlc = ctx.clock.now();
    await trx.updateTable('users').set({ status, updated_at: now, updated_hlc: hlc }).where('id', '=', userId).execute();
    if (status === 'DISABLED') await revokeUserSessions(trx, ctx, userId, 'platform_suspended');
    const row = await trx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    const tenants = [...new Set((await trx.selectFrom('memberships').select('tenant_id').where('user_id', '=', userId).execute()).map((m) => m.tenant_id))];
    const action = status === 'DISABLED' ? 'platform.user_suspended' : 'platform.user_reactivated';
    for (const tenantId of tenants) {
      await recordChange(trx, ctx, { tenantId, entityType: 'user', entityId: userId, operation: 'UPSERT', payload: row, hlc });
      await writeAudit(trx, ctx, { tenantId, actorUserId: admin.userId, action, entityType: 'user', entityId: userId, data: { before: user.status, after: status }, meta });
    }
    if (tenants.length === 0) await writeAudit(trx, ctx, { actorUserId: admin.userId, action, entityType: 'user', entityId: userId, data: { before: user.status, after: status }, meta });
  });
  ctx.log.security.info({ userId, status, by: admin.userId }, status === 'DISABLED' ? 'Compte suspendu (back-office)' : 'Compte réactivé (back-office)');
}

export async function listDevices(ctx: AppContext): Promise<PlatformDevice[]> {
  const rows = await ctx.db
    .selectFrom('devices as d')
    .leftJoin('tenants as t', 't.id', 'd.tenant_id')
    .leftJoin('locations as l', 'l.id', 'd.location_id')
    .select(['d.id', 'd.kind', 'd.name', 'd.status', 'd.tenant_id', 't.name as tenant_name', 'd.location_id', 'l.name as location_name', 'd.app_version', 'd.last_seen_at', 'd.created_at'])
    .where('d.kind', '!=', 'CLOUD')
    .orderBy('d.created_at', 'desc')
    .limit(1000)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    status: r.status,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    locationId: r.location_id,
    locationName: r.location_name,
    appVersion: r.app_version,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
  }));
}

export async function listSyncStates(ctx: AppContext): Promise<PlatformSyncState[]> {
  const [rows, conflicts] = await Promise.all([
    ctx.db
      .selectFrom('devices as d')
      .leftJoin('tenants as t', 't.id', 'd.tenant_id')
      .leftJoin('locations as l', 'l.id', 'd.location_id')
      .select(['d.id', 'd.name', 'd.status', 't.name as tenant_name', 'l.name as location_name', 'd.app_version', 'd.last_seen_at', 'd.last_push_at', 'd.last_pull_at', 'd.reported_pending', 'd.reported_failed', 'd.reported_conflicts', 'd.reported_at'])
      .where('d.kind', '=', 'LOCAL_SERVER')
      .orderBy('d.created_at', 'desc')
      .limit(1000)
      .execute(),
    ctx.db.selectFrom('sync_events').select((eb) => ['device_id', eb.fn.countAll().as('n')]).where('status', '=', 'CONFLICT').groupBy('device_id').execute(),
  ]);
  return rows.map((r) => ({
    deviceId: r.id,
    name: r.name,
    status: r.status,
    tenantName: r.tenant_name,
    locationName: r.location_name,
    appVersion: r.app_version,
    lastSeenAt: r.last_seen_at,
    lastPushAt: r.last_push_at,
    lastPullAt: r.last_pull_at,
    pending: r.reported_pending,
    failed: r.reported_failed,
    conflicts: r.reported_conflicts,
    reportedAt: r.reported_at,
    cloudConflicts: Number(conflicts.find((c) => c.device_id === r.id)?.n ?? 0),
  }));
}

export async function listErrors(ctx: AppContext, limit: number, before?: number): Promise<ErrorLogEntry[]> {
  let q = ctx.db
    .selectFrom('error_logs as e')
    .leftJoin('tenants as t', 't.id', 'e.tenant_id')
    .select(['e.id', 'e.created_at', 'e.request_id', 'e.method', 'e.route', 'e.status', 'e.code', 'e.message', 'e.tenant_id', 't.name as tenant_name']);
  if (before !== undefined) q = q.where('e.created_at', '<', before);
  const rows = await q.orderBy('e.created_at', 'desc').orderBy('e.id', 'desc').limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    requestId: r.request_id,
    method: r.method,
    route: r.route,
    status: r.status,
    code: r.code,
    message: r.message,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
  }));
}

/** Chiffres de la plateforme, organisations de démonstration exclues des ventes. */
export async function platformStats(ctx: AppContext): Promise<PlatformStats> {
  const now = ctx.now();
  const n = (row: { n: unknown } | undefined) => Number(row?.n ?? 0);
  const [tenantRows, activeLocations, hybridLocations, users, localServers] = await Promise.all([
    ctx.db.selectFrom('tenants').select((eb) => ['status', 'is_demo', eb.fn.countAll().as('n')]).groupBy(['status', 'is_demo']).execute(),
    ctx.db
      .selectFrom('locations as l')
      .innerJoin('tenants as t', 't.id', 'l.tenant_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('l.status', '=', 'ACTIVE')
      .where('t.status', '=', 'ACTIVE')
      .where('t.is_demo', '=', 0)
      .executeTakeFirst(),
    ctx.db
      .selectFrom('locations as l')
      .innerJoin('tenants as t', 't.id', 'l.tenant_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('l.status', '=', 'ACTIVE')
      .where('l.operating_mode', '=', 'HYBRID')
      .where('t.is_demo', '=', 0)
      .executeTakeFirst(),
    ctx.db.selectFrom('users').select((eb) => eb.fn.countAll().as('n')).where('status', '=', 'ACTIVE').executeTakeFirst(),
    ctx.db.selectFrom('devices').select((eb) => eb.fn.countAll().as('n')).where('kind', '=', 'LOCAL_SERVER').where('status', '=', 'ACTIVE').executeTakeFirst(),
  ]);

  const periods: PlatformStats['periods'] = [];
  for (const days of [7, 30]) {
    const since = now - days * DAY_MS;
    const [orders, payments, active] = await Promise.all([
      ctx.db
        .selectFrom('orders as o')
        .innerJoin('tenants as t', 't.id', 'o.tenant_id')
        .select((eb) => ['o.currency', eb.fn.countAll().as('n'), eb.fn.sum('o.total').as('total')])
        .where('t.is_demo', '=', 0)
        .where('o.created_at', '>=', since)
        // Même règle que les rapports : une commande compte une fois confirmée, jamais annulée.
        .where('o.status', 'not in', ['PENDING', 'CANCELLED'])
        .groupBy('o.currency')
        .execute(),
      ctx.db
        .selectFrom('payments as p')
        .innerJoin('locations as l', 'l.id', 'p.location_id')
        .innerJoin('tenants as t', 't.id', 'p.tenant_id')
        .select((eb) => ['l.currency', eb.fn.sum('p.amount').as('total')])
        .where('t.is_demo', '=', 0)
        .where('p.created_at', '>=', since)
        .where('p.status', '=', 'RECORDED')
        .groupBy('l.currency')
        .execute(),
      ctx.db
        .selectFrom('orders as o')
        .innerJoin('tenants as t', 't.id', 'o.tenant_id')
        .select((eb) => eb.fn.count('o.location_id').distinct().as('n'))
        .where('t.is_demo', '=', 0)
        .where('o.created_at', '>=', since)
        .where('o.status', 'not in', ['PENDING', 'CANCELLED'])
        .executeTakeFirst(),
    ]);
    const currencies = [...new Set([...orders.map((o) => o.currency), ...payments.map((p) => p.currency)])].sort();
    periods.push({
      days,
      activeLocations: n(active),
      currencies: currencies.map((currency) => {
        const o = orders.find((x) => x.currency === currency);
        const p = payments.find((x) => x.currency === currency);
        return { currency, orders: Number(o?.n ?? 0), revenue: Number(o?.total ?? 0), collected: Number(p?.total ?? 0) };
      }),
    });
  }

  const tenantCount = (pred: (r: (typeof tenantRows)[number]) => boolean) => tenantRows.filter(pred).reduce((t, r) => t + Number(r.n), 0);
  return {
    generatedAt: now,
    tenants: { total: tenantCount(() => true), active: tenantCount((r) => r.status === 'ACTIVE' && r.is_demo === 0), suspended: tenantCount((r) => r.status === 'SUSPENDED'), demo: tenantCount((r) => r.is_demo === 1) },
    locations: { active: n(activeLocations), hybrid: n(hybridLocations) },
    users: { active: n(users) },
    localServers: { active: n(localServers) },
    periods,
  };
}
