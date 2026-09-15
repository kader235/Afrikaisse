import { z } from 'zod';
import { isScheduled, type LocalMoment } from './promotions.ts';

/**
 * Annonces du menu client (le bandeau qui défile en haut du menu) : photo, titre, texte court,
 * bouton qui mène à une catégorie ou à un plat.
 *
 * Diffusion : publiée ou non, puis
 * - sa propre période (dates incluses, jours de la semaine, plage horaire qui peut passer minuit) ;
 * - ou celle d'une promotion liée : l'annonce s'affiche exactement quand la remise s'applique aux
 *   commandes (moteur des promotions), et disparaît quand la promotion est suspendue ou archivée.
 * Plusieurs annonces diffusées défilent, chacune pendant sa durée d'affichage.
 */

export const ANNOUNCEMENT_TARGETS = ['CATEGORY', 'PRODUCT'] as const;
export type AnnouncementTarget = (typeof ANNOUNCEMENT_TARGETS)[number];

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');
const minuteSchema = z.number().int().min(0).max(1439);

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(2, 'Titre trop court').max(60, 'Titre trop long (60 caractères au plus)'),
    body: z.string().trim().max(140, 'Texte trop long (140 caractères au plus)').nullable().default(null),
    buttonLabel: z.string().trim().max(30, 'Bouton trop long (30 caractères au plus)').nullable().default(null),
    targetKind: z.enum(ANNOUNCEMENT_TARGETS).nullable().default(null),
    targetId: z.uuid().nullable().default(null),
    /** Promotion liée : sa période remplace celle de l'annonce. */
    promotionId: z.uuid().nullable().default(null),
    mediaId: z.uuid().nullable().default(null),
    isPublished: z.boolean().default(true),
    startDate: dateSchema.nullable().default(null),
    endDate: dateSchema.nullable().default(null),
    /** 1 = lundi … 7 = dimanche ; vide : tous les jours. */
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    startMinute: minuteSchema.nullable().default(null),
    endMinute: minuteSchema.nullable().default(null),
    /** Temps passé à l'écran avant l'annonce suivante. */
    displaySeconds: z.number().int().min(3).max(30).default(6),
  })
  .refine((a) => (a.targetKind === null) === (a.targetId === null), { message: 'Choisissez la catégorie ou le plat visé.', path: ['targetId'] })
  .refine((a) => (a.startMinute === null) === (a.endMinute === null), { message: 'Indiquez l’heure de début et l’heure de fin.', path: ['endMinute'] })
  .refine((a) => a.startMinute === null || a.startMinute !== a.endMinute, { message: 'L’heure de fin doit différer de l’heure de début.', path: ['endMinute'] })
  .refine((a) => !a.startDate || !a.endDate || a.startDate <= a.endDate, { message: 'La date de fin précède la date de début.', path: ['endDate'] });
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const announcementPublishedSchema = z.object({ isPublished: z.boolean() });

export interface AnnouncementSchedule {
  startDate: string | null;
  endDate: string | null;
  days: number[];
  startMinute: number | null;
  endMinute: number | null;
}

const scheduleSchema = z.object({
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  days: z.array(z.number()),
  startMinute: z.number().nullable(),
  endMinute: z.number().nullable(),
});

/** Vue du gérant. */
export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  targetKind: z.enum(ANNOUNCEMENT_TARGETS).nullable(),
  targetId: z.string().nullable(),
  promotionId: z.string().nullable(),
  mediaId: z.string().nullable(),
  photoUrl: z.string().nullable(),
  isPublished: z.boolean(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  days: z.array(z.number()),
  startMinute: z.number().nullable(),
  endMinute: z.number().nullable(),
  displaySeconds: z.number(),
  /** Période réellement appliquée (celle de la promotion liée, le cas échéant) ; null : promotion suspendue ou archivée. */
  schedule: scheduleSchema.nullable(),
  /** Diffusée en ce moment sur le menu client. */
  live: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Announcement = z.infer<typeof announcementSchema>;

/** Vue du client : seulement ce qui s'affiche. La période voyage pour que le menu, resté ouvert, suive l'heure. */
export const publicAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  target: z.object({ kind: z.enum(ANNOUNCEMENT_TARGETS), id: z.string() }).nullable(),
  photoUrl: z.string().nullable(),
  displaySeconds: z.number(),
  schedule: scheduleSchema,
});
export type PublicAnnouncement = z.infer<typeof publicAnnouncementSchema>;

/** Diffusée maintenant : publiée, non archivée, période valide (null = promotion liée inactive). */
export function announcementLive(a: { isPublished: boolean; status: string }, schedule: AnnouncementSchedule | null, moment: LocalMoment): boolean {
  return a.isPublished && a.status === 'ACTIVE' && schedule !== null && isScheduled(schedule, moment);
}
