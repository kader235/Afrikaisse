import { assertCanGrow } from './subscription.ts';
import {
  AppError,
  canManageRole,
  uuidv7,
  type CreateMemberInput,
  type Member,
  type UpdateMemberInput,
} from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';
import { hashPassword } from '../lib/passwords.ts';
import { revokeUserSessions } from './auth.ts';

/**
 * Équipe d'une organisation. TOUTES les requêtes filtrent sur scope.tenantId :
 * un identifiant d'une autre organisation répond « introuvable », jamais « interdit »,
 * pour ne rien révéler de son existence.
 */
function memberQuery(db: Db, tenantId: string) {
  return db
    .selectFrom('memberships as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select((eb) => [
      'm.id as membershipId',
      'm.user_id as userId',
      'u.display_name as displayName',
      'u.email',
      'm.role',
      'm.location_id as locationId',
      'm.status',
      'm.created_at as createdAt',
      eb
        .selectFrom('memberships as other')
        .select((e2) => e2.fn.countAll().as('n'))
        .whereRef('other.user_id', '=', 'm.user_id')
        .where('other.tenant_id', '!=', tenantId)
        .as('otherTenants'),
      'u.is_platform_admin',
    ])
    .where('m.tenant_id', '=', tenantId);
}

type MemberRow = Awaited<ReturnType<ReturnType<typeof memberQuery>['executeTakeFirstOrThrow']>>;

function toMember(r: MemberRow): Member {
  return {
    membershipId: r.membershipId,
    userId: r.userId,
    displayName: r.displayName,
    email: r.email,
    role: r.role,
    locationId: r.locationId,
    status: r.status,
    createdAt: r.createdAt,
    sharedAccount: Number(r.otherTenants) > 0 || r.is_platform_admin === 1,
  };
}

export async function listMembers(ctx: AppContext, scope: TenantScope): Promise<Member[]> {
  const rows = await memberQuery(ctx.db, scope.tenantId).orderBy('u.display_name').execute();
  return rows.map(toMember);
}

async function getMember(db: Db, scope: TenantScope, membershipId: string): Promise<Member> {
  const row = await memberQuery(db, scope.tenantId).where('m.id', '=', membershipId).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND', 'Membre introuvable.');
  return toMember(row);
}

async function assertLocationInTenant(db: Db, tenantId: string, locationId: string | null | undefined) {
  if (!locationId) return;
  const loc = await db.selectFrom('locations').select('id').where('id', '=', locationId).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!loc) throw new AppError('NOT_FOUND', 'Établissement introuvable.');
}

export async function addMember(ctx: AppContext, scope: TenantScope, input: CreateMemberInput, meta: RequestMeta): Promise<Member> {
  if (!canManageRole(scope.role, input.role)) {
    throw new AppError('FORBIDDEN', 'Vous ne pouvez pas attribuer ce rôle.');
  }
  await assertLocationInTenant(ctx.db, scope.tenantId, input.locationId);

  const existing = await ctx.db.selectFrom('users').select(['id']).where('email', '=', input.email).executeTakeFirst();
  if (existing) {
    const already = await ctx.db.selectFrom('memberships').select('id').where('tenant_id', '=', scope.tenantId).where('user_id', '=', existing.id).executeTakeFirst();
    if (already) throw new AppError('CONFLICT', "Cette personne fait déjà partie de l'équipe.");
  } else if (!input.password) {
    throw new AppError('VALIDATION', 'Un mot de passe est requis pour créer ce compte.');
  }

  await assertCanGrow(ctx, ctx.db, scope.tenantId, 'members');
  const passwordHash = existing ? null : await hashPassword(input.password!);
  const now = ctx.now();
  const membershipId = uuidv7();
  const userId = existing?.id ?? uuidv7();

  try {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      const stamp = { created_at: now, updated_at: now, updated_hlc: hlc };
      if (!existing) {
        const user = {
          id: userId,
          email: input.email,
          display_name: input.displayName,
          password_hash: passwordHash,
          pin_hash: null,
          is_platform_admin: 0,
          status: 'ACTIVE',
          ...stamp,
        } as const;
        await trx.insertInto('users').values(user).execute();
        await recordChange(trx, ctx, { tenantId: scope.tenantId, entityType: 'user', entityId: userId, operation: 'UPSERT', payload: user, hlc });
      }
      const membership = {
        id: membershipId,
        tenant_id: scope.tenantId,
        user_id: userId,
        role: input.role,
        location_id: input.locationId,
        status: 'ACTIVE',
        ...stamp,
      } as const;
      await trx.insertInto('memberships').values(membership).execute();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: input.locationId, entityType: 'membership', entityId: membershipId, operation: 'UPSERT', payload: membership, hlc });
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        action: 'team.member_added',
        entityType: 'membership',
        entityId: membershipId,
        data: { role: input.role, locationId: input.locationId, existingAccount: Boolean(existing) },
        meta,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', "Cette personne fait déjà partie de l'équipe.");
    throw err;
  }
  return getMember(ctx.db, scope, membershipId);
}

export async function updateMember(ctx: AppContext, scope: TenantScope, membershipId: string, input: UpdateMemberInput, meta: RequestMeta): Promise<Member> {
  const target = await getMember(ctx.db, scope, membershipId);
  const changesAccess = input.role !== undefined || input.status !== undefined || input.locationId !== undefined;

  if (target.userId === scope.userId && changesAccess) {
    throw new AppError('FORBIDDEN', 'Vous ne pouvez pas modifier votre propre accès.');
  }
  if (!canManageRole(scope.role, target.role)) {
    throw new AppError('FORBIDDEN', 'Vous ne pouvez pas modifier ce membre.');
  }
  if (input.role && !canManageRole(scope.role, input.role)) {
    throw new AppError('FORBIDDEN', 'Vous ne pouvez pas attribuer ce rôle.');
  }
  if (input.displayName !== undefined && target.sharedAccount) {
    throw new AppError('FORBIDDEN', 'Ce compte est partagé avec une autre organisation : seul son titulaire peut le modifier.');
  }
  await assertLocationInTenant(ctx.db, scope.tenantId, input.locationId);

  const losesOwner = target.role === 'OWNER' && target.status === 'ACTIVE' && ((input.role && input.role !== 'OWNER') || input.status === 'DISABLED');
  if (losesOwner) {
    const owners = await ctx.db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('tenant_id', '=', scope.tenantId)
      .where('role', '=', 'OWNER')
      .where('status', '=', 'ACTIVE')
      .where('id', '!=', membershipId)
      .executeTakeFirstOrThrow();
    if (Number(owners.n) === 0) {
      throw new AppError('CONFLICT', "L'organisation doit garder au moins un propriétaire actif.");
    }
  }

  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    if (changesAccess) {
      const patch = {
        ...(input.role !== undefined && { role: input.role }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.locationId !== undefined && { location_id: input.locationId }),
        updated_at: now,
        updated_hlc: hlc,
      };
      await trx.updateTable('memberships').set(patch).where('id', '=', membershipId).where('tenant_id', '=', scope.tenantId).execute();
      const row = await trx.selectFrom('memberships').selectAll().where('id', '=', membershipId).executeTakeFirstOrThrow();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, entityType: 'membership', entityId: membershipId, operation: 'UPSERT', payload: row, hlc });
    }
    if (input.displayName !== undefined) {
      await trx.updateTable('users').set({ display_name: input.displayName, updated_at: now, updated_hlc: hlc }).where('id', '=', target.userId).execute();
      const user = await trx.selectFrom('users').selectAll().where('id', '=', target.userId).executeTakeFirstOrThrow();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, entityType: 'user', entityId: target.userId, operation: 'UPSERT', payload: user, hlc });
    }
    if (input.status === 'DISABLED') {
      await revokeUserSessions(trx, ctx, target.userId, 'membership_disabled', scope.tenantId);
    }
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: 'team.member_updated',
      entityType: 'membership',
      entityId: membershipId,
      data: {
        before: { role: target.role, status: target.status, locationId: target.locationId, displayName: target.displayName },
        after: input,
      },
      meta,
    });
  });
  return getMember(ctx.db, scope, membershipId);
}

export async function resetMemberPassword(ctx: AppContext, scope: TenantScope, membershipId: string, password: string, meta: RequestMeta): Promise<void> {
  const target = await getMember(ctx.db, scope, membershipId);
  if (target.userId === scope.userId) {
    throw new AppError('FORBIDDEN', 'Changez votre propre mot de passe depuis votre profil.');
  }
  if (!canManageRole(scope.role, target.role)) {
    throw new AppError('FORBIDDEN', 'Vous ne pouvez pas modifier ce membre.');
  }
  // Sans cette règle, une organisation pourrait rattacher le compte d'une autre
  // puis lui changer son mot de passe : prise de contrôle entre tenants.
  if (target.sharedAccount) {
    throw new AppError('FORBIDDEN', 'Ce compte est partagé avec une autre organisation : seul son titulaire peut changer son mot de passe.');
  }
  const hash = await hashPassword(password);
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('users').set({ password_hash: hash, updated_at: now, updated_hlc: hlc }).where('id', '=', target.userId).execute();
    const user = await trx.selectFrom('users').selectAll().where('id', '=', target.userId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, entityType: 'user', entityId: target.userId, operation: 'UPSERT', payload: user, hlc });
    await revokeUserSessions(trx, ctx, target.userId, 'password_reset');
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: 'team.password_reset',
      entityType: 'membership',
      entityId: membershipId,
      meta,
    });
  });
}
