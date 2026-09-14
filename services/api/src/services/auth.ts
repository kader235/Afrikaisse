import { AppError, ROLE_PERMISSIONS, uuidv7, type LoginInput, type Me, type RegisterInput } from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import { resolveSession, type AuthState } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';
import { hashPassword, verifyPassword } from '../lib/passwords.ts';
import { generateRefreshToken, hashToken, signAccessToken } from '../lib/tokens.ts';
import { createDefaultStations } from './kitchen.ts';

export interface IssuedSession {
  userId: string;
  sessionId: string;
  refreshToken: string | undefined;
}

/**
 * Deux onglets qui renouvellent en même temps présentent le même jeton : le
 * second ne doit pas être pris pour un vol. Au-delà de ce délai, une
 * réutilisation révoque toute la session.
 */
const REFRESH_REUSE_GRACE_MS = 10_000;

export async function register(ctx: AppContext, input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
  if (ctx.config.profile === 'local') {
    const configured = await ctx.db.selectFrom('tenants').select('id').limit(1).executeTakeFirst();
    if (configured) {
      throw new AppError('FORBIDDEN', 'Ce serveur local est déjà configuré pour un restaurant.');
    }
  }
  const taken = await ctx.db.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
  if (taken) {
    throw new AppError('CONFLICT', 'Un compte existe déjà avec cette adresse e-mail. Connectez-vous.');
  }

  const passwordHash = await hashPassword(input.password);
  const now = ctx.now();
  const tenantId = uuidv7();
  const locationId = uuidv7();
  const userId = uuidv7();
  const membershipId = uuidv7();

  try {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      const stamp = { created_at: now, updated_at: now, updated_hlc: hlc };

      const tenant = { id: tenantId, name: input.organizationName, status: 'ACTIVE', is_demo: 0, plan: 'STARTER', ...stamp } as const;
      await trx.insertInto('tenants').values(tenant).execute();
      await recordChange(trx, ctx, { tenantId, entityType: 'tenant', entityId: tenantId, operation: 'UPSERT', payload: tenant, hlc });

      const location = {
        id: locationId,
        tenant_id: tenantId,
        name: input.locationName,
        type: input.locationType,
        currency: input.currency,
        timezone: input.timezone,
        country: input.country,
        business_day_cutoff_min: 300,
        // Un serveur local exploite toujours son établissement lui-même.
        operating_mode: ctx.config.profile === 'local' ? 'HYBRID' : 'CLOUD',
        address: null,
        phone: null,
        status: 'ACTIVE',
        ...stamp,
      } as const;
      await trx.insertInto('locations').values(location).execute();
      await recordChange(trx, ctx, { tenantId, locationId, entityType: 'location', entityId: locationId, operation: 'UPSERT', payload: location, hlc });
      await createDefaultStations(trx, ctx, tenantId, locationId, hlc);

      const user = {
        id: userId,
        email: input.email,
        display_name: input.ownerName,
        password_hash: passwordHash,
        pin_hash: null,
        is_platform_admin: 0,
        status: 'ACTIVE',
        ...stamp,
      } as const;
      await trx.insertInto('users').values(user).execute();
      await recordChange(trx, ctx, { tenantId, entityType: 'user', entityId: userId, operation: 'UPSERT', payload: user, hlc });

      const membership = { id: membershipId, tenant_id: tenantId, user_id: userId, role: 'OWNER', location_id: null, status: 'ACTIVE', ...stamp } as const;
      await trx.insertInto('memberships').values(membership).execute();
      await recordChange(trx, ctx, { tenantId, entityType: 'membership', entityId: membershipId, operation: 'UPSERT', payload: membership, hlc });

      await writeAudit(trx, ctx, {
        tenantId,
        locationId,
        actorUserId: userId,
        action: 'tenant.registered',
        subject: input.email,
        entityType: 'tenant',
        entityId: tenantId,
        data: { organizationName: input.organizationName, locationName: input.locationName, currency: input.currency },
        meta,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'Un compte existe déjà avec cette adresse e-mail. Connectez-vous.');
    }
    throw err;
  }

  return createSession(ctx, userId, tenantId, meta);
}

async function assertNotLockedOut(ctx: AppContext, email: string): Promise<void> {
  const since = ctx.now() - ctx.config.loginWindowSec * 1000;
  const recent = await ctx.db
    .selectFrom('audit_logs')
    .select('action')
    .where('subject', '=', email)
    .where('action', 'in', ['auth.login', 'auth.login_failed'])
    .where('created_at', '>=', since)
    .orderBy('created_at', 'desc')
    .limit(ctx.config.loginMaxFailures)
    .execute();
  // Échecs consécutifs depuis la dernière connexion réussie.
  const failures = recent.findIndex((r) => r.action === 'auth.login');
  const consecutive = failures === -1 ? recent.length : failures;
  if (consecutive >= ctx.config.loginMaxFailures) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Trop de tentatives. Réessayez dans 15 minutes.');
  }
}

export async function login(ctx: AppContext, input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
  await assertNotLockedOut(ctx, input.email);

  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'password_hash', 'status', 'is_platform_admin'])
    .where('email', '=', input.email)
    .executeTakeFirst();
  const valid = await verifyPassword(input.password, user?.password_hash ?? null);
  if (!user || !valid) {
    await writeAudit(ctx.db, ctx, { action: 'auth.login_failed', subject: input.email, actorUserId: user?.id ?? null, meta });
    throw new AppError('INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect.');
  }
  if (user.status !== 'ACTIVE') {
    throw new AppError('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
  }

  const memberships = await ctx.db
    .selectFrom('memberships as m')
    .innerJoin('tenants as t', 't.id', 'm.tenant_id')
    .select(['m.tenant_id', 'm.status', 't.status as tenant_status'])
    .where('m.user_id', '=', user.id)
    .execute();

  let tenantId: string | null = null;
  if (input.tenantId) {
    if (!memberships.some((m) => m.tenant_id === input.tenantId)) {
      throw new AppError('FORBIDDEN', "Vous n'appartenez pas à cette organisation.");
    }
    tenantId = input.tenantId;
  } else if (memberships.length === 1) {
    // Même inactive : l'écran expliquera pourquoi (suspension, accès désactivé).
    tenantId = memberships[0]!.tenant_id;
  } else {
    const usable = memberships.filter((m) => m.status === 'ACTIVE' && m.tenant_status === 'ACTIVE');
    if (usable.length === 1) tenantId = usable[0]!.tenant_id;
  }
  if (memberships.length === 0 && user.is_platform_admin !== 1) {
    throw new AppError('FORBIDDEN', "Ce compte n'est rattaché à aucune organisation.");
  }

  await writeAudit(ctx.db, ctx, { tenantId, actorUserId: user.id, action: 'auth.login', subject: input.email, meta });
  return createSession(ctx, user.id, tenantId, meta);
}

async function createSession(ctx: AppContext, userId: string, tenantId: string | null, meta: RequestMeta): Promise<IssuedSession> {
  const now = ctx.now();
  const sessionId = uuidv7();
  const refreshToken = generateRefreshToken();
  const expiresAt = now + ctx.config.sessionTtlSec * 1000;
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('auth_sessions')
      .values({
        id: sessionId,
        user_id: userId,
        tenant_id: tenantId,
        user_agent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip,
        created_at: now,
        last_used_at: now,
        expires_at: expiresAt,
        revoked_at: null,
        revoke_reason: null,
      })
      .execute();
    await trx
      .insertInto('refresh_tokens')
      .values({ id: uuidv7(), session_id: sessionId, token_hash: hashToken(refreshToken), created_at: now, expires_at: expiresAt, used_at: null })
      .execute();
  });
  return { userId, sessionId, refreshToken };
}

export async function refresh(ctx: AppContext, token: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
  const invalid = new AppError('TOKEN_INVALID', 'Session expirée. Reconnectez-vous.');
  if (!token) throw invalid;
  const now = ctx.now();
  const row = await ctx.db
    .selectFrom('refresh_tokens as rt')
    .innerJoin('auth_sessions as s', 's.id', 'rt.session_id')
    .select(['rt.id', 'rt.used_at', 'rt.expires_at', 's.id as session_id', 's.user_id', 's.tenant_id', 's.revoked_at', 's.expires_at as session_expires_at'])
    .where('rt.token_hash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) throw invalid;

  if (row.used_at !== null) {
    if (now - row.used_at > REFRESH_REUSE_GRACE_MS && row.revoked_at === null) {
      await revokeSession(ctx.db, ctx, row.session_id, 'refresh_reuse');
      await writeAudit(ctx.db, ctx, { tenantId: row.tenant_id, actorUserId: row.user_id, action: 'auth.refresh_reuse', entityType: 'session', entityId: row.session_id, meta });
    }
    throw invalid;
  }
  if (row.revoked_at !== null || row.session_expires_at <= now || row.expires_at <= now) throw invalid;

  const next = generateRefreshToken();
  const rotated = await ctx.db.transaction().execute(async (trx) => {
    const used = await trx.updateTable('refresh_tokens').set({ used_at: now }).where('id', '=', row.id).where('used_at', 'is', null).executeTakeFirst();
    if (Number(used.numUpdatedRows) !== 1) return false;
    await trx
      .insertInto('refresh_tokens')
      .values({ id: uuidv7(), session_id: row.session_id, token_hash: hashToken(next), created_at: now, expires_at: row.session_expires_at, used_at: null })
      .execute();
    await trx.updateTable('auth_sessions').set({ last_used_at: now }).where('id', '=', row.session_id).execute();
    return true;
  });
  if (!rotated) throw invalid;
  return { userId: row.user_id, sessionId: row.session_id, refreshToken: next };
}

export async function revokeSession(db: Db, ctx: AppContext, sessionId: string, reason: string): Promise<void> {
  await db.updateTable('auth_sessions').set({ revoked_at: ctx.now(), revoke_reason: reason }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
}

export async function revokeUserSessions(db: Db, ctx: AppContext, userId: string, reason: string, tenantId?: string): Promise<void> {
  let q = db.updateTable('auth_sessions').set({ revoked_at: ctx.now(), revoke_reason: reason }).where('user_id', '=', userId).where('revoked_at', 'is', null);
  if (tenantId) q = q.where('tenant_id', '=', tenantId);
  await q.execute();
}

export async function switchTenant(ctx: AppContext, auth: AuthState, tenantId: string, meta: RequestMeta): Promise<IssuedSession> {
  const membership = await ctx.db.selectFrom('memberships').select('id').where('user_id', '=', auth.userId).where('tenant_id', '=', tenantId).executeTakeFirst();
  if (!membership) {
    throw new AppError('FORBIDDEN', "Vous n'appartenez pas à cette organisation.");
  }
  await ctx.db.updateTable('auth_sessions').set({ tenant_id: tenantId, last_used_at: ctx.now() }).where('id', '=', auth.sessionId).execute();
  await writeAudit(ctx.db, ctx, { tenantId, actorUserId: auth.userId, action: 'auth.switch_tenant', meta });
  return { userId: auth.userId, sessionId: auth.sessionId, refreshToken: undefined };
}

export async function changeOwnPassword(ctx: AppContext, auth: AuthState, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const user = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', auth.userId).executeTakeFirstOrThrow();
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    await writeAudit(ctx.db, ctx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.password_change_failed', meta });
    throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
  }
  const hash = await hashPassword(newPassword);
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('users').set({ password_hash: hash, updated_at: now, updated_hlc: hlc }).where('id', '=', auth.userId).execute();
    const row = await trx.selectFrom('users').selectAll().where('id', '=', auth.userId).executeTakeFirstOrThrow();
    // Un compte peut appartenir à plusieurs organisations : chacune doit recevoir le changement.
    const tenants = await trx.selectFrom('memberships').select('tenant_id').where('user_id', '=', auth.userId).execute();
    for (const { tenant_id } of tenants) {
      await recordChange(trx, ctx, { tenantId: tenant_id, entityType: 'user', entityId: auth.userId, operation: 'UPSERT', payload: row, hlc });
    }
    // Les autres appareils sont déconnectés ; celui qui change le mot de passe reste connecté.
    await trx
      .updateTable('auth_sessions')
      .set({ revoked_at: now, revoke_reason: 'password_changed' })
      .where('user_id', '=', auth.userId)
      .where('id', '!=', auth.sessionId)
      .where('revoked_at', 'is', null)
      .execute();
    await writeAudit(trx, ctx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.password_changed', meta });
  });
}

export async function loadMe(ctx: AppContext, auth: AuthState): Promise<Me> {
  const memberships = await ctx.db
    .selectFrom('memberships as m')
    .innerJoin('tenants as t', 't.id', 'm.tenant_id')
    .select(['m.id', 'm.tenant_id', 't.name', 't.status as tenant_status', 'm.role', 'm.status', 'm.location_id'])
    .where('m.user_id', '=', auth.userId)
    .orderBy('t.name')
    .execute();

  let locations: Me['locations'] = [];
  if (auth.tenantAccess === 'OK' && auth.tenantId) {
    let q = ctx.db
      .selectFrom('locations')
      .select(['id', 'name', 'type', 'currency', 'timezone', 'country'])
      .where('tenant_id', '=', auth.tenantId)
      .where('status', '=', 'ACTIVE');
    if (auth.locationId) q = q.where('id', '=', auth.locationId);
    locations = await q.orderBy('name').execute();
  }

  return {
    user: { id: auth.userId, email: auth.email, displayName: auth.displayName, isPlatformAdmin: auth.isPlatformAdmin },
    tenant:
      auth.tenantId && auth.tenantName && auth.tenantStatus
        ? { id: auth.tenantId, name: auth.tenantName, status: auth.tenantStatus, isDemo: auth.tenantIsDemo, plan: auth.tenantPlan ?? 'STARTER' }
        : null,
    tenantAccess: auth.tenantAccess,
    role: auth.role,
    permissions: auth.tenantAccess === 'OK' && auth.role ? [...ROLE_PERMISSIONS[auth.role]] : [],
    locationId: auth.locationId,
    locations,
    memberships: memberships.map((m) => ({
      membershipId: m.id,
      tenantId: m.tenant_id,
      tenantName: m.name,
      tenantStatus: m.tenant_status,
      role: m.role,
      status: m.status,
      locationId: m.location_id,
    })),
  };
}

export async function sessionPayload(ctx: AppContext, issued: IssuedSession) {
  const auth = await resolveSession(ctx, issued.userId, issued.sessionId);
  const access = await signAccessToken(ctx, issued.userId, issued.sessionId);
  return { accessToken: access.token, expiresAt: access.expiresAt, me: await loadMe(ctx, auth) };
}
