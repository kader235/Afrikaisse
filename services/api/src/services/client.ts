import {
  AppError,
  billShares,
  normalizeNickname,
  type ClientSession,
  type JoinTableInput,
  type OpenTableResult,
  type Share,
} from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { writeAudit } from '../lib/journal.ts';
import { assignJoinCode, findGuest, loadGuests, onlineOrderingOpen, upsertGuest, verifyTableCode } from './guests.ts';
import { hydrateOrders, openSession, resolveQr, toPublic } from './orders.ts';

/**
 * Menu client côté serveur (§17, §23, §43, §49) : vue « Ma table » partagée entre les téléphones,
 * rejoindre une table avec son code (I-9), ouverture d'une table par le personnel,
 * recommandations tirées des ventes réelles, manifeste de l'application installable.
 */

const ZERO: Share = { total: 0, paid: 0, remaining: 0 };
const OWN_ORDERS_WINDOW_MS = 12 * 3600_000;

// --- Vue du client ------------------------------------------------------------

export async function getClientSession(ctx: AppContext, token: string, clientToken: string): Promise<ClientSession> {
  const qr = await resolveQr(ctx.db, token);
  const required = qr.table_code_required === 1;
  const base = {
    orderingAvailable: await onlineOrderingOpen(ctx, qr),
    tableCodeRequired: required,
    billMode: qr.bill_mode,
    currency: qr.currency,
  };
  const session = await ctx.db.selectFrom('table_sessions').select(['id', 'opened_at']).where('table_id', '=', qr.table_id).where('status', '=', 'OPEN').executeTakeFirst();

  if (!session) {
    // Table libérée : le téléphone garde le suivi de ses propres commandes récentes.
    const rows = await ctx.db
      .selectFrom('orders')
      .selectAll()
      .where('table_id', '=', qr.table_id)
      .where('client_token', '=', clientToken)
      .where('created_at', '>', ctx.now() - OWN_ORDERS_WINDOW_MS)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    return { ...base, session: null, joined: false, nickname: null, guests: [], orders: (await hydrateOrders(ctx.db, rows)).map((o) => toPublic(o, true)), table: ZERO, mine: ZERO, bill: null };
  }

  const [guests, rows, bill] = await Promise.all([
    loadGuests(ctx.db, [session.id]).then((m) => m.get(session.id) ?? []),
    ctx.db.selectFrom('orders').selectAll().where('table_session_id', '=', session.id).orderBy('created_at', 'desc').execute(),
    ctx.db
      .selectFrom('service_requests')
      .select(['payment_method', 'bill_scope', 'created_at', 'client_token'])
      .where('table_id', '=', qr.table_id)
      .where('kind', '=', 'BILL')
      .where('status', '=', 'OPEN')
      .orderBy('created_at', 'desc')
      .execute(),
  ]);
  const me = guests.find((g) => g.clientToken === clientToken);
  // Avec code de table, seuls les téléphones qui ont rejoint la table voient ses commandes.
  const access = !!me || !required;
  const visible = access ? rows : rows.filter((r) => r.client_token === clientToken);
  const tokens = new Map(rows.map((r) => [r.id, r.client_token]));
  const shares = billShares(rows.map((r) => ({ clientToken: r.client_token, status: r.status, total: r.total, paid: r.paid_amount })));
  const myBill = bill.find((b) => b.client_token === clientToken);
  const shownBill = myBill ?? (access ? bill.find((b) => b.bill_scope !== 'MINE') : undefined);

  return {
    ...base,
    session: { id: session.id, openedAt: session.opened_at },
    joined: !!me,
    nickname: me?.nickname ?? null,
    guests: access ? guests.map((g) => ({ name: g.name, nickname: g.nickname, rank: g.rank, isMe: g.clientToken === clientToken, share: shares.byClient.get(g.clientToken) ?? ZERO })) : [],
    orders: (await hydrateOrders(ctx.db, visible)).map((o) => toPublic(o, tokens.get(o.id) === clientToken)),
    table: access ? shares.table : ZERO,
    mine: shares.byClient.get(clientToken) ?? ZERO,
    bill: shownBill ? { paymentMethod: shownBill.payment_method, scope: shownBill.bill_scope, createdAt: shownBill.created_at, mine: shownBill.client_token === clientToken } : null,
  };
}

/** Rejoindre la table ouverte (code exigé si l'établissement l'active) et choisir son surnom. */
export async function joinTable(ctx: AppContext, token: string, input: JoinTableInput, meta: RequestMeta): Promise<ClientSession> {
  const qr = await resolveQr(ctx.db, token);
  const required = qr.table_code_required === 1;
  const session = await ctx.db.selectFrom('table_sessions').select(['id', 'tenant_id', 'location_id', 'join_code']).where('table_id', '=', qr.table_id).where('status', '=', 'OPEN').executeTakeFirst();
  if (!session) {
    if (required) throw new AppError('CONFLICT', "La table n'est pas encore ouverte. Demandez le code de table au serveur.", { reason: 'TABLE_NOT_OPEN' });
    // Sans code : la table s'ouvrira à la première commande, le surnom partira avec elle.
    return getClientSession(ctx, token, input.clientToken);
  }
  const known = await findGuest(ctx.db, session.id, input.clientToken);
  if (!known && required) await verifyTableCode(ctx, session, input.code, meta);
  await ctx.db.transaction().execute(async (trx) => {
    await upsertGuest(trx, ctx, session, input.clientToken, normalizeNickname(input.nickname), ctx.clock.now());
  });
  return getClientSession(ctx, token, input.clientToken);
}

// --- Côté personnel -------------------------------------------------------------

/** Installer des clients : ouvre la table sans commande, pour leur donner le code. */
export async function openTableForGuests(ctx: AppContext, scope: TenantScope, tableId: string, meta: RequestMeta): Promise<OpenTableResult> {
  const table = await ctx.db
    .selectFrom('dining_tables as t')
    .innerJoin('locations as l', 'l.id', 't.location_id')
    .select(['t.id', 't.label', 't.location_id', 't.status', 'l.table_code_required'])
    .where('t.id', '=', tableId)
    .where('t.tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
  if (!table || table.status !== 'ACTIVE' || (scope.locationId && table.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  return ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const sessionId = await openSession(trx, ctx, { tenantId: scope.tenantId, locationId: table.location_id, tableId, userId: scope.userId }, hlc);
    const row = await trx.selectFrom('table_sessions').select(['join_code', 'opened_at']).where('id', '=', sessionId).executeTakeFirstOrThrow();
    const joinCode = row.join_code ?? (await assignJoinCode(trx, ctx, sessionId, hlc));
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: table.location_id, actorUserId: scope.userId, action: 'table.opened', subject: `table ${table.label}`, entityType: 'table_session', entityId: sessionId, meta });
    return { sessionId, tableId, joinCode: table.table_code_required === 1 ? joinCode : null };
  });
}

/** Nouveau code pour une table ouverte ; les clients déjà installés restent à la table. */
export async function renewJoinCode(ctx: AppContext, scope: TenantScope, sessionId: string, meta: RequestMeta): Promise<OpenTableResult> {
  const session = await ctx.db.selectFrom('table_sessions').select(['id', 'table_id', 'location_id', 'status']).where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!session || (scope.locationId && session.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  if (session.status !== 'OPEN') throw new AppError('CONFLICT', 'Cette table a déjà été libérée.');
  const joinCode = await ctx.db.transaction().execute(async (trx) => {
    const code = await assignJoinCode(trx, ctx, sessionId, ctx.clock.now());
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, actorUserId: scope.userId, action: 'table.code_renewed', entityType: 'table_session', entityId: sessionId, meta });
    return code;
  });
  return { sessionId, tableId: session.table_id, joinCode };
}

// --- Application installable ----------------------------------------------------

/** Manifeste de l'application web du menu : nom de l'établissement, ouverture sur la table scannée. */
export async function menuManifest(ctx: AppContext, token: string) {
  const qr = await resolveQr(ctx.db, token);
  const name = qr.location_name;
  return {
    id: `/m/${token}`,
    name,
    short_name: Array.from(name).length > 12 ? `${Array.from(name).slice(0, 11).join('')}…` : name,
    description: `Menu — table ${qr.table_label}`,
    lang: 'fr',
    dir: 'auto',
    start_url: `/m/${token}`,
    scope: '/m/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1D4D82',
    icons: [
      { src: '/m/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/m/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/m/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
