import { getSubscription } from './subscription.ts';
import { AppError, type AuditEntry, type PlatformTenant } from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { AuthState, TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';

export async function getTenant(ctx: AppContext, scope: TenantScope) {
  const t = await ctx.db.selectFrom('tenants').selectAll().where('id', '=', scope.tenantId).executeTakeFirstOrThrow();
  let q = ctx.db
    .selectFrom('locations')
    .select(['id', 'name', 'type', 'currency', 'timezone', 'country'])
    .where('tenant_id', '=', scope.tenantId)
    .where('status', '=', 'ACTIVE');
  if (scope.locationId) q = q.where('id', '=', scope.locationId);
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    plan: t.plan,
    isDemo: t.is_demo === 1,
    createdAt: t.created_at,
    subscription: await getSubscription(ctx, scope.tenantId),
    locations: await q.orderBy('name').execute(),
  };
}

export async function renameTenant(ctx: AppContext, scope: TenantScope, name: string, meta: RequestMeta) {
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const before = await trx.selectFrom('tenants').select('name').where('id', '=', scope.tenantId).executeTakeFirstOrThrow();
    await trx.updateTable('tenants').set({ name, updated_at: now, updated_hlc: hlc }).where('id', '=', scope.tenantId).execute();
    const row = await trx.selectFrom('tenants').selectAll().where('id', '=', scope.tenantId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, entityType: 'tenant', entityId: scope.tenantId, operation: 'UPSERT', payload: row, hlc });
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: 'tenant.renamed',
      entityType: 'tenant',
      entityId: scope.tenantId,
      data: { before: before.name, after: name },
      meta,
    });
  });
  return getTenant(ctx, scope);
}

export async function listAudit(ctx: AppContext, scope: TenantScope, limit: number, before?: number): Promise<AuditEntry[]> {
  let q = ctx.db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .select(['a.id', 'a.action', 'a.actor_user_id', 'u.display_name', 'a.subject', 'a.entity_type', 'a.entity_id', 'a.data', 'a.ip', 'a.created_at'])
    .where('a.tenant_id', '=', scope.tenantId);
  if (before !== undefined) q = q.where('a.created_at', '<', before);
  const rows = await q.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc').limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorName: r.display_name,
    subject: r.subject,
    entityType: r.entity_type,
    entityId: r.entity_id,
    data: r.data ? JSON.parse(r.data) : null,
    ip: r.ip,
    createdAt: r.created_at,
  }));
}

// --- Back-office AfriKaisse (SUPER_ADMIN) -----------------------------------

export function requirePlatformAdmin(auth: AuthState | null): AuthState {
  // 404 et non 403 : l'existence du back-office n'est pas révélée.
  if (!auth?.isPlatformAdmin) throw new AppError('NOT_FOUND', 'Route introuvable.');
  return auth;
}

export async function listTenants(ctx: AppContext): Promise<PlatformTenant[]> {
  const rows = await ctx.db
    .selectFrom('tenants as t')
    .select((eb) => [
      't.id',
      't.name',
      't.status',
      't.plan',
      't.plan_expires_at',
      't.is_demo',
      't.created_at',
      eb.selectFrom('memberships as m').select((e) => e.fn.countAll().as('n')).whereRef('m.tenant_id', '=', 't.id').as('members'),
      eb.selectFrom('locations as l').select((e) => e.fn.countAll().as('n')).whereRef('l.tenant_id', '=', 't.id').as('locations'),
    ])
    .orderBy('t.created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    plan: r.plan,
    isDemo: r.is_demo === 1,
    createdAt: r.created_at,
    planExpiresAt: r.plan_expires_at,
    members: Number(r.members),
    locations: Number(r.locations),
  }));
}

export async function setTenantStatus(ctx: AppContext, admin: AuthState, tenantId: string, status: 'ACTIVE' | 'SUSPENDED', meta: RequestMeta) {
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('tenants').select('status').where('id', '=', tenantId).executeTakeFirst();
    if (!current) throw new AppError('NOT_FOUND', 'Organisation introuvable.');
    const hlc = ctx.clock.now();
    await trx.updateTable('tenants').set({ status, updated_at: now, updated_hlc: hlc }).where('id', '=', tenantId).execute();
    const row = await trx.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId, entityType: 'tenant', entityId: tenantId, operation: 'UPSERT', payload: row, hlc });
    await writeAudit(trx, ctx, {
      tenantId,
      actorUserId: admin.userId,
      action: status === 'SUSPENDED' ? 'platform.tenant_suspended' : 'platform.tenant_reactivated',
      entityType: 'tenant',
      entityId: tenantId,
      data: { before: current.status, after: status },
      meta,
    });
  });
}
