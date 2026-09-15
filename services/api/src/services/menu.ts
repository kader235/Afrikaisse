import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import {
  AppError,
  IMAGE_MAX_BYTES,
  uuidv7,
  type AdminMenu,
  type Allergen,
  type CreateCategoryInput,
  type CreateModifierGroupInput,
  type CreateProductInput,
  type Media,
  type ModifierGroup,
  type ModifierInput,
  type Product,
  type PublicMenu,
  type UpdateCategoryInput,
  type UpdateModifierGroupInput,
  type UpdateProductInput,
  type UploadMediaInput,
  type VariantInput,
} from '@afrikaisse/core';
import type {
  MenuCategoriesTable,
  ModifierGroupsTable,
  ModifiersTable,
  ProductsTable,
  ProductVariantsTable,
} from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { inspectImage } from '../lib/images.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { popularProductIds } from './guests.ts';

/**
 * Menu d'un établissement. Portée : organisation de la session et, pour un membre
 * rattaché, son seul établissement. Hors portée → 404.
 * Rien n'est supprimé : les commandes (phase 5) copieront noms et prix, mais doivent
 * pouvoir retrouver l'article d'origine.
 */

type CategoryRow = Selectable<MenuCategoriesTable>;
type ProductRow = Selectable<ProductsTable>;
type VariantRow = Selectable<ProductVariantsTable>;
type GroupRow = Selectable<ModifierGroupsTable>;
type ModifierRow = Selectable<ModifiersTable>;

type SyncedTable = 'menu_categories' | 'products' | 'product_variants' | 'modifier_groups' | 'modifiers' | 'product_modifier_groups' | 'qr_codes';

const ENTITY: Record<SyncedTable, string> = {
  menu_categories: 'menu_category',
  products: 'product',
  product_variants: 'product_variant',
  modifier_groups: 'modifier_group',
  modifiers: 'modifier',
  product_modifier_groups: 'product_modifier_group',
  qr_codes: 'qr_code',
};

/** Événement de synchronisation : la ligne telle qu'elle est après écriture. */
export async function emitRow(db: Db, ctx: AppContext, table: SyncedTable, id: string, hlc: string): Promise<void> {
  const row = (await (db as Db).selectFrom(table as 'products').selectAll().where('id', '=', id).executeTakeFirstOrThrow()) as unknown as {
    tenant_id: string;
    location_id: string;
  };
  await recordChange(db, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: ENTITY[table], entityId: id, operation: 'UPSERT', payload: row, hlc });
}

const bool = (v: 0 | 1) => v === 1;
const flag = (v: boolean) => (v ? 1 : 0) as 0 | 1;
const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const mediaUrl = (id: string | null) => (id ? `/api/media/${id}` : null);

// --- Chargements bornés -----------------------------------------------------

async function loadLocation(db: Db, scope: TenantScope, id: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== id) throw notFound;
  const row = await db.selectFrom('locations').select(['id', 'name', 'currency', 'status']).where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

async function loadScoped<T extends { tenant_id: string; location_id: string; status?: string }>(
  db: Db,
  scope: TenantScope,
  table: 'menu_categories' | 'products' | 'modifier_groups' | 'modifiers',
  id: string,
  label: string,
): Promise<T> {
  const row = (await db.selectFrom(table as 'products').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst()) as unknown as T | undefined;
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', `${label} introuvable.`);
  return row;
}

const loadCategory = (db: Db, scope: TenantScope, id: string) => loadScoped<CategoryRow>(db, scope, 'menu_categories', id, 'Catégorie');
const loadProduct = (db: Db, scope: TenantScope, id: string) => loadScoped<ProductRow>(db, scope, 'products', id, 'Produit');
const loadGroup = (db: Db, scope: TenantScope, id: string) => loadScoped<GroupRow>(db, scope, 'modifier_groups', id, "Groupe d'options");
const loadModifier = (db: Db, scope: TenantScope, id: string) => loadScoped<ModifierRow>(db, scope, 'modifiers', id, 'Option');

function assertActive(status: string, message: string) {
  if (status !== 'ACTIVE') throw new AppError('CONFLICT', message);
}

/** Postes de préparation actifs, avec le nombre de produits qui leur sont affectés. */
export async function loadStations(db: Db, locationId: string) {
  const [rows, counts] = await Promise.all([
    db.selectFrom('stations').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db
      .selectFrom('products')
      .select('station_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('location_id', '=', locationId)
      .where('status', '=', 'ACTIVE')
      .groupBy('station_id')
      .execute(),
  ]);
  return rows.map((s) => ({ id: s.id, locationId: s.location_id, name: s.name, kind: s.kind, sort: s.sort, productCount: Number(counts.find((c) => c.station_id === s.id)?.n ?? 0) }));
}

export async function assertStation(db: Db, locationId: string, stationId: string | null | undefined) {
  if (!stationId) return;
  const row = await db.selectFrom('stations').select('status').where('id', '=', stationId).where('location_id', '=', locationId).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
  if (row.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Ce poste de préparation est archivé.');
}

async function nextSort(db: Db, table: 'menu_categories' | 'products' | 'modifier_groups', column: 'location_id' | 'category_id', value: string) {
  const row = await db
    .selectFrom(table as 'products')
    .select((eb) => eb.fn.max('sort').as('m'))
    .where(column as 'location_id', '=', value)
    .executeTakeFirst();
  return row?.m === null || row?.m === undefined ? 0 : Number(row.m) + 1;
}

// --- Lecture ----------------------------------------------------------------

function toProduct(p: ProductRow, variants: VariantRow[], groupIds: string[]): Product {
  return {
    id: p.id,
    locationId: p.location_id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    price: p.price,
    promoPrice: p.promo_price,
    prepTimeMin: p.prep_time_min,
    stationId: p.station_id,
    isAvailable: bool(p.is_available),
    tags: parseJson<string[]>(p.tags, []),
    allergens: parseJson<Allergen[]>(p.allergens, []),
    photoMediaId: p.photo_media_id,
    photoUrl: mediaUrl(p.photo_media_id),
    sort: p.sort,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .sort((a, b) => a.sort - b.sort)
      .map((v) => ({ id: v.id, name: v.name, priceDelta: v.price_delta, isAvailable: bool(v.is_available), sort: v.sort })),
    modifierGroupIds: groupIds,
  };
}

async function readLocationMenu(db: Db, locationId: string) {
  const [categories, products, variants, links, groups, modifiers] = await Promise.all([
    db.selectFrom('menu_categories').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db.selectFrom('products').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db.selectFrom('product_variants').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').execute(),
    db.selectFrom('product_modifier_groups').selectAll().where('location_id', '=', locationId).orderBy('sort').execute(),
    db.selectFrom('modifier_groups').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db.selectFrom('modifiers').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
  ]);
  return { categories, products, variants, links, groups, modifiers };
}

export async function getAdminMenu(ctx: AppContext, scope: TenantScope, locationId: string): Promise<AdminMenu> {
  const location = await loadLocation(ctx.db, scope, locationId);
  const m = await readLocationMenu(ctx.db, locationId);
  const activeGroupIds = new Set(m.groups.map((g) => g.id));
  const activeProductIds = new Set(m.products.map((p) => p.id));
  return {
    location: { id: location.id, name: location.name, currency: location.currency },
    stations: await loadStations(ctx.db, locationId),
    categories: m.categories.map((c) => ({ id: c.id, locationId: c.location_id, name: c.name, isVisible: bool(c.is_visible), sort: c.sort })),
    products: m.products.map((p) =>
      toProduct(
        p,
        m.variants,
        m.links.filter((l) => l.product_id === p.id && activeGroupIds.has(l.group_id)).map((l) => l.group_id),
      ),
    ),
    modifierGroups: m.groups.map((g) => ({
      id: g.id,
      locationId: g.location_id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      sort: g.sort,
      modifiers: m.modifiers
        .filter((x) => x.group_id === g.id)
        .map((x) => ({ id: x.id, groupId: x.group_id, name: x.name, priceDelta: x.price_delta, isAvailable: bool(x.is_available), sort: x.sort })),
      productCount: m.links.filter((l) => l.group_id === g.id && activeProductIds.has(l.product_id)).length,
    })),
  };
}

// --- Catégories -------------------------------------------------------------

export async function createCategory(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateCategoryInput, meta: RequestMeta) {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    await trx
      .insertInto('menu_categories')
      .values({
        id,
        tenant_id: scope.tenantId,
        location_id: locationId,
        name: input.name,
        sort: await nextSort(trx, 'menu_categories', 'location_id', locationId),
        is_visible: flag(input.isVisible),
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
        updated_hlc: hlc,
      })
      .execute();
    await emitRow(trx, ctx, 'menu_categories', id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.category_created', entityType: 'menu_category', entityId: id, data: { name: input.name }, meta });
  });
  return getAdminMenu(ctx, scope, locationId);
}

export async function updateCategory(ctx: AppContext, scope: TenantScope, categoryId: string, input: UpdateCategoryInput, meta: RequestMeta) {
  const category = await loadCategory(ctx.db, scope, categoryId);
  assertActive(category.status, 'Cette catégorie est archivée.');
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx
      .updateTable('menu_categories')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.isVisible !== undefined && { is_visible: flag(input.isVisible) }),
        updated_at: ctx.now(),
        updated_hlc: hlc,
      })
      .where('id', '=', categoryId)
      .execute();
    await emitRow(trx, ctx, 'menu_categories', categoryId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: category.location_id, actorUserId: scope.userId, action: 'menu.category_updated', entityType: 'menu_category', entityId: categoryId, data: { before: { name: category.name, isVisible: bool(category.is_visible) }, changes: input }, meta });
  });
  return getAdminMenu(ctx, scope, category.location_id);
}

export async function archiveCategory(ctx: AppContext, scope: TenantScope, categoryId: string, meta: RequestMeta) {
  const category = await loadCategory(ctx.db, scope, categoryId);
  await ctx.db.transaction().execute(async (trx) => {
    const products = await trx.selectFrom('products').select((eb) => eb.fn.countAll().as('n')).where('category_id', '=', categoryId).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow();
    if (Number(products.n) > 0) {
      throw new AppError('CONFLICT', `Cette catégorie contient encore ${Number(products.n)} produit(s) : déplacez-les ou archivez-les d'abord.`);
    }
    const hlc = ctx.clock.now();
    await trx.updateTable('menu_categories').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', categoryId).execute();
    await emitRow(trx, ctx, 'menu_categories', categoryId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: category.location_id, actorUserId: scope.userId, action: 'menu.category_archived', entityType: 'menu_category', entityId: categoryId, data: { name: category.name }, meta });
  });
  return getAdminMenu(ctx, scope, category.location_id);
}

async function applyOrder(
  trx: Db,
  ctx: AppContext,
  table: 'menu_categories' | 'products',
  current: { id: string; sort: number }[],
  ids: string[],
) {
  const known = new Set(current.map((c) => c.id));
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AppError('VALIDATION', "L'ordre transmis ne correspond pas à la liste actuelle. Actualisez puis réessayez.");
  }
  const hlc = ctx.clock.now();
  for (const [index, id] of ids.entries()) {
    if (current.find((c) => c.id === id)!.sort === index) continue;
    await trx.updateTable(table as 'products').set({ sort: index, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', id).execute();
    await emitRow(trx, ctx, table, id, hlc);
  }
}

export async function reorderCategories(ctx: AppContext, scope: TenantScope, locationId: string, ids: string[], meta: RequestMeta) {
  await loadLocation(ctx.db, scope, locationId);
  await ctx.db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('menu_categories').select(['id', 'sort']).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').execute();
    await applyOrder(trx, ctx, 'menu_categories', current, ids);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.categories_reordered', meta });
  });
  return getAdminMenu(ctx, scope, locationId);
}

export async function reorderProducts(ctx: AppContext, scope: TenantScope, categoryId: string, ids: string[], meta: RequestMeta) {
  const category = await loadCategory(ctx.db, scope, categoryId);
  await ctx.db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('products').select(['id', 'sort']).where('category_id', '=', categoryId).where('status', '=', 'ACTIVE').execute();
    await applyOrder(trx, ctx, 'products', current, ids);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: category.location_id, actorUserId: scope.userId, action: 'menu.products_reordered', entityType: 'menu_category', entityId: categoryId, meta });
  });
  return getAdminMenu(ctx, scope, category.location_id);
}

// --- Produits ---------------------------------------------------------------

async function assertPhoto(db: Db, scope: TenantScope, mediaId: string | null | undefined) {
  if (!mediaId) return;
  const media = await db.selectFrom('media').select(['id', 'location_id']).where('id', '=', mediaId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!media || (scope.locationId && media.location_id && media.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Photo introuvable.');
}

async function assertGroups(db: Db, locationId: string, scope: TenantScope, groupIds: string[]) {
  if (new Set(groupIds).size !== groupIds.length) throw new AppError('VALIDATION', "Un groupe d'options est cité deux fois.");
  for (const groupId of groupIds) {
    const group = await loadGroup(db, scope, groupId);
    if (group.location_id !== locationId || group.status !== 'ACTIVE') throw new AppError('NOT_FOUND', "Groupe d'options introuvable.");
  }
}

/** Remplace la liste des variantes : id connu → mise à jour, sans id → création, absente → archivée. */
async function syncVariants(trx: Db, ctx: AppContext, scope: TenantScope, product: { id: string; location_id: string }, inputs: VariantInput[], hlc: string) {
  const existing = await trx.selectFrom('product_variants').selectAll().where('product_id', '=', product.id).where('status', '=', 'ACTIVE').execute();
  const byId = new Map(existing.map((v) => [v.id, v]));
  const now = ctx.now();
  const kept = new Set<string>();
  for (const [sort, input] of inputs.entries()) {
    if (input.id) {
      const current = byId.get(input.id);
      if (!current) throw new AppError('VALIDATION', 'Une variante transmise ne correspond pas à ce produit. Actualisez puis réessayez.');
      kept.add(input.id);
      if (current.name === input.name && current.price_delta === input.priceDelta && bool(current.is_available) === input.isAvailable && current.sort === sort) continue;
      await trx.updateTable('product_variants').set({ name: input.name, price_delta: input.priceDelta, is_available: flag(input.isAvailable), sort, updated_at: now, updated_hlc: hlc }).where('id', '=', input.id).execute();
      await emitRow(trx, ctx, 'product_variants', input.id, hlc);
    } else {
      const id = uuidv7();
      await trx
        .insertInto('product_variants')
        .values({ id, tenant_id: scope.tenantId, location_id: product.location_id, product_id: product.id, name: input.name, price_delta: input.priceDelta, is_available: flag(input.isAvailable), sort, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
        .execute();
      await emitRow(trx, ctx, 'product_variants', id, hlc);
    }
  }
  for (const v of existing) {
    if (kept.has(v.id)) continue;
    await trx.updateTable('product_variants').set({ status: 'ARCHIVED', updated_at: now, updated_hlc: hlc }).where('id', '=', v.id).execute();
    await emitRow(trx, ctx, 'product_variants', v.id, hlc);
  }
}

async function syncGroupLinks(trx: Db, ctx: AppContext, scope: TenantScope, product: { id: string; location_id: string }, groupIds: string[], hlc: string) {
  const existing = await trx.selectFrom('product_modifier_groups').selectAll().where('product_id', '=', product.id).execute();
  const now = ctx.now();
  for (const link of existing) {
    if (groupIds.includes(link.group_id)) continue;
    await trx.deleteFrom('product_modifier_groups').where('id', '=', link.id).execute();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: product.location_id, entityType: 'product_modifier_group', entityId: link.id, operation: 'DELETE', payload: link, hlc });
  }
  for (const [sort, groupId] of groupIds.entries()) {
    const link = existing.find((l) => l.group_id === groupId);
    if (link && link.sort === sort) continue;
    if (link) {
      await trx.updateTable('product_modifier_groups').set({ sort, updated_hlc: hlc }).where('id', '=', link.id).execute();
      await emitRow(trx, ctx, 'product_modifier_groups', link.id, hlc);
    } else {
      const id = uuidv7();
      await trx.insertInto('product_modifier_groups').values({ id, tenant_id: scope.tenantId, location_id: product.location_id, product_id: product.id, group_id: groupId, sort, created_at: now, updated_hlc: hlc }).execute();
      await emitRow(trx, ctx, 'product_modifier_groups', id, hlc);
    }
  }
}

export async function createProduct(ctx: AppContext, scope: TenantScope, categoryId: string, input: CreateProductInput, meta: RequestMeta) {
  const category = await loadCategory(ctx.db, scope, categoryId);
  assertActive(category.status, 'Cette catégorie est archivée.');
  await assertPhoto(ctx.db, scope, input.photoMediaId);
  await assertGroups(ctx.db, category.location_id, scope, input.modifierGroupIds);
  await assertStation(ctx.db, category.location_id, input.stationId);
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    await trx
      .insertInto('products')
      .values({
        id,
        tenant_id: scope.tenantId,
        location_id: category.location_id,
        category_id: categoryId,
        name: input.name,
        description: input.description || null,
        price: input.price,
        promo_price: input.promoPrice,
        prep_time_min: input.prepTimeMin,
        station_id: input.stationId,
        unavailable_reason: null,
        photo_media_id: input.photoMediaId,
        is_available: flag(input.isAvailable),
        tags: JSON.stringify(input.tags),
        allergens: JSON.stringify([...new Set(input.allergens)]),
        sort: await nextSort(trx, 'products', 'category_id', categoryId),
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
        updated_hlc: hlc,
      })
      .execute();
    await emitRow(trx, ctx, 'products', id, hlc);
    const product = { id, location_id: category.location_id };
    await syncVariants(trx, ctx, scope, product, input.variants, hlc);
    await syncGroupLinks(trx, ctx, scope, product, input.modifierGroupIds, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: category.location_id,
      actorUserId: scope.userId,
      action: 'menu.product_created',
      entityType: 'product',
      entityId: id,
      data: { name: input.name, price: input.price, category: category.name },
      meta,
    });
  });
  return getAdminMenu(ctx, scope, category.location_id);
}

export async function updateProduct(ctx: AppContext, scope: TenantScope, productId: string, input: UpdateProductInput, meta: RequestMeta) {
  const product = await loadProduct(ctx.db, scope, productId);
  assertActive(product.status, 'Ce produit est archivé.');
  const price = input.price ?? product.price;
  const promo = input.promoPrice !== undefined ? input.promoPrice : product.promo_price;
  if (promo !== null && promo >= price) {
    throw new AppError('VALIDATION', 'Le prix promotionnel doit être inférieur au prix.');
  }
  await assertPhoto(ctx.db, scope, input.photoMediaId);
  if (input.modifierGroupIds) await assertGroups(ctx.db, product.location_id, scope, input.modifierGroupIds);
  await assertStation(ctx.db, product.location_id, input.stationId);

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    let categoryPatch = {};
    if (input.categoryId && input.categoryId !== product.category_id) {
      const target = await loadCategory(trx, scope, input.categoryId);
      if (target.location_id !== product.location_id) throw new AppError('CONFLICT', 'Cette catégorie appartient à un autre établissement.');
      assertActive(target.status, 'Cette catégorie est archivée.');
      categoryPatch = { category_id: target.id, sort: await nextSort(trx, 'products', 'category_id', target.id) };
    }
    await trx
      .updateTable('products')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description || null }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.promoPrice !== undefined && { promo_price: input.promoPrice }),
        ...(input.prepTimeMin !== undefined && { prep_time_min: input.prepTimeMin }),
        ...(input.stationId !== undefined && { station_id: input.stationId }),
        ...(input.photoMediaId !== undefined && { photo_media_id: input.photoMediaId }),
        ...(input.isAvailable !== undefined && { is_available: flag(input.isAvailable) }),
        ...(input.tags !== undefined && { tags: JSON.stringify(input.tags) }),
        ...(input.allergens !== undefined && { allergens: JSON.stringify([...new Set(input.allergens)]) }),
        ...categoryPatch,
        updated_at: ctx.now(),
        updated_hlc: hlc,
      })
      .where('id', '=', productId)
      .execute();
    await emitRow(trx, ctx, 'products', productId, hlc);
    if (input.variants) await syncVariants(trx, ctx, scope, product, input.variants, hlc);
    if (input.modifierGroupIds) await syncGroupLinks(trx, ctx, scope, product, input.modifierGroupIds, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: product.location_id,
      actorUserId: scope.userId,
      action: input.price !== undefined && input.price !== product.price ? 'menu.price_changed' : 'menu.product_updated',
      entityType: 'product',
      entityId: productId,
      data: { name: product.name, before: { price: product.price, promoPrice: product.promo_price }, changes: input },
      meta,
    });
  });
  return getAdminMenu(ctx, scope, product.location_id);
}

export async function archiveProduct(ctx: AppContext, scope: TenantScope, productId: string, meta: RequestMeta) {
  const product = await loadProduct(ctx.db, scope, productId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('products').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', productId).execute();
    await emitRow(trx, ctx, 'products', productId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: product.location_id, actorUserId: scope.userId, action: 'menu.product_archived', entityType: 'product', entityId: productId, data: { name: product.name }, meta });
  });
  return getAdminMenu(ctx, scope, product.location_id);
}

export async function setProductAvailability(ctx: AppContext, scope: TenantScope, productId: string, isAvailable: boolean, meta: RequestMeta) {
  const product = await loadProduct(ctx.db, scope, productId);
  assertActive(product.status, 'Ce produit est archivé.');
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    // Geste manuel : il prime sur le stock (un produit épuisé à la main ne revient pas seul).
    await trx.updateTable('products').set({ is_available: flag(isAvailable), unavailable_reason: null, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', productId).execute();
    await emitRow(trx, ctx, 'products', productId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: product.location_id, actorUserId: scope.userId, action: isAvailable ? 'menu.product_available' : 'menu.product_sold_out', entityType: 'product', entityId: productId, data: { name: product.name }, meta });
  });
  return getAdminMenu(ctx, scope, product.location_id);
}

// --- Groupes d'options -------------------------------------------------------

async function syncModifiers(trx: Db, ctx: AppContext, scope: TenantScope, group: { id: string; location_id: string }, inputs: ModifierInput[], hlc: string) {
  const existing = await trx.selectFrom('modifiers').selectAll().where('group_id', '=', group.id).where('status', '=', 'ACTIVE').execute();
  const byId = new Map(existing.map((m) => [m.id, m]));
  const now = ctx.now();
  const kept = new Set<string>();
  for (const [sort, input] of inputs.entries()) {
    if (input.id) {
      const current = byId.get(input.id);
      if (!current) throw new AppError('VALIDATION', 'Une option transmise ne correspond pas à ce groupe. Actualisez puis réessayez.');
      kept.add(input.id);
      if (current.name === input.name && current.price_delta === input.priceDelta && bool(current.is_available) === input.isAvailable && current.sort === sort) continue;
      await trx.updateTable('modifiers').set({ name: input.name, price_delta: input.priceDelta, is_available: flag(input.isAvailable), sort, updated_at: now, updated_hlc: hlc }).where('id', '=', input.id).execute();
      await emitRow(trx, ctx, 'modifiers', input.id, hlc);
    } else {
      const id = uuidv7();
      await trx
        .insertInto('modifiers')
        .values({ id, tenant_id: scope.tenantId, location_id: group.location_id, group_id: group.id, name: input.name, price_delta: input.priceDelta, is_available: flag(input.isAvailable), sort, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
        .execute();
      await emitRow(trx, ctx, 'modifiers', id, hlc);
    }
  }
  for (const m of existing) {
    if (kept.has(m.id)) continue;
    await trx.updateTable('modifiers').set({ status: 'ARCHIVED', updated_at: now, updated_hlc: hlc }).where('id', '=', m.id).execute();
    await emitRow(trx, ctx, 'modifiers', m.id, hlc);
  }
}

export async function createModifierGroup(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateModifierGroupInput, meta: RequestMeta) {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    await trx
      .insertInto('modifier_groups')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, name: input.name, min_select: input.minSelect, max_select: input.maxSelect, sort: await nextSort(trx, 'modifier_groups', 'location_id', locationId), status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
    await emitRow(trx, ctx, 'modifier_groups', id, hlc);
    await syncModifiers(trx, ctx, scope, { id, location_id: locationId }, input.modifiers, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.modifier_group_created', entityType: 'modifier_group', entityId: id, data: { name: input.name, options: input.modifiers.length }, meta });
  });
  return getAdminMenu(ctx, scope, locationId);
}

export async function updateModifierGroup(ctx: AppContext, scope: TenantScope, groupId: string, input: UpdateModifierGroupInput, meta: RequestMeta) {
  const group = await loadGroup(ctx.db, scope, groupId);
  assertActive(group.status, "Ce groupe d'options est archivé.");
  await ctx.db.transaction().execute(async (trx) => {
    const count = input.modifiers
      ? input.modifiers.length
      : Number((await trx.selectFrom('modifiers').select((eb) => eb.fn.countAll().as('n')).where('group_id', '=', groupId).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow()).n);
    const min = input.minSelect ?? group.min_select;
    const max = input.maxSelect ?? group.max_select;
    if (min > max) throw new AppError('VALIDATION', 'Le minimum de choix dépasse le maximum.');
    if (max > count) throw new AppError('VALIDATION', "Le maximum de choix dépasse le nombre d'options.");
    const hlc = ctx.clock.now();
    await trx
      .updateTable('modifier_groups')
      .set({ ...(input.name !== undefined && { name: input.name }), min_select: min, max_select: max, updated_at: ctx.now(), updated_hlc: hlc })
      .where('id', '=', groupId)
      .execute();
    await emitRow(trx, ctx, 'modifier_groups', groupId, hlc);
    if (input.modifiers) await syncModifiers(trx, ctx, scope, group, input.modifiers, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: group.location_id, actorUserId: scope.userId, action: 'menu.modifier_group_updated', entityType: 'modifier_group', entityId: groupId, data: { name: group.name, changes: input }, meta });
  });
  return getAdminMenu(ctx, scope, group.location_id);
}

export async function archiveModifierGroup(ctx: AppContext, scope: TenantScope, groupId: string, meta: RequestMeta) {
  const group = await loadGroup(ctx.db, scope, groupId);
  await ctx.db.transaction().execute(async (trx) => {
    const users = await trx
      .selectFrom('product_modifier_groups as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select('p.name')
      .where('l.group_id', '=', groupId)
      .where('p.status', '=', 'ACTIVE')
      .execute();
    if (users.length > 0) {
      throw new AppError('CONFLICT', "Ce groupe d'options est utilisé par des produits : retirez-le de ces produits d'abord.", { products: users.map((u) => u.name) });
    }
    const hlc = ctx.clock.now();
    await trx.updateTable('modifier_groups').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', groupId).execute();
    await emitRow(trx, ctx, 'modifier_groups', groupId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: group.location_id, actorUserId: scope.userId, action: 'menu.modifier_group_archived', entityType: 'modifier_group', entityId: groupId, data: { name: group.name }, meta });
  });
  return getAdminMenu(ctx, scope, group.location_id);
}

export async function setModifierAvailability(ctx: AppContext, scope: TenantScope, modifierId: string, isAvailable: boolean, meta: RequestMeta) {
  const modifier = await loadModifier(ctx.db, scope, modifierId);
  assertActive(modifier.status, 'Cette option est archivée.');
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('modifiers').set({ is_available: flag(isAvailable), updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', modifierId).execute();
    await emitRow(trx, ctx, 'modifiers', modifierId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: modifier.location_id, actorUserId: scope.userId, action: isAvailable ? 'menu.modifier_available' : 'menu.modifier_sold_out', entityType: 'modifier', entityId: modifierId, data: { name: modifier.name }, meta });
  });
  return getAdminMenu(ctx, scope, modifier.location_id);
}

// --- Photos -----------------------------------------------------------------

export async function uploadMedia(ctx: AppContext, scope: TenantScope, locationId: string, input: UploadMediaInput, meta: RequestMeta): Promise<Media> {
  await loadLocation(ctx.db, scope, locationId);
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) {
    throw new AppError('VALIDATION', 'Photo trop lourde : 800 Ko au maximum après compression.');
  }
  const info = inspectImage(bytes);
  if (!info || info.contentType !== input.contentType) {
    throw new AppError('VALIDATION', "Ce fichier n'est pas une image JPEG, PNG ou WebP valide.");
  }
  if (info.width > 4096 || info.height > 4096) {
    throw new AppError('VALIDATION', 'Image trop grande : 4096 pixels de côté au maximum.');
  }
  const id = uuidv7();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('media')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, content_type: info.contentType, size: bytes.length, width: info.width, height: info.height, sha256, bytes, created_by: scope.userId, created_at: ctx.now() })
      .execute();
    // L'événement ne porte pas les octets : le moteur de synchronisation les demandera par l'identifiant.
    await recordChange(trx, ctx, {
      tenantId: scope.tenantId,
      locationId,
      entityType: 'media',
      entityId: id,
      operation: 'UPSERT',
      payload: { id, tenant_id: scope.tenantId, location_id: locationId, content_type: info.contentType, size: bytes.length, width: info.width, height: info.height, sha256, bytes: { $bytes: bytes.toString('base64') }, created_by: scope.userId, created_at: ctx.now() },
      hlc: ctx.clock.now(),
    });
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'menu.photo_uploaded', entityType: 'media', entityId: id, data: { size: bytes.length, width: info.width, height: info.height }, meta });
  });
  return { id, url: mediaUrl(id)!, contentType: info.contentType, size: bytes.length, width: info.width, height: info.height };
}

export async function readMedia(ctx: AppContext, id: string) {
  const row = await ctx.db.selectFrom('media').select(['content_type', 'bytes', 'sha256']).where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  return { contentType: row.content_type, sha256: row.sha256, bytes: Buffer.from(row.bytes) };
}

// --- Menu public (QR) --------------------------------------------------------

export async function getPublicMenu(ctx: AppContext, token: string): Promise<PublicMenu> {
  const invalid = new AppError('NOT_FOUND', "Ce QR code n'est plus valide. Demandez au personnel.");
  const found = await ctx.db
    .selectFrom('qr_codes as q')
    .innerJoin('dining_tables as t', 't.id', 'q.table_id')
    .innerJoin('locations as l', 'l.id', 'q.location_id')
    .innerJoin('tenants as o', 'o.id', 'q.tenant_id')
    .select([
      'q.location_id',
      't.label',
      't.status as table_status',
      'l.name as location_name',
      'l.type',
      'l.currency',
      'l.status as location_status',
      'l.table_code_required',
      'l.bill_mode',
      'o.name as tenant_name',
      'o.status as tenant_status',
    ])
    .where('q.token', '=', token)
    .where('q.revoked_at', 'is', null)
    .executeTakeFirst();
  if (!found || found.table_status !== 'ACTIVE' || found.location_status !== 'ACTIVE' || found.tenant_status !== 'ACTIVE') throw invalid;

  const m = await readLocationMenu(ctx.db, found.location_id);
  const visibleCategories = m.categories.filter((c) => c.is_visible === 1);
  const option = (o: { id: string; name: string; price_delta: number; is_available: 0 | 1 }) => ({ id: o.id, name: o.name, priceDelta: o.price_delta, isAvailable: bool(o.is_available) });
  // Recommandations : seulement parmi ce que le client peut commander maintenant.
  const visibleIds = new Set(visibleCategories.map((c) => c.id));
  const eligible = new Set(m.products.filter((p) => visibleIds.has(p.category_id) && p.is_available === 1).map((p) => p.id));

  return {
    restaurant: { name: found.location_name, organization: found.tenant_name, type: found.type, currency: found.currency },
    table: { label: found.label },
    popular: await popularProductIds(ctx.db, found.location_id, ctx.now(), eligible),
    service: { tableCodeRequired: found.table_code_required === 1, billMode: found.bill_mode },
    categories: visibleCategories
      .map((c) => ({
        id: c.id,
        name: c.name,
        products: m.products
          .filter((p) => p.category_id === c.id)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            promoPrice: p.promo_price,
            photoUrl: mediaUrl(p.photo_media_id),
            isAvailable: bool(p.is_available),
            tags: parseJson<string[]>(p.tags, []),
            allergens: parseJson<Allergen[]>(p.allergens, []),
            variants: m.variants.filter((v) => v.product_id === p.id).sort((a, b) => a.sort - b.sort).map(option),
            modifierGroups: m.links
              .filter((l) => l.product_id === p.id)
              .map((l) => m.groups.find((g) => g.id === l.group_id))
              .filter((g): g is GroupRow => g !== undefined)
              .map((g) => ({ id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, modifiers: m.modifiers.filter((x) => x.group_id === g.id).map(option) })),
          })),
      }))
      .filter((c) => c.products.length > 0),
  };
}

export type { ModifierGroup };
