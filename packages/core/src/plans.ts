import { z } from 'zod';

/**
 * Offres AfriKaisse Cloud (phase 17). Le règlement se fait hors ligne (mobile money, virement) :
 * GLOBALTECH BUSINESS TD enregistre l'offre et l'échéance depuis le back-office.
 * Règle cardinale : un abonnement échu n'arrête JAMAIS le service en cours (caisse, cuisine,
 * commandes, synchronisation). Il bloque seulement la croissance : nouvel établissement,
 * nouveau membre, nouveau serveur local.
 */
export const PLAN_CODES = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const LIMITED_RESOURCES = ['locations', 'members', 'localServers'] as const;
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];

/** null = illimité. */
export type PlanLimits = Record<LimitedResource, number | null>;

export interface PlanDefinition {
  code: PlanCode;
  label: string;
  /** Prix mensuel en FCFA ; null = sur devis. */
  monthlyPrice: number | null;
  limits: PlanLimits;
  summary: string;
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  TRIAL: { code: 'TRIAL', label: 'Essai gratuit', monthlyPrice: 0, limits: { locations: 3, members: 25, localServers: 1 }, summary: '30 jours, toutes les fonctions' },
  STARTER: { code: 'STARTER', label: 'Essentiel', monthlyPrice: 15000, limits: { locations: 1, members: 8, localServers: 1 }, summary: 'Un restaurant, caisse, cuisine, QR, stock' },
  PRO: { code: 'PRO', label: 'Pro', monthlyPrice: 35000, limits: { locations: 3, members: 30, localServers: 3 }, summary: "Jusqu'à trois établissements" },
  ENTERPRISE: { code: 'ENTERPRISE', label: 'Groupe', monthlyPrice: null, limits: { locations: null, members: null, localServers: null }, summary: 'Chaînes et franchises, sans limite' },
};

export const RESOURCE_LABELS: Record<LimitedResource, string> = {
  locations: 'Établissements',
  members: "Membres de l'équipe",
  localServers: 'Serveurs locaux reliés',
};

export const DAY_MS = 24 * 3600 * 1000;
export const TRIAL_DAYS = 30;
/** Après l'échéance, tout reste permis pendant ce délai (le temps de régler). */
export const GRACE_DAYS = 7;
/** Une « mensualité » du back-office. */
export const MONTH_DAYS = 30;

export const planOf = (code: string): PlanDefinition => PLANS[code as PlanCode] ?? PLANS.STARTER;

export const SUBSCRIPTION_STATES = ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionState, string> = {
  TRIAL: 'Essai en cours',
  ACTIVE: 'Actif',
  GRACE: 'Échu — délai de grâce',
  EXPIRED: 'Échu',
};

/** État d'un abonnement à l'instant `now`. `daysLeft` est négatif une fois l'échéance passée. */
export function subscriptionState(plan: string, expiresAt: number | null, now: number): { state: SubscriptionState; daysLeft: number | null } {
  if (expiresAt === null) return { state: 'ACTIVE', daysLeft: null };
  const daysLeft = Math.ceil((expiresAt - now) / DAY_MS);
  if (now < expiresAt) return { state: plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE', daysLeft };
  if (now < expiresAt + GRACE_DAYS * DAY_MS) return { state: 'GRACE', daysLeft };
  return { state: 'EXPIRED', daysLeft };
}

/** Nouvelle échéance : les mois achetés s'ajoutent à ce qui reste, jamais à une date passée. */
export function extendExpiry(current: number | null, months: number, now: number): number {
  return Math.max(now, current ?? now) + months * MONTH_DAYS * DAY_MS;
}

const limitsSchema = z.object({ locations: z.number().nullable(), members: z.number().nullable(), localServers: z.number().nullable() });

export const subscriptionSchema = z.object({
  plan: z.string(),
  label: z.string(),
  state: z.enum(SUBSCRIPTION_STATES),
  expiresAt: z.number().nullable(),
  daysLeft: z.number().nullable(),
  monthlyPrice: z.number().nullable(),
  limits: limitsSchema,
  usage: z.object({ locations: z.number(), members: z.number(), localServers: z.number() }),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const setSubscriptionSchema = z.object({
  plan: z.enum(PLAN_CODES),
  /** Mois ajoutés à l'échéance (0 = changer d'offre sans prolonger). */
  months: z.number().int().min(0).max(36),
  /** Sans échéance (contrat Groupe, partenaire). */
  unlimited: z.boolean().default(false),
});
export type SetSubscriptionInput = z.infer<typeof setSubscriptionSchema>;
