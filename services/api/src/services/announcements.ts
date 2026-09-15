import type { Selectable } from 'kysely';
import {
  AppError,
  announcementLive,
  localMoment,
  uuidv7,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementSchedule,
  type PublicAnnouncement,
} from '@afrikaisse/core';
import type { AnnouncementsTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { daysToMask, maskToDays } from './pricing.ts';

/**
 * Annonces du menu client (bandeau qui défile). Le gérant les crée, les publie ou les retire,
 * les diffuse sur une période ou sur celle d'une promotion liée (dont la remise s'applique alors
 * aux commandes). Synchronisées comme les promotions ; une annonce n'est jamais supprimée (archivée).
 */

type Row = Selectable<AnnouncementsTable>;

const mediaUrl = (id: string | null) => (id ? `/api/media/${id}` : null);

async function loadLocation(db: Db, scope: TenantScope, id: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== id) throw notFound;
  const row = await db.selectFrom('locations').select(['id', 'timezone', 'status']).where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

async function loadRow(db: Db, scope: TenantScope, id: string): Promise<Row> {
  const row = await db.selectFrom('announcements').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Annonce introuvable.');
  return row;
}

async function emit(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('announcements').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'announcement', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

/** Cible, promotion et photo appartiennent à l'établissement de l'annonce. */
async function assertReferences(db: Db, locationId: string, input: AnnouncementInput) {
  if (input.targetKind === 'CATEGORY' && input.targetId) {
    const found = await db.selectFrom('menu_categories').select('id').where('id', '=', input.targetId).where('location_id', '=', locationId).executeTakeFirst();
    if (!found) throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
  }
  if (input.targetKind === 'PRODUCT' && input.targetId) {
    const found = await db.selectFrom('products').select('id').where('id', '=', input.targetId).where('location_id', '=', locationId).executeTakeFirst();
    if (!found) throw new AppError('NOT_FOUND', 'Plat introuvable.');
  }
  if (input.promotionId) {
    const found = await db.selectFrom('promotions').select('id').where('id', '=', input.promotionId).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').executeTakeFirst();
    if (!found) throw new AppError('NOT_FOUND', 'Promotion introuvable ou archivée.');
  }
  if (input.mediaId) {
    const found = await db.selectFrom('media').select('id').where('id', '=', input.mediaId).where('location_id', '=', locationId).executeTakeFirst();
    if (!found) throw new AppError('NOT_FOUND', 'Photo introuvable.');
  }
}

function values(input: AnnouncementInput) {
  return {
    title: input.title,
    body: input.body || null,
    button_label: input.buttonLabel || null,
    target_kind: input.targetKind,
    target_id: input.targetId,
    promotion_id: input.promotionId,
    media_id: input.mediaId,
    is_published: input.isPublished ? 1 : 0,
    // Liée à une promotion : c'est sa période qui compte, la nôtre n'est pas gardée (pas de double réglage contradictoire).
    start_date: input.promotionId ? null : input.startDate,
    end_date: input.promotionId ? null : input.endDate,
    days_mask: input.promotionId ? 0 : daysToMask(input.days),
    start_minute: input.promotionId ? null : input.startMinute,
    end_minute: input.promotionId ? null : input.endMinute,
    display_seconds: input.displaySeconds,
  } as const;
}

/** Période réellement appliquée : la sienne, ou celle de la promotion liée (null si elle est suspendue ou archivée). */
async function schedules(db: Db, rows: Row[]): Promise<Map<string, AnnouncementSchedule | null>> {
  const ids = [...new Set(rows.map((r) => r.promotion_id).filter((id): id is string => !!id))];
  const promotions = ids.length
    ? await db.selectFrom('promotions').select(['id', 'status', 'is_active', 'start_date', 'end_date', 'days_mask', 'start_minute', 'end_minute']).where('id', 'in', ids).execute()
    : [];
  const byId = new Map(promotions.map((p) => [p.id, p]));
  return new Map(
    rows.map((r) => {
      const source = r.promotion_id ? byId.get(r.promotion_id) : r;
      if (!source || ('is_active' in source && (source.status !== 'ACTIVE' || source.is_active !== 1))) return [r.id, null];
      return [r.id, { startDate: source.start_date, endDate: source.end_date, days: maskToDays(source.days_mask), startMinute: source.start_minute, endMinute: source.end_minute }];
    }),
  );
}

export async function listAnnouncements(ctx: AppContext, scope: TenantScope, locationId: string): Promise<Announcement[]> {
  const location = await loadLocation(ctx.db, scope, locationId);
  const rows = await ctx.db.selectFrom('announcements').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').orderBy('created_at').execute();
  const periods = await schedules(ctx.db, rows);
  const moment = localMoment(ctx.now(), location.timezone);
  return rows.map((r) => {
    const schedule = periods.get(r.id) ?? null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      buttonLabel: r.button_label,
      targetKind: r.target_kind,
      targetId: r.target_id,
      promotionId: r.promotion_id,
      mediaId: r.media_id,
      photoUrl: mediaUrl(r.media_id),
      isPublished: r.is_published === 1,
      startDate: r.start_date,
      endDate: r.end_date,
      days: maskToDays(r.days_mask),
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      displaySeconds: r.display_seconds,
      schedule,
      live: announcementLive({ isPublished: r.is_published === 1, status: r.status }, schedule, moment),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  });
}

export async function createAnnouncement(ctx: AppContext, scope: TenantScope, locationId: string, input: AnnouncementInput, meta: RequestMeta): Promise<Announcement[]> {
  const location = await loadLocation(ctx.db, scope, locationId);
  if (location.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cet établissement est archivé.');
  await assertReferences(ctx.db, locationId, input);
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    const last = await trx.selectFrom('announcements').select((eb) => eb.fn.max('sort').as('sort')).where('location_id', '=', locationId).executeTakeFirst();
    await trx
      .insertInto('announcements')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, ...values(input), sort: Number(last?.sort ?? 0) + 1, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
    await emit(trx, ctx, id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.announcement_created', entityType: 'announcement', entityId: id, data: { title: input.title }, meta });
  });
  return listAnnouncements(ctx, scope, locationId);
}

export async function updateAnnouncement(ctx: AppContext, scope: TenantScope, announcementId: string, input: AnnouncementInput, meta: RequestMeta): Promise<Announcement[]> {
  const row = await loadRow(ctx.db, scope, announcementId);
  if (row.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cette annonce est archivée.');
  await assertReferences(ctx.db, row.location_id, input);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('announcements').set({ ...values(input), updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', announcementId).execute();
    await emit(trx, ctx, announcementId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: 'menu.announcement_updated', entityType: 'announcement', entityId: announcementId, data: { title: input.title }, meta });
  });
  return listAnnouncements(ctx, scope, row.location_id);
}

export async function setAnnouncementPublished(ctx: AppContext, scope: TenantScope, announcementId: string, isPublished: boolean, meta: RequestMeta): Promise<Announcement[]> {
  const row = await loadRow(ctx.db, scope, announcementId);
  if (row.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cette annonce est archivée.');
  if ((row.is_published === 1) !== isPublished) {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('announcements').set({ is_published: isPublished ? 1 : 0, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', announcementId).execute();
      await emit(trx, ctx, announcementId, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: isPublished ? 'menu.announcement_published' : 'menu.announcement_unpublished', entityType: 'announcement', entityId: announcementId, data: { title: row.title }, meta });
    });
  }
  return listAnnouncements(ctx, scope, row.location_id);
}

export async function archiveAnnouncement(ctx: AppContext, scope: TenantScope, announcementId: string, meta: RequestMeta): Promise<Announcement[]> {
  const row = await loadRow(ctx.db, scope, announcementId);
  if (row.status === 'ACTIVE') {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('announcements').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', announcementId).execute();
      await emit(trx, ctx, announcementId, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: 'menu.announcement_archived', entityType: 'announcement', entityId: announcementId, data: { title: row.title }, meta });
    });
  }
  return listAnnouncements(ctx, scope, row.location_id);
}

/** Pour le menu client : annonces publiées dont la période existe ; le téléphone filtre selon l'heure. */
export async function publicAnnouncements(db: Db, locationId: string): Promise<PublicAnnouncement[]> {
  const rows = await db.selectFrom('announcements').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').where('is_published', '=', 1).orderBy('sort').orderBy('created_at').execute();
  const periods = await schedules(db, rows);
  return rows.flatMap((r) => {
    const schedule = periods.get(r.id);
    if (!schedule) return [];
    return [
      {
        id: r.id,
        title: r.title,
        body: r.body,
        buttonLabel: r.button_label,
        target: r.target_kind && r.target_id ? { kind: r.target_kind, id: r.target_id } : null,
        photoUrl: mediaUrl(r.media_id),
        displaySeconds: r.display_seconds,
        schedule,
      },
    ];
  });
}
