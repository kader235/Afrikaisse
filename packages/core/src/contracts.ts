import { z } from 'zod';
import { CURRENCY_CODES, LOCATION_TYPES } from './currency.ts';
import { PERMISSIONS, ROLES } from './roles.ts';
import { MEMBERSHIP_STATUSES, TENANT_STATUSES } from './schemas.ts';

/** Réponses de l'API : servent à la sérialisation, à l'OpenAPI et au typage des clients. */
export const locationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  currency: z.enum(CURRENCY_CODES),
  timezone: z.string(),
  country: z.string(),
});

export const membershipSummarySchema = z.object({
  membershipId: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  tenantStatus: z.enum(TENANT_STATUSES),
  role: z.enum(ROLES),
  status: z.enum(MEMBERSHIP_STATUSES),
  locationId: z.string().nullable(),
});

export const TENANT_ACCESS = ['OK', 'SUSPENDED', 'DISABLED', 'REVOKED', 'NONE'] as const;
export type TenantAccess = (typeof TENANT_ACCESS)[number];

export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    displayName: z.string(),
    isPlatformAdmin: z.boolean(),
  }),
  tenant: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(TENANT_STATUSES),
      isDemo: z.boolean(),
      plan: z.string(),
    })
    .nullable(),
  tenantAccess: z.enum(TENANT_ACCESS),
  role: z.enum(ROLES).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
  locationId: z.string().nullable(),
  locations: z.array(locationSummarySchema),
  memberships: z.array(membershipSummarySchema),
});
export type Me = z.infer<typeof meSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number(),
  refreshToken: z.string().optional(),
  me: meSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const memberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: z.enum(ROLES),
  locationId: z.string().nullable(),
  status: z.enum(MEMBERSHIP_STATUSES),
  createdAt: z.number(),
  /** Compte rattaché à une autre organisation : son mot de passe n'est pas gérable ici. */
  sharedAccount: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;

export const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  subject: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  data: z.unknown(),
  ip: z.string().nullable(),
  createdAt: z.number(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const tenantDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  plan: z.string(),
  isDemo: z.boolean(),
  createdAt: z.number(),
  locations: z.array(locationSummarySchema),
});

export const platformTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  plan: z.string(),
  isDemo: z.boolean(),
  createdAt: z.number(),
  members: z.number(),
  locations: z.number(),
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
