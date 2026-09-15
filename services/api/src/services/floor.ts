import { assertCanGrow } from './subscription.ts';
import type { Selectable } from 'kysely';
import {
  AppError,
  DEFAULT_TABLE_SIZE,
  findFreeSpot,
  findLayoutIssues,
  rectInside,
  rectsOverlap,
  uuidv7,
  type CreateLocationInput,
  type CreateTableInput,
  type CreateZoneInput,
  type DiningTable,
  type LayoutInput,
  type LocationDetails,
  type UpdateLocationInput,
  type UpdateTableInput,
  type UpdateZoneInput,
  type Zone,
} from '@afrikaisse/core';
import type { DiningTablesTable, LocationsTable, ZonesTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';
import { createDefaultStations } from './kitchen.ts';
import { createQrCode, revokeQrCodes } from './qr.ts';

/**
 * Établissements, zones, tables et plan de salle.
 * Portée : organisation de la session, et établissement du membre s'il y est rattaché.
 * Hors portée → 404, comme partout.
 */

type LocationRow = Selectable<LocationsTable>;
type ZoneRow = Selectable<ZonesTable>;
type TableRow = Selectable<DiningTablesTable>;

const toLocation = (r: LocationRow): LocationDetails => ({
  id: r.id,
  name: r.name,
  type: r.type,
  currency: r.currency,
  timezone: r.timezone,
  country: r.country,
  address: r.address,
  phone: r.phone,
  logoMediaId: r.logo_media_id,
  logoUrl: r.logo_media_id ? `/api/media/${r.logo_media_id}` : null,
  businessDayCutoffMin: r.business_day_cutoff_min,
  operatingMode: r.operating_mode,
  status: r.status,
  createdAt: r.created_at,
});

const toZone = (r: ZoneRow): Zone => ({
  id: r.id,
  locationId: r.location_id,
  name: r.name,
  sort: r.sort,
  planWidth: r.plan_width,
  planHeight: r.plan_height,
  status: r.status,
});

const toTable = (r: TableRow): DiningTable => ({
  id: r.id,
  locationId: r.location_id,
  zoneId: r.zone_id,
  label: r.label,
  capacity: r.capacity,
  shape: r.shape,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  status: r.status,
});

/** Chaîne vide → null : un champ effacé dans le formulaire est vraiment vide. */
function blankToNull(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v && v.trim() ? v.trim() : null;
}

function normalizeLabel(label: string) {
  const clean = label.trim().replace(/\s+/g, ' ');
  return { label: clean, key: clean.toLocaleLowerCase('fr') };
}

// --- Chargement borné à la portée -------------------------------------------

async function loadLocation(db: Db, scope: TenantScope, id: string): Promise<LocationRow> {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== id) throw notFound;
  const row = await db.selectFrom('locations').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

async function loadZone(db: Db, scope: TenantScope, id: string): Promise<ZoneRow> {
  const row = await db.selectFrom('zones').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Zone introuvable.');
  return row;
}

async function loadTable(db: Db, scope: TenantScope, id: string): Promise<TableRow> {
  const row = await db.selectFrom('dining_tables').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  return row;
}

function assertActive(status: string, message: string) {
  if (status !== 'ACTIVE') throw new AppError('CONFLICT', message);
}

/** Logo : une image de l'organisation (et de cet établissement pour un membre rattaché). */
async function assertLogo(db: Db, scope: TenantScope, mediaId: string | null | undefined) {
  if (!mediaId) return;
  const media = await db.selectFrom('media').select(['id', 'location_id']).where('id', '=', mediaId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!media || (scope.locationId && media.location_id && media.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Image du logo introuvable.');
}

// --- Événements de synchronisation ------------------------------------------

async function emitLocation(db: Db, ctx: AppContext, scope: TenantScope, id: string, hlc: string) {
  const row = await db.selectFrom('locations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(db, ctx, { tenantId: scope.tenantId, locationId: id, entityType: 'location', entityId: id, operation: 'UPSERT', payload: row, hlc });
  return row;
}

async function emitZone(db: Db, ctx: AppContext, scope: TenantScope, id: string, hlc: string) {
  const row = await db.selectFrom('zones').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(db, ctx, { tenantId: scope.tenantId, locationId: row.location_id, entityType: 'zone', entityId: id, operation: 'UPSERT', payload: row, hlc });
  return row;
}

async function emitTable(db: Db, ctx: AppContext, scope: TenantScope, id: string, hlc: string) {
  const row = await db.selectFrom('dining_tables').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(db, ctx, { tenantId: scope.tenantId, locationId: row.location_id, entityType: 'dining_table', entityId: id, operation: 'UPSERT', payload: row, hlc });
  return row;
}

// --- Établissements ---------------------------------------------------------

export async function listLocations(ctx: AppContext, scope: TenantScope, includeArchived: boolean): Promise<LocationDetails[]> {
  let q = ctx.db.selectFrom('locations').selectAll().where('tenant_id', '=', scope.tenantId);
  if (scope.locationId) q = q.where('id', '=', scope.locationId);
  if (!includeArchived) q = q.where('status', '=', 'ACTIVE');
  return (await q.orderBy('name').execute()).map(toLocation);
}

export async function createLocation(ctx: AppContext, scope: TenantScope, input: CreateLocationInput, meta: RequestMeta): Promise<LocationDetails> {
  if (scope.locationId) throw new AppError('FORBIDDEN', 'Votre accès est limité à un établissement.');
  await assertLogo(ctx.db, scope, input.logoMediaId);
  const id = uuidv7();
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    await assertCanGrow(ctx, trx, scope.tenantId, 'locations');
    const hlc = ctx.clock.now();
    await trx
      .insertInto('locations')
      .values({
        id,
        tenant_id: scope.tenantId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        timezone: input.timezone,
        country: input.country,
        address: blankToNull(input.address) ?? null,
        phone: blankToNull(input.phone) ?? null,
        logo_media_id: input.logoMediaId ?? null,
        business_day_cutoff_min: input.businessDayCutoffMin,
        operating_mode: input.operatingMode,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
        updated_hlc: hlc,
      })
      .execute();
    const row = await emitLocation(trx, ctx, scope, id, hlc);
    await createDefaultStations(trx, ctx, scope.tenantId, id, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: id,
      actorUserId: scope.userId,
      action: 'location.created',
      entityType: 'location',
      entityId: id,
      data: { name: input.name, type: input.type, operatingMode: input.operatingMode },
      meta,
    });
    return toLocation(row);
  });
}

export async function updateLocation(ctx: AppContext, scope: TenantScope, id: string, input: UpdateLocationInput, meta: RequestMeta): Promise<LocationDetails> {
  const before = await loadLocation(ctx.db, scope, id);
  if (ctx.config.profile === 'local' && input.operatingMode === 'CLOUD') {
    throw new AppError('CONFLICT', "Un serveur local exploite toujours son établissement en mode « serveur local ».");
  }
  await assertLogo(ctx.db, scope, input.logoMediaId);
  const address = blankToNull(input.address);
  const phone = blankToNull(input.phone);
  const patch = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.type !== undefined && { type: input.type }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.country !== undefined && { country: input.country }),
    ...(address !== undefined && { address }),
    ...(phone !== undefined && { phone }),
    ...(input.logoMediaId !== undefined && { logo_media_id: input.logoMediaId }),
    ...(input.businessDayCutoffMin !== undefined && { business_day_cutoff_min: input.businessDayCutoffMin }),
    ...(input.operatingMode !== undefined && { operating_mode: input.operatingMode }),
  };
  const modeChanged = input.operatingMode !== undefined && input.operatingMode !== before.operating_mode;

  return ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('locations').set({ ...patch, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', id).execute();
    const row = await emitLocation(trx, ctx, scope, id, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: id,
      actorUserId: scope.userId,
      action: modeChanged ? 'location.mode_changed' : 'location.updated',
      entityType: 'location',
      entityId: id,
      data: { before: toLocation(before), changes: input },
      meta,
    });
    return toLocation(row);
  });
}

export async function setLocationStatus(ctx: AppContext, scope: TenantScope, id: string, status: 'ACTIVE' | 'ARCHIVED', meta: RequestMeta): Promise<LocationDetails> {
  if (scope.locationId) throw new AppError('FORBIDDEN', 'Votre accès est limité à un établissement.');
  const row = await loadLocation(ctx.db, scope, id);
  if (row.status === status) return toLocation(row);

  if (status === 'ARCHIVED') {
    const others = await ctx.db
      .selectFrom('locations')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'ACTIVE')
      .where('id', '!=', id)
      .executeTakeFirstOrThrow();
    if (Number(others.n) === 0) {
      throw new AppError('CONFLICT', "L'organisation doit garder au moins un établissement actif.");
    }
    const scoped = await ctx.db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('tenant_id', '=', scope.tenantId)
      .where('location_id', '=', id)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow();
    if (Number(scoped.n) > 0) {
      throw new AppError('CONFLICT', `${Number(scoped.n)} membre(s) travaillent uniquement dans cet établissement : réaffectez-les d'abord.`);
    }
  }

  return ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('locations').set({ status, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', id).execute();
    const updated = await emitLocation(trx, ctx, scope, id, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: id,
      actorUserId: scope.userId,
      action: status === 'ARCHIVED' ? 'location.archived' : 'location.restored',
      entityType: 'location',
      entityId: id,
      meta,
    });
    return toLocation(updated);
  });
}

// --- Plan de salle ----------------------------------------------------------

export async function getFloor(ctx: AppContext, scope: TenantScope, locationId: string) {
  const location = await loadLocation(ctx.db, scope, locationId);
  const zones = await ctx.db
    .selectFrom('zones')
    .selectAll()
    .where('location_id', '=', locationId)
    .where('status', '=', 'ACTIVE')
    .orderBy('sort')
    .orderBy('name')
    .execute();
  const tables = await ctx.db
    .selectFrom('dining_tables')
    .selectAll()
    .where('location_id', '=', locationId)
    .where('status', '=', 'ACTIVE')
    .orderBy('label_key')
    .execute();
  return { location: toLocation(location), zones: zones.map(toZone), tables: tables.map(toTable) };
}

export async function createZone(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateZoneInput, meta: RequestMeta): Promise<Zone> {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  const id = uuidv7();
  const now = ctx.now();
  return ctx.db.transaction().execute(async (trx) => {
    const last = await trx.selectFrom('zones').select((eb) => eb.fn.max('sort').as('m')).where('location_id', '=', locationId).executeTakeFirst();
    const hlc = ctx.clock.now();
    await trx
      .insertInto('zones')
      .values({
        id,
        tenant_id: scope.tenantId,
        location_id: locationId,
        name: input.name,
        sort: last?.m === null || last?.m === undefined ? 0 : Number(last.m) + 1,
        plan_width: input.planWidth,
        plan_height: input.planHeight,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
        updated_hlc: hlc,
      })
      .execute();
    const row = await emitZone(trx, ctx, scope, id, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId,
      actorUserId: scope.userId,
      action: 'floor.zone_created',
      entityType: 'zone',
      entityId: id,
      data: { name: input.name, planWidth: input.planWidth, planHeight: input.planHeight },
      meta,
    });
    return toZone(row);
  });
}

export async function updateZone(ctx: AppContext, scope: TenantScope, zoneId: string, input: UpdateZoneInput, meta: RequestMeta): Promise<Zone> {
  const zone = await loadZone(ctx.db, scope, zoneId);
  assertActive(zone.status, 'Cette zone est archivée.');
  return ctx.db.transaction().execute(async (trx) => {
    const width = input.planWidth ?? zone.plan_width;
    const height = input.planHeight ?? zone.plan_height;
    if (width < zone.plan_width || height < zone.plan_height) {
      const tables = await trx.selectFrom('dining_tables').selectAll().where('zone_id', '=', zoneId).where('status', '=', 'ACTIVE').execute();
      const outside = tables.filter((t) => !rectInside(t, width, height));
      if (outside.length > 0) {
        throw new AppError('CONFLICT', 'Des tables sortiraient du plan : déplacez-les avant de réduire la zone.', {
          tables: outside.map((t) => t.label),
        });
      }
    }
    const hlc = ctx.clock.now();
    await trx
      .updateTable('zones')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.sort !== undefined && { sort: input.sort }),
        plan_width: width,
        plan_height: height,
        updated_at: ctx.now(),
        updated_hlc: hlc,
      })
      .where('id', '=', zoneId)
      .execute();
    const row = await emitZone(trx, ctx, scope, zoneId, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: zone.location_id,
      actorUserId: scope.userId,
      action: 'floor.zone_updated',
      entityType: 'zone',
      entityId: zoneId,
      data: { before: toZone(zone), changes: input },
      meta,
    });
    return toZone(row);
  });
}

export async function archiveZone(ctx: AppContext, scope: TenantScope, zoneId: string, meta: RequestMeta): Promise<Zone> {
  const zone = await loadZone(ctx.db, scope, zoneId);
  if (zone.status === 'ARCHIVED') return toZone(zone);
  return ctx.db.transaction().execute(async (trx) => {
    const tables = await trx
      .selectFrom('dining_tables')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('zone_id', '=', zoneId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow();
    if (Number(tables.n) > 0) {
      throw new AppError('CONFLICT', "Cette zone contient encore des tables : déplacez-les ou archivez-les d'abord.");
    }
    const hlc = ctx.clock.now();
    await trx.updateTable('zones').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', zoneId).execute();
    const row = await emitZone(trx, ctx, scope, zoneId, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: zone.location_id,
      actorUserId: scope.userId,
      action: 'floor.zone_archived',
      entityType: 'zone',
      entityId: zoneId,
      data: { name: zone.name },
      meta,
    });
    return toZone(row);
  });
}

async function assertLabelFree(db: Db, locationId: string, key: string, exceptId?: string) {
  let q = db
    .selectFrom('dining_tables')
    .select(['id', 'label'])
    .where('location_id', '=', locationId)
    .where('label_key', '=', key)
    .where('status', '=', 'ACTIVE');
  if (exceptId) q = q.where('id', '!=', exceptId);
  const taken = await q.executeTakeFirst();
  if (taken) throw new AppError('CONFLICT', `Le libellé « ${taken.label} » est déjà utilisé dans cet établissement.`);
}

function labelConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'Ce libellé est déjà utilisé dans cet établissement.');
  throw err;
}

async function occupiedRects(db: Db, zoneId: string, exceptId?: string) {
  let q = db.selectFrom('dining_tables').select(['x', 'y', 'w', 'h']).where('zone_id', '=', zoneId).where('status', '=', 'ACTIVE');
  if (exceptId) q = q.where('id', '!=', exceptId);
  return q.execute();
}

export async function createTable(ctx: AppContext, scope: TenantScope, zoneId: string, input: CreateTableInput, meta: RequestMeta): Promise<DiningTable> {
  const zone = await loadZone(ctx.db, scope, zoneId);
  assertActive(zone.status, 'Cette zone est archivée.');
  const size = { w: input.w ?? DEFAULT_TABLE_SIZE[input.shape].w, h: input.h ?? DEFAULT_TABLE_SIZE[input.shape].h };
  const { label, key } = normalizeLabel(input.label);
  const id = uuidv7();
  const now = ctx.now();

  return ctx.db
    .transaction()
    .execute(async (trx) => {
      await assertLabelFree(trx, zone.location_id, key);
      const occupied = await occupiedRects(trx, zoneId);
      let position: { x: number; y: number };
      if (input.x !== undefined && input.y !== undefined) {
        const rect = { x: input.x, y: input.y, ...size };
        if (!rectInside(rect, zone.plan_width, zone.plan_height)) throw new AppError('CONFLICT', 'La table sortirait du plan de la zone.');
        if (occupied.some((o) => rectsOverlap(rect, o))) throw new AppError('CONFLICT', 'Cet emplacement est déjà occupé par une autre table.');
        position = { x: rect.x, y: rect.y };
      } else {
        const spot = findFreeSpot(occupied, size.w, size.h, zone.plan_width, zone.plan_height);
        if (!spot) throw new AppError('CONFLICT', 'Plus de place libre dans cette zone : agrandissez le plan ou déplacez des tables.');
        position = spot;
      }
      const hlc = ctx.clock.now();
      await trx
        .insertInto('dining_tables')
        .values({
          id,
          tenant_id: scope.tenantId,
          location_id: zone.location_id,
          zone_id: zoneId,
          label,
          label_key: key,
          capacity: input.capacity,
          shape: input.shape,
          ...position,
          ...size,
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
          updated_hlc: hlc,
        })
        .execute();
      const row = await emitTable(trx, ctx, scope, id, hlc);
      // Chaque table active a son QR dès sa création (menu client, phase 3).
      await createQrCode(trx, ctx, row, hlc);
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: zone.location_id,
        actorUserId: scope.userId,
        action: 'floor.table_created',
        entityType: 'dining_table',
        entityId: id,
        data: { label, capacity: input.capacity, zone: zone.name },
        meta,
      });
      return toTable(row);
    })
    .catch(labelConflict);
}

export async function updateTable(ctx: AppContext, scope: TenantScope, tableId: string, input: UpdateTableInput, meta: RequestMeta): Promise<DiningTable> {
  const table = await loadTable(ctx.db, scope, tableId);
  assertActive(table.status, 'Cette table est archivée.');

  return ctx.db
    .transaction()
    .execute(async (trx) => {
      const patch: Partial<TableRow> = {};
      if (input.label !== undefined) {
        const { label, key } = normalizeLabel(input.label);
        if (key !== table.label_key) await assertLabelFree(trx, table.location_id, key, table.id);
        Object.assign(patch, { label, label_key: key });
      }
      if (input.capacity !== undefined) patch.capacity = input.capacity;
      if (input.shape !== undefined) patch.shape = input.shape;
      if (input.zoneId !== undefined && input.zoneId !== table.zone_id) {
        const target = await loadZone(trx, scope, input.zoneId);
        if (target.location_id !== table.location_id) throw new AppError('CONFLICT', 'Cette zone appartient à un autre établissement.');
        assertActive(target.status, 'Cette zone est archivée.');
        const occupied = await occupiedRects(trx, target.id);
        const here = { x: table.x, y: table.y, w: table.w, h: table.h };
        const keep = rectInside(here, target.plan_width, target.plan_height) && !occupied.some((o) => rectsOverlap(here, o));
        const spot = keep ? here : findFreeSpot(occupied, table.w, table.h, target.plan_width, target.plan_height);
        if (!spot) throw new AppError('CONFLICT', `Plus de place libre dans la zone « ${target.name} ».`);
        Object.assign(patch, { zone_id: target.id, x: spot.x, y: spot.y });
      }
      const hlc = ctx.clock.now();
      await trx.updateTable('dining_tables').set({ ...patch, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', tableId).execute();
      const row = await emitTable(trx, ctx, scope, tableId, hlc);
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: table.location_id,
        actorUserId: scope.userId,
        action: 'floor.table_updated',
        entityType: 'dining_table',
        entityId: tableId,
        data: { before: toTable(table), changes: input },
        meta,
      });
      return toTable(row);
    })
    .catch(labelConflict);
}

export async function archiveTable(ctx: AppContext, scope: TenantScope, tableId: string, meta: RequestMeta): Promise<DiningTable> {
  const table = await loadTable(ctx.db, scope, tableId);
  if (table.status === 'ARCHIVED') return toTable(table);
  // Phase 5 : refuser si une session de table est ouverte.
  return ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('dining_tables').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', tableId).execute();
    // Un QR resté collé sur une table retirée ne doit plus ouvrir de menu.
    await revokeQrCodes(trx, ctx, tableId, hlc);
    const row = await emitTable(trx, ctx, scope, tableId, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: table.location_id,
      actorUserId: scope.userId,
      action: 'floor.table_archived',
      entityType: 'dining_table',
      entityId: tableId,
      data: { label: table.label },
      meta,
    });
    return toTable(row);
  });
}

/**
 * Enregistre la disposition d'une zone en une seule transaction : soit tout le
 * plan est valide (dans la zone, sans chevauchement), soit rien ne bouge.
 */
export async function saveLayout(ctx: AppContext, scope: TenantScope, zoneId: string, input: LayoutInput, meta: RequestMeta): Promise<DiningTable[]> {
  const zone = await loadZone(ctx.db, scope, zoneId);
  assertActive(zone.status, 'Cette zone est archivée.');

  return ctx.db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('dining_tables').selectAll().where('zone_id', '=', zoneId).where('status', '=', 'ACTIVE').execute();
    const byId = new Map(current.map((t) => [t.id, t]));
    const moves = new Map(input.tables.map((m) => [m.id, m]));
    for (const id of moves.keys()) {
      if (!byId.has(id)) throw new AppError('NOT_FOUND', 'Une table du plan est introuvable dans cette zone.');
    }

    const final = current.map((t) => {
      const m = moves.get(t.id);
      return { id: t.id, x: m?.x ?? t.x, y: m?.y ?? t.y, w: m?.w ?? t.w, h: m?.h ?? t.h };
    });
    const issues = findLayoutIssues(final, zone.plan_width, zone.plan_height);
    if (issues.outOfBounds.length > 0 || issues.overlaps.length > 0) {
      const label = (id: string) => byId.get(id)!.label;
      throw new AppError('CONFLICT', 'Le plan contient des tables qui se chevauchent ou sortent de la zone.', {
        outOfBounds: issues.outOfBounds.map(label),
        overlaps: issues.overlaps.map(([a, b]) => [label(a), label(b)]),
      });
    }

    const hlc = ctx.clock.now();
    let moved = 0;
    for (const m of moves.values()) {
      const t = byId.get(m.id)!;
      if (t.x === m.x && t.y === m.y && t.w === m.w && t.h === m.h) continue;
      await trx.updateTable('dining_tables').set({ x: m.x, y: m.y, w: m.w, h: m.h, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', m.id).execute();
      await emitTable(trx, ctx, scope, m.id, hlc);
      moved += 1;
    }
    if (moved > 0) {
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: zone.location_id,
        actorUserId: scope.userId,
        action: 'floor.layout_saved',
        entityType: 'zone',
        entityId: zoneId,
        data: { zone: zone.name, moved },
        meta,
      });
    }
    const rows = await trx.selectFrom('dining_tables').selectAll().where('zone_id', '=', zoneId).where('status', '=', 'ACTIVE').orderBy('label_key').execute();
    return rows.map(toTable);
  });
}
