/**
 * Taxes d'un établissement (§47). Aucune dépendance (pas de Zod) : le serveur, la caisse et le
 * menu client font exactement le même calcul.
 *
 * Règles :
 * - taux en points de base : 1800 = 18 % ; montants en unités mineures (entiers) ;
 * - mode « TVA incluse » (défaut) : les prix affichés contiennent la taxe, extraite du total ;
 *   mode « hors taxe » : la taxe s'ajoute au total ;
 * - taux d'une ligne : celui du produit, sinon celui de sa catégorie, sinon le taux par défaut ;
 *   aucun taux : ligne hors taxe (absente du détail) ;
 * - arrondi : à l'unité mineure la plus proche, la demi-unité vers le haut, calculé UNE fois par
 *   taux sur la somme des lignes (jamais ligne par ligne : pas d'écart cumulé d'arrondi) ;
 * - remises de commande (promotion de commande, code promo de commande, remise manuelle) :
 *   réparties sur les lignes au prorata de leur montant (plus forts restes), pour que chaque
 *   taux porte sa part.
 */

export const TAX_MODES = ['INCLUSIVE', 'EXCLUSIVE'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  INCLUSIVE: 'TVA incluse',
  EXCLUSIVE: 'Hors taxe',
};

/** 10 000 points de base = 100 %. */
export const BASIS_POINTS = 10_000;

export interface TaxRateRule {
  id: string;
  name: string;
  rateBp: number;
}

/** Détail d'un taux sur un ticket : base hors taxe et taxe. */
export interface TaxLine {
  rateId: string;
  name: string;
  rateBp: number;
  base: number;
  tax: number;
}

/** a / b arrondi au plus proche, demi vers le haut (a ≥ 0, b > 0). */
export function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** « 18 % », « 19,25 % ». */
export function formatRate(rateBp: number): string {
  const text = (rateBp / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `${text} %`;
}

/** Taxe contenue dans un montant TTC, ou due sur un montant HT. */
export function taxOf(amount: number, rateBp: number, mode: TaxMode): number {
  if (amount <= 0 || rateBp <= 0) return 0;
  return mode === 'INCLUSIVE' ? roundDiv(amount * rateBp, BASIS_POINTS + rateBp) : roundDiv(amount * rateBp, BASIS_POINTS);
}

/** Taux applicable : produit, puis catégorie, puis défaut de l'établissement. */
export function resolveTaxRateId(productRateId: string | null | undefined, categoryRateId: string | null | undefined, defaultRateId: string | null | undefined): string | null {
  return productRateId ?? categoryRateId ?? defaultRateId ?? null;
}

/**
 * Répartit `amount` au prorata de `weights` (entiers ≥ 0). Somme exacte : les unités restantes
 * vont aux plus forts restes, à égalité à la première ligne. Jamais plus qu'un poids.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const clean = weights.map((w) => Math.max(0, w));
  const total = clean.reduce((s, w) => s + w, 0);
  if (amount <= 0 || total <= 0) return clean.map(() => 0);
  const capped = Math.min(amount, total);
  // Produits en BigInt : poids × montant peut dépasser 2^53 sur de gros montants.
  const big = clean.map((w) => BigInt(w) * BigInt(capped));
  const shares = big.map((p) => Number(p / BigInt(total)));
  let rest = capped - shares.reduce((s, x) => s + x, 0);
  const order = big.map((p, i) => ({ i, remainder: p % BigInt(total) })).sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (rest <= 0) break;
    if (shares[i]! < clean[i]!) {
      shares[i] = shares[i]! + 1;
      rest -= 1;
    }
  }
  return shares;
}

export interface TaxedLine {
  /** Montant de la ligne après ses propres promotions. */
  net: number;
  taxRate: TaxRateRule | null;
}

export interface OrderTotals {
  /** Somme des lignes après leurs promotions. */
  lines: number;
  /** Remises de commande effectivement appliquées (jamais au-delà des lignes). */
  reductions: number;
  taxes: TaxLine[];
  taxTotal: number;
  total: number;
}

/** Taxes et total d'une commande à partir des lignes nettes et des remises de commande. */
export function computeTotals(mode: TaxMode, lines: TaxedLine[], reductions: number): OrderTotals {
  const nets = lines.map((l) => Math.max(0, l.net));
  const sum = nets.reduce((s, x) => s + x, 0);
  const applied = Math.max(0, Math.min(reductions, sum));
  const shares = allocate(applied, nets);
  const groups = new Map<string, { rate: TaxRateRule; amount: number; order: number }>();
  lines.forEach((l, i) => {
    if (!l.taxRate) return;
    const key = `${l.taxRate.id}:${l.taxRate.rateBp}`;
    const group = groups.get(key) ?? { rate: l.taxRate, amount: 0, order: groups.size };
    group.amount += nets[i]! - shares[i]!;
    groups.set(key, group);
  });
  const taxes = [...groups.values()]
    .sort((a, b) => b.rate.rateBp - a.rate.rateBp || a.order - b.order)
    .map(({ rate, amount }) => {
      const tax = taxOf(amount, rate.rateBp, mode);
      return { rateId: rate.id, name: rate.name, rateBp: rate.rateBp, base: mode === 'INCLUSIVE' ? amount - tax : amount, tax };
    });
  const taxTotal = taxes.reduce((s, t) => s + t.tax, 0);
  return { lines: sum, reductions: applied, taxes, taxTotal, total: sum - applied + (mode === 'EXCLUSIVE' ? taxTotal : 0) };
}

/** Additionne les détails de taxe de plusieurs commandes (reçu d'une table, rapport). */
export function mergeTaxLines(lists: TaxLine[][]): TaxLine[] {
  const merged = new Map<string, TaxLine>();
  for (const list of lists) {
    for (const t of list) {
      const key = `${t.name}:${t.rateBp}`;
      const current = merged.get(key);
      if (current) {
        current.base += t.base;
        current.tax += t.tax;
      } else {
        merged.set(key, { ...t });
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.rateBp - a.rateBp);
}
