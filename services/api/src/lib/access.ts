import type { FastifyRequest } from 'fastify';
import { AppError, ROLE_PERMISSIONS, type Permission, type Role, type TenantAccess } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { verifyAccessToken } from './tokens.ts';

export interface AuthState {
  userId: string;
  sessionId: string;
  email: string | null;
  displayName: string;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  tenantName: string | null;
  tenantStatus: 'ACTIVE' | 'SUSPENDED' | null;
  tenantIsDemo: boolean;
  tenantPlan: string | null;
  tenantPlanExpiresAt: number | null;
  membershipId: string | null;
  role: Role | null;
  locationId: string | null;
  tenantAccess: TenantAccess;
}

/** Portée garantie d'une requête sur une organisation : toute requête métier en dérive. */
export interface TenantScope {
  userId: string;
  sessionId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  locationId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export async function resolveSession(ctx: AppContext, userId: string, sessionId: string): Promise<AuthState> {
  const row = await ctx.db
    .selectFrom('auth_sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 's.user_id').onRef('m.tenant_id', '=', 's.tenant_id'))
    .leftJoin('tenants as t', 't.id', 's.tenant_id')
    .select([
      's.revoked_at',
      's.expires_at',
      's.tenant_id',
      's.user_id',
      'u.email',
      'u.display_name',
      'u.status as user_status',
      'u.is_platform_admin',
      'm.id as membership_id',
      'm.role',
      'm.status as membership_status',
      'm.location_id',
      't.name as tenant_name',
      't.status as tenant_status',
      't.is_demo',
      't.plan',
      't.plan_expires_at',
    ])
    .where('s.id', '=', sessionId)
    .executeTakeFirst();

  if (!row || row.user_id !== userId || row.revoked_at !== null || row.expires_at <= ctx.now()) {
    throw new AppError('TOKEN_INVALID', 'Session expirée. Reconnectez-vous.');
  }
  if (row.user_status !== 'ACTIVE') {
    throw new AppError('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
  }

  let tenantAccess: TenantAccess = 'OK';
  if (!row.tenant_id) tenantAccess = 'NONE';
  else if (!row.membership_id) tenantAccess = 'REVOKED';
  else if (row.tenant_status === 'SUSPENDED') tenantAccess = 'SUSPENDED';
  else if (row.membership_status !== 'ACTIVE') tenantAccess = 'DISABLED';

  const hasMembership = tenantAccess !== 'NONE' && tenantAccess !== 'REVOKED';
  return {
    userId: row.user_id,
    sessionId,
    email: row.email,
    displayName: row.display_name,
    isPlatformAdmin: row.is_platform_admin === 1,
    tenantId: hasMembership ? row.tenant_id : null,
    tenantName: hasMembership ? row.tenant_name : null,
    tenantStatus: hasMembership ? row.tenant_status : null,
    tenantIsDemo: row.is_demo === 1,
    tenantPlan: hasMembership ? row.plan : null,
    tenantPlanExpiresAt: hasMembership ? (row.plan_expires_at ?? null) : null,
    membershipId: row.membership_id,
    role: hasMembership ? row.role : null,
    locationId: hasMembership ? row.location_id : null,
    tenantAccess,
  };
}

export async function authenticate(ctx: AppContext, request: FastifyRequest): Promise<AuthState> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHENTICATED', 'Connexion requise.');
  }
  const { userId, sessionId } = await verifyAccessToken(ctx, header.slice(7));
  return resolveSession(ctx, userId, sessionId);
}

/** preHandler Fastify : remplit request.auth ou refuse la requête. */
export function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest) => {
    request.auth = await authenticate(ctx, request);
  };
}

export function requireTenant(auth: AuthState | null, permission?: Permission): TenantScope {
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Connexion requise.');
  switch (auth.tenantAccess) {
    case 'NONE':
      throw new AppError('FORBIDDEN', 'Choisissez une organisation.');
    case 'REVOKED':
      throw new AppError('FORBIDDEN', "Vous n'avez plus accès à cette organisation.");
    case 'SUSPENDED':
      throw new AppError('TENANT_SUSPENDED', 'Cette organisation est suspendue. Contactez AfriKaisse.');
    case 'DISABLED':
      throw new AppError('ACCOUNT_DISABLED', 'Votre accès à cette organisation est désactivé.');
  }
  const role = auth.role!;
  if (permission && !ROLE_PERMISSIONS[role].includes(permission)) {
    throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas cette action.');
  }
  return {
    userId: auth.userId,
    sessionId: auth.sessionId,
    tenantId: auth.tenantId!,
    membershipId: auth.membershipId!,
    role,
    locationId: auth.locationId,
  };
}

export function requestMeta(request: FastifyRequest) {
  return { ip: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null };
}
