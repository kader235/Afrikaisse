import { notificationDataSchema, notificationTarget, notificationText, roleCan, type NotificationData, type NotificationKind, type Permission } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import type { PushSender } from '../lib/fcm.ts';

/**
 * Envoi des notifications push aux tablettes (§42, suite) — pour que l'alerte arrive aussi quand
 * l'application est fermée.
 *
 * Les notifications sont écrites par `notify()` DANS la transaction de l'événement. On n'envoie donc
 * pas depuis là (la transaction pourrait encore être annulée) : ce répartiteur lit régulièrement les
 * nouvelles lignes, une fois validées, et pousse chacune aux tablettes concernées.
 *
 * - Un curseur (`node_state.push_seq`) retient la dernière notification traitée, y compris entre
 *   deux redémarrages. Il est avancé par un « compare-and-set » : si l'hébergeur lance plusieurs
 *   processus (Passenger), un seul prend chaque lot, sans doublon.
 * - Un lot est envoyé au plus une fois : mieux vaut manquer une alerte que la répéter en boucle.
 * - Une notification de plus de 2 minutes n'est pas envoyée (serveur resté arrêté, lot en retard).
 * - Qui reçoit : les tablettes dont le rôle voit ce type de notification (même règle que le centre
 *   de notifications), sauf l'auteur du geste.
 */

const STATE_KEY = 'push_seq';
const POLL_MS = 3_000;
const BATCH = 50;
export const PUSH_FRESH_MS = 2 * 60_000;

async function readCursor(ctx: AppContext): Promise<number | null> {
  const row = await ctx.db.selectFrom('node_state').select('value').where('key', '=', STATE_KEY).executeTakeFirst();
  return row ? Number(row.value) : null;
}

/** Première exécution : on part de la dernière notification existante, l'histoire ancienne ne part pas. */
async function initCursor(ctx: AppContext): Promise<number> {
  const top = await ctx.db.selectFrom('notifications').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
  const start = Number(top?.m ?? 0);
  await ctx.db
    .insertInto('node_state')
    .values({ key: STATE_KEY, value: String(start) })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  return (await readCursor(ctx)) ?? start;
}

/** Traite un lot ; renvoie le nombre de push partis. Exportée pour les tests. */
export async function dispatchPushes(ctx: AppContext, sender: PushSender): Promise<number> {
  const last = (await readCursor(ctx)) ?? (await initCursor(ctx));
  const rows = await ctx.db.selectFrom('notifications').selectAll().where('seq', '>', last).orderBy('seq', 'asc').limit(BATCH).execute();
  if (rows.length === 0) return 0;

  const next = Number(rows[rows.length - 1]!.seq);
  const claimed = await ctx.db.updateTable('node_state').set({ value: String(next) }).where('key', '=', STATE_KEY).where('value', '=', String(last)).executeTakeFirst();
  // Un autre processus a pris ce lot avant nous.
  if (Number(claimed.numUpdatedRows) === 0) return 0;

  let sent = 0;
  for (const row of rows) {
    if (ctx.now() - Number(row.created_at) > PUSH_FRESH_MS) continue;

    const recipients = await ctx.db
      .selectFrom('push_tokens as p')
      .innerJoin('memberships as m', (join) => join.onRef('m.user_id', '=', 'p.user_id').onRef('m.tenant_id', '=', 'p.tenant_id'))
      .select(['p.token', 'p.user_id', 'm.role', 'm.location_id'])
      .where('p.location_id', '=', row.location_id)
      .where('m.status', '=', 'ACTIVE')
      .execute();
    const tokens = new Set<string>();
    for (const r of recipients) {
      if (r.location_id && r.location_id !== row.location_id) continue;
      if (row.created_by && r.user_id === row.created_by) continue;
      if (!roleCan(r.role, row.audience as Permission)) continue;
      tokens.add(r.token);
    }
    if (tokens.size === 0) continue;

    let data: NotificationData = {};
    try {
      data = notificationDataSchema.parse(JSON.parse(row.data));
    } catch {
      /* données illisibles : le titre reste générique */
    }
    const kind = row.kind as NotificationKind;
    const { title, body } = notificationText(kind, data);
    const payload = { target: notificationTarget(kind), kind, notificationId: row.id };

    const results = await Promise.all([...tokens].map(async (token) => ({ token, result: await sender.send({ token, title, body, data: payload }) })));
    for (const { token, result } of results) {
      if (result === 'sent') sent += 1;
      else if (result === 'invalid') await ctx.db.deleteFrom('push_tokens').where('token', '=', token).execute();
      else ctx.log.system.warn({ notificationId: row.id }, "Notification push non envoyée (panne passagère)");
    }
  }
  return sent;
}

/** Boucle du serveur ; renvoie sa fonction d'arrêt. Sans identifiants Firebase, on n'appelle même pas cette fonction. */
export function startPushDispatcher(ctx: AppContext, sender: PushSender, onError: (err: unknown) => void): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    dispatchPushes(ctx, sender)
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
