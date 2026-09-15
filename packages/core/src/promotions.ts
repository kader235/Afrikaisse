import { BASIS_POINTS, computeTotals, formatRate, type TaxLine, type TaxMode, type TaxRateRule } from './taxes.ts';

/**
 * Promotions d'un établissement (§48). Aucune dépendance (pas de Zod) : le serveur, qui fait foi,
 * la caisse et le menu client appliquent la même fonction.
 *
 * Genres : pourcentage (points de base), montant fixe (par article, ou sur la commande),
 * article offert (« X achetés, Y offerts », calculé par ligne).
 * Portée : commande, catégorie ou produit. Code promo facultatif (casse indifférente).
 * Calendrier évalué dans le fuseau de l'établissement : dates de début et de fin incluses,
 * jours de la semaine, plage horaire (happy hour ; une plage 22:00–02:00 passe minuit et sa
 * partie après minuit compte pour la veille).
 *
 * Cumul, dans cet ordre, chaque étape portant sur le reste de la précédente :
 * 1. chaque ligne reçoit au plus UNE promotion automatique (produit ou catégorie) : la plus
 *    avantageuse pour le client ; à égalité, la plus ancienne ;
 * 2. le code promo (un seul par commande) s'il vise des produits ou une catégorie ;
 * 3. la meilleure promotion automatique de commande (montant minimal éventuel) ;
 * 4. le code promo s'il vise la commande (montant minimal éventuel) ;
 * 5. la remise manuelle d'un responsable ;
 * 6. les taxes, sur le montant net (voir taxes.ts).
 * Un produit à prix promotionnel (prix barré du menu) ne reçoit pas de promotion de ligne ;
 * les promotions de commande s'appliquent à tout le ticket. Remises arrondies à l'unité
 * inférieure, jamais au-delà du montant restant.
 */

export const PROMOTION_KINDS = ['PERCENT', 'AMOUNT', 'FREE_ITEM'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  PERCENT: 'Pourcentage',
  AMOUNT: 'Montant fixe',
  FREE_ITEM: 'Article offert',
};

export const PROMOTION_SCOPES = ['ORDER', 'CATEGORY', 'PRODUCT'] as const;
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

export const PROMOTION_SCOPE_LABELS: Record<PromotionScope, string> = {
  ORDER: 'Commande',
  CATEGORY: 'Catégorie',
  PRODUCT: 'Produit',
};

/** Jours ISO : 1 = lundi … 7 = dimanche. */
export const WEEKDAY_LABELS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

export interface PromotionRule {
  id: string;
  name: string;
  kind: PromotionKind;
  scope: PromotionScope;
  /** Produit ou catégorie visé ; null pour la commande. */
  targetId: string | null;
  /** PERCENT : points de base ; AMOUNT : unités mineures (par article, ou sur la commande) ; FREE_ITEM : 0. */
  value: number;
  buyQuantity: number | null;
  freeQuantity: number | null;
  /** Portée commande : montant minimal (après promotions de ligne). */
  minAmount: number | null;
  code: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Vide : tous les jours. */
  days: number[];
  startMinute: number | null;
  endMinute: number | null;
  isActive: boolean;
}

export interface LocalMoment {
  /** AAAA-MM-JJ dans le fuseau de l'établissement. */
  date: string;
  /** 1 = lundi … 7 = dimanche. */
  weekday: number;
  /** Minutes depuis minuit. */
  minute: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localMoment(ms: number, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: WEEKDAYS[get('weekday')] ?? 1, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Code saisi → clé de comparaison. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Calendrier seulement (dates, jours, heures), sans l'interrupteur actif/suspendu. */
export function isScheduled(p: Pick<PromotionRule, 'startDate' | 'endDate' | 'days' | 'startMinute' | 'endMinute'>, m: LocalMoment): boolean {
  let date = m.date;
  let weekday = m.weekday;
  if (p.startMinute !== null && p.endMinute !== null) {
    if (p.endMinute > p.startMinute) {
      if (m.minute < p.startMinute || m.minute >= p.endMinute) return false;
    } else if (m.minute < p.endMinute) {
      // Plage qui passe minuit : après minuit, c'est encore la soirée de la veille.
      date = previousDay(date);
      weekday = weekday === 1 ? 7 : weekday - 1;
    } else if (m.minute < p.startMinute) {
      return false;
    }
  }
  if (p.days.length > 0 && !p.days.includes(weekday)) return false;
  if (p.startDate && date < p.startDate) return false;
  if (p.endDate && date > p.endDate) return false;
  return true;
}

export function isLive(p: PromotionRule, m: LocalMoment): boolean {
  return p.isActive && isScheduled(p, m);
}

export type PromotionState = 'LIVE' | 'WAITING' | 'PAUSED' | 'ENDED';

export const PROMOTION_STATE_LABELS: Record<PromotionState, string> = {
  LIVE: 'En cours',
  WAITING: 'Programmée',
  PAUSED: 'Suspendue',
  ENDED: 'Terminée',
};

export function promotionState(p: PromotionRule, m: LocalMoment): PromotionState {
  if (p.endDate && m.date > p.endDate) return 'ENDED';
  if (!p.isActive) return 'PAUSED';
  return isScheduled(p, m) ? 'LIVE' : 'WAITING';
}

// --- Montants ------------------------------------------------------------------

export interface PricingLine {
  productId: string;
  categoryId: string | null;
  unitPrice: number;
  quantity: number;
  /** Prix promotionnel du menu : pas de promotion de ligne en plus. */
  promoPriced: boolean;
  taxRate: TaxRateRule | null;
}

export function matchesLine(p: Pick<PromotionRule, 'scope' | 'targetId'>, line: Pick<PricingLine, 'productId' | 'categoryId' | 'promoPriced'>): boolean {
  if (line.promoPriced) return false;
  if (p.scope === 'PRODUCT') return p.targetId === line.productId;
  if (p.scope === 'CATEGORY') return !!line.categoryId && p.targetId === line.categoryId;
  return false;
}

/** Remise d'une promotion de ligne sur `available` (montant encore dû pour cette ligne). */
export function lineDiscount(p: Pick<PromotionRule, 'kind' | 'value' | 'buyQuantity' | 'freeQuantity'>, unitPrice: number, quantity: number, available: number): number {
  if (available <= 0 || quantity <= 0) return 0;
  let raw = 0;
  if (p.kind === 'PERCENT') raw = Math.floor((available * Math.min(p.value, BASIS_POINTS)) / BASIS_POINTS);
  else if (p.kind === 'AMOUNT') raw = p.value * quantity;
  else {
    const buy = p.buyQuantity ?? 0;
    const free = p.freeQuantity ?? 0;
    if (buy >= 1 && free >= 1) raw = Math.floor(quantity / (buy + free)) * free * unitPrice;
  }
  return Math.max(0, Math.min(raw, available));
}

/** Remise d'une promotion de commande sur `base`. */
export function orderDiscount(p: Pick<PromotionRule, 'kind' | 'value'>, base: number): number {
  if (base <= 0) return 0;
  if (p.kind === 'PERCENT') return Math.floor((base * Math.min(p.value, BASIS_POINTS)) / BASIS_POINTS);
  if (p.kind === 'AMOUNT') return Math.min(p.value, base);
  return 0;
}

export type PromoCodeProblem =
  | { reason: 'UNKNOWN' }
  | { reason: 'INACTIVE' }
  | { reason: 'NOT_LIVE' }
  | { reason: 'EXHAUSTED' }
  | { reason: 'MIN_AMOUNT'; minAmount: number }
  | { reason: 'NO_MATCH' };

export function promoCodeMessage(problem: PromoCodeProblem, money: (v: number) => string): string {
  switch (problem.reason) {
    case 'UNKNOWN':
      return 'Code promo inconnu.';
    case 'INACTIVE':
      return "Ce code promo n'est pas actif.";
    case 'NOT_LIVE':
      return "Ce code promo n'est pas valable en ce moment.";
    case 'EXHAUSTED':
      return "Ce code promo a atteint son nombre maximal d'utilisations.";
    case 'MIN_AMOUNT':
      return `Ce code promo demande une commande d'au moins ${money(problem.minAmount)}.`;
    case 'NO_MATCH':
      return "Ce code promo ne s'applique à aucun article du ticket.";
  }
}

export interface AppliedPromotion {
  id: string;
  name: string;
  code: string | null;
  amount: number;
}

export interface PricedOrderLine {
  gross: number;
  promotion: { id: string; name: string } | null;
  /** Promotion automatique de la ligne. */
  promotionDiscount: number;
  /** Part du code promo portée par cette ligne (code visant des produits ou une catégorie). */
  codeDiscount: number;
  net: number;
  taxRate: TaxRateRule | null;
}

export interface OrderPricing {
  lines: PricedOrderLine[];
  subtotal: number;
  orderPromotion: AppliedPromotion | null;
  /** Code appliqué ; `amount` : total de sa remise (lignes et commande). */
  code: AppliedPromotion | null;
  /** Part du code portée par la commande elle-même. */
  codeOrderDiscount: number;
  codeProblem: PromoCodeProblem | null;
  /** Toutes promotions confondues. */
  promotionDiscount: number;
  manualDiscount: number;
  /** Récapitulatif pour les tickets : une entrée par promotion appliquée. */
  applied: AppliedPromotion[];
  taxMode: TaxMode;
  taxes: TaxLine[];
  taxTotal: number;
  total: number;
}

export interface PriceOrderInput {
  lines: PricingLine[];
  /** Promotions de l'établissement ; celles à code sont ignorées ici (voir `code`). */
  promotions: PromotionRule[];
  code?: PromotionRule | null;
  moment: LocalMoment;
  taxMode: TaxMode;
  /** Remise manuelle souhaitée (montant), plafonnée au reste. */
  manualDiscount?: number;
}

export function priceOrder(input: PriceOrderInput): OrderPricing {
  const automatic = input.promotions.filter((p) => p.code === null && isLive(p, input.moment));
  const lines: PricedOrderLine[] = input.lines.map((l) => {
    const gross = l.unitPrice * l.quantity;
    let best: { p: PromotionRule; amount: number } | null = null;
    for (const p of automatic) {
      if (p.scope === 'ORDER' || !matchesLine(p, l)) continue;
      const amount = lineDiscount(p, l.unitPrice, l.quantity, gross);
      if (amount > 0 && (!best || amount > best.amount)) best = { p, amount };
    }
    return { gross, promotion: best ? { id: best.p.id, name: best.p.name } : null, promotionDiscount: best?.amount ?? 0, codeDiscount: 0, net: gross - (best?.amount ?? 0), taxRate: l.taxRate };
  });

  // Code visant des lignes.
  const code = input.code ?? null;
  let codeProblem: PromoCodeProblem | null = null;
  if (code && !code.isActive) codeProblem = { reason: 'INACTIVE' };
  else if (code && !isScheduled(code, input.moment)) codeProblem = { reason: 'NOT_LIVE' };
  if (code && !codeProblem && code.scope !== 'ORDER') {
    let matched = false;
    input.lines.forEach((l, i) => {
      if (!matchesLine(code, l)) return;
      matched = true;
      const line = lines[i]!;
      line.codeDiscount = lineDiscount(code, l.unitPrice, l.quantity, line.net);
      line.net -= line.codeDiscount;
    });
    if (!matched || lines.every((l) => l.codeDiscount === 0)) codeProblem = { reason: 'NO_MATCH' };
  }

  const linesNet = lines.reduce((s, l) => s + l.net, 0);
  let orderPromotion: AppliedPromotion | null = null;
  for (const p of automatic) {
    if (p.scope !== 'ORDER' || (p.minAmount !== null && linesNet < p.minAmount)) continue;
    const amount = orderDiscount(p, linesNet);
    if (amount > 0 && (!orderPromotion || amount > orderPromotion.amount)) orderPromotion = { id: p.id, name: p.name, code: null, amount };
  }
  let remaining = linesNet - (orderPromotion?.amount ?? 0);

  // Code visant la commande. Un code refusé n'a retiré aucun montant (ses lignes sont à zéro).
  let codeOrderDiscount = 0;
  if (code && !codeProblem && code.scope === 'ORDER') {
    if (code.minAmount !== null && remaining < code.minAmount) codeProblem = { reason: 'MIN_AMOUNT', minAmount: code.minAmount };
    else {
      codeOrderDiscount = orderDiscount(code, remaining);
      if (codeOrderDiscount <= 0) codeProblem = { reason: 'NO_MATCH' };
    }
  }
  remaining -= codeOrderDiscount;

  const manualDiscount = Math.max(0, Math.min(input.manualDiscount ?? 0, remaining));
  const codeLines = lines.reduce((s, l) => s + l.codeDiscount, 0);
  const codeApplied: AppliedPromotion | null = code && !codeProblem ? { id: code.id, name: code.name, code: code.code, amount: codeLines + codeOrderDiscount } : null;

  const byPromotion = new Map<string, AppliedPromotion>();
  for (const l of lines) {
    if (!l.promotion) continue;
    const entry = byPromotion.get(l.promotion.id) ?? { id: l.promotion.id, name: l.promotion.name, code: null, amount: 0 };
    entry.amount += l.promotionDiscount;
    byPromotion.set(l.promotion.id, entry);
  }
  const applied = [...byPromotion.values(), ...(orderPromotion ? [orderPromotion] : []), ...(codeApplied ? [codeApplied] : [])];
  const promotionDiscount = applied.reduce((s, a) => s + a.amount, 0);
  const totals = computeTotals(input.taxMode, lines, (orderPromotion?.amount ?? 0) + codeOrderDiscount + manualDiscount);

  return {
    lines,
    subtotal: lines.reduce((s, l) => s + l.gross, 0),
    orderPromotion,
    code: codeApplied,
    codeOrderDiscount,
    codeProblem,
    promotionDiscount,
    manualDiscount,
    applied,
    taxMode: input.taxMode,
    taxes: totals.taxes,
    taxTotal: totals.taxTotal,
    total: totals.total,
  };
}

// --- Libellés ------------------------------------------------------------------

/** « −10 % », « −500 FCFA », « 2 + 1 offert ». */
export function promotionBadge(p: Pick<PromotionRule, 'kind' | 'value' | 'buyQuantity' | 'freeQuantity'>, money: (v: number) => string): string {
  if (p.kind === 'PERCENT') return `−${formatRate(p.value)}`;
  if (p.kind === 'AMOUNT') return `−${money(p.value)}`;
  return `${p.buyQuantity ?? 1} + ${p.freeQuantity ?? 1} offert${(p.freeQuantity ?? 1) > 1 ? 's' : ''}`;
}

const hm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** « Du 01/09/2026 au 30/09/2026 · Lun, Ven · 17:00–19:00 », ou « Permanente ». */
export function scheduleLabel(p: Pick<PromotionRule, 'startDate' | 'endDate' | 'days' | 'startMinute' | 'endMinute'>): string {
  const parts: string[] = [];
  if (p.startDate && p.endDate) parts.push(`Du ${dm(p.startDate)} au ${dm(p.endDate)}`);
  else if (p.startDate) parts.push(`Dès le ${dm(p.startDate)}`);
  else if (p.endDate) parts.push(`Jusqu'au ${dm(p.endDate)}`);
  if (p.days.length > 0 && p.days.length < 7) parts.push([...p.days].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(', '));
  if (p.startMinute !== null && p.endMinute !== null) parts.push(`${hm(p.startMinute)}–${hm(p.endMinute)}`);
  return parts.length ? parts.join(' · ') : 'Permanente';
}

export function minuteToTime(minute: number | null): string {
  return minute === null ? '' : hm(minute);
}

/** « 17:30 » → 1050 ; vide ou illisible → null. */
export function timeToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Promotion automatique la plus avantageuse pour UN article d'un produit (vitrine du menu client). */
export function bestProductPromotion(promotions: PromotionRule[], line: Omit<PricingLine, 'quantity' | 'taxRate'>, moment: LocalMoment): { promotion: PromotionRule; discount: number } | null {
  let best: { promotion: PromotionRule; discount: number } | null = null;
  for (const p of promotions) {
    if (p.code !== null || p.scope === 'ORDER' || !matchesLine(p, line) || !isLive(p, moment)) continue;
    // Article offert : mis en avant même si un seul article ne suffit pas à en profiter.
    const discount = p.kind === 'FREE_ITEM' ? 0 : lineDiscount(p, line.unitPrice, 1, line.unitPrice);
    if (!best || discount > best.discount) best = { promotion: p, discount };
  }
  return best;
}
