import type { Selectable } from 'kysely';
import { AppError, businessDate, pickDailyMenu, uuidv7, type DailyMenu, type DailyMenuInput, type DailyMenuState } from '@afrikaisse/core';
import type { DailyMenusTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';

/**
 * Menu du jour (voir packages/core/src/dailyMenu.ts pour les règles).
 * Donnée maître synchronisée comme les annonces : le gérant fixe le menu d'un jour ou d'une période,
 * le réajuste à tout moment (même dates = même menu, remplacé d'un bloc), ou le retire (archivé).
 * Le contrôle des commandes du menu client s'appuie sur `resolveDailyMenuProductIds`.
 */

type Row = Selectable<DailyMenusTable>;

function parseIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const toMenu = (r: Row): DailyMenu => ({ id: r.id, startDate: r.start_date, endDate: r.end_date, productIds: parseIds(r.product_ids), updatedAt: Number(r.updated_at) });

async function loadLocation(db: Db, scope: TenantScope, id: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== id) throw notFound;
  const row = await db.selectFrom('locations').select(['id', 'timezone', 'status', 'business_day_cutoff_min']).where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

async function emit(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('daily_menus').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'daily_menu', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

/**
 * Plats du menu du jour en vigueur pour cet établissement, ou null s'il n'y en a pas (toute la carte).
 * Le jour est celui de l'établissement (fuseau + début de journée d'exploitation), jamais celui du serveur.
 */
export async function resolveDailyMenuProductIds(db: Db, locationId: string, timezone: string, cutoffMin: number, now: number): Promise<Set<string> | null> {
  const date = businessDate(now, timezone, cutoffMin);
  const rows = await db
    .selectFrom('daily_menus')
    .selectAll()
    .where('location_id', '=', locationId)
    .where('status', '=', 'ACTIVE')
    .where('start_date', '<=', date)
    .where('end_date', '>=', date)
    .execute();
  const current = pickDailyMenu(rows.map(toMenu), date);
  return current ? new Set(current.productIds) : null;
}

export async function getDailyMenuState(ctx: AppContext, scope: TenantScope, locationId: string): Promise<DailyMenuState> {
  const location = await loadLocation(ctx.db, scope, locationId);
  const today = businessDate(ctx.now(), location.timezone, location.business_day_cutoff_min);
  const rows = await ctx.db
    .selectFrom('daily_menus')
    .selectAll()
    .where('location_id', '=', locationId)
    .where('status', '=', 'ACTIVE')
    .where('end_date', '>=', today)
    .orderBy('start_date')
    .orderBy('created_at')
    .execute();
  const menus = rows.map(toMenu);
  return { today, current: pickDailyMenu(menus, today), menus };
}

export async function saveDailyMenu(ctx: AppContext, scope: TenantScope, locationId: string, input: DailyMenuInput, meta: RequestMeta): Promise<DailyMenuState> {
  const location = await loadLocation(ctx.db, scope, locationId);
  if (location.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cet établissement est archivé.');
  const today = businessDate(ctx.now(), location.timezone, location.business_day_cutoff_min);
  if (input.endDate < today) throw new AppError('CONFLICT', 'Ce menu est déjà passé : choisissez une date à partir d’aujourd’hui.');

  const ids = [...new Set(input.productIds)];
  const found = await ctx.db.selectFrom('products').select('id').where('location_id', '=', locationId).where('status', '=', 'ACTIVE').where('id', 'in', ids).execute();
  if (found.length !== ids.length) throw new AppError('NOT_FOUND', 'Un plat du menu est introuvable ou archivé.');

  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    const same = await trx
      .selectFrom('daily_menus')
      .select('id')
      .where('location_id', '=', locationId)
      .where('status', '=', 'ACTIVE')
      .where('start_date', '=', input.startDate)
      .where('end_date', '=', input.endDate)
      .orderBy('updated_at', 'desc')
      .executeTakeFirst();
    const id = same?.id ?? uuidv7();
    if (same) {
      await trx.updateTable('daily_menus').set({ product_ids: JSON.stringify(ids), updated_at: now, updated_hlc: hlc }).where('id', '=', id).execute();
    } else {
      await trx
        .insertInto('daily_menus')
        .values({ id, tenant_id: scope.tenantId, location_id: locationId, start_date: input.startDate, end_date: input.endDate, product_ids: JSON.stringify(ids), status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
        .execute();
    }
    await emit(trx, ctx, id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.daily_menu_saved', entityType: 'daily_menu', entityId: id, data: { startDate: input.startDate, endDate: input.endDate, products: ids.length }, meta });
  });
  return getDailyMenuState(ctx, scope, locationId);
}

export async function archiveDailyMenu(ctx: AppContext, scope: TenantScope, menuId: string, meta: RequestMeta): Promise<DailyMenuState> {
  const row = await ctx.db.selectFrom('daily_menus').selectAll().where('id', '=', menuId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Menu du jour introuvable.');
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('daily_menus').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', menuId).execute();
    await emit(trx, ctx, menuId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: 'menu.daily_menu_archived', entityType: 'daily_menu', entityId: menuId, data: { startDate: row.start_date, endDate: row.end_date }, meta });
  });
  return getDailyMenuState(ctx, scope, row.location_id);
}
