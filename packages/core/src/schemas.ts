import { z } from 'zod';
import { CURRENCY_CODES, LOCATION_TYPES } from './currency.ts';
import { ROLES } from './roles.ts';

/**
 * Contrats d'échange partagés par l'API, le Web, le mobile et le desktop.
 * Une seule définition : un champ ajouté ici est validé partout.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Adresse e-mail invalide' }).max(254));

export const passwordSchema = z
  .string()
  .min(10, 'Au moins 10 caractères')
  .max(200, 'Mot de passe trop long');

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  locationName: z.string().trim().min(2).max(120),
  locationType: z.enum(LOCATION_TYPES).default('RESTAURANT'),
  currency: z.enum(CURRENCY_CODES).default('XAF'),
  timezone: z.string().trim().min(3).max(64).default('Africa/Ndjamena'),
  country: z.string().trim().length(2).toUpperCase().default('TD'),
  ownerName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  tenantId: z.uuid().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
});

export const switchTenantSchema = z.object({ tenantId: z.uuid() });

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema.optional(),
  role: z.enum(ROLES),
  locationId: z.uuid().nullable().default(null),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    locationId: z.uuid().nullable().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    displayName: z.string().trim().min(2).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucune modification demandée' });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const updateTenantSchema = z.object({ name: z.string().trim().min(2).max(120) });

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
