import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AppError,
  businessDate,
  cataloguePrice,
  generateToken,
  roleCan,
  type AdminMenu,
  type Allergen,
  type DemoCredential,
  type DemoResult,
  type DemoTenant,
  type Order,
  type OrderLineInput,
  type Role,
  type StationKind,
} from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { AuthState, TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { register, revokeSession } from './auth.ts';
import { createStation, kitchenAction } from './kitchen.ts';
import { createCategory, createModifierGroup, createProduct, getAdminMenu, uploadMedia } from './menu.ts';
import { assertLocation, createServiceRequest, placeQrOrder, updateOrderStatus } from './orders.ts';
import { closeCashSession, createStaffOrder, getCurrentCashSession, openCashSession, recordPayment, setDiscount } from './pos.ts';
import { quickTables, setupStatus } from './setup.ts';
import { addMember } from './team.ts';

/**
 * Restaurant de démonstration (§71, décision I-8). Tout passe par les services du logiciel :
 * plan de salle, carte, équipe, commandes, cuisine, paiements et caisses sont de vraies écritures,
 * datées dans le passé en avançant l'horloge du contexte (jamais d'INSERT direct).
 *
 * - Organisation ordinaire : configuration seulement (salle, postes, carte) ; aucune vente inventée.
 * - Organisation marquée `is_demo` : en plus, l'équipe (mots de passe générés, montrés une fois),
 *   14 jours d'historique et des commandes en cours aujourd'hui.
 */

export interface DemoOptions {
  /** Jours d'historique avant aujourd'hui (14 par défaut). */
  days?: number;
  /** Commandes par jour d'historique, en moyenne (9 par défaut). */
  ordersPerDay?: number;
}

const DEMO_EMAIL_DOMAIN = 'demo.afrikaisse.invalid';
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(length = 12) {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
}

function randomSuffix() {
  return Array.from({ length: 6 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[randomInt(32)]).join('');
}

/** Tirages reproductibles (mulberry32) : même démonstration d'une installation à l'autre. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- La carte -------------------------------------------------------------------

type DemoDish = { name: string; price: number; image?: string; description?: string; tags?: string[]; allergens?: Allergen[]; prep?: number; groups?: string[]; variants?: [string, number][] };

const GROUPS: [string, number, number, [string, number][]][] = [
  ['Cuisson', 1, 1, [['Saignant', 0], ['À point', 0], ['Bien cuit', 0]]],
  ['Accompagnement', 1, 1, [['Frites', 0], ['Alloco', 0], ['Riz blanc', 0], ['Attiéké', 500]]],
  ['Suppléments', 0, 3, [['Fromage', 500], ['Œuf', 300], ['Bacon', 1000]]],
  ['Piment', 0, 1, [['Doux', 0], ['Pimenté', 0]]],
];

/** Plats du Tchad et d'Afrique de l'Ouest ; photos du catalogue (libres de droits). */
const CARTE: [string, string | null, DemoDish[]][] = [
  ['Entrées', null, [
    { name: 'Chourba', price: 1500, image: 'chourba.webp', description: 'Soupe de mouton aux légumes.', prep: 10 },
    { name: 'Samoussas (4 pièces)', price: 2000, image: 'samosa.webp', description: 'Chaussons croustillants à la viande hachée.', tags: ['Maison'], allergens: ['GLUTEN'], prep: 10 },
    { name: 'Salade composée', price: 2500, image: 'salade-composee.webp', prep: 10 },
  ]],
  ['Plats', null, [
    { name: 'Poulet yassa', price: 4000, image: 'yassa-poulet.webp', description: 'Poulet mariné aux oignons et citron.', tags: ['Spécialité'], prep: 20, groups: ['Accompagnement', 'Piment'] },
    { name: 'Riz sauce arachide', price: 3000, image: 'riz-sauce-arachide.webp', allergens: ['PEANUTS'], prep: 15, groups: ['Piment'] },
    { name: 'Kissar sauce gombo', price: 3000, image: 'kissar.webp', description: 'Galette de sorgho, sauce gombo à la viande.', tags: ['Tchad'], prep: 15, groups: ['Piment'] },
    { name: 'Attiéké poisson', price: 3500, image: 'attieke-poisson.webp', allergens: ['FISH'], prep: 20 },
    { name: 'Mafé', price: 3000, image: 'mafe.webp', allergens: ['PEANUTS'], prep: 20, groups: ['Piment'] },
    { name: 'Riz gras', price: 2500, image: 'riz-gras.webp', prep: 15 },
  ]],
  ['Grillades', 'Grill', [
    { name: 'Brochettes de bœuf', price: 3500, image: 'tchitchinga.webp', tags: ['Braise'], prep: 15, groups: ['Accompagnement', 'Piment'] },
    { name: 'Poisson capitaine braisé', price: 6000, image: 'capitaine-braise.webp', description: 'Capitaine entier, oignons et piment.', allergens: ['FISH'], prep: 25, groups: ['Accompagnement', 'Piment'] },
    { name: 'Demi-poulet braisé', price: 4500, image: 'poulet-braise.webp', prep: 20, groups: ['Accompagnement'] },
    { name: 'Mouton braisé', price: 4000, image: 'mouton-braise.webp', prep: 20, groups: ['Accompagnement'] },
  ]],
  ['Fast-food', null, [
    { name: 'Classic Burger', price: 5500, image: 'burger.webp', allergens: ['GLUTEN', 'MILK'], prep: 15, variants: [['Simple', 0], ['Double', 1500]], groups: ['Cuisson', 'Accompagnement', 'Suppléments'] },
    { name: 'Shawarma', price: 2000, image: 'shawarma.webp', allergens: ['GLUTEN'], prep: 10, groups: ['Piment'] },
  ]],
  ['Boissons', 'Bar', [
    { name: 'Jus de bissap', price: 1000, tags: ['Maison'], variants: [['33 cl', 0], ['1 litre', 1500]] },
    { name: 'Jus de baobab', price: 1000, image: 'jus-bouye.webp', tags: ['Maison'] },
    { name: 'Citronnade', price: 1000, image: 'citronnade.webp' },
    { name: 'Thé à la menthe', price: 500, image: 'the-menthe.webp' },
    { name: 'Café Touba', price: 800, image: 'cafe.webp' },
    { name: 'Eau minérale 1,5 l', price: 700, image: 'eau-minerale.webp' },
    { name: 'Soda 33 cl', price: 800, image: 'soda.webp' },
  ]],
  ['Desserts', null, [
    { name: 'Salade de fruits', price: 1500, image: 'salade-fruits.webp' },
    { name: 'Crêpes', price: 1500, image: 'crepes.webp', allergens: ['GLUTEN', 'EGGS', 'MILK'] },
    { name: 'Dégué', price: 1200, description: 'Mil et lait caillé sucré.', allergens: ['MILK'] },
  ]],
];

/** Photos du catalogue livrées avec les écrans : dossier de l'application servie, ou dépôt de développement. */
function catalogueImagesDir(ctx: AppContext): string | null {
  const candidates = [
    ctx.config.webDir ? join(ctx.config.webDir, 'catalogue', 'images') : null,
    resolve('apps/web/public/catalogue/images'),
    resolve('apps/web/dist/catalogue/images'),
    resolve('../../apps/web/public/catalogue/images'),
  ];
  return candidates.find((dir): dir is string => dir !== null && existsSync(dir)) ?? null;
}

const STAFF: [Role, string, string][] = [
  ['MANAGER', 'Mahamat Abakar', 'gerant'],
  ['CASHIER', 'Achta Moussa', 'caisse'],
  ['WAITER', 'Brahim Saleh', 'serveur'],
  ['WAITER', 'Fatimé Haroun', 'serveuse'],
  ['KITCHEN', 'Djibrine Ali', 'cuisine'],
  ['BAR', 'Awa Diallo', 'bar'],
  ['STOCK_MANAGER', 'Hassan Idriss', 'stock'],
];

type Staff = { manager: TenantScope; cashier: TenantScope; waiters: TenantScope[]; cook: TenantScope; barman: TenantScope };

/** État de session équivalent à celui d'un membre connecté, pour les services qui le demandent. */
function authOf(s: TenantScope): AuthState {
  return {
    userId: s.userId,
    sessionId: s.sessionId,
    email: null,
    displayName: '',
    isPlatformAdmin: false,
    tenantId: s.tenantId,
    tenantName: null,
    tenantStatus: 'ACTIVE',
    tenantIsDemo: true,
    tenantPlan: null,
    tenantPlanExpiresAt: null,
    membershipId: s.membershipId,
    role: s.role,
    locationId: s.locationId,
    tenantAccess: 'OK',
  };
}

// --- Installation ------------------------------------------------------------------

export async function loadDemoRestaurant(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta, options: DemoOptions = {}): Promise<DemoResult> {
  if (!roleCan(scope.role, 'tables.manage') || !roleCan(scope.role, 'menu.manage')) throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas de préparer le plan de salle.');
  await assertLocation(ctx.db, scope, locationId);
  const tenant = await ctx.db.selectFrom('tenants').select('is_demo').where('id', '=', scope.tenantId).executeTakeFirstOrThrow();
  const isDemo = tenant.is_demo === 1;
  if (isDemo && scope.role !== 'OWNER' && scope.role !== 'ADMIN') throw new AppError('FORBIDDEN', "Seul le propriétaire installe la démonstration et son équipe.");
  const before = await setupStatus(ctx, scope, locationId);
  if (before.tables > 0 || before.products > 0) {
    throw new AppError('CONFLICT', "Cet établissement contient déjà des tables ou des produits : la démonstration ne s'installe que sur un établissement vide.");
  }
  const loaded = await ctx.db.selectFrom('audit_logs').select('id').where('tenant_id', '=', scope.tenantId).where('action', '=', 'demo.loaded').executeTakeFirst();
  if (loaded) throw new AppError('CONFLICT', 'La démonstration est déjà installée dans cette organisation.');

  // 20 tables : 12 en salle, 8 en terrasse, plan en rangées.
  await quickTables(ctx, scope, locationId, { zones: [{ name: 'Salle', count: 12, capacity: 4, prefix: 'T' }, { name: 'Terrasse', count: 8, capacity: 2, shape: 'ROUND', prefix: 'TE' }] }, meta);
  const menu = await installMenu(ctx, scope, locationId, meta);

  let staff: DemoCredential[] = [];
  let orders = 0;
  if (isDemo) {
    const team = await createStaff(ctx, scope, meta);
    staff = team.credentials;
    orders = await generateActivity(ctx, locationId, team.staff, menu, meta, options);
  }
  await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'demo.loaded', entityType: 'location', entityId: locationId, data: { withActivity: isDemo, orders }, meta });
  return { ...(await setupStatus(ctx, scope, locationId)), staff };
}

async function installMenu(ctx: AppContext, scope: TenantScope, locationId: string, meta: RequestMeta): Promise<AdminMenu> {
  const location = await ctx.db.selectFrom('locations').select('currency').where('id', '=', locationId).executeTakeFirstOrThrow();
  const price = (fcfa: number) => (fcfa === 0 ? 0 : cataloguePrice(fcfa, location.currency));

  // Cuisine et Bar existent dès la création de l'établissement ; le grill s'ajoute.
  let stations = (await getAdminMenu(ctx, scope, locationId)).stations;
  for (const [name, kind] of [['Cuisine', 'KITCHEN'], ['Bar', 'BAR'], ['Grill', 'KITCHEN']] as [string, StationKind][]) {
    if (!stations.some((s) => s.name === name)) stations = await createStation(ctx, scope, locationId, { name, kind }, meta);
  }
  const stationId = (name: string | null) => (name ? (stations.find((s) => s.name === name)?.id ?? null) : null);

  let menu = await getAdminMenu(ctx, scope, locationId);
  for (const [name, minSelect, maxSelect, options] of GROUPS) {
    menu = await createModifierGroup(ctx, scope, locationId, { name, minSelect, maxSelect, modifiers: options.map(([n, d]) => ({ name: n, priceDelta: price(d), isAvailable: true })) }, meta);
  }
  const groupId = (name: string) => menu.modifierGroups.find((g) => g.name === name)!.id;
  const images = catalogueImagesDir(ctx);

  for (const [categoryName, station, dishes] of CARTE) {
    menu = await createCategory(ctx, scope, locationId, { name: categoryName, isVisible: true }, meta);
    const categoryId = menu.categories.find((c) => c.name === categoryName)!.id;
    for (const dish of dishes) {
      let photoMediaId: string | null = null;
      const file = images && dish.image ? join(images, dish.image) : null;
      if (file && existsSync(file)) {
        // Même contrôle qu'une photo prise sur la tablette (type réel, taille, dimensions).
        photoMediaId = (await uploadMedia(ctx, scope, locationId, { contentType: 'image/webp', dataBase64: readFileSync(file).toString('base64') }, meta)).id;
      }
      menu = await createProduct(
        ctx,
        scope,
        categoryId,
        {
          name: dish.name,
          description: dish.description ?? null,
          price: price(dish.price),
          promoPrice: null,
          prepTimeMin: dish.prep ?? null,
          stationId: stationId(station),
          isAvailable: true,
          tags: dish.tags ?? [],
          allergens: dish.allergens ?? [],
          photoMediaId,
          variants: (dish.variants ?? []).map(([name, delta]) => ({ name, priceDelta: price(delta), isAvailable: true })),
          modifierGroupIds: (dish.groups ?? []).map(groupId),
        },
        meta,
      );
    }
  }
  return menu;
}

/** Un compte par métier, avec un mot de passe généré : il n'est rendu qu'une fois, dans la réponse. */
async function createStaff(ctx: AppContext, owner: TenantScope, meta: RequestMeta): Promise<{ staff: Staff; credentials: DemoCredential[] }> {
  const suffix = randomSuffix();
  const credentials: DemoCredential[] = [];
  const scopes: TenantScope[] = [];
  for (const [role, displayName, slug] of STAFF) {
    const email = `${slug}.${suffix}@${DEMO_EMAIL_DOMAIN}`;
    const password = generatePassword();
    const member = await addMember(ctx, owner, { displayName, email, password, role, locationId: null }, meta);
    credentials.push({ displayName, role, email, password });
    scopes.push({ userId: member.userId, sessionId: owner.sessionId, tenantId: owner.tenantId, membershipId: member.membershipId, role, locationId: null });
  }
  const byRole = (role: Role) => scopes.filter((s) => s.role === role);
  return { staff: { manager: byRole('MANAGER')[0]!, cashier: byRole('CASHIER')[0]!, waiters: byRole('WAITER'), cook: byRole('KITCHEN')[0]!, barman: byRole('BAR')[0]! }, credentials };
}

// --- Historique et service du jour ---------------------------------------------------

/** Décalage du fuseau à un instant donné (ms). */
function tzOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

/** Instant UTC d'une heure locale (minutes après minuit) d'une date AAAA-MM-JJ. */
function localInstant(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  return guess - tzOffset(guess, timeZone);
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const MINUTE = 60_000;

async function generateActivity(ctx: AppContext, locationId: string, staff: Staff, menu: AdminMenu, meta: RequestMeta, options: DemoOptions): Promise<number> {
  const days = Math.max(0, Math.min(options.days ?? 14, 60));
  const perDay = Math.max(1, Math.min(options.ordersPerDay ?? 9, 40));
  const location = await ctx.db.selectFrom('locations').select(['timezone', 'business_day_cutoff_min']).where('id', '=', locationId).executeTakeFirstOrThrow();
  const tz = location.timezone;
  const realNow = ctx.now();
  const today = businessDate(realNow, tz, location.business_day_cutoff_min);
  const random = prng(20260915);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  // Le contexte « à l'heure t » : les services datent leurs écritures avec ctx.now().
  const at = (t: number): AppContext => ({ ...ctx, now: () => Math.min(t, realNow) });

  const tables = await ctx.db
    .selectFrom('dining_tables as t')
    .innerJoin('qr_codes as q', (j) => j.onRef('q.table_id', '=', 't.id').on('q.revoked_at', 'is', null))
    .select(['t.id', 'q.token'])
    .where('t.location_id', '=', locationId)
    .where('t.status', '=', 'ACTIVE')
    .execute();
  const busyUntil = new Map<string, number>();
  const stationKind = new Map(menu.stations.map((s) => [s.id, s.kind]));
  // Les plats principaux se vendent plus que les desserts : tirage pondéré par catégorie.
  const weights: Record<string, number> = { Plats: 5, Grillades: 4, Boissons: 6, 'Fast-food': 2, Entrées: 2, Desserts: 1 };
  const weighted = menu.products.flatMap((p) => Array<typeof p>(weights[menu.categories.find((c) => c.id === p.categoryId)?.name ?? ''] ?? 1).fill(p));
  let count = 0;

  const lineFor = (product: AdminMenu['products'][number]): OrderLineInput => {
    const variants = product.variants.filter((v) => v.isAvailable);
    const modifierIds: string[] = [];
    for (const groupId of product.modifierGroupIds) {
      const group = menu.modifierGroups.find((g) => g.id === groupId)!;
      const available = group.modifiers.filter((m) => m.isAvailable);
      const n = group.minSelect > 0 ? group.minSelect : random() < 0.25 ? 1 : 0;
      for (let i = 0; i < n && i < available.length; i++) modifierIds.push(available[(Math.floor(random() * available.length) + i) % available.length]!.id);
    }
    return { productId: product.id, variantId: variants.length ? pick(variants).id : null, modifierIds: [...new Set(modifierIds)], quantity: random() < 0.8 ? 1 : 2 };
  };
  const basket = () => {
    const lines: OrderLineInput[] = [];
    const size = 1 + Math.floor(random() * 3);
    const used = new Set<string>();
    while (lines.length < size) {
      const product = pick(weighted);
      if (used.has(product.id)) continue;
      used.add(product.id);
      lines.push(lineFor(product));
    }
    return lines;
  };

  /** Chaque poste de l'article marque ses articles prêts (cuisinier ou barman). */
  const kitchen = async (order: Order, t: number, action: 'START' | 'READY') => {
    let current = order;
    for (const stationId of new Set(order.items.map((i) => i.stationId).filter((s): s is string => s !== null))) {
      const actor = stationKind.get(stationId) === 'BAR' ? staff.barman : staff.cook;
      current = await kitchenAction(at(t), authOf(actor), order.id, { stationId, action }, meta);
    }
    return current;
  };

  /** Une commande de A à Z ; `stop` arrête le service à un état donné (commandes en cours du jour). */
  const serve = async (t: number, stop: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'PAID') => {
    const waiter = pick(staff.waiters);
    const free = tables.filter((x) => (busyUntil.get(x.id) ?? 0) < t);
    const r = random();
    // La commande servie du jour est toujours en salle : c'est sa table qui demande l'addition, quelle que soit l'heure.
    const kind: 'QR' | 'WAITER' | 'TAKEAWAY' = stop === 'PENDING' ? 'QR' : stop === 'SERVED' ? 'WAITER' : free.length === 0 ? 'TAKEAWAY' : r < 0.18 ? 'QR' : r < 0.68 ? 'WAITER' : 'TAKEAWAY';
    const table = kind === 'TAKEAWAY' ? null : pick(free.length ? free : tables);
    if (table) busyUntil.set(table.id, stop === 'PAID' ? t + 70 * MINUTE : Number.MAX_SAFE_INTEGER);
    count += 1;

    let order: Order;
    if (kind === 'QR') {
      const placed = await placeQrOrder(at(t), table!.token, { clientToken: generateToken(16), lines: basket(), note: null }, meta);
      if (stop === 'PENDING') return;
      order = await updateOrderStatus(at(t + 2 * MINUTE), authOf(waiter), placed.id, 'CONFIRMED', undefined, meta);
    } else {
      const actor = kind === 'WAITER' ? waiter : staff.cashier;
      order = await createStaffOrder(at(t), actor, locationId, { serviceType: table ? 'DINE_IN' : 'TAKEAWAY', tableId: table?.id ?? null, customerName: table ? null : pick(['Awa', 'Moussa', 'Khadija', 'Idriss', 'Mariam', 'Oumar']), lines: basket(), note: null }, meta);
    }
    if (stop === 'CONFIRMED') return;

    if (stop === 'PAID' && random() < 0.06) {
      await updateOrderStatus(at(t + 6 * MINUTE), authOf(staff.manager), order.id, 'CANCELLED', pick(['Client parti avant le service', 'Erreur de saisie', 'Plat indisponible']), meta);
      if (table) busyUntil.set(table.id, t + 7 * MINUTE);
      return;
    }
    if (stop === 'PAID' && random() < 0.05) {
      order = await setDiscount(at(t + 3 * MINUTE), staff.manager, order.id, { kind: 'PERCENT', value: 10, reason: 'Client fidèle' }, meta);
    }
    if (stop === 'PREPARING') {
      await kitchen(order, t + 4 * MINUTE, 'START');
      return;
    }
    order = await kitchen(order, t + (12 + Math.floor(random() * 10)) * MINUTE, 'READY');
    if (stop === 'READY') return;
    order = await updateOrderStatus(at(t + 26 * MINUTE), authOf(table ? waiter : staff.cashier), order.id, 'SERVED', undefined, meta);
    if (stop === 'SERVED') {
      if (table) await createServiceRequest(ctx, table.token, { clientToken: generateToken(16), kind: 'BILL' });
      return;
    }

    const amount = order.total - order.paid;
    const m = random();
    const method = m < 0.6 ? 'CASH' : m < 0.93 ? 'MOBILE_MONEY' : 'CARD';
    await recordPayment(at(t + (45 + Math.floor(random() * 20)) * MINUTE), staff.cashier, locationId, {
      target: order.sessionId ? { kind: 'session', id: order.sessionId } : { kind: 'order', id: order.id },
      method,
      amount,
      tendered: method === 'CASH' ? (random() < 0.5 ? Math.ceil(amount / 1000) * 1000 : amount) : null,
      provider: method === 'MOBILE_MONEY' ? pick(['Airtel Money', 'Moov Money']) : null,
      reference: method === 'CASH' ? null : String(100000000 + Math.floor(random() * 899999999)),
    });
  };

  // Jours passés : ouverture à 10 h 30, service de 11 h à 22 h 30, clôture Z à 23 h 30.
  for (let d = days; d >= 1; d--) {
    const date = shiftDate(today, -d);
    const n = Math.max(1, perDay + Math.floor(random() * 5) - 2 + ([5, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 3 : 0));
    const drawer = await openCashSession(at(localInstant(date, 630, tz)), staff.cashier, locationId, { openingFloat: 20000 }, meta);
    const span = (22.5 - 11) * 60;
    for (let i = 0; i < n; i++) {
      await serve(localInstant(date, 660 + Math.floor((span * i) / n + random() * 20), tz), 'PAID');
    }
    const { session } = await getCurrentCashSession(ctx, staff.cashier, locationId);
    const expected = session?.summary.expectedCash ?? 20000;
    await closeCashSession(at(localInstant(date, 1410, tz)), staff.manager, drawer.id, { countedCash: expected - (d % 5 === 0 ? 500 : 0), note: d % 5 === 0 ? 'Écart de monnaie' : null }, meta);
  }

  // Aujourd'hui : quelques commandes réglées, puis le service en cours dans tous ses états.
  const floor = localInstant(today, location.business_day_cutoff_min, tz) + MINUTE;
  const end = realNow - 2 * MINUTE;
  const start = Math.max(floor, Math.min(localInstant(today, 660, tz), end - 3 * 60 * MINUTE));
  const moments = (k: number, from: number, to: number) => Array.from({ length: k }, (_, i) => from + Math.floor(((Math.max(to, from) - from) * (i + 1)) / (k + 1)));
  await openCashSession(at(Math.min(start, end)), staff.cashier, locationId, { openingFloat: 20000 }, meta);
  const middle = start + Math.floor((Math.max(end, start) - start) * 0.55);
  for (const t of moments(4, start, middle)) await serve(t, 'PAID');
  const live: ('SERVED' | 'READY' | 'PREPARING' | 'CONFIRMED' | 'PENDING')[] = ['SERVED', 'READY', 'PREPARING', 'CONFIRMED', 'PENDING'];
  for (const [i, t] of moments(live.length, middle, end).entries()) await serve(t, live[i]!);
  return count;
}

// --- Organisation de démonstration (prospects) ------------------------------------------------

/**
 * Crée une organisation « AfriKaisse Demo Restaurant » prête à présenter : propriétaire, équipe,
 * salle, carte, historique. Une nouvelle organisation à chaque appel, isolée comme un client.
 */
export async function createDemoTenant(ctx: AppContext, meta: RequestMeta, input: { email?: string; password?: string } & DemoOptions = {}): Promise<DemoTenant> {
  const owner: DemoCredential = {
    displayName: 'Propriétaire Démo',
    role: 'OWNER',
    email: (input.email ?? `proprietaire.${randomSuffix()}@${DEMO_EMAIL_DOMAIN}`).trim().toLowerCase(),
    password: input.password ?? generatePassword(),
  };
  const organizationName = 'AfriKaisse Demo Restaurant';
  const issued = await register(
    ctx,
    { organizationName, locationName: organizationName, locationType: 'RESTAURANT', currency: 'XAF', timezone: 'Africa/Ndjamena', country: 'TD', ownerName: owner.displayName, email: owner.email, password: owner.password },
    meta,
  );
  // La session ouverte par l'inscription ne sert à personne.
  await revokeSession(ctx.db, ctx, issued.sessionId, 'demo_setup');
  const membership = await ctx.db.selectFrom('memberships').select(['id', 'tenant_id']).where('user_id', '=', issued.userId).executeTakeFirstOrThrow();
  const location = await ctx.db.selectFrom('locations').select('id').where('tenant_id', '=', membership.tenant_id).executeTakeFirstOrThrow();
  const tenantId = membership.tenant_id;

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('tenants').set({ is_demo: 1, plan_expires_at: null, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', tenantId).execute();
    const row = await trx.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId, entityType: 'tenant', entityId: tenantId, operation: 'UPSERT', payload: row, hlc });
    await writeAudit(trx, ctx, { tenantId, actorUserId: issued.userId, action: 'demo.tenant_created', entityType: 'tenant', entityId: tenantId, meta });
  });

  const scope: TenantScope = { userId: issued.userId, sessionId: issued.sessionId, tenantId, membershipId: membership.id, role: 'OWNER', locationId: null };
  const { staff, ...status } = await loadDemoRestaurant(ctx, scope, location.id, meta, input);
  return { tenantId, locationId: location.id, organizationName, owner, staff, status };
}
