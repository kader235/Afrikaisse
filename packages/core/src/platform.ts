import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { OPERATING_MODES } from './floor.ts';
import { SUBSCRIPTION_STATES } from './plans.ts';
import { ROLES } from './roles.ts';

/** Back-office GLOBALTECH BUSINESS TD (§67) : lecture transverse, réservée à `is_platform_admin`. */

export const platformRestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  plan: z.string(),
  planExpiresAt: z.number().nullable(),
  subscriptionState: z.enum(SUBSCRIPTION_STATES),
  isDemo: z.boolean(),
  createdAt: z.number(),
  members: z.number(),
  lastActivityAt: z.number().nullable(),
  locations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['ACTIVE', 'ARCHIVED']),
      operatingMode: z.enum(OPERATING_MODES),
      currency: z.string(),
      country: z.string(),
      createdAt: z.number(),
      lastActivityAt: z.number().nullable(),
    }),
  ),
});
export type PlatformRestaurant = z.infer<typeof platformRestaurantSchema>;

export const platformUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  isPlatformAdmin: z.boolean(),
  createdAt: z.number(),
  lastSeenAt: z.number().nullable(),
  memberships: z.array(z.object({ tenantId: z.string(), tenantName: z.string(), role: z.enum(ROLES), status: z.enum(['ACTIVE', 'DISABLED']) })),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export const platformDeviceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: z.number().nullable(),
  createdAt: z.number(),
});
export type PlatformDevice = z.infer<typeof platformDeviceSchema>;

export const platformSyncStateSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  tenantName: z.string().nullable(),
  locationName: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: z.number().nullable(),
  lastPushAt: z.number().nullable(),
  lastPullAt: z.number().nullable(),
  /** Compteurs annoncés par le serveur local à son dernier appel (null : version qui ne les envoie pas). */
  pending: z.number().nullable(),
  failed: z.number().nullable(),
  conflicts: z.number().nullable(),
  reportedAt: z.number().nullable(),
  /** Événements de ce serveur gardés en conflit par le Cloud. */
  cloudConflicts: z.number(),
});
export type PlatformSyncState = z.infer<typeof platformSyncStateSchema>;

export const errorLogEntrySchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  requestId: z.string().nullable(),
  method: z.string().nullable(),
  route: z.string().nullable(),
  status: z.number(),
  code: z.string(),
  message: z.string(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
});
export type ErrorLogEntry = z.infer<typeof errorLogEntrySchema>;

const periodSchema = z.object({
  days: z.number(),
  activeLocations: z.number(),
  currencies: z.array(z.object({ currency: z.enum(CURRENCY_CODES), orders: z.number(), revenue: z.number(), collected: z.number() })),
});

export const platformStatsSchema = z.object({
  generatedAt: z.number(),
  tenants: z.object({ total: z.number(), active: z.number(), suspended: z.number(), demo: z.number() }),
  locations: z.object({ active: z.number(), hybrid: z.number() }),
  users: z.object({ active: z.number() }),
  localServers: z.object({ active: z.number() }),
  periods: z.array(periodSchema),
});
export type PlatformStats = z.infer<typeof platformStatsSchema>;
