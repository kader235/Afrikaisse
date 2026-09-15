import {
  AppError,
  DEFAULT_TABLE_SIZE,
  PLAN,
  SETUP_STEPS,
  SETUP_STEP_LABELS,
  SETUP_TEST_REASON,
  priceLine,
  type Floor,
  type QuickTablesInput,
  type SetupStatus,
  type SetupStep,
  type SetupTestOrder,
  type TableShape,
} from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { AuthState, TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { createTable, createZone, getFloor } from './floor.ts';
import { assertLocation, listOrders, loadPricingProducts, updateOrderStatus } from './orders.ts';
import { createStaffOrder } from './pos.ts';

/**
 * Assistant de mise en route (§70). Chaque étape écrit par les services habituels (établissement,
 * menu, plan de salle, équipe, imprimantes, commandes) ; l'avancement se lit dans les données.
 * Seules les étapes « passées » sont mémorisées, sur l'établissement (synchronisé).
 */

const count = async (db: Db, table: 'zones' | 'dining_tables' | 'menu_categories' | 'products' | 'stations' | 'printers', locationId: string) =>
  Number(
    (
      await db
        .selectFrom(table as 'zones')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('location_id', '=', locationId)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirstOrThrow()
    ).n,
  );

function parseSkipped(value: string | null): SetupStep[] | null {
  if (value === null) return null;
  try {
    const list = JSON.parse(value) as unknown;
    return Array.isArray(list) ? list.filter((s): s is SetupStep => (SETUP_STEPS as readonly string[]).includes(s as string)) : [];
  } catch {
    return [];
  }
}

export async function setupStatus(ctx: AppContext, scope: TenantScope, locationId: string): Promise<SetupStatus> {
  await assertLocation(ctx.db, scope, locationId);
  const db = ctx.db;
  const [location, tenant, zones, tables, categories, products, stations, printers, members, cashSessions, orders, test] = await Promise.all([
    db.selectFrom('locations').select(['address', 'phone', 'logo_media_id', 'setup_skipped', 'setup_completed_at']).where('id', '=', locationId).executeTakeFirstOrThrow(),
    db.selectFrom('tenants').select('is_demo').where('id', '=', scope.tenantId).executeTakeFirstOrThrow(),
    count(db, 'zones', locationId),
    count(db, 'dining_tables', locationId),
    count(db, 'menu_categories', locationId),
    count(db, 'products', locationId),
    count(db, 'stations', locationId),
    count(db, 'printers', locationId),
    db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'ACTIVE')
      .where((eb) => eb.or([eb('location_id', 'is', null), eb('location_id', '=', locationId)]))
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n)),
    db.selectFrom('cash_sessions').select((eb) => eb.fn.countAll().as('n')).where('location_id', '=', locationId).executeTakeFirstOrThrow().then((r) => Number(r.n)),
    db.selectFrom('orders').select((eb) => eb.fn.countAll().as('n')).where('location_id', '=', locationId).executeTakeFirstOrThrow().then((r) => Number(r.n)),
    db.selectFrom('audit_logs').select('id').where('tenant_id', '=', scope.tenantId).where('location_id', '=', locationId).where('action', '=', 'setup.test_completed').limit(1).executeTakeFirst(),
  ]);

  const skipped = parseSkipped(location.setup_skipped);
  const started = skipped !== null;
  const hasLogo = location.logo_media_id !== null;
  const hasAddress = location.address !== null || location.phone !== null;
  const testDone = test !== undefined;
  // Nom, type, devise et fuseau sont saisis à l'inscription : ils comptent une fois l'assistant ouvert et validé.
  const done: Record<SetupStep, boolean> = {
    restaurant: started,
    logo: hasLogo,
    address: hasAddress,
    currency: started,
    categories: categories > 0,
    products: products > 0,
    tables: tables > 0,
    qr: tables > 0,
    stations: stations > 0,
    users: members > 1,
    printers: printers > 0,
    test: testDone,
  };
  const steps = SETUP_STEPS.map((id) => ({ id, label: SETUP_STEP_LABELS[id], done: done[id], skipped: !done[id] && (skipped ?? []).includes(id) }));
  return {
    locationId,
    zones,
    tables,
    categories,
    products,
    stations,
    members,
    cashSessions,
    orders,
    printers,
    hasLogo,
    hasAddress,
    testDone,
    isDemo: tenant.is_demo === 1,
    complete: tables > 0 && products > 0,
    started,
    completedAt: location.setup_completed_at ?? null,
    steps,
    nextStep: !started ? 'restaurant' : (steps.find((s) => !s.done && !s.skipped)?.id ?? null),
  };
}

async function saveSetupState(ctx: AppContext, scope: TenantScope, locationId: string, patch: { setup_skipped?: string; setup_completed_at?: number }) {
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('locations').set({ ...patch, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', locationId).execute();
    const row = await trx.selectFrom('locations').selectAll().where('id', '=', locationId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId, entityType: 'location', entityId: locationId, operation: 'UPSERT', payload: row, hlc });
  });
}

/** Valide (skipped=false) ou passe (skipped=true) une étape. Valider la première étape démarre l'assistant. */
export async function markSetupStep(ctx: AppContext, scope: TenantScope, locationId: string, step: SetupStep, skipped: boolean, meta: RequestMeta): Promise<SetupStatus> {
  await assertLocation(ctx.db, scope, locationId);
  const row = await ctx.db.selectFrom('locations').select('setup_skipped').where('id', '=', locationId).executeTakeFirstOrThrow();
  const current = parseSkipped(row.setup_skipped);
  const next = new Set(current ?? []);
  if (skipped) next.add(step);
  else next.delete(step);
  const value = JSON.stringify(SETUP_STEPS.filter((s) => next.has(s)));
  if (value !== row.setup_skipped) {
    await saveSetupState(ctx, scope, locationId, { setup_skipped: value });
    if (skipped) await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'setup.step_skipped', entityType: 'location', entityId: locationId, data: { step }, meta });
  }
  return setupStatus(ctx, scope, locationId);
}

export async function finishSetup(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta): Promise<SetupStatus> {
  const status = await setupStatus(ctx, scope, locationId);
  if (status.nextStep !== null) {
    throw new AppError('CONFLICT', `Étape « ${SETUP_STEP_LABELS[status.nextStep]} » à terminer ou à passer.`);
  }
  if (status.completedAt === null) {
    await saveSetupState(ctx, scope, locationId, { setup_completed_at: ctx.now() });
    await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'setup.completed', entityType: 'location', entityId: locationId, data: { tables: status.tables, products: status.products }, meta });
  }
  return setupStatus(ctx, scope, locationId);
}

// --- Tables en série ---------------------------------------------------------

/** « Salle » → T, « Terrasse » → TE, « VIP » → VI. */
function labelPrefix(name: string, index: number): string {
  if (index === 0) return 'T';
  const letters = name
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters.slice(0, 2) || 'Z';
}

/**
 * « 10 tables en salle, 4 en terrasse » : chaque zone nouvelle reçoit un plan en rangées avec des
 * allées ; dans une zone existante, les tables prennent les places libres. Numérotation continue.
 */
export async function quickTables(ctx: AppContext, scope: TenantScope, locationId: string, input: QuickTablesInput, meta: RequestMeta): Promise<Floor> {
  await assertLocation(ctx.db, scope, locationId);
  const zones = await ctx.db.selectFrom('zones').select(['id', 'name']).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').execute();
  const labels = new Set((await ctx.db.selectFrom('dining_tables').select('label_key').where('location_id', '=', locationId).where('status', '=', 'ACTIVE').execute()).map((t) => t.label_key));
  const nextLabel = (prefix: string) => {
    for (let n = 1; ; n++) {
      const label = `${prefix}${n}`;
      if (!labels.has(label.toLocaleLowerCase('fr'))) {
        labels.add(label.toLocaleLowerCase('fr'));
        return label;
      }
    }
  };

  for (const [index, z] of input.zones.entries()) {
    const shape: TableShape = z.shape ?? (z.capacity > 4 ? 'RECT' : 'SQUARE');
    const size = DEFAULT_TABLE_SIZE[shape];
    const prefix = (z.prefix ?? labelPrefix(z.name, index)).toUpperCase();
    const existing = zones.find((x) => x.name.trim().toLocaleLowerCase('fr') === z.name.trim().toLocaleLowerCase('fr'));
    if (existing) {
      for (let i = 0; i < z.count; i++) await createTable(ctx, scope, existing.id, { label: nextLabel(prefix), capacity: z.capacity, shape }, meta);
      continue;
    }
    // Une case d'allée autour de chaque table.
    const pitchX = size.w + 2;
    const pitchY = size.h + 2;
    const cols = Math.max(1, Math.min(z.count, Math.ceil(Math.sqrt(z.count * 1.5)), Math.floor(PLAN.maxWidth / pitchX)));
    const rows = Math.ceil(z.count / cols);
    if (rows * pitchY > PLAN.maxHeight) throw new AppError('VALIDATION', `Trop de tables pour une seule zone « ${z.name} ».`);
    const zone = await createZone(
      ctx,
      scope,
      locationId,
      { name: z.name, planWidth: Math.max(PLAN.minWidth, cols * pitchX), planHeight: Math.max(PLAN.minHeight, rows * pitchY) },
      meta,
    );
    zones.push({ id: zone.id, name: zone.name });
    for (let i = 0; i < z.count; i++) {
      await createTable(ctx, scope, zone.id, { label: nextLabel(prefix), capacity: z.capacity, shape, x: 1 + (i % cols) * pitchX, y: 1 + Math.floor(i / cols) * pitchY }, meta);
    }
  }
  await writeAudit(ctx.db, ctx, {
    tenantId: scope.tenantId,
    locationId,
    actorUserId: scope.userId,
    action: 'setup.tables_generated',
    entityType: 'location',
    entityId: locationId,
    data: { zones: input.zones.map((z) => ({ name: z.name, count: z.count })) },
    meta,
  });
  return getFloor(ctx, scope, locationId);
}

// --- Commande de test ----------------------------------------------------------

/** Une vraie commande (caisse → postes → impression s'il y a des imprimantes), retrouvée dans le flux de la cuisine. */
export async function runSetupTest(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta): Promise<SetupTestOrder> {
  await assertLocation(ctx.db, scope, locationId);
  const candidates = await ctx.db
    .selectFrom('products as p')
    .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
    .select('p.id')
    .where('p.location_id', '=', locationId)
    .where('p.status', '=', 'ACTIVE')
    .where('p.is_available', '=', 1)
    .where('c.status', '=', 'ACTIVE')
    .orderBy('c.sort')
    .orderBy('p.sort')
    .limit(50)
    .execute();
  const pricing = await loadPricingProducts(ctx.db, locationId, candidates.map((c) => c.id), { includeHidden: true });
  let line: { productId: string; variantId: string | null; modifierIds: string[]; quantity: number } | null = null;
  for (const { id } of candidates) {
    const product = pricing.get(id);
    if (!product) continue;
    const variantId = product.variants.find((v) => v.isAvailable)?.id ?? null;
    const modifierIds = product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isAvailable).slice(0, g.minSelect).map((m) => m.id));
    if (priceLine(product, { variantId, modifierIds, quantity: 1 }).ok) {
      line = { productId: id, variantId, modifierIds, quantity: 1 };
      break;
    }
  }
  if (!line) throw new AppError('CONFLICT', 'Ajoutez au moins un produit disponible avant le test.');

  const created = await createStaffOrder(ctx, scope, locationId, { serviceType: 'TAKEAWAY', tableId: null, customerName: 'Test', note: SETUP_TEST_REASON, lines: [line] }, meta);
  await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'setup.test_order', entityType: 'order', entityId: created.id, data: { number: created.number }, meta });

  // Ce que lisent les écrans cuisine et bar : les commandes en cours de l'établissement.
  const seen = (await listOrders(ctx, scope, locationId, 'active')).find((o) => o.id === created.id);
  if (!seen) throw new AppError('CONFLICT', "La commande de test n'apparaît pas dans les commandes en cours.");
  const stationIds = [...new Set(seen.items.map((i) => i.stationId).filter((s): s is string => s !== null))];
  const stations = stationIds.length ? await ctx.db.selectFrom('stations').select(['id', 'name', 'kind']).where('id', 'in', stationIds).execute() : [];
  return {
    order: seen,
    stations: stations.map((s) => ({ id: s.id, name: s.name, kind: s.kind, items: seen.items.filter((i) => i.stationId === s.id).reduce((n, i) => n + i.quantity, 0) })),
  };
}

/** Nettoyage : annulation motivée (journal « commande annulée »), puis étape Test validée. */
export async function finishSetupTest(ctx: AppContext, auth: AuthState | null, scope: TenantScope, locationId: string, orderId: string, meta: RequestMeta): Promise<SetupStatus> {
  await assertLocation(ctx.db, scope, locationId);
  const marker = await ctx.db
    .selectFrom('audit_logs')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('location_id', '=', locationId)
    .where('action', '=', 'setup.test_order')
    .where('entity_id', '=', orderId)
    .executeTakeFirst();
  // Seule une commande créée par le test peut être annulée par cette route.
  if (!marker) throw new AppError('NOT_FOUND', 'Commande de test introuvable.');
  const order = await ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
  if (order.status !== 'CANCELLED') await updateOrderStatus(ctx, auth, orderId, 'CANCELLED', SETUP_TEST_REASON, meta);
  const already = await ctx.db.selectFrom('audit_logs').select('id').where('tenant_id', '=', scope.tenantId).where('location_id', '=', locationId).where('action', '=', 'setup.test_completed').executeTakeFirst();
  if (!already) {
    await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'setup.test_completed', entityType: 'order', entityId: orderId, meta });
  }
  return setupStatus(ctx, scope, locationId);
}
