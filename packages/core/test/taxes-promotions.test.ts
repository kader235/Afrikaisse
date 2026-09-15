import { describe, expect, it } from 'vitest';
import {
  allocate,
  bestProductPromotion,
  computeTotals,
  formatRate,
  isScheduled,
  lineDiscount,
  localMoment,
  mergeTaxLines,
  priceOrder,
  promoCodeMessage,
  promotionBadge,
  promotionInputSchema,
  promotionState,
  resolveTaxRateId,
  roundDiv,
  scheduleLabel,
  taxOf,
  timeToMinute,
  type LocalMoment,
  type PricingLine,
  type PromotionRule,
} from '../src/index.ts';

const TVA = { id: 'tva', name: 'TVA', rateBp: 1800 };
const REDUIT = { id: 'reduit', name: 'TVA réduite', rateBp: 1000 };
const MARDI_1730: LocalMoment = { date: '2026-09-15', weekday: 2, minute: 17 * 60 + 30 };

const rule = (over: Partial<PromotionRule>): PromotionRule => ({
  id: 'p',
  name: 'Promo',
  kind: 'PERCENT',
  scope: 'ORDER',
  targetId: null,
  value: 1000,
  buyQuantity: null,
  freeQuantity: null,
  minAmount: null,
  code: null,
  startDate: null,
  endDate: null,
  days: [],
  startMinute: null,
  endMinute: null,
  isActive: true,
  ...over,
});

const line = (over: Partial<PricingLine>): PricingLine => ({ productId: 'biere', categoryId: 'boissons', unitPrice: 1000, quantity: 1, promoPriced: false, taxRate: TVA, ...over });

describe('Taxes — calculs', () => {
  it('arrondi au plus proche, demi-unité vers le haut', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(7, 3)).toBe(2);
    expect(formatRate(1800)).toBe('18 %');
    expect(formatRate(1925)).toBe('19,25 %');
  });

  it('TVA incluse : extraite du prix ; hors taxe : ajoutée', () => {
    expect(taxOf(11800, 1800, 'INCLUSIVE')).toBe(1800);
    expect(taxOf(10000, 1800, 'EXCLUSIVE')).toBe(1800);
    // 1000 × 18 / 118 = 152,54 → 153
    expect(taxOf(1000, 1800, 'INCLUSIVE')).toBe(153);
    expect(taxOf(0, 1800, 'INCLUSIVE')).toBe(0);
  });

  it('taux : produit, puis catégorie, puis défaut', () => {
    expect(resolveTaxRateId('a', 'b', 'c')).toBe('a');
    expect(resolveTaxRateId(null, 'b', 'c')).toBe('b');
    expect(resolveTaxRateId(null, null, 'c')).toBe('c');
    expect(resolveTaxRateId(null, null, null)).toBeNull();
  });

  it('répartition au prorata : somme exacte, plus forts restes', () => {
    expect(allocate(100, [100, 100, 100])).toEqual([34, 33, 33]);
    expect(allocate(100, [1, 1, 1])).toEqual([1, 1, 1]);
    expect(allocate(10, [6500, 3000])).toEqual([7, 3]);
    expect(allocate(500, [100, 200])).toEqual([100, 200]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(1_000_000_000, [999_999_999, 1]).reduce((a, b) => a + b, 0)).toBe(1_000_000_000);
  });

  it('une taxe par taux, arrondie une seule fois sur la somme (pas d’écart cumulé)', () => {
    const lines = Array.from({ length: 3 }, () => ({ net: 1000, taxRate: TVA }));
    // Ligne par ligne : 3 × 153 = 459 ; sur la somme : 3000 × 18 / 118 = 457,6 → 458.
    const totals = computeTotals('INCLUSIVE', lines, 0);
    expect(totals.taxes).toEqual([{ rateId: 'tva', name: 'TVA', rateBp: 1800, base: 2542, tax: 458 }]);
    expect(totals.total).toBe(3000);
  });

  it('plusieurs taux, ligne hors taxe, remise de commande répartie', () => {
    const totals = computeTotals('EXCLUSIVE', [{ net: 6000, taxRate: TVA }, { net: 3000, taxRate: REDUIT }, { net: 1000, taxRate: null }], 1000);
    expect(totals.reductions).toBe(1000);
    expect(totals.taxes).toEqual([
      { rateId: 'tva', name: 'TVA', rateBp: 1800, base: 5400, tax: 972 },
      { rateId: 'reduit', name: 'TVA réduite', rateBp: 1000, base: 2700, tax: 270 },
    ]);
    expect(totals.total).toBe(9000 + 972 + 270);
    expect(mergeTaxLines([totals.taxes, totals.taxes])[0]).toMatchObject({ base: 10800, tax: 1944 });
  });
});

describe('Promotions — calendrier', () => {
  it('lit la date, le jour et l’heure dans le fuseau de l’établissement', () => {
    // 2026-09-15 16:30 UTC = 17:30 à N’Djamena (UTC+1), un mardi.
    expect(localMoment(Date.UTC(2026, 8, 15, 16, 30), 'Africa/Ndjamena')).toEqual(MARDI_1730);
    expect(localMoment(Date.UTC(2026, 8, 15, 23, 30), 'Africa/Ndjamena')).toEqual({ date: '2026-09-16', weekday: 3, minute: 30 });
  });

  it('happy hour, jours, dates bornes comprises', () => {
    const happy = { startDate: null, endDate: null, days: [], startMinute: 17 * 60, endMinute: 19 * 60 };
    expect(isScheduled(happy, MARDI_1730)).toBe(true);
    expect(isScheduled(happy, { ...MARDI_1730, minute: 19 * 60 })).toBe(false);
    expect(isScheduled({ ...happy, days: [5, 6] }, MARDI_1730)).toBe(false);
    expect(isScheduled({ ...happy, startDate: '2026-09-15', endDate: '2026-09-15' }, MARDI_1730)).toBe(true);
    expect(isScheduled({ ...happy, endDate: '2026-09-14' }, MARDI_1730)).toBe(false);
  });

  it('plage qui passe minuit : après minuit, c’est la soirée de la veille', () => {
    const nuitDuVendredi = { startDate: null, endDate: '2026-09-18', days: [5], startMinute: 22 * 60, endMinute: 2 * 60 };
    expect(isScheduled(nuitDuVendredi, { date: '2026-09-18', weekday: 5, minute: 23 * 60 })).toBe(true);
    expect(isScheduled(nuitDuVendredi, { date: '2026-09-19', weekday: 6, minute: 60 })).toBe(true);
    expect(isScheduled(nuitDuVendredi, { date: '2026-09-19', weekday: 6, minute: 23 * 60 })).toBe(false);
    expect(isScheduled(nuitDuVendredi, { date: '2026-09-18', weekday: 5, minute: 12 * 60 })).toBe(false);
  });

  it('états et libellés', () => {
    expect(promotionState(rule({ startMinute: 1080, endMinute: 1140 }), MARDI_1730)).toBe('WAITING');
    expect(promotionState(rule({ isActive: false }), MARDI_1730)).toBe('PAUSED');
    expect(promotionState(rule({ endDate: '2026-09-01' }), MARDI_1730)).toBe('ENDED');
    expect(promotionState(rule({}), MARDI_1730)).toBe('LIVE');
    expect(scheduleLabel(rule({ startDate: '2026-09-01', endDate: '2026-09-30', days: [5, 1], startMinute: 1020, endMinute: 1140 }))).toBe('Du 01/09/2026 au 30/09/2026 · Lun, Ven · 17:00–19:00');
    expect(scheduleLabel(rule({}))).toBe('Permanente');
    expect(timeToMinute('17:30')).toBe(1050);
    expect(timeToMinute('25:00')).toBeNull();
    const money = (v: number) => `${v} F`;
    expect(promotionBadge(rule({ value: 1250 }), money)).toBe('−12,5 %');
    expect(promotionBadge(rule({ kind: 'AMOUNT', value: 500 }), money)).toBe('−500 F');
    expect(promotionBadge(rule({ kind: 'FREE_ITEM', value: 0, buyQuantity: 2, freeQuantity: 1 }), money)).toBe('2 + 1 offert');
    expect(promoCodeMessage({ reason: 'MIN_AMOUNT', minAmount: 5000 }, money)).toContain('5000 F');
  });
});

describe('Promotions — montants et cumul', () => {
  it('remises de ligne : pourcentage arrondi vers le bas, montant par article, article offert', () => {
    expect(lineDiscount(rule({ value: 1500 }), 999, 1, 999)).toBe(149);
    expect(lineDiscount(rule({ kind: 'AMOUNT', value: 300 }), 1000, 3, 3000)).toBe(900);
    expect(lineDiscount(rule({ kind: 'AMOUNT', value: 3000 }), 1000, 2, 2000)).toBe(2000);
    const deuxPlusUn = rule({ kind: 'FREE_ITEM', value: 0, buyQuantity: 2, freeQuantity: 1 });
    expect(lineDiscount(deuxPlusUn, 1000, 2, 2000)).toBe(0);
    expect(lineDiscount(deuxPlusUn, 1000, 3, 3000)).toBe(1000);
    expect(lineDiscount(deuxPlusUn, 1000, 7, 7000)).toBe(2000);
  });

  it('une seule promotion automatique par ligne : la plus avantageuse ; rien sur un prix barré', () => {
    const promotions = [
      rule({ id: 'cat', name: 'Boissons −10 %', scope: 'CATEGORY', targetId: 'boissons', value: 1000 }),
      rule({ id: 'prod', name: 'Bière −300', kind: 'AMOUNT', scope: 'PRODUCT', targetId: 'biere', value: 300 }),
    ];
    const priced = priceOrder({ lines: [line({ quantity: 2 }), line({ productId: 'jus', unitPrice: 800 }), line({ productId: 'soda', promoPriced: true })], promotions, moment: MARDI_1730, taxMode: 'INCLUSIVE' });
    expect(priced.lines.map((l) => [l.promotion?.id ?? null, l.promotionDiscount])).toEqual([
      ['prod', 600],
      ['cat', 80],
      [null, 0],
    ]);
    expect(priced.subtotal).toBe(3800);
    expect(priced.promotionDiscount).toBe(680);
    expect(priced.total).toBe(3120);
    expect(priced.applied).toEqual([
      { id: 'prod', name: 'Bière −300', code: null, amount: 600 },
      { id: 'cat', name: 'Boissons −10 %', code: null, amount: 80 },
    ]);
  });

  it('happy hour hors plage : aucune remise', () => {
    const happy = rule({ scope: 'CATEGORY', targetId: 'boissons', value: 5000, startMinute: 18 * 60, endMinute: 20 * 60 });
    expect(priceOrder({ lines: [line({})], promotions: [happy], moment: MARDI_1730, taxMode: 'INCLUSIVE' }).total).toBe(1000);
    expect(priceOrder({ lines: [line({})], promotions: [happy], moment: { ...MARDI_1730, minute: 18 * 60 }, taxMode: 'INCLUSIVE' }).total).toBe(500);
  });

  it('cumul : ligne, puis commande (minimum), puis code, puis remise manuelle, puis taxes', () => {
    const promotions = [
      rule({ id: 'ligne', name: 'Bière −10 %', scope: 'PRODUCT', targetId: 'biere', value: 1000 }),
      rule({ id: 'petite', name: '−200', kind: 'AMOUNT', value: 200, minAmount: 1000 }),
      rule({ id: 'grande', name: '−5 % dès 5000', value: 500, minAmount: 5000 }),
    ];
    const code = rule({ id: 'code', name: 'Bienvenue', code: 'BIENVENUE', value: 1000 });
    const priced = priceOrder({ lines: [line({ quantity: 6 })], promotions, code, moment: MARDI_1730, taxMode: 'EXCLUSIVE', manualDiscount: 100 });
    // 6000 → ligne −600 → 5400 ; commande : max(200, 270) = 270 → 5130 ; code 10 % → 513 → 4617 ; manuelle 100 → 4517.
    expect(priced.orderPromotion).toEqual({ id: 'grande', name: '−5 % dès 5000', code: null, amount: 270 });
    expect(priced.code).toEqual({ id: 'code', name: 'Bienvenue', code: 'BIENVENUE', amount: 513 });
    expect(priced.promotionDiscount).toBe(600 + 270 + 513);
    expect(priced.manualDiscount).toBe(100);
    expect(priced.taxes).toEqual([{ rateId: 'tva', name: 'TVA', rateBp: 1800, base: 4517, tax: 813 }]);
    expect(priced.total).toBe(4517 + 813);
  });

  it('code sur un produit : porté par les lignes visées, après la promotion automatique', () => {
    const auto = rule({ id: 'auto', scope: 'PRODUCT', targetId: 'biere', value: 1000 });
    const code = rule({ id: 'c', name: '2+1', code: 'TRIO', kind: 'FREE_ITEM', value: 0, scope: 'PRODUCT', targetId: 'biere', buyQuantity: 2, freeQuantity: 1 });
    const priced = priceOrder({ lines: [line({ quantity: 3 }), line({ productId: 'jus' })], promotions: [auto], code, moment: MARDI_1730, taxMode: 'INCLUSIVE' });
    expect(priced.lines[0]).toMatchObject({ promotionDiscount: 300, codeDiscount: 1000, net: 1700 });
    expect(priced.code?.amount).toBe(1000);
    expect(priced.codeOrderDiscount).toBe(0);
    expect(priced.total).toBe(2700);
  });

  it('code refusé : inactif, hors période, minimum non atteint, sans article visé — aucune remise', () => {
    const base = { lines: [line({ quantity: 2 })], promotions: [], moment: MARDI_1730, taxMode: 'INCLUSIVE' as const };
    expect(priceOrder({ ...base, code: rule({ code: 'X', isActive: false }) }).codeProblem).toEqual({ reason: 'INACTIVE' });
    expect(priceOrder({ ...base, code: rule({ code: 'X', endDate: '2026-01-01' }) }).codeProblem).toEqual({ reason: 'NOT_LIVE' });
    const min = priceOrder({ ...base, code: rule({ code: 'X', minAmount: 5000 }) });
    expect(min.codeProblem).toEqual({ reason: 'MIN_AMOUNT', minAmount: 5000 });
    expect(min.total).toBe(2000);
    expect(min.code).toBeNull();
    expect(priceOrder({ ...base, code: rule({ code: 'X', scope: 'PRODUCT', targetId: 'pizza' }) }).codeProblem).toEqual({ reason: 'NO_MATCH' });
  });

  it('vitrine du menu client : promotion la plus avantageuse pour un article', () => {
    const promotions = [rule({ id: 'a', scope: 'CATEGORY', targetId: 'boissons', value: 2000 }), rule({ id: 'b', kind: 'FREE_ITEM', value: 0, scope: 'PRODUCT', targetId: 'biere', buyQuantity: 1, freeQuantity: 1 })];
    expect(bestProductPromotion(promotions, { productId: 'biere', categoryId: 'boissons', unitPrice: 1000, promoPriced: false }, MARDI_1730)).toMatchObject({ discount: 200, promotion: { id: 'a' } });
    expect(bestProductPromotion([promotions[1]!], { productId: 'biere', categoryId: 'boissons', unitPrice: 1000, promoPriced: false }, MARDI_1730)).toMatchObject({ discount: 0, promotion: { id: 'b' } });
    expect(bestProductPromotion(promotions, { productId: 'biere', categoryId: 'boissons', unitPrice: 1000, promoPriced: true }, MARDI_1730)).toBeNull();
  });

  it('saisie d’une promotion : règles de cohérence', () => {
    const ok = (body: object) => promotionInputSchema.safeParse(body).success;
    const target = '0190b1a2-0000-7000-8000-000000000000';
    expect(ok({ name: 'Happy hour', kind: 'PERCENT', scope: 'CATEGORY', targetId: target, value: 5000, startMinute: 1020, endMinute: 1140 })).toBe(true);
    expect(ok({ name: 'x', kind: 'PERCENT', scope: 'ORDER', value: 0 })).toBe(false);
    expect(ok({ name: 'x', kind: 'PERCENT', scope: 'ORDER', value: 10001 })).toBe(false);
    expect(ok({ name: 'x', kind: 'FREE_ITEM', scope: 'ORDER', buyQuantity: 1, freeQuantity: 1 })).toBe(false);
    expect(ok({ name: 'x', kind: 'FREE_ITEM', scope: 'PRODUCT', targetId: target })).toBe(false);
    expect(ok({ name: 'x', kind: 'AMOUNT', scope: 'PRODUCT', value: 100 })).toBe(false);
    expect(ok({ name: 'x', kind: 'AMOUNT', scope: 'PRODUCT', targetId: target, value: 100, minAmount: 1000 })).toBe(false);
    expect(ok({ name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 100, startDate: '2026-09-30', endDate: '2026-09-01' })).toBe(false);
    expect(ok({ name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 100, startMinute: 600 })).toBe(false);
    expect(ok({ name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 100, code: 'é' })).toBe(false);
    expect(promotionInputSchema.parse({ name: 'x', kind: 'AMOUNT', scope: 'ORDER', value: 100, code: 'bienvenue' }).code).toBe('BIENVENUE');
  });
});
