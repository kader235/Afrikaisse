import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { BILL_MODES, BILL_SCOPES, CLIENT_PAYMENT_METHODS } from './guests.ts';
import { clientTokenSchema, nicknameInputSchema, publicOrderSchema, tableCodeSchema } from './orders.ts';

/**
 * Menu client : table partagée entre plusieurs téléphones (§23), code de table (I-9),
 * addition partagée ou par client, demande d'addition avec moyen de paiement (I-7).
 */

export const joinTableSchema = z.object({
  clientToken: clientTokenSchema,
  code: tableCodeSchema.optional(),
  nickname: nicknameInputSchema,
});
export type JoinTableInput = z.infer<typeof joinTableSchema>;

const share = z.object({ total: z.number(), paid: z.number(), remaining: z.number() });

/** Vue d'une table depuis un téléphone : relue régulièrement pendant le repas. */
export const clientSessionSchema = z.object({
  /** false : la commande en ligne est momentanément impossible (serveur local muet, I-1). */
  orderingAvailable: z.boolean(),
  tableCodeRequired: z.boolean(),
  billMode: z.enum(BILL_MODES),
  currency: z.enum(CURRENCY_CODES),
  /** null : table pas encore ouverte. */
  session: z.object({ id: z.string(), openedAt: z.number() }).nullable(),
  /** Ce téléphone fait partie de la table (code saisi, ou première commande passée). */
  joined: z.boolean(),
  nickname: z.string().nullable(),
  /** Clients de la table ; vide si ce téléphone n'y a pas accès. */
  guests: z.array(z.object({ name: z.string(), nickname: z.string().nullable(), rank: z.number(), isMe: z.boolean(), share })),
  /** Commandes de la table (toutes si accès, sinon celles de ce téléphone). */
  orders: z.array(publicOrderSchema),
  table: share,
  mine: share,
  /** Demande d'addition en cours pour cette table. */
  bill: z
    .object({ paymentMethod: z.enum(CLIENT_PAYMENT_METHODS).nullable(), scope: z.enum(BILL_SCOPES).nullable(), createdAt: z.number(), mine: z.boolean() })
    .nullable(),
});
export type ClientSession = z.infer<typeof clientSessionSchema>;

export const openTableResultSchema = z.object({
  sessionId: z.string(),
  tableId: z.string(),
  joinCode: z.string().nullable(),
});
export type OpenTableResult = z.infer<typeof openTableResultSchema>;
