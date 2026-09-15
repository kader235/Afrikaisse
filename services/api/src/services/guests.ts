import { timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import {
  AppError,
  POPULAR_DEFAULTS,
  POPULAR_WINDOW_MS,
  TABLE_CODE_MAX_FAILURES,
  TABLE_CODE_WINDOW_MS,
  generateTableCode,
  guestLabel,
  rankPopular,
  uuidv7,
} from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';

/**
 * Clients d'une table ouverte (§23) et code de table (I-9). Utilisé par les commandes QR,
 * la vue « Ma table » du client et les écrans du personnel.
 */

const LOCAL_SERVER_SILENCE_MS = 20_000;

export interface GuestInfo {
  id: string;
  sessionId: string;
  clientToken: string;
  nickname: string | null;
  /** Rang d'arrivée à la table (1, 2, 3…). */
  rank: number;
  /** Surnom, sinon « Client n ». */
  name: string;
}

/** Clients des tables données, dans l'ordre d'arrivée. */
export async function loadGuests(db: Db, sessionIds: string[]): Promise<Map<string, GuestInfo[]>> {
  const ids = [...new Set(sessionIds)];
  const result = new Map<string, GuestInfo[]>();
  if (ids.length === 0) return result;
  const rows = await db.selectFrom('session_guests').select(['id', 'table_session_id', 'client_token', 'nickname']).where('table_session_id', 'in', ids).orderBy('joined_at').orderBy('id').execute();
  for (const r of rows) {
    const list = result.get(r.table_session_id) ?? [];
    const rank = list.length + 1;
    list.push({ id: r.id, sessionId: r.table_session_id, clientToken: r.client_token, nickname: r.nickname, rank, name: guestLabel(r.nickname, rank) });
    result.set(r.table_session_id, list);
  }
  return result;
}

export async function findGuest(db: Db, sessionId: string, clientToken: string) {
  return db.selectFrom('session_guests').selectAll().where('table_session_id', '=', sessionId).where('client_token', '=', clientToken).executeTakeFirst();
}

/** Ajoute ce téléphone à la table (ou met à jour son surnom), dans la transaction appelante. */
export async function upsertGuest(
  trx: Db,
  ctx: AppContext,
  session: { id: string; tenant_id: string; location_id: string },
  clientToken: string,
  nickname: string | null,
  hlc: string,
): Promise<void> {
  const now = ctx.now();
  const existing = await findGuest(trx, session.id, clientToken);
  let id: string;
  if (existing) {
    if (!nickname || nickname === existing.nickname) return;
    id = existing.id;
    await trx.updateTable('session_guests').set({ nickname, updated_at: now, updated_hlc: hlc }).where('id', '=', id).execute();
  } else {
    id = uuidv7();
    await trx
      .insertInto('session_guests')
      .values({ id, tenant_id: session.tenant_id, location_id: session.location_id, table_session_id: session.id, client_token: clientToken, nickname, joined_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
  }
  const row = await trx.selectFrom('session_guests').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: session.tenant_id, locationId: session.location_id, entityType: 'session_guest', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

/**
 * Vérifie le code saisi par un client qui n'a pas encore rejoint la table. Les échecs sont
 * comptés dans le journal d'audit (pas en mémoire : plusieurs processus Passenger) ; au-delà
 * de TABLE_CODE_MAX_FAILURES sur la fenêtre, la table refuse tout code, même le bon.
 */
export async function verifyTableCode(
  ctx: AppContext,
  session: { id: string; tenant_id: string; location_id: string; join_code: string | null },
  code: string | undefined,
  meta: RequestMeta | undefined,
): Promise<void> {
  const failures = await ctx.db
    .selectFrom('audit_logs')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('action', '=', 'table.code_failed')
    .where('entity_id', '=', session.id)
    .where('created_at', '>', ctx.now() - TABLE_CODE_WINDOW_MS)
    .executeTakeFirstOrThrow();
  if (Number(failures.n) >= TABLE_CODE_MAX_FAILURES) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Trop de codes erronés pour cette table. Adressez-vous à un serveur.', { reason: 'TABLE_CODE_LOCKED' });
  }
  if (!code) throw new AppError('FORBIDDEN', 'Saisissez le code de la table, donné par le serveur.', { reason: 'TABLE_CODE_REQUIRED' });
  const expected = session.join_code ?? '';
  const ok = expected.length === code.length && timingSafeEqual(Buffer.from(expected), Buffer.from(code));
  if (!ok) {
    // Hors transaction : l'annulation de la requête ne doit pas effacer l'échec.
    await writeAudit(ctx.db, ctx, { tenantId: session.tenant_id, locationId: session.location_id, action: 'table.code_failed', entityType: 'table_session', entityId: session.id, meta });
    throw new AppError('FORBIDDEN', 'Code de table incorrect. Demandez-le au serveur.', { reason: 'TABLE_CODE_INVALID' });
  }
}

/** Nouveau code sur une table ouverte (table ouverte avant l'option, ou code divulgué). */
export async function assignJoinCode(trx: Db, ctx: AppContext, sessionId: string, hlc: string): Promise<string> {
  const code = generateTableCode();
  await trx.updateTable('table_sessions').set({ join_code: code, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', sessionId).execute();
  const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', sessionId).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'table_session', entityId: sessionId, operation: 'UPSERT', payload: row, hlc });
  return code;
}

/**
 * « Populaires » : produits les plus vendus sur 30 jours (commandes terminées) parmi `eligible`.
 * Ici plutôt que dans client.ts : le menu public l'appelle sans dépendre des commandes.
 */
export async function popularProductIds(db: Db, locationId: string, now: number, eligible: ReadonlySet<string>): Promise<string[]> {
  const since = now - POPULAR_WINDOW_MS;
  const completed = await db
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('location_id', '=', locationId)
    .where('status', '=', 'COMPLETED')
    .where('created_at', '>', since)
    .executeTakeFirstOrThrow();
  const count = Number(completed.n);
  if (count < POPULAR_DEFAULTS.minCompletedOrders || eligible.size === 0) return [];
  const rows = await db
    .selectFrom('order_items as i')
    .innerJoin('orders as o', 'o.id', 'i.order_id')
    .select(['i.product_id', sql<number>`count(distinct i.order_id)`.as('orders'), sql<number>`sum(i.quantity)`.as('quantity')])
    .where('o.location_id', '=', locationId)
    .where('o.status', '=', 'COMPLETED')
    .where('o.created_at', '>', since)
    .groupBy('i.product_id')
    .execute();
  return rankPopular(
    rows.map((r) => ({ productId: r.product_id, orders: Number(r.orders), quantity: Number(r.quantity) })),
    count,
    eligible,
  );
}

/** Établissement exploité par un serveur local muet : le Cloud ne prend pas de commande QR (SYNC.md §6, I-1). */
export async function onlineOrderingOpen(ctx: AppContext, location: { location_id: string; operating_mode: string }): Promise<boolean> {
  if (ctx.config.profile !== 'cloud' || location.operating_mode !== 'HYBRID') return true;
  const alive = await ctx.db
    .selectFrom('devices')
    .select('id')
    .where('location_id', '=', location.location_id)
    .where('kind', '=', 'LOCAL_SERVER')
    .where('status', '=', 'ACTIVE')
    .where('last_seen_at', '>', ctx.now() - LOCAL_SERVER_SILENCE_MS)
    .executeTakeFirst();
  return !!alive;
}
