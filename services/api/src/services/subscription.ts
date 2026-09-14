import {
  AppError,
  PLANS,
  RESOURCE_LABELS,
  extendExpiry,
  planOf,
  subscriptionState,
  type LimitedResource,
  type SetSubscriptionInput,
  type Subscription,
} from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { AuthState } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';

type Db = AppContext['db'];

async function count(db: Db, query: 'locations' | 'members' | 'localServers', tenantId: string): Promise<number> {
  const row =
    query === 'locations'
      ? await db.selectFrom('locations').select((eb) => eb.fn.countAll().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'ACTIVE').executeTakeFirst()
      : query === 'members'
        ? await db.selectFrom('memberships').select((eb) => eb.fn.countAll().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'ACTIVE').executeTakeFirst()
        : await db
            .selectFrom('devices')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('tenant_id', '=', tenantId)
            .where('kind', '=', 'LOCAL_SERVER')
            .where('status', '=', 'ACTIVE')
            .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function getSubscription(ctx: AppContext, tenantId: string, db: Db = ctx.db): Promise<Subscription> {
  const t = await db.selectFrom('tenants').select(['plan', 'plan_expires_at']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  const def = planOf(t.plan);
  const { state, daysLeft } = subscriptionState(t.plan, t.plan_expires_at, ctx.now());
  return {
    plan: def.code,
    label: def.label,
    state,
    expiresAt: t.plan_expires_at,
    daysLeft,
    monthlyPrice: def.monthlyPrice,
    limits: def.limits,
    usage: { locations: await count(db, 'locations', tenantId), members: await count(db, 'members', tenantId), localServers: await count(db, 'localServers', tenantId) },
  };
}

/**
 * Refuse d'ajouter un établissement, un membre ou un serveur local au-delà de l'offre, ou quand
 * l'abonnement est échu. Le serveur local ne contrôle rien : il doit fonctionner sans Internet.
 */
export async function assertCanGrow(ctx: AppContext, db: Db, tenantId: string, resource: LimitedResource): Promise<void> {
  if (ctx.config.profile === 'local') return;
  const sub = await getSubscription(ctx, tenantId, db);
  if (sub.state === 'EXPIRED') {
    throw new AppError('PLAN_LIMIT', "Votre abonnement AfriKaisse est échu : le service continue, mais l'ajout est bloqué jusqu'au renouvellement.", { resource, state: sub.state });
  }
  const limit = sub.limits[resource];
  if (limit !== null && sub.usage[resource] >= limit) {
    throw new AppError('PLAN_LIMIT', `Limite de l'offre ${sub.label} atteinte : ${RESOURCE_LABELS[resource].toLowerCase()} ${sub.usage[resource]} sur ${limit}. Passez à l'offre supérieure.`, {
      resource,
      limit,
      used: sub.usage[resource],
    });
  }
}

export async function setSubscription(ctx: AppContext, admin: AuthState, tenantId: string, input: SetSubscriptionInput, meta: RequestMeta): Promise<Subscription> {
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('tenants').select(['plan', 'plan_expires_at']).where('id', '=', tenantId).executeTakeFirst();
    if (!current) throw new AppError('NOT_FOUND', 'Organisation introuvable.');
    const expiresAt = input.unlimited ? null : input.months > 0 ? extendExpiry(current.plan_expires_at, input.months, now) : current.plan_expires_at;
    const hlc = ctx.clock.now();
    await trx.updateTable('tenants').set({ plan: PLANS[input.plan].code, plan_expires_at: expiresAt, updated_at: now, updated_hlc: hlc }).where('id', '=', tenantId).execute();
    const row = await trx.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId, entityType: 'tenant', entityId: tenantId, operation: 'UPSERT', payload: row, hlc });
    await writeAudit(trx, ctx, {
      tenantId,
      actorUserId: admin.userId,
      action: 'platform.subscription_changed',
      entityType: 'tenant',
      entityId: tenantId,
      data: { before: { plan: current.plan, expiresAt: current.plan_expires_at }, after: { plan: input.plan, expiresAt }, months: input.months },
      meta,
    });
  });
  return getSubscription(ctx, tenantId);
}
