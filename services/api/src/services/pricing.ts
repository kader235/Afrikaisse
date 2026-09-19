import type { Selectable } from 'kysely';
import {
  AppError,
  computeTotals,
  formatMoney,
  isScheduled,
  localMoment,
  normalizeCode,
  priceOrder,
  promoCodeMessage,
  resolveTaxRateId,
  uuidv7,
  type AppliedPromotion,
  type CurrencyCode,
  type OrderPricing,
  type PricingConfig,
  type PricingSettingsInput,
  type Promotion,
  type PromotionInput,
  type PromotionRule,
  type PublicPricing,
  type Quote,
  type QuoteInput,
  type TaxLine,
  type TaxMode,
  type TaxRateInput,
  type UpdateTaxRateInput,
} from '@afrikaisse/core';
import type { PromotionsTable, TaxRatesTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';
import { emitRow } from './menu.ts';
import { resolveDailyMenuProductIds } from './dailyMenu.ts';
import { loadPricingProducts, priceLines, resolveQr, type Priced } from './orders.ts';

/**
 * Taxes par établissement (§47) et promotions (§48), côté serveur, qui fait foi.
 *
 * - Le calcul est celui de @afrikaisse/core (taxes.ts, promotions.ts) : la caisse et le menu client
 *   affichent le même total, le serveur le refait à chaque commande avec les réglages du moment.
 * - La commande garde ses taux, ses promotions et ses montants : modifier un taux ou une promotion
 *   ne réécrit jamais l'historique ; une remise manuelle ultérieure recalcule les taxes avec les
 *   taux figés sur les lignes.
 * - Une utilisation = une commande non annulée qui a bénéficié de la promotion ; le nombre maximal
 *   est revérifié dans la transaction de la commande (ligne verrouillée en PostgreSQL).
 * - Portée : organisation de la session et, pour un membre rattaché, son seul établissement (404).
 */

type PromotionRow = Selectable<PromotionsTable>;
type RateRow = Selectable<TaxRatesTable>;

export interface LinePricing {
  promotionId: string | null;
  promotionDiscount: number;
  codeDiscount: number;
  taxRateId: string | null;
  taxRateBp: number | null;
  taxName: string | null;
}

const ENTITY = { pricing_settings: 'pricing_settings', tax_rates: 'tax_rate', promotions: 'promotion' } as const;

async function emit(trx: Db, ctx: AppContext, table: keyof typeof ENTITY, id: string, hlc: string) {
  const row = (await trx.selectFrom(table as 'promotions').selectAll().where('id', '=', id).executeTakeFirstOrThrow()) as unknown as { tenant_id: string; location_id: string };
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: ENTITY[table], entityId: id, operation: 'UPSERT', payload: row, hlc });
}

export const daysToMask = (days: number[]) => days.reduce((mask, d) => mask | (1 << (d - 1)), 0);
export const maskToDays = (mask: number) => [1, 2, 3, 4, 5, 6, 7].filter((d) => (mask & (1 << (d - 1))) !== 0);

function toRule(r: PromotionRow): PromotionRule {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    scope: r.scope,
    targetId: r.target_id,
    value: Number(r.value),
    buyQuantity: r.buy_quantity,
    freeQuantity: r.free_quantity,
    minAmount: r.min_amount === null ? null : Number(r.min_amount),
    code: r.code,
    startDate: r.start_date,
    endDate: r.end_date,
    days: maskToDays(r.days_mask),
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    isActive: r.is_active === 1,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
export const parseTaxes = (value: string | null) => parseJson<TaxLine[]>(value, []);
export const parseApplied = (value: string | null) => parseJson<AppliedPromotion[]>(value, []);

// --- Chargements bornés -----------------------------------------------------

async function loadLocation(db: Db, scope: TenantScope, id: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== id) throw notFound;
  const row = await db.selectFrom('locations').select(['id', 'name', 'currency', 'timezone', 'status']).where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

async function loadScoped<T extends { location_id: string; status: string }>(db: Db, scope: TenantScope, table: 'tax_rates' | 'promotions' | 'menu_categories' | 'products', id: string, label: string): Promise<T> {
  const row = (await db.selectFrom(table as 'promotions').selectAll().where('id', '=', id).where('tenant_id', '=', scope.tenantId).executeTakeFirst()) as unknown as T | undefined;
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', `${label} introuvable.`);
  return row;
}

function assertActive(status: string, message: string) {
  if (status !== 'ACTIVE') throw new AppError('CONFLICT', message);
}

export async function readSettings(db: Db, locationId: string): Promise<{ taxMode: TaxMode; defaultTaxRateId: string | null }> {
  const row = await db.selectFrom('pricing_settings').select(['tax_mode', 'default_tax_rate_id']).where('location_id', '=', locationId).executeTakeFirst();
  return { taxMode: row?.tax_mode ?? 'INCLUSIVE', defaultTaxRateId: row?.default_tax_rate_id ?? null };
}

const activeRates = (db: Db, locationId: string) => db.selectFrom('tax_rates').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute();

// L'ordre de création départage deux promotions également avantageuses.
const activePromotions = (db: Db, locationId: string) =>
  db.selectFrom('promotions').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('created_at').orderBy('id').execute();

async function assertRate(db: Db, locationId: string, rateId: string) {
  const rate = await db.selectFrom('tax_rates').select('status').where('id', '=', rateId).where('location_id', '=', locationId).executeTakeFirst();
  if (!rate) throw new AppError('NOT_FOUND', 'Taux de taxe introuvable.');
  assertActive(rate.status, 'Ce taux de taxe est archivé.');
}

/** Utilisations : commandes non annulées qui ont bénéficié de chaque promotion. */
export async function countUses(db: Db, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const seen = new Map(ids.map((id) => [id, new Set<string>()]));
  const add = (rows: { id: string; pid: string | null }[]) => rows.forEach((r) => r.pid && seen.get(r.pid)?.add(r.id));
  // Requêtes l'une après l'autre : appelée aussi dans une transaction (une seule connexion).
  add(await db.selectFrom('orders').select(['id', 'promo_code_promotion_id as pid']).where('promo_code_promotion_id', 'in', ids).where('status', '!=', 'CANCELLED').execute());
  add(await db.selectFrom('orders').select(['id', 'order_promotion_id as pid']).where('order_promotion_id', 'in', ids).where('status', '!=', 'CANCELLED').execute());
  add(
    await db
      .selectFrom('order_items as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select(['o.id', 'i.promotion_id as pid'])
      .where('i.promotion_id', 'in', ids)
      .where('o.status', '!=', 'CANCELLED')
      .execute(),
  );
  return new Map([...seen].map(([id, orders]) => [id, orders.size]));
}

// --- Calcul d'une commande ---------------------------------------------------

export interface PricedOrder {
  lines: Priced[];
  pricing: OrderPricing;
  taxMode: TaxMode;
  currency: CurrencyCode;
  /** Promotions appliquées qui ont un nombre maximal d'utilisations. */
  limits: { id: string; name: string; maxUses: number; isCode: boolean }[];
}

/**
 * Promotions et taxes des lignes déjà validées (prix du menu du moment). Lève CONFLICT si le code
 * promo est inconnu, épuisé ou inapplicable : le client le corrige ou le retire.
 */
export async function priceOrderLines(db: Db, location: { id: string; timezone: string; currency: CurrencyCode }, lines: Priced[], promoCode: string | null | undefined, now: number): Promise<PricedOrder> {
  const money = (v: number) => formatMoney(v, location.currency);
  const [settings, rates, promotionRows] = [await readSettings(db, location.id), await activeRates(db, location.id), await activePromotions(db, location.id)];
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = productIds.length
    ? await db
        .selectFrom('products as p')
        .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
        .select(['p.id', 'p.category_id', 'p.tax_rate_id', 'c.tax_rate_id as category_tax_rate_id'])
        .where('p.id', 'in', productIds)
        .execute()
    : [];
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const rateById = new Map(rates.map((r) => [r.id, { id: r.id, name: r.name, rateBp: r.rate_bp }]));

  let code: PromotionRow | null = null;
  const typed = promoCode?.trim();
  if (typed) {
    code = promotionRows.find((p) => p.code_key === normalizeCode(typed)) ?? null;
    if (!code) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'UNKNOWN' }, money));
  }
  // Promotion épuisée : automatique, elle est ignorée ; code, il est refusé.
  const limited = promotionRows.filter((p) => p.max_uses !== null && (p.code === null || p.id === code?.id));
  const uses = await countUses(db, limited.map((p) => p.id));
  const exhausted = new Set(limited.filter((p) => (uses.get(p.id) ?? 0) >= (p.max_uses ?? 0)).map((p) => p.id));
  if (code && exhausted.has(code.id)) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'EXHAUSTED' }, money));

  const pricing = priceOrder({
    lines: lines.map((l) => {
      const info = byProduct.get(l.productId);
      const rateId = resolveTaxRateId(info?.tax_rate_id, info?.category_tax_rate_id, settings.defaultTaxRateId);
      return { productId: l.productId, categoryId: info?.category_id ?? null, unitPrice: l.line.unitPrice, quantity: l.quantity, promoPriced: l.product.promoPrice !== null, taxRate: rateId ? (rateById.get(rateId) ?? null) : null };
    }),
    promotions: promotionRows.filter((p) => p.code === null && !exhausted.has(p.id)).map(toRule),
    code: code ? toRule(code) : null,
    moment: localMoment(now, location.timezone),
    taxMode: settings.taxMode,
  });
  if (pricing.codeProblem) throw new AppError('CONFLICT', promoCodeMessage(pricing.codeProblem, money));

  const applied = new Set(pricing.applied.map((a) => a.id));
  return {
    lines: lines.map((l, i) => {
      const p = pricing.lines[i]!;
      return { ...l, pricing: { promotionId: p.promotion?.id ?? null, promotionDiscount: p.promotionDiscount, codeDiscount: p.codeDiscount, taxRateId: p.taxRate?.id ?? null, taxRateBp: p.taxRate?.rateBp ?? null, taxName: p.taxRate?.name ?? null } };
    }),
    pricing,
    taxMode: settings.taxMode,
    currency: location.currency,
    limits: promotionRows.filter((p) => p.max_uses !== null && applied.has(p.id)).map((p) => ({ id: p.id, name: p.name, maxUses: p.max_uses!, isCode: p.id === code?.id })),
  };
}

/** Colonnes de la commande figées au moment de la vente (remise manuelle : aucune à la création). */
export function orderPricingColumns(q: PricedOrder) {
  const p = q.pricing;
  return {
    subtotal: p.subtotal,
    total: p.total,
    tax_mode: q.taxMode,
    tax_total: p.taxTotal,
    taxes: JSON.stringify(p.taxes),
    promotion_discount: p.promotionDiscount,
    order_promotion_id: p.orderPromotion?.id ?? null,
    order_promotion_discount: p.orderPromotion?.amount ?? 0,
    promo_code: p.code?.code ?? null,
    promo_code_promotion_id: p.code?.id ?? null,
    promo_code_discount: p.code?.amount ?? 0,
    applied_promotions: JSON.stringify(p.applied),
  };
}

/** Dans la transaction de la commande, avant son insertion : deux commandes simultanées ne dépassent pas le maximum. */
export async function reserveUses(trx: Db, ctx: AppContext, q: PricedOrder) {
  if (q.limits.length === 0) return;
  const ids = q.limits.map((l) => l.id);
  if (ctx.dbKind === 'postgres') await trx.selectFrom('promotions').select('id').where('id', 'in', ids).forUpdate().execute();
  const uses = await countUses(trx, ids);
  for (const l of q.limits) {
    if ((uses.get(l.id) ?? 0) < l.maxUses) continue;
    throw new AppError('CONFLICT', l.isCode ? promoCodeMessage({ reason: 'EXHAUSTED' }, String) : `La promotion « ${l.name} » vient d'atteindre son nombre maximal d'utilisations. Actualisez puis réessayez.`);
  }
}

/** Taxes et total d'une commande existante, avec ses lignes et ses taux figés, pour une remise manuelle donnée. */
export async function recomputeStoredTotals(db: Db, order: { id: string; tax_mode: TaxMode; order_promotion_discount: number; promo_code_discount: number }, manualDiscount: number) {
  const items = await db.selectFrom('order_items').select(['total', 'promotion_discount', 'code_discount', 'tax_rate_id', 'tax_rate_bp', 'tax_name']).where('order_id', '=', order.id).orderBy('sort').execute();
  const codeOnLines = items.reduce((s, i) => s + i.code_discount, 0);
  const lines = items.map((i) => ({ net: i.total - i.promotion_discount - i.code_discount, taxRate: i.tax_rate_bp === null ? null : { id: i.tax_rate_id ?? '', name: i.tax_name ?? '', rateBp: i.tax_rate_bp } }));
  return computeTotals(order.tax_mode, lines, order.order_promotion_discount + (order.promo_code_discount - codeOnLines) + manualDiscount);
}

function toQuote(q: PricedOrder): Quote {
  const p = q.pricing;
  return {
    currency: q.currency,
    taxMode: q.taxMode,
    lines: q.lines.map((l, i) => ({
      productId: l.productId,
      name: l.product.name,
      variantName: l.line.variant?.name ?? null,
      quantity: l.quantity,
      unitPrice: l.line.unitPrice,
      total: l.line.total,
      promotionName: p.lines[i]!.promotion?.name ?? null,
      promotionDiscount: p.lines[i]!.promotionDiscount,
      codeDiscount: p.lines[i]!.codeDiscount,
    })),
    subtotal: p.subtotal,
    promotionDiscount: p.promotionDiscount,
    promotions: p.applied,
    promoCode: p.code?.code ?? null,
    taxes: p.taxes,
    taxTotal: p.taxTotal,
    total: p.total,
  };
}

/** Devis de la caisse : exactement le calcul de la commande, sans l'enregistrer. */
export async function quoteStaffOrder(ctx: AppContext, scope: TenantScope, locationId: string, input: QuoteInput): Promise<Quote> {
  const location = await loadLocation(ctx.db, scope, locationId);
  const priced = priceLines(await loadPricingProducts(ctx.db, locationId, input.lines.map((l) => l.productId), { includeHidden: true }), input.lines);
  return toQuote(await priceOrderLines(ctx.db, location, priced, input.promoCode, ctx.now()));
}

export async function quotePublicOrder(ctx: AppContext, token: string, input: QuoteInput): Promise<Quote> {
  const qr = await resolveQr(ctx.db, token);
  const now = ctx.now();
  const dailyMenu = await resolveDailyMenuProductIds(ctx.db, qr.location_id, qr.timezone, qr.business_day_cutoff_min, now);
  const priced = priceLines(await loadPricingProducts(ctx.db, qr.location_id, input.lines.map((l) => l.productId), { dailyMenu }), input.lines);
  return toQuote(await priceOrderLines(ctx.db, { id: qr.location_id, timezone: qr.timezone, currency: qr.currency }, priced, input.promoCode, now));
}

async function checkCode(db: Db, location: { id: string; timezone: string; currency: CurrencyCode }, code: string, now: number): Promise<PromotionRule> {
  const money = (v: number) => formatMoney(v, location.currency);
  const row = (await activePromotions(db, location.id)).find((p) => p.code_key !== null && p.code_key === normalizeCode(code));
  if (!row) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'UNKNOWN' }, money));
  const rule = toRule(row);
  if (!rule.isActive) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'INACTIVE' }, money));
  if (!isScheduled(rule, localMoment(now, location.timezone))) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'NOT_LIVE' }, money));
  if (row.max_uses !== null && ((await countUses(db, [row.id])).get(row.id) ?? 0) >= row.max_uses) throw new AppError('CONFLICT', promoCodeMessage({ reason: 'EXHAUSTED' }, money));
  return rule;
}

/** Code saisi en caisse : la règle, pour recalculer le ticket à chaque article. */
export async function checkStaffPromoCode(ctx: AppContext, scope: TenantScope, locationId: string, code: string): Promise<PromotionRule> {
  return checkCode(ctx.db, await loadLocation(ctx.db, scope, locationId), code, ctx.now());
}

export async function checkPublicPromoCode(ctx: AppContext, token: string, code: string): Promise<PromotionRule> {
  const qr = await resolveQr(ctx.db, token);
  return checkCode(ctx.db, { id: qr.location_id, timezone: qr.timezone, currency: qr.currency }, code, ctx.now());
}

/** Menu client : taux résolus par produit visible et promotions automatiques non terminées. */
export async function getPublicPricing(ctx: AppContext, token: string): Promise<PublicPricing> {
  const qr = await resolveQr(ctx.db, token);
  const settings = await readSettings(ctx.db, qr.location_id);
  const rates = await activeRates(ctx.db, qr.location_id);
  const products = await ctx.db
    .selectFrom('products as p')
    .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
    .select(['p.id', 'p.category_id', 'p.tax_rate_id', 'c.tax_rate_id as category_tax_rate_id'])
    .where('p.location_id', '=', qr.location_id)
    .where('p.status', '=', 'ACTIVE')
    .where('c.status', '=', 'ACTIVE')
    .where('c.is_visible', '=', 1)
    .execute();
  const today = localMoment(ctx.now(), qr.timezone).date;
  const candidates = (await activePromotions(ctx.db, qr.location_id)).filter((p) => p.code === null && p.is_active === 1 && (!p.end_date || p.end_date >= today));
  const limited = candidates.filter((p) => p.max_uses !== null);
  const uses = await countUses(ctx.db, limited.map((p) => p.id));
  const known = new Set(rates.map((r) => r.id));
  return {
    timezone: qr.timezone,
    taxMode: settings.taxMode,
    taxRates: rates.map((r) => ({ id: r.id, name: r.name, rateBp: r.rate_bp })),
    productTaxRates: Object.fromEntries(
      products.map((p) => {
        const id = resolveTaxRateId(p.tax_rate_id, p.category_tax_rate_id, settings.defaultTaxRateId);
        return [p.id, id && known.has(id) ? id : null];
      }),
    ),
    productCategories: Object.fromEntries(products.map((p) => [p.id, p.category_id])),
    promotions: candidates.filter((p) => p.max_uses === null || (uses.get(p.id) ?? 0) < p.max_uses).map(toRule),
  };
}

// --- Configuration (écran « Taxes et promotions ») ------------------------------

export async function getPricingConfig(ctx: AppContext, scope: TenantScope, locationId: string): Promise<PricingConfig> {
  const location = await loadLocation(ctx.db, scope, locationId);
  const db = ctx.db;
  const [settings, rates, promotions, categories, products] = await Promise.all([
    readSettings(db, locationId),
    activeRates(db, locationId),
    activePromotions(db, locationId),
    db.selectFrom('menu_categories').select(['id', 'name', 'tax_rate_id']).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db
      .selectFrom('products as p')
      .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
      .select(['p.id', 'p.name', 'p.category_id', 'p.tax_rate_id', 'p.promo_price'])
      .where('p.location_id', '=', locationId)
      .where('p.status', '=', 'ACTIVE')
      .where('c.status', '=', 'ACTIVE')
      .orderBy('c.sort')
      .orderBy('p.sort')
      .execute(),
  ]);
  const uses = await countUses(db, promotions.map((p) => p.id));
  return {
    location: { id: location.id, name: location.name, currency: location.currency, timezone: location.timezone },
    taxMode: settings.taxMode,
    defaultTaxRateId: settings.defaultTaxRateId,
    taxRates: rates.map((r) => ({
      id: r.id,
      name: r.name,
      rateBp: r.rate_bp,
      isDefault: r.id === settings.defaultTaxRateId,
      overrides: categories.filter((c) => c.tax_rate_id === r.id).length + products.filter((p) => p.tax_rate_id === r.id).length,
    })),
    promotions: promotions.map((p) => toPromotion(p, uses.get(p.id) ?? 0)),
    categories: categories.map((c) => ({ id: c.id, name: c.name, taxRateId: c.tax_rate_id })),
    products: products.map((p) => ({ id: p.id, name: p.name, categoryId: p.category_id, taxRateId: p.tax_rate_id, promoPriced: p.promo_price !== null })),
  };
}

function toPromotion(r: PromotionRow, usesCount: number): Promotion {
  return { ...toRule(r), locationId: r.location_id, maxUses: r.max_uses, usesCount, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Écrit (ou crée) la ligne de réglages de l'établissement. */
async function writeSettings(trx: Db, ctx: AppContext, scope: TenantScope, locationId: string, next: { taxMode: TaxMode; defaultTaxRateId: string | null }, hlc: string) {
  const now = ctx.now();
  const exists = await trx.selectFrom('pricing_settings').select('id').where('location_id', '=', locationId).executeTakeFirst();
  if (exists) {
    await trx.updateTable('pricing_settings').set({ tax_mode: next.taxMode, default_tax_rate_id: next.defaultTaxRateId, updated_at: now, updated_hlc: hlc }).where('id', '=', exists.id).execute();
  } else {
    await trx
      .insertInto('pricing_settings')
      .values({ id: locationId, tenant_id: scope.tenantId, location_id: locationId, tax_mode: next.taxMode, default_tax_rate_id: next.defaultTaxRateId, created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
  }
  await emit(trx, ctx, 'pricing_settings', exists?.id ?? locationId, hlc);
}

export async function updatePricingSettings(ctx: AppContext, scope: TenantScope, locationId: string, input: PricingSettingsInput, meta: RequestMeta): Promise<PricingConfig> {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  if (input.defaultTaxRateId) await assertRate(ctx.db, locationId, input.defaultTaxRateId);
  const before = await readSettings(ctx.db, locationId);
  const next = { taxMode: input.taxMode ?? before.taxMode, defaultTaxRateId: input.defaultTaxRateId !== undefined ? input.defaultTaxRateId : before.defaultTaxRateId };
  await ctx.db.transaction().execute(async (trx) => {
    await writeSettings(trx, ctx, scope, locationId, next, ctx.clock.now());
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'pricing.settings_updated', entityType: 'location', entityId: locationId, data: { before, after: next }, meta });
  });
  return getPricingConfig(ctx, scope, locationId);
}

// --- Taux de taxe ---------------------------------------------------------------

async function assertRateName(db: Db, locationId: string, name: string, exceptId?: string) {
  const same = (await activeRates(db, locationId)).find((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
  if (same) throw new AppError('CONFLICT', `Un taux s'appelle déjà « ${same.name} ».`);
}

export async function createTaxRate(ctx: AppContext, scope: TenantScope, locationId: string, input: TaxRateInput, meta: RequestMeta): Promise<PricingConfig> {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  await assertRateName(ctx.db, locationId, input.name);
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const now = ctx.now();
    const hlc = ctx.clock.now();
    const top = await trx.selectFrom('tax_rates').select((eb) => eb.fn.max('sort').as('m')).where('location_id', '=', locationId).executeTakeFirst();
    await trx
      .insertInto('tax_rates')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, name: input.name, rate_bp: input.rateBp, sort: top?.m === null || top?.m === undefined ? 0 : Number(top.m) + 1, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
    await emit(trx, ctx, 'tax_rates', id, hlc);
    if (input.isDefault) {
      const settings = await readSettings(trx, locationId);
      await writeSettings(trx, ctx, scope, locationId, { ...settings, defaultTaxRateId: id }, hlc);
    }
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'pricing.tax_rate_created', entityType: 'tax_rate', entityId: id, data: { name: input.name, rateBp: input.rateBp, isDefault: !!input.isDefault }, meta });
  });
  return getPricingConfig(ctx, scope, locationId);
}

export async function updateTaxRate(ctx: AppContext, scope: TenantScope, rateId: string, input: UpdateTaxRateInput, meta: RequestMeta): Promise<PricingConfig> {
  const rate = await loadScoped<RateRow>(ctx.db, scope, 'tax_rates', rateId, 'Taux de taxe');
  assertActive(rate.status, 'Ce taux de taxe est archivé.');
  if (input.name !== undefined) await assertRateName(ctx.db, rate.location_id, input.name, rateId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    if (input.name !== undefined || input.rateBp !== undefined) {
      await trx
        .updateTable('tax_rates')
        .set({ ...(input.name !== undefined && { name: input.name }), ...(input.rateBp !== undefined && { rate_bp: input.rateBp }), updated_at: ctx.now(), updated_hlc: hlc })
        .where('id', '=', rateId)
        .execute();
      await emit(trx, ctx, 'tax_rates', rateId, hlc);
    }
    if (input.isDefault !== undefined) {
      const settings = await readSettings(trx, rate.location_id);
      const next = input.isDefault ? rateId : settings.defaultTaxRateId === rateId ? null : settings.defaultTaxRateId;
      if (next !== settings.defaultTaxRateId) await writeSettings(trx, ctx, scope, rate.location_id, { ...settings, defaultTaxRateId: next }, hlc);
    }
    // Les commandes déjà passées gardent l'ancien taux : seules les suivantes changent.
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: rate.location_id, actorUserId: scope.userId, action: 'pricing.tax_rate_updated', entityType: 'tax_rate', entityId: rateId, data: { before: { name: rate.name, rateBp: rate.rate_bp }, changes: input }, meta });
  });
  return getPricingConfig(ctx, scope, rate.location_id);
}

export async function archiveTaxRate(ctx: AppContext, scope: TenantScope, rateId: string, meta: RequestMeta): Promise<PricingConfig> {
  const rate = await loadScoped<RateRow>(ctx.db, scope, 'tax_rates', rateId, 'Taux de taxe');
  if (rate.status === 'ACTIVE') {
    const settings = await readSettings(ctx.db, rate.location_id);
    if (settings.defaultTaxRateId === rateId) throw new AppError('CONFLICT', "C'est le taux par défaut : choisissez-en un autre avant de l'archiver.");
    const [categories, products] = await Promise.all([
      ctx.db.selectFrom('menu_categories').select('name').where('tax_rate_id', '=', rateId).where('status', '=', 'ACTIVE').execute(),
      ctx.db.selectFrom('products').select('name').where('tax_rate_id', '=', rateId).where('status', '=', 'ACTIVE').execute(),
    ]);
    if (categories.length + products.length > 0) {
      throw new AppError('CONFLICT', 'Ce taux est utilisé : rendez à ces catégories et produits le taux par défaut avant de l’archiver.', { products: [...categories, ...products].map((x) => x.name) });
    }
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('tax_rates').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', rateId).execute();
      await emit(trx, ctx, 'tax_rates', rateId, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: rate.location_id, actorUserId: scope.userId, action: 'pricing.tax_rate_archived', entityType: 'tax_rate', entityId: rateId, data: { name: rate.name, rateBp: rate.rate_bp }, meta });
    });
  }
  return getPricingConfig(ctx, scope, rate.location_id);
}

/** Taux propre à une catégorie ou à un produit (null : taux hérité). */
export async function setTaxOverride(ctx: AppContext, scope: TenantScope, kind: 'category' | 'product', id: string, taxRateId: string | null, meta: RequestMeta): Promise<PricingConfig> {
  const table = kind === 'category' ? 'menu_categories' : 'products';
  const row = await loadScoped<{ location_id: string; status: string; name: string; tax_rate_id: string | null }>(ctx.db, scope, table, id, kind === 'category' ? 'Catégorie' : 'Produit');
  assertActive(row.status, kind === 'category' ? 'Cette catégorie est archivée.' : 'Ce produit est archivé.');
  if (taxRateId) await assertRate(ctx.db, row.location_id, taxRateId);
  if (row.tax_rate_id !== taxRateId) {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable(table as 'products').set({ tax_rate_id: taxRateId, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', id).execute();
      await emitRow(trx, ctx, table, id, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: 'pricing.tax_override', entityType: kind === 'category' ? 'menu_category' : 'product', entityId: id, data: { name: row.name, before: row.tax_rate_id, after: taxRateId }, meta });
    });
  }
  return getPricingConfig(ctx, scope, row.location_id);
}

// --- Promotions -----------------------------------------------------------------

async function assertPromotion(db: Db, locationId: string, input: PromotionInput, exceptId?: string) {
  if (input.scope !== 'ORDER' && input.targetId) {
    const table = input.scope === 'PRODUCT' ? 'products' : 'menu_categories';
    const target = await db.selectFrom(table as 'products').select(['status']).where('id', '=', input.targetId).where('location_id', '=', locationId).executeTakeFirst();
    if (!target || target.status !== 'ACTIVE') throw new AppError('NOT_FOUND', input.scope === 'PRODUCT' ? 'Produit introuvable.' : 'Catégorie introuvable.');
  }
  if (input.code) {
    let q = db.selectFrom('promotions').select('name').where('location_id', '=', locationId).where('code_key', '=', normalizeCode(input.code)).where('status', '=', 'ACTIVE');
    if (exceptId) q = q.where('id', '!=', exceptId);
    const taken = await q.executeTakeFirst();
    if (taken) throw new AppError('CONFLICT', `Le code « ${normalizeCode(input.code)} » est déjà celui de la promotion « ${taken.name} ».`);
  }
}

function promotionValues(input: PromotionInput) {
  return {
    name: input.name,
    kind: input.kind,
    scope: input.scope,
    target_id: input.scope === 'ORDER' ? null : input.targetId,
    value: input.kind === 'FREE_ITEM' ? 0 : input.value,
    buy_quantity: input.kind === 'FREE_ITEM' ? input.buyQuantity : null,
    free_quantity: input.kind === 'FREE_ITEM' ? input.freeQuantity : null,
    min_amount: input.scope === 'ORDER' ? input.minAmount : null,
    code: input.code ? normalizeCode(input.code) : null,
    code_key: input.code ? normalizeCode(input.code) : null,
    start_date: input.startDate,
    end_date: input.endDate,
    days_mask: input.days.length === 7 ? 0 : daysToMask(input.days),
    start_minute: input.startMinute,
    end_minute: input.endMinute,
    max_uses: input.maxUses,
    is_active: (input.isActive ? 1 : 0) as 0 | 1,
  };
}

const codeTaken = () => new AppError('CONFLICT', 'Ce code promo est déjà utilisé par une autre promotion.');

export async function createPromotion(ctx: AppContext, scope: TenantScope, locationId: string, input: PromotionInput, meta: RequestMeta): Promise<PricingConfig> {
  const location = await loadLocation(ctx.db, scope, locationId);
  assertActive(location.status, 'Cet établissement est archivé.');
  await assertPromotion(ctx.db, locationId, input);
  const id = uuidv7();
  try {
    await ctx.db.transaction().execute(async (trx) => {
      const now = ctx.now();
      const hlc = ctx.clock.now();
      await trx
        .insertInto('promotions')
        .values({ id, tenant_id: scope.tenantId, location_id: locationId, ...promotionValues(input), status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
        .execute();
      await emit(trx, ctx, 'promotions', id, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'pricing.promotion_created', entityType: 'promotion', entityId: id, data: input, meta });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw codeTaken();
    throw err;
  }
  return getPricingConfig(ctx, scope, locationId);
}

export async function updatePromotion(ctx: AppContext, scope: TenantScope, promotionId: string, input: PromotionInput, meta: RequestMeta): Promise<PricingConfig> {
  const row = await loadScoped<PromotionRow>(ctx.db, scope, 'promotions', promotionId, 'Promotion');
  assertActive(row.status, 'Cette promotion est archivée.');
  await assertPromotion(ctx.db, row.location_id, input, promotionId);
  try {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('promotions').set({ ...promotionValues(input), updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', promotionId).execute();
      await emit(trx, ctx, 'promotions', promotionId, hlc);
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: row.location_id,
        actorUserId: scope.userId,
        action: 'pricing.promotion_updated',
        entityType: 'promotion',
        entityId: promotionId,
        data: { before: { ...toRule(row), maxUses: row.max_uses }, after: input },
        meta,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw codeTaken();
    throw err;
  }
  return getPricingConfig(ctx, scope, row.location_id);
}

export async function setPromotionActive(ctx: AppContext, scope: TenantScope, promotionId: string, isActive: boolean, meta: RequestMeta): Promise<PricingConfig> {
  const row = await loadScoped<PromotionRow>(ctx.db, scope, 'promotions', promotionId, 'Promotion');
  assertActive(row.status, 'Cette promotion est archivée.');
  if ((row.is_active === 1) !== isActive) {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('promotions').set({ is_active: isActive ? 1 : 0, updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', promotionId).execute();
      await emit(trx, ctx, 'promotions', promotionId, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: isActive ? 'pricing.promotion_resumed' : 'pricing.promotion_paused', entityType: 'promotion', entityId: promotionId, data: { name: row.name }, meta });
    });
  }
  return getPricingConfig(ctx, scope, row.location_id);
}

/** Archivée : elle ne s'applique plus, son code se libère ; les commandes passées la gardent. */
export async function archivePromotion(ctx: AppContext, scope: TenantScope, promotionId: string, meta: RequestMeta): Promise<PricingConfig> {
  const row = await loadScoped<PromotionRow>(ctx.db, scope, 'promotions', promotionId, 'Promotion');
  if (row.status === 'ACTIVE') {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('promotions').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', promotionId).execute();
      await emit(trx, ctx, 'promotions', promotionId, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: row.location_id, actorUserId: scope.userId, action: 'pricing.promotion_archived', entityType: 'promotion', entityId: promotionId, data: { name: row.name, code: row.code }, meta });
    });
  }
  return getPricingConfig(ctx, scope, row.location_id);
}
