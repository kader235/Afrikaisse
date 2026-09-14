import { AppError, roleCan, type AdminMenu, type CreateProductInput, type CurrencyCode, type SetupStatus, type TableShape } from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { writeAudit } from '../lib/journal.ts';
import { createTable, createZone } from './floor.ts';
import { createStation } from './kitchen.ts';
import { createCategory, createModifierGroup, createProduct } from './menu.ts';
import { assertLocation } from './orders.ts';

/**
 * Mise en route d'un établissement (§70) et restaurant de démonstration (§71).
 * La démonstration passe par les mêmes services qu'une saisie à la main : QR des tables, postes,
 * journal de synchronisation et règles de validation sont exactement ceux du vrai logiciel.
 */

const count = async (db: Db, table: 'zones' | 'dining_tables' | 'menu_categories' | 'products' | 'stations', locationId: string) =>
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

export async function setupStatus(ctx: AppContext, scope: TenantScope, locationId: string): Promise<SetupStatus> {
  await assertLocation(ctx.db, scope, locationId);
  const db = ctx.db;
  const [zones, tables, categories, products, stations, members, cashSessions, orders] = await Promise.all([
    count(db, 'zones', locationId),
    count(db, 'dining_tables', locationId),
    count(db, 'menu_categories', locationId),
    count(db, 'products', locationId),
    count(db, 'stations', locationId),
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
  ]);
  return { locationId, zones, tables, categories, products, stations, members, cashSessions, orders, complete: tables > 0 && products > 0 };
}

/** Prix de la carte en FCFA ; convertis en centimes pour une monnaie à deux décimales. */
function priceIn(currency: CurrencyCode) {
  const noDecimals = ['XAF', 'XOF', 'GNF', 'KMF'].includes(currency);
  return (fcfa: number) => (noDecimals ? fcfa : Math.max(50, Math.round((fcfa / 655.957) * 100 / 50) * 50));
}

type DemoProduct = Partial<CreateProductInput> & { name: string; price: number; groups?: string[] };

export async function loadDemoRestaurant(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta): Promise<SetupStatus> {
  if (!roleCan(scope.role, 'tables.manage')) throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas de préparer le plan de salle.');
  const location = await assertLocation(ctx.db, scope, locationId);
  const before = await setupStatus(ctx, scope, locationId);
  if (before.tables > 0 || before.products > 0) {
    throw new AppError('CONFLICT', "Cet établissement contient déjà des tables ou des produits : la démonstration ne s'installe que sur un établissement vide.");
  }
  const price = priceIn(location.currency);
  const delta = (fcfa: number) => (fcfa === 0 ? 0 : price(fcfa));

  // Salle et terrasse.
  const salle = await createZone(ctx, scope, locationId, { name: 'Salle', planWidth: 24, planHeight: 16 }, meta);
  const terrasse = await createZone(ctx, scope, locationId, { name: 'Terrasse', planWidth: 16, planHeight: 10 }, meta);
  const tables: [string, string, number, TableShape][] = [
    [salle.id, 'T1', 2, 'SQUARE'],
    [salle.id, 'T2', 4, 'SQUARE'],
    [salle.id, 'T3', 4, 'SQUARE'],
    [salle.id, 'T4', 4, 'ROUND'],
    [salle.id, 'T5', 6, 'RECT'],
    [salle.id, 'T6', 8, 'RECT'],
    [terrasse.id, 'TE1', 2, 'ROUND'],
    [terrasse.id, 'TE2', 2, 'ROUND'],
    [terrasse.id, 'TE3', 4, 'SQUARE'],
    [terrasse.id, 'TE4', 4, 'SQUARE'],
  ];
  for (const [zoneId, label, capacity, shape] of tables) await createTable(ctx, scope, zoneId, { label, capacity, shape }, meta);

  // Postes : Cuisine et Bar existent déjà ; un grill pour les braises.
  const stations = await createStation(ctx, scope, locationId, { name: 'Grill', kind: 'KITCHEN' }, meta);
  const stationId = (name: string) => stations.find((s) => s.name === name)?.id ?? null;

  // Options réutilisées par plusieurs plats.
  let menu: AdminMenu | undefined;
  const groups: [string, number, number, [string, number][]][] = [
    ['Cuisson', 1, 1, [['Saignant', 0], ['À point', 0], ['Bien cuit', 0]]],
    ['Accompagnement', 1, 1, [['Frites', 0], ['Alloco', 0], ['Riz blanc', 0], ['Attiéké', 500]]],
    ['Suppléments', 0, 3, [['Fromage', 500], ['Œuf', 300], ['Bacon', 1000]]],
    ['Piment', 0, 1, [['Doux', 0], ['Pimenté', 0]]],
  ];
  for (const [name, minSelect, maxSelect, options] of groups) {
    menu = await createModifierGroup(ctx, scope, locationId, { name, minSelect, maxSelect, modifiers: options.map(([n, d]) => ({ name: n, priceDelta: delta(d), isAvailable: true })) }, meta);
  }
  const groupId = (name: string) => menu!.modifierGroups.find((g) => g.name === name)!.id;

  const carte: [string, boolean, string | null, DemoProduct[]][] = [
    ['Entrées', true, null, [
      { name: 'Salade avocat-crevettes', price: 3500, description: 'Avocat, crevettes, vinaigrette citron vert.', allergens: ['CRUSTACEANS'], prepTimeMin: 10 },
      { name: 'Sambossas (4 pièces)', price: 2000, description: 'Chaussons croustillants à la viande hachée.', tags: ['Maison'], allergens: ['GLUTEN'], prepTimeMin: 10 },
      { name: 'Soupe de poisson', price: 3000, allergens: ['FISH'], prepTimeMin: 15 },
    ]],
    ['Plats', true, null, [
      { name: 'Poulet yassa', price: 4000, description: 'Poulet mariné aux oignons et citron.', tags: ['Spécialité'], prepTimeMin: 20, groups: ['Accompagnement', 'Piment'] },
      { name: 'Riz sauce arachide', price: 3500, allergens: ['PEANUTS'], prepTimeMin: 15, groups: ['Piment'] },
      { name: 'Thiéboudienne', price: 4500, description: 'Riz au poisson et légumes.', allergens: ['FISH'], prepTimeMin: 25 },
      { name: 'Kissar sauce gombo', price: 3000, description: 'Galette de sorgho, sauce gombo à la viande.', tags: ['Tchad'], prepTimeMin: 15, groups: ['Piment'] },
      { name: 'Classic Burger', price: 5500, allergens: ['GLUTEN', 'MILK'], prepTimeMin: 15, variants: [{ name: 'Simple', priceDelta: 0, isAvailable: true }, { name: 'Double', priceDelta: 1500, isAvailable: true }], groups: ['Cuisson', 'Accompagnement', 'Suppléments'] },
    ]],
    ['Grillades', true, 'Grill', [
      { name: 'Brochettes de bœuf', price: 3500, tags: ['Braise'], prepTimeMin: 15, groups: ['Accompagnement', 'Piment'] },
      { name: 'Poisson braisé', price: 6000, description: 'Capitaine entier, oignons et piment.', allergens: ['FISH'], prepTimeMin: 25, groups: ['Accompagnement', 'Piment'] },
      { name: 'Demi-poulet braisé', price: 4500, prepTimeMin: 20, groups: ['Accompagnement'] },
    ]],
    ['Boissons', true, 'Bar', [
      { name: 'Jus de bissap', price: 1000, tags: ['Maison'], variants: [{ name: '33 cl', priceDelta: 0, isAvailable: true }, { name: '1 litre', priceDelta: 1500, isAvailable: true }] },
      { name: 'Jus de gingembre', price: 1000, tags: ['Maison'] },
      { name: 'Eau minérale 1,5 l', price: 700 },
      { name: 'Café Touba', price: 800 },
      { name: 'Soda 33 cl', price: 800 },
    ]],
    ['Desserts', true, null, [
      { name: 'Salade de fruits', price: 1500 },
      { name: 'Dégué', price: 1200, description: 'Mil et lait caillé sucré.', allergens: ['MILK'] },
      { name: 'Beignets (6)', price: 1000, allergens: ['GLUTEN', 'EGGS'] },
    ]],
  ];
  for (const [categoryName, isVisible, station, products] of carte) {
    menu = await createCategory(ctx, scope, locationId, { name: categoryName, isVisible }, meta);
    const categoryId = menu.categories.find((c) => c.name === categoryName)!.id;
    for (const p of products) {
      await createProduct(
        ctx,
        scope,
        categoryId,
        {
          name: p.name,
          description: p.description ?? null,
          price: price(p.price),
          promoPrice: null,
          prepTimeMin: p.prepTimeMin ?? null,
          stationId: station ? stationId(station) : null,
          isAvailable: true,
          tags: p.tags ?? [],
          allergens: p.allergens ?? [],
          photoMediaId: null,
          variants: (p.variants ?? []).map((v) => ({ ...v, priceDelta: delta(v.priceDelta) })),
          modifierGroupIds: (p.groups ?? []).map(groupId),
        },
        meta,
      );
    }
  }

  await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'demo.loaded', entityType: 'location', entityId: locationId, meta });
  return setupStatus(ctx, scope, locationId);
}
