import { hostname } from 'node:os';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { AppError, MONITORING_THRESHOLDS as T, ageState, uuidv7, worstState, type CheckState, type Monitoring, type ScreenHeartbeatInput } from '@afrikaisse/core';
import type { AppContext, Db } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { listBackups } from '../lib/backup.ts';
import { isUniqueViolation } from '../lib/journal.ts';
import { assertLocation } from './orders.ts';

/**
 * Supervision d'un établissement (§68-69). Chaque état vient d'une donnée réelle du nœud interrogé :
 * le serveur local voit ses imprimantes, ses écrans cuisine et sa liaison au Cloud ; le Cloud voit le
 * dernier signe de vie et les compteurs annoncés par le serveur local.
 */

async function nodeState(db: Db, key: string) {
  return (await db.selectFrom('node_state').select('value').where('key', '=', key).executeTakeFirst())?.value ?? null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const maxOf = (...values: (number | null | undefined)[]) => values.reduce<number | null>((m, v) => (v === null || v === undefined ? m : m === null ? v : Math.max(m, v)), null);

export async function locationMonitoring(ctx: AppContext, scope: TenantScope, locationId: string): Promise<Monitoring> {
  await assertLocation(ctx.db, scope, locationId);
  const now = ctx.now();
  const local = ctx.config.profile === 'local';

  // Base de données : une vraie requête, chronométrée.
  let latencyMs: number | null = null;
  let dbError: string | null = null;
  const started = performance.now();
  try {
    await sql`select 1`.execute(ctx.db);
    latencyMs = Math.round(performance.now() - started);
  } catch {
    dbError = 'Base de données injoignable.';
  }
  const database: Monitoring['database'] = { state: dbError ? 'ERROR' : latencyMs! > T.databaseSlowMs ? 'WARN' : 'OK', engine: ctx.dbKind, latencyMs, error: dbError };
  const api: Monitoring['api'] = { state: 'OK', version: ctx.version, build: ctx.build, startedAt: ctx.startedAt, uptimeSec: Math.max(0, Math.round((now - ctx.startedAt) / 1000)) };

  const location = await ctx.db.selectFrom('locations').select('operating_mode').where('id', '=', locationId).executeTakeFirstOrThrow();
  let cloud: Monitoring['cloud'];
  let localServer: Monitoring['localServer'];
  let sync: Monitoring['sync'];

  if (local) {
    const [url, device, lastPush, lastPull, lastError] = await Promise.all([
      nodeState(ctx.db, 'sync_cloud_url'),
      nodeState(ctx.db, 'sync_device_id'),
      nodeState(ctx.db, 'sync_last_push_at'),
      nodeState(ctx.db, 'sync_last_pull_at'),
      nodeState(ctx.db, 'sync_last_error'),
    ]);
    const counts = await ctx.db
      .selectFrom('sync_events')
      .select((eb) => ['status', eb.fn.countAll().as('n')])
      .where((eb) => eb.or([eb.and([eb('device_id', '=', ctx.nodeId), eb('status', 'in', ['PENDING', 'FAILED'])]), eb('status', '=', 'CONFLICT')]))
      .groupBy('status')
      .execute();
    const count = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
    const lastContact = maxOf(num(lastPush), num(lastPull));
    const paired = !!device;
    if (paired) {
      const contactState: CheckState = lastError ? (lastContact !== null && now - lastContact <= T.heartbeatWarnMs ? 'WARN' : 'ERROR') : ageState(lastContact, now, T.heartbeatOkMs, T.heartbeatWarnMs);
      cloud = { state: contactState, url, lastContactAt: lastContact, error: lastError };
      const pending = count('PENDING') + count('FAILED');
      sync = { state: worstState([contactState, count('FAILED') + count('CONFLICT') > 0 ? 'WARN' : 'OK']), paired, lastSuccessAt: lastContact, pending, failed: count('FAILED'), conflicts: count('CONFLICT'), error: lastError };
    } else {
      cloud = { state: 'NONE', url: null, lastContactAt: null, error: null };
      sync = { state: 'NONE', paired, lastSuccessAt: null, pending: 0, failed: 0, conflicts: 0, error: null };
    }
    localServer = { state: 'OK', mode: location.operating_mode, servers: [{ id: ctx.nodeId, name: `Ce serveur (${hostname()})`, state: 'OK', lastSeenAt: now, appVersion: ctx.version }] };
  } else {
    cloud = { state: 'OK', url: ctx.config.publicUrl ?? null, lastContactAt: now, error: null };
    const servers = await ctx.db
      .selectFrom('devices')
      .select(['id', 'name', 'last_seen_at', 'app_version', 'last_push_at', 'last_pull_at', 'reported_pending', 'reported_failed', 'reported_conflicts'])
      .where('location_id', '=', locationId)
      .where('tenant_id', '=', scope.tenantId)
      .where('kind', '=', 'LOCAL_SERVER')
      .where('status', '=', 'ACTIVE')
      .orderBy('created_at', 'desc')
      .execute();
    if (servers.length === 0) {
      localServer = { state: location.operating_mode === 'HYBRID' ? 'ERROR' : 'NONE', mode: location.operating_mode, servers: [] };
      sync = { state: localServer.state, paired: false, lastSuccessAt: null, pending: 0, failed: 0, conflicts: 0, error: null };
    } else {
      const items = servers.map((s) => ({ id: s.id, name: s.name, state: ageState(s.last_seen_at, now, T.heartbeatOkMs, T.heartbeatWarnMs), lastSeenAt: s.last_seen_at, appVersion: s.app_version }));
      localServer = { state: worstState(items.map((i) => i.state)), mode: location.operating_mode, servers: items };
      const cloudConflicts = await ctx.db
        .selectFrom('sync_events')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('status', '=', 'CONFLICT')
        .where('device_id', 'in', servers.map((s) => s.id))
        .executeTakeFirstOrThrow();
      const sum = (key: 'reported_pending' | 'reported_failed' | 'reported_conflicts') => servers.reduce((t, s) => t + (s[key] ?? 0), 0);
      const failed = sum('reported_failed');
      const conflicts = sum('reported_conflicts') + Number(cloudConflicts.n);
      sync = {
        state: worstState([localServer.state, failed + conflicts > 0 ? 'WARN' : 'OK']),
        paired: true,
        lastSuccessAt: maxOf(...servers.flatMap((s) => [s.last_push_at, s.last_pull_at])),
        pending: sum('reported_pending'),
        failed,
        conflicts,
        error: null,
      };
    }
  }

  // Imprimantes : dernier succès, dernier échec, travaux en attente.
  const printerRows = await ctx.db.selectFrom('printers').select(['id', 'name', 'last_ok_at', 'last_error']).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('name').execute();
  const jobStats = await ctx.db
    .selectFrom('print_jobs')
    .select((eb) => ['printer_id', 'status', eb.fn.countAll().as('n'), eb.fn.max('created_at').as('last_created'), eb.fn.min('created_at').as('first_created'), eb.fn.max('sent_at').as('last_sent')])
    .where('location_id', '=', locationId)
    .groupBy(['printer_id', 'status'])
    .execute();
  const lastFailures = await ctx.db.selectFrom('print_jobs').select(['printer_id', 'last_error', 'created_at']).where('location_id', '=', locationId).where('status', '=', 'FAILED').orderBy('created_at', 'desc').limit(100).execute();
  const printerItems = printerRows.map((p) => {
    const stat = (status: string) => jobStats.find((j) => j.printer_id === p.id && j.status === status);
    const sent = stat('SENT');
    const pending = stat('PENDING');
    const failure = lastFailures.find((f) => f.printer_id === p.id);
    const lastSuccessAt = maxOf(num(sent?.last_sent), p.last_ok_at);
    const lastFailureAt = failure?.created_at ?? null;
    const pendingJobs = Number(pending?.n ?? 0);
    const failedLast = lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt);
    const itemState: CheckState = p.last_error || failedLast ? 'ERROR' : pendingJobs > 0 && now - Number(pending!.first_created) > T.printPendingWarnMs ? 'WARN' : 'OK';
    return { id: p.id, name: p.name, state: itemState, lastSuccessAt, lastFailureAt, lastError: p.last_error ?? (failedLast ? failure!.last_error : null), pendingJobs };
  });
  const printers: Monitoring['printers'] = { state: printerItems.length ? worstState(printerItems.map((i) => i.state)) : 'NONE', items: printerItems };

  // Écrans cuisine : signe de vie envoyé par l'écran pendant qu'il interroge le serveur.
  const screenRows = await ctx.db
    .selectFrom('screen_heartbeats as h')
    .leftJoin('stations as s', 's.id', 'h.station_id')
    .select(['h.id', 'h.name', 's.name as station_name', 'h.last_seen_at'])
    .where('h.location_id', '=', locationId)
    .where('h.last_seen_at', '>=', now - T.screenListMs)
    .orderBy('h.last_seen_at', 'desc')
    .limit(50)
    .execute();
  const screens = screenRows.map((r) => ({ id: r.id, name: r.name, stationName: r.station_name, state: ageState(r.last_seen_at, now, T.screenOkMs, T.screenWarnMs), lastSeenAt: r.last_seen_at }));
  // Un écran éteint à côté d'un écran actif est « à surveiller » ; aucun écran actif : l'état du plus récent.
  const kdsState: CheckState = screens.length === 0 ? 'NONE' : screens.some((s) => s.state === 'OK') ? (screens.every((s) => s.state === 'OK') ? 'OK' : 'WARN') : screens[0]!.state;

  // Sauvegardes (§69) : sur le serveur local seulement ; dans le Cloud, l'hébergeur s'en charge.
  const backupDir = local && ctx.dbKind === 'sqlite' ? ctx.config.backupDir : undefined;
  const lastBackup = backupDir ? listBackups(backupDir)[0] : undefined;
  const backup: Monitoring['backup'] = backupDir
    ? { state: ageState(lastBackup?.createdAt ?? null, now, T.backupOkMs, T.backupWarnMs), enabled: true, lastAt: lastBackup?.createdAt ?? null, lastName: lastBackup?.name ?? null }
    : { state: 'NONE', enabled: false, lastAt: null, lastName: null };

  const kds = { state: kdsState, screens };
  return {
    checkedAt: now,
    profile: ctx.config.profile,
    locationId,
    overall: worstState([api.state, database.state, cloud.state, localServer.state, sync.state, printers.state, kds.state, backup.state]),
    api,
    database,
    cloud,
    localServer,
    sync,
    printers,
    kds,
    backup,
  };
}

/** Signe de vie d'un écran cuisine : une ligne par écran, jamais synchronisée. */
export async function recordScreenHeartbeat(ctx: AppContext, scope: TenantScope, locationId: string, input: ScreenHeartbeatInput): Promise<void> {
  await assertLocation(ctx.db, scope, locationId);
  if (input.stationId) {
    const station = await ctx.db.selectFrom('stations').select('id').where('id', '=', input.stationId).where('location_id', '=', locationId).executeTakeFirst();
    if (!station) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
  }
  const now = ctx.now();
  const patch = { location_id: locationId, station_id: input.stationId, name: input.name ?? null, user_id: scope.userId, last_seen_at: now };
  const update = async () => {
    const existing = await ctx.db.selectFrom('screen_heartbeats').select('tenant_id').where('id', '=', input.screenId).executeTakeFirst();
    // Identifiant déjà pris par une autre organisation : même réponse qu'une ressource absente.
    if (existing && existing.tenant_id !== scope.tenantId) throw new AppError('NOT_FOUND', 'Écran introuvable.');
    if (existing) await ctx.db.updateTable('screen_heartbeats').set(patch).where('id', '=', input.screenId).where('tenant_id', '=', scope.tenantId).execute();
    return !!existing;
  };
  if (!(await update())) {
    try {
      await ctx.db.insertInto('screen_heartbeats').values({ id: input.screenId, tenant_id: scope.tenantId, kind: 'KDS', created_at: now, ...patch }).execute();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await update(); // deux appels simultanés du même écran
    }
  }
  await ctx.db.deleteFrom('screen_heartbeats').where('location_id', '=', locationId).where('last_seen_at', '<', now - 30 * 24 * 3600_000).execute();
}

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,30})?$/;

function counter(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

/**
 * Cloud : ce qu'un serveur local relié annonce à chaque envoi ou réception (version, événements en
 * attente, en échec, en conflit). Valeurs mal formées ignorées : elles ne servent qu'à l'affichage.
 */
export async function recordDeviceReport(ctx: AppContext, deviceId: string, direction: 'push' | 'pull', headers: FastifyRequest['headers']): Promise<void> {
  const now = ctx.now();
  const version = typeof headers['x-afk-version'] === 'string' && VERSION_RE.test(headers['x-afk-version']) ? headers['x-afk-version'] : undefined;
  const pending = counter(headers['x-afk-pending']);
  const failed = counter(headers['x-afk-failed']);
  const conflicts = counter(headers['x-afk-conflicts']);
  const reported = pending !== null || failed !== null || conflicts !== null;
  await ctx.db
    .updateTable('devices')
    .set({
      ...(direction === 'push' ? { last_push_at: now } : { last_pull_at: now }),
      ...(version && { app_version: version }),
      ...(reported && { reported_pending: pending, reported_failed: failed, reported_conflicts: conflicts, reported_at: now }),
    })
    .where('id', '=', deviceId)
    .execute();
}
