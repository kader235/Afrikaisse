import { hostname } from 'node:os';
import type { Kysely } from 'kysely';
import { AppError, type PairResponse, type PullResponse, type PushResponse, type SyncRun, type SyncStatus } from '@afrikaisse/core';
import type { AppContext, Db } from '../../context.ts';
import { applyEvent, decodeRow, recordReceived, toWire } from './apply.ts';

/**
 * Côté serveur local : appairage, puis boucle envoi / réception toutes les 5 s. Tout part du
 * restaurant (HTTPS sortant) : aucun port à ouvrir sur la box. Sans Internet, les événements
 * attendent sur place et partent au retour de la connexion.
 */

export type SyncTransport = (req: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;

const transports = new WeakMap<object, SyncTransport>();
export function setSyncTransport(ctx: AppContext, transport: SyncTransport) {
  transports.set(ctx, transport);
}

const fetchTransport: SyncTransport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { ...(req.body !== undefined && { 'content-type': 'application/json' }), ...req.headers },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: { error: { message: text.slice(0, 200) } } };
  }
};

const K = {
  url: 'sync_cloud_url',
  device: 'sync_device_id',
  secret: 'sync_device_secret',
  location: 'sync_location_id',
  cursor: 'sync_cursor',
  lastPush: 'sync_last_push_at',
  lastPull: 'sync_last_pull_at',
  lastError: 'sync_last_error',
};

async function getState(db: Db, key: string) {
  return (await db.selectFrom('node_state').select('value').where('key', '=', key).executeTakeFirst())?.value ?? null;
}
async function setState(db: Db, key: string, value: string) {
  await db.insertInto('node_state').values({ key, value }).onConflict((oc) => oc.column('key').doUpdateSet({ value })).execute();
}

export async function pairWithCloud(ctx: AppContext, input: { cloudUrl: string; code: string }): Promise<{ organization: string; location: string }> {
  if (ctx.config.profile !== 'local') throw new AppError('CONFLICT', "L'appairage concerne le serveur local du restaurant.");
  if (await ctx.db.selectFrom('tenants').select('id').limit(1).executeTakeFirst()) {
    throw new AppError('FORBIDDEN', 'Ce serveur local est déjà configuré pour un restaurant.');
  }
  const base = input.cloudUrl.replace(/\/+$/, '');
  let res: Awaited<ReturnType<SyncTransport>>;
  try {
    res = await (transports.get(ctx) ?? fetchTransport)({ method: 'POST', url: `${base}/api/sync/pair`, body: { code: input.code, deviceName: `Serveur local ${hostname()}`.slice(0, 60) } });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', `AfriKaisse Cloud injoignable (${base}). Vérifiez la connexion Internet du PC.`);
  }
  if (res.status !== 200) {
    const code = res.status === 404 ? 'NOT_FOUND' : res.status === 429 ? 'TOO_MANY_ATTEMPTS' : 'CONFLICT';
    throw new AppError(code, res.body?.error?.message ?? `Appairage refusé par le Cloud (${res.status}).`);
  }
  const pair = res.body as PairResponse;
  await ctx.db.transaction().execute(async (trx) => {
    const any = trx as unknown as Kysely<any>;
    for (const { table, rows } of pair.snapshot) {
      for (const row of rows) await any.insertInto(table).values(decodeRow(row)).execute();
    }
    await setState(trx, K.url, base);
    await setState(trx, K.device, pair.deviceId);
    await setState(trx, K.secret, pair.deviceSecret);
    await setState(trx, K.location, pair.locationId);
    await setState(trx, K.cursor, String(pair.cursor));
  });
  return { organization: pair.organization, location: pair.location };
}

export async function syncStatus(ctx: AppContext): Promise<SyncStatus> {
  const [url, device, lastPush, lastPull, lastError, pending, conflicts] = await Promise.all([
    getState(ctx.db, K.url),
    getState(ctx.db, K.device),
    getState(ctx.db, K.lastPush),
    getState(ctx.db, K.lastPull),
    getState(ctx.db, K.lastError),
    ctx.db.selectFrom('sync_events').select((eb) => eb.fn.countAll().as('n')).where('device_id', '=', ctx.nodeId).where('status', 'in', ['PENDING', 'FAILED']).executeTakeFirstOrThrow(),
    ctx.db.selectFrom('sync_events').select((eb) => eb.fn.countAll().as('n')).where('status', '=', 'CONFLICT').executeTakeFirstOrThrow(),
  ]);
  return {
    paired: !!device,
    cloudUrl: url,
    deviceId: device,
    pending: Number(pending.n),
    conflicts: Number(conflicts.n),
    lastPushAt: lastPush ? Number(lastPush) : null,
    lastPullAt: lastPull ? Number(lastPull) : null,
    lastError,
  };
}

const PUSH_BATCH = 200;

export async function runSyncOnce(ctx: AppContext): Promise<SyncRun> {
  const [url, device, secret, locationId] = await Promise.all([getState(ctx.db, K.url), getState(ctx.db, K.device), getState(ctx.db, K.secret), getState(ctx.db, K.location)]);
  if (!url || !device || !secret || !locationId) throw new AppError('CONFLICT', "Ce serveur n'est pas relié à AfriKaisse Cloud.");
  const transport = transports.get(ctx) ?? fetchTransport;
  const headers = { 'x-afk-device': device, 'x-afk-device-secret': secret };
  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  try {
    // Envoi : les événements de ce nœud, dans l'ordre d'écriture.
    for (let round = 0; round < 20; round++) {
      const rows = await ctx.db.selectFrom('sync_events').selectAll().where('device_id', '=', ctx.nodeId).where('status', 'in', ['PENDING', 'FAILED']).orderBy('seq').limit(PUSH_BATCH).execute();
      if (rows.length === 0) break;
      const res = await transport({ method: 'POST', url: `${url}/api/sync/push`, body: { events: rows.map(toWire) }, headers });
      if (res.status !== 200) throw new AppError('SERVICE_UNAVAILABLE', res.body?.error?.message ?? `Envoi refusé par le Cloud (${res.status}).`);
      const now = ctx.now();
      for (const r of (res.body as PushResponse).results) {
        if (r.status === 'APPLIED' || r.status === 'DUPLICATE') {
          await ctx.db.updateTable('sync_events').set({ status: 'SYNCED', synced_at: now, last_error: null }).where('event_id', '=', r.eventId).execute();
          pushed += 1;
        } else {
          await ctx.db.updateTable('sync_events').set({ status: 'CONFLICT', last_error: r.error ?? r.status }).where('event_id', '=', r.eventId).execute();
          conflicts += 1;
        }
      }
      await setState(ctx.db, K.lastPush, String(now));
      if (rows.length < PUSH_BATCH) break;
    }

    // Réception : ce qui a changé ailleurs (Cloud, autres appareils) depuis le curseur.
    for (let round = 0; round < 50; round++) {
      const since = Number((await getState(ctx.db, K.cursor)) ?? 0);
      const res = await transport({ method: 'GET', url: `${url}/api/sync/pull?since=${since}`, headers });
      if (res.status !== 200) throw new AppError('SERVICE_UNAVAILABLE', res.body?.error?.message ?? `Réception refusée par le Cloud (${res.status}).`);
      const page = res.body as PullResponse;
      for (const event of page.events) {
        const seen = await ctx.db.selectFrom('sync_events').select('event_id').where('event_id', '=', event.eventId).executeTakeFirst();
        if (seen) continue;
        try {
          await ctx.db.transaction().execute(async (trx) => {
            ctx.clock.receive(event.hlc);
            await applyEvent(trx, event, { onlyLocationId: locationId });
            await recordReceived(trx, ctx, event, 'SYNCED');
          });
          pulled += 1;
        } catch (err) {
          await recordReceived(ctx.db, ctx, event, 'CONFLICT', `Conflit : ${(err as Error).message}`.slice(0, 300)).catch(() => undefined);
          conflicts += 1;
        }
      }
      await setState(ctx.db, K.cursor, String(page.cursor));
      await setState(ctx.db, K.lastPull, String(ctx.now()));
      if (page.events.length === 0 || page.events.length < 500) break;
    }
    await ctx.db.deleteFrom('node_state').where('key', '=', K.lastError).execute();
  } catch (err) {
    const message = err instanceof AppError ? err.message : `AfriKaisse Cloud injoignable : ${(err as Error).message}`;
    await setState(ctx.db, K.lastError, message.slice(0, 300));
  }
  return { pushed, pulled, conflicts, status: await syncStatus(ctx) };
}

/** Serveur local relié : synchronisation continue. Renvoie la fonction d'arrêt. */
export function startSyncLoop(ctx: AppContext, onError: (err: unknown) => void, everyMs = 5000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    getState(ctx.db, K.device)
      .then((device) => (device ? runSyncOnce(ctx) : undefined))
      .catch(onError)
      .finally(() => (running = false));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
