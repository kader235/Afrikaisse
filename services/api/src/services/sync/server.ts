import type { LocalServerDevice } from '@afrikaisse/core';
import { recordChange as recordLocationChange } from '../../lib/journal.ts';
import { assertCanGrow } from '../subscription.ts';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { AppError, uuidv7, type PairResponse, type PairingCode, type PullResponse, type PushResponse, type Snapshot, type WireEvent } from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../../context.ts';
import type { TenantScope } from '../../lib/access.ts';
import { recordChange, writeAudit } from '../../lib/journal.ts';
import { applyEvent, encodeRow, isRejected, recordReceived, toWire } from './apply.ts';
import { notifyReceived } from '../../lib/notify.ts';

/**
 * Côté Cloud de la synchronisation : codes d'appairage, appairage avec copie initiale,
 * réception des événements d'un serveur local (dans le périmètre de son établissement),
 * envoi des événements des autres nœuds. Chaque appel authentifié rafraîchit le « signe de vie »
 * qui autorise les commandes QR en ligne d'un établissement hybride (SYNC.md §6).
 */

type AnyDb = Kysely<any>;
type Row = Record<string, unknown>;
export interface DeviceScope {
  id: string;
  tenantId: string;
  locationId: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PAIRING_TTL_MS = 10 * 60_000;
const PULL_LIMIT = 500;

function requireCloud(ctx: AppContext) {
  if (ctx.config.profile !== 'cloud') throw new AppError('CONFLICT', 'Cette opération se fait dans AfriKaisse Cloud.');
}

export async function createPairingCode(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta): Promise<PairingCode> {
  requireCloud(ctx);
  const location = await ctx.db.selectFrom('locations').select(['id', 'name', 'status']).where('id', '=', locationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!location || (scope.locationId && scope.locationId !== locationId)) throw new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (location.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cet établissement est archivé.');
  await assertCanGrow(ctx, ctx.db, scope.tenantId, 'localServers');
  let raw = '';
  for (const byte of randomBytes(8)) raw += ALPHABET[byte % ALPHABET.length];
  const now = ctx.now();
  await ctx.db
    .insertInto('pairing_codes')
    .values({ id: uuidv7(), tenant_id: scope.tenantId, location_id: locationId, code_hash: sha256(raw), expires_at: now + PAIRING_TTL_MS, used_at: null, created_by: scope.userId, created_at: now })
    .execute();
  await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'sync.pairing_code', entityType: 'location', entityId: locationId, meta });
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: now + PAIRING_TTL_MS, locationName: location.name };
}

/** Tables copiées sur le serveur local à l'appairage, dans l'ordre des clés étrangères. */
const LOCATION_TABLES = ['zones', 'dining_tables', 'qr_codes', 'stations', 'menu_categories', 'modifier_groups', 'modifiers', 'products', 'product_variants', 'product_modifier_groups', 'printers', 'inventory_items', 'recipe_items'];

async function buildSnapshot(db: Db, tenantId: string, locationId: string): Promise<Snapshot> {
  const any = db as unknown as AnyDb;
  const inScope = (eb: any) => eb.or([eb('location_id', 'is', null), eb('location_id', '=', locationId)]);
  const memberships = await any.selectFrom('memberships').selectAll().where('tenant_id', '=', tenantId).where(inScope).execute();
  const userIds = [...new Set(memberships.map((m: Row) => m.user_id as string))];
  const users = userIds.length ? await any.selectFrom('users').selectAll().where('id', 'in', userIds).execute() : [];
  const snapshot: { table: string; rows: Row[] }[] = [
    { table: 'tenants', rows: await any.selectFrom('tenants').selectAll().where('id', '=', tenantId).execute() },
    { table: 'locations', rows: await any.selectFrom('locations').selectAll().where('id', '=', locationId).execute() },
    // Mots de passe compris : l'équipe se connecte sur place, même sans Internet.
    { table: 'users', rows: users.map((u: Row) => ({ ...u, is_platform_admin: 0 })) },
    { table: 'memberships', rows: memberships },
    { table: 'media', rows: await any.selectFrom('media').selectAll().where('tenant_id', '=', tenantId).where(inScope).execute() },
  ];
  for (const table of LOCATION_TABLES) snapshot.push({ table, rows: await any.selectFrom(table).selectAll().where('location_id', '=', locationId).execute() });
  // Un établissement relié en cours de journée continue sa numérotation (commande n°5, reçu n°12…) :
  // repartir de 1 créerait des doublons que le Cloud refuserait.
  for (const table of ['order_counters', 'document_counters']) {
    snapshot.push({ table, rows: await any.selectFrom(table).selectAll().where('location_id', '=', locationId).execute() });
  }
  return snapshot.map((t) => ({ table: t.table, rows: t.rows.map(encodeRow) }));
}

export async function pairDevice(ctx: AppContext, input: { code: string; deviceName: string }, meta: RequestMeta): Promise<PairResponse> {
  requireCloud(ctx);
  const now = ctx.now();
  const failures = await ctx.db
    .selectFrom('audit_logs')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('action', '=', 'sync.pair_failed')
    .where('created_at', '>', now - PAIRING_TTL_MS)
    .executeTakeFirstOrThrow();
  if (Number(failures.n) >= 20) throw new AppError('TOO_MANY_ATTEMPTS', "Trop d'essais de code. Patientez dix minutes.");

  const code = await ctx.db.selectFrom('pairing_codes').selectAll().where('code_hash', '=', sha256(input.code)).executeTakeFirst();
  if (!code || code.used_at !== null || code.expires_at < now) {
    await writeAudit(ctx.db, ctx, { action: 'sync.pair_failed', meta });
    throw new AppError('NOT_FOUND', "Code d'appairage inconnu, déjà utilisé ou expiré. Créez-en un nouveau dans AfriKaisse Cloud.");
  }

  const deviceId = uuidv7();
  const secret = randomBytes(32).toString('base64url');
  await ctx.db.transaction().execute(async (trx) => {
    const used = await trx.updateTable('pairing_codes').set({ used_at: now }).where('id', '=', code.id).where('used_at', 'is', null).executeTakeFirst();
    if (Number(used.numUpdatedRows) !== 1) throw new AppError('CONFLICT', "Ce code d'appairage vient d'être utilisé.");
    await trx
      .insertInto('devices')
      .values({ id: deviceId, tenant_id: code.tenant_id, location_id: code.location_id, kind: 'LOCAL_SERVER', name: input.deviceName, status: 'ACTIVE', last_seen_at: now, created_at: now, updated_at: now, secret_hash: sha256(secret) })
      .execute();
    // Le serveur local devient l'autorité opérationnelle de l'établissement (ADR-004).
    const hlc = ctx.clock.now();
    await trx.updateTable('locations').set({ operating_mode: 'HYBRID', updated_at: now, updated_hlc: hlc }).where('id', '=', code.location_id).execute();
    const location = await trx.selectFrom('locations').selectAll().where('id', '=', code.location_id).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: code.tenant_id, locationId: code.location_id, entityType: 'location', entityId: code.location_id, operation: 'UPSERT', payload: location, hlc });
    await writeAudit(trx, ctx, { tenantId: code.tenant_id, locationId: code.location_id, actorUserId: code.created_by, action: 'sync.paired', entityType: 'device', entityId: deviceId, data: { name: input.deviceName }, meta });
  });

  const [snapshot, top, names] = await Promise.all([
    buildSnapshot(ctx.db, code.tenant_id, code.location_id),
    ctx.db.selectFrom('sync_events').select((eb) => eb.fn.max('seq').as('m')).where('tenant_id', '=', code.tenant_id).executeTakeFirst(),
    ctx.db.selectFrom('locations as l').innerJoin('tenants as t', 't.id', 'l.tenant_id').select(['l.name', 't.name as organization']).where('l.id', '=', code.location_id).executeTakeFirstOrThrow(),
  ]);
  return { deviceId, deviceSecret: secret, tenantId: code.tenant_id, locationId: code.location_id, organization: names.organization, location: names.name, cursor: Number(top?.m ?? 0), snapshot };
}

export async function authenticateDevice(ctx: AppContext, request: FastifyRequest): Promise<DeviceScope> {
  requireCloud(ctx);
  const id = request.headers['x-afk-device'];
  const secret = request.headers['x-afk-device-secret'];
  const refused = new AppError('UNAUTHENTICATED', 'Serveur local non reconnu : appairez-le de nouveau depuis AfriKaisse Cloud.');
  if (typeof id !== 'string' || typeof secret !== 'string') throw refused;
  const device = await ctx.db.selectFrom('devices').selectAll().where('id', '=', id).where('kind', '=', 'LOCAL_SERVER').executeTakeFirst();
  if (!device || device.status !== 'ACTIVE' || !device.secret_hash || !device.tenant_id || !device.location_id) throw refused;
  const expected = Buffer.from(device.secret_hash, 'hex');
  const given = Buffer.from(sha256(secret), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw refused;
  await ctx.db.updateTable('devices').set({ last_seen_at: ctx.now(), updated_at: ctx.now() }).where('id', '=', id).execute();
  return { id, tenantId: device.tenant_id, locationId: device.location_id };
}

/** Un serveur local ne peut écrire que dans son organisation et son établissement, et jamais s'accorder de droits. */
async function guardRow(trx: Db, device: DeviceScope, table: string, row: Row): Promise<Row | string> {
  if (table === 'tenants') {
    if (row.id !== device.tenantId) return 'Organisation hors du périmètre de ce serveur.';
    const current = await trx.selectFrom('tenants').select(['status', 'plan', 'plan_expires_at', 'is_demo']).where('id', '=', device.tenantId).executeTakeFirst();
    return current ? { ...row, status: current.status, plan: current.plan, plan_expires_at: current.plan_expires_at, is_demo: current.is_demo } : row;
  }
  if (table === 'users') {
    const elsewhere = await trx.selectFrom('memberships').select('id').where('user_id', '=', row.id as string).where('tenant_id', '!=', device.tenantId).executeTakeFirst();
    if (elsewhere) return 'Compte partagé avec une autre organisation : il se modifie depuis le Cloud.';
    if (typeof row.email === 'string') {
      const taken = await trx.selectFrom('users').select('id').where('email', '=', row.email).where('id', '!=', row.id as string).executeTakeFirst();
      if (taken) return 'Adresse e-mail déjà utilisée par un autre compte AfriKaisse.';
    }
    const current = await trx.selectFrom('users').select('is_platform_admin').where('id', '=', row.id as string).executeTakeFirst();
    return { ...row, is_platform_admin: current?.is_platform_admin ?? 0 };
  }
  if (table === 'locations' && row.id !== device.locationId) return 'Établissement hors du périmètre de ce serveur.';
  if ('tenant_id' in row && row.tenant_id !== device.tenantId) return 'Organisation hors du périmètre de ce serveur.';
  if (typeof row.location_id === 'string' && row.location_id !== device.locationId) return 'Établissement hors du périmètre de ce serveur.';
  return row;
}

export async function pushEvents(ctx: AppContext, device: DeviceScope, events: WireEvent[]): Promise<PushResponse> {
  const results: PushResponse['results'] = [];
  for (const incoming of events) {
    const event = { ...incoming, deviceId: device.id };
    const seen = await ctx.db.selectFrom('sync_events').select('event_id').where('event_id', '=', event.eventId).executeTakeFirst();
    if (seen) {
      results.push({ eventId: event.eventId, status: 'DUPLICATE' });
      continue;
    }
    if (event.tenantId !== device.tenantId || (event.locationId && event.locationId !== device.locationId)) {
      results.push({ eventId: event.eventId, status: 'REJECTED', error: 'Hors du périmètre de ce serveur.' });
      continue;
    }
    try {
      await ctx.db.transaction().execute(async (trx) => {
        ctx.clock.receive(event.hlc);
        if (await applyEvent(trx, event, { guard: (table, row) => guardRow(trx, device, table, row) })) await notifyReceived(trx, ctx, event);
        await recordReceived(trx, ctx, event, 'SYNCED');
      });
      results.push({ eventId: event.eventId, status: 'APPLIED' });
    } catch (err) {
      const rejected = isRejected(err);
      const message = rejected ? (err as Error).message : `Conflit : ${(err as Error).message}`.slice(0, 300);
      // Gardé pour revue par le gérant, jamais rejoué automatiquement.
      await recordReceived(ctx.db, ctx, event, 'CONFLICT', message).catch(() => undefined);
      results.push({ eventId: event.eventId, status: rejected ? 'REJECTED' : 'CONFLICT', error: message });
    }
  }
  return { results };
}

export async function pullEvents(ctx: AppContext, device: DeviceScope, since: number): Promise<PullResponse> {
  const rows = await ctx.db
    .selectFrom('sync_events')
    .selectAll()
    .where('tenant_id', '=', device.tenantId)
    .where('seq', '>', since)
    .where('device_id', '!=', device.id)
    .where('status', '=', 'SYNCED')
    .where((eb) => eb.or([eb('location_id', 'is', null), eb('location_id', '=', device.locationId)]))
    .orderBy('seq')
    .limit(PULL_LIMIT)
    .execute();
  if (rows.length > 0) return { events: rows.map(toWire), cursor: Number(rows.at(-1)!.seq) };
  const top = await ctx.db.selectFrom('sync_events').select((eb) => eb.fn.max('seq').as('m')).where('tenant_id', '=', device.tenantId).executeTakeFirst();
  return { events: [], cursor: Math.max(since, Number(top?.m ?? 0)) };
}

// --- Serveurs reliés (Cloud) ---------------------------------------------------

export async function listLocationDevices(ctx: AppContext, scope: TenantScope, locationId: string): Promise<LocalServerDevice[]> {
  requireCloud(ctx);
  if (scope.locationId && scope.locationId !== locationId) throw new AppError('NOT_FOUND', 'Établissement introuvable.');
  const rows = await ctx.db
    .selectFrom('devices')
    .select(['id', 'name', 'status', 'last_seen_at', 'created_at'])
    .where('tenant_id', '=', scope.tenantId)
    .where('location_id', '=', locationId)
    .where('kind', '=', 'LOCAL_SERVER')
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, lastSeenAt: r.last_seen_at, createdAt: r.created_at }));
}

/** PC volé ou remplacé : son secret est effacé, il ne peut plus rien envoyer ni recevoir. */
export async function revokeDevice(ctx: AppContext, scope: TenantScope, deviceId: string, meta: RequestMeta): Promise<void> {
  requireCloud(ctx);
  const device = await ctx.db.selectFrom('devices').selectAll().where('id', '=', deviceId).where('tenant_id', '=', scope.tenantId).where('kind', '=', 'LOCAL_SERVER').executeTakeFirst();
  if (!device || !device.location_id || (scope.locationId && scope.locationId !== device.location_id)) throw new AppError('NOT_FOUND', 'Serveur local introuvable.');
  if (device.status === 'REVOKED') return;
  const locationId = device.location_id;
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    await trx.updateTable('devices').set({ status: 'REVOKED', secret_hash: null, updated_at: now }).where('id', '=', deviceId).execute();
    const stillLinked = await trx.selectFrom('devices').select('id').where('location_id', '=', locationId).where('kind', '=', 'LOCAL_SERVER').where('status', '=', 'ACTIVE').executeTakeFirst();
    // Plus aucun serveur local : l'établissement est de nouveau exploité en ligne.
    if (!stillLinked) {
      const hlc = ctx.clock.now();
      await trx.updateTable('locations').set({ operating_mode: 'CLOUD', updated_at: now, updated_hlc: hlc }).where('id', '=', locationId).execute();
      const row = await trx.selectFrom('locations').selectAll().where('id', '=', locationId).executeTakeFirstOrThrow();
      await recordLocationChange(trx, ctx, { tenantId: scope.tenantId, locationId, entityType: 'location', entityId: locationId, operation: 'UPSERT', payload: row, hlc });
    }
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'sync.device_revoked', entityType: 'device', entityId: deviceId, data: { name: device.name }, meta });
  });
}
