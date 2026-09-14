import {
  AppError,
  fromMilli,
  stockState,
  toMilli,
  uuidv7,
  type CreateInventoryItemInput,
  type InventoryItem,
  type Recipe,
  type RecipeInput,
  type StockMovement,
  type StockMovementInput,
  type UpdateInventoryItemInput,
} from '@afrikaisse/core';
import type { Selectable } from 'kysely';
import type { InventoryItemsTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { emitRow } from './menu.ts';
import { assertLocation } from './orders.ts';

/**
 * Stock (phase 13). Règles :
 * - le niveau d'un article = somme de ses mouvements, jamais saisi ;
 * - une commande consomme ses recettes à la CONFIRMATION (une commande QR en attente ne touche
 *   pas au stock), et les restitue si elle est annulée ensuite ; les deux sont idempotents ;
 * - un plat dont un ingrédient ne suffit plus pour une portion devient épuisé (motif STOCK), et
 *   redevient disponible seul au réapprovisionnement ; un épuisé posé à la main n'est jamais levé.
 */

type ItemRow = Selectable<InventoryItemsTable>;

async function levels(db: Db, itemIds: string[]): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('inventory_movements')
    .select('item_id')
    .select((eb) => eb.fn.sum<number>('quantity_milli').as('milli'))
    .where('item_id', 'in', itemIds)
    .groupBy('item_id')
    .execute();
  return new Map(rows.map((r) => [r.item_id, Number(r.milli ?? 0)]));
}

async function toItems(db: Db, rows: ItemRow[]): Promise<InventoryItem[]> {
  const ids = rows.map((r) => r.id);
  const [level, usage] = await Promise.all([
    levels(db, ids),
    ids.length
      ? db
          .selectFrom('recipe_items as r')
          .innerJoin('products as p', 'p.id', 'r.product_id')
          .select('r.item_id')
          .select((eb) => eb.fn.count<number>('r.product_id').distinct().as('n'))
          .where('r.item_id', 'in', ids)
          .where('p.status', '=', 'ACTIVE')
          .groupBy('r.item_id')
          .execute()
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const milli = level.get(r.id) ?? 0;
    return {
      id: r.id,
      locationId: r.location_id,
      name: r.name,
      unit: r.unit,
      level: fromMilli(milli),
      minLevel: fromMilli(r.min_level_milli),
      unitCost: r.unit_cost,
      value: r.unit_cost === null ? 0 : Math.round((Math.max(0, milli) * Number(r.unit_cost)) / 1000),
      state: stockState(milli, Number(r.min_level_milli)),
      usedBy: Number(usage.find((u) => u.item_id === r.id)?.n ?? 0),
    };
  });
}

async function findItem(db: Db, scope: TenantScope, itemId: string) {
  const row = await db.selectFrom('inventory_items').selectAll().where('id', '=', itemId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || row.status !== 'ACTIVE' || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Article de stock introuvable.');
  return row;
}

async function emitItem(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('inventory_items').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'inventory_item', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

async function oneItem(db: Db, id: string) {
  return (await toItems(db, [await db.selectFrom('inventory_items').selectAll().where('id', '=', id).executeTakeFirstOrThrow()]))[0]!;
}

// --- Articles ------------------------------------------------------------------

export async function listInventory(ctx: AppContext, scope: TenantScope, locationId: string): Promise<InventoryItem[]> {
  await assertLocation(ctx.db, scope, locationId);
  const rows = await ctx.db.selectFrom('inventory_items').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('name').execute();
  return toItems(ctx.db, rows);
}

export async function createInventoryItem(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateInventoryItemInput, meta: RequestMeta): Promise<InventoryItem> {
  await assertLocation(ctx.db, scope, locationId);
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    await trx
      .insertInto('inventory_items')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, name: input.name, unit: input.unit, min_level_milli: toMilli(input.minLevel), unit_cost: input.unitCost, sort: 0, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
    await emitItem(trx, ctx, id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'stock.item_created', entityType: 'inventory_item', entityId: id, data: input, meta });
  });
  return oneItem(ctx.db, id);
}

export async function updateInventoryItem(ctx: AppContext, scope: TenantScope, itemId: string, input: UpdateInventoryItemInput, meta: RequestMeta): Promise<InventoryItem> {
  const item = await findItem(ctx.db, scope, itemId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx
      .updateTable('inventory_items')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.unit !== undefined && { unit: input.unit }),
        ...(input.minLevel !== undefined && { min_level_milli: toMilli(input.minLevel) }),
        ...(input.unitCost !== undefined && { unit_cost: input.unitCost }),
        updated_at: ctx.now(),
        updated_hlc: hlc,
      })
      .where('id', '=', itemId)
      .execute();
    await emitItem(trx, ctx, itemId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: item.location_id, actorUserId: scope.userId, action: 'stock.item_updated', entityType: 'inventory_item', entityId: itemId, data: { name: item.name, changes: input }, meta });
  });
  return oneItem(ctx.db, itemId);
}

export async function archiveInventoryItem(ctx: AppContext, scope: TenantScope, itemId: string, meta: RequestMeta): Promise<void> {
  const item = await findItem(ctx.db, scope, itemId);
  const products = await ctx.db
    .selectFrom('recipe_items as r')
    .innerJoin('products as p', 'p.id', 'r.product_id')
    .select('p.name')
    .distinct()
    .where('r.item_id', '=', itemId)
    .where('p.status', '=', 'ACTIVE')
    .execute();
  if (products.length > 0) {
    throw new AppError('CONFLICT', `« ${item.name} » entre dans ${products.length} recette(s) : retirez-le d'abord des recettes.`, { products: products.map((p) => p.name) });
  }
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('inventory_items').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', itemId).execute();
    await emitItem(trx, ctx, itemId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: item.location_id, actorUserId: scope.userId, action: 'stock.item_archived', entityType: 'inventory_item', entityId: itemId, data: { name: item.name }, meta });
  });
}

// --- Mouvements ----------------------------------------------------------------

async function insertMovement(
  trx: Db,
  ctx: AppContext,
  m: { tenantId: string; locationId: string; itemId: string; kind: StockMovement['kind']; milli: number; unitCost?: number | null; reason?: string | null; orderId?: string | null; userId: string | null },
) {
  const hlc = ctx.clock.now();
  const row = {
    id: uuidv7(),
    tenant_id: m.tenantId,
    location_id: m.locationId,
    item_id: m.itemId,
    kind: m.kind,
    quantity_milli: m.milli,
    unit_cost: m.unitCost ?? null,
    reason: m.reason || null,
    order_id: m.orderId ?? null,
    by_user_id: m.userId,
    created_at: ctx.now(),
    hlc,
  };
  await trx.insertInto('inventory_movements').values(row).execute();
  await recordChange(trx, ctx, { tenantId: m.tenantId, locationId: m.locationId, entityType: 'inventory_movement', entityId: row.id, operation: 'UPSERT', payload: row, hlc });
}

export async function addStockMovement(ctx: AppContext, scope: TenantScope, itemId: string, input: StockMovementInput, meta: RequestMeta): Promise<InventoryItem> {
  const item = await findItem(ctx.db, scope, itemId);
  const current = (await levels(ctx.db, [itemId])).get(itemId) ?? 0;
  const q = toMilli(input.quantity);
  const milli = input.kind === 'IN' ? q : input.kind === 'COUNT' ? q - current : -q;
  if ((input.kind === 'OUT' || input.kind === 'LOSS') && q > current) {
    throw new AppError('CONFLICT', `Stock insuffisant : ${fromMilli(current)} en stock.`);
  }
  if (input.kind === 'COUNT' && milli === 0) return oneItem(ctx.db, itemId);

  await ctx.db.transaction().execute(async (trx) => {
    await insertMovement(trx, ctx, { tenantId: scope.tenantId, locationId: item.location_id, itemId, kind: input.kind, milli, unitCost: input.kind === 'IN' ? input.unitCost : null, reason: input.reason, userId: scope.userId });
    // Coût de la dernière réception = coût de référence de l'article.
    if (input.kind === 'IN' && input.unitCost != null && input.unitCost !== item.unit_cost) {
      const hlc = ctx.clock.now();
      await trx.updateTable('inventory_items').set({ unit_cost: input.unitCost, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', itemId).execute();
      await emitItem(trx, ctx, itemId, hlc);
    }
    await refreshAvailability(trx, ctx, scope.userId, item.location_id, [itemId]);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: item.location_id,
      actorUserId: scope.userId,
      action: `stock.${input.kind.toLowerCase()}`,
      entityType: 'inventory_item',
      entityId: itemId,
      data: { name: item.name, quantity: input.quantity, delta: fromMilli(milli), reason: input.reason || null },
      meta,
    });
  });
  return oneItem(ctx.db, itemId);
}

export async function listStockMovements(ctx: AppContext, scope: TenantScope, itemId: string): Promise<StockMovement[]> {
  await findItem(ctx.db, scope, itemId);
  const rows = await ctx.db
    .selectFrom('inventory_movements as m')
    .leftJoin('orders as o', 'o.id', 'm.order_id')
    .leftJoin('users as u', 'u.id', 'm.by_user_id')
    .select(['m.id', 'm.kind', 'm.quantity_milli', 'm.unit_cost', 'm.reason', 'm.created_at', 'o.number', 'u.display_name'])
    .where('m.item_id', '=', itemId)
    .orderBy('m.created_at', 'desc')
    .limit(100)
    .execute();
  return rows.map((r) => ({ id: r.id, kind: r.kind, quantity: fromMilli(r.quantity_milli), unitCost: r.unit_cost, reason: r.reason, orderNumber: r.number, by: r.display_name, at: r.created_at }));
}

// --- Recettes ------------------------------------------------------------------

async function findProduct(db: Db, scope: TenantScope, productId: string) {
  const row = await db.selectFrom('products').select(['id', 'location_id', 'name', 'status']).where('id', '=', productId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || row.status !== 'ACTIVE' || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Produit introuvable.');
  return row;
}

export async function getRecipe(ctx: AppContext, scope: TenantScope, productId: string): Promise<Recipe> {
  await findProduct(ctx.db, scope, productId);
  const rows = await ctx.db
    .selectFrom('recipe_items as r')
    .innerJoin('inventory_items as i', 'i.id', 'r.item_id')
    .leftJoin('product_variants as v', 'v.id', 'r.variant_id')
    .select(['r.item_id', 'i.name', 'i.unit', 'r.variant_id', 'v.name as variant_name', 'r.quantity_milli'])
    .where('r.product_id', '=', productId)
    .orderBy('r.created_at')
    .execute();
  return {
    productId,
    items: rows.map((r) => ({ itemId: r.item_id, itemName: r.name, unit: r.unit, variantId: r.variant_id, variantName: r.variant_name, quantity: fromMilli(r.quantity_milli) })),
  };
}

export async function setRecipe(ctx: AppContext, scope: TenantScope, productId: string, input: RecipeInput, meta: RequestMeta): Promise<Recipe> {
  const product = await findProduct(ctx.db, scope, productId);
  const itemIds = [...new Set(input.items.map((i) => i.itemId))];
  const variantIds = [...new Set(input.items.map((i) => i.variantId).filter((v): v is string => v !== null))];
  const [items, variants] = await Promise.all([
    itemIds.length ? ctx.db.selectFrom('inventory_items').select('id').where('id', 'in', itemIds).where('location_id', '=', product.location_id).where('status', '=', 'ACTIVE').execute() : Promise.resolve([]),
    variantIds.length ? ctx.db.selectFrom('product_variants').select('id').where('id', 'in', variantIds).where('product_id', '=', productId).where('status', '=', 'ACTIVE').execute() : Promise.resolve([]),
  ]);
  if (items.length !== itemIds.length) throw new AppError('NOT_FOUND', 'Un article de la recette est introuvable dans le stock de cet établissement.');
  if (variants.length !== variantIds.length) throw new AppError('NOT_FOUND', "Une version indiquée n'appartient pas à ce produit.");
  const keys = input.items.map((i) => `${i.itemId}:${i.variantId ?? '*'}`);
  if (new Set(keys).size !== keys.length) throw new AppError('VALIDATION', 'Un article figure deux fois pour la même version.');

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const old = await trx.selectFrom('recipe_items').selectAll().where('product_id', '=', productId).execute();
    await trx.deleteFrom('recipe_items').where('product_id', '=', productId).execute();
    for (const row of old) {
      await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'recipe_item', entityId: row.id, operation: 'DELETE', payload: { id: row.id }, hlc });
    }
    for (const i of input.items) {
      const row = { id: uuidv7(), tenant_id: scope.tenantId, location_id: product.location_id, product_id: productId, variant_id: i.variantId, item_id: i.itemId, quantity_milli: toMilli(i.quantity), created_at: now, updated_hlc: hlc };
      await trx.insertInto('recipe_items').values(row).execute();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: product.location_id, entityType: 'recipe_item', entityId: row.id, operation: 'UPSERT', payload: row, hlc });
    }
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: product.location_id, actorUserId: scope.userId, action: 'stock.recipe_updated', entityType: 'product', entityId: productId, data: { name: product.name, items: input.items.length }, meta });
  });
  return getRecipe(ctx, scope, productId);
}

// --- Consommation par les commandes -----------------------------------------------

/** Déduit les recettes d'une commande confirmée. Sans effet si déjà fait. */
export async function consumeStock(trx: Db, ctx: AppContext, order: { id: string; tenant_id: string; location_id: string }, userId: string | null) {
  const done = await trx.selectFrom('inventory_movements').select('id').where('order_id', '=', order.id).where('kind', '=', 'SALE').executeTakeFirst();
  if (done) return;
  const lines = await trx.selectFrom('order_items').select(['product_id', 'variant_id', 'quantity']).where('order_id', '=', order.id).execute();
  if (lines.length === 0) return;
  const recipe = await trx
    .selectFrom('recipe_items as r')
    .innerJoin('inventory_items as i', 'i.id', 'r.item_id')
    .select(['r.product_id', 'r.variant_id', 'r.item_id', 'r.quantity_milli'])
    .where('r.product_id', 'in', [...new Set(lines.map((l) => l.product_id))])
    .where('i.status', '=', 'ACTIVE')
    .execute();
  const need = new Map<string, number>();
  for (const line of lines) {
    for (const r of recipe) {
      if (r.product_id !== line.product_id || (r.variant_id !== null && r.variant_id !== line.variant_id)) continue;
      need.set(r.item_id, (need.get(r.item_id) ?? 0) + Number(r.quantity_milli) * line.quantity);
    }
  }
  for (const [itemId, milli] of need) {
    await insertMovement(trx, ctx, { tenantId: order.tenant_id, locationId: order.location_id, itemId, kind: 'SALE', milli: -milli, orderId: order.id, userId });
  }
  await refreshAvailability(trx, ctx, userId, order.location_id, [...need.keys()]);
}

/** Commande annulée après confirmation : le stock consommé revient. Sans effet si rien n'a été consommé. */
export async function restoreStock(trx: Db, ctx: AppContext, order: { id: string; tenant_id: string; location_id: string }, userId: string | null) {
  const moves = await trx.selectFrom('inventory_movements').select(['item_id', 'kind', 'quantity_milli']).where('order_id', '=', order.id).execute();
  if (moves.length === 0 || moves.some((m) => m.kind === 'SALE_CANCEL')) return;
  for (const m of moves.filter((x) => x.kind === 'SALE')) {
    await insertMovement(trx, ctx, { tenantId: order.tenant_id, locationId: order.location_id, itemId: m.item_id, kind: 'SALE_CANCEL', milli: -Number(m.quantity_milli), orderId: order.id, userId });
  }
  await refreshAvailability(trx, ctx, userId, order.location_id, [...new Set(moves.map((m) => m.item_id))]);
}

/**
 * Recalcule la disponibilité des plats qui utilisent ces articles : épuisé si un ingrédient ne
 * suffit plus pour une portion ; de nouveau disponible si c'était le stock qui l'avait épuisé.
 */
async function refreshAvailability(trx: Db, ctx: AppContext, userId: string | null, locationId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;
  const productIds = [
    ...new Set((await trx.selectFrom('recipe_items').select('product_id').where('item_id', 'in', itemIds).execute()).map((r) => r.product_id)),
  ];
  if (productIds.length === 0) return;
  const [products, recipe] = await Promise.all([
    trx.selectFrom('products').select(['id', 'tenant_id', 'name', 'is_available', 'unavailable_reason']).where('id', 'in', productIds).where('status', '=', 'ACTIVE').execute(),
    trx
      .selectFrom('recipe_items as r')
      .innerJoin('inventory_items as i', 'i.id', 'r.item_id')
      .select(['r.product_id', 'r.item_id', 'r.quantity_milli', 'i.name'])
      .where('r.product_id', 'in', productIds)
      .where('i.status', '=', 'ACTIVE')
      .execute(),
  ]);
  const level = await levels(trx, [...new Set(recipe.map((r) => r.item_id))]);
  for (const p of products) {
    // Pour chaque ingrédient, la plus petite dose d'une version : ce qu'il faut pour en servir un.
    const minimum = new Map<string, { milli: number; name: string }>();
    for (const r of recipe.filter((x) => x.product_id === p.id)) {
      const current = minimum.get(r.item_id);
      if (!current || Number(r.quantity_milli) < current.milli) minimum.set(r.item_id, { milli: Number(r.quantity_milli), name: r.name });
    }
    const missing = [...minimum.entries()].find(([itemId, need]) => (level.get(itemId) ?? 0) < need.milli);
    const hlc = ctx.clock.now();
    if (missing && p.is_available === 1) {
      await trx.updateTable('products').set({ is_available: 0, unavailable_reason: 'STOCK', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', p.id).execute();
      await emitRow(trx, ctx, 'products', p.id, hlc);
      await writeAudit(trx, ctx, { tenantId: p.tenant_id, locationId, actorUserId: userId, action: 'menu.stock_out', entityType: 'product', entityId: p.id, data: { name: p.name, item: missing[1].name } });
    } else if (!missing && p.is_available === 0 && p.unavailable_reason === 'STOCK') {
      await trx.updateTable('products').set({ is_available: 1, unavailable_reason: null, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', p.id).execute();
      await emitRow(trx, ctx, 'products', p.id, hlc);
      await writeAudit(trx, ctx, { tenantId: p.tenant_id, locationId, actorUserId: userId, action: 'menu.stock_back', entityType: 'product', entityId: p.id, data: { name: p.name } });
    }
  }
}
